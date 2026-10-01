const fs = require('fs');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');

const MAX_LOG_BYTES = 200 * 1024;
const MAX_COMMAND_LENGTH = 2000;
const ACTIVE_STATUSES = new Set(['starting', 'running', 'stopping']);

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

function directoryExists(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch (_) {
    return false;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function findFile(files, name) {
  return files.find((fileName) => fileName.toLowerCase() === name.toLowerCase()) || null;
}

function findExtension(files, extension) {
  return files.find((fileName) => path.extname(fileName).toLowerCase() === extension) || null;
}

function detectFramework(packageData, directory) {
  const dependencies = {
    ...(packageData?.dependencies || {}),
    ...(packageData?.devDependencies || {})
  };
  const names = Object.keys(dependencies).map((name) => name.toLowerCase());
  const markers = [
    ['next', 'Next.js'],
    ['vite', 'Vite'],
    ['@nestjs/core', 'NestJS'],
    ['@angular/core', 'Angular'],
    ['react', 'React'],
    ['vue', 'Vue'],
    ['svelte', 'Svelte'],
    ['express', 'Express'],
    ['fastify', 'Fastify'],
    ['nuxt', 'Nuxt']
  ];

  const marker = markers.find(([dependency]) => names.includes(dependency));
  if (marker) return marker[1];
  if (fileExists(path.join(directory, 'vite.config.js')) || fileExists(path.join(directory, 'vite.config.ts'))) return 'Vite';
  if (fileExists(path.join(directory, 'next.config.js')) || fileExists(path.join(directory, 'next.config.mjs'))) return 'Next.js';
  return '';
}

function getPackageCommand(directory) {
  const packagePath = path.join(directory, 'package.json');
  if (!fileExists(packagePath)) return null;

  let packageData;
  try {
    packageData = JSON.parse(readText(packagePath));
  } catch (_) {
    throw new Error('package.json không hợp lệ');
  }

  const scripts = packageData && typeof packageData.scripts === 'object' && !Array.isArray(packageData.scripts)
    ? packageData.scripts
    : {};
  const scriptName = ['dev', 'develop', 'start', 'serve', 'preview', 'build']
    .find((name) => typeof scripts[name] === 'string' && scripts[name].trim())
    || Object.keys(scripts).find((name) => typeof scripts[name] === 'string' && scripts[name].trim());

  if (!scriptName) return null;

  const manager = fileExists(path.join(directory, 'bun.lockb')) || fileExists(path.join(directory, 'bun.lock'))
    ? 'bun'
    : fileExists(path.join(directory, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : fileExists(path.join(directory, 'yarn.lock'))
        ? 'yarn'
        : 'npm';
  const command = manager === 'npm'
    ? scriptName === 'start' ? 'npm start' : `npm run ${scriptName}`
    : manager === 'pnpm'
      ? scriptName === 'start' ? 'pnpm start' : `pnpm run ${scriptName}`
      : manager === 'yarn'
        ? `yarn ${scriptName}`
        : `bun run ${scriptName}`;
  const framework = detectFramework(packageData, directory);
  const managerLabel = manager === 'npm' ? 'npm' : manager[0].toUpperCase() + manager.slice(1);

  return {
    runtime: framework ? `Node · ${managerLabel} · ${framework}` : `Node · ${managerLabel}`,
    command,
    detectionNote: scriptName === 'dev'
      ? `Đã tìm thấy script dev trong package.json: ${command}`
      : `Đã chọn script ${scriptName} trong package.json. Có thể chỉnh lệnh trước khi lưu.`
  };
}

function detectPythonRuntime(directory) {
  const text = `${readText(path.join(directory, 'requirements.txt'))}\n${readText(path.join(directory, 'pyproject.toml'))}`.toLowerCase();
  const framework = text.includes('fastapi') ? 'FastAPI'
    : text.includes('django') ? 'Django'
      : text.includes('flask') ? 'Flask'
        : '';
  return framework ? `Python · ${framework}` : 'Python';
}

function detectGoDirectory(directory, files) {
  if (!findFile(files, 'go.mod')) return null;
  return {
    name: path.basename(directory),
    targetPath: directory,
    workingDirectory: directory,
    runtime: 'Go',
    command: 'go run .',
    detectionNote: 'Đã tìm thấy go.mod. Kiểm tra module và cổng trước khi chạy.'
  };
}

function detectRustDirectory(directory, files) {
  if (!findFile(files, 'Cargo.toml')) return null;
  return {
    name: path.basename(directory),
    targetPath: directory,
    workingDirectory: directory,
    runtime: 'Rust · Cargo',
    command: 'cargo run',
    detectionNote: 'Đã tìm thấy Cargo.toml. Cargo sẽ build trước khi chạy lần đầu.'
  };
}

function detectJavaBuildDirectory(directory, files) {
  const pom = findFile(files, 'pom.xml');
  if (pom) {
    const command = 'mvn spring-boot:run';
    return {
      name: path.basename(directory),
      targetPath: directory,
      workingDirectory: directory,
      runtime: 'Java · Maven',
      command,
      detectionNote: 'Lệnh mặc định cho Maven/Spring Boot. Nếu project không dùng Spring Boot, hãy đổi command.'
    };
  }

  const gradleFile = findFile(files, 'build.gradle') || findFile(files, 'build.gradle.kts');
  if (gradleFile) {
    const wrapper = findFile(files, 'gradlew.bat') || findFile(files, 'gradlew');
    return {
      name: path.basename(directory),
      targetPath: directory,
      workingDirectory: directory,
      runtime: 'Java · Gradle',
      command: wrapper ? `${quote(`.${path.sep}${wrapper}`)} bootRun` : 'gradle bootRun',
      detectionNote: 'Lệnh mặc định cho Gradle/Spring Boot. Có thể đổi thành gradle run nếu project dùng application plugin.'
    };
  }

  return null;
}

function detectDotnetDirectory(directory, files) {
  const project = findExtension(files, '.csproj');
  if (!project) return null;
  return {
    name: path.basename(directory),
    targetPath: directory,
    workingDirectory: directory,
    runtime: '.NET',
    command: `dotnet run --project ${quote(path.join(directory, project))}`,
    detectionNote: 'Đã tìm thấy một project .NET ở thư mục gốc.'
  };
}

function detectPhpDirectory(directory, files) {
  if (!findFile(files, 'composer.json')) return null;
  return {
    name: path.basename(directory),
    targetPath: directory,
    workingDirectory: directory,
    runtime: 'PHP · Composer',
    command: 'php -S localhost:8000 -t .',
    detectionNote: 'PHP server mặc định dùng port 8000. Đổi port hoặc command nếu project có framework riêng.'
  };
}

function detectRubyDirectory(directory, files) {
  if (!findFile(files, 'Gemfile')) return null;
  const entry = findFile(files, 'main.rb') || findFile(files, 'app.rb') || 'main.rb';
  return {
    name: path.basename(directory),
    targetPath: directory,
    workingDirectory: directory,
    runtime: 'Ruby · Bundler',
    command: `bundle exec ruby ${quote(entry)}`,
    detectionNote: fileExists(path.join(directory, entry))
      ? 'Đã tìm thấy Ruby entry file.'
      : 'Chưa tìm thấy main.rb/app.rb. Hãy đổi entry file trước khi chạy.'
  };
}

function detectDartDirectory(directory, files) {
  if (!findFile(files, 'pubspec.yaml')) return null;
  const pubspec = readText(path.join(directory, findFile(files, 'pubspec.yaml'))).toLowerCase();
  const flutter = /(^|\n)\s*flutter\s*:|flutter:/.test(pubspec) || pubspec.includes('flutter_');
  return {
    name: path.basename(directory),
    targetPath: directory,
    workingDirectory: directory,
    runtime: flutter ? 'Flutter/Dart' : 'Dart',
    command: flutter ? 'flutter run' : 'dart run',
    detectionNote: flutter ? 'Đã nhận diện project Flutter qua pubspec.yaml.' : 'Đã nhận diện project Dart qua pubspec.yaml.'
  };
}

function detectCmakeDirectory(directory, files) {
  if (!findFile(files, 'CMakeLists.txt')) return null;
  const hasBuildDirectory = directoryExists(path.join(directory, 'build'));
  return {
    name: path.basename(directory),
    targetPath: directory,
    workingDirectory: directory,
    runtime: 'C/C++ · CMake',
    command: hasBuildDirectory ? 'cmake --build build' : 'cmake -S . -B build && cmake --build build',
    detectionNote: hasBuildDirectory
      ? 'Đã tìm thấy thư mục build của CMake.'
      : 'Chưa có thư mục build. Lệnh sẽ configure rồi build; kiểm tra generator nếu cần.'
  };
}

function detectFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const workingDirectory = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const name = path.basename(filePath, extension);
  const common = { name, targetPath: filePath, workingDirectory };

  if (fileName.toLowerCase() === 'package.json') return detectTarget(workingDirectory);
  if (fileName.toLowerCase() === 'go.mod') return detectGoDirectory(workingDirectory, listFiles(workingDirectory));
  if (fileName.toLowerCase() === 'cargo.toml') return detectRustDirectory(workingDirectory, listFiles(workingDirectory));
  if (fileName.toLowerCase() === 'pubspec.yaml') return detectDartDirectory(workingDirectory, listFiles(workingDirectory));
  if (fileName.toLowerCase() === 'composer.json') return detectPhpDirectory(workingDirectory, listFiles(workingDirectory));
  if (fileName.toLowerCase() === 'cmakelists.txt') return detectCmakeDirectory(workingDirectory, listFiles(workingDirectory));
  if (fileName.toLowerCase() === 'pom.xml' || /^build\.gradle(\.kts)?$/i.test(fileName)) {
    return detectJavaBuildDirectory(workingDirectory, listFiles(workingDirectory));
  }

  if (extension === '.sln') {
    const projects = listFiles(workingDirectory).filter((entry) => path.extname(entry).toLowerCase() === '.csproj');
    if (projects.length === 1) {
      return {
        ...common,
        runtime: '.NET',
        command: `dotnet run --project ${quote(path.join(workingDirectory, projects[0]))}`,
        detectionNote: 'Đã tìm thấy một .csproj cạnh solution.'
      };
    }
    throw new Error('Solution có nhiều project hoặc chưa có .csproj cạnh file. Hãy chọn project .csproj cụ thể.');
  }

  const detectors = {
    '.py': { runtime: detectPythonRuntime(workingDirectory), command: `python ${quote(filePath)}` },
    '.js': { runtime: 'Node.js', command: `node ${quote(filePath)}` },
    '.mjs': { runtime: 'Node.js', command: `node ${quote(filePath)}` },
    '.cjs': { runtime: 'Node.js', command: `node ${quote(filePath)}` },
    '.go': { runtime: 'Go', command: `go run ${quote(filePath)}`, detectionNote: 'Nếu file thuộc module Go, ưu tiên chạy từ thư mục có go.mod.' },
    '.rs': { runtime: 'Rust', command: 'cargo run', detectionNote: 'Lệnh dùng Cargo ở thư mục chứa Cargo.toml.' },
    '.java': { runtime: 'Java', command: `java ${quote(filePath)}`, detectionNote: 'Java source launch cần JDK hỗ trợ chạy source trực tiếp.' },
    '.kt': { runtime: 'Kotlin', command: `kotlinc ${quote(filePath)} -include-runtime -d ${quote(path.join(workingDirectory, `${name}.jar`))}`, detectionNote: 'Lệnh sẽ biên dịch ra JAR trong thư mục file.' },
    '.exe': { runtime: 'Windows', command: quote(filePath) },
    '.bat': { runtime: 'Batch', command: quote(filePath) },
    '.cmd': { runtime: 'Command', command: quote(filePath) },
    '.ps1': { runtime: 'PowerShell', command: `powershell.exe -NoProfile -File ${quote(filePath)}` },
    '.sh': { runtime: 'Shell', command: `bash ${quote(filePath)}` },
    '.jar': { runtime: 'Java', command: `java -jar ${quote(filePath)}` },
    '.csproj': { runtime: '.NET', command: `dotnet run --project ${quote(filePath)}` },
    '.php': { runtime: 'PHP', command: `php -S localhost:8000 ${quote(filePath)}`, detectionNote: 'PHP server mặc định dùng port 8000.' },
    '.rb': { runtime: 'Ruby', command: `ruby ${quote(filePath)}` },
    '.dart': { runtime: 'Dart', command: `dart run ${quote(filePath)}` }
  };

  if (extension === '.c' || extension === '.cc' || extension === '.cpp' || extension === '.cxx' || extension === '.h' || extension === '.hpp') {
    throw new Error('File C/C++ cần CMakeLists.txt hoặc toolchain riêng. Hãy chọn folder project để App Runner dùng CMake.');
  }

  const detected = detectors[extension];
  if (!detected) {
    throw new Error(`Chưa hỗ trợ file ${extension || fileName}. Hãy chọn file chạy chính.`);
  }
  if (extension === '.rs' && !fileExists(path.join(workingDirectory, 'Cargo.toml'))) {
    throw new Error('File Rust chưa có Cargo.toml cùng thư mục. Hãy chọn folder Cargo project.');
  }

  return { ...common, ...detected };
}

function detectDirectory(directory) {
  const files = listFiles(directory);
  const packageCommand = getPackageCommand(directory);
  if (packageCommand) {
    return {
      name: path.basename(directory),
      targetPath: directory,
      workingDirectory: directory,
      ...packageCommand
    };
  }

  const preferredPythonFiles = ['main.py', 'app.py', 'run.py', 'manage.py'];
  for (const preferredFile of preferredPythonFiles) {
    const fileName = findFile(files, preferredFile);
    if (fileName) {
      return {
        ...detectFile(path.join(directory, fileName)),
        name: path.basename(directory),
        targetPath: directory
      };
    }
  }

  const detectors = [
    () => detectGoDirectory(directory, files),
    () => detectRustDirectory(directory, files),
    () => detectDotnetDirectory(directory, files),
    () => detectJavaBuildDirectory(directory, files),
    () => detectPhpDirectory(directory, files),
    () => detectRubyDirectory(directory, files),
    () => detectDartDirectory(directory, files),
    () => detectCmakeDirectory(directory, files)
  ];
  for (const detect of detectors) {
    const result = detect();
    if (result) return result;
  }

  const startupFile = ['start.bat', 'start.cmd', 'run.bat', 'run.cmd', 'start.ps1', 'run.ps1']
    .map((name) => findFile(files, name))
    .find(Boolean);
  if (startupFile) return { ...detectFile(path.join(directory, startupFile)), name: path.basename(directory), targetPath: directory };

  const jar = findExtension(files, '.jar');
  if (jar) return { ...detectFile(path.join(directory, jar)), name: path.basename(directory), targetPath: directory };
  const executable = findExtension(files, '.exe');
  if (executable) return { ...detectFile(path.join(directory, executable)), name: path.basename(directory), targetPath: directory };

  // ponytail: chỉ nhận diện marker ở thư mục gốc; monorepo/subfolder vẫn cần chọn folder con hoặc sửa command.
  throw new Error('Không tìm thấy lệnh chạy. Hãy chọn trực tiếp file entry hoặc folder project có marker.');
}

function detectTarget(targetPath) {
  const resolvedPath = path.resolve(String(targetPath || ''));
  let stats;
  try {
    stats = fs.statSync(resolvedPath);
  } catch (_) {
    throw new Error('File hoặc thư mục không còn tồn tại');
  }

  if (stats.isFile()) return detectFile(resolvedPath);
  if (stats.isDirectory()) return detectDirectory(resolvedPath);
  throw new Error('Đường dẫn đã chọn không phải file hoặc thư mục');
}

function normalizeLauncher(input, existing, now = Date.now()) {
  const name = String(input?.name || '').trim().slice(0, 120);
  const command = String(input?.command || '').trim();
  const targetPath = path.resolve(String(input?.targetPath || ''));
  const workingDirectory = path.resolve(String(input?.workingDirectory || ''));

  if (!name) throw new Error('Tên ứng dụng không được để trống');
  if (!command) throw new Error('Lệnh chạy không được để trống');
  if (command.length > MAX_COMMAND_LENGTH) throw new Error(`Lệnh chạy không được vượt quá ${MAX_COMMAND_LENGTH} ký tự`);

  let targetStats;
  let directoryStats;
  try {
    targetStats = fs.statSync(targetPath);
    directoryStats = fs.statSync(workingDirectory);
  } catch (_) {
    throw new Error('File hoặc thư mục làm việc không còn tồn tại');
  }
  if (!targetStats.isFile() && !targetStats.isDirectory()) throw new Error('Target không hợp lệ');
  if (!directoryStats.isDirectory()) throw new Error('Thư mục làm việc không hợp lệ');

  return {
    id: existing?.id || `app_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    targetPath,
    workingDirectory,
    runtime: String(input?.runtime || existing?.runtime || 'Custom').trim().slice(0, 60) || 'Custom',
    command,
    pinned: !!input?.pinned,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function createAppRunner({ ipcMain, dialog, shell, settings, emit = () => {} }) {
  const runtimes = new Map();

  function getApps() {
    if (!Array.isArray(settings.developerApps)) settings.developerApps = [];
    return settings.developerApps;
  }

  function persist() {
    settings._save();
  }

  function requireApp(id) {
    const app = getApps().find((item) => item.id === String(id || ''));
    if (!app) throw new Error('Không tìm thấy ứng dụng đã lưu');
    return app;
  }

  function defaultRuntime() {
    return { status: 'stopped', pid: null, startedAt: null, durationMs: 0, exitCode: null, logs: [] };
  }

  function runtimeSnapshot(id, includeLogs = true) {
    const runtime = runtimes.get(id);
    if (!runtime) return defaultRuntime();
    const durationMs = runtime.startedAt && ACTIVE_STATUSES.has(runtime.status)
      ? Date.now() - runtime.startedAt
      : runtime.durationMs || 0;
    return {
      status: runtime.status,
      pid: runtime.pid,
      startedAt: runtime.startedAt,
      durationMs,
      exitCode: runtime.exitCode,
      ...(includeLogs ? { logs: [...runtime.logs] } : {})
    };
  }

  function snapshotApp(app, includeLogs = true) {
    return { ...app, process: runtimeSnapshot(app.id, includeLogs) };
  }

  function listApps(includeLogs = true) {
    return getApps().map((app) => snapshotApp(app, includeLogs));
  }

  function emitAppsChanged() {
    emit('app-runner-apps-changed', listApps(false));
  }

  function emitState(id) {
    emit('app-runner-state', { id, process: runtimeSnapshot(id, false) });
  }

  function appendLog(id, stream, text) {
    const runtime = runtimes.get(id);
    if (!runtime) return;
    const normalizedText = String(text || '').replace(/\r\n/g, '\n');
    if (!normalizedText) return;
    const entry = { timestamp: Date.now(), stream, text: normalizedText };
    runtime.logs.push(entry);
    runtime.logBytes += Buffer.byteLength(normalizedText, 'utf8');
    while (runtime.logBytes > MAX_LOG_BYTES && runtime.logs.length > 1) {
      const removed = runtime.logs.shift();
      runtime.logBytes -= Buffer.byteLength(removed.text, 'utf8');
    }
    emit('app-runner-log', { id, entry });
  }

  function waitForExit(runtime, timeoutMs = 5000) {
    if (!runtime.child) return Promise.resolve();
    return Promise.race([
      runtime.exitPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Tiến trình chưa dừng sau 5 giây')), timeoutMs))
    ]);
  }

  async function startApp(id) {
    const app = requireApp(id);
    let runtime = runtimes.get(app.id);
    if (runtime && ACTIVE_STATUSES.has(runtime.status)) throw new Error('Ứng dụng đang chạy');
    if (!runtime) {
      runtime = { ...defaultRuntime(), logBytes: 0, child: null, exitPromise: Promise.resolve() };
      runtimes.set(app.id, runtime);
    }
    runtime.status = 'starting';
    runtime.stopRequested = false;
    runtime.pid = null;
    runtime.startedAt = Date.now();
    runtime.durationMs = 0;
    runtime.exitCode = null;
    emitState(app.id);
    appendLog(app.id, 'system', `> ${app.command}\n`);

    let child;
    try {
      child = spawn(app.command, { cwd: app.workingDirectory, env: process.env, shell: true, windowsHide: true });
    } catch (error) {
      runtime.status = 'error';
      runtime.durationMs = Date.now() - runtime.startedAt;
      runtime.startedAt = null;
      appendLog(app.id, 'stderr', `${error.message}\n`);
      emitState(app.id);
      throw error;
    }

    runtime.child = child;
    runtime.pid = child.pid || null;
    runtime.status = 'running';
    runtime.exitPromise = new Promise((resolve) => {
      let finalized = false;
      const finish = (code, error) => {
        if (finalized) return;
        finalized = true;
        runtime.durationMs = runtime.startedAt ? Date.now() - runtime.startedAt : runtime.durationMs;
        runtime.startedAt = null;
        runtime.pid = null;
        runtime.child = null;
        runtime.exitCode = Number.isInteger(code) ? code : null;
        const wasStoppedByUser = runtime.stopRequested || runtime.status === 'stopping';
        runtime.status = wasStoppedByUser ? 'stopped' : (error || (Number.isInteger(code) && code !== 0) ? 'error' : 'stopped');
        runtime.stopRequested = false;
        if (error && !wasStoppedByUser) appendLog(app.id, 'stderr', `${error.message}\n`);
        const exitLabel = wasStoppedByUser ? 'Đã dừng theo yêu cầu' : `Tiến trình đã kết thúc${Number.isInteger(code) ? ` (code ${code})` : ''}`;
        appendLog(app.id, 'system', `${exitLabel}.\n`);
        emitState(app.id);
        resolve();
      };
      child.once('error', (error) => finish(null, error));
      child.once('close', (code) => finish(code, null));
    });
    child.stdout?.on('data', (chunk) => appendLog(app.id, 'stdout', chunk));
    child.stderr?.on('data', (chunk) => appendLog(app.id, 'stderr', chunk));
    emitState(app.id);
    return snapshotApp(app);
  }

  async function stopApp(id) {
    const app = requireApp(id);
    const runtime = runtimes.get(app.id);
    if (!runtime || !runtime.child || !ACTIVE_STATUSES.has(runtime.status)) return snapshotApp(app);
    const pid = runtime.pid;
    runtime.stopRequested = true;
    runtime.status = 'stopping';
    emitState(app.id);
    appendLog(app.id, 'system', 'Đang dừng cây tiến trình...\n');
    try {
      await new Promise((resolve) => {
        execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
      });
      await waitForExit(runtime);
    } catch (error) {
      if (runtime.child) {
        runtime.status = 'error';
        appendLog(app.id, 'stderr', `Không dừng được tiến trình: ${error.message}\n`);
        emitState(app.id);
        throw new Error(`Không dừng được ứng dụng: ${error.message}`);
      }
    }
    return snapshotApp(app);
  }

  async function restartApp(id) {
    await stopApp(id);
    return startApp(id);
  }

  function clearLog(id) {
    const app = requireApp(id);
    const runtime = runtimes.get(app.id);
    if (runtime) {
      runtime.logs = [];
      runtime.logBytes = 0;
    }
    emit('app-runner-log-cleared', { id: app.id });
    return snapshotApp(app);
  }

  async function deleteApp(id) {
    const app = requireApp(id);
    await stopApp(app.id);
    settings.developerApps = getApps().filter((item) => item.id !== app.id);
    runtimes.delete(app.id);
    persist();
    emitAppsChanged();
    return { ok: true, apps: listApps() };
  }

  ipcMain.handle('app-runner-pick', async (_, type) => {
    const properties = type === 'folder' ? ['openDirectory'] : ['openFile'];
    const result = await dialog.showOpenDialog({
      title: type === 'folder' ? 'Chọn thư mục ứng dụng' : 'Chọn file khởi chạy',
      properties,
      filters: type === 'folder' ? undefined : [{ name: 'Ứng dụng và mã nguồn', extensions: ['py', 'js', 'mjs', 'cjs', 'go', 'rs', 'java', 'kt', 'exe', 'bat', 'cmd', 'ps1', 'sh', 'jar', 'csproj', 'sln', 'php', 'rb', 'dart', 'json', 'toml', 'yaml', 'yml', 'txt'] }, { name: 'Tất cả file', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths?.[0]) return { cancelled: true };
    return { ok: true, draft: detectTarget(result.filePaths[0]) };
  });

  ipcMain.handle('app-runner-list', () => listApps());
  ipcMain.handle('app-runner-save', (_, input) => {
    const current = getApps();
    const existing = input?.id ? current.find((item) => item.id === input.id) : null;
    if (input?.id && !existing) throw new Error('Ứng dụng cần sửa không còn tồn tại');
    const normalized = normalizeLauncher(input, existing);
    settings.developerApps = existing
      ? current.map((item) => item.id === normalized.id ? normalized : item)
      : [normalized, ...current];
    persist();
    emitAppsChanged();
    return { ok: true, app: snapshotApp(normalized), apps: listApps() };
  });
  ipcMain.handle('app-runner-delete', (_, id) => deleteApp(id));
  ipcMain.handle('app-runner-toggle-pin', (_, { id, pinned }) => {
    const app = requireApp(id);
    const now = Date.now();
    settings.developerApps = getApps().map((item) => item.id === app.id ? { ...item, pinned: !!pinned, updatedAt: now } : item);
    persist();
    emitAppsChanged();
    return { ok: true, apps: listApps() };
  });
  ipcMain.handle('app-runner-start', (_, id) => startApp(id));
  ipcMain.handle('app-runner-stop', (_, id) => stopApp(id));
  ipcMain.handle('app-runner-restart', (_, id) => restartApp(id));
  ipcMain.handle('app-runner-clear-log', (_, id) => clearLog(id));
  ipcMain.handle('app-runner-open-target', async (_, id) => {
    const app = requireApp(id);
    const stats = fs.statSync(app.targetPath);
    if (stats.isFile()) {
      shell.showItemInFolder(app.targetPath);
      return { ok: true };
    }
    const errorMessage = await shell.openPath(app.targetPath);
    if (errorMessage) throw new Error(errorMessage);
    return { ok: true };
  });

  function cleanupAllSync() {
    for (const runtime of runtimes.values()) {
      if (!runtime.child || !runtime.pid) continue;
      try {
        execFileSync('taskkill.exe', ['/PID', String(runtime.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } catch (_) {}
    }
  }

  return { cleanupAllSync };
}

module.exports = { createAppRunner, detectTarget, normalizeLauncher };

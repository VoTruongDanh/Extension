const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { detectTarget } = require('../src/main/tools/app-runner');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-runner-'));

function createProject(name, files) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  Object.entries(files).forEach(([fileName, content]) => {
    const filePath = path.join(directory, fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  });
  return directory;
}

try {
  const nodeProject = createProject('node-project', {
    'package.json': JSON.stringify({ scripts: { dev: 'vite', start: 'node index.js' }, devDependencies: { vite: '^6.0.0' } }),
    'package-lock.json': '{}'
  });
  assert.equal(detectTarget(nodeProject).command, 'npm run dev');
  assert.equal(detectTarget(nodeProject).runtime, 'Node · npm · Vite');

  const pnpmProject = createProject('pnpm-project', {
    'package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
    'pnpm-lock.yaml': ''
  });
  assert.equal(detectTarget(pnpmProject).command, 'pnpm run dev');

  const yarnProject = createProject('yarn-project', {
    'package.json': JSON.stringify({ scripts: { serve: 'vue-cli-service serve' }, dependencies: { vue: '^3.0.0' } }),
    'yarn.lock': ''
  });
  assert.equal(detectTarget(yarnProject).command, 'yarn serve');
  assert.equal(detectTarget(yarnProject).runtime, 'Node · Yarn · Vue');

  const bunProject = createProject('bun-project', {
    'package.json': JSON.stringify({ scripts: { preview: 'vite preview' } }),
    'bun.lock': ''
  });
  assert.equal(detectTarget(bunProject).command, 'bun run preview');

  const customScriptProject = createProject('custom-script-project', {
    'package.json': JSON.stringify({ scripts: { serve: 'node server.js' } })
  });
  assert.equal(detectTarget(customScriptProject).command, 'npm run serve');

  const pythonProject = createProject('python-project', {
    'main.py': 'print("ok")',
    'requirements.txt': 'fastapi\n'
  });
  const python = detectTarget(pythonProject);
  assert.equal(python.runtime, 'Python · FastAPI');
  assert.match(python.command, /^python ".+main\.py"$/);
  assert.equal(python.targetPath, pythonProject);

  const goProject = createProject('go-project', { 'go.mod': 'module example.com/app\n' });
  assert.equal(detectTarget(goProject).command, 'go run .');
  assert.equal(detectTarget(goProject).runtime, 'Go');

  const rustProject = createProject('rust-project', { 'Cargo.toml': '[package]\nname = "app"\n' });
  assert.equal(detectTarget(rustProject).command, 'cargo run');
  assert.equal(detectTarget(rustProject).runtime, 'Rust · Cargo');

  const mavenProject = createProject('maven-project', { 'pom.xml': '<project />' });
  assert.equal(detectTarget(mavenProject).command, 'mvn spring-boot:run');

  const gradleProject = createProject('gradle-project', { 'build.gradle': 'plugins {}', 'gradlew.bat': '' });
  assert.match(detectTarget(gradleProject).command, /bootRun$/);

  const dotnetProject = createProject('dotnet-project', { 'Web.csproj': '<Project />' });
  assert.match(detectTarget(dotnetProject).command, /^dotnet run --project ".+Web\.csproj"$/);

  const phpProject = createProject('php-project', { 'composer.json': '{}' });
  assert.equal(detectTarget(phpProject).command, 'php -S localhost:8000 -t .');

  const rubyProject = createProject('ruby-project', { 'Gemfile': '', 'main.rb': 'puts :ok' });
  assert.equal(detectTarget(rubyProject).command, 'bundle exec ruby "main.rb"');

  const flutterProject = createProject('flutter-project', { 'pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n' });
  assert.equal(detectTarget(flutterProject).command, 'flutter run');

  const cmakeProject = createProject('cmake-project', { 'CMakeLists.txt': 'project(app)' });
  assert.equal(detectTarget(cmakeProject).command, 'cmake -S . -B build && cmake --build build');

  const powershellFile = path.join(createProject('powershell-project', { 'start.ps1': 'Write-Host ok' }), 'start.ps1');
  assert.match(detectTarget(powershellFile).command, /^powershell\.exe -NoProfile -File ".+start\.ps1"$/);

  const shellFile = path.join(createProject('shell-project', { 'start.sh': 'echo ok' }), 'start.sh');
  assert.match(detectTarget(shellFile).command, /^bash ".+start\.sh"$/);

  const jarFile = path.join(createProject('java-project', { 'server.jar': '' }), 'server.jar');
  assert.match(detectTarget(jarFile).command, /^java -jar ".+server\.jar"$/);

  const unsupportedFile = path.join(createProject('unsupported-project', { 'readme.txt': '' }), 'readme.txt');
  assert.throws(() => detectTarget(unsupportedFile), /Chưa hỗ trợ file/);

  const emptyDirectory = createProject('empty-project', {});
  assert.throws(() => detectTarget(emptyDirectory), /Không tìm thấy lệnh chạy/);

  const malformedPackage = createProject('malformed-package', { 'package.json': '{' });
  assert.throws(() => detectTarget(malformedPackage), /package\.json không hợp lệ/);

  console.log('App Runner detector: OK');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

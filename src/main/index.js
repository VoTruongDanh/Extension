const { app, BrowserWindow, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path');
const { execSync } = require('child_process');

const { load }     = require('./settings');
const tray         = require('./tray');
const { register } = require('./ipc');

let mainWindow      = null;

const settings = load();

// ─── Check Admin ──────────────────────────────────────────────────────────────
function isAdmin() {
  try {
    execSync('net session', { windowsHide: true, stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function restartAsAdmin() {
  const fs = require('fs');
  const isDev = !app.isPackaged;
  
  if (isDev) {
    // Dev mode: dùng VBScript để request admin và chạy npm start
    const cwd = process.cwd();
    const vbsPath = path.join(cwd, 'restart-admin.vbs');
    const vbsContent = `Set objShell = CreateObject("Shell.Application")
objShell.ShellExecute "cmd.exe", "/c cd /d ""${cwd}"" && npm start", "", "runas", 1`;
    
    fs.writeFileSync(vbsPath, vbsContent, 'utf8');
    
    // Chạy VBScript
    const { exec } = require('child_process');
    exec(`cscript //nologo "${vbsPath}"`, { windowsHide: true });
    
    // Xóa VBS file sau 2 giây
    setTimeout(() => {
      try { fs.unlinkSync(vbsPath); } catch (_) {}
    }, 2000);
  } else {
    // Production: restart app.exe với admin
    const exePath = process.execPath;
    const vbsPath = path.join(app.getPath('temp'), 'restart-admin.vbs');
    const vbsContent = `Set objShell = CreateObject("Shell.Application")
objShell.ShellExecute "${exePath}", "", "", "runas", 1`;
    
    fs.writeFileSync(vbsPath, vbsContent, 'utf8');
    
    const { exec } = require('child_process');
    exec(`cscript //nologo "${vbsPath}"`, { windowsHide: true });
    
    setTimeout(() => {
      try { fs.unlinkSync(vbsPath); } catch (_) {}
    }, 2000);
  }
  
  app.exit(0);
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const bounds = settings.windowBounds || { width: 1100, height: 720 };

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900, minHeight: 600,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    frame: true,
    backgroundColor: '#ffffff',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../../index.html'));

  // Clear cache trong dev mode
  if (!app.isPackaged) {
    mainWindow.webContents.session.clearCache();
  }

  // Mở DevTools trong development
  // mainWindow.webContents.openDevTools();

  // Log lỗi từ renderer ra console
  mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[Renderer] ${message} (${sourceId}:${line})`);
    else console.log(`[Renderer] ${message}`);
  });
  mainWindow.webContents.on('did-fail-load', (e, code, desc) => {
    console.error(`[Load failed] ${code}: ${desc}`);
  });

  const saveBounds = () => {
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      settings.windowBounds = mainWindow.getBounds();
      settings._save();
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move',   saveBounds);

  mainWindow.once('ready-to-show', async () => {
    if (!settings.startMinimized) {
      mainWindow.maximize();
      mainWindow.show();
    }
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting && settings.minimizeToTray !== false) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const hasAdmin = isAdmin();

  // Kiểm tra admin - nếu không có thì chỉ báo nhẹ, không chặn app
  if (!hasAdmin) {
    console.log('[Admin] App khong chay voi admin');
  } else {
    console.log('[Admin] App dang chay voi quyen admin');
  }
  
  createWindow();

  if (!hasAdmin) {
    app.once('browser-window-created', (_, win) => {
      win.webContents.once('did-finish-load', () => {
        win.webContents.send(
          'main-toast',
          'Ứng dụng đang chạy không có quyền Administrator. Tính năng reset AnyDesk có thể không hoạt động đầy đủ.'
        );
      });
    });
  }

  tray.create(
    path.join(__dirname, '../../icon.png'),
    (action) => {
      if (action === 'show') { mainWindow && mainWindow.show(); return; }
      if (action === 'quit') { app.isQuitting = true; app.quit(); return; }
      if (mainWindow) mainWindow.webContents.send(`tray-${action}`);
    }
  );

  register({ ipcMain, app, shell, settings });

  globalShortcut.register('F12', () => mainWindow && mainWindow.webContents.toggleDevTools());
});

app.on('window-all-closed', (e) => e.preventDefault());

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

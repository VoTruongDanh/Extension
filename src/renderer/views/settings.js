const { ipcRenderer } = require('electron');
const ui = require('../ui');

let lastSavedState = {};
let copyPasteCodeModal = null;
let copyPasteCodeResolve = null;

function load() {
  ipcRenderer.send('get-settings');
}

function markDirty() {
  const badge = ui.$('settings-dirty-badge');
  if (badge) badge.style.display = 'inline-flex';
}

function markClean() {
  const badge = ui.$('settings-dirty-badge');
  if (badge) badge.style.display = 'none';
}

function getCurrentState() {
  return {
    autoLaunch: ui.$('setting-auto-launch').checked,
    startMinimized: ui.$('setting-start-minimized').checked,
    minimizeToTray: ui.$('setting-minimize-tray').checked
  };
}

function isDirty() {
  const current = getCurrentState();
  return JSON.stringify(current) !== JSON.stringify(lastSavedState);
}

function init() {
  ipcRenderer.on('settings-data', (_, s) => {
    ui.$('setting-auto-launch').checked = !!s.autoLaunch;
    ui.$('setting-start-minimized').checked = !!s.startMinimized;
    ui.$('setting-minimize-tray').checked = s.minimizeToTray !== false;
    ui.$('settings-path-text').textContent = s._path || '...';
    lastSavedState = getCurrentState();
    markClean();
  });

  ipcRenderer.on('settings-saved', () => {
    lastSavedState = getCurrentState();
    markClean();
    ui.showToast('Đã lưu cài đặt', 'success');
  });

  ipcRenderer.on('app-version', (_, v) => {
    ui.$('app-version-text').textContent = `v${v}`;
  });

  [
    'setting-auto-launch',
    'setting-start-minimized',
    'setting-minimize-tray'
  ].forEach((id) => {
    const el = ui.$(id);
    if (el) el.addEventListener('change', () => (isDirty() ? markDirty() : markClean()));
  });

  ui.$('save-settings-btn').addEventListener('click', () => {
    const current = getCurrentState();
    ipcRenderer.send('save-settings', current);
  });

  ui.$('copypaste-upload-btn').addEventListener('click', handleCopyPasteUpload);
  ui.$('copypaste-download-btn').addEventListener('click', handleCopyPasteDownload);

  loadCopyPasteInfo();
}

function ensureCopyPasteCodeModal() {
  if (copyPasteCodeModal) return copyPasteCodeModal;

  const overlay = document.createElement('div');
  overlay.className = 'library-modal-overlay';
  overlay.id = 'copypaste-code-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'copypaste-code-modal-title');
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="library-modal">
      <div class="library-modal-head">
        <div>
          <h2 id="copypaste-code-modal-title">Download cấu hình</h2>
          <p>Nhập code đã được tạo từ lần upload trước đó.</p>
        </div>
        <button class="btn-icon btn-secondary" type="button" id="copypaste-code-modal-close" aria-label="Đóng">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
        </button>
      </div>
      <form id="copypaste-code-form" class="library-form">
        <label class="library-field">
          <span class="library-label">Mã cấu hình</span>
          <input id="copypaste-code-input" class="library-input" type="text" maxlength="120" placeholder="Ví dụ: ABC123" autocomplete="off" required>
        </label>
        <div class="library-form-actions library-modal-actions">
          <button class="btn btn-secondary" type="button" id="copypaste-code-cancel">Hủy</button>
          <button class="btn btn-success" type="submit">Download</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  const form = overlay.querySelector('#copypaste-code-form');
  const input = overlay.querySelector('#copypaste-code-input');

  const closeModal = () => {
    overlay.style.display = 'none';
    form.reset();
  };

  const resolveModal = (value) => {
    if (!copyPasteCodeResolve) return;
    const resolve = copyPasteCodeResolve;
    copyPasteCodeResolve = null;
    closeModal();
    resolve(value);
  };

  overlay.querySelector('#copypaste-code-modal-close').addEventListener('click', () => resolveModal(null));
  overlay.querySelector('#copypaste-code-cancel').addEventListener('click', () => resolveModal(null));
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) resolveModal(null);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    resolveModal(input.value.trim());
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.style.display !== 'none') resolveModal(null);
  });

  copyPasteCodeModal = overlay;
  return overlay;
}

function requestCopyPasteCode() {
  const overlay = ensureCopyPasteCodeModal();
  const input = overlay.querySelector('#copypaste-code-input');

  if (copyPasteCodeResolve) {
    copyPasteCodeResolve(null);
    copyPasteCodeResolve = null;
  }

  overlay.style.display = 'flex';
  input.focus();
  input.select();

  return new Promise((resolve) => {
    copyPasteCodeResolve = resolve;
  });
}

async function loadCopyPasteInfo() {
  try {
    const info = await ipcRenderer.invoke('copypaste-get-info');

    ui.$('copypaste-current-code').textContent = info.code || '--';
    ui.$('copypaste-upload-time').textContent = info.uploadedAt
      ? new Date(info.uploadedAt).toLocaleString('vi-VN')
      : '--';
    ui.$('copypaste-download-time').textContent = info.downloadedAt
      ? new Date(info.downloadedAt).toLocaleString('vi-VN')
      : '--';
  } catch (error) {
    console.error('Failed to load copy-paste info:', error);
  }
}

async function handleCopyPasteUpload() {
  const btn = ui.$('copypaste-upload-btn');
  btn.disabled = true;
  btn.classList.add('loading');

  try {
    const result = await ipcRenderer.invoke('copypaste-upload');

    if (result.ok) {
      ui.$('copypaste-current-code').textContent = result.code;
      ui.$('copypaste-upload-time').textContent = new Date(result.timestamp).toLocaleString('vi-VN');

      navigator.clipboard.writeText(result.code);
      ui.showToast(`Upload thành công! Code: ${result.code} (đã copy)`, 'success');
    } else {
      ui.showToast(`Upload thất bại: ${result.error}`, 'error');
    }
  } catch (error) {
    ui.showToast(`Lỗi: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

async function handleCopyPasteDownload() {
  const code = await requestCopyPasteCode();
  if (!code) return;

  const btn = ui.$('copypaste-download-btn');
  btn.disabled = true;
  btn.classList.add('loading');

  try {
    const result = await ipcRenderer.invoke('copypaste-download', code);

    if (result.ok) {
      ui.$('copypaste-current-code').textContent = code;
      ui.$('copypaste-download-time').textContent = new Date(result.timestamp).toLocaleString('vi-VN');

      ui.showToast('Download thành công! Đang tải lại cấu hình...', 'success');

      setTimeout(() => {
        load();
        ui.showToast('Đã áp dụng cấu hình mới', 'success');
      }, 500);
    } else {
      ui.showToast(`Download thất bại: ${result.error}`, 'error');
    }
  } catch (error) {
    ui.showToast(`Lỗi: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

module.exports = { init, load };

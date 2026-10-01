const { ipcRenderer } = require('electron');
const ui = require('../../ui');

let apps = [];
let selectedId = null;
let initialized = false;
let uptimeTimer = null;

const ACTIVE_STATUSES = new Set(['starting', 'running', 'stopping']);

function init() {
  if (initialized || !ui.$('app-runner-list')) return;
  initialized = true;

  ui.$('app-runner-add-file').addEventListener('click', () => pickTarget('file'));
  ui.$('app-runner-add-folder').addEventListener('click', () => pickTarget('folder'));
  ui.$('app-runner-refresh').addEventListener('click', load);
  ui.$('app-runner-search').addEventListener('input', renderList);
  ui.$('app-runner-list').addEventListener('click', handleListClick);
  ui.$('app-runner-form').addEventListener('submit', saveApp);
  ui.$('app-runner-modal-close').addEventListener('click', closeModal);
  ui.$('app-runner-modal-cancel').addEventListener('click', closeModal);
  ui.$('app-runner-modal').addEventListener('click', (event) => {
    if (event.target === ui.$('app-runner-modal')) closeModal();
  });
  ui.$('app-runner-detail-run').addEventListener('click', () => toggleRun(selectedId));
  ui.$('app-runner-detail-restart').addEventListener('click', () => runAction('restart', selectedId));
  ui.$('app-runner-detail-edit').addEventListener('click', () => openEdit(selectedId));
  ui.$('app-runner-clear-log').addEventListener('click', () => runAction('clear-log', selectedId));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.$('app-runner-modal').style.display !== 'none') closeModal();
  });

  ipcRenderer.on('app-runner-apps-changed', (_, incomingApps) => {
    mergeApps(incomingApps || []);
    render();
  });
  ipcRenderer.on('app-runner-state', (_, payload) => {
    updateProcess(payload?.id, payload?.process);
    render();
  });
  ipcRenderer.on('app-runner-log', (_, payload) => {
    const app = apps.find((item) => item.id === payload?.id);
    if (!app || !payload?.entry) return;
    app.process = app.process || {};
    app.process.logs = [...(app.process.logs || []), payload.entry].slice(-1000);
    if (selectedId === app.id) appendConsoleEntry(payload.entry);
  });
  ipcRenderer.on('app-runner-log-cleared', (_, payload) => {
    const app = apps.find((item) => item.id === payload?.id);
    if (app?.process) app.process.logs = [];
    if (selectedId === payload?.id) renderConsole(app);
  });

  uptimeTimer = setInterval(renderUptime, 1000);
  load();
}

async function load() {
  try {
    const incomingApps = await ipcRenderer.invoke('app-runner-list');
    mergeApps(incomingApps || []);
    if (selectedId && !apps.some((app) => app.id === selectedId)) selectedId = null;
    render();
    return apps;
  } catch (error) {
    ui.showToast(`Không tải được ứng dụng: ${error.message}`, 'error');
    return [];
  }
}

function mergeApps(incomingApps) {
  const existing = new Map(apps.map((app) => [app.id, app]));
  apps = incomingApps.map((app) => {
    const old = existing.get(app.id);
    const hasIncomingLogs = Array.isArray(app.process?.logs);
    return {
      ...old,
      ...app,
      process: {
        ...(old?.process || {}),
        ...(app.process || {}),
        logs: hasIncomingLogs ? app.process.logs : old?.process?.logs || []
      }
    };
  });
}

function updateProcess(id, processState) {
  const app = apps.find((item) => item.id === id);
  if (!app || !processState) return;
  app.process = { ...(app.process || {}), ...processState, logs: app.process?.logs || [] };
}

async function pickTarget(type) {
  const button = ui.$(type === 'folder' ? 'app-runner-add-folder' : 'app-runner-add-file');
  setBusy(button, true);
  try {
    const result = await ipcRenderer.invoke('app-runner-pick', type);
    if (!result?.cancelled) openModal(result.draft);
  } catch (error) {
    ui.showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function openModal(app = {}) {
  ui.$('app-runner-id').value = app.id || '';
  ui.$('app-runner-target').value = app.targetPath || '';
  ui.$('app-runner-name').value = app.name || '';
  ui.$('app-runner-runtime').value = app.runtime || '';
  ui.$('app-runner-cwd').value = app.workingDirectory || '';
  ui.$('app-runner-command').value = app.command || '';
  const note = ui.$('app-runner-detection-note');
  note.textContent = app.detectionNote || '';
  note.style.display = app.detectionNote ? '' : 'none';
  ui.$('app-runner-pinned').checked = !!app.pinned;
  ui.$('app-runner-modal-title').textContent = app.id ? 'Chỉnh sửa ứng dụng' : 'Thêm ứng dụng';
  ui.$('app-runner-modal').style.display = 'flex';
  ui.$('app-runner-name').focus();
  ui.$('app-runner-name').select();
}

function closeModal() {
  ui.$('app-runner-modal').style.display = 'none';
  ui.$('app-runner-form').reset();
}

async function saveApp(event) {
  event.preventDefault();
  const button = ui.$('app-runner-save');
  setBusy(button, true);
  try {
    const result = await ipcRenderer.invoke('app-runner-save', {
      id: ui.$('app-runner-id').value || null,
      targetPath: ui.$('app-runner-target').value,
      name: ui.$('app-runner-name').value.trim(),
      runtime: ui.$('app-runner-runtime').value.trim(),
      workingDirectory: ui.$('app-runner-cwd').value.trim(),
      command: ui.$('app-runner-command').value.trim(),
      pinned: ui.$('app-runner-pinned').checked
    });
    mergeApps(result.apps || []);
    selectedId = result.app.id;
    closeModal();
    render();
    ui.showToast('Đã lưu ứng dụng', 'success');
  } catch (error) {
    ui.showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function handleListClick(event) {
  const card = event.target.closest('.app-runner-card');
  if (!card) return;
  const app = apps.find((item) => item.id === card.dataset.id);
  if (!app) return;

  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) {
    select(app.id);
    return;
  }

  const action = actionButton.dataset.action;
  if (action === 'start-stop') return toggleRun(app.id);
  if (action === 'restart') return runAction('restart', app.id);
  if (action === 'pin') return togglePin(app);
  if (action === 'edit') return openModal(app);
  if (action === 'open') return runAction('open-target', app.id);
  if (action === 'delete') return deleteApp(app);
}

async function toggleRun(id) {
  const app = apps.find((item) => item.id === id);
  if (!app) return;
  return runAction(ACTIVE_STATUSES.has(app.process?.status) ? 'stop' : 'start', id);
}

async function runAction(action, id) {
  if (!id) return;
  const channel = `app-runner-${action}`;
  try {
    const result = await ipcRenderer.invoke(channel, id);
    if (result?.app) mergeApps([result.app, ...apps.filter((app) => app.id !== result.app.id)]);
    if (result?.process) updateProcess(id, result.process);
    if (result?.apps) mergeApps(result.apps);
    selectedId = id;
    render();
  } catch (error) {
    ui.showToast(error.message, 'error');
  }
}

async function togglePin(app) {
  try {
    const result = await ipcRenderer.invoke('app-runner-toggle-pin', { id: app.id, pinned: !app.pinned });
    mergeApps(result.apps || []);
    render();
    ui.showToast(app.pinned ? 'Đã bỏ ghim ứng dụng' : 'Đã ghim lên Dashboard', 'success');
  } catch (error) {
    ui.showToast(error.message, 'error');
  }
}

async function deleteApp(app) {
  if (!confirm(`Xóa ứng dụng "${app.name}"? Tiến trình đang chạy sẽ bị dừng.`)) return;
  try {
    const result = await ipcRenderer.invoke('app-runner-delete', app.id);
    mergeApps(result.apps || []);
    if (selectedId === app.id) selectedId = null;
    render();
    ui.showToast('Đã xóa ứng dụng', 'success');
  } catch (error) {
    ui.showToast(error.message, 'error');
  }
}

function render() {
  renderList();
  renderDetail();
  renderCounts();
}

function renderCounts() {
  ui.$('app-runner-count').textContent = `${apps.length} ứng dụng`;
  const running = apps.filter((app) => ACTIVE_STATUSES.has(app.process?.status)).length;
  ui.$('app-runner-running-count').textContent = `${running} đang chạy`;
}

function renderList() {
  const list = ui.$('app-runner-list');
  const query = String(ui.$('app-runner-search')?.value || '').trim().toLocaleLowerCase('vi');
  const filtered = apps.filter((app) => !query || `${app.name} ${app.runtime} ${app.command}`.toLocaleLowerCase('vi').includes(query));

  if (!filtered.length) {
    list.innerHTML = `
      <div class="app-runner-empty">
        <div class="app-runner-empty-icon">&gt;_</div>
        <h3>${apps.length ? 'Không tìm thấy ứng dụng' : 'Chưa có ứng dụng'}</h3>
        <p>${apps.length ? 'Thử từ khóa khác.' : 'Thêm file hoặc thư mục để sinh lệnh chạy tự động.'}</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map((app) => renderCard(app)).join('');
}

function renderCard(app) {
  const processState = app.process || {};
  const status = processState.status || 'stopped';
  const active = ACTIVE_STATUSES.has(status);
  const selected = selectedId === app.id;
  return `
    <article class="app-runner-card ${selected ? 'is-selected' : ''} ${active ? 'is-running' : ''}" data-id="${escapeAttr(app.id)}">
      <div class="app-runner-card-head">
        <div class="app-runner-runtime-icon">${runtimeLabel(app.runtime)}</div>
        <div class="app-runner-card-copy">
          <div class="app-runner-card-title-row">
            <h3>${ui.escapeHtml(app.name)}</h3>
            ${app.pinned ? '<span class="app-runner-pinned">Pinned</span>' : ''}
          </div>
          <span class="app-runner-runtime-label">${ui.escapeHtml(app.runtime || 'Custom')}</span>
        </div>
        ${renderStatus(status)}
      </div>
      <code class="app-runner-card-command">${ui.escapeHtml(app.command)}</code>
      <div class="app-runner-card-meta">
        <span>PID ${processState.pid || '--'}</span>
        <span data-uptime-id="${escapeAttr(app.id)}">${formatDuration(getDuration(processState))}</span>
      </div>
      <div class="app-runner-card-actions">
        <div>
          <button class="btn ${active ? 'btn-danger' : 'btn-primary'} btn-sm" type="button" data-action="start-stop">${active ? 'Dừng' : 'Chạy'}</button>
          <button class="btn btn-secondary btn-sm" type="button" data-action="restart">Restart</button>
        </div>
        <div>
          <button class="btn-icon btn-secondary btn-sm ${app.pinned ? 'is-active' : ''}" type="button" data-action="pin" title="${app.pinned ? 'Bỏ ghim' : 'Ghim'}" aria-label="${app.pinned ? 'Bỏ ghim' : 'Ghim'}">${pinIcon(app.pinned)}</button>
          <button class="btn-icon btn-secondary btn-sm" type="button" data-action="open" title="Mở vị trí" aria-label="Mở vị trí">${folderIcon()}</button>
          <button class="btn-icon btn-secondary btn-sm" type="button" data-action="edit" title="Sửa" aria-label="Sửa">${editIcon()}</button>
          <button class="btn-icon btn-danger btn-sm" type="button" data-action="delete" title="Xóa" aria-label="Xóa">${deleteIcon()}</button>
        </div>
      </div>
    </article>`;
}

function renderDetail() {
  const app = apps.find((item) => item.id === selectedId);
  ui.$('app-runner-detail-empty').style.display = app ? 'none' : 'flex';
  ui.$('app-runner-detail').style.display = app ? '' : 'none';
  if (!app) return;

  const processState = app.process || {};
  const status = processState.status || 'stopped';
  const active = ACTIVE_STATUSES.has(status);
  ui.$('app-runner-detail-icon').textContent = runtimeLabel(app.runtime);
  ui.$('app-runner-detail-name').textContent = app.name;
  ui.$('app-runner-detail-target').textContent = app.targetPath;
  ui.$('app-runner-detail-runtime').textContent = app.runtime || 'Custom';
  ui.$('app-runner-detail-pid').textContent = processState.pid || '--';
  ui.$('app-runner-detail-command').textContent = app.command;
  ui.$('app-runner-detail-status').outerHTML = renderStatus(status, 'app-runner-detail-status');
  ui.$('app-runner-detail-run').textContent = active ? 'Dừng' : 'Chạy';
  ui.$('app-runner-detail-run').className = `btn ${active ? 'btn-danger' : 'btn-primary'}`;
  ui.$('app-runner-detail-restart').disabled = status === 'stopping';
  renderUptime();
  renderConsole(app);
}

function renderConsole(app) {
  const consoleEl = ui.$('app-runner-console');
  consoleEl.innerHTML = '';
  const logs = app?.process?.logs || [];
  if (!logs.length) {
    consoleEl.innerHTML = '<div class="app-runner-console-placeholder">Log sẽ xuất hiện khi ứng dụng chạy.</div>';
    return;
  }
  logs.forEach((entry) => appendConsoleEntry(entry, false));
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function appendConsoleEntry(entry, scroll = true) {
  const consoleEl = ui.$('app-runner-console');
  consoleEl.querySelector('.app-runner-console-placeholder')?.remove();
  const row = document.createElement('div');
  row.className = `app-runner-log-line ${entry.stream || 'stdout'}`;
  const time = document.createElement('span');
  time.className = 'app-runner-log-time';
  time.textContent = new Date(entry.timestamp || Date.now()).toLocaleTimeString('vi-VN', { hour12: false });
  const text = document.createElement('span');
  text.className = 'app-runner-log-text';
  text.textContent = entry.text;
  row.append(time, text);
  consoleEl.appendChild(row);
  while (consoleEl.children.length > 1000) consoleEl.firstElementChild.remove();
  if (scroll) consoleEl.scrollTop = consoleEl.scrollHeight;
}

function select(id) {
  selectedId = id;
  render();
}

async function focus(id) {
  await load();
  if (apps.some((app) => app.id === id)) select(id);
}

function openEdit(id) {
  const app = apps.find((item) => item.id === id);
  if (app) openModal(app);
}

function renderUptime() {
  apps.forEach((app) => {
    const element = document.querySelector(`[data-uptime-id="${cssEscape(app.id)}"]`);
    if (element) element.textContent = formatDuration(getDuration(app.process || {}));
  });
  const app = apps.find((item) => item.id === selectedId);
  if (app && ui.$('app-runner-detail-uptime')) {
    ui.$('app-runner-detail-uptime').textContent = formatDuration(getDuration(app.process || {}));
  }
}

function getDuration(processState) {
  if (processState.startedAt && ACTIVE_STATUSES.has(processState.status)) return Date.now() - processState.startedAt;
  return processState.durationMs || 0;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${rest}`;
}

function renderStatus(status, id = '') {
  const labels = { starting: 'Đang khởi động', running: 'Đang chạy', stopping: 'Đang dừng', stopped: 'Đã dừng', error: 'Lỗi' };
  return `<span ${id ? `id="${id}"` : ''} class="app-runner-state ${status}"><span class="status-dot ${status === 'stopping' ? 'starting' : status}"></span><span>${labels[status] || labels.stopped}</span></span>`;
}

function runtimeLabel(runtime = '') {
  const key = runtime.toLowerCase();
  if (key.includes('python')) return 'PY';
  if (key.includes('node') || key.includes('npm') || key.includes('react') || key.includes('vue') || key.includes('vite') || key.includes('next')) return 'JS';
  if (key.includes('bun')) return 'BN';
  if (key.includes('go')) return 'GO';
  if (key.includes('rust') || key.includes('cargo')) return 'RS';
  if (key.includes('kotlin')) return 'KT';
  if (key.includes('java')) return 'JV';
  if (key.includes('php')) return 'PHP';
  if (key.includes('ruby')) return 'RB';
  if (key.includes('flutter') || key.includes('dart')) return 'DART';
  if (key.includes('c/c++') || key.includes('cmake')) return 'C++';
  if (key.includes('power')) return 'PS';
  if (key.includes('.net')) return 'NET';
  if (key.includes('batch') || key.includes('command')) return 'CMD';
  if (key.includes('shell')) return 'SH';
  if (key.includes('windows')) return 'EXE';
  return '>_';
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('loading', busy);
}

function escapeAttr(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cssEscape(value) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function pinIcon(active) {
  return `<svg width="14" height="14" viewBox="0 0 20 20" fill="${active ? 'currentColor' : 'none'}" stroke="currentColor"><path d="M10 2l2.5 5 5.5.5-4 3.5 1 5.5-5-3-5 3 1-5.5-4-3.5 5.5-.5L10 2z"/></svg>`;
}

function folderIcon() {
  return '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z"/></svg>';
}

function editIcon() {
  return '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>';
}

function deleteIcon() {
  return '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9z" clip-rule="evenodd"/></svg>';
}

module.exports = { init, load, focus };

const { ipcRenderer } = require('electron');
const ui = require('../ui');

let apps = [];
let navigation = null;
let initialized = false;
const ACTIVE_STATUSES = new Set(['starting', 'running', 'stopping']);

function configure(options) {
  navigation = options;
}

function init() {
  if (initialized) return;
  initialized = true;

  ui.$('dashboard-app-grid')?.addEventListener('click', handleGridClick);
  ui.$('dashboard-open-app-runner')?.addEventListener('click', () => navigation?.switchView('appRunner'));

  ipcRenderer.on('app-runner-apps-changed', (_, incomingApps) => {
    mergeApps(incomingApps || []);
    render();
  });
  ipcRenderer.on('app-runner-state', (_, payload) => {
    const app = apps.find((item) => item.id === payload?.id);
    if (app && payload.process) app.process = { ...(app.process || {}), ...payload.process };
    render();
  });

  load();
}

async function load() {
  try {
    mergeApps(await ipcRenderer.invoke('app-runner-list'));
    render();
  } catch (error) {
    ui.showToast(`Không tải được ứng dụng ghim: ${error.message}`, 'error');
  }
}

function mergeApps(incomingApps = []) {
  const oldApps = new Map(apps.map((app) => [app.id, app]));
  apps = incomingApps.map((app) => ({
    ...oldApps.get(app.id),
    ...app,
    process: { ...(oldApps.get(app.id)?.process || {}), ...(app.process || {}) }
  }));
}

function render() {
  const section = ui.$('dashboard-pinned-apps');
  const grid = ui.$('dashboard-app-grid');
  if (!section || !grid) return;

  const pinned = apps.filter((app) => app.pinned);
  section.style.display = pinned.length ? '' : 'none';
  grid.innerHTML = pinned.map((app) => {
    const status = app.process?.status || 'stopped';
    const active = ACTIVE_STATUSES.has(status);
    return `
      <article class="dashboard-app-card ${active ? 'is-running' : ''}" data-id="${escapeAttr(app.id)}" tabindex="0" role="button" aria-label="Mở ${escapeAttr(app.name)}">
        <div class="dashboard-app-top">
          <div class="dashboard-app-icon">${runtimeLabel(app.runtime)}</div>
          <span class="app-runner-state ${status}"><span class="status-dot ${status === 'stopping' ? 'starting' : status}"></span>${active ? 'Đang chạy' : status === 'error' ? 'Lỗi' : 'Đã dừng'}</span>
        </div>
        <div class="dashboard-app-copy">
          <h3>${ui.escapeHtml(app.name)}</h3>
          <p>${ui.escapeHtml(app.runtime || 'Custom')}</p>
          <code>${ui.escapeHtml(app.command)}</code>
        </div>
        <div class="dashboard-app-footer">
          <span>PID ${app.process?.pid || '--'}</span>
          <button class="btn ${active ? 'btn-danger' : 'btn-primary'} btn-sm" type="button" data-action="toggle-run">${active ? 'Dừng' : 'Chạy'}</button>
        </div>
      </article>`;
  }).join('');
}

async function handleGridClick(event) {
  const card = event.target.closest('.dashboard-app-card');
  if (!card) return;
  const app = apps.find((item) => item.id === card.dataset.id);
  if (!app) return;

  if (!event.target.closest('[data-action="toggle-run"]')) {
    navigation?.focusApp(app.id);
    return;
  }

  event.stopPropagation();
  const active = ACTIVE_STATUSES.has(app.process?.status);
  const button = event.target.closest('button');
  button.disabled = true;
  try {
    const result = await ipcRenderer.invoke(active ? 'app-runner-stop' : 'app-runner-start', app.id);
    if (result?.process) app.process = result.process;
    render();
  } catch (error) {
    ui.showToast(error.message, 'error');
    button.disabled = false;
  }
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

function escapeAttr(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { configure, init, load };

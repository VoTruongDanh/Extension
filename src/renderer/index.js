const { ipcRenderer } = require('electron');

const ui = require('./ui');
const dashboard = require('./views/dashboard');
const logsView = require('./views/logs');
const settingsView = require('./views/settings');
const shutdownView = require('./views/tools/shutdown');
const networkView = require('./views/tools/network');
const hardwareView = require('./views/tools/hardware');
const killportView = require('./views/tools/killport');
const idmResetView = require('./views/tools/idm-reset');
const anydeskView = require('./views/tools/anydesk-reset');
const promptsView = require('./views/tools/prompts');
const linksView = require('./views/tools/links');
const routerView = require('./views/router');
const openclawView = require('./views/openclaw');
const schedulerView = require('./views/scheduler');
const logPanel = require('./components/logPanel');
const commandPalette = require('./components/commandPalette');
const { initThemeToggle } = require('./bootstrap/theme');
const { createNavigator } = require('./bootstrap/navigation');

const views = {
  dashboard: ui.$('view-dashboard'),
  router: ui.$('view-router'),
  openclaw: ui.$('view-openclaw'),
  logs: ui.$('view-logs'),
  settings: ui.$('view-settings'),
  shutdown: ui.$('view-shutdown'),
  scheduler: ui.$('view-scheduler'),
  network: ui.$('view-network'),
  hardware: ui.$('view-hardware'),
  killport: ui.$('view-killport'),
  idmReset: ui.$('view-idm-reset'),
  prompts: ui.$('view-prompts'),
  links: ui.$('view-links'),
};

const viewLoaders = {
  settings: () => settingsView.load(),
  network: () => networkView.load(),
  hardware: () => hardwareView.load(),
  killport: () => killportView.load(),
  prompts: () => promptsView.load(),
  links: () => linksView.load(),
  scheduler: () => schedulerView.render(),
};

const modules = [
  dashboard,
  logsView,
  settingsView,
  shutdownView,
  schedulerView,
  networkView,
  hardwareView,
  killportView,
  idmResetView,
  anydeskView,
  promptsView,
  linksView,
  routerView,
  openclawView,
];

const navMap = {
  'nav-dashboard': 'dashboard',
  'nav-router': 'router',
  'nav-openclaw': 'openclaw',
  'nav-logs': 'logs',
  'nav-settings': 'settings',
  'nav-shutdown': 'shutdown',
  'nav-scheduler': 'scheduler',
  'nav-network': 'network',
  'nav-hardware': 'hardware',
  'nav-killport': 'killport',
  'nav-idm-reset': 'idmReset',
  'nav-prompts': 'prompts',
  'nav-links': 'links',
};

function markAppReady() {
  const body = document.body;
  if (!body || body.classList.contains('app-ready')) return;

  body.classList.add('app-ready');
  body.classList.remove('app-loading');
}

function initQuickLinks() {
  // Quick links đã được xóa khỏi sidebar, không còn cần init
}

function initModules() {
  modules.forEach((moduleRef) => {
    if (moduleRef && typeof moduleRef.init === 'function') {
      moduleRef.init();
    }
  });
}

function initShell() {
  initThemeToggle({
    root: document.documentElement,
    storage: localStorage,
    toggleButton: ui.$('theme-toggle'),
  });

  const { bindNavigation, switchView } = createNavigator({
    ui,
    views,
    onViewEnter(name) {
      const loadView = viewLoaders[name];
      if (loadView) loadView();
    },
  });

  bindNavigation(navMap);
  switchView('dashboard'); // Ẩn tất cả view khác, chỉ hiện dashboard
  initQuickLinks();
  initModules();

  logPanel.initLogPanels(['router', 'openclaw']);
  logPanel.initLogFilters();
  ui.initRipple();
  ui.initSkeletons(['router', 'openclaw']);
  commandPalette.init({ ipcRenderer, switchView, loadSettings: settingsView.load });

  ipcRenderer.send('check-status');
  ipcRenderer.send('get-app-version');

  requestAnimationFrame(() => {
    setTimeout(markAppReady, 2000);
  });
}

initShell();

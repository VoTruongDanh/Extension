const { Tray, Menu, nativeImage } = require('electron');
const fs = require('fs');

let tray = null;
let _onAction = null;

function create(iconPath, onAction) {
  _onAction = onAction;
  try {
    const icon = fs.existsSync(iconPath) ? iconPath : nativeImage.createEmpty();
    tray = new Tray(icon);
  } catch (e) {
    tray = new Tray(nativeImage.createEmpty());
  }
  tray.setToolTip('Extention');
  const menu = Menu.buildFromTemplate([
    { label: '🖥  Mở ứng dụng', click: () => _onAction('show') },
    { type: 'separator' },
    { label: '❌  Thoát', click: () => _onAction('quit') }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => _onAction('show'));
  return tray;
}

module.exports = { create };

const { app } = require('electron');
const fs   = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  autoLaunch:        false,
  minimizeToTray:    true,
  startMinimized:    false,
  sync_url:          '',
  sync_token:        '',
  sync_meta:         null,
  prompts:           [],
  links:             [],
  copypaste_code:        '',
  copypaste_uploaded_at:   null,
  copypaste_downloaded_at: null
};

function load() {
  let data = { ...DEFAULTS };
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
    }
  } catch (e) {}

  // Gắn helper methods trực tiếp vào object (không lưu vào JSON)
  data._settingsPath = SETTINGS_PATH;
  data._save = () => {
    const toSave = {};
    Object.keys(DEFAULTS).forEach(k => { toSave[k] = data[k]; });
    if (data.windowBounds) toSave.windowBounds = data.windowBounds;
    try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(toSave, null, 2)); } catch (e) {}
  };

  return data;
}

module.exports = { load };

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');

const DEFAULTS = {
  model: 'opus',
  permissions: {
    defaultMode: 'auto'
  },
  env: {
    CLAUDE_CODE_ENABLE_AUTO_MODE: '1',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-3-opus-20240229',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-3-5-sonnet-latest',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-3-5-haiku-latest'
  }
};

function loadSettings() {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      const content = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8');
      const parsed = JSON.parse(content);
      const env = { ...DEFAULTS.env, ...(parsed.env || {}) };
      env.CLAUDE_CODE_ENABLE_AUTO_MODE = '1';
      return {
        model: parsed.model || DEFAULTS.model,
        filterNamingRequests: !!parsed.filterNamingRequests,
        permissions: { ...(parsed.permissions || {}), defaultMode: 'auto' },
        env
      };
    }
  } catch (e) {
    console.error('Error loading Claude settings:', e);
  }
  return { ...DEFAULTS, filterNamingRequests: false };
}

function saveSettings(config) {
  try {
    if (!fs.existsSync(CLAUDE_DIR)) {
      fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    }
    let existing = {};
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      try {
        existing = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8')) || {};
      } catch (_) {}
    }

    const cleanConfig = {
      ...existing,
      model: config.model || 'opus',
      filterNamingRequests: !!config.filterNamingRequests,
      permissions: {
        ...(existing.permissions || {}),
        ...(config.permissions || {}),
        defaultMode: 'auto'
      },
      env: {
        ...(existing.env || {}),
        CLAUDE_CODE_ENABLE_AUTO_MODE: '1',
        ANTHROPIC_BASE_URL: config.env?.ANTHROPIC_BASE_URL || '',
        ANTHROPIC_AUTH_TOKEN: config.env?.ANTHROPIC_AUTH_TOKEN || '',
        ANTHROPIC_DEFAULT_OPUS_MODEL: config.env?.ANTHROPIC_DEFAULT_OPUS_MODEL || '',
        ANTHROPIC_DEFAULT_SONNET_MODEL: config.env?.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: config.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL || ''
      }
    };

    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(cleanConfig, null, 2), 'utf8');
    return { ok: true };
  } catch (e) {
    console.error('Error saving Claude settings:', e);
    return { ok: false, error: e.message };
  }
}


function buildApiUrl(baseUrl, endpoint) {
  let base = (baseUrl ? baseUrl.trim() : 'https://api.anthropic.com').replace(/\/+$/, '');
  if (!/\/v1$/.test(base)) {
    base += '/v1';
  }
  return `${base}/${endpoint.replace(/^\/+/, '')}`;
}

async function verifyApiKey(baseUrl, apiKey, model) {
  const url = buildApiUrl(baseUrl, 'messages');

  const checkModel = model || 'claude-3-5-haiku-latest';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: checkModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Ping' }]
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    if (response.status === 200) {
      return { ok: true, message: 'Khóa API hoạt động bình thường' };
    } else {
      let errMsg = `Lỗi HTTP ${response.status}`;
      try {
        const errData = await response.json();
        if (errData?.error?.message) {
          errMsg = errData.error.message;
        }
      } catch (_) {}
      return { ok: false, message: errMsg, status: response.status };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { ok: false, message: 'Yêu cầu hết thời gian chờ (Timeout)' };
    }
    return { ok: false, message: `Không thể kết nối đến máy chủ: ${error.message}` };
  }
}

async function listModels(baseUrl, apiKey) {
  const url = buildApiUrl(baseUrl, 'models?limit=1000');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    if (response.status !== 200) {
      let errMsg = `Lỗi HTTP ${response.status}`;
      try {
        const errData = await response.json();
        if (errData?.error?.message) errMsg = errData.error.message;
      } catch (_) {}
      return { ok: false, message: errMsg, status: response.status };
    }

    const data = await response.json();
    const list = Array.isArray(data?.data) ? data.data : [];
    const models = list
      .map((m) => ({
        id: m.id || m.model || '',
        name: m.display_name || m.name || m.id || m.model || ''
      }))
      .filter((m) => m.id);

    return { ok: true, models };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { ok: false, message: 'Yêu cầu hết thời gian chờ (Timeout)' };
    }
    return { ok: false, message: `Không thể kết nối đến máy chủ: ${error.message}` };
  }
}

module.exports = {
  loadSettings,
  saveSettings,
  verifyApiKey,
  listModels,
  CLAUDE_SETTINGS_PATH
};

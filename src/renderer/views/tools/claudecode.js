const { ipcRenderer } = require('electron');
const ui = require('../../ui');

let originalSettings = null;

async function load() {
  ui.showProgress('claude');
  showAlert('Đang tải cấu hình...', 'info');

  try {
    const { config, path } = await ipcRenderer.invoke('claude-get-settings');
    originalSettings = config;

    const env = config.env || {};
    
    const baseUrl = env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    const selectEl = ui.$('claude-endpoint-select');
    const customRow = ui.$('claude-custom-url-row');
    const customInput = ui.$('claude-custom-url');

    let endpointMatched = false;
    for (let option of selectEl.options) {
      if (option.value === baseUrl) {
        selectEl.value = baseUrl;
        endpointMatched = true;
        break;
      }
    }

    if (!endpointMatched) {
      selectEl.value = 'custom';
      customInput.value = baseUrl;
      customRow.style.display = 'flex';
    } else {
      customRow.style.display = 'none';
      customInput.value = '';
    }

    updateCurrentEndpointDisplay(baseUrl);

    ui.$('claude-api-key').value = env.ANTHROPIC_AUTH_TOKEN || '';

    ui.$('claude-model-opus').value = env.ANTHROPIC_DEFAULT_OPUS_MODEL || '';
    ui.$('claude-model-sonnet').value = env.ANTHROPIC_DEFAULT_SONNET_MODEL || '';
    ui.$('claude-model-haiku').value = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '';

    ui.$('claude-filter-naming').checked = !!config.filterNamingRequests;

    await checkConnectionStatus(baseUrl, env.ANTHROPIC_AUTH_TOKEN, env.ANTHROPIC_DEFAULT_HAIKU_MODEL);
    
    dismissAlert();
  } catch (error) {
    showAlert(`Lỗi tải cấu hình: ${error.message}`, 'error');
  } finally {
    ui.hideProgress('claude');
  }
}

function updateCurrentEndpointDisplay(url) {
  const currentEl = ui.$('claude-current-endpoint');
  if (currentEl) {
    currentEl.textContent = url || 'https://api.anthropic.com';
  }
}

async function checkConnectionStatus(baseUrl, apiKey, model) {
  const dot = ui.$('claude-status-dot');
  const text = ui.$('claude-status-text');
  const connectedBadge = ui.$('claude-connected-badge');
  const connectionBadge = ui.$('claude-connection-status');

  if (!apiKey) {
    ui.setStatus(connectionBadge, 'stopped', 'Chưa cấu hình API Key');
    if (connectedBadge) connectedBadge.style.display = 'none';
    return;
  }

  ui.setStatus(connectionBadge, 'starting', 'Đang xác thực...');

  const result = await ipcRenderer.invoke('claude-check-key', { baseUrl, apiKey, model });

  const isCustom = baseUrl && baseUrl !== 'https://api.anthropic.com';
  const sourceLabel = isCustom ? 'Custom API' : 'Gốc';

  if (result.ok) {
    ui.setStatus(connectionBadge, 'running', `Đã kết nối (${sourceLabel})`);
    if (connectedBadge) {
      connectedBadge.style.display = 'inline-flex';
      connectedBadge.textContent = `Đã kết nối (${sourceLabel})`;
    }
  } else {
    ui.setStatus(connectionBadge, 'error', `Lỗi kết nối (${sourceLabel})`);
    if (connectedBadge) connectedBadge.style.display = 'none';
    showAlert(`Lỗi xác thực API Key: ${result.message}`, 'error');
  }
}

function showAlert(message, type = 'info') {
  const alertEl = ui.$('claude-alert');
  const alertText = ui.$('claude-alert-text');
  if (!alertEl || !alertText) return;

  alertText.textContent = message;
  alertEl.className = `alert alert-${type}`;
  alertEl.style.display = 'flex';
}

function dismissAlert() {
  const alertEl = ui.$('claude-alert');
  if (alertEl) {
    alertEl.style.display = 'none';
  }
}

function init() {
  const toggleBtn = ui.$('claude-toggle-card');
  const cardBody = ui.$('claude-card-body');
  const cardHeader = document.querySelector('.claude-card-header');
  if (cardHeader && cardBody && toggleBtn) {
    cardHeader.style.cursor = 'pointer';
    cardHeader.addEventListener('click', (e) => {
      if (e.target.closest('button') && e.target.closest('button') !== toggleBtn) return;
      const isCollapsed = cardBody.classList.toggle('collapsed');
      toggleBtn.classList.toggle('collapsed', isCollapsed);
    });
  }

  const selectEl = ui.$('claude-endpoint-select');
  const customRow = ui.$('claude-custom-url-row');
  const customInput = ui.$('claude-custom-url');

  if (selectEl) {
    selectEl.addEventListener('change', () => {
      const val = selectEl.value;
      if (val === 'custom') {
        customRow.style.display = 'flex';
        updateCurrentEndpointDisplay(customInput.value);
      } else {
        customRow.style.display = 'none';
        updateCurrentEndpointDisplay(val);
      }
    });
  }

  if (customInput) {
    customInput.addEventListener('input', () => {
      updateCurrentEndpointDisplay(customInput.value);
    });
  }

  setupPresetDropdown('claude-select-opus-btn', 'claude-preset-opus', 'claude-model-opus');
  setupPresetDropdown('claude-select-sonnet-btn', 'claude-preset-sonnet', 'claude-model-sonnet');
  setupPresetDropdown('claude-select-haiku-btn', 'claude-preset-haiku', 'claude-model-haiku');

  setupClearButton('claude-clear-opus', 'claude-model-opus');
  setupClearButton('claude-clear-sonnet', 'claude-model-sonnet');
  setupClearButton('claude-clear-haiku', 'claude-model-haiku');

  const applyBtn = ui.$('claude-apply-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      applyBtn.classList.add('loading');
      ui.showProgress('claude');
      showAlert('Đang lưu cấu hình...', 'info');

      try {
        let baseUrl = selectEl.value;
        if (baseUrl === 'custom') {
          baseUrl = customInput.value.trim();
        }

        const apiKey = ui.$('claude-api-key').value.trim();
        const opusModel = ui.$('claude-model-opus').value.trim();
        const sonnetModel = ui.$('claude-model-sonnet').value.trim();
        const haikuModel = ui.$('claude-model-haiku').value.trim();
        const filterNaming = ui.$('claude-filter-naming').checked;

        const config = {
          model: 'opus',
          filterNamingRequests: filterNaming,
          env: {
            ANTHROPIC_BASE_URL: baseUrl,
            ANTHROPIC_AUTH_TOKEN: apiKey,
            ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
            ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel
          }
        };

        const result = await ipcRenderer.invoke('claude-save-settings', config);
        if (result.ok) {
          originalSettings = config;
          ui.showToast('Đã áp dụng cấu hình Claude Code', 'success');
          
          await checkConnectionStatus(baseUrl, apiKey, haikuModel);
        } else {
          showAlert(`Lỗi lưu cấu hình: ${result.error}`, 'error');
        }
      } catch (error) {
        showAlert(`Lỗi: ${error.message}`, 'error');
      } finally {
        applyBtn.classList.remove('loading');
        ui.hideProgress('claude');
      }
    });
  }

  const resetBtn = ui.$('claude-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (originalSettings) {
        load();
        ui.showToast('Đã đặt lại cấu hình', 'info');
      }
    });
  }

  const manualBtn = ui.$('claude-manual-btn');
  if (manualBtn) {
    manualBtn.addEventListener('click', () => {
      ipcRenderer.invoke('claude-open-file');
    });
  }
}

let modelCache = { key: null, models: null };

function getCurrentCreds() {
  const selectEl = ui.$('claude-endpoint-select');
  const customInput = ui.$('claude-custom-url');
  let baseUrl = selectEl ? selectEl.value : '';
  if (baseUrl === 'custom') baseUrl = customInput ? customInput.value.trim() : '';
  const apiKey = ui.$('claude-api-key').value.trim();
  return { baseUrl, apiKey };
}

function setStatus(dropdown, text) {
  dropdown.querySelector('.claude-preset-list').innerHTML =
    `<div class="claude-preset-status">${text}</div>`;
}

function renderList(dropdown, input, models, filter) {
  const listEl = dropdown.querySelector('.claude-preset-list');
  const current = input.value.trim();
  const q = (filter || '').toLowerCase();

  const matches = (models || []).filter((m) => {
    if (!q) return true;
    return m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q);
  });

  if (matches.length === 0) {
    listEl.innerHTML = `<div class="claude-preset-status">${models && models.length ? 'Không khớp từ khóa' : 'Không tìm thấy model nào'}</div>`;
    return;
  }

  listEl.innerHTML = '';
  matches.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'claude-preset-item' + (m.id === current ? ' selected' : '');
    item.dataset.val = m.id;
    if (m.name && m.name !== m.id) {
      item.innerHTML = `<span class="claude-preset-name">${m.name}</span><span class="claude-preset-id">${m.id}</span>`;
    } else {
      item.textContent = m.id;
    }
    listEl.appendChild(item);
  });
}

async function fetchModelsInto(dropdown, input) {
  const { baseUrl, apiKey } = getCurrentCreds();
  const cacheKey = `${baseUrl}::${apiKey}`;
  const search = dropdown.querySelector('.claude-preset-search');
  if (search) search.value = '';

  if (!apiKey) {
    setStatus(dropdown, 'Nhập API Key để tải danh sách model');
    return;
  }

  if (modelCache.key === cacheKey && modelCache.models) {
    renderList(dropdown, input, modelCache.models, '');
    return;
  }

  setStatus(dropdown, 'Đang tải danh sách model...');

  try {
    const result = await ipcRenderer.invoke('claude-list-models', { baseUrl, apiKey });
    if (result.ok) {
      modelCache = { key: cacheKey, models: result.models };
      renderList(dropdown, input, result.models, '');
    } else {
      setStatus(dropdown, `Lỗi tải model: ${result.message}`);
    }
  } catch (e) {
    setStatus(dropdown, `Lỗi: ${e.message}`);
  }
}

function setupPresetDropdown(btnId, dropdownId, inputId) {
  const btn = ui.$(btnId);
  const dropdown = ui.$(dropdownId);
  const input = ui.$(inputId);

  if (!btn || !dropdown || !input) return;

  dropdown.innerHTML =
    '<div class="claude-preset-search-row">' +
    '<input type="text" class="claude-preset-search" placeholder="Tìm model...">' +
    '<button class="claude-preset-refresh" title="Tải lại">&#8635;</button>' +
    '</div>' +
    '<div class="claude-preset-list"></div>';

  const search = dropdown.querySelector('.claude-preset-search');
  const refresh = dropdown.querySelector('.claude-preset-refresh');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.claude-preset-dropdown').forEach(d => {
      if (d.id !== dropdownId) d.style.display = 'none';
    });
    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      fetchModelsInto(dropdown, input).then(() => search.focus());
    }
  });

  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.claude-preset-item');
    if (item) {
      input.value = item.dataset.val;
      dropdown.style.display = 'none';
    }
  });

  search.addEventListener('input', () => {
    renderList(dropdown, input, modelCache.models || [], search.value);
  });

  refresh.addEventListener('click', () => {
    modelCache = { key: null, models: null };
    fetchModelsInto(dropdown, input).then(() => search.focus());
  });

  document.addEventListener('click', () => {
    dropdown.style.display = 'none';
  });
}

function setupClearButton(btnId, inputId) {
  const btn = ui.$(btnId);
  const input = ui.$(inputId);
  if (btn && input) {
    btn.addEventListener('click', () => {
      input.value = '';
    });
  }
}

module.exports = {
  init,
  load
};

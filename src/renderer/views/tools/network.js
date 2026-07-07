const { ipcRenderer } = require('electron');
const ui = require('../../ui');

let adapters = [];
let refreshInterval = null;

function init() {
  const refreshBtn = ui.$('network-refresh-btn');
  const flushDNSBtn = ui.$('network-flush-dns-btn');
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', load);
  }
  
  if (flushDNSBtn) {
    flushDNSBtn.addEventListener('click', handleFlushDNS);
  }
  
  const list = ui.$('network-list');
  if (list) {
    list.addEventListener('click', handleListClick);
  }
  
  // IP modal close button
  const ipModalClose = ui.$('network-ip-modal-close');
  const ipModal = ui.$('network-ip-modal');
  if (ipModalClose && ipModal) {
    ipModalClose.addEventListener('click', () => {
      ipModal.style.display = 'none';
    });
    ipModal.addEventListener('click', (e) => {
      if (e.target === ipModal) {
        ipModal.style.display = 'none';
      }
    });
  }
  
  // Auto-refresh every 10 seconds, chỉ chạy khi view network đang hiển thị
  refreshInterval = setInterval(() => {
    const view = ui.$('view-network');
    if (view && view.style.display !== 'none') load();
  }, 10000);
}

async function load() {
  const refreshBtn = ui.$('network-refresh-btn');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('loading');
  }
  
  try {
    adapters = await ipcRenderer.invoke('network-get-adapters');
    
    // Load IP for each adapter
    for (const adapter of adapters) {
      try {
        const ips = await ipcRenderer.invoke('network-get-ip-config', adapter.name);
        adapter.ips = ips || [];
      } catch (error) {
        adapter.ips = [];
      }
    }
    
    render();
  } catch (error) {
    ui.showToast(`Không tải được adapters: ${error.message}`, 'error');
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('loading');
    }
  }
}

async function handleFlushDNS() {
  const btn = ui.$('network-flush-dns-btn');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('loading');
  }
  
  try {
    const result = await ipcRenderer.invoke('network-flush-dns');
    ui.showToast(result.message, 'success');
  } catch (error) {
    ui.showToast(error.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  }
}

async function handleListClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  
  const card = actionEl.closest('.network-adapter-card');
  if (!card) return;
  
  const adapterName = card.dataset.name;
  const adapter = adapters.find(a => a.name === adapterName);
  if (!adapter) return;
  
  const action = actionEl.dataset.action;
  
  // Disable button during action
  actionEl.disabled = true;
  actionEl.classList.add('loading');
  
  try {
    let result;
    
    switch (action) {
      case 'enable':
        result = await ipcRenderer.invoke('network-enable-adapter', adapterName);
        break;
      case 'disable':
        result = await ipcRenderer.invoke('network-disable-adapter', adapterName);
        break;
      case 'reset':
        result = await ipcRenderer.invoke('network-reset-adapter', adapterName);
        break;
      case 'renew-ip':
        result = await ipcRenderer.invoke('network-release-renew-ip', adapterName);
        break;
      case 'show-ip':
        await showIPConfig(adapterName);
        return;
      default:
        return;
    }
    
    ui.showToast(result.message, 'success');
    
    // Refresh after 2 seconds
    setTimeout(load, 2000);
  } catch (error) {
    // Check if it's a permission error
    const errorMsg = error.message || '';
    if (errorMsg.includes('Access is denied') || errorMsg.includes('PermissionDenied')) {
      ui.showToast('Cần quyền Administrator! Khởi động lại app bằng "Run as Administrator"', 'error');
    } else {
      ui.showToast(errorMsg, 'error');
    }
  } finally {
    actionEl.disabled = false;
    actionEl.classList.remove('loading');
  }
}

async function showIPConfig(adapterName) {
  try {
    const ips = await ipcRenderer.invoke('network-get-ip-config', adapterName);
    
    if (!ips || ips.length === 0) {
      ui.showToast('Không có IP nào', 'info');
      return;
    }
    
    // Show in modal
    const modal = ui.$('network-ip-modal');
    const title = ui.$('network-ip-modal-adapter');
    const content = ui.$('network-ip-modal-content');
    
    if (!modal || !title || !content) {
      // Fallback to toast
      const ipList = ips.map(ip => `${ip.address}/${ip.prefix} (${ip.family})`).join(', ');
      ui.showToast(`IP: ${ipList}`, 'info');
      return;
    }
    
    title.textContent = adapterName;
    content.textContent = ips.map(ip => 
      `${ip.family === 'IPv4' ? '🌐' : '🌍'} ${ip.address}/${ip.prefix} (${ip.family})`
    ).join('\n');
    
    modal.style.display = 'flex';
  } catch (error) {
    ui.showToast(error.message, 'error');
  }
}

function render() {
  const list = ui.$('network-list');
  if (!list) return;
  
  const count = ui.$('network-count');
  if (count) {
    const connected = adapters.filter(a => a.status === 'Up').length;
    count.textContent = `${adapters.length} adapters · ${connected} connected`;
  }
  
  if (adapters.length === 0) {
    list.innerHTML = `
      <div class="library-empty">
        <div class="library-empty-icon">
          <svg width="32" height="32" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7zm-3 1a1 1 0 10-2 0v3a1 1 0 102 0V8zM8 9a1 1 0 00-2 0v2a1 1 0 102 0V9z" clip-rule="evenodd"/>
          </svg>
        </div>
        <h3>Không tìm thấy adapter nào</h3>
        <p>Không có network adapter nào được phát hiện trên hệ thống.</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = adapters.map(adapter => renderAdapterCard(adapter)).join('');
}

function renderAdapterCard(adapter) {
  const isUp = adapter.status === 'Up';
  const isDisabled = adapter.status === 'Disabled';
  
  const statusClass = isUp ? 'success' : isDisabled ? 'secondary' : 'warning';
  const statusText = isUp ? 'Connected' : isDisabled ? 'Disabled' : adapter.status;
  
  const typeIcon = getTypeIcon(adapter.type);
  const typeLabel = getTypeLabel(adapter.type);
  
  // Get primary IP (first IPv4 or first IP)
  const ipv4 = adapter.ips?.find(ip => ip.family === 'IPv4');
  const primaryIP = ipv4 || adapter.ips?.[0];
  const ipDisplay = primaryIP ? `${primaryIP.address}` : 'N/A';
  
  return `
    <div class="network-adapter-card" data-name="${ui.escapeHtml(adapter.name)}" data-status="${adapter.status}">
      <div class="network-adapter-header">
        <div class="network-adapter-icon ${adapter.type}">
          ${typeIcon}
        </div>
        <div class="network-adapter-info">
          <h3>${ui.escapeHtml(adapter.name)}</h3>
          <p class="network-adapter-desc">${ui.escapeHtml(adapter.description)}</p>
        </div>
        <span class="badge badge-${statusClass}">
          <span class="status-dot ${isUp ? 'running' : ''}"></span>
          ${statusText}
        </span>
      </div>
      
      <div class="network-adapter-meta">
        <div class="network-meta-item">
          <span class="network-meta-label">Type</span>
          <span class="network-meta-value">${typeLabel}</span>
        </div>
        <div class="network-meta-item">
          <span class="network-meta-label">IP Address</span>
          <span class="network-meta-value" title="${adapter.ips?.map(ip => `${ip.address}/${ip.prefix} (${ip.family})`).join('\n') || 'N/A'}">${ipDisplay}</span>
        </div>
        <div class="network-meta-item">
          <span class="network-meta-label">MAC</span>
          <span class="network-meta-value">${adapter.mac || 'N/A'}</span>
        </div>
        <div class="network-meta-item">
          <span class="network-meta-label">Speed</span>
          <span class="network-meta-value">${adapter.speed}</span>
        </div>
      </div>
      
      <div class="network-adapter-actions">
        ${isDisabled ? `
          <button class="btn btn-success btn-sm" data-action="enable" title="Bật adapter (cần admin)">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
            Bật
          </button>
        ` : `
          <button class="btn btn-secondary btn-sm" data-action="disable" title="Tắt adapter (cần admin)">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
            Tắt
          </button>
        `}
        <button class="btn btn-secondary btn-sm" data-action="reset" title="Reset adapter (cần admin)">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg>
          Reset
        </button>
        ${!isDisabled ? `
          <button class="btn btn-secondary btn-sm" data-action="renew-ip" title="Release và renew IP">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg>
            Renew IP
          </button>
        ` : ''}
        ${adapter.ips && adapter.ips.length > 1 ? `
          <button class="btn btn-secondary btn-sm" data-action="show-ip" title="Xem tất cả IP addresses">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
            Xem tất cả (${adapter.ips.length})
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function getTypeIcon(type) {
  const icons = {
    wifi: '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M17.778 8.222c-4.296-4.296-11.26-4.296-15.556 0A1 1 0 01.808 6.808c5.076-5.077 13.308-5.077 18.384 0a1 1 0 01-1.414 1.414zM14.95 11.05a7 7 0 00-9.9 0 1 1 0 01-1.414-1.414 9 9 0 0112.728 0 1 1 0 01-1.414 1.414zM12.12 13.88a3 3 0 00-4.242 0 1 1 0 01-1.415-1.415 5 5 0 017.072 0 1 1 0 01-1.415 1.415zM9 16a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z"/></svg>',
    ethernet: '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>',
    virtual: '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z"/><path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z"/><path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z"/></svg>',
    bluetooth: '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a1 1 0 011 1v5.586l3.707-3.707a1 1 0 011.414 1.414L12.414 10l3.707 3.707a1 1 0 01-1.414 1.414L11 11.414V17a1 1 0 11-2 0v-5.586l-3.707 3.707a1 1 0 01-1.414-1.414L7.586 10 3.879 6.293a1 1 0 011.414-1.414L9 8.586V3a1 1 0 011-1z"/></svg>',
    other: '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7zm-3 1a1 1 0 10-2 0v3a1 1 0 102 0V8zM8 9a1 1 0 00-2 0v2a1 1 0 102 0V9z" clip-rule="evenodd"/></svg>'
  };
  return icons[type] || icons.other;
}

function getTypeLabel(type) {
  const labels = {
    wifi: 'Wi-Fi',
    ethernet: 'Ethernet',
    virtual: 'Virtual',
    bluetooth: 'Bluetooth',
    other: 'Other'
  };
  return labels[type] || 'Unknown';
}

function cleanup() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

module.exports = { init, load, cleanup };

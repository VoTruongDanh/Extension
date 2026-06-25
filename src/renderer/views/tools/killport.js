const { ipcRenderer } = require('electron');
const ui = require('../../ui');

let ports = [];
let filteredPorts = [];
let refreshInterval = null;
let selectedPort = null;
let filterMode = 'all'; // 'all', 'safe', 'nosystem'

// Protected system ports that should not be killed
const PROTECTED_PORTS = new Set([
  20, 21,    // FTP
  22,        // SSH
  23,        // Telnet
  25,        // SMTP
  53,        // DNS
  80, 443,   // HTTP/HTTPS
  110, 143,  // POP3/IMAP
  135, 139, 445, // Windows RPC/NetBIOS/SMB
  389, 636,  // LDAP
  1433, 1434, // SQL Server
  3306,      // MySQL
  3389,      // RDP
  5432,      // PostgreSQL
]);

// System processes that should not be killed
const PROTECTED_PROCESSES = new Set([
  'System',
  'svchost.exe',
  'csrss.exe',
  'wininit.exe',
  'services.exe',
  'lsass.exe',
  'winlogon.exe',
  'explorer.exe',
  'dwm.exe',
]);

function init() {
  const refreshBtn = ui.$('killport-refresh-btn');
  const searchInput = ui.$('killport-search');
  const filterSelect = ui.$('killport-filter');
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', load);
  }
  
  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
  }
  
  if (filterSelect) {
    filterSelect.addEventListener('change', handleFilterChange);
  }
  
  const list = ui.$('killport-list');
  if (list) {
    list.addEventListener('click', handleListClick);
  }
  
  // Modal controls
  const modal = ui.$('killport-modal');
  const modalClose = ui.$('killport-modal-close');
  const modalCancel = ui.$('killport-modal-cancel');
  const modalConfirm = ui.$('killport-modal-confirm');
  
  if (modalClose) {
    modalClose.addEventListener('click', closeModal);
  }
  
  if (modalCancel) {
    modalCancel.addEventListener('click', closeModal);
  }
  
  if (modalConfirm) {
    modalConfirm.addEventListener('click', confirmKillPort);
  }
  
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });
  }
  
  load();
  
  // Auto-refresh every 5 seconds
  refreshInterval = setInterval(load, 5000);
}

function handleFilterChange() {
  const filterSelect = ui.$('killport-filter');
  if (!filterSelect) return;
  
  filterMode = filterSelect.value;
  applyFilters();
}

async function load() {
  const refreshBtn = ui.$('killport-refresh-btn');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('loading');
  }
  
  try {
    ports = await ipcRenderer.invoke('killport-get-ports');
    
    // Classify risk level for each port
    ports = ports.map(port => ({
      ...port,
      riskLevel: getRiskLevel(port),
      isProtected: isProtectedPort(port)
    }));
    
    applyFilters();
  } catch (error) {
    ui.showToast(`Không tải được danh sách port: ${error.message}`, 'error');
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('loading');
    }
  }
}

function getRiskLevel(port) {
  // Protected/system ports = danger
  if (PROTECTED_PORTS.has(port.port) || PROTECTED_PROCESSES.has(port.processName)) {
    return 'danger';
  }
  
  // Development ports (3000-9000 range, common dev tools) = safe
  const devPorts = [3000, 3001, 4200, 5000, 5173, 8000, 8080, 8888, 9000];
  if (devPorts.includes(port.port) || (port.port >= 3000 && port.port <= 9000)) {
    const process = port.processName.toLowerCase();
    if (process.includes('node') || process.includes('python') || 
        process.includes('java') || process.includes('npm') ||
        process.includes('vite') || process.includes('webpack')) {
      return 'safe';
    }
  }
  
  // Everything else = warning
  return 'warning';
}

function isProtectedPort(port) {
  return PROTECTED_PORTS.has(port.port) || PROTECTED_PROCESSES.has(port.processName);
}

function applyFilters() {
  const searchInput = ui.$('killport-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  
  // Apply filter mode
  let filtered = [...ports];
  
  if (filterMode === 'safe') {
    filtered = filtered.filter(p => p.riskLevel === 'safe');
  } else if (filterMode === 'nosystem') {
    filtered = filtered.filter(p => !p.isProtected);
  }
  
  // Apply search query
  if (query) {
    filtered = filtered.filter(port => {
      const portStr = String(port.port).toLowerCase();
      const processStr = port.processName.toLowerCase();
      const pidStr = String(port.pid).toLowerCase();
      const protoStr = port.protocol.toLowerCase();
      
      return portStr.includes(query) || 
             processStr.includes(query) || 
             pidStr.includes(query) ||
             protoStr.includes(query);
    });
  }
  
  filteredPorts = filtered;
  render();
}

function handleSearch() {
  applyFilters();
}

function handleListClick(event) {
  const killBtn = event.target.closest('[data-action="kill"]');
  if (!killBtn) return;
  
  const card = killBtn.closest('.killport-card');
  if (!card) return;
  
  const port = parseInt(card.dataset.port, 10);
  const pid = parseInt(card.dataset.pid, 10);
  const processName = card.dataset.process;
  const riskLevel = card.dataset.risk;
  const isProtected = card.dataset.protected === 'true';
  
  selectedPort = { port, pid, processName, riskLevel, isProtected };
  openModal();
}

function openModal() {
  if (!selectedPort) return;
  
  const modal = ui.$('killport-modal');
  const portEl = ui.$('killport-modal-port');
  const processEl = ui.$('killport-modal-process');
  const pidEl = ui.$('killport-modal-pid');
  const riskEl = ui.$('killport-modal-risk');
  const warningEl = ui.$('killport-modal-warning');
  const confirmBtn = ui.$('killport-modal-confirm');
  
  if (portEl) portEl.textContent = selectedPort.port;
  if (processEl) processEl.textContent = selectedPort.processName;
  if (pidEl) pidEl.textContent = selectedPort.pid;
  
  // Update risk level indicator
  if (riskEl) {
    const riskLabels = {
      safe: '✅ An toàn (Development)',
      warning: '⚠️ Cảnh báo (Thường dùng)',
      danger: '🚫 Nguy hiểm (System)'
    };
    riskEl.textContent = riskLabels[selectedPort.riskLevel] || '⚠️ Không xác định';
    riskEl.className = `value risk-${selectedPort.riskLevel}`;
  }
  
  // Update warning message based on risk
  if (warningEl) {
    if (selectedPort.isProtected) {
      warningEl.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" clip-rule="evenodd"/>
        </svg>
        <strong>PORT BẢO VỆ:</strong> Đây là system port hoặc process quan trọng. Kill có thể làm hệ thống không ổn định hoặc mất kết nối mạng. Chỉ thực hiện nếu bạn chắc chắn!
      `;
      warningEl.className = 'alert alert-danger';
    } else if (selectedPort.riskLevel === 'danger') {
      warningEl.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
        </svg>
        <strong>CẢNH BÁO:</strong> Hành động này sẽ terminate process và không thể hoàn tác. Hãy chắc chắn bạn muốn kill port này.
      `;
      warningEl.className = 'alert alert-warning';
    } else {
      warningEl.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
        </svg>
        Hành động này sẽ terminate process và không thể hoàn tác.
      `;
      warningEl.className = 'alert alert-info';
    }
  }
  
  // Disable confirm button for protected ports
  if (confirmBtn) {
    if (selectedPort.isProtected) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Không thể kill';
      confirmBtn.title = 'Port này được bảo vệ để tránh làm hỏng hệ thống';
    } else {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Kill Port';
      confirmBtn.title = '';
    }
  }
  
  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeModal() {
  const modal = ui.$('killport-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  selectedPort = null;
}

async function confirmKillPort() {
  if (!selectedPort) return;
  
  const confirmBtn = ui.$('killport-modal-confirm');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.classList.add('loading');
    confirmBtn.textContent = 'Đang kill...';
  }
  
  try {
    const result = await ipcRenderer.invoke('killport-kill-process', selectedPort.pid);
    ui.showToast(result.message, 'success');
    closeModal();
    
    // Refresh after 1 second
    setTimeout(load, 1000);
  } catch (error) {
    // Check if it's a permission error
    const errorMsg = error.message || '';
    if (errorMsg.includes('Access is denied') || errorMsg.includes('Administrator')) {
      ui.showToast('Cần quyền Administrator! Khởi động lại app bằng "Run as Administrator"', 'error');
    } else {
      ui.showToast(errorMsg, 'error');
    }
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.classList.remove('loading');
      confirmBtn.textContent = 'Kill Port';
    }
  }
}

function render() {
  const list = ui.$('killport-list');
  if (!list) return;
  
  const count = ui.$('killport-count');
  if (count) {
    const total = ports.length;
    const filtered = filteredPorts.length;
    if (filtered === total) {
      count.textContent = `${total} port(s) đang mở`;
    } else {
      count.textContent = `${filtered} / ${total} port(s)`;
    }
  }
  
  if (filteredPorts.length === 0) {
    const searchInput = ui.$('killport-search');
    const isSearching = searchInput && searchInput.value.trim();
    
    list.innerHTML = `
      <div class="library-empty">
        <div class="library-empty-icon">
          <svg width="32" height="32" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
          </svg>
        </div>
        <h3>${isSearching ? 'Không tìm thấy port nào' : 'Không có port nào đang mở'}</h3>
        <p>${isSearching ? 'Thử tìm kiếm với từ khóa khác' : 'Không có port nào đang listening trên hệ thống.'}</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = filteredPorts.map(port => renderPortCard(port)).join('');
}

function renderPortCard(port) {
  const protocolClass = port.protocol.toLowerCase().includes('tcp') ? 'tcp' : 'udp';
  const protocolLabel = port.protocol;
  
  // Detect common port types
  const portType = detectPortType(port.port, port.processName);
  const portTypeLabel = portType.label;
  const portTypeClass = portType.class;
  
  // Risk level styling
  const riskClass = port.riskLevel; // 'safe', 'warning', 'danger'
  const riskBorder = port.isProtected ? 'protected' : riskClass;
  
  // Kill button state
  const killBtnDisabled = port.isProtected;
  const killBtnClass = port.isProtected ? 'btn-secondary' : 'btn-danger';
  const killBtnText = port.isProtected ? 'Được bảo vệ' : 'Kill Port';
  const killBtnIcon = port.isProtected 
    ? '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>';
  
  return `
    <div class="killport-card risk-${riskBorder}" 
         data-port="${port.port}" 
         data-pid="${port.pid}"
         data-process="${ui.escapeHtml(port.processName)}"
         data-risk="${riskClass}"
         data-protected="${port.isProtected}">
      <div class="killport-header">
        <div class="killport-port-badge ${portTypeClass}">
          <span class="port-number">${port.port}</span>
          <span class="port-type">${portTypeLabel}</span>
        </div>
        <div class="killport-badges">
          <span class="badge badge-${protocolClass}">${protocolLabel}</span>
          ${port.isProtected ? '<span class="badge badge-protected">🛡️ Protected</span>' : ''}
          ${!port.isProtected && riskClass === 'safe' ? '<span class="badge badge-safe">✅ Safe</span>' : ''}
        </div>
      </div>
      
      <div class="killport-body">
        <div class="killport-process">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M3 3a2 2 0 012-2h10a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V3zm3 2a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H7a1 1 0 01-1-1V5zm0 6a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H7a1 1 0 01-1-1v-2z" clip-rule="evenodd"/>
          </svg>
          <span class="process-name" title="${ui.escapeHtml(port.processName)}">${ui.escapeHtml(port.processName)}</span>
        </div>
        
        <div class="killport-meta">
          <div class="killport-meta-item">
            <span class="label">PID:</span>
            <span class="value">${port.pid}</span>
          </div>
          <div class="killport-meta-item">
            <span class="label">Address:</span>
            <span class="value" title="${ui.escapeHtml(port.address)}">${ui.escapeHtml(port.address)}</span>
          </div>
        </div>
      </div>
      
      <div class="killport-actions">
        <button class="btn ${killBtnClass} btn-sm" data-action="kill" ${killBtnDisabled ? 'disabled' : ''} title="${port.isProtected ? 'Port này được bảo vệ' : 'Kill process này'}">
          ${killBtnIcon}
          ${killBtnText}
        </button>
      </div>
    </div>
  `;
}

function detectPortType(port, processName) {
  const process = processName.toLowerCase();
  
  // Common development ports
  if (port === 3000) return { label: 'React/Node', class: 'dev' };
  if (port === 3001) return { label: 'Development', class: 'dev' };
  if (port === 4200) return { label: 'Angular', class: 'dev' };
  if (port === 5000) return { label: 'Flask/Dev', class: 'dev' };
  if (port === 5173) return { label: 'Vite', class: 'dev' };
  if (port === 8000) return { label: 'Django/Dev', class: 'dev' };
  if (port === 8080) return { label: 'Dev Server', class: 'dev' };
  if (port === 8888) return { label: 'Jupyter', class: 'dev' };
  if (port === 9000) return { label: 'Dev/Test', class: 'dev' };
  
  // Web servers
  if (port === 80) return { label: 'HTTP', class: 'web' };
  if (port === 443) return { label: 'HTTPS', class: 'web' };
  if (port === 8443) return { label: 'HTTPS Alt', class: 'web' };
  
  // Databases
  if (port === 3306) return { label: 'MySQL', class: 'database' };
  if (port === 5432) return { label: 'PostgreSQL', class: 'database' };
  if (port === 27017) return { label: 'MongoDB', class: 'database' };
  if (port === 6379) return { label: 'Redis', class: 'database' };
  
  // System services
  if (port === 22) return { label: 'SSH', class: 'system' };
  if (port === 21) return { label: 'FTP', class: 'system' };
  if (port === 25) return { label: 'SMTP', class: 'system' };
  if (port === 135) return { label: 'RPC', class: 'system' };
  if (port === 445) return { label: 'SMB', class: 'system' };
  
  // Process-based detection
  if (process.includes('node')) return { label: 'Node.js', class: 'dev' };
  if (process.includes('python')) return { label: 'Python', class: 'dev' };
  if (process.includes('java')) return { label: 'Java', class: 'dev' };
  if (process.includes('chrome') || process.includes('msedge')) return { label: 'Browser', class: 'browser' };
  if (process.includes('mysql')) return { label: 'MySQL', class: 'database' };
  if (process.includes('postgres')) return { label: 'PostgreSQL', class: 'database' };
  if (process.includes('mongo')) return { label: 'MongoDB', class: 'database' };
  if (process.includes('redis')) return { label: 'Redis', class: 'database' };
  if (process.includes('nginx') || process.includes('apache')) return { label: 'Web Server', class: 'web' };
  
  return { label: 'Custom', class: 'custom' };
}

function cleanup() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

module.exports = { init, load, cleanup };

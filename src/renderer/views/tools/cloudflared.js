const { ipcRenderer, shell } = require('electron');
const ui = require('../../ui');
const qrcode = require('../../components/qrcode');

let installedInfo = { installed: false, version: null, path: null };
let tunnels = [];
let selectedLogPort = 'all'; // 'all' hoặc số port cụ thể
let autoScroll = true;
let uptimeTimer = null;
let currentModalUrl = '';

function init() {
  // Nút mở cổng
  const startBtn = ui.$('cf-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', handleStartTunnel);
  }

  // Nhấn Enter trên ô nhập port để mở luôn
  const portInput = ui.$('cf-port-input');
  if (portInput) {
    portInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleStartTunnel();
      }
    });
  }

  // Preset chips gợi ý cổng
  const presetChips = document.querySelectorAll('.cf-chip');
  presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const port = chip.getAttribute('data-port');
      if (port && portInput) {
        portInput.value = port;
        portInput.focus();
      }
    });
  });

  // Nút quét và chọn cổng đang chạy trên máy
  const scanBtn = ui.$('cf-scan-ports-btn');
  const drawer = ui.$('cf-open-ports-drawer');
  const drawerClose = ui.$('cf-drawer-close');

  if (scanBtn && drawer) {
    scanBtn.addEventListener('click', async () => {
      if (drawer.style.display === 'none') {
        drawer.style.display = 'block';
        await loadOpenPorts();
      } else {
        drawer.style.display = 'none';
      }
    });
  }

  if (drawerClose && drawer) {
    drawerClose.addEventListener('click', () => {
      drawer.style.display = 'none';
    });
  }

  // Nút cài đặt Cloudflared
  const installBtn = ui.$('cloudflared-install-btn');
  if (installBtn) {
    installBtn.addEventListener('click', handleInstallCloudflared);
  }

  // Nút làm mới
  const refreshBtn = ui.$('cloudflared-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', load);
  }

  // Nút dừng tất cả
  const stopAllBtn = ui.$('cf-stop-all-btn');
  if (stopAllBtn) {
    stopAllBtn.addEventListener('click', handleStopAll);
  }

  // Nút điều khiển nhật ký
  const autoscrollBtn = ui.$('cf-log-autoscroll-btn');
  if (autoscrollBtn) {
    autoscrollBtn.addEventListener('click', () => {
      autoScroll = !autoScroll;
      autoscrollBtn.textContent = `Tự cuộn: ${autoScroll ? 'BẬT' : 'TẮT'}`;
      if (autoScroll) scrollToBottom();
    });
  }

  const clearLogBtn = ui.$('cf-log-clear-btn');
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
      const term = ui.$('cf-terminal-output');
      if (term) {
        term.innerHTML = '<div class="cf-log-placeholder">Nhật ký đã được xóa.</div>';
      }
    });
  }

  const copyLogBtn = ui.$('cf-log-copy-btn');
  if (copyLogBtn) {
    copyLogBtn.addEventListener('click', () => {
      const term = ui.$('cf-terminal-output');
      if (!term) return;
      const text = term.innerText;
      if (!text || text.includes('Chưa có nhật ký nào')) {
        ui.showToast('Không có nhật ký để sao chép', 'info');
        return;
      }
      navigator.clipboard.writeText(text).then(() => {
        ui.showToast('Đã sao chép toàn bộ nhật ký vào clipboard', 'info');
      });
    });
  }

  // QR Code Modal
  const qrModal = ui.$('cf-qr-modal');
  const qrClose = ui.$('cf-qr-modal-close');
  const qrCopy = ui.$('cf-qr-copy-btn');
  const qrOpen = ui.$('cf-qr-open-btn');

  if (qrClose && qrModal) {
    qrClose.addEventListener('click', () => {
      qrModal.style.display = 'none';
    });
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) qrModal.style.display = 'none';
    });
  }

  if (qrCopy) {
    qrCopy.addEventListener('click', () => {
      if (currentModalUrl) {
        navigator.clipboard.writeText(currentModalUrl).then(() => {
          ui.showToast('Đã sao chép link công khai!', 'info');
        });
      }
    });
  }

  if (qrOpen) {
    qrOpen.addEventListener('click', () => {
      if (currentModalUrl) {
        ipcRenderer.send('open-browser', currentModalUrl);
      }
    });
  }

  // Lắng nghe các IPC event từ Main process
  ipcRenderer.on('cloudflared-status-changed', (_, updatedTunnel) => {
    handleTunnelUpdate(updatedTunnel);
  });

  ipcRenderer.on('cloudflared-log', (_, { port, log }) => {
    appendTerminalLog(port, log);
  });

  ipcRenderer.on('cloudflared-install-progress', (_, progress) => {
    handleDownloadProgress(progress);
  });

  // Uptime ticker mỗi giây
  if (uptimeTimer) clearInterval(uptimeTimer);
  uptimeTimer = setInterval(updateUptimes, 1000);
}

/**
 * Tải trạng thái ban đầu của view
 */
async function load() {
  await checkInstallationStatus();
  await refreshTunnelsList();
}

/**
 * Kiểm tra trạng thái cloudflared đã cài chưa
 */
async function checkInstallationStatus() {
  const badgeDot = ui.$('cloudflared-binary-dot');
  const badgeText = ui.$('cloudflared-binary-text');
  const installBtn = ui.$('cloudflared-install-btn');

  try {
    installedInfo = await ipcRenderer.invoke('cloudflared-check-installed');

    if (installedInfo.installed) {
      if (badgeDot) badgeDot.className = 'status-dot running';
      if (badgeText) badgeText.textContent = `Cloudflared v${installedInfo.version || 'Ready'}`;
      if (installBtn) installBtn.style.display = 'none';
    } else {
      if (badgeDot) badgeDot.className = 'status-dot stopped';
      if (badgeText) badgeText.textContent = 'Chưa cài Cloudflared';
      if (installBtn) installBtn.style.display = 'inline-flex';
    }
  } catch (error) {
    if (badgeDot) badgeDot.className = 'status-dot error';
    if (badgeText) badgeText.textContent = 'Lỗi kiểm tra';
    if (installBtn) installBtn.style.display = 'inline-flex';
  }
}

/**
 * Xử lý tải tự động binary Cloudflared
 */
async function handleInstallCloudflared() {
  const installBtn = ui.$('cloudflared-install-btn');
  const progressContainer = ui.$('cloudflared-download-progress-container');
  const downloadBar = ui.$('cloudflared-download-bar');
  const downloadPercent = ui.$('cloudflared-download-percent');
  const downloadSub = ui.$('cloudflared-download-sub');

  if (installBtn) installBtn.disabled = true;
  if (progressContainer) progressContainer.style.display = 'block';
  if (downloadBar) downloadBar.style.width = '0%';
  if (downloadPercent) downloadPercent.textContent = '0%';
  if (downloadSub) downloadSub.textContent = 'Đang kết nối tới GitHub Cloudflare Releases...';

  try {
    ui.showToast('Bắt đầu tải Cloudflared. Vui lòng chờ trong giây lát...', 'info');
    const result = await ipcRenderer.invoke('cloudflared-install');

    if (result.ok) {
      ui.showToast(`Cài đặt thành công Cloudflared v${result.version || ''}!`, 'info');
      if (progressContainer) progressContainer.style.display = 'none';
      await checkInstallationStatus();
    }
  } catch (error) {
    ui.showToast(`Lỗi khi tải Cloudflared: ${error.message}`, 'error');
    if (downloadSub) downloadSub.textContent = `Lỗi: ${error.message}`;
  } finally {
    if (installBtn) installBtn.disabled = false;
  }
}

function handleDownloadProgress(progress) {
  const downloadBar = ui.$('cloudflared-download-bar');
  const downloadPercent = ui.$('cloudflared-download-percent');
  const downloadSub = ui.$('cloudflared-download-sub');

  if (downloadBar) downloadBar.style.width = `${progress.percent}%`;
  if (downloadPercent) downloadPercent.textContent = `${progress.percent}%`;

  if (downloadSub) {
    const downloadedMB = (progress.downloadedBytes / (1024 * 1024)).toFixed(1);
    const totalMB = (progress.totalBytes / (1024 * 1024)).toFixed(1);
    downloadSub.textContent = `Đã tải: ${downloadedMB} MB / ${totalMB} MB (${progress.percent}%)`;
  }
}

/**
 * Quét các cổng đang chạy từ netstat và hiển thị vào drawer
 */
async function loadOpenPorts() {
  const listEl = ui.$('cf-open-ports-list');
  if (!listEl) return;

  listEl.innerHTML = '<div style="padding: 8px; color: var(--text-2); font-size: 12px;">Đang quét các cổng LISTENING...</div>';

  try {
    const openPorts = await ipcRenderer.invoke('cloudflared-get-open-ports');
    if (!openPorts || openPorts.length === 0) {
      listEl.innerHTML = '<div style="padding: 8px; color: var(--text-2); font-size: 12px;">Không tìm thấy cổng nào đang mở.</div>';
      return;
    }

    listEl.innerHTML = '';
    openPorts.forEach((item) => {
      const btn = document.createElement('div');
      btn.className = 'cf-open-port-item';
      btn.innerHTML = `
        <span class="cf-port-num">:${item.port}</span>
        <span class="cf-port-proc" title="${ui.escapeHtml(item.processName || '')}">${ui.escapeHtml(item.processName || 'Unknown')}</span>
      `;
      btn.addEventListener('click', () => {
        const portInput = ui.$('cf-port-input');
        if (portInput) {
          portInput.value = item.port;
          portInput.focus();
        }
        const drawer = ui.$('cf-open-ports-drawer');
        if (drawer) drawer.style.display = 'none';
        ui.showToast(`Đã chọn cổng :${item.port} (${item.processName})`, 'info');
      });
      listEl.appendChild(btn);
    });
  } catch (error) {
    listEl.innerHTML = `<div style="padding: 8px; color: var(--red); font-size: 12px;">Lỗi: ${ui.escapeHtml(error.message)}</div>`;
  }
}

/**
 * Xử lý mở Tunnel
 */
async function handleStartTunnel() {
  const portInput = ui.$('cf-port-input');
  const protocolSelect = ui.$('cf-protocol-select');
  const hostInput = ui.$('cf-host-input');
  const noTlsCheckbox = ui.$('cf-no-tls-verify');
  const startBtn = ui.$('cf-start-btn');

  const port = parseInt(portInput ? portInput.value : '', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    ui.showToast('Vui lòng nhập số cổng hợp lệ (1 - 65535)', 'warning');
    if (portInput) portInput.focus();
    return;
  }

  // Kiểm tra cài đặt
  if (!installedInfo.installed) {
    ui.showToast('Bạn chưa cài đặt Cloudflared. Đang tiến hành tải tự động...', 'info');
    await handleInstallCloudflared();
    if (!installedInfo.installed) return;
  }

  const protocol = protocolSelect ? protocolSelect.value : 'http';
  const host = hostInput && hostInput.value.trim() ? hostInput.value.trim() : 'localhost';
  const noTlsVerify = noTlsCheckbox ? noTlsCheckbox.checked : false;

  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = `
      <span class="spinner-inline"></span>
      <span>Đang kết nối...</span>
    `;
  }

  ui.showToast(`Đang khởi tạo Cloudflare Tunnel cho cổng ${port}...`, 'info');

  try {
    const tunnel = await ipcRenderer.invoke('cloudflared-start-tunnel', {
      port,
      protocol,
      host,
      noTlsVerify
    });

    ui.showToast(`Mở cổng ${port} thành công! Đã có link công khai.`, 'info');
    handleTunnelUpdate(tunnel);
  } catch (error) {
    ui.showToast(`Không thể mở cổng ${port}: ${error.message}`, 'error');
  } finally {
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/>
        </svg>
        <span>Mở Cổng</span>
      `;
    }
  }
}

/**
 * Dừng 1 tunnel
 */
async function handleStopTunnel(port) {
  try {
    ui.showToast(`Đang dừng tunnel cổng ${port}...`, 'info');
    await ipcRenderer.invoke('cloudflared-stop-tunnel', port);
    ui.showToast(`Đã dừng tunnel cổng ${port}`, 'info');
    await refreshTunnelsList();
  } catch (error) {
    ui.showToast(`Lỗi khi dừng tunnel: ${error.message}`, 'error');
  }
}

/**
 * Xóa tunnel khỏi danh sách theo dõi
 */
async function handleRemoveTunnel(port) {
  try {
    await ipcRenderer.invoke('cloudflared-remove-tunnel', port);
    await refreshTunnelsList();
  } catch (error) {
    ui.showToast(`Lỗi: ${error.message}`, 'error');
  }
}

/**
 * Dừng toàn bộ các tunnel
 */
async function handleStopAll() {
  try {
    ui.showToast('Đang dừng tất cả các tunnels...', 'info');
    const res = await ipcRenderer.invoke('cloudflared-stop-all');
    ui.showToast(`Đã dừng ${res.count || 0} tunnels`, 'info');
    await refreshTunnelsList();
  } catch (error) {
    ui.showToast(`Lỗi: ${error.message}`, 'error');
  }
}

/**
 * Làm mới danh sách tunnel từ main
 */
async function refreshTunnelsList() {
  try {
    tunnels = await ipcRenderer.invoke('cloudflared-get-tunnels');
    renderTunnels();
  } catch (error) {
    console.error('Failed to get tunnels:', error);
  }
}

/**
 * Cập nhật một tunnel khi nhận event status changed
 */
function handleTunnelUpdate(updated) {
  if (!updated) return;
  const idx = tunnels.findIndex((t) => t.port === updated.port);
  if (idx !== -1) {
    tunnels[idx] = updated;
  } else {
    tunnels.unshift(updated);
  }
  renderTunnels();
}

/**
 * Render danh sách tunnels vào DOM
 */
function renderTunnels() {
  const container = ui.$('cf-tunnels-list');
  const countBadge = ui.$('cf-active-count');
  const stopAllBtn = ui.$('cf-stop-all-btn');

  if (!container) return;

  const activeTunnels = tunnels.filter((t) => t.status === 'online' || t.status === 'starting');
  if (countBadge) countBadge.textContent = `${activeTunnels.length} hoạt động / ${tunnels.length} tổng`;
  if (stopAllBtn) stopAllBtn.style.display = activeTunnels.length > 0 ? 'inline-flex' : 'none';

  if (tunnels.length === 0) {
    container.innerHTML = `
      <div class="cf-empty-state">
        <svg class="cf-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
        <h4>Chưa có tunnel nào đang mở</h4>
        <p>Nhập số cổng của ứng dụng máy tính (ví dụ: 5173, 3000...) và nhấn <strong>"Mở Cổng"</strong> để bắt đầu chia sẻ trang web ra Internet.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  tunnels.forEach((t) => {
    const card = document.createElement('div');
    card.className = `cf-tunnel-card ${t.status}`;
    card.id = `cf-tunnel-card-${t.port}`;

    const isOnline = t.status === 'online';
    const isStarting = t.status === 'starting';

    let statusBadgeHtml = '';
    if (isOnline) {
      statusBadgeHtml = `<span class="badge badge-success"><span class="status-dot running pulse"></span>Online</span>`;
    } else if (isStarting) {
      statusBadgeHtml = `<span class="badge badge-warning"><span class="status-dot starting"></span>Đang kết nối</span>`;
    } else if (t.status === 'error') {
      statusBadgeHtml = `<span class="badge badge-destructive"><span class="status-dot error"></span>Lỗi</span>`;
    } else {
      statusBadgeHtml = `<span class="badge badge-secondary"><span class="status-dot stopped"></span>Đã dừng</span>`;
    }

    const publicUrlHtml = t.publicUrl
      ? `<div class="cf-public-link-box">
           <a href="#" class="cf-public-link" data-url="${t.publicUrl}" title="Mở link trên trình duyệt">${t.publicUrl}</a>
         </div>`
      : `<span style="font-size: 12px; color: var(--text-2); font-style: italic;">Đang cấp phát đường dẫn...</span>`;

    card.innerHTML = `
      <div class="cf-tunnel-main-row">
        <div class="cf-tunnel-ports-info">
          <span class="cf-local-pill">${t.targetUrl}</span>
          <span class="cf-arrow-divider">➔</span>
          ${publicUrlHtml}
          ${statusBadgeHtml}
        </div>

        <div class="cf-tunnel-actions">
          ${
            t.publicUrl
              ? `<button class="btn btn-secondary btn-sm cf-btn-copy" data-url="${t.publicUrl}" title="Sao chép liên kết">
                   <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg>
                   <span>Copy</span>
                 </button>
                 <button class="btn btn-secondary btn-sm cf-btn-qr" data-url="${t.publicUrl}" title="Mã QR cho điện thoại">
                   <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 2V5h1v1H5zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zm2 2v-1h1v1H5zM13 3a1 1 0 00-1 1v3a1 1 0 001 1h3a1 1 0 001-1V4a1 1 0 00-1-1h-3zm1 2v1h1V5h-1z" clip-rule="evenodd"/></svg>
                   <span>Mã QR</span>
                 </button>
                 <button class="btn btn-secondary btn-sm cf-btn-open" data-url="${t.publicUrl}" title="Mở trang web trong trình duyệt">
                   <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"/></svg>
                   <span>Mở</span>
                 </button>`
              : ''
          }

          <button class="btn btn-secondary btn-sm cf-btn-viewlog" data-port="${t.port}" title="Xem nhật ký riêng cổng này">
            <span>Log</span>
          </button>

          ${
            isOnline || isStarting
              ? `<button class="btn btn-danger btn-sm cf-btn-stop" data-port="${t.port}" title="Dừng chia sẻ cổng này">
                   <span>Dừng</span>
                 </button>`
              : `<button class="btn btn-primary btn-sm cf-btn-restart" data-port="${t.port}" title="Khởi động lại tunnel này">
                   <span>Mở lại</span>
                 </button>
                 <button class="btn-icon btn-secondary cf-btn-remove" data-port="${t.port}" title="Xóa khỏi danh sách">
                   <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                 </button>`
          }
        </div>
      </div>

      <div class="cf-tunnel-meta-row">
        <div class="cf-meta-items">
          <span class="cf-meta-item">
            <strong>PID:</strong> ${t.pid || 'N/A'}
          </span>
          <span class="cf-meta-item">
            <strong>Thời gian chạy:</strong> <span class="cf-uptime" data-start="${t.startedAt}" data-stop="${t.stoppedAt || ''}">00:00</span>
          </span>
          <span class="cf-meta-item">
            <strong>Kết nối Edge:</strong> ${t.metrics ? t.metrics.connections : 0}
          </span>
        </div>

        <div>
          <span style="font-size: 11px; color: var(--text-3);">Mở lúc: ${new Date(t.startedAt).toLocaleTimeString()}</span>
        </div>
      </div>
    `;

    // Gán events cho card
    const linkEl = card.querySelector('.cf-public-link');
    if (linkEl) {
      linkEl.addEventListener('click', (e) => {
        e.preventDefault();
        ipcRenderer.send('open-browser', t.publicUrl);
      });
    }

    const copyBtn = card.querySelector('.cf-btn-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(t.publicUrl).then(() => {
          ui.showToast(`Đã sao chép link: ${t.publicUrl}`, 'info');
        });
      });
    }

    const qrBtn = card.querySelector('.cf-btn-qr');
    if (qrBtn) {
      qrBtn.addEventListener('click', () => {
        showQRCodeModal(t.publicUrl);
      });
    }

    const openBtn = card.querySelector('.cf-btn-open');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        ipcRenderer.send('open-browser', t.publicUrl);
      });
    }

    const viewLogBtn = card.querySelector('.cf-btn-viewlog');
    if (viewLogBtn) {
      viewLogBtn.addEventListener('click', () => {
        switchLogPort(t.port);
      });
    }

    const stopBtn = card.querySelector('.cf-btn-stop');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        handleStopTunnel(t.port);
      });
    }

    const restartBtn = card.querySelector('.cf-btn-restart');
    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        const portInput = ui.$('cf-port-input');
        if (portInput) portInput.value = t.port;
        handleStartTunnel();
      });
    }

    const removeBtn = card.querySelector('.cf-btn-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        handleRemoveTunnel(t.port);
      });
    }

    container.appendChild(card);
  });

  updateUptimes();
}

/**
 * Hiển thị QR Code Modal
 */
function showQRCodeModal(url) {
  currentModalUrl = url;
  const modal = ui.$('cf-qr-modal');
  const canvas = ui.$('cf-qr-canvas');
  const urlText = ui.$('cf-qr-url-text');

  if (urlText) urlText.textContent = url;
  if (canvas) {
    qrcode.renderQRCodeToCanvas(canvas, url, {
      size: 220,
      margin: 2,
      foreground: '#000000',
      background: '#ffffff'
    });
  }

  if (modal) modal.style.display = 'flex';
}

/**
 * Chuyển bộ lọc log theo từng cổng
 */
async function switchLogPort(port) {
  selectedLogPort = port;
  const label = ui.$('cf-log-port-label');
  if (label) {
    label.textContent = `Cổng :${port}`;
  }

  const term = ui.$('cf-terminal-output');
  if (term) term.innerHTML = '';

  try {
    const logs = await ipcRenderer.invoke('cloudflared-get-logs', port);
    if (!logs || logs.length === 0) {
      if (term) term.innerHTML = `<div class="cf-log-placeholder">Chưa có nhật ký cho cổng :${port}</div>`;
      return;
    }

    logs.forEach((item) => appendTerminalLog(port, item));
    scrollToBottom();
  } catch (error) {
    console.error('Error fetching logs:', error);
  }
}

/**
 * Thêm một dòng log vào terminal output
 */
function appendTerminalLog(port, log) {
  if (selectedLogPort !== 'all' && selectedLogPort !== port) {
    return;
  }

  const term = ui.$('cf-terminal-output');
  if (!term) return;

  const placeholder = term.querySelector('.cf-log-placeholder');
  if (placeholder) placeholder.remove();

  const lineDiv = document.createElement('div');
  lineDiv.className = 'cf-log-line';

  const timeStr = new Date(log.time).toLocaleTimeString();
  let lineContent = ui.escapeHtml(log.text);

  // Phân loại dòng log để tạo màu trực quan
  if (log.isError || /ERR|error|fail/i.test(log.text)) {
    lineDiv.classList.add('error');
  } else if (/WRN|warn/i.test(log.text)) {
    lineDiv.classList.add('warn');
  } else if (/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i.test(log.text)) {
    lineDiv.classList.add('highlight');
  }

  lineDiv.innerHTML = `<span class="cf-log-time">[${timeStr}][:${port}]</span>${lineContent}`;
  term.appendChild(lineDiv);

  // Giữ tối đa 400 dòng trong DOM
  while (term.childNodes.length > 400) {
    term.removeChild(term.firstChild);
  }

  if (autoScroll) {
    scrollToBottom();
  }
}

function scrollToBottom() {
  const term = ui.$('cf-terminal-output');
  if (term) {
    term.scrollTop = term.scrollHeight;
  }
}

/**
 * Cập nhật hiển thị thời gian chạy uptime
 */
function updateUptimes() {
  const uptimes = document.querySelectorAll('.cf-uptime');
  const now = Date.now();

  uptimes.forEach((el) => {
    const start = parseInt(el.getAttribute('data-start'), 10);
    const stopAttr = el.getAttribute('data-stop');
    const stop = stopAttr ? parseInt(stopAttr, 10) : null;

    if (!start) return;

    const diff = Math.max(0, Math.floor(((stop || now) - start) / 1000));
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;

    const pad = (n) => String(n).padStart(2, '0');
    el.textContent = hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  });
}

module.exports = {
  init,
  load,
  openPortForSharing(port) {
    const portInput = ui.$('cf-port-input');
    if (portInput) portInput.value = port;
    handleStartTunnel();
  }
};

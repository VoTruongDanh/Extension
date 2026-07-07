const { ipcRenderer } = require('electron');
const ui = require('../../ui');

// ─── Scheduler state ──────────────────────────────────────────────────────────
let scheduleTimer = null;

function loadSchedule() {
  try {
    return JSON.parse(localStorage.getItem('idm-schedule') || 'null') || {
      enabled: false,
      days: 5,
      lastReset: null
    };
  } catch (_) {
    return { enabled: false, days: 5, lastReset: null };
  }
}

function saveSchedule(data) {
  localStorage.setItem('idm-schedule', JSON.stringify(data));
}

function formatDate(ts) {
  if (!ts) return 'Chưa có';
  return new Date(ts).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatNextReset(lastReset, days) {
  if (!lastReset) {
    return `Sẽ reset sau ${days} ngày kể từ lần đầu tiên`;
  }
  const next = new Date(lastReset + days * 86400000);
  const now = Date.now();
  const diff = next - now;
  if (diff <= 0) return 'Đến hạn reset ngay bây giờ';
  const daysLeft = Math.floor(diff / 86400000);
  const hoursLeft = Math.floor((diff % 86400000) / 3600000);
  if (daysLeft > 0) return `Lần tiếp: ${formatDate(next.getTime())} (còn ${daysLeft} ngày ${hoursLeft}h)`;
  return `Lần tiếp: ${formatDate(next.getTime())} (còn ${hoursLeft}h)`;
}

function updateSchedulerUI(schedule) {
  const toggle = ui.$('idm-auto-toggle');
  const daysInput = ui.$('idm-auto-days');
  const lastEl = ui.$('idm-last-reset-text');
  const nextEl = ui.$('idm-next-reset-text');

  if (!toggle) return;

  toggle.checked = schedule.enabled;
  if (daysInput) daysInput.value = schedule.days;
  if (lastEl) lastEl.textContent = formatDate(schedule.lastReset);
  if (nextEl) nextEl.textContent = schedule.enabled
    ? formatNextReset(schedule.lastReset, schedule.days)
    : 'Bật tự động để xem lịch';
}

function startScheduler(schedule, onReset) {
  if (scheduleTimer) clearInterval(scheduleTimer);
  if (!schedule.enabled) return;

  // Kiểm tra mỗi phút
  scheduleTimer = setInterval(async () => {
    const s = loadSchedule();
    if (!s.enabled) { clearInterval(scheduleTimer); return; }

    const now = Date.now();
    const due = !s.lastReset || (now - s.lastReset) >= s.days * 86400000;
    if (due) {
      await onReset(true); // silent = true
    }
  }, 60000);
}

function init() {
  const resetBtn = ui.$('idm-reset-btn');
  const statusEl = ui.$('idm-status');
  const checkBtn = ui.$('idm-check-btn');
  const progressEl = ui.$('idm-progress');
  const stepsEl = ui.$('idm-steps');

  if (!resetBtn || !statusEl || !checkBtn || !progressEl || !stepsEl) return;

  let isCheckingIDM = false;
  let isResetting = false;

  // Load và hiển thị schedule
  const schedule = loadSchedule();
  updateSchedulerUI(schedule);

  // ─── Scheduler controls ──────────────────────────────────────────────────
  const toggle = ui.$('idm-auto-toggle');
  const daysInput = ui.$('idm-auto-days');
  const decBtn = ui.$('idm-days-dec');
  const incBtn = ui.$('idm-days-inc');

  if (decBtn) decBtn.addEventListener('click', () => {
    const v = parseInt(daysInput.value) || 5;
    daysInput.value = Math.max(1, v - 1);
    _saveScheduleDays();
  });

  if (incBtn) incBtn.addEventListener('click', () => {
    const v = parseInt(daysInput.value) || 5;
    daysInput.value = Math.min(30, v + 1);
    _saveScheduleDays();
  });

  function _saveScheduleDays() {
    const days = Math.max(1, Math.min(30, parseInt(daysInput.value) || 5));
    const s = loadSchedule();
    s.days = days;
    saveSchedule(s);
    updateSchedulerUI(s);
    if (s.enabled) startScheduler(s, doReset);
  }

  if (toggle) toggle.addEventListener('change', () => {
    const s = loadSchedule();
    s.enabled = toggle.checked;
    saveSchedule(s);
    updateSchedulerUI(s);
    if (s.enabled) {
      startScheduler(s, doReset);
      ui.showToast(`Tự động reset IDM mỗi ${s.days} ngày đã bật`, 'success');
    } else {
      if (scheduleTimer) clearInterval(scheduleTimer);
      ui.showToast('Đã tắt tự động reset IDM', 'info');
    }
  });

  startScheduler(schedule, doReset);

  // ─── Step helpers ─────────────────────────────────────────────────────────
  function showStep(step, status = 'running') {
    const stepEl = ui.$(`idm-step-${step}`);
    if (!stepEl) return;
    // Chỉ reset steps trong IDM card, không ảnh hưởng AnyDesk
    ['idm-step-1','idm-step-2','idm-step-3','idm-step-4'].forEach(id => {
      const el = ui.$(id);
      if (el) el.classList.remove('running', 'success', 'error');
    });
    stepEl.classList.add(status);
  }

  function resetSteps() {
    ['idm-step-1','idm-step-2','idm-step-3','idm-step-4'].forEach(id => {
      const el = ui.$(id);
      if (el) el.classList.remove('running', 'success', 'error');
    });
  }

  // ─── Check IDM ────────────────────────────────────────────────────────────
  checkBtn.addEventListener('click', async () => {
    if (isCheckingIDM) return;
    isCheckingIDM = true;
    checkBtn.disabled = true;
    checkBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" class="spin">
        <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>
      </svg>
      Đang kiểm tra
    `;
    setStatus('checking', 'Đang kiểm tra...');

    try {
      const result = await ipcRenderer.invoke('idm-check-running');
      const hasDays = result.daysLeft !== null && result.daysLeft !== undefined;
      const trialInfo = hasDays
        ? ` · Còn ${result.daysLeft} ngày`
        : (result.hasRegistry ? ' · Trial hoạt động' : '');

      if (result.running) {
        const text = `IDM đang chạy${trialInfo}`;
        setStatus('running', text);
        ui.showToast(text, 'info');
      } else {
        const text = `IDM không chạy${trialInfo}`;
        setStatus('stopped', text);
        ui.showToast(text, 'info');
      }
    } catch (err) {
      setStatus('error', `Lỗi: ${err.message}`);
      ui.showToast(`Lỗi kiểm tra: ${err.message}`, 'error');
    } finally {
      checkBtn.disabled = false;
      checkBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/>
        </svg>
        Kiểm tra IDM
      `;
      isCheckingIDM = false;
    }
  });

  // ─── Reset IDM ────────────────────────────────────────────────────────────
  resetBtn.addEventListener('click', () => doReset(false));

  async function doReset(silent = false) {
    if (isResetting) return;

    if (!silent) {
      const confirmed = confirm(
        'Xác nhận reset IDM trial\n\n' +
        'Thao tác này sẽ tắt IDM, xóa registry trial và xóa thư mục cấu hình.\n\n' +
        'Bạn có chắc chắn?'
      );
      if (!confirmed) return;
    }

    isResetting = true;
    resetBtn.disabled = true;
    checkBtn.disabled = true;
    progressEl.style.display = 'block';
    stepsEl.style.display = 'block';
    resetSteps();

    showStep(1, 'running');
    setStatus('checking', 'Đang tắt IDM...');
    await delay(500);

    try {
      const result = await ipcRenderer.invoke('idm-reset-trial');

      if (result.ok) {
        showStep(1, 'success');
        await delay(300);
        showStep(2, 'running');
        setStatus('checking', 'Đang xóa registry...');
        await delay(500);
        showStep(2, 'success');
        await delay(300);
        showStep(3, 'running');
        setStatus('checking', 'Đang xóa cấu hình...');
        await delay(500);
        showStep(3, 'success');
        await delay(300);
        showStep(4, 'running');
        setStatus('checking', 'Đang hoàn tất...');
        await delay(500);
        showStep(4, 'success');

        setStatus('success', 'Reset xong · Mở lại IDM');
        ui.showToast('Reset IDM trial thành công. Mở lại IDM để áp dụng.', 'success');
        if (result.backupFile) {
          ui.showToast('Đã backup registry để khôi phục nếu cần.', 'info');
        }

        // Cập nhật lastReset
        const s = loadSchedule();
        s.lastReset = Date.now();
        saveSchedule(s);
        updateSchedulerUI(s);

        setTimeout(() => { progressEl.style.display = 'none'; }, 3000);
      } else {
        showStep(1, 'error');
        setStatus('error', `Lỗi: ${result.error}`);
        ui.showToast(`Lỗi: ${result.error}`, 'error');
        setTimeout(() => { progressEl.style.display = 'none'; stepsEl.style.display = 'none'; }, 3000);
      }
    } catch (err) {
      showStep(1, 'error');
      setStatus('error', `Lỗi: ${err.message}`);
      ui.showToast(`Lỗi: ${err.message}`, 'error');
      setTimeout(() => { progressEl.style.display = 'none'; stepsEl.style.display = 'none'; }, 3000);
    } finally {
      resetBtn.disabled = false;
      checkBtn.disabled = false;
      isResetting = false;
    }
  }

  function setStatus(cls, text) {
    statusEl.textContent = text;
    statusEl.className = `idm-status-badge ${cls}`;
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = { init };

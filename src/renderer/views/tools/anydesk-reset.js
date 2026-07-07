const { ipcRenderer } = require('electron');
const ui = require('../../ui');

function init() {
  const checkBtn   = ui.$('anydesk-check-btn');
  const resetBtn   = ui.$('anydesk-reset-btn');
  const statusEl   = ui.$('anydesk-status');
  const progressEl = ui.$('anydesk-progress');
  const stepsEl    = ui.$('anydesk-steps');
  const idText     = ui.$('anydesk-id-text');

  if (!checkBtn) return;

  let isBusy = false;

  function getFriendlyResetMessage(result) {
    if (!result) return 'Reset AnyDesk that bai.';
    if (result.needsAdmin) {
      return result.error || 'Can chay app bang Administrator de reset AnyDesk installed-service mode.';
    }
    return result.error || 'Reset AnyDesk that bai.';
  }

  function setStatus(cls, text) {
    statusEl.textContent = text;
    statusEl.className = `idm-status-badge ${cls}`;
  }

  function showStep(n, state) {
    ['anydesk-step-1','anydesk-step-2','anydesk-step-3','anydesk-step-4'].forEach(id => {
      const el = ui.$(id);
      if (el) el.classList.remove('running', 'success', 'error');
    });
    const el = ui.$(`anydesk-step-${n}`);
    if (el) el.classList.add(state);
  }

  function resetSteps() {
    ['anydesk-step-1','anydesk-step-2','anydesk-step-3','anydesk-step-4'].forEach(id => {
      const el = ui.$(id);
      if (el) el.classList.remove('running', 'success', 'error');
    });
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ─── Check ──────────────────────────────────────────────────────────────────
  checkBtn.addEventListener('click', async () => {
    if (isBusy) return;
    isBusy = true;
    checkBtn.disabled = true;
    checkBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" class="spin">
        <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>
      </svg> Đang kiểm tra`;
    setStatus('checking', 'Đang kiểm tra...');

    try {
      const r = await ipcRenderer.invoke('anydesk-check');
      if (r.id) idText.textContent = `ID: ${r.id}`;
      else idText.textContent = 'ID: chưa có';

      if (r.running) {
        setStatus('running', `Đang chạy${r.id ? ` · ID ${r.id}` : ''}`);
        ui.showToast(`AnyDesk đang chạy · ID: ${r.id || '--'}`, 'info');
      } else {
        setStatus('stopped', r.id ? `Không chạy · ID ${r.id}` : 'Không chạy');
        ui.showToast('AnyDesk không chạy', 'info');
      }
    } catch (err) {
      setStatus('error', `Lỗi: ${err.message}`);
    } finally {
      checkBtn.disabled = false;
      checkBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/>
        </svg> Kiểm tra`;
      isBusy = false;
    }
  });

  // ─── Reset ──────────────────────────────────────────────────────────────────
  resetBtn.addEventListener('click', async () => {
    if (isBusy) return;

    if (!confirm(
      'Reset AnyDesk ID?\n\n' +
      '• Các file config chứa ID sẽ bị xóa → ID mới được cấp\n' +
      '• user.conf được GIỮ NGUYÊN → tài khoản liên kết không mất\n' +
      '• Neu AnyDesk dang cai service, ban can mo app bang Administrator\n\n' +
      'Bạn có chắc chắn?'
    )) return;

    isBusy = true;
    resetBtn.disabled = true;
    checkBtn.disabled = true;
    progressEl.style.display = 'block';
    stepsEl.style.display = 'block';
    resetSteps();

    try {
      showStep(1, 'running');
      setStatus('checking', 'Đang tắt AnyDesk...');
      await delay(600);

      showStep(1, 'success');
      showStep(2, 'running');
      setStatus('checking', 'Đang backup user.conf...');
      await delay(400);

      showStep(2, 'success');
      showStep(3, 'running');
      setStatus('checking', 'Đang xóa config chứa ID...');

      const result = await ipcRenderer.invoke('anydesk-reset-id');

      if (result.ok) {
        showStep(3, 'success');
        await delay(300);
        showStep(4, 'running');
        setStatus('checking', 'Đang restore data...');
        await delay(400);
        showStep(4, 'success');

        setStatus('success', 'Reset xong · ID mới sẽ được cấp khi mở lại');
        idText.textContent = 'ID: sẽ đổi khi mở lại AnyDesk';
        ui.showToast('Reset AnyDesk ID thành công. Mở lại AnyDesk để nhận ID mới.', 'success');

        setTimeout(() => {
          progressEl.style.display = 'none';
        }, 3000);
      } else {
        showStep(3, 'error');
        const message = getFriendlyResetMessage(result);
        setStatus('error', message);
        ui.showToast(message, result.needsAdmin ? 'warning' : 'error');
        if (result.needsAdmin) {
          idText.textContent = 'ID: can chay app bang Administrator de reset installed-service mode';
        }
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
      isBusy = false;
    }
  });
}

module.exports = { init };

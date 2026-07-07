const ui = require('../ui');

const STORAGE_KEY = 'reminder-schedules';

let schedules = [];
let selectedHour = 12;
let selectedMinute = 0;
let selectedType = 'once';
let selectedSound = 'default';
let currentStep = 1;
let isInitialized = false;
let tickTimer = null;

// ─── Persistence ────────────────────────────────────────────────────────────
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    schedules = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(schedules)) schedules = [];
  } catch (_) {
    schedules = [];
  }
}

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
  } catch (_) {}
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────
function init() {
  if (isInitialized) return;

  try {
    loadFromStorage();
    bindForm();
    bindClock();
    bindSteps();
    bindRepeatOptions();
    bindSoundOptions();
    updateClockHands();
    updateStepDisplay();
    startTicker();
    isInitialized = true;
  } catch (error) {
    console.error('Scheduler init error:', error);
  }
}

function render() {
  renderSchedules();
}

function bindForm() {
  const saveBtn = ui.$('save-schedule');
  const clearBtn = ui.$('clear-schedule-form');
  if (saveBtn) saveBtn.addEventListener('click', saveSchedule);
  if (clearBtn) clearBtn.addEventListener('click', clearForm);
}

// ─── Clock ────────────────────────────────────────────────────────────────
function bindClock() {
  const clockNumbers = document.querySelectorAll('.clock-number');
  clockNumbers.forEach((num) => {
    num.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedHour = parseInt(num.dataset.hour, 10);
      updateClockHands();
      updateStepDisplay();
      setTimeout(() => goToStep(2), 300);
    });
  });

  const clockFace = document.querySelector('.clock-face');
  if (!clockFace) return;

  let isDragging = false;

  clockFace.addEventListener('click', (e) => {
    if (e.target.classList.contains('clock-number')) return;
    updateMinutesFromMouse(e);
  });
  clockFace.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('clock-number')) return;
    isDragging = true;
    updateMinutesFromMouse(e);
  });
  document.addEventListener('mousemove', (e) => {
    if (isDragging) updateMinutesFromMouse(e);
  });
  document.addEventListener('mouseup', () => { isDragging = false; });
}

function updateMinutesFromMouse(e) {
  const clockFace = document.querySelector('.clock-face');
  if (!clockFace) return;

  const rect = clockFace.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
  let degrees = angle * (180 / Math.PI);
  degrees = (degrees + 90 + 360) % 360;

  selectedMinute = Math.round(degrees / 6);
  if (selectedMinute >= 60) selectedMinute = 0;

  updateClockHands();
  updateStepDisplay();
}

function updateClockHands() {
  const hourHand = ui.$('clock-hour');
  const minuteHand = ui.$('clock-minute');
  if (hourHand) {
    const hourAngle = (selectedHour % 12) * 30 + (selectedMinute / 60) * 30;
    hourHand.style.transform = `rotate(${hourAngle}deg)`;
  }
  if (minuteHand) {
    minuteHand.style.transform = `rotate(${selectedMinute * 6}deg)`;
  }
}

// ─── Options ────────────────────────────────────────────────────────────────
function bindRepeatOptions() {
  const repeatBtns = document.querySelectorAll('.repeat-btn');
  repeatBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      repeatBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;

      const dateGroup = ui.$('date-group');
      const daysGroup = ui.$('days-group');
      if (dateGroup) dateGroup.style.display = 'none';
      if (daysGroup) daysGroup.style.display = 'none';

      if (selectedType === 'once' && dateGroup) dateGroup.style.display = 'block';
      else if (selectedType === 'weekly' && daysGroup) daysGroup.style.display = 'block';
    });
  });
}

function bindSoundOptions() {
  const soundBtns = document.querySelectorAll('.sound-btn');
  soundBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      soundBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSound = btn.dataset.sound;
    });
  });
}

// ─── Steps ────────────────────────────────────────────────────────────────
function bindSteps() {
  document.querySelectorAll('.next-step-btn').forEach((btn) => {
    btn.addEventListener('click', () => goToStep(parseInt(btn.dataset.next, 10)));
  });
  document.querySelectorAll('.prev-step-btn').forEach((btn) => {
    btn.addEventListener('click', () => goToStep(parseInt(btn.dataset.prev, 10)));
  });
  document.querySelectorAll('.minute-number').forEach((num) => {
    num.addEventListener('click', () => {
      selectedMinute = parseInt(num.dataset.minute, 10);
      updateClockHands();
      updateStepDisplay();
      setTimeout(() => goToStep(3), 300);
    });
  });
}

function goToStep(step) {
  currentStep = step;
  updateStepDisplay();
}

function updateStepDisplay() {
  document.querySelectorAll('.step').forEach((step, index) => {
    const stepNum = index + 1;
    step.classList.remove('active', 'completed');
    if (stepNum < currentStep) step.classList.add('completed');
    else if (stepNum === currentStep) step.classList.add('active');
  });

  document.querySelectorAll('.step-content').forEach((content, index) => {
    content.classList.toggle('active', index + 1 === currentStep);
  });

  const hourDisplay = ui.$('selected-hour-display');
  const minuteDisplay = ui.$('selected-minute-display');
  const finalTimeDisplay = ui.$('final-time-display');
  if (hourDisplay) hourDisplay.textContent = selectedHour;
  if (minuteDisplay) minuteDisplay.textContent = selectedMinute.toString().padStart(2, '0');
  if (finalTimeDisplay) finalTimeDisplay.textContent = formatTime();

  if (currentStep === 4) {
    const nameInput = ui.$('schedule-name');
    if (nameInput) setTimeout(() => nameInput.focus(), 100);
  }
}

function formatTime() {
  return `${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;
}

// ─── CRUD ────────────────────────────────────────────────────────────────
function saveSchedule() {
  const timeString = formatTime();
  const nameEl = ui.$('schedule-name');
  const messageEl = ui.$('schedule-message');
  const dateEl = ui.$('schedule-date');

  const schedule = {
    id: Date.now(),
    name: (nameEl && nameEl.value.trim()) || 'Lịch không tên',
    message: (messageEl && messageEl.value.trim()) || '',
    type: selectedType,
    time: timeString,
    date: dateEl && dateEl.value ? dateEl.value : new Date().toISOString().split('T')[0],
    days: getSelectedDays(),
    sound: selectedSound,
    enabled: true,
    lastFired: null
  };

  if (schedule.type === 'weekly' && schedule.days.length === 0) {
    ui.showToast('Vui lòng chọn ít nhất một ngày trong tuần', 'error');
    return;
  }

  schedules.push(schedule);
  saveToStorage();
  renderSchedules();
  clearForm();
  goToStep(1);
  ui.showToast(`Đã lưu lịch: ${schedule.name} (${schedule.time})`, 'success');
}

function getSelectedDays() {
  const group = ui.$('days-group');
  if (!group) return [];
  const selected = [];
  group.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    if (cb.checked) selected.push(parseInt(cb.value, 10));
  });
  return selected;
}

function clearForm() {
  selectedHour = 12;
  selectedMinute = 0;
  selectedType = 'once';
  selectedSound = 'default';
  updateClockHands();
  updateStepDisplay();

  const nameEl = ui.$('schedule-name');
  const dateEl = ui.$('schedule-date');
  const messageEl = ui.$('schedule-message');
  if (nameEl) nameEl.value = '';
  if (dateEl) dateEl.value = '';
  if (messageEl) messageEl.value = '';

  const daysGroup = ui.$('days-group');
  if (daysGroup) {
    daysGroup.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
  }

  document.querySelectorAll('.repeat-btn').forEach((btn) => btn.classList.remove('active'));
  const defaultRepeatBtn = document.querySelector('.repeat-btn[data-type="once"]');
  if (defaultRepeatBtn) defaultRepeatBtn.classList.add('active');

  document.querySelectorAll('.sound-btn').forEach((btn) => btn.classList.remove('active'));
  const defaultSoundBtn = document.querySelector('.sound-btn[data-sound="default"]');
  if (defaultSoundBtn) defaultSoundBtn.classList.add('active');

  const dateGroup = ui.$('date-group');
  if (dateGroup) dateGroup.style.display = 'none';
  if (daysGroup) daysGroup.style.display = 'none';
}

// ─── Render list ────────────────────────────────────────────────────────────
function renderSchedules() {
  const container = ui.$('schedule-list-container');
  const countBadge = ui.$('schedule-count');
  if (!container) return;

  if (countBadge) countBadge.textContent = schedules.length;

  if (schedules.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Chưa có lịch nào</p></div>';
    return;
  }

  container.innerHTML = schedules.map((schedule) => `
    <div class="schedule-item ${schedule.enabled ? '' : 'disabled'}">
      <div class="schedule-info">
        <h3>${ui.escapeHtml(schedule.name)}</h3>
        ${schedule.message ? `<p>${ui.escapeHtml(schedule.message)}</p>` : ''}
        <p class="schedule-time">${ui.escapeHtml(getScheduleDescription(schedule))}</p>
      </div>
      <div class="schedule-actions">
        <button data-action="toggle" data-id="${schedule.id}" class="btn btn-sm ${schedule.enabled ? 'btn-warning' : 'btn-success'}">
          ${schedule.enabled ? 'Tắt' : 'Bật'}
        </button>
        <button data-action="delete" data-id="${schedule.id}" class="btn btn-sm btn-danger">Xóa</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      if (btn.dataset.action === 'toggle') toggleSchedule(id);
      else if (btn.dataset.action === 'delete') deleteSchedule(id);
    });
  });
}

function getScheduleDescription(schedule) {
  const typeNames = { once: 'Một lần', daily: 'Hàng ngày', weekly: 'Hàng tuần', monthly: 'Hàng tháng' };
  let desc = `${typeNames[schedule.type] || 'Không xác định'} lúc ${schedule.time}`;

  if (schedule.type === 'once' && schedule.date) {
    desc += ` vào ${schedule.date}`;
  } else if (schedule.type === 'weekly' && schedule.days && schedule.days.length > 0) {
    const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    desc += ` vào ${schedule.days.map((d) => dayNames[d]).join(', ')}`;
  }

  const soundNames = { default: 'Âm mặc định', chime: 'Chuông', alert: 'Cảnh báo', none: 'Không âm' };
  desc += ` · ${soundNames[schedule.sound] || 'Không xác định'}`;
  return desc;
}

function toggleSchedule(id) {
  const schedule = schedules.find((s) => s.id === id);
  if (!schedule) return;
  schedule.enabled = !schedule.enabled;
  saveToStorage();
  renderSchedules();
}

function deleteSchedule(id) {
  schedules = schedules.filter((s) => s.id !== id);
  saveToStorage();
  renderSchedules();
  ui.showToast('Đã xóa lịch', 'info');
}

// ─── Firing engine ──────────────────────────────────────────────────────────
function startTicker() {
  if (tickTimer) clearInterval(tickTimer);
  checkDueSchedules();
  tickTimer = setInterval(checkDueSchedules, 30000);
}

function checkDueSchedules() {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const todayKey = now.toISOString().split('T')[0];
  let changed = false;

  schedules.forEach((schedule) => {
    if (!schedule.enabled || schedule.time !== currentTime) return;

    // Chống lặp: không bắn lại cùng một phút
    const firedKey = `${todayKey} ${currentTime}`;
    if (schedule.lastFired === firedKey) return;

    let shouldFire = false;
    if (schedule.type === 'daily') {
      shouldFire = true;
    } else if (schedule.type === 'monthly') {
      shouldFire = true;
    } else if (schedule.type === 'weekly') {
      shouldFire = Array.isArray(schedule.days) && schedule.days.includes(now.getDay());
    } else if (schedule.type === 'once') {
      shouldFire = schedule.date === todayKey;
    }

    if (shouldFire) {
      fireReminder(schedule);
      schedule.lastFired = firedKey;
      if (schedule.type === 'once') schedule.enabled = false;
      changed = true;
    }
  });

  if (changed) {
    saveToStorage();
    renderSchedules();
  }
}

function fireReminder(schedule) {
  const body = schedule.message || `Đã đến giờ: ${schedule.time}`;

  try {
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        new Notification(schedule.name, { body });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') new Notification(schedule.name, { body });
        });
      }
    }
  } catch (_) {}

  playSound(schedule.sound);
  ui.showToast(`🔔 ${schedule.name}: ${body}`, 'info');
}

function playSound(sound) {
  if (sound === 'none') return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const freq = sound === 'alert' ? 880 : sound === 'chime' ? 660 : 523;
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    setTimeout(() => ctx.close(), 800);
  } catch (_) {}
}

module.exports = { init, render };

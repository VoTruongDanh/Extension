// ─── DOM helper ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ─── Escape HTML ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('dismissing');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function dismissToasts(type) {
  document.querySelectorAll(`.toast.${type}`).forEach(t => t.remove());
}

// ─── Badge / status ───────────────────────────────────────────────────────────
function setStatus(el, statusState, text) {
  const dot  = el.querySelector('.status-dot');
  const span = el.querySelector('.status-text');
  const card = el.closest('.service-card');
  dot.className  = `status-dot ${statusState}`;
  span.textContent = text;
  el.classList.remove('badge-success', 'badge-secondary', 'badge-warning', 'badge-destructive');
  const map = { running: 'badge-success', stopped: 'badge-secondary', starting: 'badge-warning', error: 'badge-destructive' };
  el.classList.add(map[statusState] || 'badge-secondary');
  if (card) {
    card.classList.remove('running', 'error');
    if (statusState === 'running') card.classList.add('running');
    if (statusState === 'error')   card.classList.add('error');
  }
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
function showProgress(name) { const el = $(`${name}-progress`); if (el) el.style.display = 'block'; }
function hideProgress(name) { const el = $(`${name}-progress`); if (el) el.style.display = 'none'; }

// ─── Ripple ───────────────────────────────────────────────────────────────────
function ensureButtonContentLayer(btn) {
  const existing = Array.from(btn.childNodes).find(node =>
    node.nodeType === Node.ELEMENT_NODE && node.classList.contains('btn-content')
  );
  if (existing) return existing;

  const content = document.createElement('span');
  content.className = 'btn-content';

  Array.from(btn.childNodes)
    .filter(node => !(node.nodeType === Node.ELEMENT_NODE && node.classList.contains('ripple')))
    .forEach(node => content.appendChild(node));

  btn.appendChild(content);
  return content;
}

function initRipple() {
  document.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn || btn.disabled) return;
    ensureButtonContentLayer(btn);
    const rect   = btn.getBoundingClientRect();
    const size   = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size/2}px;top:${e.clientY - rect.top - size/2}px`;
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
}

module.exports = {
  $, escapeHtml,
  showToast, dismissToasts, setStatus,
  showProgress, hideProgress,
  initRipple
};

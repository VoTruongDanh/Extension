const { $, escapeHtml } = require('../ui');

const ICON = {
  view:  `<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"/></svg>`,
  theme: `<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>`
};

function init({ switchView, loadSettings }) {
  const overlay = $('command-overlay');
  if (!overlay) {
    console.error('Command overlay not found');
    return { addCommand: () => {} };
  }
  
  const dialog = overlay.querySelector('.command-dialog');
  if (!dialog) {
    console.error('Command dialog not found');
    return { addCommand: () => {} };
  }
  
  const input = $('command-input');
  const list = $('command-list');
  if (!input || !list) {
    console.error('Command input or list not found');
    return { addCommand: () => {} };
  }
  
  let activeIdx = -1;
  let filtered = [];

  const commands = [
    { label: 'Chuyển sang Dashboard', icon: ICON.view, action: () => switchView('dashboard') },
    { label: 'Chuyển sang Settings', icon: ICON.view, action: () => { switchView('settings'); loadSettings(); } },
    { label: 'Chuyển sang Prompt', icon: ICON.view, action: () => switchView('prompts') },
    { label: 'Chuyển sang Link', icon: ICON.view, action: () => switchView('links') },
    { label: 'Mở App Runner', icon: ICON.view, action: () => switchView('appRunner') },
    { label: 'Mở Quản lý mạng', icon: ICON.view, action: () => switchView('network') },
    { label: 'Mở Reset', icon: ICON.view, action: () => switchView('idmReset') },
    { label: 'Mở Kill Port', icon: ICON.view, action: () => switchView('killport') },
    { label: 'Mở Cloudflare Tunnel (Chia sẻ cổng)', icon: ICON.view, action: () => switchView('cloudflared') },
    { label: 'Hẹn giờ tắt máy', icon: ICON.view, action: () => switchView('shutdown') },
    { label: 'Bật/Tắt Dark Mode', icon: ICON.theme, action: () => $('theme-toggle').click() }
  ];

  function highlight(text, query) {
    if (!query) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx))
      + '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>'
      + escapeHtml(text.slice(idx + query.length));
  }

  function render(query) {
    filtered = commands.filter(command => command.label.toLowerCase().includes(query.toLowerCase()));
    activeIdx = filtered.length > 0 ? 0 : -1;
    list.innerHTML = filtered.length === 0
      ? '<li class="command-empty">Không tìm thấy lệnh</li>'
      : filtered.map((command, index) => `
          <li class="command-item${index === 0 ? ' active' : ''}" data-idx="${index}" role="option">
            <span class="command-item-icon">${command.icon}</span>
            <span>${highlight(command.label, query)}</span>
          </li>
        `).join('');

    list.querySelectorAll('.command-item').forEach((item) => {
      item.addEventListener('mouseenter', () => {
        activeIdx = Number(item.dataset.idx);
        updateActive();
      });
      item.addEventListener('click', () => {
        filtered[Number(item.dataset.idx)]?.action();
        close();
      });
    });
  }

  function updateActive() {
    list.querySelectorAll('.command-item').forEach((el, index) => {
      el.classList.toggle('active', index === activeIdx);
    });
    list.querySelector('.command-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    overlay.style.display = 'flex';
    dialog.classList.remove('closing');
    input.value = '';
    render('');
    input.focus();
  }

  function close() {
    dialog.classList.add('closing');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 150);
  }

  input.addEventListener('input', () => render(input.value));
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  document.addEventListener('keydown', (event) => {
    if (overlay.style.display !== 'none') {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
        updateActive();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        updateActive();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (activeIdx >= 0) {
          filtered[activeIdx]?.action();
          close();
        }
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        return;
      }
    }

    if (event.ctrlKey && event.key === 'k' && !event.shiftKey) {
      event.preventDefault();
      overlay.style.display !== 'none' ? close() : open();
    }
  });

  return { addCommand: (command) => commands.push(command) };
}

module.exports = { init };

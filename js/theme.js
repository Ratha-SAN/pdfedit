import { $ } from './state.js';

export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('pdfedit-theme', theme); } catch {}
  $('#theme-light').classList.toggle('active', theme === 'light');
  $('#theme-dark').classList.toggle('active', theme === 'dark');
  // Status bar / task-switcher colour of the installed app (matches --surface).
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#ffffff' : '#152d31';
}

export function initTheme() {
  // The theme itself was already applied by the inline script at the top
  // of <head> -- before first paint, so there's no flash. This just wires
  // up the buttons and syncs their active state to match.
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  $('#theme-light').addEventListener('click', () => setTheme('light'));
  $('#theme-dark').addEventListener('click', () => setTheme('dark'));
  $('#theme-light').classList.toggle('active', theme === 'light');
  $('#theme-dark').classList.toggle('active', theme === 'dark');
}

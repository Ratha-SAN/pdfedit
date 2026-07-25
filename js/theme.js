import { $ } from './state.js';

export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('pdfedit-theme', theme); } catch {}
  $('#theme-light').classList.toggle('active', theme === 'light');
  $('#theme-dark').classList.toggle('active', theme === 'dark');
}

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('pdfedit-theme'); } catch {}
  const theme = saved === 'light' ? 'light' : 'dark'; // dark is the default
  $('#theme-light').addEventListener('click', () => setTheme('light'));
  $('#theme-dark').addEventListener('click', () => setTheme('dark'));
  setTheme(theme);
}

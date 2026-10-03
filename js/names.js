/* "My names": short styled text -- usually your name, in the font and
   colour you like it in -- saved to your account and placed on any page in
   one tap, the way a saved signature is. Saved from a text box's ☆ button
   or typed straight into this dialog; placed via Insert → + Saved name.
   Like saved signatures, this exists only where sign-in does (see
   account.js); elsewhere the button stays hidden. */

import { state, $, FONT_STACKS, DEFAULT_FONT, normalizeFontId } from './state.js';
import { t } from './i18n.js';
import { accountReady, currentUser, signIn, listNames, saveName, deleteName } from './account.js';
import { armTool } from './editor.js';

let token = 0;

function setStatus(text) {
  $('#names-status').hidden = !text;
  $('#names-status').textContent = text || '';
}

function useName(n) {
  $('#names-modal').hidden = true;
  armTool(
    { type: 'text', preset: { text: n.text, fontFamily: normalizeFontId(n.fontFamily), color: n.color, fontSize: n.fontSize } },
    t('savedNameHint', { name: n.text }),
  );
}

function render(items) {
  const list = $('#names-list');
  list.innerHTML = '';
  for (const n of items) {
    const row = document.createElement('div');
    row.className = 'name-item';
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'name-use';
    use.title = t('nameUseTitle');
    use.textContent = n.text;
    use.style.fontFamily = FONT_STACKS[normalizeFontId(n.fontFamily)];
    use.style.color = n.color;
    use.addEventListener('click', () => useName(n));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'name-delete';
    del.textContent = '×';
    del.title = t('nameDeleteTitle');
    del.addEventListener('click', async () => {
      if (!confirm(t('confirmDeleteName', { name: n.text }))) return;
      del.disabled = true;
      try {
        await deleteName(n.id);
        row.remove();
        if (!list.children.length) setStatus(t('namesEmpty'));
      } catch (err) {
        del.disabled = false;
        alert(t('nameDeleteFailed', { err: err.message || err }));
      }
    });
    row.append(use, del);
    list.appendChild(row);
  }
  setStatus(items.length ? '' : t('namesEmpty'));
}

async function refresh() {
  const mine = ++token;
  const user = currentUser();
  $('#names-signin').hidden = !!user;
  $('#names-add').hidden = !user;
  $('#names-list').innerHTML = '';
  setStatus('');
  if (!user || $('#names-modal').hidden) return;
  setStatus(t('sigSavedLoading'));
  try {
    const items = await listNames();
    if (mine === token) render(items);
  } catch (err) {
    if (mine === token) setStatus(t('namesLoadFailed', { err: err.message || err }));
  }
}

export function openNamesModal() {
  $('#names-modal').hidden = false;
  refresh();
}

export function initNames() {
  $('#btn-add-saved-name').addEventListener('click', () => {
    if (state.tool && state.tool.preset) { armTool(null); return; } // toggles off like the other tools
    openNamesModal();
  });
  $('#names-signin-btn').addEventListener('click', () => signIn());
  $('#names-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#names-input');
    const text = input.value.trim();
    if (!text) return;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      // Typed here, it takes the style a new text box would get.
      await saveName({ text, fontFamily: state.lastFont || DEFAULT_FONT, color: '#000000', fontSize: 16 });
      input.value = '';
      await refresh();
    } catch (err) {
      alert(t('nameSaveFailed', { err: err.message || err }));
    } finally {
      btn.disabled = false;
    }
  });
  document.addEventListener('accountchange', () => { if (accountReady()) refresh(); });
  document.addEventListener('langchange', () => { if (!$('#names-modal').hidden) refresh(); });
}

import { state, newId, $, setHint, FONT_STACKS, FONT_FAMILY_NAME, KHMER_FONTS, LATIN_FONTS, DEFAULT_FONT, normalizeFontId } from './state.js';
import { t } from './i18n.js';
import { recognizeArea } from './ocr.js';

const DISPLAY_WIDTH = 800;

function baseWidth() {
  // Measure #main's own clientWidth (not document.body's): #main is the
  // scrolling container, so its clientWidth already excludes its vertical
  // scrollbar. Sizing against body.clientWidth instead would overshoot by
  // the scrollbar's width on browsers with classic (non-overlay)
  // scrollbars, which is enough to make the two double-page columns wrap
  // onto separate rows instead of sitting side by side.
  const avail = $('#main').clientWidth - 32;
  if (state.viewMode === 'double') return Math.min(DISPLAY_WIDTH, (avail - 24) / 2);
  return Math.min(DISPLAY_WIDTH, avail);
}

export function pageScale(page) {
  return (baseWidth() / page.vw) * state.zoom;
}

function clampPageIndex() {
  const max = Math.max(0, state.pages.length - 1);
  state.pageIndex = Math.max(0, Math.min(max, state.pageIndex));
}

function pagesForView() {
  if (state.viewMode === 'continuous') return state.pages;
  clampPageIndex();
  if (state.viewMode === 'single') {
    return state.pages[state.pageIndex] ? [state.pages[state.pageIndex]] : [];
  }
  return [state.pages[state.pageIndex], state.pages[state.pageIndex + 1]].filter(Boolean);
}

function updatePageNav() {
  const nav = $('#page-nav');
  const paginated = state.viewMode !== 'continuous';
  nav.hidden = !paginated;
  if (!paginated || !state.pages.length) return;
  clampPageIndex();
  const step = state.viewMode === 'double' ? 2 : 1;
  const from = state.pageIndex + 1;
  const to = Math.min(state.pages.length, state.pageIndex + step);
  $('#page-indicator').textContent = to > from ? `${from}–${to} / ${state.pages.length}` : `${from} / ${state.pages.length}`;
  $('#page-prev').disabled = state.pageIndex <= 0;
  $('#page-next').disabled = state.pageIndex + step >= state.pages.length;
}

export async function renderEditView() {
  const view = $('#edit-view');
  if (pageObserver) pageObserver.disconnect();
  view.innerHTML = '';
  view.classList.toggle('view-double', state.viewMode === 'double');
  updatePageNav();
  const pages = pagesForView();
  for (const page of pages) {
    view.appendChild(buildPageWrap(page, state.pages.indexOf(page)));
  }
  updatePlacingCursor();
}

function buildPageWrap(page, index) {
  const scale = pageScale(page);
  const wrap = document.createElement('div');
  wrap.className = 'page-wrap';
  wrap.dataset.pageId = page.id;
  wrap.style.width = page.vw * scale + 'px';
  wrap.style.height = page.vh * scale + 'px';

  const canvas = document.createElement('canvas');
  canvas.className = 'page-canvas';
  // Size the canvas box up front so the page occupies its correct space
  // before (and after) its bitmap exists -- otherwise lazily rendering or
  // releasing a page would shift everything below it and jump the scroll.
  canvas.style.width = page.vw * scale + 'px';
  canvas.style.height = page.vh * scale + 'px';
  wrap.appendChild(canvas);

  const num = document.createElement('div');
  num.className = 'page-num';
  num.textContent = index + 1;
  wrap.appendChild(num);

  wrap.addEventListener('pointerdown', (e) => onPagePointerDown(e, page, wrap));

  wrap._page = page;
  wrap._scale = scale;
  for (const item of page.items) wrap.appendChild(buildItemEl(item, page, wrap));
  ensurePageObserver().observe(wrap);
  return wrap;
}

/* ---------- lazy page rendering ----------
   Rendering every page up front is what made long documents unusable: a
   300-page file allocated ~950MB of canvas backing store on load and pushed
   a single toolbar click past three seconds. Pages now rasterize only when
   they come near the viewport and hand their bitmap back once they leave,
   so canvas memory tracks what's on screen instead of document length. */

let pageObserver = null;
// Render a screen or so ahead of the scroll in both directions, so pages are
// ready before they're actually visible.
const RENDER_MARGIN = '1200px 0px';

function ensurePageObserver() {
  if (!pageObserver) {
    pageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) renderWrap(entry.target);
        else releaseWrap(entry.target);
      }
    }, { root: $('#main'), rootMargin: RENDER_MARGIN });
  }
  return pageObserver;
}

async function renderWrap(wrap) {
  if (wrap._rendered || wrap._rendering) return;
  wrap._rendering = true;
  const page = wrap._page;
  const scale = wrap._scale;
  const canvas = wrap.querySelector('canvas.page-canvas');
  try {
    const src = state.sources[page.srcIndex];
    const pdfPage = await src.pdfjs.getPage(page.srcPageNum);
    // The view may have been rebuilt (zoom, mode switch, tab change) while
    // this awaited; drop the result rather than painting a stale scale.
    if (!wrap.isConnected || wrap._scale !== scale) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = pdfPage.getViewport({ scale: scale * dpr });
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = vp.width / dpr + 'px';
    canvas.style.height = vp.height / dpr + 'px';
    const task = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    wrap._task = task;
    await task.promise;
    wrap._rendered = true;
  } catch (err) {
    // A cancelled render is the normal outcome of scrolling quickly past a
    // page, not an error worth surfacing.
    if (!/cancel/i.test(err && err.message ? err.message : '')) console.error(err);
  } finally {
    wrap._task = null;
    wrap._rendering = false;
  }
}

function releaseWrap(wrap) {
  if (wrap._task) {
    try { wrap._task.cancel(); } catch {}
    wrap._task = null;
  }
  wrap._rendering = false;
  if (!wrap._rendered) return;
  const canvas = wrap.querySelector('canvas.page-canvas');
  // Zeroing the dimensions is what actually frees the bitmap; the CSS box
  // set in buildPageWrap keeps the page's footprint so layout is unchanged.
  canvas.width = 0;
  canvas.height = 0;
  wrap._rendered = false;
}

export function initViewControls() {
  $('#view-mode').addEventListener('change', (e) => {
    state.viewMode = e.target.value;
    state.pageIndex = 0;
    renderEditView();
  });
  $('#zoom-in').addEventListener('click', () => setZoom(state.zoom + 0.1));
  $('#zoom-out').addEventListener('click', () => setZoom(state.zoom - 0.1));
  $('#zoom-level').addEventListener('click', () => setZoom(1));
  $('#page-prev').addEventListener('click', () => stepPage(-1));
  $('#page-next').addEventListener('click', () => stepPage(1));

  // A two-page spread doesn't fit usefully on a phone-width screen; disable
  // the option there and fall back to continuous if it was active when the
  // window narrows (e.g. a tablet rotated to portrait).
  const narrowQuery = window.matchMedia('(max-width: 640px)');
  const doubleOption = $('#view-mode option[value="double"]');
  const applyNarrowConstraint = () => {
    doubleOption.disabled = narrowQuery.matches;
    if (narrowQuery.matches && state.viewMode === 'double') {
      state.viewMode = 'continuous';
      state.pageIndex = 0;
      $('#view-mode').value = 'continuous';
      renderEditView();
    }
  };
  narrowQuery.addEventListener('change', applyNarrowConstraint);
  applyNarrowConstraint();
}

function setZoom(z) {
  state.zoom = Math.max(0.25, Math.min(3, Math.round(z * 100) / 100));
  $('#zoom-level').textContent = Math.round(state.zoom * 100) + '%';
  renderEditView();
}

function stepPage(dir) {
  const step = state.viewMode === 'double' ? 2 : 1;
  const max = Math.max(0, state.pages.length - 1);
  state.pageIndex = Math.max(0, Math.min(max, state.pageIndex + dir * step));
  renderEditView();
}

/* ---------- tools ---------- */

export function armTool(tool, hint) {
  state.tool = tool;
  setHint(hint || null);
  document.querySelectorAll('#edit-tools button, #ocr-tools button').forEach((b) => b.classList.remove('tool-armed'));
  if (tool) {
    if (tool.type === 'text') $('#btn-add-text').classList.add('tool-armed');
    if (tool.type === 'stamp' && tool.kind === 'image') $('#btn-add-image').classList.add('tool-armed');
    if (tool.type === 'stamp' && tool.kind === 'signature') $('#btn-add-signature').classList.add('tool-armed');
    if (tool.type === 'highlight') $('#btn-add-highlight').classList.add('tool-armed');
    if (tool.type === 'ocr-area') $('#mi-ocr-area').classList.add('tool-armed');
  }
  updatePlacingCursor();
}

function updatePlacingCursor() {
  document.querySelectorAll('.page-wrap').forEach((w) => w.classList.toggle('placing', !!state.tool));
}

function onPagePointerDown(e, page, wrap) {
  if (e.target !== wrap && !e.target.classList.contains('page-canvas')) return;
  deselectAll();
  if (!state.tool) return;
  e.preventDefault();
  if (state.tool.type === 'highlight') {
    startHighlightDraw(e, page, wrap);
    return;
  }
  if (state.tool.type === 'ocr-area') {
    startOcrAreaSelect(e, page, wrap);
    return;
  }
  const scale = pageScale(page);
  const rect = wrap.getBoundingClientRect();
  const x = (e.clientX - rect.left) / scale;
  const y = (e.clientY - rect.top) / scale;
  let item;
  if (state.tool.type === 'text') {
    item = { id: newId(), type: 'text', x, y, text: '', fontSize: 16, color: '#000000', fontFamily: state.lastFont || DEFAULT_FONT };
  } else {
    const t = state.tool;
    let w = Math.min(t.natW * 0.75, page.vw * 0.5);
    let h = w * (t.natH / t.natW);
    item = { id: newId(), type: t.kind, x: Math.min(x, page.vw - w), y: Math.min(y, page.vh - h), w, h, dataUrl: t.dataUrl, natW: t.natW, natH: t.natH };
  }
  page.items.push(item);
  const el = buildItemEl(item, page, wrap);
  wrap.appendChild(el);
  selectItem(el);
  if (item.type === 'text') {
    const tc = el.querySelector('.text-content');
    startTextEdit(tc);
  }
  armTool(null);
}

function startHighlightDraw(e, page, wrap) {
  const scale = pageScale(page);
  const rect = wrap.getBoundingClientRect();
  const startX = (e.clientX - rect.left) / scale;
  const startY = (e.clientY - rect.top) / scale;
  const item = { id: newId(), type: 'highlight', x: startX, y: startY, w: 0, h: 0, color: state.tool.color };
  page.items.push(item);
  const el = buildItemEl(item, page, wrap);
  wrap.appendChild(el);

  const move = (ev) => {
    const curX = Math.max(0, Math.min(page.vw, (ev.clientX - rect.left) / scale));
    const curY = Math.max(0, Math.min(page.vh, (ev.clientY - rect.top) / scale));
    item.x = Math.min(startX, curX);
    item.y = Math.min(startY, curY);
    item.w = Math.abs(curX - startX);
    item.h = Math.abs(curY - startY);
    el.style.left = item.x * scale + 'px';
    el.style.top = item.y * scale + 'px';
    el.style.width = item.w * scale + 'px';
    el.style.height = item.h * scale + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (item.w < 6 || item.h < 6) {
      item.w = Math.min(140, page.vw - item.x);
      item.h = Math.min(20, page.vh - item.y);
      el.style.width = item.w * scale + 'px';
      el.style.height = item.h * scale + 'px';
    }
    selectItem(el);
    armTool(null);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// Drag a rectangle to OCR just that area. Unlike a highlight, this is
// ephemeral -- nothing is added to page.items or saved to the exported
// PDF, the box only exists as visual feedback while dragging.
function startOcrAreaSelect(e, page, wrap) {
  const scale = pageScale(page);
  const rect = wrap.getBoundingClientRect();
  const startX = (e.clientX - rect.left) / scale;
  const startY = (e.clientY - rect.top) / scale;
  const box = document.createElement('div');
  box.className = 'ocr-select-box';
  wrap.appendChild(box);

  let x = startX, y = startY, w = 0, h = 0;
  const update = () => {
    box.style.left = x * scale + 'px';
    box.style.top = y * scale + 'px';
    box.style.width = w * scale + 'px';
    box.style.height = h * scale + 'px';
  };
  update();

  const move = (ev) => {
    const curX = Math.max(0, Math.min(page.vw, (ev.clientX - rect.left) / scale));
    const curY = Math.max(0, Math.min(page.vh, (ev.clientY - rect.top) / scale));
    x = Math.min(startX, curX);
    y = Math.min(startY, curY);
    w = Math.abs(curX - startX);
    h = Math.abs(curY - startY);
    update();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    box.remove();
    armTool(null);
    if (w < 12 || h < 12) return; // too small to be a deliberate selection
    recognizeArea(page, { x, y, w, h });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

export function deselectAll() {
  document.querySelectorAll('.item.selected').forEach((el) => {
    el.classList.remove('selected');
    const tc = el.querySelector('.text-content');
    if (tc) stopTextEdit(tc);
  });
}

function selectItem(el) {
  deselectAll();
  el.classList.add('selected');
}

function startTextEdit(tc) {
  tc.contentEditable = 'plaintext-only';
  tc.style.cursor = 'text';
  tc.focus();
}

function stopTextEdit(tc) {
  tc.contentEditable = 'false';
  tc.style.cursor = '';
  tc.blur();
}

/* ---------- item DOM ---------- */

// Two labelled groups so the (long) list stays navigable, with each option
// previewed in its own face.
function fontOptionsHtml() {
  const opt = (f) => `<option value="${f.id}" style="font-family:${FONT_STACKS[f.id]}">${f.label}</option>`;
  return `<optgroup label="${t('fontGroupKhmer')}">${KHMER_FONTS.map(opt).join('')}</optgroup>` +
         `<optgroup label="${t('fontGroupLatin')}">${LATIN_FONTS.map(opt).join('')}</optgroup>`;
}

function buildItemEl(item, page, wrap) {
  const scale = pageScale(page);
  const el = document.createElement('div');
  el.className = 'item';
  el.dataset.itemId = item.id;

  if (item.type === 'text') {
    item.fontFamily = normalizeFontId(item.fontFamily);
    const tc = document.createElement('div');
    tc.className = 'text-content';
    tc.contentEditable = 'false';
    tc.innerText = item.text;
    tc.style.fontSize = item.fontSize * scale + 'px';
    tc.style.color = item.color;
    tc.style.fontFamily = FONT_STACKS[item.fontFamily];
    tc.addEventListener('input', () => {
      item.text = tc.innerText.replace(/\n$/, '');
      syncTextSize(item, el, scale);
    });
    tc.addEventListener('blur', () => {
      if (!item.text.trim()) removeItem(item, page, el);
    });
    el.appendChild(tc);

    const tb = document.createElement('div');
    tb.className = 'item-toolbar';
    tb.innerHTML = `<label>${t('itemSizeLabel')} <input type="number" min="6" max="120" step="1" value="${item.fontSize}"></label>
      <button class="item-edit" title="${t('itemEditTitle')}" aria-pressed="false">${t('itemEditLabel')}</button>
      <select title="${t('itemFontTitle')}">${fontOptionsHtml()}</select>
      <input type="color" value="${item.color}" title="${t('itemTextColorTitle')}">`;
    const sizeInput = tb.querySelector('input[type=number]');
    sizeInput.addEventListener('input', () => {
      item.fontSize = Math.max(6, Math.min(120, Number(sizeInput.value) || 16));
      tc.style.fontSize = item.fontSize * scale + 'px';
      syncTextSize(item, el, scale);
    });
    const editBtn = tb.querySelector('.item-edit');
    const syncEditBtn = () => {
      const on = tc.isContentEditable;
      editBtn.classList.toggle('editing', on);
      editBtn.setAttribute('aria-pressed', String(on));
    };
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (tc.isContentEditable) stopTextEdit(tc); else startTextEdit(tc);
      syncEditBtn();
    });
    tc.addEventListener('focus', syncEditBtn);
    tc.addEventListener('blur', () => requestAnimationFrame(syncEditBtn));

    const fontSelect = tb.querySelector('select');
    fontSelect.value = item.fontFamily;
    fontSelect.addEventListener('change', async () => {
      item.fontFamily = fontSelect.value;
      // Remember the choice so the next text box starts with the same font.
      state.lastFont = item.fontFamily;
      tc.style.fontFamily = FONT_STACKS[item.fontFamily];
      // A newly-picked webfont may not be loaded yet; re-measure once it is,
      // otherwise the stored w/h (used for export placement) reflects the
      // fallback font's metrics rather than the chosen one's.
      syncTextSize(item, el, scale);
      try {
        await document.fonts.load(`400 ${item.fontSize * scale}px "${FONT_FAMILY_NAME[item.fontFamily]}"`, tc.innerText || 'A');
        syncTextSize(item, el, scale);
      } catch {}
    });
    const colorInput = tb.querySelector('input[type=color]');
    colorInput.addEventListener('input', () => {
      item.color = colorInput.value;
      tc.style.color = item.color;
    });
    tb.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.appendChild(tb);
  } else if (item.type === 'highlight') {
    el.classList.add('item-highlight');
    const fill = document.createElement('div');
    fill.className = 'highlight-fill';
    fill.style.background = item.color;
    el.appendChild(fill);
    el.style.width = item.w * scale + 'px';
    el.style.height = item.h * scale + 'px';

    const tb = document.createElement('div');
    tb.className = 'item-toolbar';
    tb.innerHTML = `<input type="color" value="${item.color}" title="${t('itemHighlightColorTitle')}">`;
    const colorInput = tb.querySelector('input[type=color]');
    colorInput.addEventListener('input', () => {
      item.color = colorInput.value;
      fill.style.background = item.color;
    });
    tb.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.appendChild(tb);
  } else {
    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.draggable = false;
    el.appendChild(img);
    el.style.width = item.w * scale + 'px';
    el.style.height = item.h * scale + 'px';
  }

  el.style.left = item.x * scale + 'px';
  el.style.top = item.y * scale + 'px';

  const del = document.createElement('button');
  del.className = 'item-del';
  del.textContent = '×';
  del.title = t('itemDeleteTitle');
  del.addEventListener('pointerdown', (e) => e.stopPropagation());
  del.addEventListener('click', () => removeItem(item, page, el));
  el.appendChild(del);

  const rz = document.createElement('div');
  rz.className = 'item-resize';
  rz.title = t('itemResizeTitle');
  rz.addEventListener('pointerdown', (e) => startResize(e, item, page, el));
  el.appendChild(rz);

  el.addEventListener('pointerdown', (e) => {
    const tc = el.querySelector('.text-content');
    if (tc && tc.isContentEditable) { e.stopPropagation(); return; }
    e.stopPropagation();

    if (item.type === 'text' && e.pointerType === 'mouse' && el.classList.contains('selected')) {
      // Already selected (this is at least the second mouse interaction
      // with it): let the browser's own mousedown-drag select the text,
      // like any ordinary text, instead of moving the box again.
      startTextEdit(tc);
      return;
    }

    if (item.type === 'text' && e.pointerType !== 'mouse') {
      // Touch/pen: a quick tap-drag still repositions the box (unchanged
      // behavior); holding still starts text selection instead, mirroring
      // how native mobile text fields use long-press to select.
      e.preventDefault();
      selectItem(el);
      const startX = e.clientX, startY = e.clientY;
      const timer = setTimeout(() => {
        cleanup();
        startTextEdit(tc);
        if (navigator.vibrate) navigator.vibrate(10);
      }, 450);
      const onMove = (ev) => {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) {
          clearTimeout(timer);
          cleanup();
          startDrag(e, item, page, el);
        }
      };
      const onUp = () => { clearTimeout(timer); cleanup(); };
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    e.preventDefault();
    selectItem(el);
    startDrag(e, item, page, el);
  });
  el.addEventListener('dblclick', () => {
    const tc = el.querySelector('.text-content');
    if (tc) startTextEdit(tc);
  });

  if (item.type === 'text') {
    requestAnimationFrame(() => syncTextSize(item, el, scale));
  }
  return el;
}

// Patches translated text/tooltips on already-placed items in place, rather
// than re-rendering the whole page (which would rebuild every canvas and
// drop the current selection/in-progress text edit).
export function refreshEditI18n() {
  document.querySelectorAll('.item .item-toolbar label').forEach((label) => {
    if (label.firstChild) label.firstChild.textContent = t('itemSizeLabel') + ' ';
  });
  document.querySelectorAll('.item .item-toolbar input[type=color]').forEach((input) => {
    const isHighlight = input.closest('.item').classList.contains('item-highlight');
    input.title = isHighlight ? t('itemHighlightColorTitle') : t('itemTextColorTitle');
  });
  document.querySelectorAll('.item .item-toolbar select').forEach((select) => {
    select.title = t('itemFontTitle');
    // Font names themselves are proper nouns and stay as-is; only the two
    // group headings are translated.
    const groups = select.querySelectorAll('optgroup');
    if (groups[0]) groups[0].label = t('fontGroupKhmer');
    if (groups[1]) groups[1].label = t('fontGroupLatin');
  });
  document.querySelectorAll('.item .item-edit').forEach((el) => {
    el.title = t('itemEditTitle');
    el.textContent = t('itemEditLabel');
  });
  document.querySelectorAll('.item .item-del').forEach((el) => { el.title = t('itemDeleteTitle'); });
  document.querySelectorAll('.item .item-resize').forEach((el) => { el.title = t('itemResizeTitle'); });
}

function syncTextSize(item, el, scale) {
  const tc = el.querySelector('.text-content');
  item.w = tc.offsetWidth / scale;
  item.h = tc.offsetHeight / scale;
}

function removeItem(item, page, el) {
  page.items = page.items.filter((i) => i !== item);
  el.remove();
}

function startDrag(e, item, page, el) {
  const scale = pageScale(page);
  const startX = e.clientX, startY = e.clientY;
  const origX = item.x, origY = item.y;
  const move = (ev) => {
    item.x = Math.max(0, Math.min(page.vw - (item.w || 20), origX + (ev.clientX - startX) / scale));
    item.y = Math.max(0, Math.min(page.vh - (item.h || 20), origY + (ev.clientY - startY) / scale));
    el.style.left = item.x * scale + 'px';
    el.style.top = item.y * scale + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function startResize(e, item, page, el) {
  e.stopPropagation();
  e.preventDefault();
  const scale = pageScale(page);
  const startX = e.clientX, startY = e.clientY;
  const origW = item.w, origH = item.h, origFs = item.fontSize;
  const tc = el.querySelector('.text-content');
  const sizeInput = el.querySelector('.item-toolbar input[type=number]');
  const move = (ev) => {
    if (item.type === 'text') {
      const factor = Math.max(0.1, (origW + (ev.clientX - startX) / scale) / origW);
      item.fontSize = Math.max(6, Math.min(120, Math.round(origFs * factor)));
      tc.style.fontSize = item.fontSize * scale + 'px';
      if (sizeInput) sizeInput.value = item.fontSize;
      syncTextSize(item, el, scale);
    } else if (item.type === 'highlight') {
      item.w = Math.max(8, origW + (ev.clientX - startX) / scale);
      item.h = Math.max(8, origH + (ev.clientY - startY) / scale);
      el.style.width = item.w * scale + 'px';
      el.style.height = item.h * scale + 'px';
    } else {
      const factor = Math.max(0.1, (origW + (ev.clientX - startX) / scale) / origW);
      item.w = Math.max(12, origW * factor);
      item.h = item.w * (item.natH / item.natW);
      el.style.width = item.w * scale + 'px';
      el.style.height = item.h * scale + 'px';
    }
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ---------- current page (for OCR) ---------- */

export function currentPage() {
  const wraps = [...document.querySelectorAll('#edit-view .page-wrap')];
  if (!wraps.length) return state.pages[0] || null;
  const mid = window.innerHeight / 2;
  let best = null, bestDist = Infinity;
  for (const w of wraps) {
    const r = w.getBoundingClientRect();
    const center = r.top + r.height / 2;
    const dist = Math.abs(center - mid);
    if (dist < bestDist) { bestDist = dist; best = w; }
  }
  return state.pages.find((p) => p.id == best.dataset.pageId) || null;
}

/* ---------- signature modal ---------- */

let sigDirty = false;

export function initSignatureModal(onReady) {
  const modal = $('#sig-modal');
  const canvas = $('#sig-canvas');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1a1a2e';
  let drawing = false;

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    sigDirty = true;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y + 0.01);
    ctx.stroke();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  });
  canvas.addEventListener('pointerup', () => { drawing = false; });

  $('#sig-clear').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sigDirty = false;
  });
  $('#sig-upload').addEventListener('click', () => $('#sig-upload-input').click());
  $('#sig-upload-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    const img = await loadImage(dataUrl);
    modal.hidden = true;
    onReady({ dataUrl, natW: img.naturalWidth, natH: img.naturalHeight });
  });
  $('#sig-use').addEventListener('click', () => {
    if (!sigDirty) return;
    const trimmed = trimCanvas(canvas);
    modal.hidden = true;
    onReady({ dataUrl: trimmed.toDataURL('image/png'), natW: trimmed.width, natH: trimmed.height });
  });
}

export function openSignatureModal() {
  const canvas = $('#sig-canvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  sigDirty = false;
  $('#sig-modal').hidden = false;
}

function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

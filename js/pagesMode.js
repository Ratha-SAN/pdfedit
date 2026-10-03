import { state, $, showBusy, hideBusy, addSource, addDoc, activeDoc } from './state.js';
import { t } from './i18n.js';
import { renderDocTabs } from './app.js';

const THUMB_WIDTH = 150;
const selected = new Set();
let dragIndex = null;
let touchDragIndex = null;

/* Phone layout: thumbnails sized to fill the screen width, two per row
   (grid) or one (column), the choice remembered. Wider screens keep the
   fixed-size wrapping grid. */
const phone = window.matchMedia('(max-width: 640px)');
const LAYOUT_KEY = 'pdfedit-thumb-layout';
let phoneLayout = 'grid';
try { if (localStorage.getItem(LAYOUT_KEY) === 'column') phoneLayout = 'column'; } catch {}

function thumbWidth() {
  if (!phone.matches) return THUMB_WIDTH;
  const view = $('#pages-view');
  const cs = getComputedStyle(view);
  const inner = view.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const cols = phoneLayout === 'column' ? 1 : 2;
  const cell = (inner - (parseFloat(cs.columnGap) || 0) * (cols - 1)) / cols;
  return Math.max(60, Math.floor(cell - 16)); // less the thumb's own padding (2x6) + border (2x2)
}

function syncLayoutToggle() {
  document.querySelectorAll('#pages-layout [data-layout]').forEach((b) => {
    const on = b.dataset.layout === phoneLayout;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

export async function renderPagesView() {
  const view = $('#pages-view');
  if (thumbObserver) thumbObserver.disconnect();
  view.innerHTML = '';
  view.classList.toggle('layout-column', phone.matches && phoneLayout === 'column');
  syncLayoutToggle();
  selected.clear();
  updateRemoveButton();
  updateSplitButtons();
  const width = thumbWidth();
  state.pages.forEach((page, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.draggable = true;
    thumb.dataset.index = idx;
    thumb.dataset.pageId = page.id;

    const canvas = document.createElement('canvas');
    // Sized up front from the page's shape, so the grid has its final
    // layout before any thumbnail is drawn (and lazy drawing never shifts it).
    canvas.style.width = width + 'px';
    canvas.style.height = Math.round(width * page.vh / page.vw) + 'px';
    thumb.appendChild(canvas);

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'thumb-check';
    check.title = t('selectPageTitle');
    check.addEventListener('change', () => {
      if (check.checked) selected.add(page.id); else selected.delete(page.id);
      thumb.classList.toggle('selected', check.checked);
      updateRemoveButton();
      updateSplitButtons();
    });
    thumb.appendChild(check);

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = `${t('page')} ${idx + 1}`;
    thumb.appendChild(label);

    // Mouse: native HTML5 drag-and-drop.
    thumb.addEventListener('dragstart', () => { dragIndex = idx; });
    thumb.addEventListener('dragover', (e) => {
      e.preventDefault();
      thumb.classList.add('drag-over');
    });
    thumb.addEventListener('dragleave', () => thumb.classList.remove('drag-over'));
    thumb.addEventListener('drop', (e) => {
      e.preventDefault();
      thumb.classList.remove('drag-over');
      if (dragIndex === null || dragIndex === idx) return;
      const [moved] = state.pages.splice(dragIndex, 1);
      state.pages.splice(idx, 0, moved);
      dragIndex = null;
      renderPagesView();
    });

    // Touch/pen: HTML5 drag-and-drop isn't usable on touchscreens (iOS
    // Safari doesn't fire it at all for `draggable`), so reorder via
    // pointer events instead. Mouse is left to the native DnD above.
    // Press and hold to pick a page up; a plain swipe scrolls, like any
    // phone list -- with full-width thumbnails there's nowhere else to
    // swipe, so starting a drag on touch-down made the list unscrollable.
    let press = null;
    thumb.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('.thumb-check')) return;
      const { pointerId, clientX, clientY } = e;
      press = {
        x: clientX, y: clientY,
        timer: setTimeout(() => {
          press = null;
          touchDragIndex = idx;
          thumb.classList.add('dragging');
          try { thumb.setPointerCapture(pointerId); } catch {}
          if (navigator.vibrate) navigator.vibrate(10);
        }, 350),
      };
    });
    const cancelPress = () => { if (press) { clearTimeout(press.timer); press = null; } };
    thumb.addEventListener('pointercancel', () => {
      cancelPress();
      if (touchDragIndex !== null) { touchDragIndex = null; thumb.classList.remove('dragging'); }
    });
    // Once a page is picked up, the finger moves it rather than the list.
    thumb.addEventListener('touchmove', (e) => { if (touchDragIndex !== null) e.preventDefault(); }, { passive: false });
    thumb.addEventListener('contextmenu', (e) => { if (e.pointerType !== 'mouse') e.preventDefault(); });
    thumb.addEventListener('pointermove', (e) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) cancelPress();
      if (touchDragIndex === null || e.pointerType === 'mouse') return;
      document.querySelectorAll('.thumb.drag-over').forEach((t) => t.classList.remove('drag-over'));
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.thumb');
      if (target && target !== thumb) target.classList.add('drag-over');
    });
    thumb.addEventListener('pointerup', (e) => {
      cancelPress();
      if (touchDragIndex === null || e.pointerType === 'mouse') return;
      thumb.classList.remove('dragging');
      document.querySelectorAll('.thumb.drag-over').forEach((t) => t.classList.remove('drag-over'));
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.thumb');
      const dropIndex = target ? Number(target.dataset.index) : null;
      const fromIndex = touchDragIndex;
      touchDragIndex = null;
      if (dropIndex === null || dropIndex === fromIndex) return;
      const [moved] = state.pages.splice(fromIndex, 1);
      state.pages.splice(dropIndex, 0, moved);
      renderPagesView();
    });

    thumb._page = page;
    view.appendChild(thumb);
    ensureThumbObserver().observe(thumb);
  });
  document.dispatchEvent(new CustomEvent('pagesrendered'));
}

/* Thumbnails are lazily rendered for the same reason pages are: a long
   document would otherwise rasterize every thumbnail on entering Pages
   mode. Unlike page canvases these are small, so they're kept once drawn
   (no release path) -- the cost that mattered was the upfront burst. */
let thumbObserver = null;
function ensureThumbObserver() {
  if (!thumbObserver) {
    thumbObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const thumb = entry.target;
        if (thumb._drawn) continue;
        thumb._drawn = true;
        const canvas = thumb.querySelector('canvas');
        renderThumb(thumb._page, canvas, parseFloat(canvas.style.width));
        thumbObserver.unobserve(thumb);
      }
    }, { root: $('#pages-view'), rootMargin: '600px 0px' });
  }
  return thumbObserver;
}

async function renderThumb(page, canvas, width) {
  const src = state.sources[page.srcIndex];
  const pdfPage = await src.pdfjs.getPage(page.srcPageNum);
  // Same dpr-aware rendering as the main edit view's pages, floored and
  // capped the same way -- without the floor a thumbnail rendered at exactly
  // THUMB_WIDTH css pixels looked soft even on a plain 1x screen, since a
  // thumbnail is tiny to begin with and a 1:1 raster leaves no room for
  // antialiasing to work with.
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
  const scale = (width / page.vw) * dpr;
  const vp = pdfPage.getViewport({ scale });
  canvas.width = vp.width;
  canvas.height = vp.height;
  canvas.style.width = vp.width / dpr + 'px';
  canvas.style.height = vp.height / dpr + 'px';
  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
}

function updateRemoveButton() {
  const btn = $('#btn-remove-pages');
  btn.disabled = selected.size === 0 || selected.size >= state.pages.length;
  btn.textContent = selected.size ? t('removeSelectedCount', { n: selected.size }) : t('removeSelected');
}

// Splitting needs exactly one page picked as the boundary; further disabled
// if that boundary would leave one side empty (e.g. "before" on the very
// first page, "after" on the very last).
function updateSplitButtons() {
  const beforeBtn = $('#btn-split-before');
  const afterBtn = $('#btn-split-after');
  if (selected.size !== 1) {
    beforeBtn.disabled = true;
    afterBtn.disabled = true;
    return;
  }
  const [pageId] = selected;
  const idx = state.pages.findIndex((p) => p.id === pageId);
  beforeBtn.disabled = idx <= 0;
  afterBtn.disabled = idx < 0 || idx >= state.pages.length - 1;
}

function splitBaseName(name) {
  const m = name.match(/^(.*)(\.[^./]+)$/);
  return m ? [m[1], m[2]] : [name, ''];
}

// Splits the active document into two documents (two tabs) at the selected
// page, sharing the same underlying sources -- each page object already
// carries its own srcIndex/srcPageNum into that shared array, so no bytes
// need copying or re-decoding. The first part keeps the current tab
// (and focus); the second part becomes a new tab alongside it.
function splitDocument(includeSelectedInFirst) {
  if (selected.size !== 1) return;
  const [pageId] = selected;
  const idx = state.pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return;
  const splitIndex = includeSelectedInFirst ? idx + 1 : idx;
  if (splitIndex <= 0 || splitIndex >= state.pages.length) return;

  const doc = activeDoc();
  const [base, ext] = splitBaseName(doc.name);
  const partA = state.pages.slice(0, splitIndex);
  const partB = state.pages.slice(splitIndex);
  const sources = doc.sources;
  const keepId = doc.id;

  doc.name = `${base} (1)${ext}`;
  doc.pages = partA;

  const newDoc = addDoc(`${base} (2)${ext}`);
  newDoc.sources = sources;
  newDoc.pages = partB;

  state.activeDocId = keepId; // stay on the first part rather than jump to the new tab
  selected.clear();
  renderDocTabs();
  renderPagesView();
}

// Patches translated labels on already-rendered thumbnails in place, rather
// than re-rendering the grid (which would drop the current selection).
export function refreshPagesI18n() {
  document.querySelectorAll('.thumb').forEach((thumb) => {
    const label = thumb.querySelector('.thumb-label');
    if (label) label.textContent = `${t('page')} ${Number(thumb.dataset.index) + 1}`;
    const check = thumb.querySelector('.thumb-check');
    if (check) check.title = t('selectPageTitle');
  });
  updateRemoveButton();
  updateSplitButtons();
}

export function initPagesMode() {
  document.querySelectorAll('#pages-layout [data-layout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.layout === phoneLayout) return;
      phoneLayout = btn.dataset.layout;
      try { localStorage.setItem(LAYOUT_KEY, phoneLayout); } catch {}
      renderPagesView();
    });
  });
  // Thumbnails are drawn at a width measured from the screen, so redraw
  // when that changes (rotation, entering/leaving the phone layout).
  // Width only: a phone also fires resize whenever its address bar slides
  // in or out while scrolling, and redrawing then would drop the selection.
  let resizeTimer = null;
  let lastWidth = 0;
  const relayout = () => {
    const view = $('#pages-view');
    if (state.mode !== 'pages' || view.hidden || view.clientWidth === lastWidth) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderPagesView, 150);
  };
  document.addEventListener('pagesrendered', () => { lastWidth = $('#pages-view').clientWidth; });
  phone.addEventListener('change', relayout);
  window.addEventListener('resize', relayout);

  $('#btn-remove-pages').addEventListener('click', () => {
    if (selected.size >= state.pages.length) return;
    state.pages = state.pages.filter((p) => !selected.has(p.id));
    renderPagesView();
  });

  $('#btn-split-before').addEventListener('click', () => splitDocument(false));
  $('#btn-split-after').addEventListener('click', () => splitDocument(true));

  $('#btn-append-pdf').addEventListener('click', () => $('#append-input').click());
  $('#append-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    showBusy(t('loadingPdf'));
    try {
      const pages = await addSource(file);
      state.pages.push(...pages);
      await renderPagesView();
    } catch (err) {
      alert(t('couldNotReadPdf', { err: err.message }));
    } finally {
      hideBusy();
    }
  });
}

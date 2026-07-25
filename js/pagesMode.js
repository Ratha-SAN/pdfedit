import { state, $, showBusy, hideBusy, addSource } from './state.js';
import { t } from './i18n.js';

const THUMB_WIDTH = 150;
const selected = new Set();
let dragIndex = null;
let touchDragIndex = null;

export async function renderPagesView() {
  const view = $('#pages-view');
  if (thumbObserver) thumbObserver.disconnect();
  view.innerHTML = '';
  selected.clear();
  updateRemoveButton();
  state.pages.forEach((page, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.draggable = true;
    thumb.dataset.index = idx;
    thumb.dataset.pageId = page.id;

    const canvas = document.createElement('canvas');
    thumb.appendChild(canvas);

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'thumb-check';
    check.title = t('selectPageTitle');
    check.addEventListener('change', () => {
      if (check.checked) selected.add(page.id); else selected.delete(page.id);
      thumb.classList.toggle('selected', check.checked);
      updateRemoveButton();
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
    thumb.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('.thumb-check')) return;
      touchDragIndex = idx;
      thumb.classList.add('dragging');
      try { thumb.setPointerCapture(e.pointerId); } catch {}
    });
    thumb.addEventListener('pointermove', (e) => {
      if (touchDragIndex === null || e.pointerType === 'mouse') return;
      document.querySelectorAll('.thumb.drag-over').forEach((t) => t.classList.remove('drag-over'));
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.thumb');
      if (target && target !== thumb) target.classList.add('drag-over');
    });
    thumb.addEventListener('pointerup', (e) => {
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
        renderThumb(thumb._page, thumb.querySelector('canvas'));
        thumbObserver.unobserve(thumb);
      }
    }, { root: $('#pages-view'), rootMargin: '600px 0px' });
  }
  return thumbObserver;
}

async function renderThumb(page, canvas) {
  const src = state.sources[page.srcIndex];
  const pdfPage = await src.pdfjs.getPage(page.srcPageNum);
  const scale = THUMB_WIDTH / page.vw;
  const vp = pdfPage.getViewport({ scale });
  canvas.width = vp.width;
  canvas.height = vp.height;
  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
}

function updateRemoveButton() {
  const btn = $('#btn-remove-pages');
  btn.disabled = selected.size === 0 || selected.size >= state.pages.length;
  btn.textContent = selected.size ? t('removeSelectedCount', { n: selected.size }) : t('removeSelected');
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
}

export function initPagesMode() {
  $('#btn-remove-pages').addEventListener('click', () => {
    if (selected.size >= state.pages.length) return;
    state.pages = state.pages.filter((p) => !selected.has(p.id));
    renderPagesView();
  });

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

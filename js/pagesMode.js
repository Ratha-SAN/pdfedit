import { state, $, showBusy, hideBusy, addSource } from './state.js';

const THUMB_WIDTH = 150;
const selected = new Set();
let dragIndex = null;

export async function renderPagesView() {
  const view = $('#pages-view');
  view.innerHTML = '';
  selected.clear();
  updateRemoveButton();
  state.pages.forEach((page, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.draggable = true;
    thumb.dataset.index = idx;

    const canvas = document.createElement('canvas');
    thumb.appendChild(canvas);

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'thumb-check';
    check.title = 'Select page';
    check.addEventListener('change', () => {
      if (check.checked) selected.add(page.id); else selected.delete(page.id);
      thumb.classList.toggle('selected', check.checked);
      updateRemoveButton();
    });
    thumb.appendChild(check);

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = `Page ${idx + 1}`;
    thumb.appendChild(label);

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

    view.appendChild(thumb);
    renderThumb(page, canvas);
  });
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
  btn.textContent = selected.size ? `Remove selected (${selected.size})` : 'Remove selected';
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
    showBusy('Loading PDF…');
    try {
      const pages = await addSource(file);
      state.pages.push(...pages);
      await renderPagesView();
    } catch (err) {
      alert('Could not read that PDF: ' + err.message);
    } finally {
      hideBusy();
    }
  });
}

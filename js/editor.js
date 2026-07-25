import { state, newId, $, setHint } from './state.js';

const DISPLAY_WIDTH = 800;

function baseWidth() {
  const avail = document.body.clientWidth - 32;
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
  view.innerHTML = '';
  view.classList.toggle('view-double', state.viewMode === 'double');
  updatePageNav();
  for (const page of pagesForView()) {
    view.appendChild(buildPageWrap(page));
  }
  updatePlacingCursor();
}

function buildPageWrap(page) {
  const scale = pageScale(page);
  const wrap = document.createElement('div');
  wrap.className = 'page-wrap';
  wrap.dataset.pageId = page.id;
  wrap.style.width = page.vw * scale + 'px';
  wrap.style.height = page.vh * scale + 'px';

  const canvas = document.createElement('canvas');
  canvas.className = 'page-canvas';
  wrap.appendChild(canvas);

  const num = document.createElement('div');
  num.className = 'page-num';
  num.textContent = state.pages.indexOf(page) + 1;
  wrap.appendChild(num);

  wrap.addEventListener('pointerdown', (e) => onPagePointerDown(e, page, wrap));

  renderPageCanvas(page, canvas, scale);
  for (const item of page.items) wrap.appendChild(buildItemEl(item, page, wrap));
  return wrap;
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

async function renderPageCanvas(page, canvas, scale) {
  const src = state.sources[page.srcIndex];
  const pdfPage = await src.pdfjs.getPage(page.srcPageNum);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = pdfPage.getViewport({ scale: scale * dpr });
  canvas.width = vp.width;
  canvas.height = vp.height;
  canvas.style.width = vp.width / dpr + 'px';
  canvas.style.height = vp.height / dpr + 'px';
  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
}

/* ---------- tools ---------- */

export function armTool(tool, hint) {
  state.tool = tool;
  setHint(hint || null);
  document.querySelectorAll('#edit-tools button').forEach((b) => b.classList.remove('tool-armed'));
  if (tool) {
    if (tool.type === 'text') $('#btn-add-text').classList.add('tool-armed');
    if (tool.type === 'stamp' && tool.kind === 'image') $('#btn-add-image').classList.add('tool-armed');
    if (tool.type === 'stamp' && tool.kind === 'signature') $('#btn-add-signature').classList.add('tool-armed');
    if (tool.type === 'highlight') $('#btn-add-highlight').classList.add('tool-armed');
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
  const scale = pageScale(page);
  const rect = wrap.getBoundingClientRect();
  const x = (e.clientX - rect.left) / scale;
  const y = (e.clientY - rect.top) / scale;
  let item;
  if (state.tool.type === 'text') {
    item = { id: newId(), type: 'text', x, y, text: '', fontSize: 16, color: '#000000' };
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

function buildItemEl(item, page, wrap) {
  const scale = pageScale(page);
  const el = document.createElement('div');
  el.className = 'item';
  el.dataset.itemId = item.id;

  if (item.type === 'text') {
    const tc = document.createElement('div');
    tc.className = 'text-content';
    tc.contentEditable = 'false';
    tc.innerText = item.text;
    tc.style.fontSize = item.fontSize * scale + 'px';
    tc.style.color = item.color;
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
    tb.innerHTML = `<label>Size <input type="number" min="6" max="120" step="1" value="${item.fontSize}"></label>
      <input type="color" value="${item.color}" title="Text color">`;
    const sizeInput = tb.querySelector('input[type=number]');
    sizeInput.addEventListener('input', () => {
      item.fontSize = Math.max(6, Math.min(120, Number(sizeInput.value) || 16));
      tc.style.fontSize = item.fontSize * scale + 'px';
      syncTextSize(item, el, scale);
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
    tb.innerHTML = `<input type="color" value="${item.color}" title="Highlight color">`;
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
  del.title = 'Delete';
  del.addEventListener('pointerdown', (e) => e.stopPropagation());
  del.addEventListener('click', () => removeItem(item, page, el));
  el.appendChild(del);

  const rz = document.createElement('div');
  rz.className = 'item-resize';
  rz.title = 'Resize';
  rz.addEventListener('pointerdown', (e) => startResize(e, item, page, el));
  el.appendChild(rz);

  el.addEventListener('pointerdown', (e) => {
    const tc = el.querySelector('.text-content');
    if (tc && tc.isContentEditable) { e.stopPropagation(); return; }
    e.stopPropagation();
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

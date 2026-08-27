import { state, newId, $, setHint, FONT_STACKS, FONT_FAMILY_NAME, KHMER_FONTS, LATIN_FONTS, DEFAULT_FONT, normalizeFontId, DRAW_TOOL_STYLES, dashPattern, strokeSegment, strokeDot, strokeFullPath, rafPointerBatcher } from './state.js';
import { t } from './i18n.js';
import { recognizeArea } from './ocr.js';
import { pushHistory } from './history.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

// Re-renders just one page's item overlay (used by undo/redo) without
// touching its canvas -- calling the full renderEditView() there would
// tear down and lazily re-rasterize every visible page's bitmap for a
// change that's almost always confined to a single page's items, which
// visibly flashed the page blank for a moment while it re-rendered.
export function refreshPageItems(page) {
  const wrap = document.querySelector(`.page-wrap[data-page-id="${page.id}"]`);
  if (!wrap) return; // not currently rendered (different page in single/double view, or Pages mode)
  wrap.querySelectorAll(':scope > .item').forEach((el) => el.remove());
  for (const item of page.items) wrap.appendChild(buildItemEl(item, page, wrap));
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
    // Floored at 2 even on a plain 1x monitor, not just the device's raw
    // devicePixelRatio -- a flat 1:1 raster reads as visibly softer than a
    // native viewer like Adobe Acrobat, which anti-aliases PDF text far more
    // aggressively than a bitmap matching physical pixels 1-for-1 ever can.
    // Supersampling at 2x closes most of that gap for a 4x memory cost per
    // visible page (bounded by the lazy render/release above); capped at 3
    // rather than the device's raw ratio (which can run higher on some
    // displays) for the same reason as the floor -- diminishing visual
    // return past that for a steep additional memory cost.
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
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
  state.zoom = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
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

const DRAW_TOOL_BUTTON_ID = { pen: 'btn-draw-pen', pencil: 'btn-draw-pencil', marker: 'btn-draw-marker', highlighter: 'btn-draw-highlighter' };

export function armTool(tool, hint) {
  state.tool = tool;
  setHint(hint || null);
  document.querySelectorAll('#edit-tools button, #ocr-tools button, #draw-tools button').forEach((b) => b.classList.remove('tool-armed'));
  if (tool) {
    if (tool.type === 'text') $('#btn-add-text').classList.add('tool-armed');
    if (tool.type === 'stamp' && tool.kind === 'image') $('#btn-add-image').classList.add('tool-armed');
    if (tool.type === 'stamp' && tool.kind === 'signature') $('#btn-add-signature').classList.add('tool-armed');
    if (tool.type === 'highlight') $('#btn-add-highlight').classList.add('tool-armed');
    if (tool.type === 'ocr-area') $('#mi-ocr-area').classList.add('tool-armed');
    if (tool.type === 'draw') $('#' + DRAW_TOOL_BUTTON_ID[tool.tool]).classList.add('tool-armed');
    if (tool.type === 'shape') $('#btn-draw-shape').classList.add('tool-armed');
    if (tool.type === 'eraser') $('#btn-draw-eraser').classList.add('tool-armed');
  }
  // The shape-kind row only makes sense while the shape tool itself is
  // armed; the color/thickness/style cluster applies to draw and shape
  // alike, but not the eraser (which has no style of its own).
  $('#draw-shape-kinds').hidden = !tool || tool.type !== 'shape';
  $('#draw-settings').hidden = !tool || (tool.type !== 'draw' && tool.type !== 'shape');
  $('#draw-fill-row').hidden = !tool || tool.type !== 'shape' || (tool.shape !== 'rect' && tool.shape !== 'ellipse');
  $('#draw-color-swatches').hidden = !tool || tool.type !== 'draw' || tool.tool !== 'highlighter';
  updatePlacingCursor();
}

function updatePlacingCursor() {
  document.querySelectorAll('.page-wrap').forEach((w) => w.classList.toggle('placing', !!state.tool));
}

function onPagePointerDown(e, page, wrap) {
  const onCanvasArea = e.target === wrap || e.target.classList.contains('page-canvas');
  // With a tool armed, a pointerdown that bubbled up from an *existing*
  // item (its own handler now defers to the armed tool -- see buildItemEl)
  // still needs to reach here: erasing has to work when dragging directly
  // over a stroke, and drawing/placing over existing content should too.
  if (!onCanvasArea && !(state.tool && e.target.closest('.item'))) return;
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
  if (state.tool.type === 'draw') {
    startFreehandDraw(e, page, wrap);
    return;
  }
  if (state.tool.type === 'shape') {
    startShapeDraw(e, page, wrap);
    return;
  }
  if (state.tool.type === 'eraser') {
    startErase(e, page, wrap);
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
  pushHistory(page);
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
  pushHistory(page);
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

/* ---------- freehand drawing ---------- */

// Pen/pencil/marker/highlighter all place the same item type -- only the
// tool name (and the DRAW_TOOL_STYLES it looks up) differs. Unlike the
// one-shot tools above, this does NOT re-arm(null) when a stroke finishes:
// a drawing tool is meant to draw many strokes in a row, stopping only when
// the user picks another tool (or clicks the same one again to toggle off,
// wired in app.js).
//
// The live preview is a canvas, not SVG, because a pressure-variable-width
// line has to be built from many individually-stroked segments (Canvas 2D
// has no notion of a single path with a width that changes along its
// length) -- the same technique the signature pad already uses. Segments
// are stroked once onto a full-opacity scratch buffer as they arrive (so
// self-overlapping segments within one stroke, e.g. a loop crossing
// itself, never double-blend against each other), and the visible canvas
// is just a cheap re-composite of that buffer with the tool's own
// opacity/blend-mode applied exactly once per frame.
function startFreehandDraw(e, page, wrap) {
  const scale = pageScale(page);
  const rect = wrap.getBoundingClientRect();
  const settings = state.draw;
  const toolId = settings.tool;
  const style = DRAW_TOOL_STYLES[toolId] || DRAW_TOOL_STYLES.pen;
  const maxWidth = settings.size;
  const minWidth = maxWidth * style.minRatio;
  const dash = dashPattern(settings.dash, maxWidth);
  const strokeOpts = { color: settings.color, minWidth, maxWidth, cap: style.cap, dash };

  // The live preview only has to look right while the pointer is moving --
  // buildItemEl() rebuilds the finished stroke at full supersampled
  // resolution the moment it lifts -- so a device-pixel (not extra
  // supersampled) backing store here is free performance, not a lasting
  // quality loss. Combined with the dirty-rect compositing and rAF batching
  // below, this is what keeps drawing responsive on mobile: the previous
  // version cleared and recomposited the *entire* page-sized canvas, at up
  // to 3x supersampling, on every single pointermove.
  const SS = Math.min(window.devicePixelRatio || 1, 2);
  const pxScale = scale * SS;
  const pxW = Math.max(1, Math.round(page.vw * pxScale));
  const pxH = Math.max(1, Math.round(page.vh * pxScale));

  const buffer = document.createElement('canvas');
  buffer.width = pxW; buffer.height = pxH;
  const bctx = buffer.getContext('2d');
  bctx.scale(pxScale, pxScale);

  const preview = document.createElement('canvas');
  preview.width = pxW; preview.height = pxH;
  preview.style.cssText = `position:absolute; left:0; top:0; width:${page.vw * scale}px; height:${page.vh * scale}px; pointer-events:none;`;
  wrap.appendChild(preview);
  const pctx = preview.getContext('2d');

  // Only re-composites the sub-rectangle a frame's new segments actually
  // touched (padded for stroke width + antialiasing), instead of the whole
  // canvas -- a typical stroke's bounding box is a small fraction of a full
  // page, so this turns an O(page area) operation into an O(stroke width)
  // one on every frame.
  const compositeRect = (x0, y0, x1, y1) => {
    const rx = Math.max(0, Math.floor(x0 * pxScale));
    const ry = Math.max(0, Math.floor(y0 * pxScale));
    const rw = Math.min(pxW, Math.ceil(x1 * pxScale)) - rx;
    const rh = Math.min(pxH, Math.ceil(y1 * pxScale)) - ry;
    if (rw <= 0 || rh <= 0) return;
    pctx.clearRect(rx, ry, rw, rh);
    pctx.globalAlpha = style.opacity;
    pctx.globalCompositeOperation = style.composite === 'multiply' ? 'multiply' : 'source-over';
    pctx.drawImage(buffer, rx, ry, rw, rh, rx, ry, rw, rh);
    pctx.globalAlpha = 1;
    pctx.globalCompositeOperation = 'source-over';
  };

  const points = [];
  const pad = maxWidth / 2 + 2;
  const pressureOf = (ev) => (ev.pressure > 0 ? ev.pressure : 0.5); // no force sensor -> a reasonable mid-range default
  const eventXY = (ev) => [
    Math.max(0, Math.min(page.vw, (ev.clientX - rect.left) / scale)),
    Math.max(0, Math.min(page.vh, (ev.clientY - rect.top) / scale)),
  ];
  const addSample = (x, y, pressure) => {
    points.push([x, y, pressure]);
    const i = points.length - 1;
    if (i === 0) strokeDot(bctx, points[0], strokeOpts);
    else strokeSegment(bctx, points[i - 1], points[i], strokeOpts);
  };

  // The very first point is drawn synchronously (no rAF round-trip) so a
  // plain tap with no movement still leaves a mark immediately.
  {
    const [x, y] = eventXY(e);
    addSample(x, y, pressureOf(e));
    compositeRect(x - pad, y - pad, x + pad, y + pad);
  }

  // Batches the (potentially very high-frequency, on mobile) pointermove
  // stream down to one canvas update per animation frame, via
  // getCoalescedEvents() so no in-between hardware sample is lost.
  const move = rafPointerBatcher((events) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ev of events) {
      const [x, y] = eventXY(ev);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      addSample(x, y, pressureOf(ev));
    }
    compositeRect(minX - pad, minY - pad, maxX + pad, maxY + pad);
  });
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    move.flush(); // don't drop a batch still waiting on its rAF when the pointer lifts
    preview.remove();
    finishFreehand(points, page, wrap, toolId, settings);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function finishFreehand(points, page, wrap, toolId, settings) {
  if (points.length < 2) points.push([...points[0]]); // a tap with no movement still leaves a dot
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  // Pad by half the stroke width so a line isn't clipped at its own box edge.
  const pad = settings.size / 2 + 1;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const item = {
    id: newId(), type: 'draw', tool: toolId,
    color: settings.color, size: settings.size, dash: settings.dash,
    x: minX, y: minY, w, h, natW: w, natH: h,
    points: points.map(([x, y, p]) => [x - minX, y - minY, p]),
  };
  pushHistory(page);
  page.items.push(item);
  wrap.appendChild(buildItemEl(item, page, wrap));
}

/* ---------- shapes ---------- */

function shapeTagName(kind) {
  if (kind === 'rect') return 'rect';
  if (kind === 'ellipse') return 'ellipse';
  return 'line'; // 'line' and 'arrow' both render as an SVG <line>; arrow adds a marker-end
}

// Sets an SVG shape element's geometry attributes from two raw corner/end
// points -- shared by the live preview (absolute page-space points) and the
// finished item's own rendering (item-local natW/natH-space points), since
// both are just "two points define this shape" in whatever space they're in.
function positionShapeEl(el, kind, x1, y1, x2, y2) {
  if (kind === 'rect') {
    el.setAttribute('x', Math.min(x1, x2));
    el.setAttribute('y', Math.min(y1, y2));
    el.setAttribute('width', Math.max(0.1, Math.abs(x2 - x1)));
    el.setAttribute('height', Math.max(0.1, Math.abs(y2 - y1)));
  } else if (kind === 'ellipse') {
    el.setAttribute('cx', (x1 + x2) / 2);
    el.setAttribute('cy', (y1 + y2) / 2);
    el.setAttribute('rx', Math.max(0.1, Math.abs(x2 - x1) / 2));
    el.setAttribute('ry', Math.max(0.1, Math.abs(y2 - y1) / 2));
  } else {
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
  }
}

function styleShapeEl(el, kind, settings, markerId) {
  el.setAttribute('stroke', settings.color);
  el.setAttribute('stroke-width', settings.size);
  const canFill = kind === 'rect' || kind === 'ellipse';
  el.setAttribute('fill', canFill && settings.fill ? settings.color : 'none');
  const dash = dashPattern(settings.dash, settings.size);
  if (dash) el.setAttribute('stroke-dasharray', dash.join(' ')); else el.removeAttribute('stroke-dasharray');
  if (kind === 'arrow') {
    el.setAttribute('marker-end', `url(#${markerId})`);
    el.setAttribute('stroke-linecap', 'round');
  }
}

// A self-contained <marker> def for the arrowhead, sized proportionally to
// the current stroke width (markerUnits=userSpaceOnUse puts it in the same
// coordinate space as the line itself) so a thicker line gets a bigger head.
function buildArrowMarker(markerId, color, size) {
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', markerId);
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '8.5');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', size * 3.2);
  marker.setAttribute('markerHeight', size * 3.2);
  marker.setAttribute('markerUnits', 'userSpaceOnUse');
  marker.setAttribute('orient', 'auto');
  const head = document.createElementNS(SVG_NS, 'path');
  head.setAttribute('d', 'M0,0 L10,5 L0,10 Z');
  head.setAttribute('fill', color);
  marker.appendChild(head);
  return marker;
}

let previewArrowMarkerSeq = 0;

function startShapeDraw(e, page, wrap) {
  const scale = pageScale(page);
  const rect = wrap.getBoundingClientRect();
  const settings = state.draw;
  const kind = settings.shape;
  const startX = Math.max(0, Math.min(page.vw, (e.clientX - rect.left) / scale));
  const startY = Math.max(0, Math.min(page.vh, (e.clientY - rect.top) / scale));

  const preview = document.createElementNS(SVG_NS, 'svg');
  preview.setAttribute('viewBox', `0 0 ${page.vw} ${page.vh}`);
  preview.style.cssText = `position:absolute; left:0; top:0; width:${page.vw * scale}px; height:${page.vh * scale}px; pointer-events:none;`;
  let markerId = null;
  if (kind === 'arrow') {
    markerId = `arrow-preview-${++previewArrowMarkerSeq}`;
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.appendChild(buildArrowMarker(markerId, settings.color, settings.size));
    preview.appendChild(defs);
  }
  const shapeEl = document.createElementNS(SVG_NS, shapeTagName(kind));
  styleShapeEl(shapeEl, kind, settings, markerId);
  preview.appendChild(shapeEl);
  wrap.appendChild(preview);

  let endX = startX, endY = startY;
  positionShapeEl(shapeEl, kind, startX, startY, endX, endY);

  const move = (ev) => {
    endX = Math.max(0, Math.min(page.vw, (ev.clientX - rect.left) / scale));
    endY = Math.max(0, Math.min(page.vh, (ev.clientY - rect.top) / scale));
    positionShapeEl(shapeEl, kind, startX, startY, endX, endY);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    preview.remove();
    finishShape(startX, startY, endX, endY, page, wrap, settings);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function finishShape(x1, y1, x2, y2, page, wrap, settings) {
  const kind = settings.shape;
  const dragged = Math.abs(x2 - x1) >= 4 || Math.abs(y2 - y1) >= 4;
  if (!dragged) {
    // A click with no real drag: default to a small fixed-size shape
    // anchored at the click point, matching the highlight tool's fallback.
    x2 = x1 + 80;
    y2 = y1 + (kind === 'line' || kind === 'arrow' ? 40 : 56);
  }
  const pad = settings.size / 2 + (kind === 'arrow' ? settings.size * 3.2 : 1);
  const minX = Math.min(x1, x2) - pad, minY = Math.min(y1, y2) - pad;
  const w = Math.abs(x2 - x1) + pad * 2, h = Math.abs(y2 - y1) + pad * 2;
  const item = {
    id: newId(), type: 'shape', shape: kind,
    color: settings.color, size: settings.size, dash: settings.dash, fill: settings.fill,
    x: minX, y: minY, w, h, natW: w, natH: h,
  };
  if (kind === 'line' || kind === 'arrow') {
    item.p1 = [x1 - minX, y1 - minY];
    item.p2 = [x2 - minX, y2 - minY];
  }
  pushHistory(page);
  page.items.push(item);
  wrap.appendChild(buildItemEl(item, page, wrap));
}

/* ---------- eraser ---------- */

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Maps a point stored in an item's own local (natW/natH-space) coordinates
// -- as freehand points and shape p1/p2 both are -- into absolute page
// space, using the same uniform scale factor resizing already relies on.
function itemLocalToPage(item, lx, ly) {
  const sx = item.w / item.natW, sy = item.h / item.natH;
  return { x: item.x + lx * sx, y: item.y + ly * sy };
}

// How far a page-space point is from an item's actual drawn geometry (not
// just its bounding box), so the eraser only deletes what it visually
// touches. Returns Infinity for anything it shouldn't consider erasable.
function eraseDistance(item, px, py) {
  if (item.type === 'highlight') {
    const cx = Math.max(item.x, Math.min(px, item.x + item.w));
    const cy = Math.max(item.y, Math.min(py, item.y + item.h));
    return Math.hypot(px - cx, py - cy);
  }
  if (item.type === 'draw') {
    let best = Infinity;
    for (let i = 1; i < item.points.length; i++) {
      const a = itemLocalToPage(item, item.points[i - 1][0], item.points[i - 1][1]);
      const b = itemLocalToPage(item, item.points[i][0], item.points[i][1]);
      best = Math.min(best, distToSegment(px, py, a.x, a.y, b.x, b.y));
    }
    return best;
  }
  if (item.type === 'shape') {
    if (item.shape === 'line' || item.shape === 'arrow') {
      const a = itemLocalToPage(item, item.p1[0], item.p1[1]);
      const b = itemLocalToPage(item, item.p2[0], item.p2[1]);
      return distToSegment(px, py, a.x, a.y, b.x, b.y);
    }
    if (item.shape === 'rect') {
      const inside = px >= item.x && px <= item.x + item.w && py >= item.y && py <= item.y + item.h;
      if (item.fill && inside) return 0;
      const x0 = item.x, y0 = item.y, x1 = item.x + item.w, y1 = item.y + item.h;
      return Math.min(
        distToSegment(px, py, x0, y0, x1, y0),
        distToSegment(px, py, x1, y0, x1, y1),
        distToSegment(px, py, x1, y1, x0, y1),
        distToSegment(px, py, x0, y1, x0, y0),
      );
    }
    if (item.shape === 'ellipse') {
      const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
      const rx = item.w / 2 || 1, ry = item.h / 2 || 1;
      const nr = Math.hypot((px - cx) / rx, (py - cy) / ry);
      if (item.fill && nr <= 1) return 0;
      return Math.abs(nr - 1) * Math.min(rx, ry);
    }
  }
  return Infinity;
}

// Page-space units, not screen pixels -- scales with zoom, so it's more
// forgiving when zoomed in (working precisely) and tighter when zoomed out
// (everything is small anyway). 16 was chosen after finding that a real
// fingertip's touch imprecision easily misses a value as tight as 10 on a
// thin diagonal stroke.
const ERASE_RADIUS = 16;

function startErase(e, page, wrap) {
  const scale = pageScale(page);
  const rect = wrap.getBoundingClientRect();
  const idToEl = new Map();
  wrap.querySelectorAll('.item').forEach((el) => idToEl.set(Number(el.dataset.itemId), el));
  // Erasing several items across one drag is still a single undo step --
  // only the first actual removal in the gesture records history, and only
  // if the gesture ever hits anything (a drag that touches nothing shouldn't
  // add a no-op undo entry).
  let historyPushed = false;

  const eraseAt = (ev) => {
    const px = (ev.clientX - rect.left) / scale;
    const py = (ev.clientY - rect.top) / scale;
    const hitIds = new Set();
    for (const it of page.items) {
      if (it.type !== 'draw' && it.type !== 'shape' && it.type !== 'highlight') continue;
      if (eraseDistance(it, px, py) <= ERASE_RADIUS) hitIds.add(it.id);
    }
    if (!hitIds.size) return;
    if (!historyPushed) { pushHistory(page); historyPushed = true; }
    for (const id of hitIds) {
      const el = idToEl.get(id);
      if (el) el.remove();
      idToEl.delete(id);
    }
    page.items = page.items.filter((it) => !hitIds.has(it.id));
  };
  eraseAt(e);
  const move = (ev) => eraseAt(ev);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
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
    el.classList.add('item-text');
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
      if (tc.isContentEditable) stopTextEdit(tc);
      else { pushHistory(page); startTextEdit(tc); }
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
  } else if (item.type === 'draw') {
    el.classList.add('item-draw');
    const style = DRAW_TOOL_STYLES[item.tool] || DRAW_TOOL_STYLES.pen;
    const canvas = document.createElement('canvas');
    el.appendChild(canvas);
    el.style.width = item.w * scale + 'px';
    el.style.height = item.h * scale + 'px';

    // Rebuilds the whole bitmap at the page's current scale -- cheap enough
    // to call on every toolbar edit (color/thickness/style), and correct
    // for zoom changes since renderEditView() already reconstructs every
    // item from scratch on those. A pure CSS stretch during an active
    // resize drag (not calling this per pointermove) matches how images
    // already behave here: briefly a little soft, sharp again once
    // startResize's move handler finishes and this item is next rebuilt.
    const redrawDraw = () => {
      const SS = Math.min(window.devicePixelRatio || 1, 2) * 1.5;
      const pxScale = scale * SS;
      canvas.width = Math.max(1, Math.round(item.natW * pxScale));
      canvas.height = Math.max(1, Math.round(item.natH * pxScale));
      const ctx = canvas.getContext('2d');
      // Stroke the full (possibly self-overlapping) path onto a full-
      // opacity scratch buffer first, then composite that buffer once --
      // same reasoning as the live preview's buffer/visible split.
      const buf = document.createElement('canvas');
      buf.width = canvas.width; buf.height = canvas.height;
      const bctx = buf.getContext('2d');
      bctx.scale(pxScale, pxScale);
      const minWidth = item.size * style.minRatio;
      const dash = dashPattern(item.dash, item.size);
      strokeFullPath(bctx, item.points, { color: item.color, minWidth, maxWidth: item.size, cap: style.cap, dash });
      ctx.globalAlpha = style.opacity;
      ctx.globalCompositeOperation = style.composite === 'multiply' ? 'multiply' : 'source-over';
      ctx.drawImage(buf, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };
    redrawDraw();

    const tb = document.createElement('div');
    tb.className = 'item-toolbar';
    tb.innerHTML = `<input type="color" value="${item.color}" title="${t('itemDrawColorTitle')}">
      <input type="range" min="1" max="24" step="1" value="${item.size}" title="${t('itemDrawSizeTitle')}">
      <select title="${t('itemDrawStyleTitle')}">
        <option value="solid">${t('drawStyleSolid')}</option>
        <option value="dashed">${t('drawStyleDashed')}</option>
        <option value="dotted">${t('drawStyleDotted')}</option>
      </select>`;
    const colorInput = tb.querySelector('input[type=color]');
    const sizeInput = tb.querySelector('input[type=range]');
    const styleSelect = tb.querySelector('select');
    styleSelect.value = item.dash;
    colorInput.addEventListener('input', () => { item.color = colorInput.value; redrawDraw(); });
    sizeInput.addEventListener('input', () => { item.size = Number(sizeInput.value) || 1; redrawDraw(); });
    styleSelect.addEventListener('change', () => { item.dash = styleSelect.value; redrawDraw(); });
    tb.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.appendChild(tb);
  } else if (item.type === 'shape') {
    el.classList.add('item-shape');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${item.natW} ${item.natH}`);
    el.appendChild(svg);
    el.style.width = item.w * scale + 'px';
    el.style.height = item.h * scale + 'px';

    let markerEl = null;
    const markerId = `arrow-item-${item.id}`;
    if (item.shape === 'arrow') {
      const defs = document.createElementNS(SVG_NS, 'defs');
      markerEl = buildArrowMarker(markerId, item.color, item.size);
      defs.appendChild(markerEl);
      svg.appendChild(defs);
    }
    const shapeEl = document.createElementNS(SVG_NS, shapeTagName(item.shape));
    svg.appendChild(shapeEl);

    const canFill = item.shape === 'rect' || item.shape === 'ellipse';
    const syncShape = () => {
      if (item.shape === 'line' || item.shape === 'arrow') {
        positionShapeEl(shapeEl, item.shape, item.p1[0], item.p1[1], item.p2[0], item.p2[1]);
      } else {
        const inset = item.size / 2 + 1;
        positionShapeEl(shapeEl, item.shape, inset, inset, item.natW - inset, item.natH - inset);
      }
      styleShapeEl(shapeEl, item.shape, item, markerId);
      if (markerEl) {
        markerEl.setAttribute('markerWidth', item.size * 3.2);
        markerEl.setAttribute('markerHeight', item.size * 3.2);
        markerEl.querySelector('path').setAttribute('fill', item.color);
      }
    };
    syncShape();

    const tb = document.createElement('div');
    tb.className = 'item-toolbar';
    tb.innerHTML = `<input type="color" value="${item.color}" title="${t('itemDrawColorTitle')}">
      <input type="range" min="1" max="24" step="1" value="${item.size}" title="${t('itemDrawSizeTitle')}">
      <select title="${t('itemDrawStyleTitle')}">
        <option value="solid">${t('drawStyleSolid')}</option>
        <option value="dashed">${t('drawStyleDashed')}</option>
        <option value="dotted">${t('drawStyleDotted')}</option>
      </select>
      ${canFill ? `<label class="item-fill-label" title="${t('itemShapeFillTitle')}"><input type="checkbox"> ${t('drawFillLabel')}</label>` : ''}`;
    const colorInput = tb.querySelector('input[type=color]');
    const sizeInput = tb.querySelector('input[type=range]');
    const styleSelect = tb.querySelector('select');
    styleSelect.value = item.dash;
    colorInput.addEventListener('input', () => { item.color = colorInput.value; syncShape(); });
    sizeInput.addEventListener('input', () => { item.size = Number(sizeInput.value) || 1; syncShape(); });
    styleSelect.addEventListener('change', () => { item.dash = styleSelect.value; syncShape(); });
    const fillInput = tb.querySelector('input[type=checkbox]');
    if (fillInput) {
      fillInput.checked = !!item.fill;
      fillInput.addEventListener('change', () => { item.fill = fillInput.checked; syncShape(); });
    }
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
    // While a tool is armed, an item must not swallow the pointerdown via
    // its own select/drag handling below -- otherwise placing/drawing/
    // erasing at a spot that happens to land on an *existing* item would
    // silently select/drag that item instead of reaching the armed tool.
    // Letting it bubble up to the page-wrap's own listener is exactly what
    // makes the eraser (and drawing over existing content) work at all.
    if (state.tool) return;
    const tc = el.querySelector('.text-content');
    if (tc && tc.isContentEditable) { e.stopPropagation(); return; }
    e.stopPropagation();

    if (item.type === 'text' && e.pointerType === 'mouse' && el.classList.contains('selected')) {
      // Already selected (this is at least the second mouse interaction
      // with it): let the browser's own mousedown-drag select the text,
      // like any ordinary text, instead of moving the box again.
      pushHistory(page);
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
        pushHistory(page);
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
    if (tc) { pushHistory(page); startTextEdit(tc); }
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
  document.querySelectorAll('.item.item-text .item-toolbar label').forEach((label) => {
    if (label.firstChild) label.firstChild.textContent = t('itemSizeLabel') + ' ';
  });
  document.querySelectorAll('.item .item-toolbar input[type=color]').forEach((input) => {
    const el = input.closest('.item');
    input.title = el.classList.contains('item-highlight') ? t('itemHighlightColorTitle')
      : el.classList.contains('item-draw') || el.classList.contains('item-shape') ? t('itemDrawColorTitle')
      : t('itemTextColorTitle');
  });
  document.querySelectorAll('.item .item-toolbar input[type=range]').forEach((input) => { input.title = t('itemDrawSizeTitle'); });
  document.querySelectorAll('.item.item-draw .item-toolbar select, .item.item-shape .item-toolbar select').forEach((select) => {
    select.title = t('itemDrawStyleTitle');
    const [solid, dashed, dotted] = select.querySelectorAll('option');
    if (solid) solid.textContent = t('drawStyleSolid');
    if (dashed) dashed.textContent = t('drawStyleDashed');
    if (dotted) dotted.textContent = t('drawStyleDotted');
  });
  document.querySelectorAll('.item .item-fill-label').forEach((label) => {
    label.title = t('itemShapeFillTitle');
    label.lastChild.textContent = ' ' + t('drawFillLabel');
  });
  document.querySelectorAll('.item.item-text .item-toolbar select').forEach((select) => {
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
  pushHistory(page);
  page.items = page.items.filter((i) => i !== item);
  el.remove();
}

function startDrag(e, item, page, el) {
  const scale = pageScale(page);
  const startX = e.clientX, startY = e.clientY;
  const origX = item.x, origY = item.y;
  // Pushed lazily, on the first actual movement -- a plain click-to-select
  // (pointerdown+pointerup with no movement in between) shouldn't cost an
  // undo step for a no-op "move."
  let historyPushed = false;
  const move = (ev) => {
    if (!historyPushed) { pushHistory(page); historyPushed = true; }
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
  let historyPushed = false;
  const move = (ev) => {
    if (!historyPushed) { pushHistory(page); historyPushed = true; }
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

// Each brush style is a distinct look, not just a color: min/max stroke
// width (interpolated by pointer pressure -- a real stylus/touch force
// value where the device reports one, else a fixed mid-range default so
// mouse/finger drawing still gets a reasonable width rather than the
// thinnest possible line), an overall opacity, and a composite mode.
const BRUSH_STYLES = {
  pen:    { color: '#1a1a2e', minWidth: 1.6, maxWidth: 3.0,  opacity: 1,    composite: 'source-over' },
  ink:    { color: '#0b1d4d', minWidth: 1.0, maxWidth: 4.2,  opacity: 0.92, composite: 'source-over' },
  stylo:  { color: '#101010', minWidth: 1.8, maxWidth: 2.3,  opacity: 1,    composite: 'source-over' },
  brush:  { color: '#161616', minWidth: 1.8, maxWidth: 11,   opacity: 0.85, composite: 'source-over' },
};
let sigStyleId = 'pen';
// Independent of brush style -- picking Marker over Pen changes the width
// range/opacity/blend, not the ink color, so switching styles doesn't reset
// whatever color the user has chosen.
let sigColor = BRUSH_STYLES.pen.color;
let clearSignatureLayers = () => {};
let resizeSigCanvases = () => {};
let sigUndoFn = () => {};
let sigRedoFn = () => {};
export function signatureUndo() { sigUndoFn(); }
export function signatureRedo() { sigRedoFn(); }

export function initSignatureModal(onReady) {
  const modal = $('#sig-modal');
  const canvas = $('#sig-canvas');
  const ctx = canvas.getContext('2d');
  // The <canvas> tag's own width/height attributes (500x200) set the
  // authoritative aspect ratio; the backing store is then resized up to
  // match its actual displayed CSS size (see resizeSigCanvases below), so
  // the exported signature is crisp on any screen/DPI instead of always
  // being a fixed, often-upscaled, 500x200 bitmap.
  const aspect = canvas.height / canvas.width;

  // Two offscreen layers: `base` accumulates every finished stroke (each
  // composited once, at its own style's opacity/blend mode); `stroke`
  // holds only the in-progress stroke's shape, built up at full opacity so
  // variable-width segments never double-blend against each other. Every
  // frame the visible canvas is redrawn from base + stroke, so switching
  // brush style mid-signature only affects strokes drawn after the switch.
  const base = document.createElement('canvas');
  base.width = canvas.width; base.height = canvas.height;
  const baseCtx = base.getContext('2d');
  const strokeLayer = document.createElement('canvas');
  strokeLayer.width = canvas.width; strokeLayer.height = canvas.height;
  const strokeCtx = strokeLayer.getContext('2d');
  strokeCtx.lineCap = 'round';
  strokeCtx.lineJoin = 'round';

  resizeSigCanvases = () => {
    const cssW = canvas.getBoundingClientRect().width || canvas.width;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(w * aspect));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h;
    base.width = w; base.height = h;
    strokeLayer.width = w; strokeLayer.height = h;
    strokeCtx.lineCap = 'round';
    strokeCtx.lineJoin = 'round';
  };

  // Per-stroke undo/redo: since strokes are baked into `base` as pixels (not
  // kept as separate replayable shapes), each undo step is a full snapshot
  // of `base` taken right before the stroke that's about to be baked in --
  // undo restores the previous snapshot, redo re-applies the one moved away
  // from. A handful of ImageData snapshots for a signature (a few strokes at
  // most) is negligible memory, capped defensively in case of a very long
  // scribble.
  const SIG_MAX_HISTORY = 30;
  let sigUndoStack = [];
  let sigRedoStack = [];
  const hasVisiblePixels = (imageData) => {
    const { data } = imageData;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  };
  const refreshSigButtons = () => {
    $('#sig-undo').disabled = !sigUndoStack.length;
    $('#sig-redo').disabled = !sigRedoStack.length;
  };
  const sigUndo = () => {
    if (!sigUndoStack.length) return;
    const prev = sigUndoStack.pop();
    sigRedoStack.push(baseCtx.getImageData(0, 0, base.width, base.height));
    baseCtx.putImageData(prev, 0, 0);
    sigDirty = hasVisiblePixels(prev);
    redrawFull();
    refreshSigButtons();
  };
  const sigRedo = () => {
    if (!sigRedoStack.length) return;
    const next = sigRedoStack.pop();
    sigUndoStack.push(baseCtx.getImageData(0, 0, base.width, base.height));
    baseCtx.putImageData(next, 0, 0);
    sigDirty = hasVisiblePixels(next);
    redrawFull();
    refreshSigButtons();
  };
  sigUndoFn = sigUndo;
  sigRedoFn = sigRedo;
  $('#sig-undo').addEventListener('click', sigUndo);
  $('#sig-redo').addEventListener('click', sigRedo);
  const syncSigColorSwatches = () => {
    document.querySelectorAll('#sig-color-swatches .color-swatch').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.color.toLowerCase() === sigColor.toLowerCase());
    });
  };
  document.querySelectorAll('#sig-color-swatches .color-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      sigColor = btn.dataset.color;
      syncSigColorSwatches();
    });
  });
  syncSigColorSwatches();

  let drawing = false;
  // Rolling window of the last two accepted points -- quadratic-curve-
  // through-midpoints (see the move handler below) needs three consecutive
  // points (p0, p1, and the incoming one) to draw one smooth segment.
  let p0 = null, p1 = null;
  let lastRaw = null; // { x, y, t } -- raw client coords + timestamp, for velocity math
  let smoothPressure = 0.5;
  let activeStyle = BRUSH_STYLES.pen;

  // A real stylus reports genuine pressure; plain touch (and mouse) almost
  // never does, so on those inputs pressure is simulated from how fast the
  // pointer is moving -- slower strokes read as harder presses, faster ones
  // as lighter, the same relationship a real ink pen has, and the standard
  // technique signature-pad libraries use when there's no hardware pressure
  // signal to read. Distance/time are measured in raw CSS pixels/ms (not
  // canvas backing-store pixels) so the mapping doesn't shift with screen
  // DPI.
  const VELOCITY_MAX = 1.2; // css px/ms; an unhurried signing stroke spans most of the width range
  const velocityPressure = (dist, dt) => {
    if (dt <= 0) return smoothPressure;
    const t = Math.max(0, Math.min(1, (dist / dt) / VELOCITY_MAX));
    return 1 - t; // slow = thick (pressure -> 1), fast = thin (pressure -> 0)
  };
  const rawPressureOf = (e) => {
    if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.5;
    if (!lastRaw) return 0.5; // first sample of a stroke -- no velocity yet
    return velocityPressure(Math.hypot(e.clientX - lastRaw.x, e.clientY - lastRaw.y), e.timeStamp - lastRaw.t);
  };
  // Exponential smoothing on the (simulated) pressure signal, since raw
  // velocity is noisy sample-to-sample -- pulls a fraction of the way from
  // the last value toward each new one, reading as a natural, gently damped
  // change in width rather than a jittery one. Touch gets the calmest
  // factor: a finger's contact point wobbles more between samples than a
  // mouse cursor or a stylus tip does, which without extra damping reads
  // as a faint flicker in stroke width on a real touchscreen.
  const PRESSURE_SMOOTHING = { touch: 0.1, mouse: 0.22, pen: 0.22 };
  // Light position smoothing before the curve-through-midpoints step below
  // -- that step already smooths the stroke's overall shape at any sample
  // density, but doesn't filter out small per-sample jitter in the input
  // itself. Touch gets the most damping (a finger has the most jitter),
  // pen the least (already a precise digitizer), mouse in between.
  const POSITION_SMOOTHING = { touch: 0.32, mouse: 0.55, pen: 0.7 };
  const smooth = (prev, raw, factor) => prev + (raw - prev) * factor;

  // Re-composites only the sub-rectangle a batch of new segments actually
  // touched (padded for stroke width + antialiasing) instead of the whole
  // canvas -- with the higher-resolution backing store above, redrawing
  // everything on every frame would be exactly the kind of full-canvas
  // clear+composite that made mobile drawing feel slow elsewhere in this
  // app (see startFreehandDraw's comment).
  const redrawRect = (x0, y0, x1, y1) => {
    const rx = Math.max(0, Math.floor(x0));
    const ry = Math.max(0, Math.floor(y0));
    const rw = Math.min(canvas.width, Math.ceil(x1)) - rx;
    const rh = Math.min(canvas.height, Math.ceil(y1)) - ry;
    if (rw <= 0 || rh <= 0) return;
    ctx.clearRect(rx, ry, rw, rh);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(base, rx, ry, rw, rh, rx, ry, rw, rh);
    ctx.globalAlpha = activeStyle.opacity;
    ctx.globalCompositeOperation = activeStyle.composite;
    ctx.drawImage(strokeLayer, rx, ry, rw, rh, rx, ry, rw, rh);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
  const redrawFull = () => redrawRect(0, 0, canvas.width, canvas.height);

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };
  const widthFor = (pressure) => activeStyle.minWidth + (activeStyle.maxWidth - activeStyle.minWidth) * pressure;

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    sigDirty = true;
    activeStyle = BRUSH_STYLES[sigStyleId] || BRUSH_STYLES.pen;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    strokeCtx.clearRect(0, 0, strokeLayer.width, strokeLayer.height);
    strokeCtx.fillStyle = sigColor;
    strokeCtx.strokeStyle = sigColor;
    const p = pos(e);
    smoothPressure = rawPressureOf(e);
    p0 = p1 = { x: p.x, y: p.y, pressure: smoothPressure };
    lastRaw = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    // A tap with no movement still leaves a dot.
    const r = widthFor(smoothPressure) / 2;
    strokeCtx.beginPath();
    strokeCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
    strokeCtx.fill();
    redrawRect(p.x - r - 2, p.y - r - 2, p.x + r + 2, p.y + r + 2);
  });
  // Batches the (potentially very high-frequency, on mobile) pointermove
  // stream down to one canvas update per animation frame, via
  // getCoalescedEvents() so no in-between hardware sample is lost.
  const move = rafPointerBatcher((events) => {
    if (!drawing) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ev of events) {
      const raw0 = pos(ev);
      const posFactor = POSITION_SMOOTHING[ev.pointerType] ?? 0.55;
      const raw = { x: smooth(p1.x, raw0.x, posFactor), y: smooth(p1.y, raw0.y, posFactor) };
      const rawPressure = rawPressureOf(ev);
      smoothPressure = smooth(smoothPressure, rawPressure, PRESSURE_SMOOTHING[ev.pointerType] ?? 0.22);
      const p2 = { x: raw.x, y: raw.y, pressure: smoothPressure };

      // Quadratic curve from the midpoint of (p0,p1) to the midpoint of
      // (p1,p2), using p1 as the control point -- the standard "curve
      // through midpoints" technique. Unlike straight segments between raw
      // points (which show a visible angle at every sample) this stays
      // smooth at any sample density, since consecutive curves share their
      // anchor at each midpoint rather than meeting at a sharp corner.
      const mid01x = (p0.x + p1.x) / 2, mid01y = (p0.y + p1.y) / 2;
      const mid12x = (p1.x + p2.x) / 2, mid12y = (p1.y + p2.y) / 2;
      const w = widthFor((p1.pressure + p2.pressure) / 2);
      strokeCtx.lineWidth = w;
      strokeCtx.beginPath();
      strokeCtx.moveTo(mid01x, mid01y);
      strokeCtx.quadraticCurveTo(p1.x, p1.y, mid12x, mid12y);
      strokeCtx.stroke();

      // A quadratic Bezier always lies within the triangle formed by its
      // start, control, and end points, so that triangle's bounding box
      // (padded for stroke width) safely bounds the whole curve.
      const pad = w / 2 + 2;
      minX = Math.min(minX, mid01x - pad, p1.x - pad, mid12x - pad);
      minY = Math.min(minY, mid01y - pad, p1.y - pad, mid12y - pad);
      maxX = Math.max(maxX, mid01x + pad, p1.x + pad, mid12x + pad);
      maxY = Math.max(maxY, mid01y + pad, p1.y + pad, mid12y + pad);

      p0 = p1;
      p1 = p2;
      lastRaw = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
    }
    redrawRect(minX, minY, maxX, maxY);
  });
  canvas.addEventListener('pointermove', move);
  const endStroke = () => {
    if (!drawing) return;
    move.flush(); // process any batch still waiting on its rAF before ending, so the last segment isn't dropped
    drawing = false;
    // Snapshot the base layer as it was *before* this stroke, so undo can
    // restore exactly that; a new stroke invalidates any redo history.
    sigUndoStack.push(baseCtx.getImageData(0, 0, base.width, base.height));
    if (sigUndoStack.length > SIG_MAX_HISTORY) sigUndoStack.shift();
    sigRedoStack = [];
    refreshSigButtons();
    // Bake the finished stroke into the base layer at its own style's
    // opacity/blend mode, exactly once, then clear it for the next stroke.
    baseCtx.globalAlpha = activeStyle.opacity;
    baseCtx.globalCompositeOperation = activeStyle.composite;
    baseCtx.drawImage(strokeLayer, 0, 0);
    baseCtx.globalAlpha = 1;
    baseCtx.globalCompositeOperation = 'source-over';
    strokeCtx.clearRect(0, 0, strokeLayer.width, strokeLayer.height);
    redrawFull();
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  document.querySelectorAll('#sig-styles .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      sigStyleId = btn.dataset.style;
      document.querySelectorAll('#sig-styles .tab').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  clearSignatureLayers = () => {
    baseCtx.clearRect(0, 0, base.width, base.height);
    strokeCtx.clearRect(0, 0, strokeLayer.width, strokeLayer.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sigDirty = false;
    sigUndoStack = [];
    sigRedoStack = [];
    refreshSigButtons();
  };
  $('#sig-clear').addEventListener('click', clearSignatureLayers);
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
  // Unhide first: sizing needs layout, and the modal's box (hence the
  // canvas's actual displayed CSS width) isn't measurable while hidden.
  $('#sig-modal').hidden = false;
  resizeSigCanvases();
  clearSignatureLayers();
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

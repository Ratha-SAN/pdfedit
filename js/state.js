// Bundled font catalogue. Khmer faces shape Khmer correctly on their own;
// Latin faces have no Khmer glyphs at all, so every Latin stack falls back
// to Noto Sans Khmer for Khmer text. That keeps the app's core guarantee --
// Khmer always renders correctly -- true for every font a user can pick.
// `id` doubles as the value stored on items and must stay stable.
export const KHMER_FONTS = [
  { id: 'noto-sans-khmer', label: 'Noto Sans Khmer', family: 'Noto Sans Khmer' },
  { id: 'noto-serif-khmer', label: 'Noto Serif Khmer', family: 'Noto Serif Khmer' },
  { id: 'battambang', label: 'Battambang', family: 'Battambang' },
  { id: 'hanuman', label: 'Hanuman', family: 'Hanuman' },
  { id: 'kantumruy-pro', label: 'Kantumruy Pro', family: 'Kantumruy Pro' },
  { id: 'nokora', label: 'Nokora', family: 'Nokora' },
  { id: 'suwannaphum', label: 'Suwannaphum', family: 'Suwannaphum' },
  { id: 'content', label: 'Content', family: 'Content' },
  { id: 'siemreap', label: 'Siemreap', family: 'Siemreap' },
  { id: 'koulen', label: 'Koulen', family: 'Koulen' },
  { id: 'moul', label: 'Moul', family: 'Moul' },
  { id: 'angkor', label: 'Angkor', family: 'Angkor' },
  { id: 'bayon', label: 'Bayon', family: 'Bayon' },
  { id: 'bokor', label: 'Bokor', family: 'Bokor' },
  { id: 'preahvihear', label: 'Preahvihear', family: 'Preahvihear' },
  { id: 'taprom', label: 'Taprom', family: 'Taprom' },
];
export const LATIN_FONTS = [
  { id: 'roboto', label: 'Roboto', family: 'Roboto', generic: 'sans-serif' },
  { id: 'open-sans', label: 'Open Sans', family: 'Open Sans', generic: 'sans-serif' },
  { id: 'lato', label: 'Lato', family: 'Lato', generic: 'sans-serif' },
  { id: 'inter', label: 'Inter', family: 'Inter', generic: 'sans-serif' },
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat', generic: 'sans-serif' },
  { id: 'poppins', label: 'Poppins', family: 'Poppins', generic: 'sans-serif' },
  { id: 'raleway', label: 'Raleway', family: 'Raleway', generic: 'sans-serif' },
  { id: 'nunito', label: 'Nunito', family: 'Nunito', generic: 'sans-serif' },
  { id: 'source-sans-3', label: 'Source Sans 3', family: 'Source Sans 3', generic: 'sans-serif' },
  { id: 'oswald', label: 'Oswald', family: 'Oswald', generic: 'sans-serif' },
  { id: 'merriweather', label: 'Merriweather', family: 'Merriweather', generic: 'serif' },
  { id: 'playfair-display', label: 'Playfair Display', family: 'Playfair Display', generic: 'serif' },
  { id: 'roboto-mono', label: 'Roboto Mono', family: 'Roboto Mono', generic: 'monospace' },
];

const KHMER_FALLBACK = 'Noto Sans Khmer';

export const FONT_STACKS = {};
export const FONT_FAMILY_NAME = {};
for (const f of KHMER_FONTS) {
  // Khmer face first; a Latin face after it covers any Latin characters the
  // Khmer font itself doesn't include.
  FONT_STACKS[f.id] = `'${f.family}', Arial, Helvetica, sans-serif`;
  FONT_FAMILY_NAME[f.id] = f.family;
}
for (const f of LATIN_FONTS) {
  FONT_STACKS[f.id] = `'${f.family}', '${KHMER_FALLBACK}', ${f.generic}`;
  FONT_FAMILY_NAME[f.id] = f.family;
}

export const DEFAULT_FONT = 'noto-sans-khmer';

// Legacy ids from before the catalogue existed, so items created by an
// earlier version keep rendering with the same font they were given.
const LEGACY_FONT_IDS = { sans: 'noto-sans-khmer', serif: 'noto-serif-khmer', mono: 'roboto-mono' };
export function normalizeFontId(id) {
  if (!id) return DEFAULT_FONT;
  if (FONT_STACKS[id]) return id;
  return LEGACY_FONT_IDS[id] || DEFAULT_FONT;
}

// Each freehand draw tool is a distinct feel, not just a line -- opacity,
// blend mode, cap style, and how much a stroke's width reacts to pointer
// pressure are all fixed per tool (what makes a marker read as a marker and
// not a thin pen), while color/size/dash stay user-editable via state.draw.
// minRatio is the stroke's thinnest point as a fraction of the user's
// thickness setting (the fattest point, at full pressure) -- pencil varies
// the most (a soft point can go from a hairline to a smudge), highlighter
// the least (a real chisel tip stays close to one width regardless of how
// hard you press). Shared by editor.js (live canvas rendering) and
// exporter.js (rasterization for the exported PDF) so both draw identically.
export const DRAW_TOOL_STYLES = {
  pen:         { opacity: 1,    composite: 'source-over', cap: 'round',  minRatio: 0.55 },
  pencil:      { opacity: 0.75, composite: 'source-over', cap: 'round',  minRatio: 0.35 },
  marker:      { opacity: 0.55, composite: 'multiply',    cap: 'square', minRatio: 0.65 },
  highlighter: { opacity: 0.35, composite: 'multiply',    cap: 'square', minRatio: 0.8 },
};

// Suggested starting color/thickness for each tool -- applied whenever the
// tool is (re)selected from the sidebar, so switching tools immediately
// feels distinct (a thin dark pen vs. a thick yellow highlighter) rather
// than requiring the user to re-tune color/size by hand every time. Both
// remain freely user-editable afterwards via state.draw.
export const DRAW_TOOL_DEFAULT_COLOR = {
  pen: '#1a1a2e', pencil: '#3a3a3a', marker: '#e63946', highlighter: '#ffeb3b',
};
export const DRAW_TOOL_DEFAULT_SIZE = {
  pen: 2.5, pencil: 1.5, marker: 8, highlighter: 16,
};

// Dash pattern as a stroke-dasharray-style [on, off] pair, scaled to the
// current stroke width so dashes/dots stay proportional at any thickness.
// Returns null for 'solid' (both SVG and Canvas 2D treat that as "no dash").
export function dashPattern(dash, size) {
  if (dash === 'dashed') return [size * 3, size * 2];
  if (dash === 'dotted') return [size * 0.01, size * 1.8]; // paired with a round/square cap, renders as dots
  return null;
}

/* ---------- pressure-sensitive freehand strokes ----------
   A stroke's points are [x, y, pressure] triples (pressure 0-1; a real
   stylus or force-sensitive touch reports one, mouse/plain touch falls
   back to a fixed mid-range value so drawing still gets a reasonable
   width rather than the thinnest possible line -- same convention the
   signature pad already established). Every segment between two
   consecutive points is stroked individually with its own interpolated
   width (averaging the two endpoints' pressure), which is the standard
   technique for a variable-width line in Canvas 2D. Shared by editor.js
   (live drawing + rendering placed items) and exporter.js (rasterizing
   for the exported PDF) so both produce the same stroke. */

function widthAt(pressure, minWidth, maxWidth) {
  return minWidth + (maxWidth - minWidth) * pressure;
}

export function strokeSegment(ctx, a, b, opts) {
  const { color, minWidth, maxWidth, cap = 'round', dash = null } = opts;
  const pressure = ((a[2] ?? 0.5) + (b[2] ?? 0.5)) / 2;
  ctx.strokeStyle = color;
  ctx.lineCap = cap;
  ctx.lineJoin = cap === 'round' ? 'round' : 'miter';
  ctx.lineWidth = widthAt(pressure, minWidth, maxWidth);
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

export function strokeDot(ctx, p, opts) {
  const { color, minWidth, maxWidth } = opts;
  const r = widthAt(p[2] ?? 0.5, minWidth, maxWidth) / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.fill();
}

// Strokes every segment of a complete (already-finished) stroke in one
// call -- used wherever the whole path is drawn at once (a placed item's
// canvas, or export rasterization), as opposed to the live preview which
// draws incrementally as new points arrive.
export function strokeFullPath(ctx, points, opts) {
  if (!points.length) return;
  if (points.length === 1) { strokeDot(ctx, points[0], opts); return; }
  for (let i = 1; i < points.length; i++) strokeSegment(ctx, points[i - 1], points[i], opts);
}

export const state = {
  // Open documents, one per tab. Each holds its own sources/pages/scroll
  // position so switching tabs restores exactly what you left.
  docs: [],       // { id, name, sources, pages, pageIndex }
  activeDocId: null,
  mode: 'edit',
  tool: null,    // { type: 'text' } | { type: 'stamp', kind, dataUrl, natW, natH } | { type: 'highlight', color }
                 // | { type: 'draw', tool } | { type: 'shape', shape } | { type: 'eraser' }
  nextId: 1,
  viewMode: 'continuous', // 'continuous' | 'single' | 'double'
  zoom: 1,                // 1 = 100%
  lang: 'en',             // 'en' | 'km' -- interface language
  lastFont: null,
  // Shared settings for the Draw section's tools -- read when a new stroke/
  // shape is started, and written by its sidebar controls. Kept separate
  // from state.tool (which only describes which tool is armed) so switching
  // between pen/pencil/marker/highlighter/shapes doesn't reset color/size/
  // style, matching how a real drawing app remembers your last settings.
  draw: {
    tool: 'pen',       // 'pen' | 'pencil' | 'marker' | 'highlighter'
    color: '#1a1a2e',
    size: 3,
    dash: 'solid',     // 'solid' | 'dashed' | 'dotted'
    shape: 'rect',     // 'rect' | 'ellipse' | 'line' | 'arrow'
    fill: false,
  },
};

export function activeDoc() {
  return state.docs.find((d) => d.id === state.activeDocId) || null;
}

// `sources`, `pages` and `pageIndex` are exposed as accessors onto the
// active document rather than as plain fields. Every module already reads
// and writes state.pages/state.sources directly, so proxying them here makes
// multi-document support work throughout without touching that code -- and
// removes any chance of a tab's data drifting out of sync with a cached copy.
const EMPTY = [];
Object.defineProperties(state, {
  sources: {
    get: () => (activeDoc() ? activeDoc().sources : EMPTY),
    set: (v) => { const d = activeDoc(); if (d) d.sources = v; },
  },
  pages: {
    get: () => (activeDoc() ? activeDoc().pages : EMPTY),
    set: (v) => { const d = activeDoc(); if (d) d.pages = v; },
  },
  pageIndex: {
    get: () => (activeDoc() ? activeDoc().pageIndex : 0),
    set: (v) => { const d = activeDoc(); if (d) d.pageIndex = v; },
  },
});

export function addDoc(name) {
  const doc = { id: newId(), name, sources: [], pages: [], pageIndex: 0 };
  state.docs.push(doc);
  state.activeDocId = doc.id;
  return doc;
}

export function closeDoc(id) {
  const i = state.docs.findIndex((d) => d.id === id);
  if (i < 0) return;
  state.docs.splice(i, 1);
  if (state.activeDocId === id) {
    const next = state.docs[i] || state.docs[i - 1] || null;
    state.activeDocId = next ? next.id : null;
  }
}

export function newId() {
  return state.nextId++;
}

export const $ = (sel) => document.querySelector(sel);

export function showBusy(label) {
  $('#busy-label').textContent = label;
  $('#busy').hidden = false;
}

export function hideBusy() {
  $('#busy').hidden = true;
}

export function setHint(text) {
  const bar = $('#hint-bar');
  if (text) {
    bar.textContent = text;
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
}

export async function addSource(file) {
  const bytes = await fileToPdfBytes(file);
  // pdf.js transfers the buffer to its worker, so hand it a copy
  const pdfjs = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const srcIndex = state.sources.length;
  state.sources.push({ bytes, pdfjs, name: file.name });
  const pages = [];
  for (let i = 1; i <= pdfjs.numPages; i++) {
    const page = await pdfjs.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ id: newId(), srcIndex, srcPageNum: i, vw: vp.width, vh: vp.height, items: [] });
  }
  return pages;
}

/** True for the image types we can turn into a one-page document. */
export function isImageFile(file) {
  return /^image\/(png|jpeg|jpg|webp)$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}

/**
 * PDFs are used as-is; images are wrapped in a single PDF page sized to the
 * image, so the rest of the app only ever deals with PDFs. WebP has no
 * native PDF encoding, so it is re-encoded to PNG via a canvas first.
 */
export async function fileToPdfBytes(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isImageFile(file)) return bytes;

  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();
  const isJpeg = /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name);
  const isPng = /png/i.test(file.type) || /\.png$/i.test(file.name);
  let img;
  if (isJpeg) img = await doc.embedJpg(bytes);
  else if (isPng) img = await doc.embedPng(bytes);
  else img = await doc.embedPng(await reencodeToPng(file));
  const page = doc.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  return doc.save();
}

function reencodeToPng(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth;
      c.height = im.naturalHeight;
      c.getContext('2d').drawImage(im, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob(async (b) => {
        if (!b) return reject(new Error('image conversion failed'));
        resolve(new Uint8Array(await b.arrayBuffer()));
      }, 'image/png');
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read image')); };
    im.src = url;
  });
}

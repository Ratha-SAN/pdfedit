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

export const state = {
  sources: [],   // { bytes: Uint8Array, pdfjs: PDFDocumentProxy, name }
  pages: [],     // { id, srcIndex, srcPageNum, vw, vh, items: [] }
  mode: 'edit',
  tool: null,    // { type: 'text' } | { type: 'stamp', kind, dataUrl, natW, natH } | { type: 'highlight', color }
  nextId: 1,
  viewMode: 'continuous', // 'continuous' | 'single' | 'double'
  zoom: 1,                // 1 = 100%
  pageIndex: 0,           // current page (single) / left page of spread (double)
  lang: 'en',             // 'en' | 'km' -- interface language
};

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
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
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

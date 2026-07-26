import { state, $, showBusy, hideBusy, FONT_STACKS, FONT_FAMILY_NAME, normalizeFontId } from './state.js';
import { t } from './i18n.js';

const { PDFDocument, degrees, rgb, BlendMode } = PDFLib;

const libDocs = new Map(); // srcIndex -> PDFDocument

async function getLibDoc(srcIndex) {
  if (!libDocs.has(srcIndex)) {
    libDocs.set(srcIndex, await PDFDocument.load(state.sources[srcIndex].bytes));
  }
  return libDocs.get(srcIndex);
}

/* Compression works by re-rasterizing each page at a chosen resolution and
 * re-encoding it as JPEG. That is what actually shrinks a heavy scan, but it
 * is lossy and flattens any real text into pixels, so "Original quality"
 * stays the default and the trade-off is spelled out in the control's
 * tooltip. Overlays are drawn afterwards at full vector/PNG quality so added
 * text and signatures stay crisp regardless of level. */
const COMPRESSION = {
  none:   null,
  low:    { dpi: 150, quality: 0.82 },
  medium: { dpi: 110, quality: 0.68 },
  high:   { dpi: 72,  quality: 0.55 },
};

function currentCompression() {
  const el = $('#compress-level');
  return COMPRESSION[el ? el.value : 'none'] || null;
}

/* Estimating the exact output size would mean re-encoding every page, which
 * is exactly the expensive work compression is trying to let the user avoid
 * paying for twice. Instead this samples 1-2 representative pages (the
 * first, and the middle one on longer documents), rasterizes them at the
 * candidate preset, and extrapolates by page count -- cheap enough to run on
 * every dropdown change, even on a large document. */
export async function estimateExportSize(levelValue) {
  if (!state.pages.length) return 0;
  const preset = COMPRESSION[levelValue] || null;
  if (!preset) {
    return state.sources.reduce((sum, s) => sum + (s.bytes ? s.bytes.length : 0), 0);
  }
  const n = state.pages.length;
  const sampleIdx = n > 1 ? [0, Math.floor(n / 2)] : [0];
  let sampleTotal = 0;
  for (const i of sampleIdx) {
    sampleTotal += await rasterizedPageByteSize(state.pages[i], preset);
  }
  const perPage = sampleTotal / sampleIdx.length;
  // ~1.2KB/page fudge factor for PDF object/xref overhead on top of the
  // embedded JPEG stream itself.
  return Math.round(perPage * n + n * 1200);
}

async function rasterizedPageByteSize(page, preset) {
  const src = state.sources[page.srcIndex];
  const pdfPage = await src.pdfjs.getPage(page.srcPageNum);
  const scale = preset.dpi / 72;
  const vp = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
  const jpeg = await dataUrlToBytes(canvas.toDataURL('image/jpeg', preset.quality));
  canvas.width = 0;
  canvas.height = 0;
  return jpeg.length;
}

export function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return '~' + Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return '~' + (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function buildPdfBytes() {
  const preset = currentCompression();
  const out = await PDFDocument.create();
  for (const page of state.pages) {
    let outPage;
    if (preset) {
      outPage = await addRasterizedPage(out, page, preset);
    } else {
      const srcDoc = await getLibDoc(page.srcIndex);
      const [copied] = await out.copyPages(srcDoc, [page.srcPageNum - 1]);
      outPage = out.addPage(copied);
    }
    for (const item of page.items) {
      await drawItem(out, outPage, item);
    }
  }
  // useObjectStreams packs the cross-reference data more tightly; harmless at
  // any level and a small extra win on documents with many pages.
  return out.save({ useObjectStreams: true });
}

async function addRasterizedPage(out, page, preset) {
  const src = state.sources[page.srcIndex];
  const pdfPage = await src.pdfjs.getPage(page.srcPageNum);
  // PDF user-space is 72 units per inch, so target DPI / 72 is the scale.
  const scale = preset.dpi / 72;
  const vp = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
  const jpeg = await dataUrlToBytes(canvas.toDataURL('image/jpeg', preset.quality));
  const img = await out.embedJpg(jpeg);
  // Keep the page's original point size so overlay coordinates, and the
  // printed page size, are unchanged by the resolution drop.
  const outPage = out.addPage([page.vw, page.vh]);
  outPage.drawImage(img, { x: 0, y: 0, width: page.vw, height: page.vh });
  // Free the bitmap now rather than waiting on GC -- a long document would
  // otherwise hold every page's canvas at once.
  canvas.width = 0;
  canvas.height = 0;
  return outPage;
}

function outputName() {
  return (state.sources[0]?.name || 'document.pdf').replace(/\.pdf$/i, '') + '-edited.pdf';
}

export async function exportPdf() {
  showBusy(currentCompression() ? t('compressing') : t('buildingPdf'));
  try {
    const bytes = await buildPdfBytes();
    download(bytes, outputName());
  } finally {
    hideBusy();
  }
}

export async function printPdf() {
  showBusy(t('preparingPrint'));
  try {
    const bytes = await buildPdfBytes();
    await printBytes(bytes);
  } finally {
    hideBusy();
  }
}

function printBytes(bytes) {
  return new Promise((resolve) => {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0;';
    iframe.src = url;
    const cleanup = () => {
      setTimeout(() => { iframe.remove(); URL.revokeObjectURL(url); }, 60000);
      resolve();
    };
    iframe.onload = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch {
        window.open(url, '_blank');
      }
      cleanup();
    };
    document.body.appendChild(iframe);
  });
}

async function drawItem(out, outPage, item) {
  if (item.type === 'highlight') {
    if (!(item.w > 0 && item.h > 0)) return;
    const placement = mapViewportRect(outPage, item.x, item.y, item.w, item.h);
    const { r, g, b } = hexToRgb01(item.color);
    outPage.drawRectangle({
      x: placement.x,
      y: placement.y,
      width: item.w,
      height: item.h,
      rotate: placement.rotate,
      color: rgb(r, g, b),
      opacity: 0.45,
      blendMode: BlendMode.Multiply,
    });
    return;
  }
  let image, w, h;
  if (item.type === 'text') {
    if (!item.text.trim()) return;
    const canvas = await rasterizeText(item);
    const png = await dataUrlToBytes(canvas.toDataURL('image/png'));
    image = await out.embedPng(png);
    w = canvas.width / TEXT_SUPERSAMPLE;
    h = canvas.height / TEXT_SUPERSAMPLE;
  } else {
    const bytes = await dataUrlToBytes(item.dataUrl);
    image = item.dataUrl.startsWith('data:image/jpeg')
      ? await out.embedJpg(bytes)
      : await out.embedPng(bytes);
    w = item.w;
    h = item.h;
  }
  const placement = mapViewportRect(outPage, item.x, item.y, w, h);
  outPage.drawImage(image, { ...placement, width: w, height: h });
}

// Maps a rect given in pdf.js viewport coordinates (top-left origin, rotation
// applied) onto pdf-lib's unrotated page space, so overlays land where the
// user saw them even on pages with /Rotate set.
function mapViewportRect(outPage, vx, vy, w, h) {
  const { width: W, height: H } = outPage.getSize();
  const r = ((outPage.getRotation().angle % 360) + 360) % 360;
  switch (r) {
    case 90:  return { x: vy + h, y: vx, rotate: degrees(90) };
    case 180: return { x: W - vx, y: vy + h, rotate: degrees(180) };
    case 270: return { x: W - vy - h, y: H - vx, rotate: degrees(270) };
    default:  return { x: vx, y: H - vy - h, rotate: degrees(0) };
  }
}

const TEXT_SUPERSAMPLE = 3;
const LINE_HEIGHT = 1.6; // keep in sync with .text-content line-height in style.css

export async function rasterizeText(item) {
  const SS = TEXT_SUPERSAMPLE;
  const fontId = normalizeFontId(item.fontFamily);
  const family = FONT_FAMILY_NAME[fontId];
  const stack = FONT_STACKS[fontId];
  await document.fonts.load(`400 ${item.fontSize * SS}px "${family}"`, 'ស្ត្រីខ្មែរ');
  const fontStr = `400 ${item.fontSize * SS}px ${stack}`;
  const lines = item.text.split('\n');
  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d');
  ctx.font = fontStr;
  let maxW = 1;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const lineH = item.fontSize * LINE_HEIGHT * SS;
  canvas.width = Math.ceil(maxW) + 2 * SS;
  canvas.height = Math.ceil(lineH * lines.length);
  ctx = canvas.getContext('2d');
  ctx.font = fontStr;
  ctx.fillStyle = item.color;
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, SS, (i + 0.5) * lineH));
  return canvas;
}

function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

async function dataUrlToBytes(dataUrl) {
  const res = await fetch(dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

function download(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

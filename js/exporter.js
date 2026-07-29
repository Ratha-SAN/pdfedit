import { state, $, showBusy, hideBusy, FONT_STACKS, FONT_FAMILY_NAME, normalizeFontId, DRAW_TOOL_STYLES, dashPattern, strokeFullPath } from './state.js';
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

export function outputName() {
  return (state.sources[0]?.name || 'document.pdf').replace(/\.pdf$/i, '') + '-edited.pdf';
}

export async function exportPdf(filename) {
  showBusy(currentCompression() ? t('compressing') : t('buildingPdf'));
  try {
    const bytes = await buildPdfBytes();
    download(bytes, filename || outputName());
  } finally {
    hideBusy();
  }
}

// Lets the user pick the exact folder + filename via the browser's native
// Save-As dialog (Chrome/Edge only -- no such API exists for Firefox/Safari,
// which fall back to exportPdf()'s plain download instead). Asks for the
// destination *before* building the PDF so cancelling the picker (throws
// AbortError, left for the caller to swallow) never pays for the build.
export async function exportPdfToFileHandle(filename) {
  const handle = await window.showSaveFilePicker({
    suggestedName: filename,
    types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
  });
  showBusy(currentCompression() ? t('compressing') : t('buildingPdf'));
  try {
    const bytes = await buildPdfBytes();
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
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
  let image, w, h, blendMode;
  if (item.type === 'text') {
    if (!item.text.trim()) return;
    const canvas = await rasterizeText(item);
    const png = await dataUrlToBytes(canvas.toDataURL('image/png'));
    image = await out.embedPng(png);
    w = canvas.width / TEXT_SUPERSAMPLE;
    h = canvas.height / TEXT_SUPERSAMPLE;
  } else if (item.type === 'draw') {
    const canvas = rasterizeDraw(item);
    const png = await dataUrlToBytes(canvas.toDataURL('image/png'));
    image = await out.embedPng(png);
    w = item.w;
    h = item.h;
    // Marker/highlighter darken where they overlap the page's own content
    // on screen via mix-blend-mode:multiply; blendMode here is pdf-lib's
    // equivalent, applied at placement (baking it into the raster itself
    // would have nothing underneath yet to multiply against).
    const style = DRAW_TOOL_STYLES[item.tool] || DRAW_TOOL_STYLES.pen;
    if (style.composite === 'multiply') blendMode = BlendMode.Multiply;
  } else if (item.type === 'shape') {
    const canvas = rasterizeShape(item);
    const png = await dataUrlToBytes(canvas.toDataURL('image/png'));
    image = await out.embedPng(png);
    w = item.w;
    h = item.h;
  } else {
    const bytes = await dataUrlToBytes(item.dataUrl);
    image = item.dataUrl.startsWith('data:image/jpeg')
      ? await out.embedJpg(bytes)
      : await out.embedPng(bytes);
    w = item.w;
    h = item.h;
  }
  const placement = mapViewportRect(outPage, item.x, item.y, w, h);
  outPage.drawImage(image, { ...placement, width: w, height: h, ...(blendMode ? { blendMode } : {}) });
}

// Freehand strokes and shapes are rasterized (like text already is) rather
// than drawn as native PDF vector paths -- pdf-lib's drawSvgPath flips and
// positions its path data in ways this codebase hasn't verified across
// rotated pages, whereas mapViewportRect + drawImage below is the same,
// already-tested path text/images use. A drawing tool's output not
// remaining vector-editable in the exported PDF matches the existing
// tradeoff for text (see README's Known limitations).
const DRAW_SUPERSAMPLE = 2;

function rasterizeDraw(item) {
  const SS = DRAW_SUPERSAMPLE;
  const style = DRAW_TOOL_STYLES[item.tool] || DRAW_TOOL_STYLES.pen;
  const w = Math.max(1, Math.ceil(item.natW * SS));
  const h = Math.max(1, Math.ceil(item.natH * SS));

  const buf = document.createElement('canvas');
  buf.width = w; buf.height = h;
  const bctx = buf.getContext('2d');
  bctx.scale(SS, SS);
  const minWidth = item.size * style.minRatio;
  const dash = dashPattern(item.dash, item.size);
  strokeFullPath(bctx, item.points, { color: item.color, minWidth, maxWidth: item.size, cap: style.cap, dash });

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.globalAlpha = style.opacity;
  ctx.drawImage(buf, 0, 0);
  return canvas;
}

function rasterizeShape(item) {
  const SS = DRAW_SUPERSAMPLE;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(item.natW * SS));
  canvas.height = Math.max(1, Math.ceil(item.natH * SS));
  const ctx = canvas.getContext('2d');
  ctx.scale(SS, SS);
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.size;
  ctx.setLineDash(dashPattern(item.dash, item.size) || []);

  if (item.shape === 'rect') {
    const inset = item.size / 2 + 1;
    const x = inset, y = inset, w = item.natW - inset * 2, h = item.natH - inset * 2;
    if (item.fill) ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  } else if (item.shape === 'ellipse') {
    const inset = item.size / 2 + 1;
    const rx = Math.max(0.1, item.natW / 2 - inset), ry = Math.max(0.1, item.natH / 2 - inset);
    ctx.beginPath();
    ctx.ellipse(item.natW / 2, item.natH / 2, rx, ry, 0, 0, Math.PI * 2);
    if (item.fill) ctx.fill();
    ctx.stroke();
  } else {
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(item.p1[0], item.p1[1]);
    ctx.lineTo(item.p2[0], item.p2[1]);
    ctx.stroke();
    if (item.shape === 'arrow') drawArrowheadOnCtx(ctx, item.p1[0], item.p1[1], item.p2[0], item.p2[1], item.size, item.color);
  }
  return canvas;
}

// Manual trigonometry rather than an SVG <marker> (Canvas 2D has no
// equivalent primitive) -- proportions tuned to roughly match the live
// on-screen SVG arrowhead (buildArrowMarker in editor.js).
function drawArrowheadOnCtx(ctx, x1, y1, x2, y2, size, color) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const len = size * 2.7, wing = size * 1.4;
  ctx.save();
  ctx.translate(x2, y2);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-len, wing);
  ctx.lineTo(-len, -wing);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
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

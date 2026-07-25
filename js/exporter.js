import { state, showBusy, hideBusy } from './state.js';

const { PDFDocument, degrees, rgb } = PDFLib;

const libDocs = new Map(); // srcIndex -> PDFDocument

async function getLibDoc(srcIndex) {
  if (!libDocs.has(srcIndex)) {
    libDocs.set(srcIndex, await PDFDocument.load(state.sources[srcIndex].bytes));
  }
  return libDocs.get(srcIndex);
}

export async function exportPdf() {
  showBusy('Building PDF…');
  try {
    const out = await PDFDocument.create();
    for (const page of state.pages) {
      const srcDoc = await getLibDoc(page.srcIndex);
      const [copied] = await out.copyPages(srcDoc, [page.srcPageNum - 1]);
      const outPage = out.addPage(copied);
      for (const item of page.items) {
        await drawItem(out, outPage, item);
      }
    }
    const bytes = await out.save();
    const name = (state.sources[0]?.name || 'document.pdf').replace(/\.pdf$/i, '') + '-edited.pdf';
    download(bytes, name);
  } finally {
    hideBusy();
  }
}

async function drawItem(out, outPage, item) {
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
const TEXT_FONT_STACK = '"Noto Sans Khmer", "Khmer OS", system-ui, sans-serif';
const LINE_HEIGHT = 1.6; // keep in sync with .text-content line-height in style.css

export async function rasterizeText(item) {
  const SS = TEXT_SUPERSAMPLE;
  await document.fonts.load(`400 ${item.fontSize * SS}px "Noto Sans Khmer"`, 'ស្ត្រីខ្មែរ');
  const fontStr = `400 ${item.fontSize * SS}px ${TEXT_FONT_STACK}`;
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

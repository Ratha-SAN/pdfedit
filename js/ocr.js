import { state, $ } from './state.js';
import { t, translateOcrStatus } from './i18n.js';

let workerPromise = null;
let workerLang = null;

const OCR_LANG_KEY = { khm: 'ocrLangKhmer', eng: 'ocrLangEnglish', 'khm+eng': 'ocrLangBoth' };

function ocrLangLabel(lang) {
  return t(OCR_LANG_KEY[lang] || 'ocrLangKhmer');
}

// Creates the worker once (loading the wasm core is the expensive part),
// then reuses it across languages via reinitialize() -- which only needs
// to (re)load the requested traineddata file(s), not the whole core. The
// logger callback is fixed at creation time (this build's worker has no
// setLogger), but that's fine: every call's callback just re-queries the
// same fixed #ocr-progress DOM elements, so reusing the first one works
// identically to a fresh one would.
async function getWorker(lang, onProgress) {
  if (!workerPromise) {
    const base = new URL('.', location.href).href;
    workerPromise = Tesseract.createWorker(lang, 1, {
      workerPath: base + 'vendor/tesseract-worker.min.js',
      corePath: base + 'vendor',
      langPath: base + 'tessdata',
      gzip: true,
      logger: (m) => onProgress && onProgress(m),
    });
    workerLang = lang;
    return workerPromise;
  }
  const worker = await workerPromise;
  if (workerLang !== lang) {
    await worker.reinitialize(lang);
    workerLang = lang;
  }
  return worker;
}

export async function recognizePage(page) {
  await runRecognition(() => renderPageForOcr(page));
}

export async function recognizeArea(page, rect) {
  await runRecognition(() => renderAreaForOcr(page, rect));
}

async function runRecognition(getCanvas) {
  const lang = $('#ocr-lang').value;
  const modal = $('#ocr-modal');
  const progress = $('#ocr-progress');
  const bar = $('#ocr-progress-bar');
  const label = $('#ocr-progress-label');
  const output = $('#ocr-output');
  $('#ocr-modal-title').textContent = t('ocrModalTitle', { lang: ocrLangLabel(lang) });
  output.value = '';
  progress.hidden = false;
  bar.style.inset = '0 100% 0 0';
  label.textContent = t('ocrLoadingEngine');
  modal.hidden = false;

  const onProgress = (m) => {
    if (m.status === 'recognizing text') {
      bar.style.inset = `0 ${100 - Math.round(m.progress * 100)}% 0 0`;
      label.textContent = t('ocrRecognizing', { pct: Math.round(m.progress * 100) });
    } else if (m.status) {
      label.textContent = translateOcrStatus(m.status);
    }
  };

  try {
    const worker = await getWorker(lang, onProgress);
    const canvas = await getCanvas();
    label.textContent = t('ocrRecognizingStart');
    const { data } = await worker.recognize(canvas);
    output.value = data.text.trim() || t('ocrNoText');
  } catch (err) {
    output.value = t('ocrFailed', { err: err && err.message ? err.message : err });
  } finally {
    progress.hidden = true;
  }
}

async function renderPageForOcr(page) {
  const src = state.sources[page.srcIndex];
  const pdfPage = await src.pdfjs.getPage(page.srcPageNum);
  const scale = Math.min(2.5, 2400 / page.vw);
  const vp = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

// rect is in the same page-space coordinates as item.x/y/w/h (pdf.js
// viewport units at scale 1). Renders just that sub-rectangle at a
// resolution suited to its size, rather than rendering the whole page.
async function renderAreaForOcr(page, rect) {
  const src = state.sources[page.srcIndex];
  const pdfPage = await src.pdfjs.getPage(page.srcPageNum);
  const scale = Math.min(6, Math.max(1.5, 1500 / Math.max(rect.w, 1)));
  const vp = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.w * scale));
  canvas.height = Math.max(1, Math.round(rect.h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(-rect.x * scale, -rect.y * scale);
  await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

export function initOcr() {
  $('#ocr-copy').addEventListener('click', async () => {
    const output = $('#ocr-output');
    output.select();
    try {
      await navigator.clipboard.writeText(output.value);
      $('#ocr-copy').textContent = t('ocrCopied');
      setTimeout(() => { $('#ocr-copy').textContent = t('ocrCopy'); }, 1500);
    } catch {
      document.execCommand('copy');
    }
  });
}

import { state, $ } from './state.js';

let workerPromise = null;

function getWorker(onProgress) {
  if (!workerPromise) {
    const base = new URL('.', location.href).href;
    workerPromise = Tesseract.createWorker('khm', 1, {
      workerPath: base + 'vendor/tesseract-worker.min.js',
      corePath: base + 'vendor',
      langPath: base + 'tessdata',
      gzip: true,
      logger: (m) => onProgress && onProgress(m),
    });
  }
  return workerPromise;
}

export async function recognizePage(page) {
  const modal = $('#ocr-modal');
  const progress = $('#ocr-progress');
  const bar = $('#ocr-progress-bar');
  const label = $('#ocr-progress-label');
  const output = $('#ocr-output');
  output.value = '';
  progress.hidden = false;
  bar.style.inset = '0 100% 0 0';
  label.textContent = 'Loading OCR engine…';
  modal.hidden = false;

  const onProgress = (m) => {
    if (m.status === 'recognizing text') {
      bar.style.inset = `0 ${100 - Math.round(m.progress * 100)}% 0 0`;
      label.textContent = `Recognizing… ${Math.round(m.progress * 100)}%`;
    } else if (m.status) {
      label.textContent = m.status;
    }
  };

  try {
    const worker = await getWorker(onProgress);
    const canvas = await renderPageForOcr(page);
    label.textContent = 'Recognizing…';
    const { data } = await worker.recognize(canvas);
    output.value = data.text.trim() || '(no text found)';
  } catch (err) {
    output.value = 'OCR failed: ' + (err && err.message ? err.message : err);
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

export function initOcr() {
  $('#ocr-copy').addEventListener('click', async () => {
    const output = $('#ocr-output');
    output.select();
    try {
      await navigator.clipboard.writeText(output.value);
      $('#ocr-copy').textContent = 'Copied!';
      setTimeout(() => { $('#ocr-copy').textContent = 'Copy text'; }, 1500);
    } catch {
      document.execCommand('copy');
    }
  });
}

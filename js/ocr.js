import { state, $ } from './state.js';
import { t, translateOcrStatus } from './i18n.js';
import { dataToLatexLines, dataToLatexLinesWithBars, detectFractionBars, eraseBars, medianGlyphHeight } from './mathlatex.js';

let workerPromise = null;
let workerLang = null;

// Characters worth allowing in math mode. Restricting the alphabet stops the
// engine from "correcting" isolated symbols into dictionary words, which is
// what makes plain prose models mangle equations.
const MATH_WHITELIST =
  '0123456789' +
  'abcdefghijklmnopqrstuvwxyz' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  '+-=*/^_()[]{}<>|.,;:\'"!?%$#\\ ' +
  '√∛∫∮∑∏πθφλμσΩΔαβγδεζηικνξρτυχψω' +
  '×÷±∓≤≥≠≈≡∝∞∂∇∈∉⊂⊃∪∩∀∃→←↔⇒⇔°′″';

// Each mode maps to the tesseract language string plus any parameters.
// NOTE: tesseract's own `equ` (equation) traineddata was evaluated here and
// dropped -- on clean printed formulas it returned *no output at all* (0/6 on
// a six-equation test page) while plain `eng` scored 6/6 on the same input.
// Math mode is therefore `eng` with a math-oriented alphabet and a
// single-uniform-block page segmentation, which measured best.
const OCR_MODES = {
  auto: { langs: 'khm+eng', labelKey: 'ocrLangAuto' },
  khm:  { langs: 'khm',     labelKey: 'ocrLangKhmer' },
  eng:  { langs: 'eng',     labelKey: 'ocrLangEnglish' },
  math: {
    langs: 'eng',
    labelKey: 'ocrLangMath',
    params: { tessedit_pageseg_mode: '6', tessedit_char_whitelist: MATH_WHITELIST },
  },
};

function currentMode() {
  const checked = document.querySelector('input[name="ocr-lang"]:checked');
  return OCR_MODES[checked?.value] ? checked.value : 'auto';
}

// Creates the worker once (loading the wasm core is the expensive part),
// then reuses it across languages via reinitialize() -- which only needs
// to (re)load the requested traineddata file(s), not the whole core. The
// logger callback is fixed at creation time (this build's worker has no
// setLogger), but that's fine: every call's callback just re-queries the
// same fixed #ocr-progress DOM elements, so reusing the first one works
// identically to a fresh one would.
async function getWorker(langs, onProgress) {
  if (!workerPromise) {
    const base = new URL('.', location.href).href;
    workerPromise = Tesseract.createWorker(langs, 1, {
      workerPath: base + 'vendor/tesseract-worker.min.js',
      corePath: base + 'vendor',
      langPath: base + 'tessdata',
      gzip: true,
      logger: (m) => onProgress && onProgress(m),
    });
    workerLang = langs;
    return workerPromise;
  }
  const worker = await workerPromise;
  if (workerLang !== langs) {
    await worker.reinitialize(langs);
    workerLang = langs;
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
  const modeId = currentMode();
  const mode = OCR_MODES[modeId];
  const modal = $('#ocr-modal');
  const progress = $('#ocr-progress');
  const bar = $('#ocr-progress-bar');
  const label = $('#ocr-progress-label');
  const output = $('#ocr-output');
  $('#ocr-modal-title').textContent = t('ocrModalTitle', { lang: t(mode.labelKey) });
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
    const worker = await getWorker(mode.langs, onProgress);
    // Parameters persist on the worker between runs, so always write the
    // full set -- otherwise math mode's restricted alphabet would leak into
    // the next Khmer/English run and silently mangle it.
    await worker.setParameters({
      tessedit_pageseg_mode: mode.params?.tessedit_pageseg_mode ?? '3',
      tessedit_char_whitelist: mode.params?.tessedit_char_whitelist ?? '',
    });
    const canvas = await getCanvas();
    label.textContent = t('ocrRecognizingStart');
    // Ask for the structured (block/word/symbol) output too -- math mode
    // rebuilds super/subscripts from per-symbol geometry, which the flat
    // text string throws away.
    const OUT = { text: true, blocks: true };
    let { data } = await worker.recognize(canvas, {}, OUT);
    let bars = [];

    if (modeId === 'math') {
      // Second pass for maths. Fraction bars carry structure the recogniser
      // can't use but *can* corrupt neighbouring glyphs, so they're found
      // geometrically, painted out, and the page re-read. Detection needs the
      // first pass's glyph size to tell a real bar from an ordinary
      // horizontal stroke, hence two passes rather than one.
      bars = detectFractionBars(canvas, medianGlyphHeight(data));
      if (bars.length) {
        eraseBars(canvas, bars);
        const second = await worker.recognize(canvas, {}, OUT);
        data = second.data;
      }
    }
    output.value = data.text.trim() || t('ocrNoText');
    showResult(modeId, data, bars);
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

/* ---------- result views ---------- */

let latexLines = [];

function renderLatexInto(el, lines) {
  el.innerHTML = '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const div = document.createElement('div');
    div.className = 'math-line';
    try {
      katex.render(line, div, { throwOnError: false, displayMode: false });
    } catch {
      // Anything KaTeX can't parse still shows, just unrendered, so a single
      // bad line never blanks the whole panel.
      div.classList.add('math-raw');
      div.textContent = line;
    }
    el.appendChild(div);
  }
  if (!el.childNodes.length) el.textContent = t('ocrNoText');
}

function setView(view) {
  document.querySelectorAll('.ocr-view-tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  const out = $('#ocr-output');
  // The preview stays up in LaTeX view too, so edits can be seen as they're
  // typed -- which matters because OCR frequently misreads small raised
  // digits, and correcting them by hand is the practical workflow.
  $('#ocr-rendered').hidden = view === 'text';
  out.hidden = view === 'rendered';
  if (view === 'latex') {
    out.value = latexLines.join('\n');
    renderLatexInto($('#ocr-rendered'), latexLines);
  } else if (view === 'text') {
    out.value = out.dataset.plain || '';
  } else {
    renderLatexInto($('#ocr-rendered'), latexLines);
  }
}

function showResult(modeId, data, bars) {
  const output = $('#ocr-output');
  output.dataset.plain = output.value;
  const views = $('#ocr-views');
  const rendered = $('#ocr-rendered');

  // Only maths gets the rendered/LaTeX treatment; for prose the extra views
  // would be noise.
  if (modeId !== 'math') {
    views.hidden = true;
    rendered.hidden = true;
    output.hidden = false;
    latexLines = [];
    return;
  }

  latexLines = (bars && bars.length) ? dataToLatexLinesWithBars(data, bars) : dataToLatexLines(data);
  renderLatexInto(rendered, latexLines);
  views.hidden = false;
  setView('rendered');
}

export function initOcr() {
  document.querySelectorAll('.ocr-view-tab').forEach((b) =>
    b.addEventListener('click', () => setView(b.dataset.view)));

  // Live preview while editing LaTeX.
  $('#ocr-output').addEventListener('input', () => {
    const active = document.querySelector('.ocr-view-tab.active');
    if (!active || active.dataset.view !== 'latex') return;
    latexLines = $('#ocr-output').value.split('\n');
    renderLatexInto($('#ocr-rendered'), latexLines);
  });

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

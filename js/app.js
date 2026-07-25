import { state, $, showBusy, hideBusy, setHint, addSource } from './state.js';
import { renderEditView, armTool, initSignatureModal, openSignatureModal, initViewControls, currentPage, fileToDataUrl, loadImage, deselectAll, refreshEditI18n } from './editor.js';
import { renderPagesView, initPagesMode, refreshPagesI18n } from './pagesMode.js';
import { exportPdf, printPdf } from './exporter.js';
import { recognizePage, initOcr } from './ocr.js';
import { t, initLang } from './i18n.js';
import { initTheme } from './theme.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', location.href).href;

initLang();
initTheme();

/* ---------- upload ---------- */

const dropzone = $('#dropzone');
const fileInput = $('#file-input');

$('#btn-pick').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) openFirstPdf(file);
});

$('#btn-upload').addEventListener('click', () => {
  if (state.pages.length && !confirm(t('confirmReplace'))) return;
  fileInput.click();
});

['dragover', 'dragenter'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => {
  const file = [...e.dataTransfer.files].find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (file) openFirstPdf(file);
});

async function openFirstPdf(file) {
  showBusy(t('loadingPdf'));
  try {
    state.sources = [];
    const pages = await addSource(file);
    state.pages = pages;
    state.pageIndex = 0;
    dropzone.hidden = true;
    $('#mode-tabs').hidden = false;
    $('#toolbar').hidden = false;
    await setMode('edit');
  } catch (err) {
    alert(t('couldNotReadPdf', { err: err && err.message ? err.message : err }));
  } finally {
    hideBusy();
  }
}

/* ---------- mode switching ---------- */

async function setMode(mode) {
  state.mode = mode;
  armTool(null);
  $('#tab-edit').classList.toggle('active', mode === 'edit');
  $('#tab-pages').classList.toggle('active', mode === 'pages');
  $('#edit-view').hidden = mode !== 'edit';
  $('#pages-view').hidden = mode !== 'pages';
  $('#view-tools').hidden = mode !== 'edit';
  $('#edit-tools').hidden = mode !== 'edit';
  $('#pages-tools').hidden = mode !== 'pages';
  if (mode === 'edit') await renderEditView();
  else await renderPagesView();
}

$('#tab-edit').addEventListener('click', () => setMode('edit'));
$('#tab-pages').addEventListener('click', () => setMode('pages'));

// Item toolbars, thumbnail labels, and the remove-selected button embed
// translated text generated at render time. Patch it in place rather than
// re-rendering the current view, which would rebuild every canvas and drop
// the current selection or an in-progress text edit.
document.addEventListener('langchange', () => {
  refreshEditI18n();
  refreshPagesI18n();
});

/* ---------- edit tools ---------- */

$('#btn-add-text').addEventListener('click', () => {
  if (state.tool && state.tool.type === 'text') armTool(null);
  else armTool({ type: 'text' }, t('textToolHint'));
});

$('#btn-add-image').addEventListener('click', () => $('#image-input').click());
$('#image-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const dataUrl = await fileToDataUrl(file);
  const img = await loadImage(dataUrl);
  armTool(
    { type: 'stamp', kind: 'image', dataUrl, natW: img.naturalWidth, natH: img.naturalHeight },
    t('imageToolHint')
  );
});

$('#btn-add-signature').addEventListener('click', openSignatureModal);
initSignatureModal((sig) => {
  armTool(
    { type: 'stamp', kind: 'signature', dataUrl: sig.dataUrl, natW: sig.natW, natH: sig.natH },
    t('signatureToolHint')
  );
});

$('#btn-add-highlight').addEventListener('click', () => {
  if (state.tool && state.tool.type === 'highlight') armTool(null);
  else armTool(
    { type: 'highlight', color: '#ffff00' },
    t('highlightToolHint')
  );
});

$('#btn-ocr').addEventListener('click', () => {
  const page = currentPage();
  if (page) recognizePage(page);
});

$('#btn-ocr-area').addEventListener('click', () => {
  if (state.tool && state.tool.type === 'ocr-area') armTool(null);
  else armTool({ type: 'ocr-area' }, t('ocrAreaHint'));
});

$('#btn-export').addEventListener('click', async () => {
  deselectAll();
  try {
    await exportPdf();
  } catch (err) {
    hideBusy();
    alert(t('exportFailed', { err: err && err.message ? err.message : err }));
  }
});

$('#btn-print').addEventListener('click', async () => {
  deselectAll();
  try {
    await printPdf();
  } catch (err) {
    hideBusy();
    alert(t('printFailed', { err: err && err.message ? err.message : err }));
  }
});

/* ---------- modals ---------- */

document.querySelectorAll('.modal-close').forEach((btn) =>
  btn.addEventListener('click', () => { $('#' + btn.dataset.close).hidden = true; })
);
document.querySelectorAll('.modal').forEach((m) =>
  m.addEventListener('pointerdown', (e) => { if (e.target === m) m.hidden = true; })
);

initPagesMode();
initOcr();
initViewControls();

// Pre-warm the Khmer font so canvas measurement is correct on first use
document.fonts.load('400 16px "Noto Sans Khmer"', 'ស្ត្រីខ្មែរ');

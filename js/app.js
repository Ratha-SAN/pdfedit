import { state, $, showBusy, hideBusy, setHint, addSource } from './state.js';
import { renderEditView, armTool, initSignatureModal, openSignatureModal, initViewControls, currentPage, fileToDataUrl, loadImage, deselectAll } from './editor.js';
import { renderPagesView, initPagesMode } from './pagesMode.js';
import { exportPdf, printPdf } from './exporter.js';
import { recognizePage, initOcr } from './ocr.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', location.href).href;

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
  if (state.pages.length && !confirm('Open a different PDF? This replaces the current document; any unsaved edits will be lost.')) return;
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
  showBusy('Loading PDF…');
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
    alert('Could not read that PDF: ' + (err && err.message ? err.message : err));
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

/* ---------- edit tools ---------- */

$('#btn-add-text').addEventListener('click', () => {
  if (state.tool && state.tool.type === 'text') armTool(null);
  else armTool({ type: 'text' }, 'Click anywhere on a page to place a text box. Type Khmer or English, drag to move, use the corner handle to resize.');
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
    'Click on a page to place the image.'
  );
});

$('#btn-add-signature').addEventListener('click', openSignatureModal);
initSignatureModal((sig) => {
  armTool(
    { type: 'stamp', kind: 'signature', dataUrl: sig.dataUrl, natW: sig.natW, natH: sig.natH },
    'Click on a page to place the signature.'
  );
});

$('#btn-add-highlight').addEventListener('click', () => {
  if (state.tool && state.tool.type === 'highlight') armTool(null);
  else armTool(
    { type: 'highlight', color: '#ffff00' },
    'Drag across a page to highlight (or click for a default size). Change the color afterward from the highlight’s own toolbar.'
  );
});

$('#btn-ocr').addEventListener('click', () => {
  const page = currentPage();
  if (page) recognizePage(page);
});

$('#btn-export').addEventListener('click', async () => {
  deselectAll();
  try {
    await exportPdf();
  } catch (err) {
    hideBusy();
    alert('Export failed: ' + (err && err.message ? err.message : err));
  }
});

$('#btn-print').addEventListener('click', async () => {
  deselectAll();
  try {
    await printPdf();
  } catch (err) {
    hideBusy();
    alert('Print failed: ' + (err && err.message ? err.message : err));
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

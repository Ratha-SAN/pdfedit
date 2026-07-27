import { state, $, showBusy, hideBusy, setHint, addSource, addDoc, closeDoc, activeDoc, isImageFile } from './state.js';
import { renderEditView, armTool, initSignatureModal, openSignatureModal, initViewControls, currentPage, fileToDataUrl, loadImage, deselectAll, refreshEditI18n } from './editor.js';
import { renderPagesView, initPagesMode, refreshPagesI18n } from './pagesMode.js';
import { exportPdf, printPdf, estimateExportSize, formatBytes } from './exporter.js';
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
  const files = [...e.target.files];
  e.target.value = '';
  openFiles(files);
});

// Opening no longer replaces what you have open -- each file becomes its own
// tab, so several documents can be worked on side by side.
$('#btn-upload').addEventListener('click', () => fileInput.click());

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
  openFiles([...e.dataTransfer.files].filter(isOpenable));
});
// Dropping onto the document area (not just the empty dropzone) opens too.
$('#main').addEventListener('dragover', (e) => { if (state.docs.length) e.preventDefault(); });
$('#main').addEventListener('drop', (e) => {
  const files = [...e.dataTransfer.files].filter(isOpenable);
  if (!files.length) return;
  e.preventDefault();
  openFiles(files);
});

function isOpenable(f) {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || isImageFile(f);
}

async function openFiles(files) {
  if (!files || !files.length) return;
  showBusy(t('loadingPdf'));
  try {
    for (const file of files) {
      const doc = addDoc(file.name);
      try {
        doc.pages = await addSource(file);
      } catch (err) {
        // Drop the half-created tab so a bad file doesn't leave an empty one.
        closeDoc(doc.id);
        alert(t('couldNotReadPdf', { err: err && err.message ? err.message : err }));
      }
    }
    if (!activeDoc()) return;
    dropzone.hidden = true;
    $('#mode-tabs').hidden = false;
    $('#sidebar').hidden = false;
    $('#topbar-tools').hidden = false;
    $('#topbar-actions').hidden = false;
    renderDocTabs();
    await setMode('edit');
    updateCompressEstimate();
  } finally {
    hideBusy();
  }
}

/* ---------- document tabs ---------- */

export function renderDocTabs() {
  const bar = $('#doc-tabs');
  bar.innerHTML = '';
  bar.hidden = state.docs.length === 0;
  for (const doc of state.docs) {
    const tab = document.createElement('div');
    tab.className = 'doc-tab' + (doc.id === state.activeDocId ? ' active' : '');
    tab.dataset.docId = doc.id;
    tab.title = doc.name;

    const name = document.createElement('span');
    name.className = 'doc-name';
    name.textContent = doc.name;
    tab.appendChild(name);

    const close = document.createElement('button');
    close.className = 'doc-close';
    close.textContent = '×';
    close.title = t('closeDocTitle');
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      if (doc.pages.length && !confirm(t('confirmCloseDoc', { name: doc.name }))) return;
      closeDoc(doc.id);
      renderDocTabs();
      if (!state.docs.length) {
        dropzone.hidden = false;
        $('#mode-tabs').hidden = true;
        $('#sidebar').hidden = true;
        $('#topbar-tools').hidden = true;
        $('#topbar-actions').hidden = true;
        $('#edit-view').hidden = true;
        $('#pages-view').hidden = true;
      } else {
        setMode(state.mode);
        updateCompressEstimate();
      }
    });
    tab.appendChild(close);

    tab.addEventListener('click', () => {
      if (doc.id === state.activeDocId) return;
      state.activeDocId = doc.id;
      renderDocTabs();
      setMode(state.mode);
      updateCompressEstimate();
    });
    bar.appendChild(tab);
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
  $('#topbar-view').hidden = mode !== 'edit';
  $('#edit-tools').hidden = mode !== 'edit';
  $('#ocr-tools').hidden = mode !== 'edit';
  $('#pages-tools').hidden = mode !== 'pages';
  // The compression control is the same element either way -- just moved
  // bodily between the top bar and the Pages sidebar section, so its
  // selected value and live estimate survive the move untouched.
  if (mode === 'pages') $('#pages-compress-anchor').appendChild($('#topbar-compress'));
  else $('#topbar-tools').appendChild($('#topbar-compress'));
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

/* ---------- sidebar sections ---------- */

// Sections collapse so the longer ones (recognition options, output quality)
// don't push everything else off-screen.
document.querySelectorAll('.side-head').forEach((head) => {
  head.addEventListener('click', () => {
    const open = head.getAttribute('aria-expanded') === 'true';
    head.setAttribute('aria-expanded', String(!open));
    head.nextElementSibling.hidden = open;
  });
});

$('#mi-ocr-page').addEventListener('click', () => {
  const page = currentPage();
  if (page) recognizePage(page);
});

$('#mi-ocr-area').addEventListener('click', () => {
  if (state.tool && state.tool.type === 'ocr-area') armTool(null);
  else armTool({ type: 'ocr-area' }, t('ocrAreaHint'));
});

/* ---------- compression size estimate ---------- */

let estimateToken = 0;
async function updateCompressEstimate() {
  const label = $('#compress-estimate');
  if (!label || !state.pages.length) { if (label) label.textContent = ''; return; }
  const token = ++estimateToken;
  label.textContent = t('estimating');
  const bytes = await estimateExportSize($('#compress-level').value);
  if (token !== estimateToken) return; // a newer request/selection superseded this one
  label.textContent = formatBytes(bytes);
}
$('#compress-level').addEventListener('change', updateCompressEstimate);

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

/* ---------- features page ---------- */

// An in-page modal (iframe) rather than a separate tab/window -- some
// mobile browsers and in-app webviews block or mishandle window.open(),
// which could leave the button doing nothing or, worse, navigating the
// editor tab away from the loaded document. A same-page modal has no such
// failure mode. The iframe's src is set on first open only, so the modal
// starts empty and its scroll position/state persists across repeated
// opens for the rest of this session (it's hidden, not destroyed, when
// closed).
$('#btn-features').addEventListener('click', () => {
  const frame = $('#features-frame');
  if (!frame.src) frame.src = 'features.html';
  $('#features-modal').hidden = false;
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

// Pre-warm the default font so canvas measurement is correct on first use.
// The rest load on demand (font-display: swap) rather than pulling ~850KB of
// webfonts up front; the picker re-measures once a chosen face has loaded.
document.fonts.load('400 16px "Noto Sans Khmer"', 'ស្ត្រីខ្មែរ');

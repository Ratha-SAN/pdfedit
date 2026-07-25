export const state = {
  sources: [],   // { bytes: Uint8Array, pdfjs: PDFDocumentProxy, name }
  pages: [],     // { id, srcIndex, srcPageNum, vw, vh, items: [] }
  mode: 'edit',
  tool: null,    // { type: 'text' } | { type: 'stamp', kind, dataUrl, natW, natH }
  nextId: 1,
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

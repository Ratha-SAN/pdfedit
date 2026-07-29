import { $, activeDoc } from './state.js';

// Undo/redo is per document (stored on the doc object itself, alongside
// sources/pages), so switching tabs switches history with it and closing a
// tab discards its history for free -- no separate cleanup needed.
//
// Scope: covers page.items mutations -- adding, moving, resizing, and
// deleting text/image/signature/highlight/draw/shape items, plus erasing
// and (for text) each editing session as a single step. It deliberately
// does not cover per-field tweaks from an item's own toolbar (color,
// thickness, dash style, font) or Pages-mode operations (reorder, remove,
// append, split) -- see the README's Known limitations.
const MAX_HISTORY = 50;

function cloneItems(items) {
  return JSON.parse(JSON.stringify(items));
}

function findPage(doc, pageId) {
  return doc.pages.find((p) => p.id === pageId) || null;
}

// Call right before a mutation to page.items -- records what the page
// looked like just before, so undo can restore exactly that.
export function pushHistory(page) {
  const doc = activeDoc();
  if (!doc) return;
  if (!doc.undoStack) doc.undoStack = [];
  doc.undoStack.push({ pageId: page.id, items: cloneItems(page.items) });
  if (doc.undoStack.length > MAX_HISTORY) doc.undoStack.shift();
  doc.redoStack = [];
  refreshButtons();
}

export function canUndo() {
  const doc = activeDoc();
  return !!(doc && doc.undoStack && doc.undoStack.length);
}

export function canRedo() {
  const doc = activeDoc();
  return !!(doc && doc.redoStack && doc.redoStack.length);
}

function swap(fromKey, toKey) {
  const doc = activeDoc();
  if (!doc || !doc[fromKey] || !doc[fromKey].length) return null;
  const entry = doc[fromKey].pop();
  const page = findPage(doc, entry.pageId);
  if (!page) return null;
  if (!doc[toKey]) doc[toKey] = [];
  doc[toKey].push({ pageId: page.id, items: cloneItems(page.items) });
  page.items = entry.items;
  refreshButtons();
  return page;
}

// Both return the affected page (so the caller can re-render), or null if
// there was nothing to undo/redo.
export function undo() { return swap('undoStack', 'redoStack'); }
export function redo() { return swap('redoStack', 'undoStack'); }

export function refreshButtons() {
  const undoBtn = $('#btn-undo');
  const redoBtn = $('#btn-redo');
  if (undoBtn) undoBtn.disabled = !canUndo();
  if (redoBtn) redoBtn.disabled = !canRedo();
}

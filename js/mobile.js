/* Phone layout (≤640px): an app bar on top, a tab bar at the bottom, and
   tools in bottom sheets -- instead of the desktop's one-row top bar (which
   on a phone ran ~1000px wide, hiding Save/Print/zoom off to the right) and
   sidebar (which, stacked above the document, ate almost half the screen).

   Nothing is duplicated: a tab opens the *existing* sidebar section as a
   sheet, and the top bar's extra controls are physically moved into the
   More sheet and back again when the screen widens, so every control keeps
   its single set of event handlers. All visual rules live in style.css
   under the same breakpoint; on wider screens this module only puts things
   back where they came from. */

import { state, $, activeDoc } from './state.js';
import { setZoom } from './editor.js';
import { t } from './i18n.js';

const phone = window.matchMedia('(max-width: 640px)');
const isPhone = () => phone.matches;

/* ---------- top-bar controls <-> More sheet ---------- */

const MOVES = [
  ['#account', '#more-account-slot'],
  ['#lang-toggle', '#more-lang-slot'],
  ['#theme-toggle', '#more-theme-slot'],
  ['#topbar-view', '#more-view-slot'],
  ['#btn-print', '#more-actions-slot'],
  ['#btn-features', '#more-actions-slot'],
];
const homes = new Map(); // element -> comment node marking its desktop spot

function placeControls() {
  for (const [sel, slot] of MOVES) {
    const el = $(sel);
    if (!homes.has(el)) {
      const mark = document.createComment(' ' + sel + ' (desktop position) ');
      el.before(mark);
      homes.set(el, mark);
    }
    if (isPhone()) $(slot).appendChild(el);
    else homes.get(el).after(el);
  }
  if (!isPhone()) closeSheets();
}

/* ---------- bottom sheets ---------- */

const SECTIONS = { insert: '#edit-tools', draw: '#draw-tools', ocr: '#ocr-tools', pages: '#pages-tools' };
let current = null; // 'insert' | 'draw' | 'ocr' | 'pages' | 'more' | null
let historyEntry = false; // a pushState is standing in for the open sheet (Android Back closes it)

function sheetEl(name) { return name === 'more' ? $('#more-sheet') : $('#sidebar'); }

export function openSheet(name) {
  if (current) closeSheets({ fromHistory: true, keepHistory: true });
  const el = sheetEl(name);
  if (name === 'more') {
    const hasDoc = !!activeDoc();
    el.classList.toggle('no-doc', !hasDoc);
    $('#more-view-group').hidden = !hasDoc || state.mode !== 'edit';
  } else {
    document.querySelectorAll('#sidebar .side-sec').forEach((s) => s.classList.remove('sheet-current'));
    const sec = $(SECTIONS[name]);
    sec.classList.add('sheet-current');
    // A sheet always shows its section expanded, whatever its desktop
    // collapse state was.
    const head = sec.querySelector('.side-head');
    head.setAttribute('aria-expanded', 'true');
    head.nextElementSibling.hidden = false;
    el.scrollTop = 0;
  }
  current = name;
  el.classList.add('sheet-open');
  $('#sheet-backdrop').classList.add('show');
  if (!historyEntry) {
    history.pushState({ pdfeditSheet: true }, '');
    historyEntry = true;
  }
  updateNav();
}

// fromHistory: the Back button already popped our history entry.
// keepHistory: another sheet is replacing this one, so the entry stays.
export function closeSheets({ fromHistory = false, keepHistory = false } = {}) {
  if (!current) return;
  for (const el of [$('#sidebar'), $('#more-sheet')]) {
    el.classList.remove('sheet-open');
    el.style.transform = '';
  }
  $('#sheet-backdrop').classList.remove('show');
  current = null;
  if (historyEntry && !keepHistory) {
    historyEntry = false;
    if (!fromHistory) history.back();
  }
  updateNav();
}

function toggleSheet(name) {
  if (current === name) closeSheets();
  else openSheet(name);
}

// Drag a sheet down by its grabber/title to dismiss it, like a native one.
function enableSwipeDown(el) {
  let startY = null, dy = 0;
  el.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.sheet-grabber, .sheet-title, .sheet-current > .side-head')) return;
    startY = e.clientY; dy = 0;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.clientY - startY);
    el.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (startY === null) return;
    startY = null;
    el.classList.remove('dragging');
    el.style.transform = '';
    if (dy > 70) closeSheets();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/* ---------- tab bar ---------- */

function toolGroup(tool) {
  if (!tool) return null;
  if (tool.type === 'text' || tool.type === 'stamp' || tool.type === 'highlight') return 'insert';
  if (tool.type === 'draw' || tool.type === 'shape' || tool.type === 'eraser') return 'draw';
  if (tool.type === 'ocr-area') return 'ocr';
  return null;
}

function updateNav() {
  const active = state.mode === 'pages' ? 'pages'
    : current && current !== 'more' ? current
    : toolGroup(state.tool);
  document.querySelectorAll('#mobile-nav .nav-btn').forEach((b) => {
    const on = b.dataset.nav === active;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

/* ---------- pinch-to-zoom on the document ----------
   The browser's own pinch is blocked over the document (touch-action in
   style.css) because it only magnifies the bitmap already on screen. This
   gives the same gesture, done properly: the page scales live under the
   fingers as a preview, then on release the app re-renders at the new zoom
   (sharp, see editor.js), keeping the spot between the fingers in place. */

function initPinchZoom() {
  const main = $('#main');
  const view = $('#edit-view');
  let pinch = null;
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  main.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2 || state.mode !== 'edit' || view.hidden || state.tool) return;
    const [a, b] = e.touches;
    const r = main.getBoundingClientRect();
    const cx = (a.clientX + b.clientX) / 2 - r.left;
    const cy = (a.clientY + b.clientY) / 2 - r.top;
    pinch = { d0: dist(a, b), z0: state.zoom, cx, cy, sl: main.scrollLeft, st: main.scrollTop, ratio: 1 };
    view.style.transformOrigin = `${pinch.sl + cx}px ${pinch.st + cy}px`;
    view.style.willChange = 'transform';
  }, { passive: true });

  main.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault(); // no two-finger scroll while pinching
    const [a, b] = e.touches;
    pinch.ratio = Math.min(4 / pinch.z0, Math.max(0.25 / pinch.z0, dist(a, b) / pinch.d0));
    view.style.transform = `scale(${pinch.ratio})`;
  }, { passive: false });

  const finish = () => {
    if (!pinch) return;
    const p = pinch;
    pinch = null;
    view.style.transform = '';
    view.style.transformOrigin = '';
    view.style.willChange = '';
    if (Math.abs(p.ratio - 1) < 0.03) return; // a wobble, not a zoom
    setZoom(p.z0 * p.ratio);
    const k = state.zoom / p.z0; // after clamping/rounding inside setZoom
    main.scrollLeft = (p.sl + p.cx) * k - p.cx;
    main.scrollTop = (p.st + p.cy) * k - p.cy;
  };
  main.addEventListener('touchend', (e) => { if (e.touches.length < 2) finish(); });
  main.addEventListener('touchcancel', finish);
}

/* ---------- wiring ---------- */

export function initMobile() {
  // Visibility of these is entirely the stylesheet's job from here on
  // (shown only at phone width); the attribute is just the no-JS default.
  $('#more-sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;

  // A grab handle and a Done button for the sidebar when it acts as a sheet
  // (css hides both at desktop width).
  const sidebar = $('#sidebar');
  const grabber = document.createElement('div');
  grabber.className = 'sheet-grabber';
  grabber.setAttribute('aria-hidden', 'true');
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'sheet-done';
  done.dataset.i18n = 'sheetDone';
  done.textContent = t('sheetDone');
  done.addEventListener('click', () => closeSheets());
  sidebar.prepend(grabber);
  sidebar.append(done);
  // In a sheet a section's heading is its title, not a collapse toggle
  // (capture phase, so the heading's own toggle handler never sees it).
  sidebar.addEventListener('click', (e) => {
    if (isPhone() && e.target.closest('.side-head')) e.stopPropagation();
  }, true);

  $('#mobile-nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    const name = btn.dataset.nav;
    if (name === 'open') {
      closeSheets();
      $('#file-input').click();
    } else if (name === 'pages') {
      if (state.mode !== 'pages') { closeSheets(); $('#tab-pages').click(); }
      else toggleSheet('pages');
    } else {
      if (state.mode !== 'edit') $('#tab-edit').click();
      toggleSheet(name);
    }
  });
  $('#btn-mobile-more').addEventListener('click', () => toggleSheet('more'));
  $('#sheet-backdrop').addEventListener('click', () => closeSheets());
  window.addEventListener('popstate', () => {
    if (historyEntry) { historyEntry = false; closeSheets({ fromHistory: true }); }
  });
  enableSwipeDown(sidebar);
  enableSwipeDown($('#more-sheet'));

  // Picking something to *place* closes the sheet so the page is free to
  // tap. Drawing tools are the exception: picking one is what reveals their
  // color/size/style settings in the same sheet, so it stays open (Done,
  // a tap outside, or a swipe down closes it).
  document.addEventListener('toolchange', (e) => {
    updateNav();
    const tool = e.detail;
    if (!tool || !isPhone()) return;
    if (tool.type === 'draw' || tool.type === 'shape') return;
    closeSheets();
  });
  // Actions that open a dialog or act straight away.
  ['#btn-add-signature', '#mi-ocr-page', '#btn-print', '#btn-append-pdf', '#btn-remove-pages', '#btn-split-before', '#btn-split-after', '#btn-features']
    .forEach((sel) => $(sel).addEventListener('click', () => { if (isPhone()) closeSheets(); }));
  document.addEventListener('modechange', updateNav);

  phone.addEventListener('change', placeControls);
  placeControls();
  initPinchZoom();
  updateNav();
}

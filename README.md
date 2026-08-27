# Khmer PDF Editor

A fully client-side, browser-based PDF editor with first-class Khmer Unicode
support. No backend, no accounts — documents never leave your machine.

## Features

- **Upload** a PDF by drag-and-drop or file picker.
- **Top bar** — a single row, left to right: brand, language, theme, mode
  tabs, and (in Edit mode) undo/redo and page view (continuous/single/double
  + zoom); only **Save PDF** and **Print** sit on the right, grouped
  together. Flush against the sidebar below it, with no gap. On narrow
  screens the whole bar scrolls horizontally instead of wrapping onto extra
  lines. Each page re-renders at the current zoom level times the display's
  actual pixel density (up to 3x) every time it changes, so pages stay
  crisp at any zoom instead of just stretching a fixed-resolution bitmap.
  Native pinch/double-tap browser zoom is disabled over the document itself
  for that reason — it would just blur-magnify whatever's already on
  screen instead of asking the page to re-render — while normal one-finger
  scrolling is unaffected.
- **Undo/redo** (Edit mode) — Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y),
  or the top bar's buttons. Covers adding, moving, resizing, and deleting
  any item (text/image/signature/highlight/draw stroke/shape), erasing, and
  each text-editing session — a drag or an erase gesture is one undo step
  regardless of how many pointermove events or items it touched, and a
  plain click-to-select costs nothing. History is per document tab, so
  closing a tab or switching to another one doesn't mix up histories. It
  doesn't cover per-field toolbar tweaks (color/thickness/style/font on an
  already-placed item) or Pages-mode operations (reorder/remove/append/
  split) — see Known limitations.
- **Edit mode** — add text boxes (Khmer or English), insert PNG/JPEG images,
  and place a signature (drawn on a canvas or uploaded as PNG) anywhere on any
  page. Drag to move, corner handle to resize, × to delete, and an **Edit**
  button (or double-click / long-press) to type into a text box in place.
  Drawing a signature offers 4 brush styles (Pen, Ink, Stylus, Brush) —
  each a genuinely different look (width range, opacity, blend mode) —
  plus 4 preset ink colors (Black, Blue, Red, Green), independent of style,
  so picking Brush over Pen changes the texture without resetting a chosen
  ink color. Stroke width responds to
  real pointer pressure from a stylus. Touch and mouse, which almost never
  report real pressure, instead get it simulated from how fast the pointer
  is moving (slower = a harder press, faster = a lighter one, the way a
  real ink pen behaves), so the signature still looks natural when signed
  with a finger. Every stroke is drawn as a smoothed curve with extra
  position/pressure damping tuned per input device (touch gets the calmest
  settings, since a finger's contact point is naturally less steady than a
  mouse or stylus), so it reads as a smooth, natural line rather than a
  jittery one regardless of how coarsely the touchscreen samples the
  gesture. The canvas renders at the display's actual pixel density (not a
  fixed low-res bitmap), so the signature stays crisp at any screen size,
  drawing stays smooth on mobile since each frame only redraws the small
  area a stroke actually touched rather than the whole canvas, and its own
  undo/redo (buttons or Ctrl/Cmd+Z) removes or restores one stroke at a
  time, separate from the main document's history.
- **Draw** — a sidebar section (tools arranged in a compact grid) with Pen,
  Pencil, Marker, Highlighter, Shapes (rectangle/ellipse/line/arrow, with
  optional fill), and an Eraser. Color, thickness, and line style
  (solid/dashed/dotted) are all adjustable before drawing and again
  afterward from each stroke's own toolbar once selected. Each of the 5
  sizeable tools (the 4 freehand ones plus Shapes) remembers its own
  thickness — switching from a thick marker to a thin pencil and back
  restores each one's own last setting rather than sharing a single value.
  Each freehand
  tool keeps its own look (marker and highlighter darken where strokes
  overlap, matching a real marker/highlighter) via opacity and blend mode,
  not just width. The four freehand tools are pressure-sensitive: stroke
  width responds to real pointer pressure from a stylus or force-sensitive
  touch (mouse/plain touch falls back to a fixed mid-range width), and each
  tool varies by a different amount — pencil swings widest (a soft point
  goes from a hairline to a smudge), a highlighter's chisel tip stays
  closest to one width regardless of pressure. The Highlighter also has 6
  preset fluorescent-marker colors as one-click swatches, alongside the
  free-form color picker.
  Each frame only redraws the small area a stroke actually touched (not the
  whole page), keeping drawing smooth on mobile. Unlike the one-shot Insert
  tools, a Draw tool stays active across multiple strokes until you turn it
  off. The Eraser deletes by touching a stroke or shape's actual drawn
  shape (not just its bounding box) — dragging through the empty middle of
  an unfilled rectangle leaves it alone, but touching its outline (or
  anywhere inside a filled one) removes it.
- **Left sidebar** — tools live in collapsible sections (File, Insert,
  Recognize text, Pages) rather than one long toolbar row, flush against the
  top bar; document tabs sit above the page area, not the sidebar. On phones
  the sidebar stacks above the document instead of taking width. A **Features** button pinned to
  the bottom of the sidebar opens a bilingual (English/Khmer) page describing
  everything the app can do, as an in-page modal (an embedded iframe, not a
  separate tab or window), so the current document is never disturbed.
- **Pages mode** — thumbnail grid of all pages: select, drag to reorder,
  remove pages, and append pages from a second PDF. **Split** breaks the
  document into two tabs at a chosen page: select exactly one page, then
  *Split before* (that page starts the second document) or *Split after*
  (it stays in the first) — both documents keep working normally afterward,
  including exporting each independently.
- **Multiple documents** — every file you open gets its own tab; opening a
  new one no longer replaces what you were working on.
- **Opens images too** — PNG/JPEG/WebP files open as a one-page document, so a
  photographed page can be annotated, OCR'd or exported like any PDF.
- **Save PDF** — opens a popup to edit the filename, pick an output size
  (original / high quality / balanced / smallest — picking a level samples a
  couple of representative pages at that level's resolution/quality and
  extrapolates to a live estimate, e.g. `~7 MB`, before you commit), and
  choose where it goes: **Save** downloads to the browser's default
  downloads folder, while **Choose location…** opens the browser's native
  Save-As dialog to pick the exact folder and filename (Chrome/Edge only —
  browsers without that API just get **Save**, with a note explaining why).
- **Khmer text** renders correctly (subscript consonants, vowel reordering)
  in both the editor and the exported PDF.
- **Recognize text (OCR)** — one *Recognize text* menu picks both the scope
  (whole page, or drag out an area) and the language (Auto = Khmer+English,
  Khmer, English, or Math). Output is selectable/copyable text; Math mode adds
  a rendered-formula preview and editable LaTeX, and reconstructs **stacked
  fractions** as `\frac{}{}`.

## Running

It is a static site — any web server works:

```
python3 -m http.server 8080
# then open http://localhost:8080/
```

Or use the hosted GitHub Pages deployment (see the repository's Pages URL).
Opening `index.html` via `file://` will not work (ES modules and workers
require HTTP).

Everything (pdf.js, pdf-lib, tesseract.js, its WASM cores, the Noto Sans
Khmer font, and the Khmer traineddata) is vendored in this repository, so the
app also works offline once served.

## How Khmer rendering works

Khmer is a complex script: consonant clusters use subscript (coeng) forms and
some vowels reorder visually before their base consonant. Producing correct
output requires OpenType shaping (GSUB/GPOS), which **pdf-lib + fontkit do
not perform** — embedding a raw Khmer string that way yields decomposed,
unreadable glyphs.

This app instead delegates shaping to the **browser's own text engine
(HarfBuzz)**: added text is laid out on a hidden canvas using the bundled
Noto Sans Khmer font, rasterized at 3× resolution, and embedded into the
exported PDF as a PNG image via pdf-lib. This is verified with the test
string **ស្ត្រីខ្មែរ** (canvas measurement confirms shaped width ≈ 1/3 of the
decomposed per-character width, and the exported PDF shows correctly stacked
subscripts).

Trade-off: text you add is stored in the output PDF as an image, so it is not
selectable/searchable in the exported file. Pre-existing PDF text is
untouched and stays selectable.

## Libraries

| Purpose | Library |
|---|---|
| Rendering / thumbnails | [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 |
| Writing the output PDF | [pdf-lib](https://pdf-lib.js.org/) 1.17 |
| OCR | [tesseract.js](https://tesseract.projectnaptha.com/) 5.1 + `khm`/`eng` traineddata (tessdata_fast) |
| Fonts | 16 Khmer + 13 Latin families from [Fontsource](https://fontsource.org/) (OFL/Apache) |
| Math rendering | [KaTeX](https://katex.org/) 0.16 (woff2 subset) |

## Large documents

Pages rasterize only as they approach the viewport and release their bitmap
once they leave, so memory tracks what's on screen rather than document
length. Measured on a 300-page file: load `6.0s -> 0.37s`, canvas memory
`948MB -> 58MB`, and a toolbar click `3.3s -> 0.14s`. A 41MB / 60-page scan
loads in ~0.4s. Thumbnails in Pages mode are lazy for the same reason.

## Known limitations

- Undo/redo covers item edits in Edit mode only. It does not cover per-field
  edits from an already-placed item's own toolbar (changing its color,
  thickness, dash style, or font after the fact), nor Pages-mode operations
  (reorder, remove, append, split) — those take effect immediately with no
  undo step.
- Added text, and any Draw-section stroke or shape, becomes an image in the
  exported PDF (see above) — not selectable, searchable, or vector-editable.
- Overlay placement on pages with `/Rotate` 90/270 is implemented but has
  only been exercised on unrotated and 180° pages.
- OCR quality depends on scan quality; the fast traineddata occasionally
  confuses similar Khmer signs. OCR output is provided as copyable text, not
  embedded back into the PDF.
- **No better math model is available client-side.** npm publishes no
  LaTeX/math OCR model; the one plausible package (`react-latex-ocr-editor`)
  is an HTTP client for a pix2tex/Mathpix *server*, which would break the
  offline, nothing-leaves-your-machine guarantee. `onnxruntime-web` exists, but
  pix2tex-class weights (~100MB+) are not on npm and would be a heavy download
  for every user. A package literally named `texo` also exists on npm, but it
  is an unrelated immutable-list utility library (and `@texo-ui/*` is a
  Markdown/YAML UI kit) — neither has anything to do with math recognition. A
  real LaTeX OCR model, [Texo](https://github.com/alephpi/Texo) (a
  20M-parameter model distilled from PPFormulaNet-S), was tried via
  Transformers.js running fully in-browser, but its output on real scans
  wasn't usable and it was reverted. Math support is therefore Tesseract plus
  geometric reconstruction, described next.
- **Math OCR is structurally good but character-wise unreliable on scripts.**
  Math mode rebuilds two-dimensional layout from per-symbol geometry, so
  baseline formulas and fractions come out exact (`(x + y) / 2 = 5` becomes
  `\frac{x+y}{2}=5`) and super/subscript *positions* are detected correctly.
  But Tesseract frequently misreads or drops the small raised *characters*
  themselves — `E = mc²` often comes back as `E = mc` or `E = mc^{e}`. This was
  tested against page-segmentation modes, character whitelists and render
  resolutions from 2.5x to 8x; none of them fixed it, because the model simply
  isn't trained for raised glyphs. Because of that the LaTeX is presented as
  an **editable** field with a live preview: OCR gives you the structure, you
  correct the odd exponent. Tesseract's dedicated `equ` traineddata was also
  evaluated and dropped — it produced *no output at all* (0/6) where plain
  English scored 6/6. True Mathpix-grade math OCR needs a purpose-built model
  far too large to ship client-side without giving up the offline guarantee.
- Compressing on export re-encodes pages as JPEG images, which shrinks a heavy
  scan a lot (41MB -> 7MB at the smallest level) but makes any real text in the
  original non-selectable. "Original quality" is the default for that reason.
- Encrypted/password-protected PDFs are not supported.

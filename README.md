# Khmer PDF Editor

A fully client-side, browser-based PDF editor with first-class Khmer Unicode
support. No backend, no accounts — documents never leave your machine.

## Features

- **Upload** a PDF by drag-and-drop or file picker.
- **Top bar** — a single row, left to right: brand, language, theme, mode
  tabs, page view (continuous/single/double + zoom), and (in Edit mode) a
  compression picker with a live estimated output size; only **Save PDF** and
  **Print** sit on the right, grouped together. Flush against the sidebar
  below it, with no gap. On narrow screens the whole bar scrolls horizontally
  instead of wrapping onto extra lines.
- **Edit mode** — add text boxes (Khmer or English), insert PNG/JPEG images,
  and place a signature (drawn on a canvas or uploaded as PNG) anywhere on any
  page. Drag to move, corner handle to resize, × to delete, and an **Edit**
  button (or double-click / long-press) to type into a text box in place.
  Drawing a signature offers 5 brush styles (Pen, Ink, Stylus, Marker,
  Brush) — each a genuinely different look (width range, opacity, blend
  mode), not just a color — and the stroke width responds to real pointer
  pressure from a stylus. Touch and mouse, which almost never report real
  pressure, instead get it simulated from how fast the pointer is moving
  (slower = a harder press, faster = a lighter one, the way a real ink pen
  behaves), so the signature still looks natural when signed with a finger.
  Every stroke is smoothed through a curve rather than straight segments
  between raw samples, so it stays smooth regardless of how coarsely the
  touchscreen samples the gesture. The canvas renders at the display's
  actual pixel density (not a fixed low-res bitmap), so the signature stays
  crisp at any screen size, and drawing stays smooth on mobile since each
  frame only redraws the small area a stroke actually touched rather than
  the whole canvas.
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
  closest to one width regardless of pressure. Each frame only redraws the
  small area a stroke actually touched (not the whole page), keeping
  drawing smooth on mobile. Unlike the one-shot Insert
  tools, a Draw tool stays active across multiple strokes until you turn it
  off. The Eraser deletes by touching a stroke or shape's actual drawn
  shape (not just its bounding box) — dragging through the empty middle of
  an unfilled rectangle leaves it alone, but touching its outline (or
  anywhere inside a filled one) removes it.
- **Left sidebar** — tools live in collapsible sections (File, Insert,
  Recognize text, Pages) rather than one long toolbar row, flush against the
  top bar; document tabs sit above the page area, not the sidebar. In Pages
  mode the compression picker moves down into the Pages section (the top
  bar's view controls aren't relevant there). On phones the sidebar stacks
  above the document instead of taking width. A **Features** button pinned to
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
- **Save PDF** — downloads the modified document, with an optional compression
  level (original / high quality / balanced / smallest). Picking a level
  samples a couple of representative pages at that level's resolution/quality
  and extrapolates, so the top bar shows an estimated output size (e.g. `~7
  MB`) before you commit to exporting.
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

# Khmer PDF Editor

A fully client-side, browser-based PDF editor with first-class Khmer Unicode
support. No backend, no accounts — documents never leave your machine.

## Features

- **Upload** a PDF by drag-and-drop or file picker.
- **Edit mode** — add text boxes (Khmer or English), insert PNG/JPEG images,
  and place a signature (drawn on a canvas or uploaded as PNG) anywhere on any
  page. Drag to move, corner handle to resize, × to delete, and an **Edit**
  button (or double-click / long-press) to type into a text box in place.
- **Left sidebar** — tools live in collapsible sections (File, View, Insert,
  Recognize text, Pages) rather than one long toolbar row; on phones the
  sidebar stacks above the document instead of taking width.
- **Pages mode** — thumbnail grid of all pages: select, drag to reorder,
  remove pages, and append pages from a second PDF.
- **Multiple documents** — every file you open gets its own tab; opening a
  new one no longer replaces what you were working on.
- **Opens images too** — PNG/JPEG/WebP files open as a one-page document, so a
  photographed page can be annotated, OCR'd or exported like any PDF.
- **Save PDF** — downloads the modified document, with an optional compression
  level (original / high quality / balanced / smallest).
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

- Added text becomes an image in the exported PDF (see above) — not
  selectable or searchable.
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
  for every user. Math support is therefore Tesseract plus geometric
  reconstruction, described next.
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

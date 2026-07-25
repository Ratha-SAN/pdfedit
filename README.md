# Khmer PDF Editor

A fully client-side, browser-based PDF editor with first-class Khmer Unicode
support. No backend, no accounts — documents never leave your machine.

## Features

- **Upload** a PDF by drag-and-drop or file picker.
- **Edit mode** — add text boxes (Khmer or English), insert PNG/JPEG images,
  and place a signature (drawn on a canvas or uploaded as PNG) anywhere on any
  page. Drag to move, corner handle to resize, × to delete.
- **Pages mode** — thumbnail grid of all pages: select, drag to reorder,
  remove pages, and append pages from a second PDF.
- **Save PDF** — downloads the modified document.
- **Khmer text** renders correctly (subscript consonants, vowel reordering)
  in both the editor and the exported PDF.
- **Recognize text (OCR)** — one *Recognize text* menu picks both the scope
  (whole page, or drag out an area) and the language (Auto = Khmer+English,
  Khmer, English, or Math). Output is selectable/copyable text.

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

## Known limitations

- Added text becomes an image in the exported PDF (see above) — not
  selectable or searchable.
- Overlay placement on pages with `/Rotate` 90/270 is implemented but has
  only been exercised on unrotated and 180° pages.
- OCR quality depends on scan quality; the fast traineddata occasionally
  confuses similar Khmer signs. OCR output is provided as copyable text, not
  embedded back into the PDF.
- Math OCR reads formulas as **plain text, not LaTeX** — `x + 1 = 2`, not
  `$x + 1 = 2$`. It handles printed linear equations well but has no concept
  of two-dimensional layout, so stacked fractions, matrices, integral bounds
  and exponents come out flattened (`a2 + b2 = c2` rather than `a² + b² = c²`).
  Tesseract's dedicated `equ` traineddata was evaluated for this and **dropped**:
  on a six-equation test page it produced *no output at all* (0/6) while plain
  English scored 6/6 on the same image, so math mode is English plus a
  math-oriented character set and page-segmentation mode. True LaTeX-grade
  math OCR needs a purpose-built model far too large to ship client-side.
- Encrypted/password-protected PDFs are not supported.

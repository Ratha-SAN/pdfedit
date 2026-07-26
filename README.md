# Khmer PDF Editor

A fully client-side, browser-based PDF editor with first-class Khmer Unicode
support. No backend, no accounts — documents never leave your machine.

Licensed under **AGPL-3.0** (see [LICENSE](LICENSE)) — a requirement of
bundling the [Texo](https://github.com/alephpi/Texo) LaTeX OCR model, which
is itself AGPL-3.0.

## Features

- **Upload** a PDF by drag-and-drop or file picker.
- **Top bar** — a single row, left to right: brand, language, theme, mode
  tabs, page view (continuous/single/double + zoom), and a compression picker
  with a live estimated output size; only **Save PDF** and **Print** sit on
  the right, grouped together. Flush against the sidebar below it, with no
  gap. On narrow screens the whole bar scrolls horizontally instead of
  wrapping onto extra lines.
- **Edit mode** — add text boxes (Khmer or English), insert PNG/JPEG images,
  and place a signature (drawn on a canvas or uploaded as PNG) anywhere on any
  page. Drag to move, corner handle to resize, × to delete, and an **Edit**
  button (or double-click / long-press) to type into a text box in place.
- **Left sidebar** — tools live in collapsible sections (File, Insert,
  Recognize text, Pages) rather than one long toolbar row, flush against the
  top bar; document tabs sit above the page area, not the sidebar. On phones
  the sidebar stacks above the document instead of taking width. A
  **Features** button pinned to the bottom of the sidebar opens a bilingual
  (English/Khmer) page describing everything the app can do, as a pop-up
  window so the current document is never disturbed.
- **Pages mode** — thumbnail grid of all pages: select, drag to reorder,
  remove pages, and append pages from a second PDF.
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
  a rendered-formula preview and editable LaTeX. Selecting an **area** in Math
  mode first tries the [Texo](https://github.com/alephpi/Texo) LaTeX OCR
  model (a real machine-learning model, not geometric reconstruction) running
  fully in-browser; **whole-page** math recognition reconstructs layout from
  Tesseract's per-symbol geometry instead, including **stacked fractions** as
  `\frac{}{}`. See [Math OCR](#math-ocr) below for how the two relate and what
  each is actually good at.

## Running

It is a static site — any web server works:

```
python3 -m http.server 8080
# then open http://localhost:8080/
```

Or use the hosted GitHub Pages deployment (see the repository's Pages URL).
Opening `index.html` via `file://` will not work (ES modules and workers
require HTTP).

Everything (pdf.js, pdf-lib, tesseract.js, its WASM cores, Transformers.js,
`onnxruntime-web`'s Wasm runtime, the Noto Sans Khmer font, and the Khmer
traineddata) is vendored in this repository, so the app works offline once
served — with one exception: the [Texo](#math-ocr) LaTeX model's weights are
fetched from the Hugging Face Hub the first time area-math recognition is
used, then cached by the browser.

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
| OCR (text, and whole-page math) | [tesseract.js](https://tesseract.projectnaptha.com/) 5.1 + `khm`/`eng` traineddata (tessdata_fast) |
| OCR (area math) | [Texo](https://github.com/alephpi/Texo) LaTeX OCR model via [Transformers.js](https://huggingface.co/docs/transformers.js) 4.2, on `onnxruntime-web`'s Wasm backend |
| Fonts | 16 Khmer + 13 Latin families from [Fontsource](https://fontsource.org/) (OFL/Apache) |
| Math rendering | [KaTeX](https://katex.org/) 0.16 (woff2 subset) |

## Large documents

Pages rasterize only as they approach the viewport and release their bitmap
once they leave, so memory tracks what's on screen rather than document
length. Measured on a 300-page file: load `6.0s -> 0.37s`, canvas memory
`948MB -> 58MB`, and a toolbar click `3.3s -> 0.14s`. A 41MB / 60-page scan
loads in ~0.4s. Thumbnails in Pages mode are lazy for the same reason.

## Math OCR

There are actually two different math-recognition paths, chosen automatically
by scope:

- **Select an area** (one formula) tries the
  [Texo](https://github.com/alephpi/Texo) model first: a real 20M-parameter
  LaTeX OCR model (distilled from PPFormulaNet-S, fine-tuned on
  UniMERNet-1M), run in-browser via
  [Transformers.js](https://huggingface.co/docs/transformers.js) on the
  `onnxruntime-web` Wasm backend. This is qualitatively different from
  Tesseract: it's a model actually trained to read formulas, not a text OCR
  engine with a restricted alphabet.
- **Whole page** (possibly several formulas) stays on Tesseract plus the
  geometric reconstruction described below — Texo is trained on single
  cropped formulas, which isn't the whole-page case.
- If Texo can't load or run for any reason (offline, the browser can't reach
  Hugging Face, an incompatible export), area recognition **falls back to
  the same Tesseract pipeline** automatically and silently.

**The trade-off that comes with Texo**, spelled out rather than buried:

- **License.** Texo is AGPL-3.0. Combining it into this app makes the whole
  app AGPL-3.0 too — see [LICENSE](LICENSE). That is a materially different,
  and more restrictive, license than a permissively-licensed project would
  otherwise want, and was a deliberate trade accepted to get real LaTeX OCR
  rather than a compromise.
- **Not fully vendored.** Everything else in this repo (pdf.js, pdf-lib,
  tesseract.js, KaTeX, Transformers.js, and the `onnxruntime-web` Wasm
  runtime itself) is vendored locally and works with zero network access.
  Texo's *model weights* are the one exception: they live on the Hugging
  Face Hub and are fetched by your browser the first time area-math
  recognition actually runs, then cached by the browser (via the standard
  Cache API) for offline reuse afterward. No document content is ever sent
  anywhere in either case — only the model file itself is fetched, once.
- **Architecture risk, not just a caveat.** Transformers.js only works
  because it re-implements specific model architectures in JavaScript;
  Texo's decoder side (`vision-encoder-decoder`) is one of the ones it
  supports generically (the same mechanism TrOCR and Donut use), but Texo's
  specific vision encoder is derived from PaddleOCR's PPFormulaNet-S, which
  may or may not be one of the encoder types Transformers.js has JS-side
  code for. If it isn't, `AutoModelForVision2Seq.from_pretrained(...)` throws
  and area recognition falls back to Tesseract, same as any other load
  failure.
- **The happy path is unverified in this environment.** The sandbox this
  integration was built in has `huggingface.co` blocked at the network
  policy level. What *was* verified here: `vendor/texo/transformers.web.min.js`
  ships two bundler-style bare module specifiers (`onnxruntime-common` and
  `onnxruntime-web/webgpu`) that plain browser ESM can't resolve on its own
  — this was a real bug, caught by actually running it, fixed with the
  `<script type="importmap">` in `index.html` mapping both to their vendored
  equivalents. With that fixed, the code correctly loads the runtime and
  reaches a genuine `fetch()` of
  `https://huggingface.co/alephpi/FormulaNet/resolve/main/...`, which then
  fails here for exactly the expected reason (the sandbox's network policy),
  not a code bug — and the fallback to Tesseract triggers correctly. What
  could **not** be verified here is the actual happy path: whether Texo's
  specific encoder architecture is one Transformers.js has JS-side support
  for, and whether its output is good LaTeX. That needs a real deployment
  with normal internet access.

Tesseract's own math handling, still used for whole-page recognition:

- **Structurally good but character-wise unreliable on scripts.** Math mode
  rebuilds two-dimensional layout from per-symbol geometry, so baseline
  formulas and fractions come out exact (`(x + y) / 2 = 5` becomes
  `\frac{x+y}{2}=5`) and super/subscript *positions* are detected correctly.
  But Tesseract frequently misreads or drops the small raised *characters*
  themselves — `E = mc²` often comes back as `E = mc` or `E = mc^{e}`. This was
  tested against page-segmentation modes, character whitelists and render
  resolutions from 2.5x to 8x; none of them fixed it, because the model simply
  isn't trained for raised glyphs. Because of that the LaTeX is presented as
  an **editable** field with a live preview: OCR gives you the structure, you
  correct the odd exponent. Tesseract's dedicated `equ` traineddata was also
  evaluated and dropped — it produced *no output at all* (0/6) where plain
  English scored 6/6.

## Known limitations

- Added text becomes an image in the exported PDF (see above) — not
  selectable or searchable.
- Overlay placement on pages with `/Rotate` 90/270 is implemented but has
  only been exercised on unrotated and 180° pages.
- OCR quality depends on scan quality; the fast traineddata occasionally
  confuses similar Khmer signs. OCR output is provided as copyable text, not
  embedded back into the PDF.
- Area math recognition needs the Texo model, and therefore needs internet
  access the first time it's used (see [Math OCR](#math-ocr)); whole-page
  math recognition has no such requirement.
- Compressing on export re-encodes pages as JPEG images, which shrinks a heavy
  scan a lot (41MB -> 7MB at the smallest level) but makes any real text in the
  original non-selectable. "Original quality" is the default for that reason.
- Encrypted/password-protected PDFs are not supported.

/* Reconstructs LaTeX from tesseract's symbol-level output.
 *
 * The OCR model returns a flat string, which throws away the one thing that
 * makes maths maths: vertical structure. But each recognized symbol carries
 * its own bounding box plus is_superscript / is_subscript flags, so the
 * two-dimensional layout can be rebuilt from geometry rather than guessed
 * from the text. That is what turns "E = mc2" into "E = mc^{2}".
 *
 * This is deliberately conservative -- it reconstructs what the geometry
 * actually supports (super/subscripts, simple fractions, symbol names) and
 * leaves everything else as plain maths. It is not a replacement for a
 * purpose-built maths OCR model.
 */

// Unicode maths characters the engine may emit, mapped to LaTeX commands.
const SYMBOL_MAP = {
  '×': '\\times', '÷': '\\div', '±': '\\pm', '∓': '\\mp',
  '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx', '≡': '\\equiv',
  '∝': '\\propto', '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla',
  '√': '\\sqrt', '∫': '\\int', '∮': '\\oint', '∑': '\\sum', '∏': '\\prod',
  '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊃': '\\supset',
  '∪': '\\cup', '∩': '\\cap', '∀': '\\forall', '∃': '\\exists',
  '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow',
  '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow', '°': '^{\\circ}',
  'π': '\\pi', 'θ': '\\theta', 'φ': '\\phi', 'λ': '\\lambda', 'μ': '\\mu',
  'σ': '\\sigma', 'Ω': '\\Omega', 'Δ': '\\Delta', 'α': '\\alpha',
  'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\epsilon',
  'ζ': '\\zeta', 'η': '\\eta', 'ι': '\\iota', 'ν': '\\nu', 'ξ': '\\xi',
  'ρ': '\\rho', 'τ': '\\tau', 'υ': '\\upsilon', 'χ': '\\chi',
  'ψ': '\\psi', 'ω': '\\omega', '′': "'", '″': "''",
};

// Characters LaTeX treats specially and that can appear in OCR output.
function escapeLatex(ch) {
  if (SYMBOL_MAP[ch]) return SYMBOL_MAP[ch] + ' ';
  if ('%&#_{}$'.includes(ch)) return '\\' + ch;
  return ch;
}

function collectSymbols(line) {
  const out = [];
  for (const word of line.words || []) {
    for (const sym of word.symbols || []) {
      if (!sym.text || !sym.text.trim()) continue;
      out.push(sym);
    }
    out.push(null); // word separator
  }
  return out;
}

// Operators and relations are drawn small and vertically centred by design
// (=, +, ÷, ~ …), which makes them look exactly like a raised script to a
// naive height/offset test. They are never scripts in practice, so they are
// excluded outright -- without this, "E = mc²" came out as "E ^{=} mc".
const NEVER_SCRIPT = new Set([...'=+×÷±∓<>≤≥≠≈≡~^_-–—*/\\|()[]{},;:']);

// Decides super/sub for a symbol. Tesseract's own flags are trusted first;
// where it doesn't set them, fall back to geometry: a script character sits
// clearly off the line's dominant band *and* is noticeably smaller.
function scriptKindOf(sym, stats) {
  const ch = (sym.text || '').trim();
  if (!ch || NEVER_SCRIPT.has(ch)) return null;
  if (sym.is_superscript) return 'sup';
  if (sym.is_subscript) return 'sub';
  const b = sym.bbox;
  if (!b || !stats.medianH) return null;
  const h = b.y1 - b.y0;
  if (h > stats.medianH * 0.85) return null;       // full-height: not a script
  const raise = stats.baseline - b.y1;             // px above the baseline
  const drop = b.y0 - stats.baseline;
  // Require a clear vertical displacement -- a third of the line's height --
  // so ordinary short glyphs (o, c, .) aren't mistaken for scripts.
  const tol = stats.medianH * 0.33;
  if (raise > tol) return 'sup';
  if (drop > tol) return 'sub';
  return null;
}

function lineStats(symbols) {
  const hs = [], bottoms = [];
  for (const s of symbols) {
    if (!s || !s.bbox) continue;
    hs.push(s.bbox.y1 - s.bbox.y0);
    bottoms.push(s.bbox.y1);
  }
  if (!hs.length) return { medianH: 0, baseline: 0 };
  const med = (a) => { const v = [...a].sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
  return { medianH: med(hs), baseline: med(bottoms) };
}

function lineToLatex(line) {
  const symbols = collectSymbols(line);
  const stats = lineStats(symbols);
  let out = '';
  let run = null; // 'sup' | 'sub' currently open
  let runBuf = '';

  const flush = () => {
    if (!run) return;
    out += (run === 'sup' ? '^' : '_') + '{' + runBuf.trim() + '}';
    run = null;
    runBuf = '';
  };

  for (const sym of symbols) {
    if (!sym) { // word gap
      if (run) { runBuf += ' '; } else { out += ' '; }
      continue;
    }
    const kind = scriptKindOf(sym, stats);
    const text = [...sym.text].map(escapeLatex).join('');
    if (kind) {
      if (run && run !== kind) flush();
      run = kind;
      runBuf += text;
    } else {
      flush();
      out += text;
    }
  }
  flush();
  return out.replace(/\s+/g, ' ').trim();
}

// Turns a simple `A / B` into \frac{A}{B}. Only applied where both sides are
// unambiguous -- a bracketed group or a single run of alphanumerics -- so
// that ambiguous slashes are left alone rather than restructured wrongly.
function applyFractions(latex) {
  const OPERAND = '(\\([^()]*\\)|[A-Za-z0-9.]+)';
  const re = new RegExp(OPERAND + '\\s*/\\s*' + OPERAND, 'g');
  return latex.replace(re, (m, a, b) => {
    const strip = (s) => (s.startsWith('(') && s.endsWith(')') ? s.slice(1, -1) : s);
    return `\\frac{${strip(a)}}{${strip(b)}}`;
  });
}

/** Builds one LaTeX string per recognized line. */
export function dataToLatexLines(data) {
  const lines = [];
  const blocks = data.blocks || [];
  for (const block of blocks) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const l = applyFractions(lineToLatex(line));
        if (l) lines.push(l);
      }
    }
  }
  // If the structured output was unavailable, fall back to the plain text so
  // the panel still shows something usable rather than going blank.
  if (!lines.length && data.text) {
    for (const raw of data.text.split('\n').map((s) => s.trim()).filter(Boolean)) {
      lines.push(applyFractions([...raw].map(escapeLatex).join('')));
    }
  }
  return lines;
}

/* ---------- stacked fraction reconstruction ----------
 *
 * Tesseract does not report a fraction bar as a symbol at all: a stacked
 * fraction arrives as two unrelated text lines, and the bar frequently
 * corrupts the glyph next to it (an "x" beside a rule was read as "xt").
 * So the bars are found geometrically in the bitmap instead -- a fraction
 * bar is an unmistakable shape, a long thin horizontal run of dark pixels
 * with clear space above and below -- then erased before recognition and
 * used afterwards to pair the numerator with the denominator.
 */

/** Finds horizontal rules that look like fraction bars. */
export function detectFractionBars(canvas, glyphHeight) {
  const W = canvas.width, H = canvas.height;
  if (!W || !H) return [];
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const px = ctx.getImageData(0, 0, W, H).data;
  const dark = (x, y) => px[(y * W + x) * 4] < 128;

  // A fraction bar is at least about as wide as the text is tall. Without a
  // floor tied to real glyph size, ordinary horizontal strokes (the base of a
  // "2", the crossbar of an "e") get mistaken for bars and erasing them
  // mangles the character -- which is exactly what happened before the
  // measuring pass was added.
  const minLen = Math.max(14, Math.round(W * 0.015), Math.round((glyphHeight || 0) * 0.9));
  const maxThick = Math.max(3, Math.round(H * 0.008));
  const bars = [];

  for (let y = 1; y < H - 1; y++) {
    let x = 0;
    while (x < W) {
      if (!dark(x, y)) { x++; continue; }
      const start = x;
      while (x < W && dark(x, y)) x++;
      const len = x - start;
      if (len < minLen) continue;

      // How thick is this run?
      const mid = start + (len >> 1);
      let thick = 1;
      while (y + thick < H && thick <= maxThick + 1 && dark(mid, y + thick)) thick++;
      if (thick > maxThick) continue;

      // A rule has clear space directly above and below; a glyph stroke or
      // the top of a filled shape does not.
      const clear = (yy) => {
        if (yy < 0 || yy >= H) return true;
        let hits = 0;
        for (let i = start; i < start + len; i += 2) if (dark(i, yy)) hits++;
        return hits < (len / 2) * 0.25;
      };
      if (!clear(y - 2) || !clear(y + thick + 1)) continue;

      bars.push({ x0: start, x1: start + len, y, thickness: thick });
    }
  }

  // Collapse bars found on consecutive rows of the same rule.
  const merged = [];
  for (const b of bars) {
    const prev = merged.find((m) => Math.abs(m.y - b.y) <= maxThick + 2 &&
      Math.min(m.x1, b.x1) - Math.max(m.x0, b.x0) > 0);
    if (prev) {
      prev.x0 = Math.min(prev.x0, b.x0);
      prev.x1 = Math.max(prev.x1, b.x1);
    } else merged.push({ ...b });
  }

  // An "=" is two parallel rules of near-identical extent a glyph-gap apart
  // (and "≡" is three). Those are characters, not fraction bars -- without
  // this filter "= 5" beside a fraction was itself turned into \frac{;}{J}.
  const paired = (a, b) => {
    const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const wa = a.x1 - a.x0, wb = b.x1 - b.x0;
    const gap = Math.abs(a.y - b.y);
    return overlap > 0.7 * Math.min(wa, wb) &&
      Math.abs(wa - wb) < 0.35 * Math.max(wa, wb) &&
      gap > 0 && gap < Math.max(16, 7 * Math.max(a.thickness, b.thickness));
  };
  return merged.filter((bar) => !merged.some((o) => o !== bar && paired(bar, o)));
}

/** Paints detected bars out so they can't corrupt neighbouring glyphs. */
export function eraseBars(canvas, bars) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.fillStyle = '#fff';
  for (const b of bars) {
    ctx.fillRect(b.x0 - 1, b.y - 1, (b.x1 - b.x0) + 2, b.thickness + 2);
  }
  ctx.restore();
}

function allSymbols(data) {
  const out = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const stats = lineStats(collectSymbols(line));
        for (const word of line.words || []) {
          for (const sym of word.symbols || []) {
            if (!sym.text || !sym.text.trim() || !sym.bbox) continue;
            out.push({ text: sym.text, bbox: sym.bbox, sym, stats });
          }
        }
      }
    }
  }
  return out;
}

function tokensToLatex(tokens) {
  // Reuses the same super/subscript logic as the line path, but over an
  // arbitrary token set (a fraction's numerator, for example).
  let out = '';
  let run = null, runBuf = '';
  const flush = () => {
    if (!run) return;
    out += (run === 'sup' ? '^' : '_') + '{' + runBuf.trim() + '}';
    run = null; runBuf = '';
  };
  for (const tk of tokens) {
    if (tk.latex) { flush(); out += tk.latex; continue; }
    const kind = scriptKindOf(tk.sym, tk.stats);
    const text = [...tk.text].map(escapeLatex).join('');
    if (kind) {
      if (run && run !== kind) flush();
      run = kind; runBuf += text;
    } else { flush(); out += text; }
  }
  flush();
  return out.trim();
}

const cx = (b) => (b.bbox.x0 + b.bbox.x1) / 2;
const cy = (b) => (b.bbox.y0 + b.bbox.y1) / 2;

/**
 * Rebuilds LaTeX using both the recognized symbols and the geometric bars.
 * Falls back to the plain line-based path when there are no bars.
 */
export function dataToLatexLinesWithBars(data, bars) {
  if (!bars || !bars.length) return dataToLatexLines(data);

  const tokens = allSymbols(data);
  if (!tokens.length) return dataToLatexLines(data);

  const consumed = new Set();
  const fracTokens = [];

  // Scale the search band to the document's own glyph size rather than to the
  // bar's width, so a wide bar doesn't sweep in unrelated lines.
  const hs = tokens.map((tk) => tk.bbox.y1 - tk.bbox.y0).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)] || 30;

  for (const bar of bars) {
    const within = (tk) => cx(tk) >= bar.x0 - 6 && cx(tk) <= bar.x1 + 6;
    const near = (tk) => Math.abs(cy(tk) - bar.y) < medH * 2.2;
    const above = tokens.filter((tk) => !consumed.has(tk) && within(tk) && cy(tk) < bar.y && near(tk));
    const below = tokens.filter((tk) => !consumed.has(tk) && within(tk) && cy(tk) > bar.y && near(tk));
    // A rule with nothing under it is an underline, not a fraction.
    if (!above.length || !below.length) continue;

    // Keep only the row closest to the bar on each side.
    const nearestRow = (list, dir) => {
      const key = (tk) => (dir < 0 ? bar.y - tk.bbox.y1 : tk.bbox.y0 - bar.y);
      const best = Math.min(...list.map(key));
      const band = list.filter((tk) => key(tk) - best < medH * 0.8);
      return band.sort((a, b) => cx(a) - cx(b));
    };
    const num = nearestRow(above, -1);
    const den = nearestRow(below, 1);
    for (const tk of [...num, ...den]) consumed.add(tk);

    fracTokens.push({
      latex: `\\frac{${tokensToLatex(num)}}{${tokensToLatex(den)}}`,
      bbox: { x0: bar.x0, x1: bar.x1, y0: bar.y - 1, y1: bar.y + 1 },
    });
  }

  if (!fracTokens.length) return dataToLatexLines(data);

  // Re-flow everything (leftover symbols plus the synthesised fractions)
  // into rows by vertical position, then left-to-right within each row.
  const rest = tokens.filter((tk) => !consumed.has(tk));
  const all = [...rest, ...fracTokens].sort((a, b) => cy(a) - cy(b));
  const rows = [];
  for (const tk of all) {
    const row = rows.find((r) => Math.abs(r.y - cy(tk)) < medH * 0.9);
    if (row) row.items.push(tk);
    else rows.push({ y: cy(tk), items: [tk] });
  }
  return rows
    .map((r) => tokensToLatex(r.items.sort((a, b) => cx(a) - cx(b))))
    .map(applyFractions)
    .filter(Boolean);
}

/** Median symbol height of a recognition result, used to size bar detection. */
export function medianGlyphHeight(data) {
  const hs = [];
  for (const block of data.blocks || [])
    for (const para of block.paragraphs || [])
      for (const line of para.lines || [])
        for (const word of line.words || [])
          for (const sym of word.symbols || [])
            if (sym.bbox) hs.push(sym.bbox.y1 - sym.bbox.y0);
  if (!hs.length) return 0;
  hs.sort((a, b) => a - b);
  return hs[Math.floor(hs.length / 2)];
}

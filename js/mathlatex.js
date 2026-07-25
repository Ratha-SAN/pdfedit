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

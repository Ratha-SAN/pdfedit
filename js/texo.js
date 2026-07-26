// Optional, higher-accuracy math OCR using the Texo LaTeX recognition model
// (https://github.com/alephpi/Texo, AGPL-3.0), run fully in-browser via
// Transformers.js -- vendored locally, same as every other dependency. The
// one thing that is NOT vendored is the model itself: its weights live on
// the Hugging Face Hub and are fetched by the browser the first time this
// is used (then cached by the browser for offline reuse). Everything else
// -- the runtime, the ONNX Wasm backend, your documents -- never leaves
// this machine.
//
// Texo is trained to read a single cropped formula, so this is used for
// "Select an area" math recognition. Whole-page math recognition, with its
// possibly-multiple formulas, stays on the existing Tesseract + geometric
// reconstruction pipeline. Any failure here (offline, blocked host,
// incompatible model export) throws, and the caller falls back to that
// existing pipeline.

const MODEL_ID = 'alephpi/FormulaNet';

let pipelinePromise = null;

async function loadPipeline(onProgress) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const mod = await import('../vendor/texo/transformers.web.min.js');
      const { AutoProcessor, AutoTokenizer, AutoModelForVision2Seq, RawImage, env } = mod;

      env.allowLocalModels = false;
      env.useBrowserCache = true;
      const base = new URL('../vendor/texo/', import.meta.url).href;
      env.backends.onnx.wasm.wasmPaths = {
        mjs: base + 'ort-wasm-simd-threaded.asyncify.mjs',
        wasm: base + 'ort-wasm-simd-threaded.asyncify.wasm',
      };
      // No SharedArrayBuffer/cross-origin-isolation headers on static
      // hosting (Firebase/GitHub Pages), so run single-threaded.
      env.backends.onnx.wasm.numThreads = 1;

      const progress_callback = onProgress;
      const [processor, tokenizer, model] = await Promise.all([
        AutoProcessor.from_pretrained(MODEL_ID, { progress_callback }),
        AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback }),
        AutoModelForVision2Seq.from_pretrained(MODEL_ID, { progress_callback }),
      ]);
      return { processor, tokenizer, model, RawImage };
    })();
  }
  return pipelinePromise;
}

// Resolves with a trimmed LaTeX string, or throws if the model can't be
// loaded or run (caller is expected to fall back to Tesseract in that case).
export async function recognizeLatexWithTexo(canvas, onProgress) {
  const { processor, tokenizer, model, RawImage } = await loadPipeline(onProgress);
  const image = RawImage.fromCanvas(canvas);
  const { pixel_values } = await processor(image);
  const outputIds = await model.generate({ inputs: pixel_values, max_new_tokens: 512 });
  const [latex] = tokenizer.batch_decode(outputIds, { skip_special_tokens: true });
  return (latex || '').trim();
}

// True once the model has actually finished loading in this session, so the
// UI can skip the "downloading" message on later calls.
export function isTexoReady() {
  return pipelinePromise !== null;
}

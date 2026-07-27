import { state, $ } from './state.js';

const translations = {
  en: {
    appTitle: 'Khmer PDF Editor',
    tabEdit: 'Edit',
    tabPages: 'Pages',

    btnUpload: 'Open',
    btnUploadTitle: 'Open a PDF or image in a new tab',
    closeDocTitle: 'Close this document',
    confirmCloseDoc: 'Close “{name}”? Any unsaved edits to it will be lost.',
    ocrViewRendered: 'Rendered',
    ocrViewLatex: 'LaTeX',
    ocrViewText: 'Plain text',

    viewModeTitle: 'Page view',
    viewContinuous: 'Continuous',
    viewSingle: 'Single page',
    viewDouble: 'Double page',
    zoomOutTitle: 'Zoom out',
    zoomResetTitle: 'Reset zoom to 100%',
    zoomInTitle: 'Zoom in',
    pagePrevTitle: 'Previous page',
    pageNextTitle: 'Next page',

    btnAddText: '+ Text',
    btnAddTextTitle: 'Add a text box (click a page to place)',
    btnAddImage: '+ Image',
    btnAddImageTitle: 'Insert an image (click a page to place)',
    btnAddSignature: '+ Signature',
    btnAddSignatureTitle: 'Draw or upload a signature',
    btnAddHighlight: '+ Highlight',
    btnAddHighlightTitle: 'Highlight part of a page (drag to draw)',
    btnRecognize: 'Recognize text',
    btnRecognizeTitle: 'Recognize text (OCR) — choose scope and language',
    ocrMenuScope: 'What to recognize',
    ocrScopePage: 'Whole page',
    ocrScopeArea: 'Select an area…',
    ocrMenuLang: 'Language',
    ocrLangAuto: 'Auto (Khmer + English)',
    ocrLangKhmer: 'Khmer',
    ocrLangEnglish: 'English',
    ocrLangMath: 'Math / formulas',
    ocrMathNote: 'Math mode rebuilds superscripts from the scan and shows rendered formulas plus LaTeX.',
    ocrAreaHint: 'Drag a rectangle around the text you want to recognize.',

    themeLightTitle: 'Light theme',
    themeDarkTitle: 'Dark theme',

    btnAppendPdf: '+ Append PDF',
    btnAppendPdfTitle: 'Append pages from another PDF',
    removeSelected: 'Remove selected',
    removeSelectedCount: 'Remove selected ({n})',
    removeSelectedTitle: 'Remove selected pages',
    splitMenuLabel: 'Split document (select one page)',
    btnSplitBefore: 'Split before selected page',
    btnSplitBeforeTitle: 'Split so the selected page starts the second document',
    btnSplitAfter: 'Split after selected page',
    btnSplitAfterTitle: 'Split so the selected page ends the first document',
    compressLabelSidebar: 'Output size',

    compressTitle: 'Output size / quality — compressing re-encodes pages as images, which shrinks the file but makes existing text non-selectable',
    compressNone: 'Original quality',
    compressLow: 'Compress — high quality',
    compressMedium: 'Compress — balanced',
    compressHigh: 'Compress — smallest',
    compressing: 'Compressing pages…',
    estimating: 'Estimating…',
    btnPrint: 'Print',
    btnPrintTitle: 'Print the document',
    btnExport: 'Save PDF',
    btnExportTitle: 'Download the modified PDF',
    btnFeatures: '✨ Features',
    btnFeaturesTitle: 'See what this app can do',

    dzTitle: 'Drop a PDF or image here',
    dzOr: 'or',
    btnPick: 'Choose a file',

    sigModalTitle: 'Signature',
    sigStylesTitle: 'Brush style — pressure from a stylus or touch varies the stroke width',
    sigStylePen: 'Pen',
    sigStyleInk: 'Ink',
    sigStyleStylo: 'Stylus',
    sigStyleMarker: 'Marker',
    sigStyleBrush: 'Brush',
    sigClear: 'Clear',
    sigUpload: 'Upload PNG instead',
    sigUse: 'Use signature',

    ocrModalTitle: 'Recognized text ({lang})',
    ocrPlaceholder: 'Recognized text will appear here.',
    ocrCopy: 'Copy text',
    ocrCopied: 'Copied!',
    ocrLoadingEngine: 'Loading OCR engine…',
    ocrRecognizingStart: 'Recognizing…',
    ocrRecognizing: 'Recognizing… {pct}%',
    ocrNoText: '(no text found)',
    ocrFailed: 'OCR failed: {err}',

    textToolHint: 'Click anywhere on a page to place a text box. Type Khmer or English, drag to move, use the corner handle to resize.',
    imageToolHint: 'Click on a page to place the image.',
    signatureToolHint: 'Click on a page to place the signature.',
    highlightToolHint: 'Drag across a page to highlight (or click for a default size). Change the color afterward from the highlight’s own toolbar.',

    itemSizeLabel: 'Size',
    itemEditLabel: 'Edit',
    itemEditTitle: 'Edit this text inline',
    secFile: 'File',
    secInsert: 'Insert',
    secRecognize: 'Recognize text',
    secPages: 'Pages',
    itemFontTitle: 'Font',
    fontGroupKhmer: 'Khmer fonts',
    fontGroupLatin: 'English fonts',
    itemTextColorTitle: 'Text color',
    itemHighlightColorTitle: 'Highlight color',
    itemDeleteTitle: 'Delete',
    itemResizeTitle: 'Resize',
    page: 'Page',
    selectPageTitle: 'Select page',

    loadingPdf: 'Loading PDF…',
    buildingPdf: 'Building PDF…',
    preparingPrint: 'Preparing to print…',
    couldNotReadPdf: 'Could not read that PDF: {err}',
    exportFailed: 'Export failed: {err}',
    printFailed: 'Print failed: {err}',

    langEn: 'English',
    langKm: 'ខ្មែរ',
  },
  km: {
    appTitle: 'កម្មវិធីកែសម្រួល PDF ខ្មែរ',
    tabEdit: 'កែសម្រួល',
    tabPages: 'ទំព័រ',

    btnUpload: 'បើក',
    btnUploadTitle: 'បើកឯកសារ PDF ឬរូបភាពក្នុងផ្ទាំងថ្មី',
    closeDocTitle: 'បិទឯកសារនេះ',
    confirmCloseDoc: 'តើបិទ “{name}” ឬ? ការកែប្រែដែលមិនទាន់រក្សាទុកនឹងបាត់បង់។',
    ocrViewRendered: 'បង្ហាញរូបភាព',
    ocrViewLatex: 'LaTeX',
    ocrViewText: 'អត្ថបទធម្មតា',

    viewModeTitle: 'របៀបមើលទំព័រ',
    viewContinuous: 'បន្តបន្ទាប់',
    viewSingle: 'ទំព័រតែមួយ',
    viewDouble: 'ទំព័រពីរ',
    zoomOutTitle: 'បង្រួម',
    zoomResetTitle: 'កំណត់ការពង្រីកទៅ 100% វិញ',
    zoomInTitle: 'ពង្រីក',
    pagePrevTitle: 'ទំព័រមុន',
    pageNextTitle: 'ទំព័របន្ទាប់',

    btnAddText: '+ អត្ថបទ',
    btnAddTextTitle: 'បន្ថែមប្រអប់អត្ថបទ (ចុចលើទំព័រដើម្បីដាក់)',
    btnAddImage: '+ រូបភាព',
    btnAddImageTitle: 'បញ្ចូលរូបភាព (ចុចលើទំព័រដើម្បីដាក់)',
    btnAddSignature: '+ ហត្ថលេខា',
    btnAddSignatureTitle: 'គូរ ឬផ្ទុកឡើងហត្ថលេខា',
    btnAddHighlight: '+ បន្លិចពណ៌',
    btnAddHighlightTitle: 'បន្លិចពណ៌ផ្នែកនៃទំព័រ (អូសដើម្បីគូរ)',
    btnRecognize: 'ស្គាល់អក្សរ',
    btnRecognizeTitle: 'ស្គាល់អក្សរ (OCR) — ជ្រើសរើសវិសាលភាព និងភាសា',
    ocrMenuScope: 'អ្វីដែលត្រូវស្គាល់',
    ocrScopePage: 'ទាំងមូលទំព័រ',
    ocrScopeArea: 'ជ្រើសរើសតំបន់…',
    ocrMenuLang: 'ភាសា',
    ocrLangAuto: 'ស្វ័យប្រវត្តិ (ខ្មែរ + អង់គ្លេស)',
    ocrLangKhmer: 'ខ្មែរ',
    ocrLangEnglish: 'អង់គ្លេស',
    ocrLangMath: 'គណិតវិទ្យា / រូបមន្ត',
    ocrMathNote: 'របៀបគណិតវិទ្យាស្ថាបនាសូចនាករឡើងវិញ ហើយបង្ហាញរូបមន្តជារូបភាព និង LaTeX។',
    ocrAreaHint: 'អូសដើម្បីគូរប្រអប់ជុំវិញអក្សរដែលអ្នកចង់ស្គាល់។',

    themeLightTitle: 'រចនាបថភ្លឺ',
    themeDarkTitle: 'រចនាបថងងឹត',

    btnAppendPdf: '+ បន្ថែម PDF',
    btnAppendPdfTitle: 'បន្ថែមទំព័រពីឯកសារ PDF មួយទៀត',
    removeSelected: 'លុបទំព័រដែលបានជ្រើសរើស',
    removeSelectedCount: 'លុបទំព័រដែលបានជ្រើសរើស ({n})',
    removeSelectedTitle: 'លុបទំព័រដែលបានជ្រើសរើស',
    splitMenuLabel: 'ពុះឯកសារ (ជ្រើសរើសទំព័រមួយ)',
    btnSplitBefore: 'ពុះមុនទំព័រដែលបានជ្រើសរើស',
    btnSplitBeforeTitle: 'ពុះឲ្យទំព័រដែលបានជ្រើសរើសចាប់ផ្តើមឯកសារទីពីរ',
    btnSplitAfter: 'ពុះក្រោយទំព័រដែលបានជ្រើសរើស',
    btnSplitAfterTitle: 'ពុះឲ្យទំព័រដែលបានជ្រើសរើសបញ្ចប់ឯកសារទីមួយ',
    compressLabelSidebar: 'ទំហំលទ្ធផល',

    compressTitle: 'ទំហំ / គុណភាពលទ្ធផល — ការបង្រួមបំប្លែងទំព័រជារូបភាព ដែលបន្ថយទំហំ ប៉ុន្តែធ្វើឱ្យអត្ថបទដើមមិនអាចជ្រើសរើសបាន',
    compressNone: 'គុណភាពដើម',
    compressLow: 'បង្រួម — គុណភាពខ្ពស់',
    compressMedium: 'បង្រួម — មធ្យម',
    compressHigh: 'បង្រួម — តូចបំផុត',
    compressing: 'កំពុងបង្រួមទំព័រ…',
    estimating: 'កំពុងប៉ាន់ស្មាន…',
    btnPrint: 'បោះពុម្ព',
    btnPrintTitle: 'បោះពុម្ពឯកសារ',
    btnExport: 'រក្សាទុក PDF',
    btnExportTitle: 'ទាញយកឯកសារ PDF ដែលបានកែប្រែ',
    btnFeatures: '✨ លក្ខណៈពិសេស',
    btnFeaturesTitle: 'មើលអ្វីដែលកម្មវិធីនេះអាចធ្វើបាន',

    dzTitle: 'ទម្លាក់ឯកសារ PDF ឬរូបភាពនៅទីនេះ',
    dzOr: 'ឬ',
    btnPick: 'ជ្រើសរើសឯកសារ',

    sigModalTitle: 'ហត្ថលេខា',
    sigStylesTitle: 'រចនាបថច្រាស — សម្ពាធពីប៊ិចអេឡិចត្រូនិក ឬការប៉ះប្តូរទទឹងខ្សែ',
    sigStylePen: 'ប៊ិច',
    sigStyleInk: 'ទឹកខ្មៅ',
    sigStyleStylo: 'ប៊ិចអេឡិចត្រូនិក',
    sigStyleMarker: 'ប៊ិចសម្គាល់',
    sigStyleBrush: 'ជក់',
    sigClear: 'សម្អាត',
    sigUpload: 'ផ្ទុកឡើងឯកសារ PNG ជំនួសវិញ',
    sigUse: 'ប្រើហត្ថលេខានេះ',

    ocrModalTitle: 'អក្សរដែលបានស្គាល់ ({lang})',
    ocrPlaceholder: 'អក្សរដែលបានស្គាល់នឹងបង្ហាញនៅទីនេះ។',
    ocrCopy: 'ចម្លងអក្សរ',
    ocrCopied: 'បានចម្លង!',
    ocrLoadingEngine: 'កំពុងផ្ទុកម៉ាស៊ីន OCR…',
    ocrRecognizingStart: 'កំពុងស្គាល់អក្សរ…',
    ocrRecognizing: 'កំពុងស្គាល់អក្សរ… {pct}%',
    ocrNoText: '(រកមិនឃើញអក្សរទេ)',
    ocrFailed: 'ការស្គាល់អក្សរបរាជ័យ៖ {err}',

    textToolHint: 'ចុចត្រង់កន្លែងណាមួយលើទំព័រដើម្បីដាក់ប្រអប់អត្ថបទ។ វាយអក្សរខ្មែរ ឬអង់គ្លេស អូសដើម្បីផ្លាស់ទី ហើយប្រើចំណុចជ្រុងដើម្បីប្តូរទំហំ។',
    imageToolHint: 'ចុចលើទំព័រដើម្បីដាក់រូបភាព។',
    signatureToolHint: 'ចុចលើទំព័រដើម្បីដាក់ហត្ថលេខា។',
    highlightToolHint: 'អូសកាត់លើទំព័រដើម្បីបន្លិចពណ៌ (ឬចុចម្តងសម្រាប់ទំហំលំនាំដើម)។ ប្តូរពណ៌នៅពេលក្រោយពីរបារឧបករណ៍របស់ផ្នែកបន្លិចពណ៌នោះផ្ទាល់។',

    itemSizeLabel: 'ទំហំ',
    itemEditLabel: 'កែ',
    itemEditTitle: 'កែអត្ថបទនេះនៅនឹងកន្លែង',
    secFile: 'ឯកសារ',
    secInsert: 'បញ្ចូល',
    secRecognize: 'ស្គាល់អក្សរ',
    secPages: 'ទំព័រ',
    itemFontTitle: 'ពុម្ពអក្សរ',
    fontGroupKhmer: 'ពុម្ពអក្សរខ្មែរ',
    fontGroupLatin: 'ពុម្ពអក្សរអង់គ្លេស',
    itemTextColorTitle: 'ពណ៌អក្សរ',
    itemHighlightColorTitle: 'ពណ៌បន្លិច',
    itemDeleteTitle: 'លុប',
    itemResizeTitle: 'ប្តូរទំហំ',
    page: 'ទំព័រ',
    selectPageTitle: 'ជ្រើសរើសទំព័រ',

    loadingPdf: 'កំពុងផ្ទុកឯកសារ PDF…',
    buildingPdf: 'កំពុងបង្កើតឯកសារ PDF…',
    preparingPrint: 'កំពុងរៀបចំបោះពុម្ព…',
    couldNotReadPdf: 'មិនអាចអានឯកសារ PDF នោះបានទេ៖ {err}',
    exportFailed: 'ការរក្សាទុកបរាជ័យ៖ {err}',
    printFailed: 'ការបោះពុម្ពបរាជ័យ៖ {err}',

    langEn: 'English',
    langKm: 'ខ្មែរ',
  },
};

// A handful of fixed status phrases tesseract.js reports during OCR setup.
// Everything else (e.g. the live "recognizing text" percentage) is handled
// separately in ocr.js; unrecognized/future library strings just fall
// through untranslated rather than breaking.
const ocrStatusMap = {
  en: {
    'loading tesseract core': 'Loading OCR engine…',
    'initializing tesseract': 'Initializing OCR engine…',
    'loading language traineddata': 'Loading Khmer language data…',
    'initializing api': 'Preparing OCR…',
  },
  km: {
    'loading tesseract core': 'កំពុងផ្ទុកម៉ាស៊ីន OCR…',
    'initializing tesseract': 'កំពុងចាប់ផ្តើមម៉ាស៊ីន OCR…',
    'loading language traineddata': 'កំពុងផ្ទុកទិន្នន័យភាសាខ្មែរ…',
    'initializing api': 'កំពុងរៀបចំ OCR…',
  },
};

export function t(key, vars) {
  let str = translations[state.lang]?.[key] ?? translations.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
  return str;
}

export function translateOcrStatus(status) {
  return ocrStatusMap[state.lang]?.[status] ?? ocrStatusMap.en[status] ?? status;
}

export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.title = t('appTitle');
  document.documentElement.lang = state.lang;
  document.body.classList.toggle('lang-km', state.lang === 'km');
  $('#lang-en').classList.toggle('active', state.lang === 'en');
  $('#lang-km').classList.toggle('active', state.lang === 'km');
  document.documentElement.classList.remove('lang-pending');
}

export function setLang(lang) {
  if (lang !== 'en' && lang !== 'km') return;
  state.lang = lang;
  try { localStorage.setItem('pdfedit-lang', lang); } catch {}
  applyTranslations();
  document.dispatchEvent(new CustomEvent('langchange'));
}

export function initLang() {
  let saved = null;
  try { saved = localStorage.getItem('pdfedit-lang'); } catch {}
  state.lang = saved === 'km' ? 'km' : 'en';
  $('#lang-en').addEventListener('click', () => setLang('en'));
  $('#lang-km').addEventListener('click', () => setLang('km'));
  applyTranslations();
}

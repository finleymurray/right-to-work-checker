import { addRoute, initRouter } from './js/router.js';

// Configure pdf.js worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Register routes
addRoute('/', async (el) => {
  const { render } = await import('./js/views/dashboard.js');
  await render(el);
});

addRoute('/new', async (el) => {
  const { render } = await import('./js/views/record-form.js');
  await render(el);
});

addRoute('/record/:id', async (el, params) => {
  const { render } = await import('./js/views/record-detail.js');
  await render(el, params.id);
});

addRoute('/record/:id/edit', async (el, params) => {
  const { render } = await import('./js/views/record-form.js');
  await render(el, params.id);
});

// Handle PDF generation requests from record detail view
document.addEventListener('generate-pdf', async (e) => {
  const { recordId } = e.detail;
  const { fetchRecord } = await import('./js/services/records-service.js');
  const { getDocumentScanUrl } = await import('./js/services/storage-service.js');
  const { generatePDF, fetchScanAsDataUrl } = await import('./js/utils/pdf-generator.js');

  const record = await fetchRecord(recordId);

  let scanDataUrl = null;
  if (record.document_scan_path) {
    const signedUrl = await getDocumentScanUrl(record.document_scan_path);
    scanDataUrl = await fetchScanAsDataUrl(signedUrl, record.document_scan_filename);
  }

  generatePDF(record, scanDataUrl);
});

// Initialise
initRouter(document.getElementById('app'));

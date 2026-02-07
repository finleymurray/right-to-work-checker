import { generatePDFBlob, fetchScanAsDataUrl } from './pdf-generator.js';
import { getDocumentScanUrl } from '../services/storage-service.js';

/**
 * Build a safe filename from a person's name.
 */
function safeName(name) {
  return (name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Export all records as individual compliance PDFs bundled in a ZIP.
 * @param {Array} records - Array of record objects
 * @param {string} baseFilename - Base name for the ZIP (without extension)
 * @param {function} onProgress - Optional callback(current, total) for progress updates
 */
export async function exportPDFsToZip(records, baseFilename, onProgress) {
  if (typeof window.jspdf === 'undefined') {
    alert('PDF library failed to load. Please check your internet connection and refresh the page.');
    return;
  }
  if (typeof JSZip === 'undefined') {
    alert('ZIP library failed to load. Please check your internet connection and refresh the page.');
    return;
  }

  const zip = new JSZip();
  const total = records.length;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Fetch scan as data URL for embedding in the PDF
    let scanDataUrl = null;
    if (record.document_scan_path) {
      try {
        const signedUrl = await getDocumentScanUrl(record.document_scan_path);
        if (signedUrl) {
          scanDataUrl = await fetchScanAsDataUrl(signedUrl, record.document_scan_filename);
        }
      } catch (err) {
        console.error(`Failed to fetch scan for ${record.person_name}:`, err);
      }
    }

    // Generate PDF blob
    const pdfBlob = generatePDFBlob(record, scanDataUrl);
    if (pdfBlob) {
      const name = safeName(record.person_name);
      const dateStr = (record.check_date || '').replace(/-/g, '');
      zip.file(`RTW_Record_${name}_${dateStr}.pdf`, pdfBlob);
    }

    if (onProgress) {
      onProgress(i + 1, total);
    }
  }

  // Generate and download ZIP
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseFilename}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

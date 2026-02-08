import { formatDateUK } from './date-utils.js';
import { getDocumentLabels, METHOD_LABELS } from './document-labels.js';
import { STATUS_LABELS } from '../services/status-service.js';
import { getDocumentScanUrl } from '../services/storage-service.js';
import { logAuditEvent } from '../services/auth-service.js';

const CHECK_TYPE_LABELS = { initial: 'Initial', follow_up: 'Follow-up' };

/**
 * Build a safe filename from a person's name.
 */
function safeName(name) {
  return (name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Determine file extension from a scan path or filename.
 */
function getExtension(path) {
  if (!path) return '';
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.substring(dot) : '';
}

/**
 * Build Excel row data from a record, with an optional scan filename reference.
 */
function buildRow(r, scanFilename) {
  return {
    'Name': r.person_name || '',
    'Date of Birth': formatDateUK(r.date_of_birth),
    'Check Date': formatDateUK(r.check_date),
    'Type': CHECK_TYPE_LABELS[r.check_type] || r.check_type || '',
    'Method': METHOD_LABELS[r.check_method] || r.check_method || '',
    'Status': STATUS_LABELS[r.status] || r.status || '',
    'Documents': getDocumentLabels(r.documents_checked).join('; '),
    'Share Code': r.share_code || '',
    'IDSP Provider': r.idsp_provider || '',
    'Q1 - Photos consistent': (r.verification_answers || {}).q1 || '',
    'Q2 - DOB consistent': (r.verification_answers || {}).q2 || '',
    'Q3 - Expiry dates valid': (r.verification_answers || {}).q3 || '',
    'Q4 - Work restrictions': (r.verification_answers || {}).q4 || '',
    'Q5 - Document genuine': (r.verification_answers || {}).q5 || '',
    'Q6 - Different names': (r.verification_answers || {}).q6 || '',
    'Declaration Confirmed': r.declaration_confirmed ? 'Yes' : 'No',
    'Checker Name': r.checker_name || '',
    'Additional Notes': r.additional_notes || '',
    'Expiry Date': formatDateUK(r.expiry_date),
    'Follow-up Date': formatDateUK(r.follow_up_date),
    'Employment End Date': formatDateUK(r.employment_end_date),
    'Deletion Due Date': formatDateUK(r.deletion_due_date),
    'Document Scan': scanFilename || '',
  };
}

/**
 * Export records to a ZIP containing an Excel spreadsheet and all document scans.
 * @param {Array} records - Array of record objects
 * @param {string} baseFilename - Base name for the ZIP (without extension)
 * @param {function} onProgress - Optional callback(current, total) for progress updates
 */
export async function exportToZip(records, baseFilename, onProgress) {
  if (typeof XLSX === 'undefined') {
    alert('Excel library failed to load. Please check your internet connection and refresh the page.');
    return;
  }
  if (typeof JSZip === 'undefined') {
    alert('ZIP library failed to load. Please check your internet connection and refresh the page.');
    return;
  }

  const zip = new JSZip();
  const scansFolder = zip.folder('scans');
  const rows = [];
  const total = records.length;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    let scanFilename = '';

    if (r.document_scan_path) {
      try {
        const signedUrl = await getDocumentScanUrl(r.document_scan_path);
        if (signedUrl) {
          const response = await fetch(signedUrl);
          const blob = await response.blob();
          const ext = getExtension(r.document_scan_filename || r.document_scan_path);
          scanFilename = `${safeName(r.person_name)}_${(r.check_date || '').replace(/-/g, '')}${ext}`;
          scansFolder.file(scanFilename, blob);
          scanFilename = `scans/${scanFilename}`;
        }
      } catch (err) {
        console.error(`Failed to fetch scan for ${r.person_name}:`, err);
      }
    }

    rows.push(buildRow(r, scanFilename));

    if (onProgress) {
      onProgress(i + 1, total);
    }
  }

  // Build Excel workbook
  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  if (rows.length > 0) {
    const colWidths = Object.keys(rows[0]).map(key => {
      const maxLen = Math.max(
        key.length,
        ...rows.map(r => String(r[key] || '').length)
      );
      return { wch: Math.min(maxLen + 2, 50) };
    });
    ws['!cols'] = colWidths;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'RTW Records');
  const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  zip.file('RTW_Records.xlsx', xlsxData);

  // Log export event for GDPR audit trail
  logAuditEvent('export_excel', {
    table_name: 'rtw_records',
    new_values: { record_count: records.length, filename: `${baseFilename}.zip` },
  });

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

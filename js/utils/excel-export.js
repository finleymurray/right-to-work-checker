import { formatDateUK } from './date-utils.js';
import { getDocumentLabels, METHOD_LABELS } from './document-labels.js';
import { STATUS_LABELS } from '../services/status-service.js';

const CHECK_TYPE_LABELS = { initial: 'Initial', follow_up: 'Follow-up' };

/**
 * Export records to an Excel (.xlsx) file.
 * @param {Array} records - Array of record objects
 * @param {string} filename - Output filename
 */
export function exportToExcel(records, filename) {
  if (typeof XLSX === 'undefined') {
    alert('Excel library failed to load. Please check your internet connection and refresh the page.');
    return;
  }

  const rows = records.map(r => ({
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
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  const colWidths = Object.keys(rows[0] || {}).map(key => {
    const maxLen = Math.max(
      key.length,
      ...rows.map(r => String(r[key] || '').length)
    );
    return { wch: Math.min(maxLen + 2, 50) };
  });
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'RTW Records');
  XLSX.writeFile(wb, filename);
}

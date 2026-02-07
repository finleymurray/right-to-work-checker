import { fetchRecord, deleteRecord } from '../services/records-service.js';
import { getDocumentScanUrl, deleteRecordScans } from '../services/storage-service.js';
import { calculateStatus, STATUS_LABELS, STATUS_CLASSES } from '../services/status-service.js';
import { formatDateUK, daysUntil } from '../utils/date-utils.js';
import { getDocumentLabels, METHOD_LABELS, STEP2_QUESTIONS } from '../utils/document-labels.js';
import { navigate } from '../router.js';

/**
 * Escapes HTML special characters to prevent XSS.
 */
function escapeHtml(str) {
  if (!str) return '';
  const el = document.createElement('div');
  el.textContent = str;
  return el.innerHTML;
}

/**
 * Renders a single detail field (label + value pair).
 */
function fieldHtml(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `
    <div class="detail-field">
      <span class="field-label">${escapeHtml(label)}</span>
      <span class="field-value">${escapeHtml(String(value))}</span>
    </div>`;
}

/**
 * Builds the warning banner markup based on current status.
 */
function buildWarningBanner(record, status) {
  if (status === 'follow_up_due' && record.follow_up_date) {
    const days = daysUntil(record.follow_up_date);
    const dateStr = formatDateUK(record.follow_up_date);
    return `
      <div class="warning-banner amber">
        Follow-up check due on ${escapeHtml(dateStr)} (${days} days remaining)
      </div>`;
  }

  if (status === 'expired' && record.expiry_date) {
    const dateStr = formatDateUK(record.expiry_date);
    return `
      <div class="warning-banner red">
        Permission expired on ${escapeHtml(dateStr)}
      </div>`;
  }

  if (status === 'follow_up_overdue' && record.follow_up_date) {
    const dateStr = formatDateUK(record.follow_up_date);
    return `
      <div class="warning-banner red">
        Follow-up check is overdue &mdash; was due on ${escapeHtml(dateStr)}
      </div>`;
  }

  return '';
}

/**
 * Builds the verification questions section.
 */
function buildVerificationHtml(record) {
  const answers = record.verification_answers || {};
  const rows = STEP2_QUESTIONS.map((q) => {
    const answer = answers[q.key];
    let badgeClass = '';
    let badgeText = 'N/A';

    if (answer === 'Yes') {
      badgeClass = 'badge-valid';
      badgeText = 'Yes';
    } else if (answer === 'No') {
      badgeClass = 'badge-expired';
      badgeText = 'No';
    } else if (answer === 'N/A') {
      badgeText = 'N/A';
    }

    return `
      <div class="verification-row">
        <span class="verification-question">${escapeHtml(q.text)}</span>
        <span class="badge ${escapeHtml(badgeClass)}">${escapeHtml(badgeText)}</span>
      </div>`;
  });

  return rows.join('');
}

/**
 * Builds the document scan section markup.
 */
function buildScanSection(record, scanUrl) {
  if (!record.document_scan_path) {
    return '<p>No document scan uploaded.</p>';
  }

  const filename = record.document_scan_path.split('/').pop() || '';
  const isPdf = filename.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    return `
      <p>Uploaded document: <strong>${escapeHtml(filename)}</strong> (PDF file)</p>
      <p><a href="${escapeHtml(scanUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">Open PDF</a></p>`;
  }

  if (scanUrl) {
    return `
      <div class="scan-display">
        <img src="${escapeHtml(scanUrl)}" alt="Document scan for ${escapeHtml(record.person_name)}" />
      </div>`;
  }

  return '<p>Document scan could not be loaded.</p>';
}

/**
 * Builds the confirmation overlay for record deletion.
 */
function buildConfirmOverlay(personName) {
  return `
    <div class="confirm-overlay" id="delete-overlay" style="display: none;">
      <div class="confirm-dialog">
        <p>Are you sure you want to delete this record for <strong>${escapeHtml(personName)}</strong>? This cannot be undone.</p>
        <div class="btn-group">
          <button type="button" class="btn btn-danger" id="confirm-delete-btn">Delete</button>
          <button type="button" class="btn btn-secondary" id="cancel-delete-btn">Cancel</button>
        </div>
      </div>
    </div>`;
}

/**
 * Renders the record detail view into the provided element.
 *
 * @param {HTMLElement} el - The container element to render into.
 * @param {string} recordId - The UUID of the record to display.
 */
export async function render(el, recordId) {
  // 1. Fetch the record
  const record = await fetchRecord(recordId);

  // 2. Calculate current status
  const status = calculateStatus(record);
  const statusLabel = STATUS_LABELS[status] || status;
  const statusClass = STATUS_CLASSES[status] || '';

  // 3. Fetch document scan signed URL if a scan exists
  let scanUrl = null;
  if (record.document_scan_path) {
    try {
      scanUrl = await getDocumentScanUrl(record.document_scan_path);
    } catch (err) {
      console.error('Failed to load document scan URL:', err);
    }
  }

  // 4. Build the detail fields
  const checkType = record.check_type === 'initial' ? 'Initial check' : 'Follow-up check';
  const methodLabel = METHOD_LABELS[record.check_method] || record.check_method || '';

  // Document labels
  const docLabels = getDocumentLabels(record.documents_checked);
  const docListHtml = docLabels.length > 0
    ? `<ul class="doc-list">${docLabels.map(label => `<li>${escapeHtml(label)}</li>`).join('')}</ul>`
    : '<p>No documents recorded.</p>';

  // Verification section
  const verificationHtml = buildVerificationHtml(record);

  // Warning banner
  const warningBanner = buildWarningBanner(record, status);

  // Scan section
  const scanSectionHtml = buildScanSection(record, scanUrl);

  // Confirmation overlay
  const confirmOverlayHtml = buildConfirmOverlay(record.person_name);

  // Conditional fields
  const expiryField = record.expiry_date
    ? fieldHtml('Expiry date of permission', formatDateUK(record.expiry_date))
    : '';

  const followUpField = record.follow_up_date
    ? fieldHtml('Follow-up check due date', formatDateUK(record.follow_up_date))
    : '';

  const shareCodeField = record.check_method === 'online' && record.share_code
    ? fieldHtml('Share code', record.share_code)
    : '';

  const idspField = record.check_method === 'idsp' && record.idsp_provider
    ? fieldHtml('IDSP provider', record.idsp_provider)
    : '';

  // Notes section
  const notesSection = record.additional_notes
    ? `
      <section class="detail-section">
        <h3 class="detail-section-title">Additional Notes</h3>
        <div class="detail-section-body">
          <p>${escapeHtml(record.additional_notes)}</p>
        </div>
      </section>`
    : '';

  // Declaration text
  const declarationText =
    'I confirm that I have carried out the right to work check in compliance with ' +
    'Home Office instructions and believe a valid statutory excuse is established.';

  // 5. Render the full view
  el.innerHTML = `
    <div class="record-detail">
      <div class="detail-header">
        <div class="detail-header-title">
          <h2>${escapeHtml(record.person_name)}</h2>
          <span class="badge ${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="btn-group">
          <button type="button" class="btn btn-primary" id="edit-btn">Edit</button>
          <button type="button" class="btn btn-secondary" id="download-pdf-btn">Download PDF</button>
          <button type="button" class="btn btn-danger" id="delete-btn">Delete</button>
        </div>
      </div>

      ${warningBanner}

      <div class="detail-grid">
        ${fieldHtml('Name of person', record.person_name)}
        ${fieldHtml('Date of birth', formatDateUK(record.date_of_birth))}
        ${fieldHtml('Date of RTW check', formatDateUK(record.check_date))}
        ${fieldHtml('Type of check', checkType)}
        ${fieldHtml('Method used', methodLabel)}
        ${expiryField}
        ${followUpField}
        ${shareCodeField}
        ${idspField}
        ${fieldHtml('Checker name', record.checker_name)}
      </div>

      <section class="detail-section">
        <h3 class="detail-section-title">Documents Checked</h3>
        <div class="detail-section-body">
          ${docListHtml}
        </div>
      </section>

      <section class="detail-section">
        <h3 class="detail-section-title">Verification Questions</h3>
        <div class="detail-section-body">
          ${verificationHtml}
        </div>
      </section>

      <section class="detail-section">
        <h3 class="detail-section-title">Declaration</h3>
        <div class="detail-section-body">
          <div class="declaration-box">
            <p>${escapeHtml(declarationText)}</p>
            <p><strong>Confirmed by:</strong> ${escapeHtml(record.checker_name || '')}</p>
          </div>
        </div>
      </section>

      ${notesSection}

      <section class="detail-section">
        <h3 class="detail-section-title">Document Scan</h3>
        <div class="detail-section-body">
          ${scanSectionHtml}
        </div>
      </section>

      ${confirmOverlayHtml}
    </div>`;

  // 6. Attach event listeners

  // Edit button
  const editBtn = el.querySelector('#edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      navigate(`/record/${recordId}/edit`);
    });
  }

  // Download PDF button
  const downloadPdfBtn = el.querySelector('#download-pdf-btn');
  if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', () => {
      document.dispatchEvent(
        new CustomEvent('generate-pdf', { detail: { recordId } })
      );
    });
  }

  // Delete button - show confirmation overlay
  const deleteBtn = el.querySelector('#delete-btn');
  const overlay = el.querySelector('#delete-overlay');
  const confirmDeleteBtn = el.querySelector('#confirm-delete-btn');
  const cancelDeleteBtn = el.querySelector('#cancel-delete-btn');

  if (deleteBtn && overlay) {
    deleteBtn.addEventListener('click', () => {
      overlay.style.display = 'flex';
    });
  }

  if (cancelDeleteBtn && overlay) {
    cancelDeleteBtn.addEventListener('click', () => {
      overlay.style.display = 'none';
    });
  }

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async () => {
      confirmDeleteBtn.disabled = true;
      confirmDeleteBtn.textContent = 'Deleting\u2026';

      try {
        await deleteRecordScans(recordId);
        await deleteRecord(recordId);
        navigate('/');
      } catch (err) {
        console.error('Failed to delete record:', err);
        confirmDeleteBtn.disabled = false;
        confirmDeleteBtn.textContent = 'Delete';
        if (overlay) overlay.style.display = 'none';
        el.insertAdjacentHTML(
          'afterbegin',
          `<div class="warning-banner red">Failed to delete record: ${escapeHtml(err.message)}</div>`
        );
      }
    });
  }

  // Close overlay when clicking the backdrop (outside the dialog)
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.style.display = 'none';
      }
    });
  }
}

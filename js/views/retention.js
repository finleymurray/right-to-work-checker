import { fetchDeletedRecords, autoDeleteExpiredRecords } from '../services/retention-service.js';
import { formatDateUK } from '../utils/date-utils.js';

function escapeHtml(str) {
  if (!str) return '';
  const el = document.createElement('div');
  el.textContent = str;
  return el.innerHTML;
}

function buildAutoDeleteBanner(results) {
  if (results.deleted.length === 0 && results.errors.length === 0) {
    return '<div class="info-banner">No expired records found. All records are within their retention period.</div>';
  }

  let html = '';
  if (results.deleted.length > 0) {
    html += `
      <div class="warning-banner amber">
        <strong>${results.deleted.length} expired record${results.deleted.length === 1 ? '' : 's'} automatically deleted:</strong>
        ${results.deleted.map(n => escapeHtml(n)).join(', ')}
      </div>`;
  }
  if (results.errors.length > 0) {
    html += `
      <div class="warning-banner red">
        <strong>${results.errors.length} record${results.errors.length === 1 ? '' : 's'} failed to delete:</strong><br>
        ${results.errors.map(e => escapeHtml(e)).join('<br>')}
      </div>`;
  }
  return html;
}

function buildDeletedTable(records) {
  if (records.length === 0) {
    return '<p class="empty-state-text">No records have been deleted yet.</p>';
  }

  const rows = records.map(r => `
    <tr>
      <td>${escapeHtml(r.person_name)}</td>
      <td>${r.employment_start_date ? formatDateUK(r.employment_start_date) : ''}</td>
      <td>${r.employment_end_date ? formatDateUK(r.employment_end_date) : ''}</td>
      <td>${r.deleted_at ? formatDateUK(r.deleted_at.slice(0, 10)) : ''}</td>
      <td>${escapeHtml(r.deleted_by_email || '')}</td>
      <td>${escapeHtml(r.reason || '')}</td>
    </tr>`).join('');

  return `
    <table class="records-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Employment Start</th>
          <th>Employment End</th>
          <th>Deleted On</th>
          <th>Deleted By</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export async function render(el) {
  el.innerHTML = '<div class="loading">Processing expired records\u2026</div>';

  // Auto-delete any records past their retention period
  let autoDeleteResults = { deleted: [], errors: [] };
  try {
    autoDeleteResults = await autoDeleteExpiredRecords();
  } catch (err) {
    autoDeleteResults.errors.push(err.message);
  }

  // Fetch the deletion audit log
  let deletedRecords = [];
  try {
    deletedRecords = await fetchDeletedRecords();
  } catch (err) {
    el.innerHTML = `
      <div class="error-banner">
        <h2>Error</h2>
        <p>${escapeHtml(err.message)}</p>
        <a href="#/" class="btn-link">Back to dashboard</a>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="dashboard-header">
      <h2>Data Retention &amp; GDPR</h2>
    </div>

    <div class="retention-info">
      <p>Under GDPR and Home Office guidance, right to work records must be retained for the duration of employment plus 2 years, then securely destroyed. Expired records are automatically deleted when this page loads.</p>
    </div>

    ${buildAutoDeleteBanner(autoDeleteResults)}

    <section class="detail-section">
      <h3 class="detail-section-title">Deleted Records Log (${deletedRecords.length})</h3>
      <div class="detail-section-body">
        ${buildDeletedTable(deletedRecords)}
        ${deletedRecords.length > 0 ? '<button type="button" class="btn btn-secondary" id="export-deleted-btn" style="margin-top:12px;">Export to Excel</button>' : ''}
      </div>
    </section>
  `;

  // Export deleted records to Excel
  const exportBtn = el.querySelector('#export-deleted-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (typeof XLSX === 'undefined') {
        alert('Excel library failed to load. Please refresh the page.');
        return;
      }

      const rows = deletedRecords.map(r => ({
        'Name': r.person_name || '',
        'Employment Start': r.employment_start_date ? formatDateUK(r.employment_start_date) : '',
        'Employment End': r.employment_end_date ? formatDateUK(r.employment_end_date) : '',
        'Deletion Due Date': r.deletion_due_date ? formatDateUK(r.deletion_due_date) : '',
        'Deleted On': r.deleted_at ? formatDateUK(r.deleted_at.slice(0, 10)) : '',
        'Deleted By': r.deleted_by_email || '',
        'Reason': r.reason || '',
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      if (rows.length > 0) {
        ws['!cols'] = Object.keys(rows[0]).map(key => {
          const maxLen = Math.max(key.length, ...rows.map(r => String(r[key] || '').length));
          return { wch: Math.min(maxLen + 2, 50) };
        });
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Deleted Records');
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      XLSX.writeFile(wb, `RTW_Deleted_Records_${dateStr}.xlsx`);
    });
  }
}

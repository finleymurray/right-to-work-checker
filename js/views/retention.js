import { fetchDeletedRecords, fetchRecordsPendingDeletion, logRecordDeletion } from '../services/retention-service.js';
import { deleteRecord } from '../services/records-service.js';
import { deleteRecordScans } from '../services/storage-service.js';
import { getUser, getUserProfile } from '../services/auth-service.js';
import { formatDateUK } from '../utils/date-utils.js';

function escapeHtml(str) {
  if (!str) return '';
  const el = document.createElement('div');
  el.textContent = str;
  return el.innerHTML;
}

function buildPendingTable(records) {
  if (records.length === 0) {
    return '<p class="empty-state-text">No records are currently pending deletion.</p>';
  }

  const rows = records.map(r => `
    <tr>
      <td>${escapeHtml(r.person_name)}</td>
      <td>${r.check_date ? formatDateUK(r.check_date) : ''}</td>
      <td>${r.employment_end_date ? formatDateUK(r.employment_end_date) : ''}</td>
      <td>${r.deletion_due_date ? formatDateUK(r.deletion_due_date) : ''}</td>
      <td>
        <button type="button" class="btn btn-danger btn-small delete-pending-btn" data-id="${r.id}">Delete now</button>
      </td>
    </tr>`).join('');

  return `
    <table class="records-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Check Date</th>
          <th>Employment End</th>
          <th>Deletion Due</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
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
  el.innerHTML = '<div class="loading">Loading retention data\u2026</div>';

  let pendingRecords = [];
  let deletedRecords = [];

  try {
    [pendingRecords, deletedRecords] = await Promise.all([
      fetchRecordsPendingDeletion(),
      fetchDeletedRecords(),
    ]);
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
      <p>Under GDPR and Home Office guidance, right to work records must be retained for the duration of employment plus 2 years, then securely destroyed. Records past their retention period appear below for deletion.</p>
    </div>

    <section class="detail-section">
      <h3 class="detail-section-title">Records Pending Deletion (${pendingRecords.length})</h3>
      <div class="detail-section-body">
        ${buildPendingTable(pendingRecords)}
      </div>
    </section>

    <section class="detail-section">
      <h3 class="detail-section-title">Deleted Records Log (${deletedRecords.length})</h3>
      <div class="detail-section-body">
        ${buildDeletedTable(deletedRecords)}
        ${deletedRecords.length > 0 ? '<button type="button" class="btn btn-secondary" id="export-deleted-btn" style="margin-top:12px;">Export to Excel</button>' : ''}
      </div>
    </section>
  `;

  // Handle individual delete buttons
  el.querySelectorAll('.delete-pending-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const recordId = btn.getAttribute('data-id');
      const record = pendingRecords.find(r => r.id === recordId);
      if (!record) return;

      if (!confirm(`Delete the record for ${record.person_name}? This will permanently remove all personal data and document scans. This cannot be undone.`)) {
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Deleting\u2026';

      try {
        const user = await getUser();
        const profile = await getUserProfile();
        await logRecordDeletion(record, user.id, profile?.email || user.email);
        await deleteRecordScans(recordId);
        await deleteRecord(recordId);
        // Re-render
        await render(el);
      } catch (err) {
        alert('Failed to delete: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Delete now';
      }
    });
  });

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

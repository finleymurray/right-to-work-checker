import { fetchAllRecords } from '../services/records-service.js';
import { refreshStatuses, STATUS_LABELS, STATUS_CLASSES } from '../services/status-service.js';
import { formatDateShort } from '../utils/date-utils.js';
import { METHOD_LABELS } from '../utils/document-labels.js';
import { exportToZip } from '../utils/excel-export.js';
import { exportPDFsToZip } from '../utils/pdf-export.js';

const ATTENTION_STATUSES = ['follow_up_due', 'expired', 'follow_up_overdue'];
const DANGER_STATUSES = ['expired', 'follow_up_overdue'];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'valid', label: 'Valid' },
  { value: 'follow_up_due', label: 'Follow-up due' },
  { value: 'expired', label: 'Expired' },
  { value: 'follow_up_overdue', label: 'Overdue' },
];

const TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'initial', label: 'Initial' },
  { value: 'follow_up', label: 'Follow-up' },
];

const METHOD_FILTER_OPTIONS = [
  { value: '', label: 'All methods' },
  { value: 'manual', label: 'Manual' },
  { value: 'idsp', label: 'IDSP' },
  { value: 'online', label: 'Online' },
];

let allRecords = [];
let currentFilters = { search: '', status: '', type: '', method: '' };
let currentSort = { column: 'check_date', direction: 'desc' };

/**
 * Format the check type value for display.
 * @param {string} type - The raw check type value.
 * @returns {string} Human-readable label.
 */
function formatCheckType(type) {
  if (!type) return '';
  if (type === 'initial') return 'Initial';
  if (type === 'follow_up') return 'Follow-up';
  return type;
}

/**
 * Build a <select> element's HTML from an array of option objects.
 * @param {string} id - The element id.
 * @param {Array} options - Array of { value, label } objects.
 * @param {string} selected - The currently selected value.
 * @returns {string} HTML string for the select element.
 */
function buildSelectHTML(id, options, selected) {
  const optionsHTML = options
    .map(opt => {
      const sel = opt.value === selected ? ' selected' : '';
      return `<option value="${opt.value}"${sel}>${opt.label}</option>`;
    })
    .join('');
  return `<select id="${id}">${optionsHTML}</select>`;
}

/**
 * Return the sort arrow indicator for a column header.
 * @param {string} column - The column key.
 * @returns {string} Arrow character or empty string.
 */
function sortIndicator(column) {
  if (currentSort.column !== column) return '';
  return currentSort.direction === 'asc' ? ' \u25B2' : ' \u25BC';
}

/**
 * Filter records based on the current filter state.
 * @param {Array} records - The full list of records.
 * @returns {Array} Filtered records.
 */
function applyFilters(records) {
  return records.filter(record => {
    if (currentFilters.search) {
      const term = currentFilters.search.toLowerCase();
      const fullName = (record.person_name || '').toLowerCase();
      if (!fullName.includes(term)) return false;
    }

    if (currentFilters.status && record.status !== currentFilters.status) {
      return false;
    }

    if (currentFilters.type && record.check_type !== currentFilters.type) {
      return false;
    }

    if (currentFilters.method && record.check_method !== currentFilters.method) {
      return false;
    }

    return true;
  });
}

/**
 * Sort records based on the current sort state.
 * @param {Array} records - Records to sort (will be sorted in place).
 * @returns {Array} The sorted array.
 */
function applySort(records) {
  const { column, direction } = currentSort;
  const mult = direction === 'asc' ? 1 : -1;

  return records.sort((a, b) => {
    let valA, valB;

    switch (column) {
      case 'name':
        valA = (a.person_name || '').toLowerCase();
        valB = (b.person_name || '').toLowerCase();
        break;
      case 'dob':
        valA = a.date_of_birth || '';
        valB = b.date_of_birth || '';
        break;
      case 'check_date':
        valA = a.check_date || '';
        valB = b.check_date || '';
        break;
      case 'type':
        valA = a.check_type || '';
        valB = b.check_type || '';
        break;
      case 'method':
        valA = a.check_method || '';
        valB = b.check_method || '';
        break;
      case 'status':
        valA = a.status || '';
        valB = b.status || '';
        break;
      default:
        valA = '';
        valB = '';
    }

    if (valA < valB) return -1 * mult;
    if (valA > valB) return 1 * mult;
    return 0;
  });
}

/**
 * Build the table body HTML from the given records.
 * @param {Array} records - Filtered and sorted records.
 * @returns {string} HTML string for tbody content.
 */
function buildTbodyHTML(records) {
  if (records.length === 0) {
    return `<tr><td colspan="6" class="empty-state">No matching records found.</td></tr>`;
  }

  return records.map(record => {
    const name = record.person_name || '';
    const dob = record.date_of_birth ? formatDateShort(record.date_of_birth) : '';
    const checkDate = record.check_date ? formatDateShort(record.check_date) : '';
    const type = formatCheckType(record.check_type);
    const method = METHOD_LABELS[record.check_method] || record.check_method || '';
    const statusLabel = STATUS_LABELS[record.status] || record.status || '';
    const statusClass = STATUS_CLASSES[record.status] || '';

    return `<tr>
        <td><a href="#/record/${record.id}">${name}</a></td>
        <td>${dob}</td>
        <td>${checkDate}</td>
        <td>${type}</td>
        <td>${method}</td>
        <td><span class="badge ${statusClass}">${statusLabel}</span></td>
      </tr>`;
  }).join('');
}

/**
 * Re-render only the table body based on current filters and sort.
 * @param {HTMLElement} el - The root container element.
 */
function updateTableBody(el) {
  const tbody = el.querySelector('#dashboard-tbody');
  if (!tbody) return;

  const filtered = applyFilters([...allRecords]);
  const sorted = applySort(filtered);
  tbody.innerHTML = buildTbodyHTML(sorted);
}

/**
 * Build the attention banner HTML.
 * @param {Array} records - All records.
 * @returns {string} HTML string for the attention banner, or empty string.
 */
function buildAttentionBanner(records) {
  const attentionRecords = records.filter(r => ATTENTION_STATUSES.includes(r.status));
  if (attentionRecords.length === 0) return '';

  const hasDanger = attentionRecords.some(r => DANGER_STATUSES.includes(r.status));
  const bannerClass = hasDanger ? 'attention-banner danger' : 'attention-banner';
  const label = attentionRecords.length === 1 ? 'record needs' : 'records need';

  return `<div class="${bannerClass}">${attentionRecords.length} ${label} attention</div>`;
}

/**
 * Build the full dashboard HTML shell.
 * @param {Array} records - All records.
 * @returns {string} Complete dashboard HTML.
 */
function buildDashboardHTML(records) {
  const attentionBanner = buildAttentionBanner(records);

  const filtered = applyFilters([...records]);
  const sorted = applySort(filtered);
  const tbodyHTML = buildTbodyHTML(sorted);

  return `
    <div class="dashboard-header">
      <h1>Dashboard</h1>
      <p>${records.length} record${records.length !== 1 ? 's' : ''}</p>
    </div>

    ${attentionBanner}

    <div class="filter-bar">
      <div class="form-group">
        <input type="text" id="filter-search" placeholder="Search by name\u2026" value="${currentFilters.search}">
      </div>
      <div class="form-group">
        ${buildSelectHTML('filter-status', STATUS_FILTER_OPTIONS, currentFilters.status)}
      </div>
      <div class="form-group">
        ${buildSelectHTML('filter-type', TYPE_FILTER_OPTIONS, currentFilters.type)}
      </div>
      <div class="form-group">
        ${buildSelectHTML('filter-method', METHOD_FILTER_OPTIONS, currentFilters.method)}
      </div>
    </div>

    <table class="records-table">
      <thead>
        <tr>
          <th data-sort="name" class="sortable">Name${sortIndicator('name')}</th>
          <th data-sort="dob" class="sortable">DOB${sortIndicator('dob')}</th>
          <th data-sort="check_date" class="sortable">Check Date${sortIndicator('check_date')}</th>
          <th data-sort="type" class="sortable">Type${sortIndicator('type')}</th>
          <th data-sort="method" class="sortable">Method${sortIndicator('method')}</th>
          <th data-sort="status" class="sortable">Status${sortIndicator('status')}</th>
        </tr>
      </thead>
      <tbody id="dashboard-tbody">
        ${tbodyHTML}
      </tbody>
    </table>

    <div class="export-section">
      <h3>Export Records</h3>
      <p class="export-desc">Download a ZIP containing an Excel spreadsheet and all document scans.</p>
      <div class="export-row">
        <button type="button" class="btn btn-secondary" id="export-all-btn">Export all records</button>
        <button type="button" class="btn btn-secondary" id="export-all-pdfs-btn">Export all PDFs</button>
        <span class="export-progress" id="export-progress"></span>
      </div>
      <div class="export-row">
        <label for="export-from">From</label>
        <input type="date" id="export-from">
        <label for="export-to">To</label>
        <input type="date" id="export-to">
        <button type="button" class="btn btn-secondary" id="export-range-btn">Export date range</button>
      </div>
    </div>`;
}

/**
 * Attach all event listeners for filters and sort headers.
 * @param {HTMLElement} el - The root container element.
 */
function attachEventListeners(el) {
  const searchInput = el.querySelector('#filter-search');
  if (searchInput) {
    searchInput.addEventListener('keyup', () => {
      currentFilters.search = searchInput.value;
      updateTableBody(el);
    });
  }

  const statusSelect = el.querySelector('#filter-status');
  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      currentFilters.status = statusSelect.value;
      updateTableBody(el);
    });
  }

  const typeSelect = el.querySelector('#filter-type');
  if (typeSelect) {
    typeSelect.addEventListener('change', () => {
      currentFilters.type = typeSelect.value;
      updateTableBody(el);
    });
  }

  const methodSelect = el.querySelector('#filter-method');
  if (methodSelect) {
    methodSelect.addEventListener('change', () => {
      currentFilters.method = methodSelect.value;
      updateTableBody(el);
    });
  }

  const sortHeaders = el.querySelectorAll('th[data-sort]');
  sortHeaders.forEach(th => {
    th.addEventListener('click', () => {
      const column = th.getAttribute('data-sort');
      if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort.column = column;
        currentSort.direction = 'asc';
      }

      // Update all header labels with sort indicators
      sortHeaders.forEach(header => {
        const col = header.getAttribute('data-sort');
        const baseLabel = header.textContent.replace(/\s*[\u25B2\u25BC]$/, '');
        header.textContent = baseLabel + sortIndicator(col);
      });

      updateTableBody(el);
    });
  });

  // Export helpers
  const progressEl = el.querySelector('#export-progress');

  function setExportBtns(disabled) {
    const btns = el.querySelectorAll('#export-all-btn, #export-range-btn, #export-all-pdfs-btn');
    btns.forEach(b => b.disabled = disabled);
  }

  function showProgress(current, total) {
    if (progressEl) {
      progressEl.textContent = `Fetching scans\u2026 ${current}/${total}`;
    }
  }

  async function runExport(records, baseName) {
    setExportBtns(true);
    if (progressEl) progressEl.textContent = 'Preparing export\u2026';
    try {
      await exportToZip(records, baseName, showProgress);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
    if (progressEl) progressEl.textContent = '';
    setExportBtns(false);
  }

  // Export buttons
  const exportAllBtn = el.querySelector('#export-all-btn');
  if (exportAllBtn) {
    exportAllBtn.addEventListener('click', () => {
      if (allRecords.length === 0) return;
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      runExport(allRecords, `RTW_Records_All_${dateStr}`);
    });
  }

  const exportAllPdfsBtn = el.querySelector('#export-all-pdfs-btn');
  if (exportAllPdfsBtn) {
    exportAllPdfsBtn.addEventListener('click', async () => {
      if (allRecords.length === 0) return;
      setExportBtns(true);
      if (progressEl) progressEl.textContent = 'Generating PDFs\u2026';
      try {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        function showPdfProgress(current, total) {
          if (progressEl) {
            progressEl.textContent = `Generating PDF ${current}/${total}\u2026`;
          }
        }
        await exportPDFsToZip(allRecords, `RTW_PDFs_All_${dateStr}`, showPdfProgress);
      } catch (err) {
        alert('PDF export failed: ' + err.message);
      }
      if (progressEl) progressEl.textContent = '';
      setExportBtns(false);
    });
  }

  const exportRangeBtn = el.querySelector('#export-range-btn');
  if (exportRangeBtn) {
    exportRangeBtn.addEventListener('click', () => {
      const fromInput = el.querySelector('#export-from');
      const toInput = el.querySelector('#export-to');
      const from = fromInput ? fromInput.value : '';
      const to = toInput ? toInput.value : '';

      if (!from && !to) {
        alert('Please select at least a start or end date.');
        return;
      }

      const filtered = allRecords.filter(r => {
        const d = r.check_date || '';
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });

      if (filtered.length === 0) {
        alert('No records found in the selected date range.');
        return;
      }

      const fromStr = from ? from.replace(/-/g, '') : 'start';
      const toStr = to ? to.replace(/-/g, '') : 'end';
      runExport(filtered, `RTW_Records_${fromStr}_to_${toStr}`);
    });
  }
}

/**
 * Render the dashboard view into the given element.
 * @param {HTMLElement} el - The container element to render into.
 */
export async function render(el) {
  // Reset filters and sort state on each full render
  currentFilters = { search: '', status: '', type: '', method: '' };
  currentSort = { column: 'check_date', direction: 'desc' };

  allRecords = await fetchAllRecords();
  refreshStatuses(allRecords);

  if (allRecords.length === 0) {
    el.innerHTML = `
      <div class="dashboard-header">
        <h1>Dashboard</h1>
        <p>0 records</p>
      </div>
      <div class="empty-state">
        <p>No records yet. <a href="#/new">Add your first right to work check</a>.</p>
      </div>`;
    return;
  }

  el.innerHTML = buildDashboardHTML(allRecords);
  attachEventListeners(el);
}

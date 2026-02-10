import { fetchAuditLog, fetchLoginHistory } from '../services/audit-service.js';

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatDateTime(iso) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export async function render(el) {
  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Admin Dashboard</h2>

    <div class="admin-tabs">
      <button type="button" class="admin-tab active" data-tab="audit">Audit Trail</button>
      <button type="button" class="admin-tab" data-tab="logins">Login History</button>
    </div>

    <div class="admin-panel active" data-panel="audit" id="panel-audit">
      <div class="loading">Loading audit log...</div>
    </div>

    <div class="admin-panel" data-panel="logins" id="panel-logins">
      <div class="loading">Loading login history...</div>
    </div>
  `;

  // Tab switching
  const tabs = el.querySelectorAll('.admin-tab');
  const panels = el.querySelectorAll('.admin-panel');
  const loaded = { audit: false, logins: false };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      el.querySelector(`[data-panel="${target}"]`).classList.add('active');

      if (!loaded[target]) {
        loaded[target] = true;
        if (target === 'logins') loadLoginsTab(el);
      }
    });
  });

  // Load audit tab immediately
  loaded.audit = true;
  await loadAuditTab(el);
}

// ---- Audit Tab ----

async function loadAuditTab(el) {
  const panel = el.querySelector('#panel-audit');

  try {
    const entries = await fetchAuditLog({ limit: 200 });

    panel.innerHTML = `
      <div class="admin-section">
        <h3>Audit Trail</h3>

        <div class="filter-bar" style="margin-bottom:12px;">
          <div class="form-group">
            <label for="audit-action">Action</label>
            <select id="audit-action">
              <option value="">All</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="login">Login</option>
              <option value="logout">Logout</option>
            </select>
          </div>
          <div class="form-group">
            <label for="audit-from">From</label>
            <input type="date" id="audit-from">
          </div>
          <div class="form-group">
            <label for="audit-to">To</label>
            <input type="date" id="audit-to">
          </div>
          <div class="form-group" style="align-self:flex-end;">
            <button type="button" class="btn btn-secondary btn-small" id="audit-filter-btn">Filter</button>
          </div>
        </div>

        <div id="audit-results">${buildAuditTable(entries)}</div>
      </div>
    `;

    // Filter handler
    panel.querySelector('#audit-filter-btn').addEventListener('click', async () => {
      const action = panel.querySelector('#audit-action').value || undefined;
      const dateFrom = panel.querySelector('#audit-from').value || undefined;
      const dateTo = panel.querySelector('#audit-to').value || undefined;

      const resultsEl = panel.querySelector('#audit-results');
      resultsEl.innerHTML = '<div class="loading">Filtering...</div>';

      try {
        const filtered = await fetchAuditLog({ action, dateFrom, dateTo, limit: 200 });
        resultsEl.innerHTML = buildAuditTable(filtered);
        attachDiffToggles(resultsEl);
      } catch (err) {
        resultsEl.innerHTML = `<div class="warning-banner red">${esc(err.message)}</div>`;
      }
    });

    attachDiffToggles(panel.querySelector('#audit-results'));
  } catch (err) {
    panel.innerHTML = `<div class="warning-banner red">Failed to load audit log: ${esc(err.message)}</div>`;
  }
}

function buildAuditTable(entries) {
  if (!entries.length) return '<p>No audit entries found.</p>';

  const rows = entries.map((e, i) => {
    const actionBadge = actionClass(e.action);
    const hasDiff = e.action === 'update' && e.old_values && e.new_values;

    return `
      <tr>
        <td>${formatDateTime(e.created_at)}</td>
        <td>${esc(e.user_email || '\u2014')}</td>
        <td><span class="badge ${actionBadge}">${esc(e.action)}</span></td>
        <td>${esc(e.table_name || '\u2014')}</td>
        <td>
          ${e.record_id ? `<a href="#/record/${esc(e.record_id)}">${esc(e.record_id.slice(0, 8))}\u2026</a>` : '\u2014'}
          ${hasDiff ? `<button type="button" class="btn-link diff-toggle" data-idx="${i}">Show changes</button>` : ''}
        </td>
      </tr>
      ${hasDiff ? `<tr class="diff-row" id="diff-${i}" style="display:none;"><td colspan="5">${buildDiffView(e.old_values, e.new_values)}</td></tr>` : ''}
    `;
  }).join('');

  return `
    <table class="records-table">
      <thead>
        <tr><th>Time</th><th>User</th><th>Action</th><th>Table</th><th>Details</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function actionClass(action) {
  switch (action) {
    case 'create': return 'badge-valid';
    case 'update': return 'badge-follow-up-due';
    case 'delete': return 'badge-expired';
    case 'login': return 'badge-valid';
    case 'logout': return '';
    default: return '';
  }
}

function buildDiffView(oldVal, newVal) {
  const allKeys = new Set([...Object.keys(oldVal || {}), ...Object.keys(newVal || {})]);
  const skip = ['id', 'created_at', 'updated_at'];
  const rows = [];

  for (const key of allKeys) {
    if (skip.includes(key)) continue;
    const ov = JSON.stringify(oldVal?.[key] ?? null);
    const nv = JSON.stringify(newVal?.[key] ?? null);
    if (ov === nv) continue;

    rows.push(`
      <tr>
        <td style="font-weight:700;">${esc(key)}</td>
        <td class="diff-removed">${esc(ov)}</td>
        <td class="diff-added">${esc(nv)}</td>
      </tr>
    `);
  }

  if (!rows.length) return '<p style="padding:8px;font-size:13px;">No field changes detected.</p>';

  return `
    <table class="diff-table">
      <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;
}

function attachDiffToggles(container) {
  container.querySelectorAll('.diff-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.idx;
      const row = container.querySelector(`#diff-${idx}`);
      if (row) {
        const hidden = row.style.display === 'none';
        row.style.display = hidden ? '' : 'none';
        btn.textContent = hidden ? 'Hide changes' : 'Show changes';
      }
    });
  });
}

// ---- Login History Tab ----

async function loadLoginsTab(el) {
  const panel = el.querySelector('#panel-logins');

  try {
    const entries = await fetchLoginHistory({ limit: 100 });

    if (!entries.length) {
      panel.innerHTML = '<div class="admin-section"><h3>Login History</h3><p>No login events recorded yet.</p></div>';
      return;
    }

    const rows = entries.map(e => `
      <tr>
        <td>${formatDateTime(e.created_at)}</td>
        <td>${esc(e.user_email || '\u2014')}</td>
        <td><span class="badge ${e.action === 'login' ? 'badge-valid' : ''}">${esc(e.action)}</span></td>
      </tr>
    `).join('');

    panel.innerHTML = `
      <div class="admin-section">
        <h3>Login History</h3>
        <table class="records-table">
          <thead>
            <tr><th>Time</th><th>User</th><th>Event</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch (err) {
    panel.innerHTML = `<div class="warning-banner red">Failed to load login history: ${esc(err.message)}</div>`;
  }
}

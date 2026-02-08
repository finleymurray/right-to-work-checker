import { fetchAllProfiles, createUser, updateUserRole, deleteUser } from '../services/user-management-service.js';
import { fetchAuditLog, fetchLoginHistory } from '../services/audit-service.js';
import { getUser } from '../services/auth-service.js';

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
      <button type="button" class="admin-tab active" data-tab="staff">Staff Accounts</button>
      <button type="button" class="admin-tab" data-tab="audit">Audit Trail</button>
      <button type="button" class="admin-tab" data-tab="logins">Login History</button>
    </div>

    <div class="admin-panel active" data-panel="staff" id="panel-staff">
      <div class="loading">Loading staff...</div>
    </div>

    <div class="admin-panel" data-panel="audit" id="panel-audit">
      <div class="loading">Loading audit log...</div>
    </div>

    <div class="admin-panel" data-panel="logins" id="panel-logins">
      <div class="loading">Loading login history...</div>
    </div>
  `;

  // Tab switching
  const tabs = el.querySelectorAll('.admin-tab');
  const panels = el.querySelectorAll('.admin-panel');
  const loaded = { staff: false, audit: false, logins: false };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      el.querySelector(`[data-panel="${target}"]`).classList.add('active');

      if (!loaded[target]) {
        loaded[target] = true;
        if (target === 'audit') loadAuditTab(el);
        if (target === 'logins') loadLoginsTab(el);
      }
    });
  });

  // Load staff tab immediately
  loaded.staff = true;
  await loadStaffTab(el);
}

// ---- Staff Tab ----

async function loadStaffTab(el) {
  const panel = el.querySelector('#panel-staff');

  try {
    const [profiles, currentUser] = await Promise.all([fetchAllProfiles(), getUser()]);
    const currentUserId = currentUser?.id;

    const rows = profiles.map(p => {
      const isSelf = p.id === currentUserId;
      const toggleRole = p.role === 'manager' ? 'staff' : 'manager';
      const toggleLabel = p.role === 'manager' ? 'Demote to staff' : 'Promote to manager';

      return `
      <tr>
        <td>${esc(p.full_name)}${isSelf ? ' <span style="color:#505a5f;font-size:12px;">(you)</span>' : ''}</td>
        <td>${esc(p.email)}</td>
        <td><span class="badge ${p.role === 'manager' ? 'badge-valid' : ''}">${esc(p.role)}</span></td>
        <td>${formatDateTime(p.created_at)}</td>
        <td>
          ${isSelf ? '' : `
            <button type="button" class="btn btn-secondary btn-small role-toggle-btn" data-user-id="${esc(p.id)}" data-new-role="${esc(toggleRole)}">${esc(toggleLabel)}</button>
            <button type="button" class="btn btn-danger btn-small delete-user-btn" data-user-id="${esc(p.id)}" data-user-name="${esc(p.full_name)}"style="margin-left:4px;">Delete</button>
          `}
        </td>
      </tr>`;
    }).join('');

    panel.innerHTML = `
      <div class="admin-section">
        <h3>Create New User</h3>
        <div id="create-user-error" class="login-error" style="display:none;"></div>
        <div id="create-user-success" class="info-banner" style="display:none;"></div>
        <form id="create-user-form" class="create-user-form">
          <div class="form-row">
            <div class="form-group">
              <label for="new-email">Email</label>
              <input type="email" id="new-email" required>
            </div>
            <div class="form-group">
              <label for="new-name">Full name</label>
              <input type="text" id="new-name" required>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="new-role">Role</label>
              <select id="new-role">
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            <div class="form-group">
              <label for="new-password">Password <span style="font-weight:400;color:#505a5f;">(optional &mdash; user will set via email if blank)</span></label>
              <input type="text" id="new-password" autocomplete="off">
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-small" id="create-user-btn">Create user</button>
        </form>
      </div>

      <div id="staff-action-msg" style="display:none;margin-bottom:12px;"></div>

      <div class="admin-section">
        <h3>All Staff (${profiles.length})</h3>
        ${profiles.length === 0 ? '<p>No users found.</p>' : `
          <table class="records-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th><th>Actions</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        `}
      </div>

      <div class="confirm-overlay" id="delete-user-overlay" style="display:none;">
        <div class="confirm-dialog">
          <p>Are you sure you want to delete <strong id="delete-user-name"></strong>? This cannot be undone.</p>
          <div class="btn-group">
            <button type="button" class="btn btn-danger" id="confirm-delete-user-btn">Delete</button>
            <button type="button" class="btn btn-secondary" id="cancel-delete-user-btn">Cancel</button>
          </div>
        </div>
      </div>
    `;

    // Create user form handler
    const form = panel.querySelector('#create-user-form');
    const errorEl = panel.querySelector('#create-user-error');
    const successEl = panel.querySelector('#create-user-success');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      successEl.style.display = 'none';

      const btn = panel.querySelector('#create-user-btn');
      btn.disabled = true;
      btn.textContent = 'Creating\u2026';

      try {
        const email = panel.querySelector('#new-email').value.trim();
        const full_name = panel.querySelector('#new-name').value.trim();
        const role = panel.querySelector('#new-role').value;
        const password = panel.querySelector('#new-password').value || undefined;

        await createUser({ email, full_name, role, password });

        successEl.textContent = `User ${email} created successfully.`;
        successEl.style.display = 'block';
        form.reset();

        // Refresh the staff list
        await loadStaffTab(el);
      } catch (err) {
        errorEl.textContent = err.message || 'Failed to create user.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Create user';
      }
    });

    // Role toggle handlers
    panel.querySelectorAll('.role-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        const newRole = btn.dataset.newRole;
        btn.disabled = true;
        btn.textContent = 'Updating\u2026';

        try {
          await updateUserRole(userId, newRole);
          await loadStaffTab(el);
        } catch (err) {
          const msgEl = panel.querySelector('#staff-action-msg');
          msgEl.className = 'warning-banner red';
          msgEl.textContent = err.message || 'Failed to update role.';
          msgEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = newRole === 'manager' ? 'Promote to manager' : 'Demote to staff';
        }
      });
    });

    // Delete user handlers
    const overlay = panel.querySelector('#delete-user-overlay');
    const confirmBtn = panel.querySelector('#confirm-delete-user-btn');
    const cancelBtn = panel.querySelector('#cancel-delete-user-btn');
    const deleteNameEl = panel.querySelector('#delete-user-name');
    let pendingDeleteUserId = null;

    panel.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingDeleteUserId = btn.dataset.userId;
        deleteNameEl.textContent = btn.dataset.userName;
        overlay.style.display = 'flex';
      });
    });

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        overlay.style.display = 'none';
        pendingDeleteUserId = null;
      });
    }

    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.style.display = 'none';
          pendingDeleteUserId = null;
        }
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        if (!pendingDeleteUserId) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting\u2026';

        try {
          await deleteUser(pendingDeleteUserId);
          overlay.style.display = 'none';
          pendingDeleteUserId = null;
          await loadStaffTab(el);
        } catch (err) {
          overlay.style.display = 'none';
          const msgEl = panel.querySelector('#staff-action-msg');
          msgEl.className = 'warning-banner red';
          msgEl.textContent = err.message || 'Failed to delete user.';
          msgEl.style.display = 'block';
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Delete';
          pendingDeleteUserId = null;
        }
      });
    }
  } catch (err) {
    panel.innerHTML = `<div class="warning-banner red">Failed to load staff: ${esc(err.message)}</div>`;
  }
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

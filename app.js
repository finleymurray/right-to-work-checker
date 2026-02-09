import { addRoute, setAuthGuard, navigate, initRouter } from './js/router.js';
import { getSession, getUserProfile, isManager, onAuthStateChange, clearProfileCache } from './js/services/auth-service.js';

// Configure pdf.js worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---- Auth guard ----
setAuthGuard(async (routeOptions) => {
  const session = await getSession();
  if (!session) {
    navigate('/login');
    return false;
  }
  if (routeOptions.requiresManager) {
    const manager = await isManager();
    if (!manager) {
      navigate('/');
      return false;
    }
  }
  return true;
});

// ---- Routes ----
addRoute('/login', async (el) => {
  // If already logged in, redirect to dashboard
  const session = await getSession();
  if (session) { navigate('/'); return; }
  const { render } = await import('./js/views/login.js');
  await render(el);
}, { public: true });

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

addRoute('/admin', async (el) => {
  const { render } = await import('./js/views/manager-dashboard.js');
  await render(el);
}, { requiresManager: true });

addRoute('/retention', async (el) => {
  const { render } = await import('./js/views/retention.js');
  await render(el);
}, { requiresManager: true });

// ---- PDF generation ----
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

  // Log PDF export for GDPR audit trail
  const { logAuditEvent } = await import('./js/services/auth-service.js');
  logAuditEvent('export_pdf', {
    table_name: 'rtw_records',
    record_id: recordId,
    new_values: { person_name: record.person_name },
  });
});

// ---- Auto-upload RTW PDF to Google Drive on record creation ----
document.addEventListener('rtw-record-created', async (e) => {
  const { recordId, personName } = e.detail;

  try {
    const { fetchRecord } = await import('./js/services/records-service.js');
    const { getDocumentScanUrl } = await import('./js/services/storage-service.js');
    const { generatePDFBlob, fetchScanAsDataUrl } = await import('./js/utils/pdf-generator.js');
    const { uploadToGoogleDrive } = await import('./js/services/gdrive-service.js');

    const record = await fetchRecord(recordId);

    // Generate the PDF as a blob
    let scanDataUrl = null;
    if (record.document_scan_path) {
      const signedUrl = await getDocumentScanUrl(record.document_scan_path);
      scanDataUrl = await fetchScanAsDataUrl(signedUrl, record.document_scan_filename);
    }

    const pdfBlob = generatePDFBlob(record, scanDataUrl);
    if (!pdfBlob) {
      console.error('GDrive upload: PDF library not available');
      return;
    }

    // Convert blob to base64
    const fileBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(pdfBlob);
    });

    // Build filename
    const safeName = (personName || 'record').replace(/[^a-zA-Z0-9 ]/g, '').trim();
    const dateStr = (record.check_date || '').replace(/-/g, '');
    const fileName = `RTW_${safeName}_${dateStr}.pdf`;

    // Upload to Google Drive
    const driveResult = await uploadToGoogleDrive({
      employeeName: personName,
      fileName,
      fileBase64,
      subfolder: 'Right to Work',
    });

    // Save Drive IDs back to the RTW record
    const { updateRecord } = await import('./js/services/records-service.js');
    await updateRecord(recordId, {
      gdrive_file_id: driveResult.file_id,
      gdrive_pdf_link: driveResult.web_view_link,
      gdrive_folder_id: driveResult.employee_folder_id,
    });

    console.log(`RTW PDF uploaded to Google Drive for ${personName}`);
  } catch (err) {
    // Don't break the user flow — this is a background operation
    console.error('Failed to upload RTW PDF to Google Drive:', err);
  }
});

// ---- Auto-replace RTW PDF in Google Drive on record update ----
document.addEventListener('rtw-record-updated', async (e) => {
  const { recordId } = e.detail;

  try {
    const { fetchRecord, updateRecord } = await import('./js/services/records-service.js');
    const { getDocumentScanUrl } = await import('./js/services/storage-service.js');
    const { generatePDFBlob, fetchScanAsDataUrl } = await import('./js/utils/pdf-generator.js');
    const { uploadToGoogleDrive, replaceFileInGoogleDrive } = await import('./js/services/gdrive-service.js');

    const record = await fetchRecord(recordId);

    // Generate the PDF as a blob
    let scanDataUrl = null;
    if (record.document_scan_path) {
      const signedUrl = await getDocumentScanUrl(record.document_scan_path);
      scanDataUrl = await fetchScanAsDataUrl(signedUrl, record.document_scan_filename);
    }

    const pdfBlob = generatePDFBlob(record, scanDataUrl);
    if (!pdfBlob) {
      console.error('GDrive update: PDF library not available');
      return;
    }

    const fileBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(pdfBlob);
    });

    const safeName = (record.person_name || 'record').replace(/[^a-zA-Z0-9 ]/g, '').trim();
    const dateStr = (record.check_date || '').replace(/-/g, '');
    const fileName = `RTW_${safeName}_${dateStr}.pdf`;

    let driveResult;
    if (record.gdrive_file_id) {
      // Replace existing file
      driveResult = await replaceFileInGoogleDrive({
        oldFileId: record.gdrive_file_id,
        employeeName: record.person_name,
        fileName,
        fileBase64,
        subfolder: 'Right to Work',
      });
    } else {
      // First-time upload (record existed before Drive sync)
      driveResult = await uploadToGoogleDrive({
        employeeName: record.person_name,
        fileName,
        fileBase64,
        subfolder: 'Right to Work',
      });
    }

    await updateRecord(recordId, {
      gdrive_file_id: driveResult.file_id,
      gdrive_pdf_link: driveResult.web_view_link,
      gdrive_folder_id: driveResult.employee_folder_id,
    });

    console.log(`RTW PDF updated in Google Drive for ${record.person_name}`);
  } catch (err) {
    console.error('Failed to update RTW PDF in Google Drive:', err);
  }
});

// ---- Nav auth state ----
async function updateNavAuth(session) {
  const userInfoEl = document.getElementById('user-info');
  const adminLink = document.getElementById('admin-link');
  const retentionLink = document.getElementById('retention-link');

  if (!userInfoEl) return;

  if (session) {
    try {
      const profile = await getUserProfile();
      userInfoEl.innerHTML = `
        <span class="user-name">${escapeHtml(profile?.full_name || session.user.email)}</span>
        <button type="button" class="btn-sign-out" id="sign-out-btn">Sign out</button>
      `;
      userInfoEl.style.display = 'flex';

      // Show/hide admin and retention links for managers
      const managerRole = profile?.role === 'manager';
      if (adminLink) {
        adminLink.style.display = managerRole ? '' : 'none';
      }
      if (retentionLink) {
        retentionLink.style.display = managerRole ? '' : 'none';
      }

      // Attach sign-out handler
      const signOutBtn = document.getElementById('sign-out-btn');
      if (signOutBtn) {
        signOutBtn.addEventListener('click', async () => {
          const { signOut } = await import('./js/services/auth-service.js');
          await signOut();
          navigate('/login');
        });
      }
    } catch (err) {
      console.error('Failed to load profile for nav:', err);
    }
  } else {
    userInfoEl.innerHTML = '';
    userInfoEl.style.display = 'none';
    if (adminLink) adminLink.style.display = 'none';
    if (retentionLink) retentionLink.style.display = 'none';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Listen for auth state changes
onAuthStateChange((event, session) => {
  clearProfileCache();
  updateNavAuth(session);
});

// Initial nav update
getSession().then(session => updateNavAuth(session));

// Initialise
initRouter(document.getElementById('app'));

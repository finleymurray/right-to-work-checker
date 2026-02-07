import { createRecord, fetchRecord, updateRecord } from '../services/records-service.js';
import { uploadDocumentScan } from '../services/storage-service.js';
import { calculateStatus } from '../services/status-service.js';
import { todayISO } from '../utils/date-utils.js';
import { validateRecord } from '../utils/validation.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ------------------------------------------------------------------ */
/*  Document / question label data                                    */
/* ------------------------------------------------------------------ */

const LIST_A = [
  { id: 'listA1', text: '1. A passport (current or expired) showing the holder is a British citizen or a citizen of the UK and Colonies having the right of abode in the UK.' },
  { id: 'listA2', text: '2. A passport or passport card (current or expired) showing the holder is an Irish citizen.' },
  { id: 'listA3', text: '3. A document issued by Jersey, Guernsey or Isle of Man, verified by the Home Office Employer Checking Service, showing unlimited leave under Appendix EU.' },
  { id: 'listA4', text: '4. A current passport endorsed to show the holder is exempt from immigration control, allowed to stay indefinitely, or has right of abode in the UK.' },
  { id: 'listA5', text: '5. A current Immigration Status Document with endorsement for indefinite stay, together with an official document giving the person\u2019s permanent NI number and name.' },
  { id: 'listA6', text: '6. A birth or adoption certificate issued in the UK, together with an official document giving the person\u2019s permanent NI number and name.' },
  { id: 'listA7', text: '7. A birth or adoption certificate issued in the Channel Islands, Isle of Man or Ireland, together with an official document giving the person\u2019s permanent NI number and name.' },
  { id: 'listA8', text: '8. A certificate of registration or naturalisation as a British citizen, together with an official document giving the person\u2019s permanent NI number and name.' },
];

const LIST_B1 = [
  { id: 'listB1_1', text: '1. A current passport endorsed to show the holder is allowed to stay in the UK and do the type of work in question.' },
  { id: 'listB1_2', text: '2. A document issued by Jersey, Guernsey or Isle of Man verified by Home Office, showing limited leave under Appendix EU.' },
  { id: 'listB1_3', text: '3. A current Immigration Status Document with photograph and valid endorsement, together with an official document giving the person\u2019s permanent NI number and name.' },
];

const LIST_B2 = [
  { id: 'listB2_1', text: '1. A Home Office document showing an EU Settlement Scheme application made on or before 30 June 2021, together with a Positive Verification Notice.' },
  { id: 'listB2_2', text: '2. A Certificate of Application (non-digital) for EU Settlement Scheme on or after 1 July 2021, together with a Positive Verification Notice.' },
  { id: 'listB2_3', text: '3. A document from Jersey, Guernsey or Isle of Man showing an Appendix EU application, together with a Positive Verification Notice.' },
  { id: 'listB2_4', text: '4. An Application Registration Card permitting the holder to take the employment, together with a Positive Verification Notice.' },
  { id: 'listB2_5', text: '5. A Positive Verification Notice indicating the named person may stay and is permitted to do the work in question.' },
];

const IDSP_DOCS = [
  { id: 'idsp1', text: 'A valid British passport (current)' },
  { id: 'idsp2', text: 'A valid Irish passport (current)' },
  { id: 'idsp3', text: 'A valid Irish passport card (current)' },
];

const ONLINE_CHECKS = [
  { id: 'onlineConfirm', text: 'The online check confirms the person has a right to work in the UK and is permitted to do the work in question.' },
  { id: 'onlinePhoto', text: 'The photograph on the online check result is consistent with the person presenting themselves for work (in person or via video).' },
  { id: 'onlineStudent', text: 'For students, the term and vacation dates and hours of study have been obtained and recorded.' },
  { id: 'onlineRetain', text: 'A copy of the profile page from the online check has been retained.' },
];

const QUESTIONS = [
  { key: 'q1', text: 'Are photographs consistent across documents and with the person presenting themselves for work?' },
  { key: 'q2', text: 'Are dates of birth correct and consistent across documents?' },
  { key: 'q3', text: 'Are expiry dates for time-limited permission to be in the UK in the future, i.e. they have not passed (if applicable)?' },
  { key: 'q4', text: 'Have you checked work restrictions to determine if the person is able to work for you and do the type of work you are offering?' },
  { key: 'q5', text: 'Have you taken all reasonable steps to check that the document is genuine, has not been tampered with and belongs to the holder?' },
  { key: 'q6', text: 'Have you checked the reasons for any different names across documents (e.g. marriage certificate, divorce decree, deed poll)?' },
];

/* ------------------------------------------------------------------ */
/*  HTML builders                                                     */
/* ------------------------------------------------------------------ */

function buildDocCheckboxes(items) {
  return items.map(item => `
    <div class="doc-check">
      <input type="checkbox" id="${item.id}" name="doc_${item.id}" value="${item.id}">
      <label for="${item.id}">${esc(item.text)}</label>
    </div>
  `).join('');
}

function buildVerificationQuestions() {
  return QUESTIONS.map(q => `
    <div class="checklist-item">
      <div class="check-text">${esc(q.text)}</div>
      <div class="check-options">
        <label><input type="radio" name="${q.key}" value="Yes"> Yes</label>
        <label><input type="radio" name="${q.key}" value="No"> No</label>
        <label><input type="radio" name="${q.key}" value="N/A"> N/A</label>
      </div>
    </div>
  `).join('');
}

/* ------------------------------------------------------------------ */
/*  Main render                                                       */
/* ------------------------------------------------------------------ */

export async function render(el, recordId) {
  let existing = null;
  const isEdit = !!recordId;

  if (isEdit) {
    existing = await fetchRecord(recordId);

    // Enforce 5-minute edit lock
    const createdAt = existing.created_at ? new Date(existing.created_at) : null;
    if (createdAt && (Date.now() - createdAt.getTime() > 5 * 60 * 1000)) {
      el.innerHTML = `
        <div class="info-banner" style="margin-top:20px;">
          This record can no longer be edited. Records are locked 5 minutes after submission.
        </div>
        <a href="#/record/${recordId}" class="btn btn-secondary" style="margin-top:12px;">Back to record</a>`;
      return;
    }
  }

  const today = todayISO();
  const heading = isEdit ? 'Edit Right to Work Record' : 'New Right to Work Check';
  const checkedDocs = existing ? (existing.documents_checked || []) : [];
  const verAnswers = existing ? (existing.verification_answers || {}) : {};
  const activeMethod = existing ? (existing.check_method || 'manual') : 'manual';

  el.innerHTML = `
    <h2 style="margin-bottom:20px;">${esc(heading)}</h2>

    <div id="error-summary" class="error-summary" style="display:none;">
      <h2>There is a problem</h2>
      <ul id="error-list"></ul>
    </div>

    <form id="rtw-form" novalidate>

      <!-- ========== Section 1: Employee & Check Details ========== -->
      <div class="section">
        <div class="section-title">Employee &amp; Check Details</div>

        <div class="form-row">
          <div class="form-group">
            <label for="person_name">Name of person</label>
            <input type="text" id="person_name" name="person_name" required
              value="${existing ? esc(existing.person_name) : ''}">
          </div>
          <div class="form-group">
            <label for="date_of_birth">Date of birth</label>
            <input type="date" id="date_of_birth" name="date_of_birth" required
              value="${existing ? (existing.date_of_birth || '') : ''}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="check_date">Date of check</label>
            <input type="date" id="check_date" name="check_date" required
              value="${existing ? (existing.check_date || today) : today}">
          </div>
        </div>

        <fieldset class="radio-group">
          <legend>Type of check</legend>
          <div class="radio-option">
            <input type="radio" id="check_type_initial" name="check_type" value="initial"
              ${(!existing || existing.check_type === 'initial') ? 'checked' : ''}>
            <label for="check_type_initial">Initial check before employment</label>
          </div>
          <div class="radio-option">
            <input type="radio" id="check_type_followup" name="check_type" value="follow_up"
              ${(existing && existing.check_type === 'follow_up') ? 'checked' : ''}>
            <label for="check_type_followup">Follow-up check on an employee</label>
          </div>
        </fieldset>

        <div class="form-row">
          <div class="form-group">
            <label for="expiry_date">Expiry date of permission <span style="font-weight:400;color:#505a5f;">(optional)</span></label>
            <input type="date" id="expiry_date" name="expiry_date"
              value="${existing ? (existing.expiry_date || '') : ''}">
          </div>
          <div class="form-group">
            <label for="follow_up_date">Follow-up check due date <span style="font-weight:400;color:#505a5f;">(optional)</span></label>
            <input type="date" id="follow_up_date" name="follow_up_date"
              value="${existing ? (existing.follow_up_date || '') : ''}">
          </div>
        </div>
      </div>

      <!-- ========== Section 2: Step 1 - Obtain ========== -->
      <div class="section">
        <div class="section-title">Step 1 &mdash; Obtain: Method &amp; Documents</div>

        <div class="method-tabs">
          <button type="button" class="method-tab${activeMethod === 'manual' ? ' active' : ''}" data-tab="manual">Manual Document Check</button>
          <button type="button" class="method-tab${activeMethod === 'idsp' ? ' active' : ''}" data-tab="idsp">IDVT Check via IDSP</button>
          <button type="button" class="method-tab${activeMethod === 'online' ? ' active' : ''}" data-tab="online">Online Share Code</button>
        </div>

        <!-- Manual panel -->
        <div class="method-panel${activeMethod === 'manual' ? ' active' : ''}" data-panel="manual">
          <div class="sub-heading">List A &mdash; Continuous right to work</div>
          ${buildDocCheckboxes(LIST_A)}

          <div class="sub-heading">List B Group 1 &mdash; Temporary right to work</div>
          ${buildDocCheckboxes(LIST_B1)}

          <div class="sub-heading">List B Group 2 &mdash; Pending applications</div>
          ${buildDocCheckboxes(LIST_B2)}
        </div>

        <!-- IDSP panel -->
        <div class="method-panel${activeMethod === 'idsp' ? ' active' : ''}" data-panel="idsp">
          <p style="margin-bottom:12px;font-size:14px;color:#505a5f;">Select the document verified through an Identity Document Validation Technology (IDVT) check via an Identity Service Provider (IDSP).</p>
          ${buildDocCheckboxes(IDSP_DOCS)}

          <div class="form-group" style="margin-top:16px;">
            <label for="idsp_provider">IDSP provider name</label>
            <input type="text" id="idsp_provider" name="idsp_provider"
              value="${existing ? esc(existing.idsp_provider || '') : ''}">
          </div>
        </div>

        <!-- Online panel -->
        <div class="method-panel${activeMethod === 'online' ? ' active' : ''}" data-panel="online">
          <div class="form-group">
            <label for="share_code">Share code</label>
            <span class="hint">The share code provided by the employee from the Home Office online service.</span>
            <input type="text" id="share_code" name="share_code"
              value="${existing ? esc(existing.share_code || '') : ''}">
          </div>

          <div class="sub-heading">Online check confirmation</div>
          ${buildDocCheckboxes(ONLINE_CHECKS)}
        </div>
      </div>

      <!-- ========== Section 3: Step 2 - Check ========== -->
      <div class="section">
        <div class="section-title">Step 2 &mdash; Check: Verification Questions</div>
        <p style="margin-bottom:14px;font-size:14px;color:#505a5f;">Answer each question based on the documents obtained in Step 1.</p>
        ${buildVerificationQuestions()}
      </div>

      <!-- ========== Section 4: Step 3 - Copy ========== -->
      <div class="section">
        <div class="section-title">Step 3 &mdash; Copy: Document Scan Upload</div>
        <p style="margin-bottom:14px;font-size:14px;color:#505a5f;">Upload a clear copy of the document(s) checked. Accepted formats: JPEG, PNG or PDF.</p>

        <input type="file" id="file-input" accept="image/jpeg,image/png,application/pdf" style="display:none;">

        <div class="upload-area" id="upload-area">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>
          <p id="upload-label">Click or drag a file here to upload</p>
        </div>
        <div class="image-preview" id="image-preview"></div>
        ${existing && existing.document_scan_path ? `<p style="margin-top:8px;font-size:13px;color:#505a5f;">A document scan is already on file. Uploading a new file will replace it.</p>` : ''}
      </div>

      <!-- ========== Section 5: Declaration & Notes ========== -->
      <div class="section">
        <div class="section-title">Declaration &amp; Notes</div>

        <div class="declaration-box">
          <p>I confirm that I have carried out the right to work check in compliance with Home Office instructions and believe a valid statutory excuse is established.</p>
          <label>
            <input type="checkbox" id="declaration_confirmed" name="declaration_confirmed"
              ${(existing && existing.declaration_confirmed) ? 'checked' : ''}>
            I agree to the above declaration
          </label>
        </div>

        <div class="form-group">
          <label for="checker_name">Name of person conducting the check</label>
          <input type="text" id="checker_name" name="checker_name" required
            value="${existing ? esc(existing.checker_name || '') : ''}">
        </div>

        <div class="form-group">
          <label for="additional_notes">Additional notes <span style="font-weight:400;color:#505a5f;">(optional)</span></label>
          <textarea id="additional_notes" name="additional_notes" rows="4">${existing ? esc(existing.additional_notes || '') : ''}</textarea>
        </div>

        <div class="retention-notice">
          <strong>Retention:</strong> Right to work check records must be retained for the duration of the worker&rsquo;s employment and for two years after their employment ends, in accordance with Home Office guidance.
        </div>

        <div class="btn-group">
          <button type="submit" class="btn btn-primary" id="save-btn">
            ${isEdit ? 'Update record' : 'Save record'}
          </button>
          <a href="${isEdit ? `#/record/${recordId}` : '#/'}" class="btn btn-secondary">Cancel</a>
        </div>
      </div>

    </form>
  `;

  /* ---------------------------------------------------------------- */
  /*  Pre-fill checkboxes and radio buttons from existing record      */
  /* ---------------------------------------------------------------- */

  if (existing) {
    // Restore checked document checkboxes
    checkedDocs.forEach(docId => {
      const cb = el.querySelector(`#${CSS.escape(docId)}`);
      if (cb) cb.checked = true;
    });

    // Restore verification answers
    Object.entries(verAnswers).forEach(([key, value]) => {
      const radio = el.querySelector(`input[name="${key}"][value="${value}"]`);
      if (radio) radio.checked = true;
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Tab switching                                                   */
  /* ---------------------------------------------------------------- */

  const tabs = el.querySelectorAll('.method-tab');
  const panels = el.querySelectorAll('.method-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      el.querySelector(`[data-panel="${target}"]`).classList.add('active');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  File upload                                                     */
  /* ---------------------------------------------------------------- */

  const fileInput = el.querySelector('#file-input');
  const uploadArea = el.querySelector('#upload-area');
  const uploadLabel = el.querySelector('#upload-label');
  const imagePreview = el.querySelector('#image-preview');
  let selectedFile = null;

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = 'var(--ho-blue)';
    uploadArea.style.background = '#e8f0fe';
  });

  uploadArea.addEventListener('dragleave', () => {
    if (!selectedFile) {
      uploadArea.style.borderColor = '';
      uploadArea.style.background = '';
    }
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '';
    uploadArea.style.background = '';
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
    }
  });

  function handleFile(file) {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      uploadLabel.textContent = 'Unsupported file type. Please select a JPEG, PNG or PDF.';
      selectedFile = null;
      uploadArea.classList.remove('has-file');
      imagePreview.innerHTML = '';
      return;
    }

    selectedFile = file;
    uploadLabel.innerHTML = `<span class="filename">${esc(file.name)}</span>`;
    uploadArea.classList.add('has-file');
    imagePreview.innerHTML = '';

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        imagePreview.innerHTML = `<img src="${e.target.result}" alt="Document preview">`;
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'application/pdf') {
      renderPdfPreview(file);
    }
  }

  async function renderPdfPreview(file) {
    if (typeof pdfjsLib === 'undefined') {
      imagePreview.innerHTML = '<p style="font-size:13px;color:#505a5f;">PDF preview unavailable &mdash; pdf.js not loaded.</p>';
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const scale = 1.2;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      imagePreview.innerHTML = '';
      imagePreview.appendChild(canvas);
      canvas.style.maxWidth = '100%';
      canvas.style.maxHeight = '250px';
      canvas.style.border = '1px solid var(--ho-border)';
    } catch (err) {
      imagePreview.innerHTML = '<p style="font-size:13px;color:#505a5f;">Could not render PDF preview.</p>';
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Form submission                                                 */
  /* ---------------------------------------------------------------- */

  const form = el.querySelector('#rtw-form');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const saveBtn = el.querySelector('#save-btn');
    const errorSummary = el.querySelector('#error-summary');
    const errorList = el.querySelector('#error-list');

    // Determine active check method
    const activeTab = el.querySelector('.method-tab.active');
    const checkMethod = activeTab ? activeTab.getAttribute('data-tab') : 'manual';

    // Collect checked document IDs from the active panel only
    const activePanel = el.querySelector(`.method-panel[data-panel="${checkMethod}"]`);
    const documentsChecked = [];
    if (activePanel) {
      activePanel.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        documentsChecked.push(cb.value);
      });
    }

    // Collect verification answers
    const verificationAnswers = {};
    QUESTIONS.forEach(q => {
      const selected = el.querySelector(`input[name="${q.key}"]:checked`);
      verificationAnswers[q.key] = selected ? selected.value : null;
    });

    // Build the record data object
    const data = {
      person_name: el.querySelector('#person_name').value.trim(),
      date_of_birth: el.querySelector('#date_of_birth').value || null,
      check_date: el.querySelector('#check_date').value || null,
      check_type: el.querySelector('input[name="check_type"]:checked')?.value || null,
      check_method: checkMethod,
      expiry_date: el.querySelector('#expiry_date').value || null,
      follow_up_date: el.querySelector('#follow_up_date').value || null,
      documents_checked: documentsChecked,
      share_code: checkMethod === 'online' ? (el.querySelector('#share_code').value.trim() || null) : null,
      idsp_provider: checkMethod === 'idsp' ? (el.querySelector('#idsp_provider').value.trim() || null) : null,
      verification_answers: verificationAnswers,
      declaration_confirmed: el.querySelector('#declaration_confirmed').checked,
      checker_name: el.querySelector('#checker_name').value.trim(),
      additional_notes: el.querySelector('#additional_notes').value.trim() || null,
    };

    // Calculate status
    data.status = calculateStatus(data);

    // Validate
    const errors = validateRecord(data);
    if (errors.length > 0) {
      errorList.innerHTML = errors.map(msg => `<li>${esc(msg)}</li>`).join('');
      errorSummary.style.display = 'block';
      errorSummary.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // Hide previous errors
    errorSummary.style.display = 'none';
    errorList.innerHTML = '';

    // Disable button while saving
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving\u2026';

    try {
      let record;

      if (isEdit) {
        // Update existing record
        record = await updateRecord(recordId, data);

        // Upload new file if selected
        if (selectedFile) {
          const scanPath = await uploadDocumentScan(record.id, selectedFile);
          await updateRecord(record.id, {
            document_scan_path: scanPath,
            document_scan_filename: selectedFile.name,
          });
        }
      } else {
        // Create new record
        record = await createRecord(data);

        // Upload file if selected, then update record with scan path
        if (selectedFile) {
          const scanPath = await uploadDocumentScan(record.id, selectedFile);
          await updateRecord(record.id, {
            document_scan_path: scanPath,
            document_scan_filename: selectedFile.name,
          });
        }
      }

      // Navigate to the record detail view
      window.location.hash = `#/record/${record.id}`;
    } catch (err) {
      errorList.innerHTML = `<li>${esc(err.message)}</li>`;
      errorSummary.style.display = 'block';
      errorSummary.scrollIntoView({ behavior: 'smooth', block: 'start' });
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Update record' : 'Save record';
    }
  });
}

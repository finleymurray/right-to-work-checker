import { formatDateUK } from './date-utils.js';
import { getDocumentLabels, METHOD_LABELS, STEP2_QUESTIONS } from './document-labels.js';
import { LOGO_WHITE_B64, LOGO_DARK_B64 } from './logo-data.js';

/**
 * Build the jsPDF document for a given RTW record.
 * @param {Object} record - The record object from Supabase
 * @param {string|null} scanDataUrl - Base64 data URL of the document scan, or null
 * @returns {Object|null} jsPDF document instance, or null if library not loaded
 */
function buildPDFDoc(record, scanDataUrl) {
  if (typeof window.jspdf === 'undefined') {
    return null;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const ml = 18;
  const mr = 18;
  const cw = pw - ml - mr;
  let y = 18;

  // Colours
  const blue = [29, 79, 145];
  const dark = [11, 12, 12];
  const grey = [80, 90, 95];
  const lightBg = [243, 242, 241];

  // -------- Helpers --------
  function drawLine(yPos) {
    doc.setDrawColor(...grey);
    doc.setLineWidth(0.3);
    doc.line(ml, yPos, pw - mr, yPos);
  }

  function addFooter() {
    doc.setFontSize(7.5);
    doc.setTextColor(...grey);
    doc.text(
      'This record must be retained for the duration of employment plus 2 years and then securely destroyed.',
      pw / 2, ph - 10, { align: 'center' }
    );
    doc.text('ImmersiveCore RTW Checker | Generated: ' + new Date().toLocaleString('en-GB'), pw / 2, ph - 6, { align: 'center' });
  }

  function checkPageBreak(needed) {
    if (y + needed > ph - 20) {
      addFooter();
      doc.addPage();
      y = 18;
    }
  }

  const valCol = ml + 75;
  const lineH = 7;

  function labelVal(label, val, yOff, labelX, valX) {
    labelX = labelX || (ml + 5);
    valX = valX || valCol;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(label, labelX, yOff);
    doc.setFont('helvetica', 'normal');
    doc.text(val || '\u2014', valX, yOff);
  }

  // -------- Logo helper --------
  function drawLogo(x, yPos, onDark) {
    const logoData = onDark ? LOGO_WHITE_B64 : LOGO_DARK_B64;
    const logoH = 14;
    const logoW = 14; // square logo
    doc.addImage(logoData, 'PNG', x, yPos - 4, logoW, logoH);
  }

  // ======== PAGE 1 ========

  // Blue header bar
  doc.setFillColor(...blue);
  doc.rect(0, 0, pw, 26, 'F');

  // Logo in header (white on blue)
  drawLogo(ml, 8, true);

  // Title text
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text('Right to Work Checklist', ml + 55, 10);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('UK Employer Compliance Record', ml + 55, 17);
  y = 34;

  // ---- Details box ----
  let rowCount = 5;
  if (record.expiry_date) rowCount++;
  if (record.follow_up_date) rowCount++;
  if (record.employment_end_date) rowCount++;
  if (record.deletion_due_date) rowCount++;
  const boxH = 10 + (rowCount * lineH);

  doc.setFillColor(...lightBg);
  doc.roundedRect(ml, y, cw, boxH, 2, 2, 'F');
  doc.setDrawColor(...blue);
  doc.setLineWidth(0.5);
  doc.roundedRect(ml, y, cw, boxH, 2, 2, 'S');

  let by = y + 8;
  doc.setTextColor(...dark);

  labelVal('Name of person:', record.person_name || '', by);
  by += lineH;
  labelVal('Date of birth:', formatDateUK(record.date_of_birth), by);
  by += lineH;
  labelVal('Date of RTW check:', formatDateUK(record.check_date), by);
  by += lineH;
  labelVal('Type of check:', record.check_type || '', by);
  by += lineH;
  labelVal('Method used:', METHOD_LABELS[record.check_method] || record.check_method || '', by);

  if (record.expiry_date) {
    by += lineH;
    labelVal('Permission expiry:', formatDateUK(record.expiry_date), by);
  }
  if (record.follow_up_date) {
    by += lineH;
    labelVal('Follow-up due:', formatDateUK(record.follow_up_date), by);
  }
  if (record.employment_end_date) {
    by += lineH;
    labelVal('Employment end:', formatDateUK(record.employment_end_date), by);
  }
  if (record.deletion_due_date) {
    by += lineH;
    labelVal('Deletion due:', formatDateUK(record.deletion_due_date), by);
  }

  y += boxH + 6;

  // ---- Method-specific fields ----
  if (record.check_method === 'online' && record.share_code) {
    checkPageBreak(12);
    doc.setFontSize(10);
    labelVal('Share code:', record.share_code.toUpperCase(), y, ml, ml + 30);
    y += 8;
  }
  if (record.check_method === 'idsp' && record.idsp_provider) {
    checkPageBreak(12);
    doc.setFontSize(10);
    labelVal('IDSP provider:', record.idsp_provider, y, ml, ml + 30);
    y += 8;
  }

  // ---- Documents ticked ----
  const docIds = Array.isArray(record.documents_checked) ? record.documents_checked : [];
  const docLabels = getDocumentLabels(docIds);
  if (docLabels.length) {
    checkPageBreak(10 + docLabels.length * 6);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...blue);
    doc.text('Documents Obtained (Step 1)', ml, y);
    y += 2;
    drawLine(y);
    y += 5;

    doc.setFontSize(9);
    doc.setTextColor(...dark);
    doc.setFont('helvetica', 'normal');
    docLabels.forEach(d => {
      checkPageBreak(7);
      doc.text('\u2713  ' + d, ml + 2, y);
      y += 5.5;
    });
    y += 3;
  }

  // ---- Step 2 Check Results ----
  checkPageBreak(60);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...blue);
  doc.text('Verification Checks (Step 2)', ml, y);
  y += 2;
  drawLine(y);
  y += 6;

  const verificationAnswers = record.verification_answers || {};
  const shortQuestions = [
    'Photographs consistent with appearance?',
    'Dates of birth consistent across documents?',
    'Expiry dates not passed (if applicable)?',
    'Work restrictions checked?',
    'Document genuine, not tampered, belongs to holder?',
    'Different names across documents checked?',
  ];

  doc.setFontSize(9);
  shortQuestions.forEach((q, i) => {
    checkPageBreak(8);
    const key = 'q' + (i + 1);
    const ans = verificationAnswers[key] || '\u2014';
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...dark);
    doc.text((i + 1) + '. ' + q, ml + 2, y);

    const ansX = pw - mr - 12;
    if (ans === 'Yes') {
      doc.setFillColor(0, 112, 60);
      doc.roundedRect(ansX, y - 3.5, 12, 5, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
    } else if (ans === 'No') {
      doc.setFillColor(212, 53, 28);
      doc.roundedRect(ansX, y - 3.5, 12, 5, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
    } else {
      doc.setFillColor(200, 200, 200);
      doc.roundedRect(ansX, y - 3.5, 12, 5, 1, 1, 'F');
      doc.setTextColor(...dark);
    }
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(ans, ansX + 6, y, { align: 'center' });
    doc.setFontSize(9);
    y += 7;
  });
  y += 4;

  // ---- Declaration ----
  checkPageBreak(35);
  doc.setFillColor(...lightBg);
  doc.roundedRect(ml, y, cw, 28, 2, 2, 'F');
  doc.setDrawColor(...blue);
  doc.setLineWidth(0.8);
  doc.line(ml, y, ml, y + 28);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...blue);
  doc.text('Mandatory Declaration', ml + 5, y + 7);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(...dark);
  const declText = '"I confirm that I have carried out the right to work check in compliance with Home Office instructions and believe a valid statutory excuse is established."';
  const declLines = doc.splitTextToSize(declText, cw - 12);
  doc.text(declLines, ml + 5, y + 13);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Signed by: ' + (record.checker_name || ''), ml + 5, y + 24);
  y += 34;

  // ---- Additional notes ----
  if (record.additional_notes) {
    checkPageBreak(20);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...blue);
    doc.text('Additional Notes', ml, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...dark);
    const noteLines = doc.splitTextToSize(record.additional_notes, cw);
    doc.text(noteLines, ml, y);
    y += noteLines.length * 4.5 + 4;
  }

  addFooter();

  // ======== PAGE 2: Document Scan ========
  doc.addPage();
  y = 18;

  doc.setFillColor(...blue);
  doc.rect(0, 0, pw, 20, 'F');

  drawLogo(ml, 6, true);

  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text('Document Scan', ml + 55, 10);
  y = 28;

  doc.setFontSize(9);
  doc.setTextColor(...dark);
  doc.setFont('helvetica', 'normal');
  labelVal('Name of person:', record.person_name || '', y, ml, ml + 40);
  y += 6;
  labelVal('Check date:', formatDateUK(record.check_date), y, ml, ml + 40);
  y += 8;
  drawLine(y);
  y += 6;

  if (scanDataUrl) {
    try {
      const imgProps = doc.getImageProperties(scanDataUrl);
      const maxW = cw;
      const maxH = ph - y - 25;
      let imgW = imgProps.width;
      let imgH = imgProps.height;
      const scale = Math.min(maxW / imgW, maxH / imgH, 1);
      imgW *= scale;
      imgH *= scale;
      const imgX = ml + (cw - imgW) / 2;
      doc.addImage(scanDataUrl, 'JPEG', imgX, y, imgW, imgH);
      y += imgH + 5;
    } catch (err) {
      doc.setFontSize(10);
      doc.setTextColor(212, 53, 28);
      doc.text('Error embedding image: ' + err.message, ml, y);
      y += 8;
    }
  } else {
    doc.setFontSize(10);
    doc.setTextColor(...grey);
    doc.text('No document scan was uploaded.', ml, y);
    y += 8;
  }

  if (record.document_scan_filename) {
    doc.setFontSize(7.5);
    doc.setTextColor(...grey);
    doc.text('Source file: ' + record.document_scan_filename, ml, y);
  }

  addFooter();

  return doc;
}

/**
 * Generate and download a compliance PDF for a given RTW record.
 * @param {Object} record - The record object from Supabase
 * @param {string|null} scanDataUrl - Base64 data URL of the document scan, or null
 */
export function generatePDF(record, scanDataUrl) {
  const doc = buildPDFDoc(record, scanDataUrl);
  if (!doc) {
    alert('PDF library failed to load. Please check your internet connection and refresh the page.');
    return;
  }
  const safeName = (record.person_name || 'record').replace(/[^a-zA-Z0-9]/g, '_');
  const dateStr = (record.check_date || '').replace(/-/g, '');
  doc.save('RTW_Record_' + safeName + '_' + dateStr + '.pdf');
}

/**
 * Generate a compliance PDF and return it as a Blob (for bulk export).
 * @param {Object} record - The record object from Supabase
 * @param {string|null} scanDataUrl - Base64 data URL of the document scan, or null
 * @returns {Blob|null} PDF blob, or null if library not loaded
 */
export function generatePDFBlob(record, scanDataUrl) {
  const doc = buildPDFDoc(record, scanDataUrl);
  if (!doc) return null;
  return doc.output('blob');
}

/**
 * Fetch scan as base64 data URL for PDF embedding.
 * Handles both images and PDFs (renders PDF page 1 via pdf.js).
 */
export async function fetchScanAsDataUrl(signedUrl, filename) {
  if (!signedUrl) return null;

  const response = await fetch(signedUrl);
  const blob = await response.blob();

  if (filename && filename.toLowerCase().endsWith('.pdf')) {
    // Render PDF page 1 to canvas
    const arrayBuffer = await blob.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument(typedArray).promise;
    const page = await pdf.getPage(1);
    const scale = 2.5;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
  } else {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

import { getSupabase } from '../supabase-client.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';

/**
 * Upload a file to Google Drive via the gdrive-upload Edge Function.
 * Creates an employee folder and optional subfolder automatically.
 *
 * @param {Object} params
 * @param {string} params.employeeName - Employee name (used as folder name)
 * @param {string} params.fileName - File name (e.g. "RTW_Record_John_Smith_20250101.pdf")
 * @param {string} params.fileBase64 - Base64-encoded file content
 * @param {string} [params.mimeType] - MIME type (default: application/pdf)
 * @param {string} [params.subfolder] - Subfolder inside employee folder (e.g. "Right to Work")
 * @param {string} [params.sourceApp] - Source app identifier (default: rtw-checker)
 * @returns {Promise<Object>} { success, file_id, web_view_link, employee_folder_id }
 */
async function callEdgeFunction(payload) {
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/gdrive-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Google Drive operation failed');
  return body;
}

export async function uploadToGoogleDrive({ employeeName, fileName, fileBase64, mimeType, subfolder, sourceApp }) {
  return callEdgeFunction({
    action: 'upload',
    employee_name: employeeName,
    file_name: fileName,
    file_base64: fileBase64,
    mime_type: mimeType || 'application/pdf',
    subfolder: subfolder || 'Right to Work',
    source_app: sourceApp || 'rtw-checker',
  });
}

export async function replaceFileInGoogleDrive({ oldFileId, employeeName, fileName, fileBase64, mimeType, subfolder, sourceApp }) {
  return callEdgeFunction({
    action: 'replace',
    old_file_id: oldFileId,
    employee_name: employeeName,
    file_name: fileName,
    file_base64: fileBase64,
    mime_type: mimeType || 'application/pdf',
    subfolder: subfolder || 'Right to Work',
    source_app: sourceApp || 'rtw-checker',
  });
}

export async function deleteFileFromGoogleDrive(fileId) {
  return callEdgeFunction({ action: 'delete_file', file_id: fileId });
}

export async function deleteFolderFromGoogleDrive(folderId) {
  return callEdgeFunction({ action: 'delete_folder', folder_id: folderId });
}

import { getSupabase } from '../supabase-client.js';

const BUCKET = 'document-scans';

export async function uploadDocumentScan(recordId, file) {
  const path = `${recordId}/${file.name}`;
  const { error } = await getSupabase()
    .storage
    .from(BUCKET)
    .upload(path, file, { upsert: true });
  if (error) throw new Error('Failed to upload document scan: ' + error.message);
  return path;
}

export async function getDocumentScanUrl(scanPath) {
  if (!scanPath) return null;
  const { data, error } = await getSupabase()
    .storage
    .from(BUCKET)
    .createSignedUrl(scanPath, 300); // 5 minutes
  if (error) throw new Error('Failed to get document URL: ' + error.message);
  return data?.signedUrl || null;
}

export async function deleteDocumentScan(scanPath) {
  if (!scanPath) return;
  const { error } = await getSupabase()
    .storage
    .from(BUCKET)
    .remove([scanPath]);
  if (error) throw new Error('Failed to delete document scan: ' + error.message);
}

export async function deleteRecordScans(recordId) {
  // List all files in the record's folder and delete them
  const { data: files } = await getSupabase()
    .storage
    .from(BUCKET)
    .list(recordId);
  if (files && files.length > 0) {
    const paths = files.map(f => `${recordId}/${f.name}`);
    await getSupabase()
      .storage
      .from(BUCKET)
      .remove(paths);
  }
}

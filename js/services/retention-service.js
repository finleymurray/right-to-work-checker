import { getSupabase } from '../supabase-client.js';
import { deleteRecord } from './records-service.js';
import { deleteRecordScans } from './storage-service.js';
import { getUser, getUserProfile } from './auth-service.js';

/**
 * Fetch all deleted records (managers only — RLS enforced).
 */
export async function fetchDeletedRecords() {
  const { data, error } = await getSupabase()
    .from('deleted_records')
    .select('*')
    .order('deleted_at', { ascending: false });
  if (error) throw new Error('Failed to fetch deleted records: ' + error.message);
  return data || [];
}

/**
 * Log a record deletion in the deleted_records table before actually deleting it.
 * This creates the GDPR-compliant audit trail.
 */
export async function logRecordDeletion(record, userId, userEmail) {
  const entry = {
    original_record_id: record.id,
    person_name: record.person_name,
    employment_start_date: record.check_date || null,
    employment_end_date: record.employment_end_date || null,
    deletion_due_date: record.deletion_due_date || null,
    deleted_by: userId,
    deleted_by_email: userEmail,
    reason: record.deletion_due_date ? 'GDPR retention period expired' : 'Manual deletion by manager',
  };

  const { error } = await getSupabase()
    .from('deleted_records')
    .insert([entry]);
  if (error) throw new Error('Failed to log record deletion: ' + error.message);
}

/**
 * Fetch records that are past their deletion due date.
 */
export async function fetchRecordsPendingDeletion() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await getSupabase()
    .from('rtw_records')
    .select('*')
    .not('deletion_due_date', 'is', null)
    .lte('deletion_due_date', today)
    .order('deletion_due_date', { ascending: true });
  if (error) throw new Error('Failed to fetch records pending deletion: ' + error.message);
  return data || [];
}

/**
 * Auto-delete all records past their retention period.
 * Logs each deletion, removes scans, then deletes the record.
 * Returns { deleted: [...names], errors: [...messages] }.
 */
export async function autoDeleteExpiredRecords() {
  const results = { deleted: [], errors: [] };

  let records;
  try {
    records = await fetchRecordsPendingDeletion();
  } catch (err) {
    results.errors.push(err.message);
    return results;
  }

  if (records.length === 0) return results;

  let userId, userEmail;
  try {
    const user = await getUser();
    const profile = await getUserProfile();
    userId = user.id;
    userEmail = profile?.email || user.email;
  } catch (err) {
    results.errors.push('Could not identify current user: ' + err.message);
    return results;
  }

  for (const record of records) {
    try {
      await logRecordDeletion(record, userId, userEmail);
      await deleteRecordScans(record.id);
      await deleteRecord(record.id);
      results.deleted.push(record.person_name);
    } catch (err) {
      results.errors.push(`${record.person_name}: ${err.message}`);
    }
  }

  return results;
}

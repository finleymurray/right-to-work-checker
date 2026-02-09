import { getSupabase } from '../supabase-client.js';

export async function fetchAllRecords() {
  const { data, error } = await getSupabase()
    .from('rtw_records')
    .select('*')
    .order('check_date', { ascending: false });
  if (error) throw new Error('Failed to fetch records: ' + error.message);
  return data || [];
}

export async function fetchRecord(id) {
  const { data, error } = await getSupabase()
    .from('rtw_records')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Failed to fetch record: ' + error.message);
  if (!data) throw new Error('Record not found');
  return data;
}

export async function createRecord(record) {
  const { data, error } = await getSupabase()
    .from('rtw_records')
    .insert([record])
    .select();
  if (error) throw new Error('Failed to create record: ' + error.message);
  if (data && data.length > 0) return data[0];
  // Fallback: fetch the most recent record matching person_name + check_date
  const { data: fallback, error: fbErr } = await getSupabase()
    .from('rtw_records')
    .select('*')
    .eq('person_name', record.person_name)
    .eq('check_date', record.check_date)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fbErr) throw new Error('Failed to create record: ' + fbErr.message);
  return fallback;
}

export async function updateRecord(id, updates) {
  const { data, error } = await getSupabase()
    .from('rtw_records')
    .update(updates)
    .eq('id', id)
    .select();
  if (error) throw new Error('Failed to update record: ' + error.message);
  if (data && data.length > 0) return data[0];
  // Fallback: fetch the record directly
  return fetchRecord(id);
}

export async function deleteRecord(id) {
  const { error } = await getSupabase()
    .from('rtw_records')
    .delete()
    .eq('id', id);
  if (error) throw new Error('Failed to delete record: ' + error.message);
}

export async function batchUpdateStatuses(updates) {
  // updates: [{ id, status }]
  for (const u of updates) {
    await getSupabase()
      .from('rtw_records')
      .update({ status: u.status })
      .eq('id', u.id);
  }
}

/**
 * Mark the linked onboarding record as complete when the RTW check is done.
 */
export async function completeOnboardingRecord(onboardingId) {
  const { error } = await getSupabase()
    .from('onboarding_records')
    .update({ status: 'complete', updated_at: new Date().toISOString() })
    .eq('id', onboardingId);
  if (error) throw new Error('Failed to update onboarding record: ' + error.message);
}

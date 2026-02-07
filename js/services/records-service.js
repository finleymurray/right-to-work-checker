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
    .single();
  if (error) throw new Error('Failed to fetch record: ' + error.message);
  return data;
}

export async function createRecord(record) {
  const { data, error } = await getSupabase()
    .from('rtw_records')
    .insert([record])
    .select()
    .single();
  if (error) throw new Error('Failed to create record: ' + error.message);
  return data;
}

export async function updateRecord(id, updates) {
  const { data, error } = await getSupabase()
    .from('rtw_records')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error('Failed to update record: ' + error.message);
  return data;
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

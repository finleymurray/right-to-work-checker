import { getSupabase } from '../supabase-client.js';

/**
 * Fetch audit log entries with optional filters.
 * Only managers can read audit_log (RLS enforced).
 */
export async function fetchAuditLog({ action, userId, dateFrom, dateTo, limit } = {}) {
  const sb = getSupabase();
  let query = sb
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false });

  if (action) query = query.eq('action', action);
  if (userId) query = query.eq('user_id', userId);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59');
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Fetch login/logout history.
 */
export async function fetchLoginHistory({ limit } = {}) {
  const sb = getSupabase();
  let query = sb
    .from('audit_log')
    .select('*')
    .in('action', ['login', 'logout'])
    .order('created_at', { ascending: false });

  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

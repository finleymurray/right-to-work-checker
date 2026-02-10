import { getSupabase } from '../supabase-client.js';
import { clearSharedRefreshToken } from '../shared-auth-cookie.js';

let cachedProfile = null;

/**
 * Sign in with email and password.
 */
export async function signIn(email, password) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;

  cachedProfile = null;

  // Log login event
  await logAuditEvent('login');

  return data;
}

/**
 * Sign out the current user.
 */
export async function signOut() {
  const sb = getSupabase();
  await logAuditEvent('logout');
  cachedProfile = null;
  clearSharedRefreshToken();
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

/**
 * Get the current session (null if not logged in).
 */
export async function getSession() {
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

/**
 * Get the current auth user (null if not logged in).
 */
export async function getUser() {
  const session = await getSession();
  return session?.user || null;
}

/**
 * Fetch the current user's profile from the profiles table.
 * Result is cached until sign-out or explicit clear.
 */
export async function getUserProfile() {
  if (cachedProfile) return cachedProfile;

  const user = await getUser();
  if (!user) return null;

  const sb = getSupabase();
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  cachedProfile = data;
  return data;
}

/**
 * Clear the cached profile (call on auth state changes).
 */
export function clearProfileCache() {
  cachedProfile = null;
}

/**
 * Check whether the current user has the 'manager' role.
 */
export async function isManager() {
  const profile = await getUserProfile();
  return profile?.role === 'manager';
}

/**
 * Subscribe to auth state changes.
 * @param {Function} callback - Called with (event, session)
 * @returns {Object} subscription - Call subscription.unsubscribe() to stop.
 */
export function onAuthStateChange(callback) {
  const sb = getSupabase();
  const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      cachedProfile = null;
    }
    callback(event, session);
  });
  return subscription;
}

/**
 * Insert an audit log entry for auth events (login/logout) or other auditable actions.
 * @param {string} action - The action name (e.g. 'login', 'logout', 'export_excel', 'export_pdf')
 * @param {Object} [extra] - Optional extra fields (table_name, record_id, new_values)
 */
export async function logAuditEvent(action, extra = {}) {
  try {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    await sb.from('audit_log').insert({
      user_id: user.id,
      user_email: user.email,
      action,
      ...extra,
    });
  } catch (err) {
    // Don't let audit failures break auth flow
    console.error('Audit log error:', err);
  }
}

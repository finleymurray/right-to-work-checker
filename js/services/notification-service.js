import { getSupabase } from '../supabase-client.js';

/**
 * Create a notification visible on the immersivecore.network landing page.
 *
 * @param {Object} params
 * @param {string} params.title - Short title
 * @param {string} params.message - Notification body text
 * @param {string} [params.severity] - 'info' | 'warning' | 'urgent'
 * @param {string} [params.actionUrl] - Link to action (e.g. record detail page)
 * @param {string} [params.recordId] - Related record ID
 * @param {string} [params.sourceApp] - Source app (default: rtw-checker)
 */
export async function createNotification({ title, message, severity, actionUrl, recordId, sourceApp }) {
  const { error } = await getSupabase()
    .from('notifications')
    .insert([{
      title,
      message,
      severity: severity || 'info',
      action_url: actionUrl || null,
      record_id: recordId || null,
      source_app: sourceApp || 'rtw-checker',
    }]);
  if (error) {
    console.error('Failed to create notification:', error);
  }
}

/**
 * Fetch all active (undismissed) notifications.
 * Used by the landing page to display pending items.
 */
export async function fetchActiveNotifications() {
  const { data, error } = await getSupabase()
    .from('notifications')
    .select('*')
    .is('dismissed_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error('Failed to fetch notifications: ' + error.message);
  return data || [];
}

/**
 * Dismiss a notification.
 */
export async function dismissNotification(notificationId) {
  const { error } = await getSupabase()
    .from('notifications')
    .update({
      dismissed_at: new Date().toISOString(),
    })
    .eq('id', notificationId);
  if (error) throw new Error('Failed to dismiss notification: ' + error.message);
}

/**
 * Dismiss all undismissed notifications for a given record.
 */
export async function dismissNotificationsForRecord(recordId) {
  const { error } = await getSupabase()
    .from('notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('record_id', recordId)
    .is('dismissed_at', null);
  if (error) {
    console.error('Failed to dismiss notifications for record:', error);
  }
}

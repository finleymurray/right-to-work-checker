import { batchUpdateStatuses } from './records-service.js';

export function calculateStatus(record) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if expiry date has passed
  if (record.expiry_date) {
    const expiry = new Date(record.expiry_date + 'T00:00:00');
    if (expiry < today) {
      return 'expired';
    }
  }

  // Check if follow-up date has passed
  if (record.follow_up_date) {
    const followUp = new Date(record.follow_up_date + 'T00:00:00');
    if (followUp < today) {
      return 'follow_up_overdue';
    }
    // Check if follow-up is due within 28 days
    const warningDate = new Date(today);
    warningDate.setDate(warningDate.getDate() + 28);
    if (followUp <= warningDate) {
      return 'follow_up_due';
    }
  }

  // Check if expiry is approaching within 28 days
  if (record.expiry_date) {
    const expiry = new Date(record.expiry_date + 'T00:00:00');
    const warningDate = new Date(today);
    warningDate.setDate(warningDate.getDate() + 28);
    if (expiry <= warningDate) {
      return 'follow_up_due';
    }
  }

  return 'valid';
}

export async function refreshStatuses(records) {
  const updates = [];
  for (const record of records) {
    const newStatus = calculateStatus(record);
    if (newStatus !== record.status) {
      record.status = newStatus;
      updates.push({ id: record.id, status: newStatus });
    }
  }
  if (updates.length > 0) {
    await batchUpdateStatuses(updates);
  }
  return records;
}

export const STATUS_LABELS = {
  valid: 'Valid',
  follow_up_due: 'Follow-up due',
  expired: 'Expired',
  follow_up_overdue: 'Overdue',
};

export const STATUS_CLASSES = {
  valid: 'badge-valid',
  follow_up_due: 'badge-follow-up-due',
  expired: 'badge-expired',
  follow_up_overdue: 'badge-overdue',
};

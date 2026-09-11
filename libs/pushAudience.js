import { createHash } from 'node:crypto';

export const recipientId = record => createHash('sha256')
  .update(record.user_id ? `user:${record.user_id}` : `device:${record.installation_id || record.suitId}`)
  .digest('hex');

export const buildRecipients = records => {
  const recipients = new Map();
  for (const record of records) {
    const id = recipientId(record);
    const item = recipients.get(id) || { id, label: record.user_email || (record.user_id ? `Customer ${record.user_id.slice(-8)}` : `Guest device ${id.slice(0, 8)}`), devices: 0 };
    item.devices++;
    recipients.set(id, item);
  }
  return [...recipients.values()].sort((a, b) => a.label.localeCompare(b.label));
};

export const parseAudience = value => {
  if (!value || !['all', 'selected'].includes(value.mode)) throw new Error('Choose all recipients or selected recipients.');
  if (value.mode === 'all') return { mode: 'all' };
  if (!Array.isArray(value.recipientIds) || !value.recipientIds.length || value.recipientIds.length > 1000 || value.recipientIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) {
    throw new Error('Select at least one valid recipient (maximum 1000).');
  }
  return { mode: 'selected', recipientIds: [...new Set(value.recipientIds)] };
};

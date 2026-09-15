import { randomUUID } from 'node:crypto';
import { GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from './awsClient.js';
import { isPushConfigured, sendPushNotification } from './pushNotificationService.js';
import { voucherMessage } from './catalogNotifications.js';

// Durable outbox: catalog writes and queued alerts commit together. A lease
// prevents two Render processes from sending the same queued job concurrently.
export const createAutomaticNotificationWorker = ({
  db = ddbDocClient, send = sendPushNotification, configured = isPushConfigured,
  now = Date.now, table = () => process.env.AWS_DYNAMODB_TABLE_NAME,
} = {}) => {
  let running = false;
  const update = (record, token, values) => db.send(new UpdateCommand({
    TableName: table(), Key: { suitId: record.suitId },
    ConditionExpression: 'lease_token = :token',
    UpdateExpression: `SET ${Object.keys(values).map((key, i) => `#f${i} = :v${i}`).join(', ')}`,
    ExpressionAttributeNames: Object.fromEntries(Object.keys(values).map((key, i) => [`#f${i}`, key])),
    ExpressionAttributeValues: { ':token': token, ...Object.fromEntries(Object.values(values).map((value, i) => [`:v${i}`, value])) },
  }));

  const process = async record => {
    const token = randomUUID();
    try {
      await db.send(new UpdateCommand({
        TableName: table(), Key: { suitId: record.suitId },
        ConditionExpression: '(#status = :pending AND next_attempt_at <= :now) OR (#status = :sending AND lease_until <= :now)',
        UpdateExpression: 'SET #status = :sending, lease_token = :token, lease_until = :until',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':pending': 'pending', ':sending': 'sending', ':now': now(), ':token': token, ':until': now() + 900000 },
      }));
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return;
      throw error;
    }
    const attempts = (record.attempts || 0) + 1;
    try {
      let active = record.expires_at_ms > now();
      if (active && record.source === 'voucher_launched') {
        const { Item } = await db.send(new GetCommand({ TableName: table(), Key: { suitId: record.source_ids[0] }, ConsistentRead: true }));
        active = Boolean(Item && Item.updated_at === record.source_updated_at && voucherMessage(Item, now()));
      }
      if (!active) {
        await update(record, token, { status: 'skipped', reason: 'expired_or_changed', attempts });
        return;
      }
      const delivery = await send({ ...record, audience: record.retry_subscription_ids
        ? { subscriptionIds: record.retry_subscription_ids } : record.audience });
      const retry = delivery.retrySubscriptionIds || [];
      const retrying = (!delivery.configured || retry.length > 0) && attempts < 5;
      const permanentFailures = (record.permanent_failures || 0) + Math.max(0, (delivery.failed || 0) - retry.length);
      await update(record, token, {
        status: retrying ? 'pending' : (!delivery.configured || delivery.failed > 0 || permanentFailures > 0 ? 'partial' : 'sent'),
        attempts, next_attempt_at: now() + Math.min(900000, 30000 * 2 ** attempts),
        permanent_failures: permanentFailures,
        retry_subscription_ids: retry.length ? retry : (record.retry_subscription_ids || null),
        delivery: {
          configured: delivery.configured,
          sent: (record.delivery?.sent || 0) + (delivery.sent || 0),
          failed: permanentFailures + retry.length,
        },
        processed_at: new Date(now()).toISOString(),
      });
    } catch (error) {
      console.error('Automatic notification job failed:', error.name || 'Error');
      // A process crash after push acceptance can cause redelivery. Stable tags
      // replace that alert on the device; this is not an exactly-once transport.
      await update(record, token, {
        status: attempts < 5 ? 'pending' : 'failed', attempts,
        next_attempt_at: now() + Math.min(900000, 30000 * 2 ** attempts),
      });
    }
  };

  return async () => {
    if (running || !configured()) return;
    running = true;
    try {
      let ExclusiveStartKey;
      do {
        const page = await db.send(new ScanCommand({
          TableName: table(), ExclusiveStartKey,
          FilterExpression: '#type = :type AND ((#status = :pending AND next_attempt_at <= :now) OR (#status = :sending AND lease_until <= :now))',
          ExpressionAttributeNames: { '#type': 'type', '#status': 'status' },
          ExpressionAttributeValues: { ':type': 'admin_notification', ':pending': 'pending', ':sending': 'sending', ':now': now() },
        }));
        for (const record of page.Items || []) await process(record);
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
    } catch (error) {
      console.error('Automatic notification queue unavailable:', error.name || 'Error');
    } finally { running = false; }
  };
};

export const processAutomaticNotifications = createAutomaticNotificationWorker();
export const startAutomaticNotifications = () => {
  void processAutomaticNotifications();
  const timer = setInterval(() => void processAutomaticNotifications(), 30000);
  timer.unref();
  return timer;
};

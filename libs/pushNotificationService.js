import webpush from 'web-push';
import { DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from './awsClient.js';

const tableName = () => process.env.AWS_DYNAMODB_TABLE_NAME;

export const isPushConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

const configureWebPush = () => {
  if (!isPushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@kamleshsuits.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  return true;
};

const scanAll = async params => {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await ddbDocClient.send(new ScanCommand({ ...params, ExclusiveStartKey }));
    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
};

export const listPushSubscriptions = () => scanAll({
  TableName: tableName(),
  FilterExpression: '#type = :type AND active = :active',
  ExpressionAttributeNames: { '#type': 'type' },
  ExpressionAttributeValues: { ':type': 'push_subscription', ':active': true },
});

export const sendPushNotification = async ({ title, body, url = '/', tag = 'kamlesh-suits', image = '', audience = {} }) => {
  if (!configureWebPush()) return { configured: false, sent: 0, failed: 0 };

  const subscriptions = (await listPushSubscriptions()).filter(subscription => {
    if (audience.userId) return subscription.user_id === audience.userId;
    if (audience.installationId) return subscription.installation_id === audience.installationId;
    return true;
  });
  const payload = JSON.stringify({ title, body, url, tag, image, createdAt: new Date().toISOString() });
  let sent = 0;
  let failed = 0;

  await Promise.all(subscriptions.map(async record => {
    try {
      await webpush.sendNotification(record.subscription, payload, { TTL: 60 * 60 * 24, urgency: 'high' });
      sent += 1;
      await ddbDocClient.send(new UpdateCommand({
        TableName: tableName(),
        Key: { suitId: record.suitId },
        UpdateExpression: 'SET last_notified_at = :now',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      }));
    } catch (error) {
      failed += 1;
      if ([404, 410].includes(error.statusCode)) {
        await ddbDocClient.send(new DeleteCommand({ TableName: tableName(), Key: { suitId: record.suitId } }));
      } else {
        console.error('Push delivery failed:', error.statusCode || error.message);
      }
    }
  }));

  return { configured: true, subscribers: subscriptions.length, sent, failed };
};

const ORDER_MESSAGES = {
  'Awaiting Confirmation': 'We received your order and will contact you shortly.',
  Confirmed: 'Your order is confirmed and is being prepared.',
  Shipped: 'Your Kamlesh Suits order has been shipped.',
  Delivered: 'Your order has been delivered. Thank you for shopping with us!',
  Cancelled: 'Your order has been cancelled. Contact us if you need assistance.',
};

export const sendOrderStatusPush = async order => {
  const guestOrder = String(order.user_id || '').startsWith('GUEST#');
  const target = guestOrder ? order.installation_id : order.user_id;
  if (!target) return { configured: isPushConfigured(), sent: 0, failed: 0, reason: 'no_subscriber_target' };
  try {
    return await sendPushNotification({
      title: `Order ${order.status}`,
      body: `${ORDER_MESSAGES[order.status] || 'Your order status has been updated.'} ${order.orderId}`,
      url: '/track-order',
      tag: `order-${order.orderId}`,
      audience: guestOrder ? { installationId: target } : { userId: target },
    });
  } catch (error) {
    console.error('Order push notification failed:', error.message);
    return { configured: isPushConfigured(), sent: 0, failed: 1, reason: 'delivery_error' };
  }
};

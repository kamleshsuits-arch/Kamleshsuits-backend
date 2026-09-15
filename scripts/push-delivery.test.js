import { test } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { ddbDocClient } from '../libs/awsClient.js';
import { sendPushNotification } from '../libs/pushNotificationService.js';

const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
const subscriptions = ['ok', 'temporary', 'expired'].map(id => ({ suitId: id, active: true, subscription: { endpoint: id } }));

test('paginated recipients, transient retries and expiry cleanup are handled without live sends', async t => {
  const originalSend = ddbDocClient.send;
  const originalPush = webpush.sendNotification;
  t.after(() => { ddbDocClient.send = originalSend; webpush.sendNotification = originalPush; });
  const sentTo = [];
  const deleted = [];
  ddbDocClient.send = async command => {
    if (command.constructor.name === 'ScanCommand') return command.input.ExclusiveStartKey
      ? { Items: subscriptions.slice(1) } : { Items: subscriptions.slice(0, 1), LastEvaluatedKey: { suitId: 'page1' } };
    if (command.constructor.name === 'DeleteCommand') deleted.push(command.input.Key.suitId);
    if (command.constructor.name === 'UpdateCommand') throw new Error('Metadata unavailable');
    return {};
  };
  webpush.sendNotification = async subscription => {
    sentTo.push(subscription.endpoint);
    if (subscription.endpoint === 'temporary') throw Object.assign(new Error('Retry'), { statusCode: 503 });
    if (subscription.endpoint === 'expired') throw Object.assign(new Error('Expired'), { statusCode: 410 });
  };
  const result = await sendPushNotification({ title: 'Test', body: 'Test', audience: { mode: 'all' } });
  assert.deepEqual(sentTo.sort(), ['expired', 'ok', 'temporary']);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 2);
  assert.deepEqual(result.retrySubscriptionIds, ['temporary']);
  assert.deepEqual(deleted, ['expired']);
  sentTo.length = 0;
  await sendPushNotification({ title: 'Test', body: 'Test', audience: { subscriptionIds: ['temporary'] } });
  assert.deepEqual(sentTo, ['temporary']);
});

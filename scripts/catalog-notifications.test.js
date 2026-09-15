import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryMessage, inventoryNotificationWrites, voucherMessage, notificationWrite } from '../libs/catalogNotifications.js';
import { createAutomaticNotificationWorker } from '../libs/automaticNotificationWorker.js';

const now = Date.parse('2026-09-14T10:00:00Z');
const product = { suitId: 'p1', title: 'Ivory Floral Cotton Khat Sheet', stock: 1, price: 390, product_category: 'bed-khat-sheets', product_subcategory: 'Khat Sheet', image: 'https://example.com/khat.jpg' };
const coupon = { suitId: 'COUPON#LINEN20', code: 'LINEN20', discount_type: 'percent', discount: 20, category_ids: ['bed-khat-sheets'], min_purchase: 1000, expires_at: '2026-09-20T18:29:59Z', updated_at: '2026-09-14T09:00:00Z' };

test('new inventory includes category, exact selling price, photo and product link', () => {
  const message = inventoryMessage([product]);
  assert.match(message.title, /Khat Sheet/);
  assert.match(message.body, /₹390/);
  assert.equal(message.url, '/product/p1');
  assert.equal(message.image, product.image);
  assert.equal(inventoryMessage([{ ...product, stock: 0 }]), null);
});

test('bulk imports group designs by category/subcategory, not colour or photo', () => {
  const writes = inventoryNotificationWrites([product, { ...product, suitId: 'p2', price: 380 }, { ...product, suitId: 'p3', product_subcategory: 'Bed Sheet' }], 'batch');
  assert.equal(writes.length, 2);
  assert.match(writes[0].Put.Item.body, /2 new Khat Sheet designs, starting at ₹380/);
  assert.equal(writes[0].Put.Item.url, '/new-arrivals?category=bed-khat-sheets');
  assert.equal(writes[0].Put.ConditionExpression, 'attribute_not_exists(suitId)');
  assert.equal(writes[0].Put.Item.suitId, inventoryNotificationWrites([product], 'batch')[0].Put.Item.suitId);
});

test('voucher messages include offer, code, eligible collections, minimum and expiry', () => {
  const message = voucherMessage(coupon, now);
  for (const expected of ['LINEN20', '20% off', 'Bed & Khat Sheets', '₹1,000', '20 Sept']) assert.ok(message.body.includes(expected), message.body);
  assert.equal(message.url, '/new-arrivals?voucher=LINEN20&category=bed-khat-sheets');
  assert.match(voucherMessage({ ...coupon, discount_type: 'flat', discount: 100, category_ids: [] }, now).body, /₹100 off on all collections/);
  const params = new URLSearchParams(voucherMessage({ ...coupon, category_ids: ['suits', 'blankets'] }, now).url.split('?')[1]);
  assert.deepEqual(params.getAll('category'), ['suits', 'blankets']);
});

test('expired, invalid and exhausted offers never enqueue a launch', () => {
  for (const change of [{ expires_at: '2020-01-01' }, { expires_at: 'invalid' }, { discount: 0 }, { usage_limit: 2, used_count: 2 }]) {
    assert.equal(voucherMessage({ ...coupon, ...change }, now), null);
  }
  assert.equal(notificationWrite(null, 'voucher_launched', 'id', now), null);
});

function harness(record, options = {}) {
  const state = structuredClone(record);
  const pushes = [];
  let currentTime = now;
  const db = { send: async command => {
    const input = command.input;
    if (command.constructor.name === 'ScanCommand') return { Items: state.status === 'pending' && state.next_attempt_at <= currentTime ? [structuredClone(state)] : [] };
    if (command.constructor.name === 'GetCommand') return { Item: options.coupon || coupon };
    if (input.UpdateExpression.includes('lease_token =')) {
      if (options.claimConflict) throw Object.assign(new Error('Claimed'), { name: 'ConditionalCheckFailedException' });
      state.status = 'sending';
      return {};
    }
    for (const [key, name] of Object.entries(input.ExpressionAttributeNames || {})) state[name] = input.ExpressionAttributeValues[`:v${key.slice(2)}`];
    return {};
  } };
  const worker = createAutomaticNotificationWorker({ db, now: () => currentTime, table: () => 'test', configured: () => options.configured !== false,
    send: async payload => { pushes.push(payload); return options.send ? options.send(payload, pushes.length) : { configured: true, sent: 2, failed: 0 }; },
  });
  return { state, pushes, worker, advance: () => { currentTime += 1000000; } };
}
const queued = () => notificationWrite(voucherMessage(coupon, now), 'voucher_launched', 'voucher-event', now).Put.Item;

test('worker delivers once, records history and does not resend completed jobs', async () => {
  const h = harness(queued());
  await h.worker(); await h.worker();
  assert.equal(h.pushes.length, 1);
  assert.equal(h.state.status, 'sent');
  assert.equal(h.state.delivery.sent, 2);
  assert.deepEqual(h.pushes[0].audience, { mode: 'all' });
});

test('temporary failures retry only failed subscriptions, preserving successful counts', async () => {
  const h = harness(queued(), { send: (_, attempt) => attempt === 1
    ? { configured: true, sent: 2, failed: 2, retrySubscriptionIds: ['device-3'] }
    : { configured: true, sent: 1, failed: 0 } });
  await h.worker();
  assert.equal(h.state.status, 'pending');
  h.advance(); await h.worker();
  assert.deepEqual(h.pushes[1].audience, { subscriptionIds: ['device-3'] });
  assert.equal(h.state.delivery.sent, 3);
  assert.equal(h.state.delivery.failed, 1);
  assert.equal(h.state.status, 'partial');
});

test('no pushes without configuration, after a competing claim, or for changed/expired offers', async () => {
  for (const options of [{ configured: false }, { claimConflict: true }, { coupon: { ...coupon, updated_at: 'changed' } }, { coupon: { ...coupon, expires_at: '2020-01-01' } }]) {
    const h = harness(queued(), options); await h.worker(); assert.equal(h.pushes.length, 0);
  }
  const h = harness({ ...queued(), expires_at_ms: now - 1 }); await h.worker();
  assert.equal(h.state.status, 'skipped'); assert.equal(h.pushes.length, 0);
});

test('pre-send service failure remains queued without affecting the saved catalog', async () => {
  const h = harness(queued(), { send: () => { throw new Error('offline'); } });
  await h.worker();
  assert.equal(h.state.status, 'pending');
  assert.equal(h.state.attempts, 1);
});

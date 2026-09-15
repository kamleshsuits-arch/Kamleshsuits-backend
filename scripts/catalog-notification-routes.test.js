import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.COGNITO_USER_POOL_ID = 'ap-south-1_TestPool';
process.env.COGNITO_CLIENT_ID = 'test-client';
const { app } = await import('../server.js');
const { ddbDocClient } = await import('../libs/awsClient.js');
// Never dispatch real pushes or contact AWS in these route-handler tests.
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';

const invoke = async (path, body, mock, method = 'post') => {
  const original = ddbDocClient.send;
  const calls = [];
  ddbDocClient.send = async command => { calls.push(command); return mock ? mock(command) : {}; };
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
  try {
    const route = app._router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    // Exercise the handler after authorization; keep the actual admin guard unchanged.
    await route.stack.at(-1).handle({ body, user: { sub: 'test-admin' } }, response);
    return { calls, response };
  } finally { ddbDocClient.send = original; }
};
const product = { title: 'Test Khat', price: 390, stock: 1, product_category: 'bed-khat-sheets', product_subcategory: 'Khat Sheet' };
const voucher = { code: 'TEST20', discount: 20, type: 'percent', category_ids: ['suits'], expires_at: '2099-01-01' };

test('creating inventory atomically saves product and queued category alert', async () => {
  const { calls, response } = await invoke('/api/admin/products', product);
  assert.equal(response.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].constructor.name, 'TransactWriteCommand');
  const writes = calls[0].input.TransactItems;
  assert.equal(writes.length, 2);
  assert.equal(writes[1].Put.Item.source, 'inventory_added');
  assert.equal(writes[1].Put.Item.source_ids[0], response.data.suitId);
});

test('zero-stock products save without announcing availability', async () => {
  const { calls, response } = await invoke('/api/admin/products', { ...product, stock: 0 });
  assert.equal(response.statusCode, 201);
  assert.equal(calls[0].input.TransactItems.length, 1);
});

test('new vouchers queue once, edits preserve usage and do not send launch alerts', async () => {
  const created = await invoke('/api/admin/coupons', voucher);
  assert.equal(created.response.statusCode, 201);
  assert.equal(created.calls[1].constructor.name, 'TransactWriteCommand');
  assert.equal(created.calls[1].input.TransactItems[1].Put.Item.source, 'voucher_launched');
  const edited = await invoke('/api/admin/coupons', voucher, command => command.constructor.name === 'GetCommand'
    ? { Item: { ...created.response.data, used_count: 3 } } : {});
  assert.equal(edited.calls[1].constructor.name, 'PutCommand');
  assert.equal(edited.response.data.used_count, 3);
});

test('failed voucher lookup cannot be misclassified as a new voucher', async () => {
  const { calls, response } = await invoke('/api/admin/coupons', voucher, () => { throw new Error('Lookup unavailable'); });
  assert.equal(response.statusCode, 503);
  assert.equal(calls.length, 1);
});

test('failed inventory transaction never reports success', async () => {
  const { response, calls } = await invoke('/api/admin/products', product, () => { throw new Error('Transaction failed'); });
  assert.equal(response.statusCode, 500);
  assert.equal(calls.length, 1);
});

test('expired vouchers save but do not announce an unusable offer', async () => {
  const { calls, response } = await invoke('/api/admin/coupons', { ...voucher, expires_at: '2020-01-01' });
  assert.equal(response.statusCode, 201);
  assert.equal(calls[1].input.TransactItems.length, 1);
});

test('notification history growth cannot hide products or vouchers on later database pages', async () => {
  for (const [path, item] of [['/api/products', product], ['/api/coupons', { type: 'coupon', code: 'TEST20' }]]) {
    const { calls, response } = await invoke(path, {}, command => command.input.ExclusiveStartKey
      ? { Items: [item] } : { Items: [], LastEvaluatedKey: { suitId: 'page1' } }, 'get');
    assert.equal(calls.length, 2);
    assert.deepEqual(response.data, [item]);
  }
});

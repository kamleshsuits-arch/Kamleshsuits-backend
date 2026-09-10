import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the actual registered handler with an isolated database boundary.
// No server starts and no customer records or notifications are touched.
const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const start = source.indexOf('app.patch("/api/admin/orders/:orderId/status"');
const end = source.indexOf('// Health Check', start);
assert.ok(start >= 0 && end > start);

for (const status of ['Awaiting Confirmation', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled']) {
  for (const paymentStatus of ['Unpaid', 'Pending', 'Paid', 'Refunded', undefined]) {
    test(`${status} with ${paymentStatus || 'unchanged'} payment`, async () => {
      let handler;
      let input;
      let response;
      const context = {
        app: { patch: (_path, _auth, fn) => { handler = fn; } },
        adminAuth: () => {}, process: { env: { AWS_DYNAMODB_TABLE_NAME: 'test' } },
        console, UpdateCommand: class { constructor(params) { Object.assign(this, params); } },
        ddbDocClient: { send: async command => {
          input = command;
          const [set, remove] = command.UpdateExpression.split(' REMOVE ');
          assert.ok(set.startsWith('SET '));
          if (remove) assert.equal(remove, '#paidAt', 'REMOVE must contain only attribute paths');
          assert.equal(set.includes('#confirmedAt = :confirmedAt'), status === 'Confirmed');
          assert.equal(Boolean(remove), Boolean(paymentStatus && paymentStatus !== 'Paid'));
          assert.equal(set.includes('#paidAt = if_not_exists(#paidAt, :paidAt)'), paymentStatus === 'Paid');
          return { Attributes: { orderId: 'QA', status, paymentStatus } };
        } },
        sendOrderStatusWhatsApp: async () => ({ sent: false }),
        sendOrderStatusPush: async () => ({ sent: 0 }),
      };
      vm.runInNewContext(source.slice(start, end), context);
      await handler({ params: { orderId: 'QA' }, body: { status, paymentStatus, paymentMethod: 'cod', notifyCustomer: false } }, {
        json: value => { response = value; },
        status: code => { assert.fail(`Unexpected HTTP ${code}`); },
      });
      assert.equal(input.Key.suitId, 'ORDER#QA');
      assert.equal(response.status, status);
    });
  }
}

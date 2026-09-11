import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const start = source.indexOf('app.post("/api/orders/lookup-by-phone"');
const end = source.indexOf('// Get User Orders', start);
for (const indexed of [true, false]) {
  test(`Phone lookup ${indexed ? 'index with duplicate references' : 'legacy scan'}`, async () => {
    let handler;
    let output;
    const item = { orderId: 'QA', status: 'Confirmed', total: 1000, created_at: '2026-09-10' };
    class GetCommand { constructor(input) { Object.assign(this, input); } }
    class BatchGetCommand { constructor(input) { Object.assign(this, input); } }
    class ScanCommand { constructor(input) { Object.assign(this, input); } }
    vm.runInNewContext(source.slice(start, end), {
      app: { post: (_path, fn) => { handler = fn; } },
      allowTrackingAttempt: () => true, console,
      process: { env: { AWS_DYNAMODB_TABLE_NAME: 'QA' } },
      GetCommand, BatchGetCommand, ScanCommand,
      ddbDocClient: { send: async command => {
        if (command instanceof GetCommand) return { Item: indexed ? { order_refs: [{ orderId: 'QA' }, { orderId: 'QA' }] } : {} };
        const query = command instanceof BatchGetCommand ? command.RequestItems.QA : command;
        assert.equal(query.ExpressionAttributeNames['#total'], 'total');
        assert.ok(query.ProjectionExpression.includes('#total'));
        if (indexed) {
          assert.equal(query.Keys.length, 1);
          assert.equal(query.ConsistentRead, true);
          return { Responses: { QA: [item] } };
        }
        return { Items: [item] };
      } },
    });
    await handler({ ip: 'test', body: { phone: '9999999999' } }, {
      json: value => { output = value; }, status: code => { assert.fail(`Unexpected HTTP ${code}`); },
    });
    assert.equal(output[0].status, 'Confirmed');
  });
}

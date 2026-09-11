import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecipients, parseAudience, recipientId } from '../libs/pushAudience.js';

test('groups a customer across devices while separating guests and withholding push credentials', () => {
  const records = [
    { user_id: 'alice', user_email: 'alice@example.com', installation_id: 'phone', subscription: { endpoint: 'private' } },
    { user_id: 'alice', user_email: 'alice@example.com', installation_id: 'tablet' },
    { installation_id: 'guest-one' }, { installation_id: 'guest-two' },
  ];
  const recipients = buildRecipients(records);
  assert.equal(recipients.length, 3);
  assert.equal(recipients.find(item => item.label === 'alice@example.com').devices, 2);
  assert.equal(JSON.stringify(recipients).includes('private'), false);
  const audience = parseAudience({ mode: 'selected', recipientIds: [recipientId(records[0])] });
  assert.deepEqual(records.filter(item => audience.recipientIds.includes(recipientId(item))), records.slice(0, 2));
});

test('empty, missing and malformed selections never become broadcasts', () => {
  for (const audience of [undefined, {}, { mode: 'selected', recipientIds: [] }, { mode: 'selected', recipientIds: ['invalid'] }, { mode: 'unexpected' }]) {
    assert.throws(() => parseAudience(audience));
  }
  assert.deepEqual(parseAudience({ mode: 'all' }), { mode: 'all' });
});

test('multiple recipients and duplicate selections are handled explicitly', () => {
  const a = recipientId({ user_id: 'alice' });
  const b = recipientId({ user_id: 'bob' });
  assert.deepEqual(parseAudience({ mode: 'selected', recipientIds: [a, b, a] }).recipientIds, [a, b]);
});

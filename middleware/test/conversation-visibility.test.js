const assert = require('node:assert/strict');
const test = require('node:test');

const { conversationVisibilityWhere } = require('../lib/conversation-visibility');

test('conversation visibility denies anonymous access', () => {
  assert.deepEqual(conversationVisibilityWhere(null), { sql: 'FALSE', params: [] });
});

test('sales can see shared website and email conversations, but WhatsApp is own-account only', () => {
  const visibility = conversationVisibilityWhere({
    role: 'sales',
    workspaceMemberId: 'member-1',
    userId: 'user-1',
  });

  assert.match(visibility.sql, /c\.channel IN \('website', 'email'\)/);
  assert.match(visibility.sql, /c\.channel = 'whatsapp'/);
  assert.match(visibility.sql, /conv\.channel_accounts/);
  assert.deepEqual(visibility.params, ['member-1', 'user-1']);
});

test('privileged users still stay scoped on personal WhatsApp channel', () => {
  for (const role of ['admin', 'boss']) {
    const visibility = conversationVisibilityWhere({
      role,
      workspaceMemberId: `${role}-member`,
      userId: `${role}-user`,
    });

    assert.match(visibility.sql, /c\.channel <> 'whatsapp'/);
    assert.match(visibility.sql, /c\.channel = 'whatsapp'/);
    assert.match(visibility.sql, /conv\.channel_accounts/);
    assert.deepEqual(visibility.params, [`${role}-member`, `${role}-user`]);
  }
});

test('communication status can explicitly allow privileged users to see all channels', () => {
  const visibility = conversationVisibilityWhere({
    role: 'boss',
    workspaceMemberId: 'boss-member',
    userId: 'boss-user',
  }, 'c', 3, { allowPrivilegedAllChannels: true });

  assert.match(visibility.sql, /\$3::text/);
  assert.match(visibility.sql, /\$4::text/);
  assert.doesNotMatch(visibility.sql, /channel_accounts/);
  assert.deepEqual(visibility.params, ['boss-member', 'boss-user']);
});

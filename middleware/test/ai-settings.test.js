const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatTimeValue,
  normalizeAiSettingPayload,
  normalizeTimeValue,
  serializeAiSettingRow,
} = require('../lib/ai-settings');
const { conversationVisibilityWhere } = require('../lib/conversation-visibility');

test('normalizeTimeValue accepts HH:mm and truncates database time strings', () => {
  assert.equal(normalizeTimeValue('09:30'), '09:30');
  assert.equal(normalizeTimeValue('18:00:00'), '18:00');
  assert.equal(normalizeTimeValue('24:00'), null);
  assert.equal(normalizeTimeValue('9:00'), null);
  assert.equal(normalizeTimeValue(''), null);
});

test('normalizeAiSettingPayload validates channel and schedule contract', () => {
  assert.deepEqual(normalizeAiSettingPayload({
    channel: 'website',
    enabled: true,
    scheduleEnabled: true,
    scheduleStart: '18:00',
    scheduleEnd: '09:00',
  }), {
    setting: {
      channel: 'website',
      enabled: true,
      scheduleEnabled: true,
      scheduleStart: '18:00',
      scheduleEnd: '09:00',
      timezone: 'Asia/Shanghai',
    },
  });

  assert.equal(normalizeAiSettingPayload({ channel: 'telegram', enabled: true }).error, 'unsupported channel');
  assert.equal(normalizeAiSettingPayload({ channel: 'website', enabled: 'yes' }).error, 'enabled must be boolean');
  assert.equal(normalizeAiSettingPayload({
    channel: 'website',
    enabled: true,
    scheduleEnabled: true,
  }).error, 'scheduleStart and scheduleEnd are required when schedule is enabled');
  assert.equal(normalizeAiSettingPayload({
    channel: 'website',
    enabled: true,
    scheduleStart: '99:00',
  }).error, 'scheduleStart must be HH:mm');
});

test('serializeAiSettingRow normalizes response shape', () => {
  assert.deepEqual(serializeAiSettingRow({
    channel: 'whatsapp',
    enabled: false,
    scheduleEnabled: true,
    scheduleStart: '09:00:00',
    scheduleEnd: '18:30:00',
    timezone: '',
    activeNow: true,
  }), {
    channel: 'whatsapp',
    enabled: false,
    scheduleEnabled: true,
    scheduleStart: '09:00',
    scheduleEnd: '18:30',
    timezone: 'Asia/Shanghai',
    activeNow: true,
  });
});

test('conversationVisibilityWhere keeps admin/boss global and sales scoped', () => {
  assert.deepEqual(conversationVisibilityWhere(null), { sql: 'FALSE', params: [] });
  assert.deepEqual(conversationVisibilityWhere({ role: 'admin' }), { sql: 'TRUE', params: [] });
  assert.deepEqual(conversationVisibilityWhere({ role: 'boss' }), { sql: 'TRUE', params: [] });

  const visibility = conversationVisibilityWhere({
    role: 'sales',
    workspaceMemberId: 'member-1',
    userId: 'user-1',
  });
  assert.match(visibility.sql, /c\.channel = 'website'/);
  assert.match(visibility.sql, /c\.channel = 'whatsapp'/);
  assert.match(visibility.sql, /email/);
  assert.deepEqual(visibility.params, ['member-1', 'user-1']);
});

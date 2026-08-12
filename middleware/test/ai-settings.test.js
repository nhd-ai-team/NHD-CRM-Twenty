const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAiSettingResponses,
  formatTimeValue,
  normalizeAiSettingPayload,
  normalizeTimeValue,
  serializeAiSettingRow,
} = require('../lib/ai-settings');
const { conversationVisibilityWhere } = require('../lib/conversation-visibility');
const {
  isWebsiteFormPayload,
  normalizeCustomerType,
  normalizeSource,
  normalizeWebsiteFormPayload,
} = require('../lib/website-form');

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

test('buildAiSettingResponses keeps stable channel defaults without endpoint-only formatting', () => {
  assert.deepEqual(buildAiSettingResponses([{
    channel: 'whatsapp',
    enabled: true,
    scheduleEnabled: true,
    scheduleStart: '18:00:00',
    scheduleEnd: '09:00:00',
    timezone: 'Asia/Shanghai',
    activeNow: false,
  }]), [
    {
      channel: 'website',
      enabled: true,
      scheduleEnabled: false,
      scheduleStart: null,
      scheduleEnd: null,
      timezone: 'Asia/Shanghai',
      activeNow: true,
    },
    {
      channel: 'whatsapp',
      enabled: true,
      scheduleEnabled: true,
      scheduleStart: '18:00',
      scheduleEnd: '09:00',
      timezone: 'Asia/Shanghai',
      activeNow: false,
    },
    {
      channel: 'instagram',
      enabled: false,
      scheduleEnabled: false,
      scheduleStart: null,
      scheduleEnd: null,
      timezone: 'Asia/Shanghai',
      activeNow: true,
    },
    {
      channel: 'facebook',
      enabled: false,
      scheduleEnabled: false,
      scheduleStart: null,
      scheduleEnd: null,
      timezone: 'Asia/Shanghai',
      activeNow: true,
    },
  ]);
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

test('normalizeWebsiteFormPayload maps website form fields to current Twenty opportunity input', () => {
  const normalized = normalizeWebsiteFormPayload({
    type: 'form_submission',
    full_name: 'Ada',
    company_name: 'NHD Test Co',
    email: ' ada@example.com ',
    mobile: '+86 177 1005 1913',
    country: 'CN',
    product: '过滤设备',
    message: '需要报价',
    source: '官网表单',
    companyType: '业主',
    pageUrl: 'https://www.chinanhd.com/contact',
  });

  assert.deepEqual(normalized.opportunity, {
    name: 'NHD Test Co',
    keHuLaiYuan: 'GUAN_WANG_BIAO_DAN',
    stage: 'XIANSUO',
    keHuXuQiuChanPin: '过滤设备',
    gongSiLeiXing: 'YE_ZHU',
    youXiang: { primaryEmail: 'ada@example.com' },
    whatsapp: {
      primaryPhoneNumber: '17710051913',
      primaryPhoneCallingCode: '+86',
      primaryPhoneCountryCode: 'CN',
    },
    guoJiaDiQu: { addressCountry: 'CN' },
    guanWangLianJie: {
      primaryLinkUrl: 'https://www.chinanhd.com/contact',
      primaryLinkLabel: 'https://www.chinanhd.com/contact',
    },
    zuiXinGenJin: {
      markdown: '需要报价',
    },
  });
});

test('website form helpers keep unknown optional enums from blocking ingestion', () => {
  assert.equal(normalizeSource('官网留言'), 'GUAN_WANG_BIAO_DAN');
  assert.equal(normalizeCustomerType('未知类型'), null);
  assert.equal(isWebsiteFormPayload({ event: 'form_submit' }), true);
  assert.equal(isWebsiteFormPayload({ content: 'hello', senderType: 'visitor' }), false);
});

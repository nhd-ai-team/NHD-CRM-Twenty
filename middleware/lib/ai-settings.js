const AI_SETTING_CHANNELS = ['website', 'whatsapp', 'instagram', 'facebook'];
const TIME_VALUE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_AI_TIMEZONE = 'Asia/Shanghai';

function aiScheduleActiveExpression(alias = 'cs') {
  const prefix = alias ? `${alias}.` : '';
  const localTime = `(now() AT TIME ZONE COALESCE(${prefix}ai_timezone, '${DEFAULT_AI_TIMEZONE}'))::time`;
  return `(
    NOT COALESCE(${prefix}ai_schedule_enabled, false)
    OR (
      ${prefix}ai_schedule_start IS NOT NULL
      AND ${prefix}ai_schedule_end IS NOT NULL
      AND CASE
        WHEN ${prefix}ai_schedule_start <= ${prefix}ai_schedule_end
          THEN (${localTime} >= ${prefix}ai_schedule_start AND ${localTime} < ${prefix}ai_schedule_end)
        ELSE (${localTime} >= ${prefix}ai_schedule_start OR ${localTime} < ${prefix}ai_schedule_end)
      END
    )
  )`;
}

function normalizeTimeValue(value) {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 5);
  if (!TIME_VALUE_RE.test(text)) return null;
  return text;
}

function formatTimeValue(value) {
  if (value == null) return null;
  return String(value).slice(0, 5);
}

function normalizeAiSettingPayload(value = {}) {
  const channel = String(value.channel || '').trim();
  const enabled = value.enabled;
  const scheduleEnabled = value.scheduleEnabled === undefined ? false : value.scheduleEnabled;
  const scheduleStart = normalizeTimeValue(value.scheduleStart);
  const scheduleEnd = normalizeTimeValue(value.scheduleEnd);
  const timezone = String(value.timezone || DEFAULT_AI_TIMEZONE).trim() || DEFAULT_AI_TIMEZONE;
  if (!AI_SETTING_CHANNELS.includes(channel)) return { error: 'unsupported channel' };
  if (typeof enabled !== 'boolean') return { error: 'enabled must be boolean' };
  if (typeof scheduleEnabled !== 'boolean') return { error: 'scheduleEnabled must be boolean' };
  if (value.scheduleStart && !scheduleStart) return { error: 'scheduleStart must be HH:mm' };
  if (value.scheduleEnd && !scheduleEnd) return { error: 'scheduleEnd must be HH:mm' };
  if (scheduleEnabled && (!scheduleStart || !scheduleEnd)) {
    return { error: 'scheduleStart and scheduleEnd are required when schedule is enabled' };
  }
  return { setting: { channel, enabled, scheduleEnabled, scheduleStart, scheduleEnd, timezone } };
}

function serializeAiSettingRow(row = {}) {
  return {
    channel: row.channel,
    enabled: row.enabled,
    scheduleEnabled: row.scheduleEnabled,
    scheduleStart: formatTimeValue(row.scheduleStart),
    scheduleEnd: formatTimeValue(row.scheduleEnd),
    timezone: row.timezone || DEFAULT_AI_TIMEZONE,
    activeNow: row.activeNow,
  };
}

module.exports = {
  AI_SETTING_CHANNELS,
  DEFAULT_AI_TIMEZONE,
  aiScheduleActiveExpression,
  formatTimeValue,
  normalizeAiSettingPayload,
  normalizeTimeValue,
  serializeAiSettingRow,
};

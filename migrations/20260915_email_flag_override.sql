-- Allow CRM to explicitly override a网易红旗状态.
ALTER TABLE conv.messages
  ADD COLUMN IF NOT EXISTS crm_is_flagged_override BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE conv.messages
  ADD COLUMN IF NOT EXISTS crm_flag_override_source_is_flagged BOOLEAN;

-- Existing CRM-positive flags were explicit CRM actions before the override bit existed.
UPDATE conv.messages
   SET crm_is_flagged_override = true
 WHERE crm_is_flagged = true
   AND crm_is_flagged_override = false;

UPDATE conv.messages
   SET crm_flag_override_source_is_flagged = source_is_flagged
 WHERE crm_is_flagged_override = true
   AND crm_flag_override_source_is_flagged IS NULL;

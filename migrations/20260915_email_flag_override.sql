-- Allow CRM to explicitly override a网易红旗状态.
ALTER TABLE conv.messages
  ADD COLUMN IF NOT EXISTS crm_is_flagged_override BOOLEAN NOT NULL DEFAULT false;

-- Existing CRM-positive flags were explicit CRM actions before the override bit existed.
UPDATE conv.messages
   SET crm_is_flagged_override = true
 WHERE crm_is_flagged = true
   AND crm_is_flagged_override = false;

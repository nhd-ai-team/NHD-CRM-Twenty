-- Manual CRM override for email junk classification.
-- NULL follows the IMAP source classification; TRUE/FALSE forces junk/not-junk.
ALTER TABLE conv.messages
  ADD COLUMN IF NOT EXISTS crm_is_junk BOOLEAN;

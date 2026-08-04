-- 官网重复记录改为“提醒 + 用户确认归类”，不阻止保存。
-- customerIdentityKey 是客户身份维度，不替代一条业务链使用的 syncGroupCode。

DO $$
DECLARE
  ws text;
BEGIN
  SELECT table_schema INTO ws
  FROM information_schema.tables
  WHERE table_name = 'opportunity' AND table_schema LIKE 'workspace_%'
  ORDER BY table_schema
  LIMIT 1;

  IF ws IS NULL THEN
    RAISE EXCEPTION 'workspace schema not found';
  END IF;

  EXECUTE format('DROP TRIGGER IF EXISTS opportunity_customer_website_dedup_before_write ON %I.opportunity', ws);
  EXECUTE format('DROP TRIGGER IF EXISTS person_customer_website_dedup_before_write ON %I.person', ws);
  EXECUTE format('DROP TRIGGER IF EXISTS project_customer_website_dedup_before_write ON %I."_xiangMu"', ws);

  EXECUTE format('ALTER TABLE %I.opportunity ADD COLUMN IF NOT EXISTS "customerIdentityKey" text', ws);
  EXECUTE format('ALTER TABLE %I.person ADD COLUMN IF NOT EXISTS "customerIdentityKey" text', ws);
  EXECUTE format('ALTER TABLE %I."_xiangMu" ADD COLUMN IF NOT EXISTS "customerIdentityKey" text', ws);

  EXECUTE format('CREATE INDEX IF NOT EXISTS opportunity_customer_identity_idx ON %I.opportunity("customerIdentityKey") WHERE "deletedAt" IS NULL AND "customerIdentityKey" IS NOT NULL', ws);
  EXECUTE format('CREATE INDEX IF NOT EXISTS person_customer_identity_idx ON %I.person("customerIdentityKey") WHERE "deletedAt" IS NULL AND "customerIdentityKey" IS NOT NULL', ws);
  EXECUTE format('CREATE INDEX IF NOT EXISTS project_customer_identity_idx ON %I."_xiangMu"("customerIdentityKey") WHERE "deletedAt" IS NULL AND "customerIdentityKey" IS NOT NULL', ws);
END;
$$;

DROP FUNCTION IF EXISTS conv.reject_duplicate_customer_website();

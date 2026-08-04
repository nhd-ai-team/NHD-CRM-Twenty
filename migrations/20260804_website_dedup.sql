-- 客户官网跨线索、客户、项目识别与同步。
-- 判断键为域名：忽略协议、www、端口、路径、参数、片段、大小写和末尾斜杠。

CREATE SCHEMA IF NOT EXISTS conv;

CREATE OR REPLACE FUNCTION conv.normalized_website_domain(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  value text := lower(btrim(COALESCE(p_value, '')));
BEGIN
  IF value = '' THEN
    RETURN NULL;
  END IF;

  value := regexp_replace(value, '^[a-z][a-z0-9+.-]*://', '', 'i');
  value := regexp_replace(value, '^[^/@]+@', '');
  value := regexp_replace(value, '[/?#].*$', '');
  value := regexp_replace(value, ':[0-9]+$', '');
  value := regexp_replace(value, '^www[0-9]*\.', '', 'i');
  value := regexp_replace(value, '\.$', '');

  RETURN NULLIF(value, '');
END;
$$;

CREATE OR REPLACE FUNCTION conv.sync_customer_website()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'opportunity' THEN
    EXECUTE format(
      'UPDATE %I.person SET "guanWangLianJiePrimaryLinkUrl"=$1, "guanWangLianJiePrimaryLinkLabel"=$2, "guanWangLianJieSecondaryLinks"=$3, "updatedAt"=now() WHERE "deletedAt" IS NULL AND "syncGroupCode"=$4',
      TG_TABLE_SCHEMA
    ) USING NEW."guanWangLianJiePrimaryLinkUrl", NEW."guanWangLianJiePrimaryLinkLabel", NEW."guanWangLianJieSecondaryLinks", NEW."syncGroupCode";
    EXECUTE format(
      'UPDATE %I."_xiangMu" SET "guanWangLianJiePrimaryLinkUrl"=$1, "guanWangLianJiePrimaryLinkLabel"=$2, "guanWangLianJieSecondaryLinks"=$3, "updatedAt"=now() WHERE "deletedAt" IS NULL AND "syncGroupCode"=$4',
      TG_TABLE_SCHEMA
    ) USING NEW."guanWangLianJiePrimaryLinkUrl", NEW."guanWangLianJiePrimaryLinkLabel", NEW."guanWangLianJieSecondaryLinks", NEW."syncGroupCode";
  ELSIF TG_TABLE_NAME = 'person' THEN
    EXECUTE format(
      'UPDATE %I.opportunity SET "guanWangLianJiePrimaryLinkUrl"=$1, "guanWangLianJiePrimaryLinkLabel"=$2, "guanWangLianJieSecondaryLinks"=$3, "updatedAt"=now() WHERE "deletedAt" IS NULL AND "syncGroupCode"=$4',
      TG_TABLE_SCHEMA
    ) USING NEW."guanWangLianJiePrimaryLinkUrl", NEW."guanWangLianJiePrimaryLinkLabel", NEW."guanWangLianJieSecondaryLinks", NEW."syncGroupCode";
    EXECUTE format(
      'UPDATE %I."_xiangMu" SET "guanWangLianJiePrimaryLinkUrl"=$1, "guanWangLianJiePrimaryLinkLabel"=$2, "guanWangLianJieSecondaryLinks"=$3, "updatedAt"=now() WHERE "deletedAt" IS NULL AND "syncGroupCode"=$4',
      TG_TABLE_SCHEMA
    ) USING NEW."guanWangLianJiePrimaryLinkUrl", NEW."guanWangLianJiePrimaryLinkLabel", NEW."guanWangLianJieSecondaryLinks", NEW."syncGroupCode";
  ELSE
    EXECUTE format(
      'UPDATE %I.opportunity SET "guanWangLianJiePrimaryLinkUrl"=$1, "guanWangLianJiePrimaryLinkLabel"=$2, "guanWangLianJieSecondaryLinks"=$3, "updatedAt"=now() WHERE "deletedAt" IS NULL AND "syncGroupCode"=$4',
      TG_TABLE_SCHEMA
    ) USING NEW."guanWangLianJiePrimaryLinkUrl", NEW."guanWangLianJiePrimaryLinkLabel", NEW."guanWangLianJieSecondaryLinks", NEW."syncGroupCode";
    EXECUTE format(
      'UPDATE %I.person SET "guanWangLianJiePrimaryLinkUrl"=$1, "guanWangLianJiePrimaryLinkLabel"=$2, "guanWangLianJieSecondaryLinks"=$3, "updatedAt"=now() WHERE "deletedAt" IS NULL AND "syncGroupCode"=$4',
      TG_TABLE_SCHEMA
    ) USING NEW."guanWangLianJiePrimaryLinkUrl", NEW."guanWangLianJiePrimaryLinkLabel", NEW."guanWangLianJieSecondaryLinks", NEW."syncGroupCode";
  END IF;

  RETURN NEW;
END;
$$;

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

  -- 物理列通常由 Twenty 元数据迁移创建；这里保证部署脚本重复执行时结构完整。
  EXECUTE format('ALTER TABLE %I.opportunity ADD COLUMN IF NOT EXISTS "guanWangLianJiePrimaryLinkUrl" text', ws);
  EXECUTE format('ALTER TABLE %I.opportunity ADD COLUMN IF NOT EXISTS "guanWangLianJiePrimaryLinkLabel" text', ws);
  EXECUTE format('ALTER TABLE %I.opportunity ADD COLUMN IF NOT EXISTS "guanWangLianJieSecondaryLinks" jsonb', ws);
  EXECUTE format('ALTER TABLE %I.person ADD COLUMN IF NOT EXISTS "guanWangLianJiePrimaryLinkUrl" text', ws);
  EXECUTE format('ALTER TABLE %I.person ADD COLUMN IF NOT EXISTS "guanWangLianJiePrimaryLinkLabel" text', ws);
  EXECUTE format('ALTER TABLE %I.person ADD COLUMN IF NOT EXISTS "guanWangLianJieSecondaryLinks" jsonb', ws);
  EXECUTE format('ALTER TABLE %I."_xiangMu" ADD COLUMN IF NOT EXISTS "guanWangLianJiePrimaryLinkUrl" text', ws);
  EXECUTE format('ALTER TABLE %I."_xiangMu" ADD COLUMN IF NOT EXISTS "guanWangLianJiePrimaryLinkLabel" text', ws);
  EXECUTE format('ALTER TABLE %I."_xiangMu" ADD COLUMN IF NOT EXISTS "guanWangLianJieSecondaryLinks" jsonb', ws);

  EXECUTE format('CREATE INDEX IF NOT EXISTS opportunity_website_domain_idx ON %I.opportunity (conv.normalized_website_domain("guanWangLianJiePrimaryLinkUrl")) WHERE "deletedAt" IS NULL AND "guanWangLianJiePrimaryLinkUrl" IS NOT NULL', ws);
  EXECUTE format('CREATE INDEX IF NOT EXISTS person_website_domain_idx ON %I.person (conv.normalized_website_domain("guanWangLianJiePrimaryLinkUrl")) WHERE "deletedAt" IS NULL AND "guanWangLianJiePrimaryLinkUrl" IS NOT NULL', ws);
  EXECUTE format('CREATE INDEX IF NOT EXISTS project_website_domain_idx ON %I."_xiangMu" (conv.normalized_website_domain("guanWangLianJiePrimaryLinkUrl")) WHERE "deletedAt" IS NULL AND "guanWangLianJiePrimaryLinkUrl" IS NOT NULL', ws);

  EXECUTE format('DROP TRIGGER IF EXISTS opportunity_customer_website_sync_after_write ON %I.opportunity', ws);
  EXECUTE format('CREATE TRIGGER opportunity_customer_website_sync_after_write AFTER INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "guanWangLianJiePrimaryLinkLabel", "guanWangLianJieSecondaryLinks", "syncGroupCode" ON %I.opportunity FOR EACH ROW EXECUTE FUNCTION conv.sync_customer_website()', ws);
  EXECUTE format('DROP TRIGGER IF EXISTS person_customer_website_sync_after_write ON %I.person', ws);
  EXECUTE format('CREATE TRIGGER person_customer_website_sync_after_write AFTER INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "guanWangLianJiePrimaryLinkLabel", "guanWangLianJieSecondaryLinks", "syncGroupCode" ON %I.person FOR EACH ROW EXECUTE FUNCTION conv.sync_customer_website()', ws);
  EXECUTE format('DROP TRIGGER IF EXISTS project_customer_website_sync_after_write ON %I."_xiangMu"', ws);
  EXECUTE format('CREATE TRIGGER project_customer_website_sync_after_write AFTER INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "guanWangLianJiePrimaryLinkLabel", "guanWangLianJieSecondaryLinks", "syncGroupCode" ON %I."_xiangMu" FOR EACH ROW EXECUTE FUNCTION conv.sync_customer_website()', ws);
END;
$$;

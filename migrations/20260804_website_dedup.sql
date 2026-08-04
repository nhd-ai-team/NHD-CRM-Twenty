-- 客户官网跨线索、客户、项目去重与同步。
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

CREATE OR REPLACE FUNCTION conv.reject_duplicate_customer_website()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  domain_value text;
  conflict_table text;
  conflict_name text;
BEGIN
  domain_value := conv.normalized_website_domain(NEW."guanWangLianJiePrimaryLinkUrl");
  IF domain_value IS NULL THEN
    RETURN NEW;
  END IF;

  -- 同一域名的并发写入也必须串行检查，避免两个请求同时通过。
  PERFORM pg_advisory_xact_lock(hashtext('customer-website:' || domain_value));

  EXECUTE format($sql$
    SELECT source_table, record_name
    FROM (
      SELECT '线索'::text AS source_table, name AS record_name, id, "syncGroupCode"
      FROM %1$I.opportunity
      WHERE "deletedAt" IS NULL
        AND conv.normalized_website_domain("guanWangLianJiePrimaryLinkUrl") = $1
      UNION ALL
      SELECT '客户'::text, NULLIF(concat_ws(' ', "nameFirstName", "nameLastName"), ''), id, "syncGroupCode"
      FROM %1$I.person
      WHERE "deletedAt" IS NULL
        AND conv.normalized_website_domain("guanWangLianJiePrimaryLinkUrl") = $1
      UNION ALL
      SELECT '项目'::text, name, id, "syncGroupCode"
      FROM %1$I."_xiangMu"
      WHERE "deletedAt" IS NULL
        AND conv.normalized_website_domain("guanWangLianJiePrimaryLinkUrl") = $1
    ) existing
    WHERE NOT (
      existing.id = $2
      AND existing.source_table = $3
    )
      AND NOT (
        existing."syncGroupCode" IS NOT NULL
        AND $4::text IS NOT NULL
        AND existing."syncGroupCode" = $4
      )
    LIMIT 1
  $sql$, TG_TABLE_SCHEMA)
  INTO conflict_table, conflict_name
  USING domain_value,
        NEW.id,
        CASE TG_TABLE_NAME WHEN 'opportunity' THEN '线索' WHEN 'person' THEN '客户' ELSE '项目' END,
        NEW."syncGroupCode";

  IF conflict_table IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format('官网链接重复：%s 已存在', domain_value),
      DETAIL = format('该官网已用于%s“%s”，请打开已有记录更新，不要重复创建。', conflict_table, COALESCE(conflict_name, '未命名')),
      HINT = '同一业务的线索、客户和项目应使用相同的关联编码。';
  END IF;

  RETURN NEW;
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

  EXECUTE format('DROP TRIGGER IF EXISTS opportunity_customer_website_dedup_before_write ON %I.opportunity', ws);
  EXECUTE format('CREATE TRIGGER opportunity_customer_website_dedup_before_write BEFORE INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "syncGroupCode" ON %I.opportunity FOR EACH ROW EXECUTE FUNCTION conv.reject_duplicate_customer_website()', ws);
  EXECUTE format('DROP TRIGGER IF EXISTS person_customer_website_dedup_before_write ON %I.person', ws);
  EXECUTE format('CREATE TRIGGER person_customer_website_dedup_before_write BEFORE INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "syncGroupCode" ON %I.person FOR EACH ROW EXECUTE FUNCTION conv.reject_duplicate_customer_website()', ws);
  EXECUTE format('DROP TRIGGER IF EXISTS project_customer_website_dedup_before_write ON %I."_xiangMu"', ws);
  EXECUTE format('CREATE TRIGGER project_customer_website_dedup_before_write BEFORE INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "syncGroupCode" ON %I."_xiangMu" FOR EACH ROW EXECUTE FUNCTION conv.reject_duplicate_customer_website()', ws);

  EXECUTE format('DROP TRIGGER IF EXISTS opportunity_customer_website_sync_after_write ON %I.opportunity', ws);
  EXECUTE format('CREATE TRIGGER opportunity_customer_website_sync_after_write AFTER INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "guanWangLianJiePrimaryLinkLabel", "guanWangLianJieSecondaryLinks", "syncGroupCode" ON %I.opportunity FOR EACH ROW EXECUTE FUNCTION conv.sync_customer_website()', ws);
  EXECUTE format('DROP TRIGGER IF EXISTS person_customer_website_sync_after_write ON %I.person', ws);
  EXECUTE format('CREATE TRIGGER person_customer_website_sync_after_write AFTER INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "guanWangLianJiePrimaryLinkLabel", "guanWangLianJieSecondaryLinks", "syncGroupCode" ON %I.person FOR EACH ROW EXECUTE FUNCTION conv.sync_customer_website()', ws);
  EXECUTE format('DROP TRIGGER IF EXISTS project_customer_website_sync_after_write ON %I."_xiangMu"', ws);
  EXECUTE format('CREATE TRIGGER project_customer_website_sync_after_write AFTER INSERT OR UPDATE OF "guanWangLianJiePrimaryLinkUrl", "guanWangLianJiePrimaryLinkLabel", "guanWangLianJieSecondaryLinks", "syncGroupCode" ON %I."_xiangMu" FOR EACH ROW EXECUTE FUNCTION conv.sync_customer_website()', ws);
END;
$$;

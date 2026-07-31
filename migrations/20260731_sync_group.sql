-- 线索 / 客户 / 项目三表关联编码与共享字段同步
-- 编码规则：NHD + 线索创建日期(Asia/Shanghai, YYYYMMDD) + 当日递增流水号(001, 002...)
-- 删除历史数据不回收流水号。

CREATE SCHEMA IF NOT EXISTS conv;

CREATE TABLE IF NOT EXISTS conv.sync_code_counters (
  code_date date PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION conv.next_sync_group_code(p_created_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  d date := (timezone('Asia/Shanghai', COALESCE(p_created_at, now())))::date;
  n integer;
BEGIN
  INSERT INTO conv.sync_code_counters(code_date, last_seq, updated_at)
  VALUES (d, 1, now())
  ON CONFLICT (code_date)
  DO UPDATE SET last_seq = conv.sync_code_counters.last_seq + 1, updated_at = now()
  RETURNING last_seq INTO n;

  RETURN 'NHD' || to_char(d, 'YYYYMMDD') || lpad(n::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION conv.first_email(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(split_part(COALESCE(p_value, ''), ',', 1), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION conv.opportunity_stage_to_project_task(p_stage text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'XIANSUO' THEN 'YOU_XIAO_XUN_PAN'
    WHEN 'YOUXIAO_XIANSUO' THEN 'YOU_XIAO_XUN_PAN'
    WHEN 'XUNJIA' THEN 'YI_ZHUAN_ZONG_BU'
    WHEN 'BAOJIA' THEN 'YI_BAO_JIA'
    WHEN 'SHENYANG' THEN 'JI_SHU_CHENG_QING'
    WHEN 'TANPAN' THEN 'SHANG_WU_CHENG_QING'
    WHEN 'YIXIADAN' THEN 'YI_QIAN_DAN'
    WHEN 'YIFUKUAN' THEN 'YI_QIAN_DAN'
    WHEN 'YIFAHUO' THEN 'YI_FA_HUO'
    WHEN 'YICHENGJIAO' THEN 'YI_QIAN_DAN'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION conv.project_task_to_opportunity_stage(p_task text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_task
    WHEN 'YOU_XIAO_XUN_PAN' THEN 'YOUXIAO_XIANSUO'
    WHEN 'YI_ZHUAN_ZONG_BU' THEN 'XUNJIA'
    WHEN 'YI_BAO_JIA' THEN 'BAOJIA'
    WHEN 'JI_SHU_CHENG_QING' THEN 'SHENYANG'
    WHEN 'SHANG_WU_CHENG_QING' THEN 'TANPAN'
    WHEN 'YI_QIAN_DAN' THEN 'YIFUKUAN'
    WHEN 'YI_FA_HUO' THEN 'YIFAHUO'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION conv.ensure_opportunity_sync_group_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."syncGroupCode" IS NULL OR btrim(NEW."syncGroupCode") = '' THEN
    NEW."syncGroupCode" := conv.next_sync_group_code(COALESCE(NEW."createdAt", now()));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION conv.sync_from_opportunity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    UPDATE %I.person AS target
    SET
      "syncGroupCode" = COALESCE("syncGroupCode", ($1)."syncGroupCode"),
      "sourceOpportunityId" = COALESCE("sourceOpportunityId", ($1).id),
      "linkedProjectId" = COALESCE("linkedProjectId", ($1)."linkedProjectId"),
      "nameFirstName" = COALESCE(NULLIF(($1).name, ''), "nameFirstName"),
      "companyId" = COALESCE(($1)."companyId", "companyId"),
      "phonesPrimaryPhoneNumber" = COALESCE(NULLIF(($1)."phonePrimaryPhoneNumber", ''), "phonesPrimaryPhoneNumber"),
      "phonesPrimaryPhoneCountryCode" = COALESCE(NULLIF(($1)."phonePrimaryPhoneCountryCode", ''), "phonesPrimaryPhoneCountryCode"),
      "phonesPrimaryPhoneCallingCode" = COALESCE(NULLIF(($1)."phonePrimaryPhoneCallingCode", ''), "phonesPrimaryPhoneCallingCode"),
      "emailsPrimaryEmail" = CASE
        WHEN COALESCE(conv.first_email(($1)."youXiang"), conv.first_email(($1)."emailPrimaryEmail")) IS NULL
          THEN target."emailsPrimaryEmail"
        WHEN NOT EXISTS (
          SELECT 1 FROM %I.person AS other
          WHERE other."deletedAt" IS NULL
            AND lower(other."emailsPrimaryEmail") = lower(COALESCE(conv.first_email(($1)."youXiang"), conv.first_email(($1)."emailPrimaryEmail")))
            AND other.id <> target.id
        )
          THEN COALESCE(conv.first_email(($1)."youXiang"), conv.first_email(($1)."emailPrimaryEmail"))
        ELSE target."emailsPrimaryEmail"
      END,
      "guoJiaAddressCountry" = COALESCE(NULLIF(($1)."countryAddressCountry", ''), "guoJiaAddressCountry"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), "keHuXuQiuChanPin"),
      "keHuLaiYuan" = CASE
        WHEN ($1)."keHuLaiYuan" IS NULL THEN "keHuLaiYuan"
        ELSE (($1)."keHuLaiYuan"::text)::%I."person_keHuLaiYuan_enum"
      END,
      "keHuLeiXing" = CASE
        WHEN ($1)."keHuLeiXing"::text IN ('ZHONG_JIAN_SHANG','YE_ZHU','EPC','JI_SHU_ZI_XUN')
          THEN (($1)."keHuLeiXing"::text)::%I."person_keHuLeiXing_enum"
        ELSE "keHuLeiXing"
      END,
      "jobTitle" = COALESCE(NULLIF(($1)."zhiWei", ''), "jobTitle"),
      "updatedAt" = now()
    WHERE "deletedAt" IS NULL
      AND ("syncGroupCode" = ($1)."syncGroupCode" OR target.id = ($1)."pointOfContactId")
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW;

  EXECUTE format($sql$
    UPDATE %I."_xiangMu"
    SET
      "syncGroupCode" = COALESCE("syncGroupCode", ($1)."syncGroupCode"),
      "sourceOpportunityId" = COALESCE("sourceOpportunityId", ($1).id),
      "linkedPersonId" = COALESCE("linkedPersonId", ($1)."linkedPersonId", ($1)."pointOfContactId"),
      name = COALESCE(NULLIF(($1).name, ''), name),
      "guoJiaAddressCountry" = COALESCE(NULLIF(($1)."countryAddressCountry", ''), "guoJiaAddressCountry"),
      "xuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), "xuQiuChanPin"),
      "jinEAmountMicros" = COALESCE(($1)."amountAmountMicros", "jinEAmountMicros"),
      "jinECurrencyCode" = COALESCE(NULLIF(($1)."amountCurrencyCode", ''), "jinECurrencyCode"),
      "gaiShu" = COALESCE(NULLIF(($1)."message", ''), "gaiShu"),
      "muQianJinDu" = COALESCE(NULLIF(($1)."xiangMuJinDu", ''), "muQianJinDu"),
      "renWuJinDu" = CASE
        WHEN conv.opportunity_stage_to_project_task(($1).stage::text) IS NULL THEN "renWuJinDu"
        ELSE conv.opportunity_stage_to_project_task(($1).stage::text)::%I."_xiangMu_renWuJinDu_enum"
      END,
      "updatedAt" = now()
    WHERE "deletedAt" IS NULL
      AND "syncGroupCode" = ($1)."syncGroupCode"
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION conv.sync_from_person()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    UPDATE %I.opportunity
    SET
      "syncGroupCode" = COALESCE("syncGroupCode", ($1)."syncGroupCode"),
      "linkedPersonId" = COALESCE("linkedPersonId", ($1).id),
      "pointOfContactId" = COALESCE("pointOfContactId", ($1).id),
      name = COALESCE(NULLIF(($1)."nameFirstName", ''), name),
      "companyId" = COALESCE(($1)."companyId", "companyId"),
      "phonePrimaryPhoneNumber" = COALESCE(NULLIF(($1)."phonesPrimaryPhoneNumber", ''), "phonePrimaryPhoneNumber"),
      "phonePrimaryPhoneCountryCode" = COALESCE(NULLIF(($1)."phonesPrimaryPhoneCountryCode", ''), "phonePrimaryPhoneCountryCode"),
      "phonePrimaryPhoneCallingCode" = COALESCE(NULLIF(($1)."phonesPrimaryPhoneCallingCode", ''), "phonePrimaryPhoneCallingCode"),
      "youXiang" = COALESCE(NULLIF(($1)."emailsPrimaryEmail", ''), "youXiang"),
      "countryAddressCountry" = COALESCE(NULLIF(($1)."guoJiaAddressCountry", ''), "countryAddressCountry"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), "keHuXuQiuChanPin"),
      "keHuLaiYuan" = CASE
        WHEN ($1)."keHuLaiYuan" IS NULL THEN "keHuLaiYuan"
        ELSE (($1)."keHuLaiYuan"::text)::%I."opportunity_keHuLaiYuan_enum"
      END,
      "keHuLeiXing" = CASE
        WHEN ($1)."keHuLeiXing"::text IN ('ZHONG_JIAN_SHANG','YE_ZHU','EPC','JI_SHU_ZI_XUN')
          THEN (($1)."keHuLeiXing"::text)::%I."opportunity_keHuLeiXing_enum"
        ELSE "keHuLeiXing"
      END,
      "zhiWei" = COALESCE(NULLIF(($1)."jobTitle", ''), "zhiWei"),
      "updatedAt" = now()
    WHERE "deletedAt" IS NULL
      AND (
        "syncGroupCode" = ($1)."syncGroupCode"
        OR id = ($1)."sourceOpportunityId"
        OR "linkedPersonId" = ($1).id
        OR "pointOfContactId" = ($1).id
      )
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW;

  EXECUTE format($sql$
    UPDATE %I."_xiangMu"
    SET
      "syncGroupCode" = COALESCE("syncGroupCode", ($1)."syncGroupCode"),
      "linkedPersonId" = COALESCE("linkedPersonId", ($1).id),
      "sourceOpportunityId" = COALESCE("sourceOpportunityId", ($1)."sourceOpportunityId"),
      name = COALESCE(NULLIF(($1)."nameFirstName", ''), name),
      "guoJiaAddressCountry" = COALESCE(NULLIF(($1)."guoJiaAddressCountry", ''), "guoJiaAddressCountry"),
      "xuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), "xuQiuChanPin"),
      "updatedAt" = now()
    WHERE "deletedAt" IS NULL
      AND ("syncGroupCode" = ($1)."syncGroupCode" OR "linkedPersonId" = ($1).id)
  $sql$, TG_TABLE_SCHEMA)
  USING NEW;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION conv.sync_from_project()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    UPDATE %I.opportunity
    SET
      "syncGroupCode" = COALESCE("syncGroupCode", ($1)."syncGroupCode"),
      "linkedProjectId" = COALESCE("linkedProjectId", ($1).id),
      name = COALESCE(NULLIF(($1).name, ''), name),
      "countryAddressCountry" = COALESCE(NULLIF(($1)."guoJiaAddressCountry", ''), "countryAddressCountry"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."xuQiuChanPin", ''), "keHuXuQiuChanPin"),
      "amountAmountMicros" = COALESCE(($1)."jinEAmountMicros", "amountAmountMicros"),
      "amountCurrencyCode" = COALESCE(NULLIF(($1)."jinECurrencyCode", ''), "amountCurrencyCode"),
      "message" = COALESCE(NULLIF(($1)."gaiShu", ''), "message"),
      "xiangMuJinDu" = COALESCE(NULLIF(($1)."muQianJinDu", ''), "xiangMuJinDu"),
      stage = CASE
        WHEN conv.project_task_to_opportunity_stage(($1)."renWuJinDu"::text) IS NULL THEN stage
        ELSE conv.project_task_to_opportunity_stage(($1)."renWuJinDu"::text)::%I."opportunity_stage_enum"
      END,
      "updatedAt" = now()
    WHERE "deletedAt" IS NULL
      AND ("syncGroupCode" = ($1)."syncGroupCode" OR id = ($1)."sourceOpportunityId")
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW;

  EXECUTE format($sql$
    UPDATE %I.person
    SET
      "syncGroupCode" = COALESCE("syncGroupCode", ($1)."syncGroupCode"),
      "linkedProjectId" = COALESCE("linkedProjectId", ($1).id),
      "sourceOpportunityId" = COALESCE("sourceOpportunityId", ($1)."sourceOpportunityId"),
      "nameFirstName" = COALESCE(NULLIF(($1).name, ''), "nameFirstName"),
      "guoJiaAddressCountry" = COALESCE(NULLIF(($1)."guoJiaAddressCountry", ''), "guoJiaAddressCountry"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."xuQiuChanPin", ''), "keHuXuQiuChanPin"),
      "updatedAt" = now()
    WHERE "deletedAt" IS NULL
      AND ("syncGroupCode" = ($1)."syncGroupCode" OR id = ($1)."linkedPersonId")
  $sql$, TG_TABLE_SCHEMA)
  USING NEW;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  ws text;
  r record;
BEGIN
  SELECT table_schema INTO ws
  FROM information_schema.tables
  WHERE table_name = 'opportunity' AND table_schema LIKE 'workspace_%'
  ORDER BY table_schema
  LIMIT 1;

  IF ws IS NULL THEN
    RAISE EXCEPTION 'workspace schema not found';
  END IF;

  EXECUTE format('ALTER TABLE %I.opportunity ADD COLUMN IF NOT EXISTS "syncGroupCode" text', ws);
  EXECUTE format('ALTER TABLE %I.opportunity ADD COLUMN IF NOT EXISTS "linkedPersonId" uuid', ws);
  EXECUTE format('ALTER TABLE %I.opportunity ADD COLUMN IF NOT EXISTS "linkedProjectId" uuid', ws);
  EXECUTE format('ALTER TABLE %I.person ADD COLUMN IF NOT EXISTS "syncGroupCode" text', ws);
  EXECUTE format('ALTER TABLE %I.person ADD COLUMN IF NOT EXISTS "sourceOpportunityId" uuid', ws);
  EXECUTE format('ALTER TABLE %I.person ADD COLUMN IF NOT EXISTS "linkedProjectId" uuid', ws);
  EXECUTE format('ALTER TABLE %I."_xiangMu" ADD COLUMN IF NOT EXISTS "syncGroupCode" text', ws);
  EXECUTE format('ALTER TABLE %I."_xiangMu" ADD COLUMN IF NOT EXISTS "sourceOpportunityId" uuid', ws);
  EXECUTE format('ALTER TABLE %I."_xiangMu" ADD COLUMN IF NOT EXISTS "linkedPersonId" uuid', ws);

  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS opportunity_sync_group_code_unique ON %I.opportunity("syncGroupCode") WHERE "syncGroupCode" IS NOT NULL', ws);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS person_sync_group_code_unique ON %I.person("syncGroupCode") WHERE "syncGroupCode" IS NOT NULL', ws);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS xiangmu_sync_group_code_unique ON %I."_xiangMu"("syncGroupCode") WHERE "syncGroupCode" IS NOT NULL', ws);

  FOR r IN EXECUTE format('SELECT id, "createdAt" FROM %I.opportunity WHERE "syncGroupCode" IS NULL ORDER BY "createdAt", id', ws)
  LOOP
    EXECUTE format('UPDATE %I.opportunity SET "syncGroupCode" = conv.next_sync_group_code("createdAt") WHERE id = $1', ws)
    USING r.id;
  END LOOP;

  EXECUTE format('DROP TRIGGER IF EXISTS opportunity_sync_group_code_before_insert ON %I.opportunity', ws);
  EXECUTE format('CREATE TRIGGER opportunity_sync_group_code_before_insert BEFORE INSERT ON %I.opportunity FOR EACH ROW EXECUTE FUNCTION conv.ensure_opportunity_sync_group_code()', ws);

  EXECUTE format('DROP TRIGGER IF EXISTS opportunity_sync_shared_fields_after_write ON %I.opportunity', ws);
  EXECUTE format('CREATE TRIGGER opportunity_sync_shared_fields_after_write AFTER INSERT OR UPDATE ON %I.opportunity FOR EACH ROW EXECUTE FUNCTION conv.sync_from_opportunity()', ws);

  EXECUTE format('DROP TRIGGER IF EXISTS person_sync_shared_fields_after_write ON %I.person', ws);
  EXECUTE format('CREATE TRIGGER person_sync_shared_fields_after_write AFTER INSERT OR UPDATE ON %I.person FOR EACH ROW EXECUTE FUNCTION conv.sync_from_person()', ws);

  EXECUTE format('DROP TRIGGER IF EXISTS project_sync_shared_fields_after_write ON %I."_xiangMu"', ws);
  EXECUTE format('CREATE TRIGGER project_sync_shared_fields_after_write AFTER INSERT OR UPDATE ON %I."_xiangMu" FOR EACH ROW EXECUTE FUNCTION conv.sync_from_project()', ws);
END;
$$;

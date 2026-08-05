-- 官网表单按邮箱 / 电话去重。
-- 官网侧可能直接写入 Opportunity。为避免绕过 middleware，去重放在数据库触发器兜底：
-- 1. 仅处理客户来源为官网表单(GUAN_WANG_BIAO_DAN)的新线索。
-- 2. 命中已有未删除线索时，更新已有线索，软删除本次重复插入行。
-- 3. 不合并、删除已有业务链编码；已有线索继续作为主记录。

CREATE SCHEMA IF NOT EXISTS conv;

CREATE OR REPLACE FUNCTION conv.normalized_contact_email(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(NULLIF(regexp_replace(split_part(COALESCE(p_value, ''), ',', 1), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''));
$$;

CREATE OR REPLACE FUNCTION conv.normalized_contact_phone(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(p_value, ''), '\D', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION conv.dedup_website_form_opportunity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  email_key text := COALESCE(
    conv.normalized_contact_email(NEW."youXiang"),
    conv.normalized_contact_email(NEW."emailPrimaryEmail")
  );
  phone_key text := conv.normalized_contact_phone(NEW."phonePrimaryPhoneNumber");
  target_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW."deletedAt" IS NOT NULL
     OR NEW."keHuLaiYuan" IS NULL
     OR NEW."keHuLaiYuan"::text <> 'GUAN_WANG_BIAO_DAN'
     OR (email_key IS NULL AND phone_key IS NULL) THEN
    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    SELECT id
    FROM %I.opportunity AS target
    WHERE target."deletedAt" IS NULL
      AND target.id <> $1
      AND target."keHuLaiYuan" IS NOT NULL
      AND target."keHuLaiYuan"::text = 'GUAN_WANG_BIAO_DAN'
      AND (
        (
          $2::text IS NOT NULL
          AND $2::text = COALESCE(
            conv.normalized_contact_email(target."youXiang"),
            conv.normalized_contact_email(target."emailPrimaryEmail")
          )
        )
        OR (
          $3::text IS NOT NULL
          AND $3::text = conv.normalized_contact_phone(target."phonePrimaryPhoneNumber")
        )
      )
    ORDER BY target."createdAt" ASC, target.id ASC
    LIMIT 1
  $sql$, TG_TABLE_SCHEMA)
  INTO target_id
  USING NEW.id, email_key, phone_key;

  IF target_id IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    UPDATE %I.opportunity AS target
    SET
      name = COALESCE(NULLIF(($1).name, ''), target.name),
      "companyId" = COALESCE(($1)."companyId", target."companyId"),
      "pointOfContactId" = COALESCE(($1)."pointOfContactId", target."pointOfContactId"),
      "phonePrimaryPhoneNumber" = COALESCE(NULLIF(($1)."phonePrimaryPhoneNumber", ''), target."phonePrimaryPhoneNumber"),
      "phonePrimaryPhoneCountryCode" = COALESCE(NULLIF(($1)."phonePrimaryPhoneCountryCode", ''), target."phonePrimaryPhoneCountryCode"),
      "phonePrimaryPhoneCallingCode" = COALESCE(NULLIF(($1)."phonePrimaryPhoneCallingCode", ''), target."phonePrimaryPhoneCallingCode"),
      "emailPrimaryEmail" = COALESCE(NULLIF(($1)."emailPrimaryEmail", ''), target."emailPrimaryEmail"),
      "youXiang" = COALESCE(NULLIF(($1)."youXiang", ''), target."youXiang"),
      "countryAddressCountry" = COALESCE(NULLIF(($1)."countryAddressCountry", ''), target."countryAddressCountry"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), target."keHuXuQiuChanPin"),
      "message" = COALESCE(NULLIF(($1)."message", ''), target."message"),
      "guanWangLianJiePrimaryLinkUrl" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkUrl", ''), target."guanWangLianJiePrimaryLinkUrl"),
      "guanWangLianJiePrimaryLinkLabel" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkLabel", ''), target."guanWangLianJiePrimaryLinkLabel"),
      "guanWangLianJieSecondaryLinks" = COALESCE(($1)."guanWangLianJieSecondaryLinks", target."guanWangLianJieSecondaryLinks"),
      stage = 'XIANSUO'::%I.opportunity_stage_enum,
      "updatedAt" = now()
    WHERE target.id = $2
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW, target_id;

  EXECUTE format(
    'UPDATE %I.opportunity SET "deletedAt" = now(), "updatedAt" = now() WHERE id = $1',
    TG_TABLE_SCHEMA
  )
  USING NEW.id;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  ws text;
BEGIN
  FOR ws IN
    SELECT table_schema
    FROM information_schema.tables
    WHERE table_name = 'opportunity'
      AND table_schema LIKE 'workspace_%'
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS opportunity_website_form_email_idx ON %I.opportunity (conv.normalized_contact_email(COALESCE("youXiang", "emailPrimaryEmail"))) WHERE "deletedAt" IS NULL',
      ws
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS opportunity_website_form_phone_idx ON %I.opportunity (conv.normalized_contact_phone("phonePrimaryPhoneNumber")) WHERE "deletedAt" IS NULL',
      ws
    );
    EXECUTE format(
      'DROP TRIGGER IF EXISTS opportunity_website_form_contact_dedup_after_insert ON %I.opportunity',
      ws
    );
    EXECUTE format(
      'CREATE TRIGGER opportunity_website_form_contact_dedup_after_insert
       AFTER INSERT ON %I.opportunity
       FOR EACH ROW EXECUTE FUNCTION conv.dedup_website_form_opportunity()',
      ws
    );
  END LOOP;
END $$;

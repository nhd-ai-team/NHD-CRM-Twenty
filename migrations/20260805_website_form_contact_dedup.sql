-- 官网表单按邮箱 / 电话去重与提交历史沉淀（方案 C）。
-- 官网侧可能直接写入 Opportunity。为避免绕过 middleware，去重放在数据库触发器兜底：
-- 1. 仅处理客户来源为官网表单(GUAN_WANG_BIAO_DAN)的新线索。
-- 2. 首次提交正常保留为主线索；每次提交都写入 conv.website_form_submissions。
-- 3. 重复命中已有未删除线索时，只补齐主线索空字段，不覆盖已有非空核心字段。
-- 4. 主线索维护提交次数、首次/最近提交时间、最新表单快照；重复插入行软删除。
-- 5. 不合并、删除已有业务链编码；已有线索继续作为主记录。

CREATE SCHEMA IF NOT EXISTS conv;

CREATE TABLE IF NOT EXISTS conv.website_form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_opportunity_id UUID NOT NULL,
  duplicate_opportunity_id UUID,
  email_key TEXT,
  phone_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS website_form_submissions_primary_idx
  ON conv.website_form_submissions(primary_opportunity_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS website_form_submissions_email_idx
  ON conv.website_form_submissions(email_key)
  WHERE email_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS website_form_submissions_phone_idx
  ON conv.website_form_submissions(phone_key)
  WHERE phone_key IS NOT NULL;

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
  payload jsonb := jsonb_build_object(
    'opportunityId', NEW.id,
    'name', NEW.name,
    'companyId', NEW."companyId",
    'pointOfContactId', NEW."pointOfContactId",
    'phone', NEW."phonePrimaryPhoneNumber",
    'phoneCountryCode', NEW."phonePrimaryPhoneCountryCode",
    'phoneCallingCode', NEW."phonePrimaryPhoneCallingCode",
    'email', COALESCE(NEW."youXiang", NEW."emailPrimaryEmail"),
    'country', NEW."countryAddressCountry",
    'product', NEW."keHuXuQiuChanPin",
    'message', NEW."message",
    'websiteUrl', NEW."guanWangLianJiePrimaryLinkUrl",
    'websiteLabel', NEW."guanWangLianJiePrimaryLinkLabel",
    'source', CASE WHEN NEW."keHuLaiYuan" IS NULL THEN NULL ELSE NEW."keHuLaiYuan"::text END,
    'stage', CASE WHEN NEW.stage IS NULL THEN NULL ELSE NEW.stage::text END,
    'createdAt', NEW."createdAt"
  );
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
          AND conv.normalized_contact_phone(target."phonePrimaryPhoneNumber") IS NOT NULL
          AND (
            $3::text = conv.normalized_contact_phone(target."phonePrimaryPhoneNumber")
            OR (
              length($3::text) >= 8
              AND length(conv.normalized_contact_phone(target."phonePrimaryPhoneNumber")) >= 8
              AND right($3::text, LEAST(length($3::text), length(conv.normalized_contact_phone(target."phonePrimaryPhoneNumber"))))
                = right(conv.normalized_contact_phone(target."phonePrimaryPhoneNumber"), LEAST(length($3::text), length(conv.normalized_contact_phone(target."phonePrimaryPhoneNumber"))))
            )
          )
        )
      )
    ORDER BY target."createdAt" ASC, target.id ASC
    LIMIT 1
  $sql$, TG_TABLE_SCHEMA)
  INTO target_id
  USING NEW.id, email_key, phone_key;

  IF target_id IS NULL THEN
    EXECUTE format($sql$
      UPDATE %I.opportunity
      SET
        "websiteFormSubmissionCount" = COALESCE("websiteFormSubmissionCount", 0) + 1,
        "websiteFormFirstSubmittedAt" = COALESCE("websiteFormFirstSubmittedAt", ($1)."createdAt", now()),
        "websiteFormLastSubmittedAt" = COALESCE(($1)."createdAt", now()),
        "websiteFormLatestSnapshot" = $2,
        "updatedAt" = now()
      WHERE id = ($1).id
    $sql$, TG_TABLE_SCHEMA)
    USING NEW, payload;

    INSERT INTO conv.website_form_submissions(
      primary_opportunity_id,
      duplicate_opportunity_id,
      email_key,
      phone_key,
      payload,
      submitted_at
    )
    VALUES (NEW.id, NULL, email_key, phone_key, payload, COALESCE(NEW."createdAt", now()));

    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    UPDATE %I.opportunity AS target
    SET
      name = COALESCE(NULLIF(target.name, ''), NULLIF(($1).name, '')),
      "companyId" = COALESCE(target."companyId", ($1)."companyId"),
      "pointOfContactId" = COALESCE(target."pointOfContactId", ($1)."pointOfContactId"),
      "phonePrimaryPhoneNumber" = COALESCE(NULLIF(target."phonePrimaryPhoneNumber", ''), NULLIF(($1)."phonePrimaryPhoneNumber", '')),
      "phonePrimaryPhoneCountryCode" = COALESCE(NULLIF(target."phonePrimaryPhoneCountryCode", ''), NULLIF(($1)."phonePrimaryPhoneCountryCode", '')),
      "phonePrimaryPhoneCallingCode" = COALESCE(NULLIF(target."phonePrimaryPhoneCallingCode", ''), NULLIF(($1)."phonePrimaryPhoneCallingCode", '')),
      "emailPrimaryEmail" = COALESCE(NULLIF(target."emailPrimaryEmail", ''), NULLIF(($1)."emailPrimaryEmail", '')),
      "youXiang" = COALESCE(NULLIF(target."youXiang", ''), NULLIF(($1)."youXiang", '')),
      "countryAddressCountry" = COALESCE(NULLIF(target."countryAddressCountry", ''), NULLIF(($1)."countryAddressCountry", '')),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(target."keHuXuQiuChanPin", ''), NULLIF(($1)."keHuXuQiuChanPin", '')),
      "message" = COALESCE(NULLIF(target."message", ''), NULLIF(($1)."message", '')),
      "guanWangLianJiePrimaryLinkUrl" = COALESCE(NULLIF(target."guanWangLianJiePrimaryLinkUrl", ''), NULLIF(($1)."guanWangLianJiePrimaryLinkUrl", '')),
      "guanWangLianJiePrimaryLinkLabel" = COALESCE(NULLIF(target."guanWangLianJiePrimaryLinkLabel", ''), NULLIF(($1)."guanWangLianJiePrimaryLinkLabel", '')),
      "guanWangLianJieSecondaryLinks" = COALESCE(target."guanWangLianJieSecondaryLinks", ($1)."guanWangLianJieSecondaryLinks"),
      stage = 'XIANSUO'::%I.opportunity_stage_enum,
      "websiteFormSubmissionCount" = GREATEST(COALESCE(target."websiteFormSubmissionCount", 0), 1) + 1,
      "websiteFormFirstSubmittedAt" = COALESCE(target."websiteFormFirstSubmittedAt", target."createdAt", ($1)."createdAt", now()),
      "websiteFormLastSubmittedAt" = COALESCE(($1)."createdAt", now()),
      "websiteFormLatestSnapshot" = $3,
      "updatedAt" = now()
    WHERE target.id = $2
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW, target_id, payload;

  INSERT INTO conv.website_form_submissions(
    primary_opportunity_id,
    duplicate_opportunity_id,
    email_key,
    phone_key,
    payload,
    submitted_at
  )
  VALUES (target_id, NEW.id, email_key, phone_key, payload, COALESCE(NEW."createdAt", now()));

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
      'ALTER TABLE %I.opportunity ADD COLUMN IF NOT EXISTS "websiteFormSubmissionCount" integer NOT NULL DEFAULT 0',
      ws
    );
    EXECUTE format(
      'ALTER TABLE %I.opportunity ADD COLUMN IF NOT EXISTS "websiteFormFirstSubmittedAt" timestamptz',
      ws
    );
    EXECUTE format(
      'ALTER TABLE %I.opportunity ADD COLUMN IF NOT EXISTS "websiteFormLastSubmittedAt" timestamptz',
      ws
    );
    EXECUTE format(
      'ALTER TABLE %I.opportunity ADD COLUMN IF NOT EXISTS "websiteFormLatestSnapshot" jsonb',
      ws
    );
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

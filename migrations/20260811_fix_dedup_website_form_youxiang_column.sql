-- 修复：官网表单建单全部 500「Data validation error」
-- 触发器 conv.dedup_website_form_opportunity 引用了一批 opportunity 已不存在的列，
-- 导致每次 INSERT opportunity（尤其 source=GUAN_WANG_BIAO_DAN 的官网表单）在 AFTER INSERT
-- 阶段报 record "new" has no field ...，整体阻断建单。
--
-- 背景：8-11 字段改名后 opportunity 的真实列为：
--   邮箱  = youXiangPrimaryEmail / youXiangAdditionalEmails（不再有 emailPrimaryEmail）
--   电话  = whatsappPrimaryPhoneNumber / ...CountryCode / ...CallingCode（不再有 phone*）
--   国家  = guoJiaDiQuAddressCountry（不再有 countryAddressCountry）
--   备注  = 无 message 列（已移除）
-- 20260811_fix_shared_field_sync_current_schema.sql 只更新了 sync_from_opportunity，
-- 漏了本 dedup 函数。本迁移把其列引用对齐到当前 schema，去重/合并逻辑保持不变。

CREATE OR REPLACE FUNCTION conv.dedup_website_form_opportunity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  email_key text := conv.normalized_contact_email(NEW."youXiangPrimaryEmail");
  phone_key text := conv.normalized_contact_phone(NEW."whatsappPrimaryPhoneNumber");
  target_id uuid;
  payload jsonb := jsonb_build_object(
    'opportunityId', NEW.id,
    'name', NEW.name,
    'companyId', NEW."companyId",
    'pointOfContactId', NEW."pointOfContactId",
    'phone', NEW."whatsappPrimaryPhoneNumber",
    'phoneCountryCode', NEW."whatsappPrimaryPhoneCountryCode",
    'phoneCallingCode', NEW."whatsappPrimaryPhoneCallingCode",
    'email', NEW."youXiangPrimaryEmail",
    'country', NEW."guoJiaDiQuAddressCountry",
    'product', NEW."keHuXuQiuChanPin",
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
      AND target."keHuLaiYuan" IS NOT NULL
      AND target."keHuLaiYuan"::text = 'GUAN_WANG_BIAO_DAN'
      AND (
        (
          $2::text IS NOT NULL
          AND $2::text = conv.normalized_contact_email(target."youXiangPrimaryEmail")
        )
        OR (
          $3::text IS NOT NULL
          AND conv.normalized_contact_phone(target."whatsappPrimaryPhoneNumber") IS NOT NULL
          AND (
            $3::text = conv.normalized_contact_phone(target."whatsappPrimaryPhoneNumber")
            OR (
              length($3::text) >= 8
              AND length(conv.normalized_contact_phone(target."whatsappPrimaryPhoneNumber")) >= 8
              AND right($3::text, LEAST(length($3::text), length(conv.normalized_contact_phone(target."whatsappPrimaryPhoneNumber"))))
                = right(conv.normalized_contact_phone(target."whatsappPrimaryPhoneNumber"), LEAST(length($3::text), length(conv.normalized_contact_phone(target."whatsappPrimaryPhoneNumber"))))
            )
          )
        )
      )
    ORDER BY target."createdAt" ASC, target.id ASC
    LIMIT 1
  $sql$, TG_TABLE_SCHEMA)
  INTO target_id
  USING NEW.id, email_key, phone_key;

  IF target_id IS NULL OR target_id = NEW.id THEN
    EXECUTE format($sql$
      UPDATE %I.opportunity
      SET
        "websiteFormSubmissionCount" = GREATEST(COALESCE("websiteFormSubmissionCount", 0), 1),
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

    EXECUTE format($sql$
      UPDATE %I.opportunity AS target
      SET
        "websiteFormSubmissionCount" = stats.submission_count,
        "websiteFormFirstSubmittedAt" = stats.first_submitted_at,
        "websiteFormLastSubmittedAt" = stats.last_submitted_at,
        "websiteFormLatestSnapshot" = stats.latest_payload,
        "updatedAt" = now()
      FROM (
        SELECT
          count(*)::integer AS submission_count,
          min(submitted_at) AS first_submitted_at,
          max(submitted_at) AS last_submitted_at,
          (array_agg(payload ORDER BY submitted_at DESC, created_at DESC))[1] AS latest_payload
        FROM conv.website_form_submissions
        WHERE primary_opportunity_id = $1
      ) AS stats
      WHERE target.id = $1
    $sql$, TG_TABLE_SCHEMA)
    USING NEW.id;

    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    UPDATE %I.opportunity AS target
    SET
      name = COALESCE(NULLIF(target.name, ''), NULLIF(($1).name, '')),
      "companyId" = COALESCE(target."companyId", ($1)."companyId"),
      "pointOfContactId" = COALESCE(target."pointOfContactId", ($1)."pointOfContactId"),
      "whatsappPrimaryPhoneNumber" = COALESCE(NULLIF(target."whatsappPrimaryPhoneNumber", ''), NULLIF(($1)."whatsappPrimaryPhoneNumber", '')),
      "whatsappPrimaryPhoneCountryCode" = COALESCE(NULLIF(target."whatsappPrimaryPhoneCountryCode", ''), NULLIF(($1)."whatsappPrimaryPhoneCountryCode", '')),
      "whatsappPrimaryPhoneCallingCode" = COALESCE(NULLIF(target."whatsappPrimaryPhoneCallingCode", ''), NULLIF(($1)."whatsappPrimaryPhoneCallingCode", '')),
      "youXiangPrimaryEmail" = COALESCE(NULLIF(target."youXiangPrimaryEmail", ''), NULLIF(($1)."youXiangPrimaryEmail", '')),
      "guoJiaDiQuAddressCountry" = COALESCE(NULLIF(target."guoJiaDiQuAddressCountry", ''), NULLIF(($1)."guoJiaDiQuAddressCountry", '')),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(target."keHuXuQiuChanPin", ''), NULLIF(($1)."keHuXuQiuChanPin", '')),
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

  EXECUTE format($sql$
    UPDATE %I.opportunity AS target
    SET
      "websiteFormSubmissionCount" = stats.submission_count,
      "websiteFormFirstSubmittedAt" = stats.first_submitted_at,
      "websiteFormLastSubmittedAt" = stats.last_submitted_at,
      "websiteFormLatestSnapshot" = stats.latest_payload,
      "updatedAt" = now()
    FROM (
      SELECT
        count(*)::integer AS submission_count,
        min(submitted_at) AS first_submitted_at,
        max(submitted_at) AS last_submitted_at,
        (array_agg(payload ORDER BY submitted_at DESC, created_at DESC))[1] AS latest_payload
      FROM conv.website_form_submissions
      WHERE primary_opportunity_id = $1
    ) AS stats
    WHERE target.id = $1
  $sql$, TG_TABLE_SCHEMA)
  USING target_id;

  RETURN NEW;
END;
$function$;

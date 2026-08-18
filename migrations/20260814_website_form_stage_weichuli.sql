-- 官网表单线索初始进度统一为「未处理线索」(WEI_CHU_LI_XIANSUO)
-- 根因：两个触发器把 stage 设成/改回 XIANSUO(线索)：
--   ① default_website_form_opportunity_stage (BEFORE INSERT)：对官网表单单
--      无条件 NEW.stage := 'XIANSUO'，覆盖 middleware/REST 传入值 —— 新单的真正来源。
--   ② dedup_website_form_opportunity 去重合并分支：硬编码 stage='XIANSUO' —— 重复询盘合并时。
-- 修复：两处均改为 WEI_CHU_LI_XIANSUO。dedup 的新线索分支原本不碰 stage，无需改动。

-- ① 源头：官网表单单默认进度改为「未处理线索」
CREATE OR REPLACE FUNCTION conv.default_website_form_opportunity_stage()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."keHuLaiYuan" IS NULL
     AND NEW."createdBySource" IS NOT NULL
     AND NEW."createdBySource"::text = 'API' THEN
    NEW."keHuLaiYuan" := 'GUAN_WANG_BIAO_DAN';
  END IF;

  IF NEW."keHuLaiYuan" IS NOT NULL
     AND NEW."keHuLaiYuan"::text = 'GUAN_WANG_BIAO_DAN' THEN
    NEW.stage := 'WEI_CHU_LI_XIANSUO';
  END IF;
  RETURN NEW;
END;
$function$;

-- ② 去重合并分支：把 stage='XIANSUO' 改成 'WEI_CHU_LI_XIANSUO'
--    （仅此一处字符串改动，其余逻辑与线上一致）
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
      stage = 'WEI_CHU_LI_XIANSUO'::%I.opportunity_stage_enum,
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

-- ③ 回填：现有官网表单线索里仍是「线索(XIANSUO)」的，改为「未处理线索」
UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity
SET stage = 'WEI_CHU_LI_XIANSUO'::workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity_stage_enum,
    "updatedAt" = now()
WHERE "keHuLaiYuan"::text = 'GUAN_WANG_BIAO_DAN'
  AND "deletedAt" IS NULL
  AND stage = 'XIANSUO'::workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity_stage_enum;

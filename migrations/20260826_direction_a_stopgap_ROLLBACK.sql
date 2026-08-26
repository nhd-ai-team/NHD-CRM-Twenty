-- 回滚：还原三个同步函数原版 + 主列 label 复原
CREATE OR REPLACE FUNCTION conv.sync_from_person()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    UPDATE %I.opportunity AS target
    SET
      "syncGroupCode" = COALESCE(target."syncGroupCode", ($1)."syncGroupCode"),
      "linkedPersonId" = COALESCE(target."linkedPersonId", ($1).id),
      "pointOfContactId" = COALESCE(target."pointOfContactId", ($1).id),
      name = COALESCE(NULLIF(($1)."gongSiMingCheng", ''), target.name),
      "companyId" = COALESCE(($1)."companyId", target."companyId"),
      "whatsappPrimaryPhoneNumber" = COALESCE(NULLIF(($1)."phonesPrimaryPhoneNumber", ''), target."whatsappPrimaryPhoneNumber"),
      "whatsappPrimaryPhoneCountryCode" = COALESCE(NULLIF(($1)."phonesPrimaryPhoneCountryCode", ''), target."whatsappPrimaryPhoneCountryCode"),
      "whatsappPrimaryPhoneCallingCode" = COALESCE(NULLIF(($1)."phonesPrimaryPhoneCallingCode", ''), target."whatsappPrimaryPhoneCallingCode"),
      "youXiangPrimaryEmail" = COALESCE(NULLIF(($1)."emailsPrimaryEmail", ''), target."youXiangPrimaryEmail"),
      "guoJiaDiQuAddressStreet1" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet1", ''), target."guoJiaDiQuAddressStreet1"),
      "guoJiaDiQuAddressStreet2" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet2", ''), target."guoJiaDiQuAddressStreet2"),
      "guoJiaDiQuAddressCity" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCity", ''), target."guoJiaDiQuAddressCity"),
      "guoJiaDiQuAddressState" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressState", ''), target."guoJiaDiQuAddressState"),
      "guoJiaDiQuAddressPostcode" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressPostcode", ''), target."guoJiaDiQuAddressPostcode"),
      "guoJiaDiQuAddressCountry" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCountry", ''), target."guoJiaDiQuAddressCountry"),
      "guoJiaDiQuAddressLat" = COALESCE(($1)."guoJiaDiQuAddressLat", target."guoJiaDiQuAddressLat"),
      "guoJiaDiQuAddressLng" = COALESCE(($1)."guoJiaDiQuAddressLng", target."guoJiaDiQuAddressLng"),
      "guanWangLianJiePrimaryLinkUrl" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkUrl", ''), target."guanWangLianJiePrimaryLinkUrl"),
      "guanWangLianJiePrimaryLinkLabel" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkLabel", ''), target."guanWangLianJiePrimaryLinkLabel"),
      "guanWangLianJieSecondaryLinks" = COALESCE(($1)."guanWangLianJieSecondaryLinks", target."guanWangLianJieSecondaryLinks"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), target."keHuXuQiuChanPin"),
      "keHuLaiYuan" = CASE
        WHEN conv.person_source_to_opportunity_source(($1)."keHuLaiYuan"::text) IS NULL THEN target."keHuLaiYuan"
        ELSE conv.person_source_to_opportunity_source(($1)."keHuLaiYuan"::text)::%I."opportunity_keHuLaiYuan_enum"
      END,
      "gongSiLeiXing" = CASE
        WHEN conv.person_type_to_opportunity_type(($1)."keHuLeiXing"::text) IS NULL THEN target."gongSiLeiXing"
        ELSE conv.person_type_to_opportunity_type(($1)."keHuLeiXing"::text)::%I."opportunity_gongSiLeiXing_enum"
      END,
      "zhiWei" = COALESCE(NULLIF(($1)."jobTitle", ''), target."zhiWei"),
      "genJinJiLuMarkdown" = COALESCE(NULLIF(($1)."genJinJiLuMarkdown", ''), target."genJinJiLuMarkdown"),
      "genJinJiLuBlocknote" = COALESCE(NULLIF(($1)."genJinJiLuBlocknote", ''), target."genJinJiLuBlocknote"),
      "updatedAt" = now()
    WHERE target."deletedAt" IS NULL
      AND (
        target."syncGroupCode" = ($1)."syncGroupCode"
        OR target.id = ($1)."sourceOpportunityId"
        OR target."linkedPersonId" = ($1).id
        OR target."pointOfContactId" = ($1).id
      )
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW;

  EXECUTE format($sql$
    UPDATE %I."_xiangMu" AS target
    SET
      "syncGroupCode" = COALESCE(target."syncGroupCode", ($1)."syncGroupCode"),
      "linkedPersonId" = COALESCE(target."linkedPersonId", ($1).id),
      "sourceOpportunityId" = COALESCE(target."sourceOpportunityId", ($1)."sourceOpportunityId"),
      name = COALESCE(NULLIF(($1)."gongSiMingCheng", ''), target.name),
      "leadNo" = COALESCE(NULLIF(($1)."leadNo", ''), target."leadNo"),
      "guoJiaDiQuAddressStreet1" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet1", ''), target."guoJiaDiQuAddressStreet1"),
      "guoJiaDiQuAddressStreet2" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet2", ''), target."guoJiaDiQuAddressStreet2"),
      "guoJiaDiQuAddressCity" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCity", ''), target."guoJiaDiQuAddressCity"),
      "guoJiaDiQuAddressState" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressState", ''), target."guoJiaDiQuAddressState"),
      "guoJiaDiQuAddressPostcode" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressPostcode", ''), target."guoJiaDiQuAddressPostcode"),
      "guoJiaDiQuAddressCountry" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCountry", ''), target."guoJiaDiQuAddressCountry"),
      "guoJiaDiQuAddressLat" = COALESCE(($1)."guoJiaDiQuAddressLat", target."guoJiaDiQuAddressLat"),
      "guoJiaDiQuAddressLng" = COALESCE(($1)."guoJiaDiQuAddressLng", target."guoJiaDiQuAddressLng"),
      "guanWangLianJiePrimaryLinkUrl" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkUrl", ''), target."guanWangLianJiePrimaryLinkUrl"),
      "guanWangLianJiePrimaryLinkLabel" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkLabel", ''), target."guanWangLianJiePrimaryLinkLabel"),
      "guanWangLianJieSecondaryLinks" = COALESCE(($1)."guanWangLianJieSecondaryLinks", target."guanWangLianJieSecondaryLinks"),
      "xuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), target."xuQiuChanPin"),
      "genJinJiLuMarkdown" = COALESCE(NULLIF(($1)."genJinJiLuMarkdown", ''), target."genJinJiLuMarkdown"),
      "genJinJiLuBlocknote" = COALESCE(NULLIF(($1)."genJinJiLuBlocknote", ''), target."genJinJiLuBlocknote"),
      "updatedAt" = now()
    WHERE target."deletedAt" IS NULL
      AND (target."syncGroupCode" = ($1)."syncGroupCode" OR target."linkedPersonId" = ($1).id)
  $sql$, TG_TABLE_SCHEMA)
  USING NEW;

  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION conv.sync_from_opportunity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    UPDATE %I.person AS target
    SET
      "syncGroupCode" = COALESCE(target."syncGroupCode", ($1)."syncGroupCode"),
      "sourceOpportunityId" = COALESCE(target."sourceOpportunityId", ($1).id),
      "linkedProjectId" = COALESCE(target."linkedProjectId", ($1)."linkedProjectId"),
      "gongSiMingCheng" = COALESCE(NULLIF(($1).name, ''), target."gongSiMingCheng"),
      "companyId" = COALESCE(($1)."companyId", target."companyId"),
      "phonesPrimaryPhoneNumber" = COALESCE(NULLIF(($1)."whatsappPrimaryPhoneNumber", ''), target."phonesPrimaryPhoneNumber"),
      "phonesPrimaryPhoneCountryCode" = COALESCE(NULLIF(($1)."whatsappPrimaryPhoneCountryCode", ''), target."phonesPrimaryPhoneCountryCode"),
      "phonesPrimaryPhoneCallingCode" = COALESCE(NULLIF(($1)."whatsappPrimaryPhoneCallingCode", ''), target."phonesPrimaryPhoneCallingCode"),
      "emailsPrimaryEmail" = CASE
        WHEN NULLIF(($1)."youXiangPrimaryEmail", '') IS NULL THEN target."emailsPrimaryEmail"
        WHEN NOT EXISTS (
          SELECT 1 FROM %I.person AS other
          WHERE other."deletedAt" IS NULL
            AND lower(other."emailsPrimaryEmail") = lower(($1)."youXiangPrimaryEmail")
            AND other.id <> target.id
        ) THEN ($1)."youXiangPrimaryEmail"
        ELSE target."emailsPrimaryEmail"
      END,
      "guoJiaDiQuAddressStreet1" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet1", ''), target."guoJiaDiQuAddressStreet1"),
      "guoJiaDiQuAddressStreet2" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet2", ''), target."guoJiaDiQuAddressStreet2"),
      "guoJiaDiQuAddressCity" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCity", ''), target."guoJiaDiQuAddressCity"),
      "guoJiaDiQuAddressState" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressState", ''), target."guoJiaDiQuAddressState"),
      "guoJiaDiQuAddressPostcode" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressPostcode", ''), target."guoJiaDiQuAddressPostcode"),
      "guoJiaDiQuAddressCountry" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCountry", ''), target."guoJiaDiQuAddressCountry"),
      "guoJiaDiQuAddressLat" = COALESCE(($1)."guoJiaDiQuAddressLat", target."guoJiaDiQuAddressLat"),
      "guoJiaDiQuAddressLng" = COALESCE(($1)."guoJiaDiQuAddressLng", target."guoJiaDiQuAddressLng"),
      "guanWangLianJiePrimaryLinkUrl" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkUrl", ''), target."guanWangLianJiePrimaryLinkUrl"),
      "guanWangLianJiePrimaryLinkLabel" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkLabel", ''), target."guanWangLianJiePrimaryLinkLabel"),
      "guanWangLianJieSecondaryLinks" = COALESCE(($1)."guanWangLianJieSecondaryLinks", target."guanWangLianJieSecondaryLinks"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), target."keHuXuQiuChanPin"),
      "keHuLaiYuan" = CASE
        WHEN ($1)."keHuLaiYuan" IS NULL THEN target."keHuLaiYuan"
        ELSE (($1)."keHuLaiYuan"::text)::%I."person_keHuLaiYuan_enum"
      END,
      "keHuLeiXing" = CASE
        WHEN ($1)."gongSiLeiXing" IS NULL THEN target."keHuLeiXing"
        ELSE (($1)."gongSiLeiXing"::text)::%I."person_keHuLeiXing_enum"
      END,
      "jobTitle" = COALESCE(NULLIF(($1)."zhiWei", ''), target."jobTitle"),
      "genJinJiLuMarkdown" = COALESCE(NULLIF(($1)."genJinJiLuMarkdown", ''), target."genJinJiLuMarkdown"),
      "genJinJiLuBlocknote" = COALESCE(NULLIF(($1)."genJinJiLuBlocknote", ''), target."genJinJiLuBlocknote"),
      "updatedAt" = now()
    WHERE target."deletedAt" IS NULL
      AND (target."syncGroupCode" = ($1)."syncGroupCode" OR target.id = ($1)."pointOfContactId")
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW;

  EXECUTE format($sql$
    UPDATE %I."_xiangMu" AS target
    SET
      "syncGroupCode" = COALESCE(target."syncGroupCode", ($1)."syncGroupCode"),
      "sourceOpportunityId" = COALESCE(target."sourceOpportunityId", ($1).id),
      "linkedPersonId" = COALESCE(target."linkedPersonId", ($1)."linkedPersonId", ($1)."pointOfContactId"),
      name = COALESCE(NULLIF(($1).name, ''), target.name),
      "guoJiaDiQuAddressStreet1" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet1", ''), target."guoJiaDiQuAddressStreet1"),
      "guoJiaDiQuAddressStreet2" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet2", ''), target."guoJiaDiQuAddressStreet2"),
      "guoJiaDiQuAddressCity" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCity", ''), target."guoJiaDiQuAddressCity"),
      "guoJiaDiQuAddressState" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressState", ''), target."guoJiaDiQuAddressState"),
      "guoJiaDiQuAddressPostcode" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressPostcode", ''), target."guoJiaDiQuAddressPostcode"),
      "guoJiaDiQuAddressCountry" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCountry", ''), target."guoJiaDiQuAddressCountry"),
      "guoJiaDiQuAddressLat" = COALESCE(($1)."guoJiaDiQuAddressLat", target."guoJiaDiQuAddressLat"),
      "guoJiaDiQuAddressLng" = COALESCE(($1)."guoJiaDiQuAddressLng", target."guoJiaDiQuAddressLng"),
      "guanWangLianJiePrimaryLinkUrl" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkUrl", ''), target."guanWangLianJiePrimaryLinkUrl"),
      "guanWangLianJiePrimaryLinkLabel" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkLabel", ''), target."guanWangLianJiePrimaryLinkLabel"),
      "guanWangLianJieSecondaryLinks" = COALESCE(($1)."guanWangLianJieSecondaryLinks", target."guanWangLianJieSecondaryLinks"),
      "xuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), target."xuQiuChanPin"),
      "genJinJiLuMarkdown" = COALESCE(NULLIF(($1)."genJinJiLuMarkdown", ''), target."genJinJiLuMarkdown"),
      "genJinJiLuBlocknote" = COALESCE(NULLIF(($1)."genJinJiLuBlocknote", ''), target."genJinJiLuBlocknote"),
      "jinEAmountMicros" = COALESCE(($1)."amountAmountMicros", target."jinEAmountMicros"),
      "jinECurrencyCode" = COALESCE(NULLIF(($1)."amountCurrencyCode", ''), target."jinECurrencyCode"),
      "renWuJinDu" = CASE
        WHEN conv.opportunity_stage_to_project_task(($1).stage::text) IS NULL THEN target."renWuJinDu"
        ELSE conv.opportunity_stage_to_project_task(($1).stage::text)::%I."_xiangMu_renWuJinDu_enum"
      END,
      "updatedAt" = now()
    WHERE target."deletedAt" IS NULL
      AND target."syncGroupCode" = ($1)."syncGroupCode"
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW;

  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION conv.sync_from_project()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    UPDATE %I.opportunity AS target
    SET
      "syncGroupCode" = COALESCE(target."syncGroupCode", ($1)."syncGroupCode"),
      "linkedProjectId" = COALESCE(target."linkedProjectId", ($1).id),
      name = COALESCE(NULLIF(($1).name, ''), target.name),
      "guoJiaDiQuAddressStreet1" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet1", ''), target."guoJiaDiQuAddressStreet1"),
      "guoJiaDiQuAddressStreet2" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet2", ''), target."guoJiaDiQuAddressStreet2"),
      "guoJiaDiQuAddressCity" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCity", ''), target."guoJiaDiQuAddressCity"),
      "guoJiaDiQuAddressState" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressState", ''), target."guoJiaDiQuAddressState"),
      "guoJiaDiQuAddressPostcode" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressPostcode", ''), target."guoJiaDiQuAddressPostcode"),
      "guoJiaDiQuAddressCountry" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCountry", ''), target."guoJiaDiQuAddressCountry"),
      "guoJiaDiQuAddressLat" = COALESCE(($1)."guoJiaDiQuAddressLat", target."guoJiaDiQuAddressLat"),
      "guoJiaDiQuAddressLng" = COALESCE(($1)."guoJiaDiQuAddressLng", target."guoJiaDiQuAddressLng"),
      "guanWangLianJiePrimaryLinkUrl" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkUrl", ''), target."guanWangLianJiePrimaryLinkUrl"),
      "guanWangLianJiePrimaryLinkLabel" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkLabel", ''), target."guanWangLianJiePrimaryLinkLabel"),
      "guanWangLianJieSecondaryLinks" = COALESCE(($1)."guanWangLianJieSecondaryLinks", target."guanWangLianJieSecondaryLinks"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."xuQiuChanPin", ''), target."keHuXuQiuChanPin"),
      "genJinJiLuMarkdown" = COALESCE(NULLIF(($1)."genJinJiLuMarkdown", ''), target."genJinJiLuMarkdown"),
      "genJinJiLuBlocknote" = COALESCE(NULLIF(($1)."genJinJiLuBlocknote", ''), target."genJinJiLuBlocknote"),
      "amountAmountMicros" = COALESCE(($1)."jinEAmountMicros", target."amountAmountMicros"),
      "amountCurrencyCode" = COALESCE(NULLIF(($1)."jinECurrencyCode", ''), target."amountCurrencyCode"),
      stage = CASE
        WHEN conv.project_task_to_opportunity_stage(($1)."renWuJinDu"::text) IS NULL THEN target.stage
        ELSE conv.project_task_to_opportunity_stage(($1)."renWuJinDu"::text)::%I."opportunity_stage_enum"
      END,
      "updatedAt" = now()
    WHERE target."deletedAt" IS NULL
      AND (target."syncGroupCode" = ($1)."syncGroupCode" OR target.id = ($1)."sourceOpportunityId")
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW;

  EXECUTE format($sql$
    UPDATE %I.person AS target
    SET
      "syncGroupCode" = COALESCE(target."syncGroupCode", ($1)."syncGroupCode"),
      "linkedProjectId" = COALESCE(target."linkedProjectId", ($1).id),
      "sourceOpportunityId" = COALESCE(target."sourceOpportunityId", ($1)."sourceOpportunityId"),
      "gongSiMingCheng" = COALESCE(NULLIF(($1).name, ''), target."gongSiMingCheng"),
      "leadNo" = COALESCE(NULLIF(($1)."leadNo", ''), target."leadNo"),
      "guoJiaDiQuAddressStreet1" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet1", ''), target."guoJiaDiQuAddressStreet1"),
      "guoJiaDiQuAddressStreet2" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressStreet2", ''), target."guoJiaDiQuAddressStreet2"),
      "guoJiaDiQuAddressCity" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCity", ''), target."guoJiaDiQuAddressCity"),
      "guoJiaDiQuAddressState" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressState", ''), target."guoJiaDiQuAddressState"),
      "guoJiaDiQuAddressPostcode" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressPostcode", ''), target."guoJiaDiQuAddressPostcode"),
      "guoJiaDiQuAddressCountry" = COALESCE(NULLIF(($1)."guoJiaDiQuAddressCountry", ''), target."guoJiaDiQuAddressCountry"),
      "guoJiaDiQuAddressLat" = COALESCE(($1)."guoJiaDiQuAddressLat", target."guoJiaDiQuAddressLat"),
      "guoJiaDiQuAddressLng" = COALESCE(($1)."guoJiaDiQuAddressLng", target."guoJiaDiQuAddressLng"),
      "guanWangLianJiePrimaryLinkUrl" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkUrl", ''), target."guanWangLianJiePrimaryLinkUrl"),
      "guanWangLianJiePrimaryLinkLabel" = COALESCE(NULLIF(($1)."guanWangLianJiePrimaryLinkLabel", ''), target."guanWangLianJiePrimaryLinkLabel"),
      "guanWangLianJieSecondaryLinks" = COALESCE(($1)."guanWangLianJieSecondaryLinks", target."guanWangLianJieSecondaryLinks"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."xuQiuChanPin", ''), target."keHuXuQiuChanPin"),
      "genJinJiLuMarkdown" = COALESCE(NULLIF(($1)."genJinJiLuMarkdown", ''), target."genJinJiLuMarkdown"),
      "genJinJiLuBlocknote" = COALESCE(NULLIF(($1)."genJinJiLuBlocknote", ''), target."genJinJiLuBlocknote"),
      "updatedAt" = now()
    WHERE target."deletedAt" IS NULL
      AND (target."syncGroupCode" = ($1)."syncGroupCode" OR target.id = ($1)."linkedPersonId")
  $sql$, TG_TABLE_SCHEMA)
  USING NEW;

  RETURN NEW;
END;
$function$

;

-- 主列 label 复原（label列原为「公司名称」，override 原为「访客ID」）
UPDATE core."fieldMetadata" SET label='公司名称', "standardOverrides"=jsonb_set(COALESCE("standardOverrides",'{}'::jsonb),'{label}','"访客ID"') WHERE "objectMetadataId"='23e6327b-0663-4499-9293-76f362c4d33b' AND name='name';

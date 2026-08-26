-- 方向A：项目主列 name 与「公司名称」解耦（对齐一期对线索 name 的处理）
-- 现状：conv.sync_from_person 把 person.gongSiMingCheng 灌进 项目.name；
--       conv.sync_from_project 把 项目.name 灌回 person.gongSiMingCheng。
--       => 项目主列实际存的是公司名，故旧标签叫「公司名称」。
-- 本迁移：从这两个函数各删除一行 name<->gongSiMingCheng 同步，让 项目.name 成为自由的项目标题。
--       公司真相仍走 company 关系 + companyId 三表同步（不受影响）。
-- 其余同步逻辑（companyId / 地址 / 跟进 / leadNo / 阶段等）保持 phase2 版本不变。
-- 回滚：重跑 migrations/20260826_direction_a_phase2_project_companyId_sync.sql 恢复这两行。
-- 存量 85 条项目的 name 旧值（公司名）保留、不回填不清空。

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
      "companyId" = COALESCE(($1)."companyId", target."companyId"),
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
      "companyId" = COALESCE(($1)."companyId", target."companyId"),
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
      "companyId" = COALESCE(($1)."companyId", target."companyId"),
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

-- 项目主列 name 显示名 -> 「项目名称」（底层 id 不变）
UPDATE core."fieldMetadata"
SET label = '项目名称',
    "standardOverrides" = jsonb_set(COALESCE("standardOverrides",'{}'::jsonb), '{label}', '"项目名称"')
WHERE "objectMetadataId" = '2fcf7216-6745-4824-820e-79e71e8249e0' AND name = 'name';

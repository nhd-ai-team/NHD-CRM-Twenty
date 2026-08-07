-- 修复三表同步触发器：People 的国家字段已由 country 改名为 guoJia，
-- 原 20260731_sync_group.sql 里硬编码的 person."country" 导致所有
-- opportunity/person/project 写入都因 "column country does not exist" 失败。
-- 本迁移仅重建三个同步函数，把 person 侧的 country 引用改为 guoJia，其余逻辑不变。
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
      "guoJia" = COALESCE(NULLIF(($1)."countryAddressCountry", ''), "guoJia"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), "keHuXuQiuChanPin"),
      "keHuLaiYuan" = CASE
        WHEN ($1)."keHuLaiYuan" IS NULL THEN "keHuLaiYuan"
        ELSE (($1)."keHuLaiYuan"::text)::%I."person_keHuLaiYuan_enum"
      END,
      "jobTitle" = COALESCE(NULLIF(($1)."zhiWei", ''), "jobTitle"),
      "updatedAt" = now()
    WHERE "deletedAt" IS NULL
      AND ("syncGroupCode" = ($1)."syncGroupCode" OR target.id = ($1)."pointOfContactId")
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW;

  EXECUTE format($sql$
    UPDATE %I."_xiangMu"
    SET
      "syncGroupCode" = COALESCE("syncGroupCode", ($1)."syncGroupCode"),
      "sourceOpportunityId" = COALESCE("sourceOpportunityId", ($1).id),
      "linkedPersonId" = COALESCE("linkedPersonId", ($1)."linkedPersonId", ($1)."pointOfContactId"),
      name = COALESCE(NULLIF(($1).name, ''), name),
      "guoJia" = COALESCE(NULLIF(($1)."countryAddressCountry", ''), "guoJia"),
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
      "countryAddressCountry" = COALESCE(NULLIF(($1)."guoJia", ''), "countryAddressCountry"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), "keHuXuQiuChanPin"),
      "keHuLaiYuan" = CASE
        WHEN ($1)."keHuLaiYuan" IS NULL THEN "keHuLaiYuan"
        ELSE (($1)."keHuLaiYuan"::text)::%I."opportunity_keHuLaiYuan_enum"
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
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  USING NEW;

  EXECUTE format($sql$
    UPDATE %I."_xiangMu"
    SET
      "syncGroupCode" = COALESCE("syncGroupCode", ($1)."syncGroupCode"),
      "linkedPersonId" = COALESCE("linkedPersonId", ($1).id),
      "sourceOpportunityId" = COALESCE("sourceOpportunityId", ($1)."sourceOpportunityId"),
      name = COALESCE(NULLIF(($1)."nameFirstName", ''), name),
      "guoJia" = COALESCE(NULLIF(($1)."guoJia", ''), "guoJia"),
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
      "countryAddressCountry" = COALESCE(NULLIF(($1)."guoJia", ''), "countryAddressCountry"),
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
      "guoJia" = COALESCE(NULLIF(($1)."guoJia", ''), "guoJia"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."xuQiuChanPin", ''), "keHuXuQiuChanPin"),
      "updatedAt" = now()
    WHERE "deletedAt" IS NULL
      AND ("syncGroupCode" = ($1)."syncGroupCode" OR id = ($1)."linkedPersonId")
  $sql$, TG_TABLE_SCHEMA)
  USING NEW;

  RETURN NEW;
END;
$$;

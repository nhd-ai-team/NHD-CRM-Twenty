-- 修复三表同步触发器：字段改名断链 + 关键联系人姓名被覆盖
--
-- 背景：opportunity 上多个字段被改名（phone→whatsapp、country→keHuGuoJia、
-- message→beiZhu），旧触发器仍引用旧列名，导致「column phonePrimaryPhoneNumber
-- not found」——所有商机写入（设 owner、改关键联系人、任意编辑）整单失败。
--
-- 本迁移做三件事，其余逻辑与 20260807 版保持一致：
--  1) 列改名对齐当前 schema：
--       phonePrimaryPhoneNumber/CountryCode/CallingCode → whatsapp*
--       countryAddressCountry → keHuGuoJiaAddressCountry
--       message → beiZhu
--  2) 删除已不存在的 opportunity.xiangMuJinDu 相关同步行（进度映射待字段统一后重做，
--     见 docs/15）。
--  3) 止血「关键联系人」被覆盖：opp/project 同步到 person 的 nameFirstName 由
--     「源覆盖」改为「只填空不覆盖」——COALESCE(目标, 源)，与其余字段口径一致。
--     这样销售填的关键联系人不会再被商机名（网站访客 xxx）冲掉。

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
      -- 只填空不覆盖：不再用商机名冲掉销售填写的关键联系人
      "nameFirstName" = COALESCE("nameFirstName", NULLIF(($1).name, '')),
      "companyId" = COALESCE(($1)."companyId", "companyId"),
      "phonesPrimaryPhoneNumber" = COALESCE(NULLIF(($1)."whatsappPrimaryPhoneNumber", ''), "phonesPrimaryPhoneNumber"),
      "phonesPrimaryPhoneCountryCode" = COALESCE(NULLIF(($1)."whatsappPrimaryPhoneCountryCode", ''), "phonesPrimaryPhoneCountryCode"),
      "phonesPrimaryPhoneCallingCode" = COALESCE(NULLIF(($1)."whatsappPrimaryPhoneCallingCode", ''), "phonesPrimaryPhoneCallingCode"),
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
      "guoJia" = COALESCE(NULLIF(($1)."keHuGuoJiaAddressCountry", ''), "guoJia"),
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
      "guoJia" = COALESCE(NULLIF(($1)."keHuGuoJiaAddressCountry", ''), "guoJia"),
      "xuQiuChanPin" = COALESCE(NULLIF(($1)."keHuXuQiuChanPin", ''), "xuQiuChanPin"),
      "jinEAmountMicros" = COALESCE(($1)."amountAmountMicros", "jinEAmountMicros"),
      "jinECurrencyCode" = COALESCE(NULLIF(($1)."amountCurrencyCode", ''), "jinECurrencyCode"),
      "gaiShu" = COALESCE(NULLIF(($1)."beiZhu", ''), "gaiShu"),
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
      "whatsappPrimaryPhoneNumber" = COALESCE(NULLIF(($1)."phonesPrimaryPhoneNumber", ''), "whatsappPrimaryPhoneNumber"),
      "whatsappPrimaryPhoneCountryCode" = COALESCE(NULLIF(($1)."phonesPrimaryPhoneCountryCode", ''), "whatsappPrimaryPhoneCountryCode"),
      "whatsappPrimaryPhoneCallingCode" = COALESCE(NULLIF(($1)."phonesPrimaryPhoneCallingCode", ''), "whatsappPrimaryPhoneCallingCode"),
      "youXiang" = COALESCE(NULLIF(($1)."emailsPrimaryEmail", ''), "youXiang"),
      "keHuGuoJiaAddressCountry" = COALESCE(NULLIF(($1)."guoJia", ''), "keHuGuoJiaAddressCountry"),
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
      "keHuGuoJiaAddressCountry" = COALESCE(NULLIF(($1)."guoJia", ''), "keHuGuoJiaAddressCountry"),
      "keHuXuQiuChanPin" = COALESCE(NULLIF(($1)."xuQiuChanPin", ''), "keHuXuQiuChanPin"),
      "amountAmountMicros" = COALESCE(($1)."jinEAmountMicros", "amountAmountMicros"),
      "amountCurrencyCode" = COALESCE(NULLIF(($1)."jinECurrencyCode", ''), "amountCurrencyCode"),
      "beiZhu" = COALESCE(NULLIF(($1)."gaiShu", ''), "beiZhu"),
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
      -- 只填空不覆盖：项目名不再冲掉关键联系人
      "nameFirstName" = COALESCE("nameFirstName", NULLIF(($1).name, '')),
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

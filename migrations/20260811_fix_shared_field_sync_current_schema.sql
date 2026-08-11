-- Fix cross-object field synchronization to match the current CRM schema.
-- Scope:
-- - Hidden relation key: syncGroupCode remains the backing association id.
-- - Opportunity <-> Person <-> Project sync uses current field names only.
-- - Empty values never overwrite existing non-empty values.
-- - Email / WhatsApp / source / type / job title sync only between Opportunity and Person.
-- - Stage sync only between Opportunity and Project.

CREATE OR REPLACE FUNCTION conv.opportunity_stage_to_project_task(p_stage text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'XIANSUO' THEN 'YOU_XIAO_XUN_PAN'
    WHEN 'WEI_CHU_LI_XIANSUO' THEN NULL
    WHEN 'YOUXIAO_XIANSUO' THEN 'YOU_XIAO_XUN_PAN'
    WHEN 'QUE_REN_XUN_PAN' THEN 'YOU_XIAO_XUN_PAN'
    WHEN 'XUNJIA' THEN 'YI_ZHUAN_ZONG_BU'
    WHEN 'XUN_PAN_ZHUAN_ZONGBU' THEN 'YI_ZHUAN_ZONG_BU'
    WHEN 'BAOJIA' THEN 'YI_BAO_JIA'
    WHEN 'ZONGBU_FANG_AN_BAO_JIA' THEN 'YI_BAO_JIA'
    WHEN 'SHENYANG' THEN 'JI_SHU_CHENG_QING'
    WHEN 'JI_SHU_CHENG_QING' THEN 'JI_SHU_CHENG_QING'
    WHEN 'TANPAN' THEN 'SHANG_WU_CHENG_QING'
    WHEN 'SHANG_WU_CHENG_QING' THEN 'SHANG_WU_CHENG_QING'
    WHEN 'YIXIADAN' THEN 'YI_QIAN_DAN'
    WHEN 'YIFUKUAN' THEN 'YI_QIAN_DAN'
    WHEN 'YICHENGJIAO' THEN 'YI_QIAN_DAN'
    WHEN 'YI_QIAN_DAN_FU_KUAN' THEN 'YI_QIAN_DAN'
    WHEN 'YIFAHUO' THEN 'YI_FA_HUO'
    WHEN 'YI_FA_HUO' THEN 'YI_FA_HUO'
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
    WHEN 'YI_ZHUAN_ZONG_BU' THEN 'XUN_PAN_ZHUAN_ZONGBU'
    WHEN 'YI_BAO_JIA' THEN 'ZONGBU_FANG_AN_BAO_JIA'
    WHEN 'JI_SHU_CHENG_QING' THEN 'JI_SHU_CHENG_QING'
    WHEN 'SHANG_WU_CHENG_QING' THEN 'SHANG_WU_CHENG_QING'
    WHEN 'YI_QIAN_DAN' THEN 'YI_QIAN_DAN_FU_KUAN'
    WHEN 'YI_FA_HUO' THEN 'YI_FA_HUO'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION conv.person_source_to_opportunity_source(p_source text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_source
    WHEN 'WANG_ZHAN_LIU_YAN' THEN 'GUAN_WANG_BIAO_DAN'
    WHEN 'WANG_ZHAN_DUI_HUA' THEN 'GUAN_WANG_KE_FU'
    WHEN 'GUAN_WANG_BIAO_DAN' THEN 'GUAN_WANG_BIAO_DAN'
    WHEN 'GUAN_WANG_KE_FU' THEN 'GUAN_WANG_KE_FU'
    WHEN 'WHATSAPP' THEN 'WHATSAPP'
    WHEN 'INS' THEN 'INS'
    WHEN 'FACEBOOK' THEN 'FACEBOOK'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION conv.person_type_to_opportunity_type(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'ZHONG_JIAN_SHANG' THEN 'ZHONG_JIAN_SHANG'
    WHEN 'YE_ZHU' THEN 'YE_ZHU'
    WHEN 'EPC' THEN 'EPC'
    WHEN 'JI_SHU_ZI_XUN' THEN 'JI_SHU_ZI_XUN'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION conv.resolve_person_sync_group()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  match_record record;
BEGIN
  IF NEW."syncGroupCode" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    WITH candidates AS (
      SELECT
        o.id AS opportunity_id,
        o."syncGroupCode",
        o."linkedProjectId",
        CASE
          WHEN o.id = ($1)."sourceOpportunityId" THEN 0
          WHEN lower(NULLIF(trim(COALESCE(o."guanWangLianJiePrimaryLinkUrl", '')), '')) =
               lower(NULLIF(trim(COALESCE(($1)."guanWangLianJiePrimaryLinkUrl", '')), '')) THEN 1
          WHEN lower(NULLIF(trim(COALESCE(o."youXiangPrimaryEmail", '')), '')) =
               lower(NULLIF(trim(COALESCE(($1)."emailsPrimaryEmail", '')), '')) THEN 2
          WHEN regexp_replace(COALESCE(o."whatsappPrimaryPhoneNumber", ''), '\D', '', 'g') <> ''
           AND regexp_replace(COALESCE(o."whatsappPrimaryPhoneNumber", ''), '\D', '', 'g') =
               regexp_replace(COALESCE(($1)."phonesPrimaryPhoneNumber", ''), '\D', '', 'g') THEN 3
          WHEN lower(NULLIF(trim(COALESCE(o.name, '')), '')) =
               lower(NULLIF(trim(COALESCE(($1)."gongSiMingCheng", '')), '')) THEN 4
          ELSE 9
        END AS priority
      FROM %I.opportunity o
      WHERE o."deletedAt" IS NULL
        AND o."syncGroupCode" IS NOT NULL
        AND (
          o.id = ($1)."sourceOpportunityId"
          OR (
            NULLIF(trim(COALESCE(o."guanWangLianJiePrimaryLinkUrl", '')), '') IS NOT NULL
            AND lower(trim(o."guanWangLianJiePrimaryLinkUrl")) =
                lower(trim(COALESCE(($1)."guanWangLianJiePrimaryLinkUrl", '')))
          )
          OR (
            NULLIF(trim(COALESCE(o."youXiangPrimaryEmail", '')), '') IS NOT NULL
            AND lower(trim(o."youXiangPrimaryEmail")) = lower(trim(COALESCE(($1)."emailsPrimaryEmail", '')))
          )
          OR (
            regexp_replace(COALESCE(o."whatsappPrimaryPhoneNumber", ''), '\D', '', 'g') <> ''
            AND regexp_replace(COALESCE(o."whatsappPrimaryPhoneNumber", ''), '\D', '', 'g') =
                regexp_replace(COALESCE(($1)."phonesPrimaryPhoneNumber", ''), '\D', '', 'g')
          )
          OR (
            NULLIF(trim(COALESCE(o.name, '')), '') IS NOT NULL
            AND lower(trim(o.name)) = lower(trim(COALESCE(($1)."gongSiMingCheng", '')))
          )
        )
    ),
    eligible AS (
      SELECT
        c."syncGroupCode",
        (array_agg(c.opportunity_id ORDER BY c.priority, c.opportunity_id::text))[1] AS opportunity_id,
        (array_agg(c."linkedProjectId" ORDER BY c.priority, c.opportunity_id::text))[1] AS "linkedProjectId",
        min(c.priority) AS priority
      FROM candidates c
      WHERE NOT EXISTS (
        SELECT 1
        FROM %I.person existing
        WHERE existing."deletedAt" IS NULL
          AND existing.id <> ($1).id
          AND existing."syncGroupCode" = c."syncGroupCode"
      )
      GROUP BY c."syncGroupCode"
    ),
    ranked AS (
      SELECT *, count(*) OVER () AS total_matches
      FROM eligible
      ORDER BY priority, opportunity_id
    )
    SELECT opportunity_id, "syncGroupCode", "linkedProjectId"
    FROM ranked
    WHERE total_matches = 1
    LIMIT 1
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  INTO match_record
  USING NEW;

  IF match_record."syncGroupCode" IS NOT NULL THEN
    NEW."syncGroupCode" := match_record."syncGroupCode";
    NEW."sourceOpportunityId" := COALESCE(NEW."sourceOpportunityId", match_record.opportunity_id);
    NEW."linkedProjectId" := COALESCE(NEW."linkedProjectId", match_record."linkedProjectId");
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION conv.resolve_project_sync_group()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  match_record record;
BEGIN
  IF NEW."syncGroupCode" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format($sql$
    WITH opportunity_candidates AS (
      SELECT
        o.id AS opportunity_id,
        o."syncGroupCode",
        COALESCE(o."linkedPersonId", o."pointOfContactId") AS person_id,
        CASE
          WHEN o.id = ($1)."sourceOpportunityId" THEN 0
          WHEN COALESCE(o."linkedPersonId", o."pointOfContactId") = ($1)."linkedPersonId" THEN 1
          WHEN lower(NULLIF(trim(COALESCE(o."guanWangLianJiePrimaryLinkUrl", '')), '')) =
               lower(NULLIF(trim(COALESCE(($1)."guanWangLianJiePrimaryLinkUrl", '')), '')) THEN 2
          WHEN lower(NULLIF(trim(COALESCE(o.name, '')), '')) =
               lower(NULLIF(trim(COALESCE(($1).name, '')), '')) THEN 3
          ELSE 9
        END AS priority
      FROM %I.opportunity o
      WHERE o."deletedAt" IS NULL
        AND o."syncGroupCode" IS NOT NULL
        AND (
          o.id = ($1)."sourceOpportunityId"
          OR COALESCE(o."linkedPersonId", o."pointOfContactId") = ($1)."linkedPersonId"
          OR (
            NULLIF(trim(COALESCE(o."guanWangLianJiePrimaryLinkUrl", '')), '') IS NOT NULL
            AND lower(trim(o."guanWangLianJiePrimaryLinkUrl")) =
                lower(trim(COALESCE(($1)."guanWangLianJiePrimaryLinkUrl", '')))
          )
          OR (
            NULLIF(trim(COALESCE(o.name, '')), '') IS NOT NULL
            AND lower(trim(o.name)) = lower(trim(COALESCE(($1).name, '')))
          )
        )
    ),
    person_candidates AS (
      SELECT
        p."sourceOpportunityId" AS opportunity_id,
        p."syncGroupCode",
        p.id AS person_id,
        CASE
          WHEN p.id = ($1)."linkedPersonId" THEN 4
          WHEN lower(NULLIF(trim(COALESCE(p."guanWangLianJiePrimaryLinkUrl", '')), '')) =
               lower(NULLIF(trim(COALESCE(($1)."guanWangLianJiePrimaryLinkUrl", '')), '')) THEN 5
          WHEN lower(NULLIF(trim(COALESCE(p."gongSiMingCheng", '')), '')) =
               lower(NULLIF(trim(COALESCE(($1).name, '')), '')) THEN 6
          WHEN NULLIF(trim(COALESCE(p."fangKeId", '')), '') IS NOT NULL
           AND trim(p."fangKeId") = trim(COALESCE(($1)."fangKeId", '')) THEN 7
          ELSE 9
        END AS priority
      FROM %I.person p
      WHERE p."deletedAt" IS NULL
        AND p."syncGroupCode" IS NOT NULL
        AND (
          p.id = ($1)."linkedPersonId"
          OR (
            NULLIF(trim(COALESCE(p."guanWangLianJiePrimaryLinkUrl", '')), '') IS NOT NULL
            AND lower(trim(p."guanWangLianJiePrimaryLinkUrl")) =
                lower(trim(COALESCE(($1)."guanWangLianJiePrimaryLinkUrl", '')))
          )
          OR (
            NULLIF(trim(COALESCE(p."gongSiMingCheng", '')), '') IS NOT NULL
            AND lower(trim(p."gongSiMingCheng")) = lower(trim(COALESCE(($1).name, '')))
          )
          OR (
            NULLIF(trim(COALESCE(p."fangKeId", '')), '') IS NOT NULL
            AND trim(p."fangKeId") = trim(COALESCE(($1)."fangKeId", ''))
          )
        )
    ),
    candidates AS (
      SELECT * FROM opportunity_candidates
      UNION ALL
      SELECT * FROM person_candidates
    ),
    eligible AS (
      SELECT
        c."syncGroupCode",
        (array_agg(c.opportunity_id ORDER BY c.priority, c.opportunity_id::text, c.person_id::text))[1] AS opportunity_id,
        (array_agg(c.person_id ORDER BY c.priority, c.opportunity_id::text, c.person_id::text))[1] AS person_id,
        min(c.priority) AS priority
      FROM candidates c
      GROUP BY c."syncGroupCode"
    ),
    ranked AS (
      SELECT *, count(*) OVER () AS total_matches
      FROM eligible
      ORDER BY priority, opportunity_id, person_id
    )
    SELECT opportunity_id, "syncGroupCode", person_id
    FROM ranked
    WHERE total_matches = 1
    LIMIT 1
  $sql$, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
  INTO match_record
  USING NEW;

  IF match_record."syncGroupCode" IS NOT NULL THEN
    NEW."syncGroupCode" := match_record."syncGroupCode";
    NEW."sourceOpportunityId" := COALESCE(NEW."sourceOpportunityId", match_record.opportunity_id);
    NEW."linkedPersonId" := COALESCE(NEW."linkedPersonId", match_record.person_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS person_resolve_sync_group_before_write ON workspace_3zyju8y4v9gnoifvksi4cn23f.person;
CREATE TRIGGER person_resolve_sync_group_before_write
BEFORE INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f.person
FOR EACH ROW
EXECUTE FUNCTION conv.resolve_person_sync_group();

DROP TRIGGER IF EXISTS project_resolve_sync_group_before_write ON workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu";
CREATE TRIGGER project_resolve_sync_group_before_write
BEFORE INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu"
FOR EACH ROW
EXECUTE FUNCTION conv.resolve_project_sync_group();

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
      "zuiXinGenJinMarkdown" = COALESCE(NULLIF(($1)."zuiXinGenJinMarkdown", ''), target."zuiXinGenJinMarkdown"),
      "zuiXinGenJinBlocknote" = COALESCE(NULLIF(($1)."zuiXinGenJinBlocknote", ''), target."zuiXinGenJinBlocknote"),
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
      "zuiXinGenJinMarkdown" = COALESCE(NULLIF(($1)."zuiXinGenJinMarkdown", ''), target."zuiXinGenJinMarkdown"),
      "zuiXinGenJinBlocknote" = COALESCE(NULLIF(($1)."zuiXinGenJinBlocknote", ''), target."zuiXinGenJinBlocknote"),
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
      "zuiXinGenJinMarkdown" = COALESCE(NULLIF(($1)."zuiXinGenJinMarkdown", ''), target."zuiXinGenJinMarkdown"),
      "zuiXinGenJinBlocknote" = COALESCE(NULLIF(($1)."zuiXinGenJinBlocknote", ''), target."zuiXinGenJinBlocknote"),
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
      "fangKeId" = COALESCE(NULLIF(($1)."fangKeId", ''), target."fangKeId"),
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
      "zuiXinGenJinMarkdown" = COALESCE(NULLIF(($1)."zuiXinGenJinMarkdown", ''), target."zuiXinGenJinMarkdown"),
      "zuiXinGenJinBlocknote" = COALESCE(NULLIF(($1)."zuiXinGenJinBlocknote", ''), target."zuiXinGenJinBlocknote"),
      "updatedAt" = now()
    WHERE target."deletedAt" IS NULL
      AND (target."syncGroupCode" = ($1)."syncGroupCode" OR target."linkedPersonId" = ($1).id)
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
      "zuiXinGenJinMarkdown" = COALESCE(NULLIF(($1)."zuiXinGenJinMarkdown", ''), target."zuiXinGenJinMarkdown"),
      "zuiXinGenJinBlocknote" = COALESCE(NULLIF(($1)."zuiXinGenJinBlocknote", ''), target."zuiXinGenJinBlocknote"),
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
      "fangKeId" = COALESCE(NULLIF(($1)."fangKeId", ''), target."fangKeId"),
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
      "zuiXinGenJinMarkdown" = COALESCE(NULLIF(($1)."zuiXinGenJinMarkdown", ''), target."zuiXinGenJinMarkdown"),
      "zuiXinGenJinBlocknote" = COALESCE(NULLIF(($1)."zuiXinGenJinBlocknote", ''), target."zuiXinGenJinBlocknote"),
      "updatedAt" = now()
    WHERE target."deletedAt" IS NULL
      AND (target."syncGroupCode" = ($1)."syncGroupCode" OR target.id = ($1)."linkedPersonId")
  $sql$, TG_TABLE_SCHEMA)
  USING NEW;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  ws text := 'workspace_3zyju8y4v9gnoifvksi4cn23f';
  r record;
BEGIN
  FOR r IN EXECUTE format('SELECT id, "createdAt" FROM %I.opportunity WHERE "syncGroupCode" IS NULL ORDER BY "createdAt", id', ws)
  LOOP
    EXECUTE format('UPDATE %I.opportunity SET "syncGroupCode" = conv.next_sync_group_code("createdAt") WHERE id = $1', ws)
    USING r.id;
  END LOOP;

  EXECUTE format($sql$
    UPDATE %I.person p
    SET
      "syncGroupCode" = COALESCE(p."syncGroupCode", o."syncGroupCode"),
      "sourceOpportunityId" = COALESCE(p."sourceOpportunityId", o.id)
    FROM %I.opportunity o
    WHERE p."deletedAt" IS NULL
      AND o."deletedAt" IS NULL
      AND (o."linkedPersonId" = p.id OR o."pointOfContactId" = p.id)
      AND o."syncGroupCode" IS NOT NULL
  $sql$, ws, ws);

  EXECUTE format($sql$
    WITH candidates AS (
      SELECT
        p.id AS person_id,
        o.id AS opportunity_id,
        o."syncGroupCode",
        o."linkedProjectId",
        CASE
          WHEN lower(NULLIF(trim(COALESCE(o."guanWangLianJiePrimaryLinkUrl", '')), '')) =
               lower(NULLIF(trim(COALESCE(p."guanWangLianJiePrimaryLinkUrl", '')), '')) THEN 1
          WHEN lower(NULLIF(trim(COALESCE(o."youXiangPrimaryEmail", '')), '')) =
               lower(NULLIF(trim(COALESCE(p."emailsPrimaryEmail", '')), '')) THEN 2
          WHEN regexp_replace(COALESCE(o."whatsappPrimaryPhoneNumber", ''), '\D', '', 'g') <> ''
           AND regexp_replace(COALESCE(o."whatsappPrimaryPhoneNumber", ''), '\D', '', 'g') =
               regexp_replace(COALESCE(p."phonesPrimaryPhoneNumber", ''), '\D', '', 'g') THEN 3
          WHEN lower(NULLIF(trim(COALESCE(o.name, '')), '')) =
               lower(NULLIF(trim(COALESCE(p."gongSiMingCheng", '')), '')) THEN 4
          ELSE 9
        END AS priority
      FROM %I.person p
      JOIN %I.opportunity o ON o."deletedAt" IS NULL
        AND o."syncGroupCode" IS NOT NULL
        AND (
          (
            NULLIF(trim(COALESCE(o."guanWangLianJiePrimaryLinkUrl", '')), '') IS NOT NULL
            AND lower(trim(o."guanWangLianJiePrimaryLinkUrl")) =
                lower(trim(COALESCE(p."guanWangLianJiePrimaryLinkUrl", '')))
          )
          OR (
            NULLIF(trim(COALESCE(o."youXiangPrimaryEmail", '')), '') IS NOT NULL
            AND lower(trim(o."youXiangPrimaryEmail")) = lower(trim(COALESCE(p."emailsPrimaryEmail", '')))
          )
          OR (
            regexp_replace(COALESCE(o."whatsappPrimaryPhoneNumber", ''), '\D', '', 'g') <> ''
            AND regexp_replace(COALESCE(o."whatsappPrimaryPhoneNumber", ''), '\D', '', 'g') =
                regexp_replace(COALESCE(p."phonesPrimaryPhoneNumber", ''), '\D', '', 'g')
          )
          OR (
            NULLIF(trim(COALESCE(o.name, '')), '') IS NOT NULL
            AND lower(trim(o.name)) = lower(trim(COALESCE(p."gongSiMingCheng", '')))
          )
        )
      WHERE p."deletedAt" IS NULL
        AND p."syncGroupCode" IS NULL
    ),
    eligible AS (
      SELECT
        c.person_id,
        c."syncGroupCode",
        (array_agg(c.opportunity_id ORDER BY c.priority, c.opportunity_id::text))[1] AS opportunity_id,
        (array_agg(c."linkedProjectId" ORDER BY c.priority, c.opportunity_id::text))[1] AS "linkedProjectId",
        min(c.priority) AS priority
      FROM candidates c
      WHERE NOT EXISTS (
        SELECT 1
        FROM %I.person existing
        WHERE existing."deletedAt" IS NULL
          AND existing.id <> c.person_id
          AND existing."syncGroupCode" = c."syncGroupCode"
      )
      GROUP BY c.person_id, c."syncGroupCode"
    ),
    counted AS (
      SELECT *, count(*) OVER (PARTITION BY person_id) AS code_match_count
      FROM eligible
    ),
    unique_matches AS (
      SELECT DISTINCT ON (person_id) *
      FROM counted
      WHERE code_match_count = 1
      ORDER BY person_id, priority, opportunity_id
    )
    UPDATE %I.person p
    SET
      "syncGroupCode" = m."syncGroupCode",
      "sourceOpportunityId" = COALESCE(p."sourceOpportunityId", m.opportunity_id),
      "linkedProjectId" = COALESCE(p."linkedProjectId", m."linkedProjectId")
    FROM unique_matches m
    WHERE p.id = m.person_id
  $sql$, ws, ws, ws, ws);

  EXECUTE format($sql$
    UPDATE %I."_xiangMu" x
    SET
      "syncGroupCode" = COALESCE(x."syncGroupCode", o."syncGroupCode"),
      "sourceOpportunityId" = COALESCE(x."sourceOpportunityId", o.id),
      "linkedPersonId" = COALESCE(x."linkedPersonId", o."linkedPersonId", o."pointOfContactId")
    FROM %I.opportunity o
    WHERE x."deletedAt" IS NULL
      AND o."deletedAt" IS NULL
      AND (o."linkedProjectId" = x.id OR x."sourceOpportunityId" = o.id)
      AND o."syncGroupCode" IS NOT NULL
  $sql$, ws, ws);

  EXECUTE format($sql$
    WITH opportunity_candidates AS (
      SELECT
        x.id AS project_id,
        o.id AS opportunity_id,
        o."syncGroupCode",
        COALESCE(o."linkedPersonId", o."pointOfContactId") AS person_id,
        CASE
          WHEN lower(NULLIF(trim(COALESCE(o."guanWangLianJiePrimaryLinkUrl", '')), '')) =
               lower(NULLIF(trim(COALESCE(x."guanWangLianJiePrimaryLinkUrl", '')), '')) THEN 1
          WHEN lower(NULLIF(trim(COALESCE(o.name, '')), '')) =
               lower(NULLIF(trim(COALESCE(x.name, '')), '')) THEN 2
          ELSE 9
        END AS priority
      FROM %I."_xiangMu" x
      JOIN %I.opportunity o ON o."deletedAt" IS NULL
        AND o."syncGroupCode" IS NOT NULL
        AND (
          (
            NULLIF(trim(COALESCE(o."guanWangLianJiePrimaryLinkUrl", '')), '') IS NOT NULL
            AND lower(trim(o."guanWangLianJiePrimaryLinkUrl")) =
                lower(trim(COALESCE(x."guanWangLianJiePrimaryLinkUrl", '')))
          )
          OR (
            NULLIF(trim(COALESCE(o.name, '')), '') IS NOT NULL
            AND lower(trim(o.name)) = lower(trim(COALESCE(x.name, '')))
          )
        )
      WHERE x."deletedAt" IS NULL
        AND x."syncGroupCode" IS NULL
    ),
    person_candidates AS (
      SELECT
        x.id AS project_id,
        p."sourceOpportunityId" AS opportunity_id,
        p."syncGroupCode",
        p.id AS person_id,
        CASE
          WHEN lower(NULLIF(trim(COALESCE(p."guanWangLianJiePrimaryLinkUrl", '')), '')) =
               lower(NULLIF(trim(COALESCE(x."guanWangLianJiePrimaryLinkUrl", '')), '')) THEN 3
          WHEN lower(NULLIF(trim(COALESCE(p."gongSiMingCheng", '')), '')) =
               lower(NULLIF(trim(COALESCE(x.name, '')), '')) THEN 4
          WHEN NULLIF(trim(COALESCE(p."fangKeId", '')), '') IS NOT NULL
           AND trim(p."fangKeId") = trim(COALESCE(x."fangKeId", '')) THEN 5
          ELSE 9
        END AS priority
      FROM %I."_xiangMu" x
      JOIN %I.person p ON p."deletedAt" IS NULL
        AND p."syncGroupCode" IS NOT NULL
        AND (
          (
            NULLIF(trim(COALESCE(p."guanWangLianJiePrimaryLinkUrl", '')), '') IS NOT NULL
            AND lower(trim(p."guanWangLianJiePrimaryLinkUrl")) =
                lower(trim(COALESCE(x."guanWangLianJiePrimaryLinkUrl", '')))
          )
          OR (
            NULLIF(trim(COALESCE(p."gongSiMingCheng", '')), '') IS NOT NULL
            AND lower(trim(p."gongSiMingCheng")) = lower(trim(COALESCE(x.name, '')))
          )
          OR (
            NULLIF(trim(COALESCE(p."fangKeId", '')), '') IS NOT NULL
            AND trim(p."fangKeId") = trim(COALESCE(x."fangKeId", ''))
          )
        )
      WHERE x."deletedAt" IS NULL
        AND x."syncGroupCode" IS NULL
    ),
    candidates AS (
      SELECT * FROM opportunity_candidates
      UNION ALL
      SELECT * FROM person_candidates
    ),
    eligible AS (
      SELECT
        c.project_id,
        c."syncGroupCode",
        (array_agg(c.opportunity_id ORDER BY c.priority, c.opportunity_id::text, c.person_id::text))[1] AS opportunity_id,
        (array_agg(c.person_id ORDER BY c.priority, c.opportunity_id::text, c.person_id::text))[1] AS person_id,
        min(c.priority) AS priority
      FROM candidates c
      GROUP BY c.project_id, c."syncGroupCode"
    ),
    counted AS (
      SELECT *, count(*) OVER (PARTITION BY project_id) AS code_match_count
      FROM eligible
    ),
    unique_matches AS (
      SELECT DISTINCT ON (project_id) *
      FROM counted
      WHERE code_match_count = 1
      ORDER BY project_id, priority, opportunity_id, person_id
    )
    UPDATE %I."_xiangMu" x
    SET
      "syncGroupCode" = m."syncGroupCode",
      "sourceOpportunityId" = COALESCE(x."sourceOpportunityId", m.opportunity_id),
      "linkedPersonId" = COALESCE(x."linkedPersonId", m.person_id)
    FROM unique_matches m
    WHERE x.id = m.project_id
  $sql$, ws, ws, ws, ws, ws);

  EXECUTE format($sql$
    UPDATE %I.opportunity o
    SET
      "linkedPersonId" = COALESCE(o."linkedPersonId", p.id),
      "pointOfContactId" = COALESCE(o."pointOfContactId", p.id)
    FROM %I.person p
    WHERE o."deletedAt" IS NULL
      AND p."deletedAt" IS NULL
      AND o."syncGroupCode" = p."syncGroupCode"
      AND o."syncGroupCode" IS NOT NULL
  $sql$, ws, ws);

  EXECUTE format($sql$
    UPDATE %I.opportunity o
    SET "linkedProjectId" = COALESCE(o."linkedProjectId", x.id)
    FROM %I."_xiangMu" x
    WHERE o."deletedAt" IS NULL
      AND x."deletedAt" IS NULL
      AND o."syncGroupCode" = x."syncGroupCode"
      AND o."syncGroupCode" IS NOT NULL
  $sql$, ws, ws);

  EXECUTE format($sql$
    UPDATE %I.person p
    SET "linkedProjectId" = COALESCE(p."linkedProjectId", x.id)
    FROM %I."_xiangMu" x
    WHERE p."deletedAt" IS NULL
      AND x."deletedAt" IS NULL
      AND p."syncGroupCode" = x."syncGroupCode"
      AND p."syncGroupCode" IS NOT NULL
  $sql$, ws, ws);
END $$;

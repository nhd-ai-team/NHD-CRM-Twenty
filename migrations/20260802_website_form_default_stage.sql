-- 官网表单直接写入线索表时固定补齐默认值。
-- 业务口径：
-- 1. 官网表单属于客户来源 = 官网表单，即 opportunity.keHuLaiYuan = GUAN_WANG_BIAO_DAN。
-- 2. 官网表单属于待处理线索，即 opportunity.stage = XIANSUO。
-- 3. 为避免影响人工新建 / Excel 导入，只自动补「API 创建且客户来源为空」的新线索。
-- 4. 已明确传入 WhatsApp / Facebook / 官网客服等来源时，不覆盖来源。

CREATE SCHEMA IF NOT EXISTS conv;

CREATE OR REPLACE FUNCTION conv.default_website_form_opportunity_stage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."keHuLaiYuan" IS NULL
     AND NEW."createdBySource" IS NOT NULL
     AND NEW."createdBySource"::text = 'API' THEN
    NEW."keHuLaiYuan" := 'GUAN_WANG_BIAO_DAN';
  END IF;

  IF NEW."keHuLaiYuan" IS NOT NULL
     AND NEW."keHuLaiYuan"::text = 'GUAN_WANG_BIAO_DAN' THEN
    NEW.stage := 'XIANSUO';
  END IF;
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
      'DROP TRIGGER IF EXISTS opportunity_website_form_default_stage_before_insert ON %I.opportunity',
      ws
    );
    EXECUTE format(
      'CREATE TRIGGER opportunity_website_form_default_stage_before_insert
       BEFORE INSERT ON %I.opportunity
       FOR EACH ROW EXECUTE FUNCTION conv.default_website_form_opportunity_stage()',
      ws
    );
  END LOOP;
END $$;

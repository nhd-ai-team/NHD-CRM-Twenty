-- 官网表单进入线索表时固定为初始线索阶段。
-- 业务口径：官网表单属于待处理线索，即 opportunity.stage = XIANSUO。
-- 这样即使官网表单链路带了 WhatsApp/邮箱，也不会被自动提升为 YOUXIAO_XIANSUO。

CREATE SCHEMA IF NOT EXISTS conv;

CREATE OR REPLACE FUNCTION conv.default_website_form_opportunity_stage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
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

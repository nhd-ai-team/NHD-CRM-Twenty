-- 线索ID(leadNo)兜底：确保所有 opportunity 入库必带 leadNo
-- 触发器：INSERT 时若 leadNo 为空则自动生成 XS-<YYYYMMDDHHMMSS>(同秒冲突追加 -XX)
-- 适用范围：所有入口（官网表单 / 官网客服 / WhatsApp / 转线索 / Twenty UI 手建）
-- 与 middleware/index.js generateLeadId() 格式保持一致：'XS-' + YYYYMMDDHH24MISS

CREATE OR REPLACE FUNCTION workspace_3zyju8y4v9gnoifvksi4cn23f.trg_set_leadno_default()
RETURNS trigger AS $$
DECLARE
  base text;
  suffix text := '';
BEGIN
  IF NEW."leadNo" IS NULL OR trim(NEW."leadNo") = '' THEN
    base := 'XS-' || to_char(now(), 'YYYYMMDDHH24MISS');
    -- 同秒并发去重（与 middleware generateLeadId 行为一致）
    IF EXISTS (
      SELECT 1 FROM workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity WHERE "leadNo" = base
    ) THEN
      suffix := '-' || upper(substring(md5(random()::text || clock_timestamp()::text), 1, 2));
    END IF;
    NEW."leadNo" := base || suffix;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS opportunity_leadno_default_trg
  ON workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity;
CREATE TRIGGER opportunity_leadno_default_trg
  BEFORE INSERT ON workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity
  FOR EACH ROW EXECUTE FUNCTION workspace_3zyju8y4v9gnoifvksi4cn23f.trg_set_leadno_default();

-- 一次性回填历史缺失行：用 createdAt + id 的 md5 后缀保证唯一，不覆盖已存在值
UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity
SET "leadNo" = 'XS-' || to_char(COALESCE("createdAt", now()), 'YYYYMMDDHH24MISS') || '-' || upper(substring(md5(id::text), 1, 4))
WHERE "leadNo" IS NULL OR trim("leadNo") = '';

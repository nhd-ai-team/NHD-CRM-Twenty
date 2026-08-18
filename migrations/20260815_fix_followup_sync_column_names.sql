-- Fix stale shared-field sync functions after the latest follow-up field was renamed.
-- The real workspace columns are genJinJiLuMarkdown/genJinJiLuBlocknote.
-- Older sync functions still referenced zuiXinGenJinMarkdown/zuiXinGenJinBlocknote,
-- which caused all writes touching opportunity/person/project sync triggers to fail.
DO $$
DECLARE
  fn record;
  ddl text;
BEGIN
  FOR fn IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'conv'
      AND p.proname IN ('sync_from_opportunity', 'sync_from_person', 'sync_from_project')
  LOOP
    ddl := pg_get_functiondef(fn.oid);
    ddl := replace(ddl, 'zuiXinGenJin', 'genJinJiLu');
    EXECUTE ddl;
  END LOOP;
END $$;

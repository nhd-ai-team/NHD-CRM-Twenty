-- Website form stage rule:
-- - First website form opportunity creation defaults to WEI_CHU_LI_XIANSUO.
-- - Later duplicate website form submissions must not reset a manually updated stage
--   on the primary opportunity.
DO $$
DECLARE
  fn_oid oid;
  ddl text;
BEGIN
  SELECT p.oid
    INTO fn_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'conv'
    AND p.proname = 'dedup_website_form_opportunity'
  LIMIT 1;

  IF fn_oid IS NULL THEN
    RAISE NOTICE 'conv.dedup_website_form_opportunity() not found, skip';
    RETURN;
  END IF;

  ddl := pg_get_functiondef(fn_oid);
  ddl := replace(
    ddl,
    E'      stage = ''WEI_CHU_LI_XIANSUO''::%I.opportunity_stage_enum,\n',
    ''
  );
  ddl := replace(
    ddl,
    E'      stage = ''XIANSUO''::%I.opportunity_stage_enum,\n',
    ''
  );
  EXECUTE ddl;
END $$;

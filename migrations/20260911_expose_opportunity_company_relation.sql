-- Restore the native company relation on leads.
-- opportunity.name remains the lead name; company is a separate editable relation.
-- Do not change any field or object IDs.

DO $$
DECLARE
  v_opportunity_id uuid;
  v_company_field_id uuid;
BEGIN
  SELECT id INTO v_opportunity_id
  FROM core."objectMetadata"
  WHERE "nameSingular" = 'opportunity'
    AND "isActive" = true
  LIMIT 1;

  SELECT id INTO v_company_field_id
  FROM core."fieldMetadata"
  WHERE "objectMetadataId" = v_opportunity_id
    AND name = 'company'
    AND "isActive" = true
  LIMIT 1;

  IF v_opportunity_id IS NULL OR v_company_field_id IS NULL THEN
    RAISE EXCEPTION 'active opportunity/company metadata not found';
  END IF;

  UPDATE core."viewField" vf
  SET "isVisible" = true,
      "isActive" = true,
      "deletedAt" = NULL,
      "updatedAt" = now()
  FROM core."view" v
  WHERE vf."viewId" = v.id
    AND v."objectMetadataId" = v_opportunity_id
    AND v.type = 'TABLE'
    AND vf."fieldMetadataId" = v_company_field_id;

  INSERT INTO core."viewField" (
    "universalIdentifier", "fieldMetadataId", "isVisible", size, position,
    "viewId", "workspaceId", "applicationId", "isActive", "createdAt", "updatedAt"
  )
  SELECT
    uuid_generate_v4(), v_company_field_id, true, 160, 1,
    v.id, v."workspaceId", v."applicationId", true, now(), now()
  FROM core."view" v
  WHERE v."objectMetadataId" = v_opportunity_id
    AND v.type = 'TABLE'
    AND v."deletedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM core."viewField" vf
      WHERE vf."viewId" = v.id
        AND vf."fieldMetadataId" = v_company_field_id
        AND vf."deletedAt" IS NULL
    );

  UPDATE core."pageLayoutWidget" plw
  SET "deletedAt" = NULL,
      "isActive" = true,
      "updatedAt" = now()
  FROM core."pageLayoutTab" plt
  JOIN core."pageLayout" pl ON pl.id = plt."pageLayoutId"
  WHERE plw."pageLayoutTabId" = plt.id
    AND pl."objectMetadataId" = v_opportunity_id
    AND plw.type = 'FIELD'
    AND plw.configuration->>'fieldMetadataId' = v_company_field_id::text;
END $$;

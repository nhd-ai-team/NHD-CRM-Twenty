-- Enable the company metadata needed by the lead company relation picker.
-- Sales can read existing companies to assign a lead, but cannot mutate company records.
-- Do not change any field or object IDs and do not add a company navigation item.

DO $$
DECLARE
  v_workspace_id uuid;
  v_company_object_id uuid;
  v_application_id uuid;
  v_role record;
BEGIN
  SELECT id INTO v_workspace_id
  FROM core.workspace
  ORDER BY "createdAt"
  LIMIT 1;

  SELECT id, "applicationId" INTO v_company_object_id, v_application_id
  FROM core."objectMetadata"
  WHERE "workspaceId" = v_workspace_id
    AND "nameSingular" = 'company'
  LIMIT 1;

  IF v_workspace_id IS NULL OR v_company_object_id IS NULL THEN
    RAISE EXCEPTION 'company metadata not found';
  END IF;

  UPDATE core."objectMetadata"
  SET "isActive" = true,
      "updatedAt" = now()
  WHERE id = v_company_object_id;

  -- Keep the object active for relation lookups, but do not expose a standalone
  -- Company board in the CRM navigation. The lead relation picker is the UI entry point.
  DELETE FROM core."navigationMenuItem"
  WHERE "workspaceId" = v_workspace_id
    AND "targetObjectMetadataId" = v_company_object_id;

  SELECT id INTO v_role
  FROM core.role
  WHERE "workspaceId" = v_workspace_id
    AND label = '销售'
  LIMIT 1;

  IF v_role.id IS NOT NULL THEN
    INSERT INTO core."objectPermission" (
      id, "roleId", "objectMetadataId", "canReadObjectRecords",
      "canUpdateObjectRecords", "canSoftDeleteObjectRecords",
      "canDestroyObjectRecords", "workspaceId", "createdAt", "updatedAt",
      "universalIdentifier", "applicationId"
    ) VALUES (
      gen_random_uuid(), v_role.id, v_company_object_id, true,
      false, false, false, v_workspace_id, now(), now(),
      gen_random_uuid(), v_application_id
    )
    ON CONFLICT ("objectMetadataId", "roleId") DO UPDATE
      SET "canReadObjectRecords" = true,
          "canUpdateObjectRecords" = false,
          "canSoftDeleteObjectRecords" = false,
          "canDestroyObjectRecords" = false,
          "updatedAt" = now();
  END IF;
END $$;

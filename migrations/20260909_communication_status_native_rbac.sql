-- Native Twenty permissions for the communication-status object.
--
-- Scope: only the custom duiHuaLiShi object in the current workspace.
-- The protected business field IDs are not changed.
--
-- Policy:
--   * 总经理 / 销售主管 / Admin: read all communication-status rows, read-only.
--   * 销售: read-only rows whose ownerMember/collaborator is the current member.
--   * No role may update, soft-delete, or destroy these rows.
--
-- This migration is intentionally data-preserving and idempotent.

DO $$
DECLARE
  v_workspace_id uuid;
  v_object_id uuid;
  v_application_id uuid;
  v_owner_field_id uuid;
  v_collaborator_field_id uuid;
  v_second_collaborator_field_id uuid;
  v_workspace_member_id_field_id uuid;
  v_group_id uuid;
  v_field_id uuid;
  v_workspace_schema text;
  v_role record;
  v_permission_id uuid;
BEGIN
  SELECT id
    INTO v_workspace_id
  FROM core.workspace
  ORDER BY "createdAt"
  LIMIT 1;

  SELECT table_schema
    INTO v_workspace_schema
  FROM information_schema.tables
  WHERE table_name = '_duiHuaLiShi'
    AND table_schema LIKE 'workspace_%'
  LIMIT 1;

  SELECT id, "applicationId"
    INTO v_object_id, v_application_id
  FROM core."objectMetadata"
  WHERE "workspaceId" = v_workspace_id
    AND "nameSingular" = 'duiHuaLiShi'
  LIMIT 1;

  IF v_workspace_id IS NULL OR v_object_id IS NULL THEN
    RAISE NOTICE 'communication-status object not found; skipping native RBAC migration';
    RETURN;
  END IF;

  SELECT id
    INTO v_owner_field_id
  FROM core."fieldMetadata"
  WHERE "objectMetadataId" = v_object_id
    AND name = 'ownerMember'
    AND "isActive" = true
  LIMIT 1;

  SELECT id INTO v_collaborator_field_id
  FROM core."fieldMetadata"
  WHERE "objectMetadataId" = v_object_id AND name = 'xieBanRen' AND "isActive" = true
  LIMIT 1;

  SELECT id INTO v_second_collaborator_field_id
  FROM core."fieldMetadata"
  WHERE "objectMetadataId" = v_object_id AND name = 'xieZuoRen2' AND "isActive" = true
  LIMIT 1;

  SELECT fm.id
    INTO v_workspace_member_id_field_id
  FROM core."fieldMetadata" fm
  JOIN core."objectMetadata" om ON om.id = fm."objectMetadataId"
  WHERE om."workspaceId" = v_workspace_id
    AND om."nameSingular" = 'workspaceMember'
    AND fm.name = 'id'
    AND fm."isActive" = true
  LIMIT 1;

  IF v_owner_field_id IS NULL OR v_collaborator_field_id IS NULL
     OR v_second_collaborator_field_id IS NULL
     OR v_workspace_member_id_field_id IS NULL THEN
    RAISE EXCEPTION 'communication-status owner/collaborator/member metadata not found';
  END IF;

  UPDATE core."objectMetadata"
  SET "isUIReadOnly" = true,
      "isUIEditable" = false,
      "isUICreatable" = false,
      "updatedAt" = now()
  WHERE id = v_object_id;

  FOR v_role IN
    SELECT id, label
    FROM core.role
    WHERE "workspaceId" = v_workspace_id
      AND label IN ('Admin', '销售', '销售主管', '总经理')
  LOOP
    INSERT INTO core."objectPermission" (
      id, "roleId", "objectMetadataId", "canReadObjectRecords",
      "canUpdateObjectRecords", "canSoftDeleteObjectRecords",
      "canDestroyObjectRecords", "workspaceId", "createdAt", "updatedAt",
      "universalIdentifier", "applicationId"
    ) VALUES (
      gen_random_uuid(), v_role.id, v_object_id, true,
      false, false, false, v_workspace_id, now(), now(),
      gen_random_uuid(), v_application_id
    )
    ON CONFLICT ("objectMetadataId", "roleId") DO UPDATE
      SET "canReadObjectRecords" = true,
          "canUpdateObjectRecords" = false,
          "canSoftDeleteObjectRecords" = false,
          "canDestroyObjectRecords" = false,
          "updatedAt" = now();

    -- A missing predicate means full visibility in native Twenty. Only the
    -- two management roles intentionally use that behavior here.
    IF v_role.label NOT IN ('Admin', '总经理', '销售主管') THEN
      DELETE FROM core."rowLevelPermissionPredicate"
      WHERE "workspaceId" = v_workspace_id
        AND "roleId" = v_role.id
        AND "objectMetadataId" = v_object_id;

      DELETE FROM core."rowLevelPermissionPredicateGroup"
      WHERE "workspaceId" = v_workspace_id
        AND "roleId" = v_role.id
        AND "objectMetadataId" = v_object_id;

      v_group_id := gen_random_uuid();
      INSERT INTO core."rowLevelPermissionPredicateGroup" (
        "universalIdentifier", "applicationId", id, "logicalOperator",
        "positionInRowLevelPermissionPredicateGroup", "workspaceId", "roleId",
        "createdAt", "updatedAt", "deletedAt", "objectMetadataId"
      ) VALUES (
        v_group_id, v_application_id, v_group_id, 'OR', 0, v_workspace_id,
        v_role.id, now(), now(), NULL, v_object_id
      );

      FOREACH v_field_id IN ARRAY ARRAY[
        v_owner_field_id, v_collaborator_field_id, v_second_collaborator_field_id
      ] LOOP
        INSERT INTO core."rowLevelPermissionPredicate" (
          "universalIdentifier", "applicationId", id, "fieldMetadataId",
          "objectMetadataId", operand, value, "subFieldName",
          "workspaceMemberFieldMetadataId", "workspaceMemberSubFieldName",
          "rowLevelPermissionPredicateGroupId",
          "positionInRowLevelPermissionPredicateGroup", "workspaceId", "roleId",
          "createdAt", "updatedAt", "deletedAt"
        ) VALUES (
          gen_random_uuid(), v_application_id, gen_random_uuid(), v_field_id,
          v_object_id, 'IS', NULL, NULL, v_workspace_member_id_field_id, NULL,
          v_group_id, 0, v_workspace_id, v_role.id, now(), now(), NULL
        );
      END LOOP;
    ELSE
      DELETE FROM core."rowLevelPermissionPredicate"
      WHERE "workspaceId" = v_workspace_id
        AND "roleId" = v_role.id
        AND "objectMetadataId" = v_object_id;
      DELETE FROM core."rowLevelPermissionPredicateGroup"
      WHERE "workspaceId" = v_workspace_id
        AND "roleId" = v_role.id
        AND "objectMetadataId" = v_object_id;
    END IF;
  END LOOP;

  -- Backfill the two new visibility relations for existing history rows from
  -- the linked CRM lead. Existing values are preserved.
  EXECUTE format($sql$
    UPDATE %I."_duiHuaLiShi" h
       SET "xieBanRenId" = COALESCE(h."xieBanRenId", o."xieBanRenId"),
           "xieZuoRen2Id" = COALESCE(h."xieZuoRen2Id", o."xieZuoRen2Id"),
           "updatedAt" = now()
      FROM conv.conversations c
      JOIN conv.contacts ct ON ct.id = c.contact_id
      JOIN %I.opportunity o ON o.id::text = ct.twenty_opportunity_id
     WHERE h."conversationId"::text = c.id::text
       AND h."deletedAt" IS NULL
       AND (h."xieBanRenId" IS NULL OR h."xieZuoRen2Id" IS NULL)
  $sql$, v_workspace_schema, v_workspace_schema);
END $$;

-- Native Twenty row-level permissions for leads (opportunity).
--
-- Sales can read only leads assigned to them as owner, collaborator, or
-- collaborator 2. Admin, general manager, and sales manager can read all.
-- This migration does not alter any business field metadata or field IDs.

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
  v_unassigned_group_id uuid;
  v_field_id uuid;
  v_role record;
BEGIN
  SELECT id
    INTO v_workspace_id
  FROM core.workspace
  ORDER BY "createdAt"
  LIMIT 1;

  SELECT id, "applicationId"
    INTO v_object_id, v_application_id
  FROM core."objectMetadata"
  WHERE "workspaceId" = v_workspace_id
    AND "nameSingular" = 'opportunity'
  LIMIT 1;

  IF v_workspace_id IS NULL OR v_object_id IS NULL THEN
    RAISE NOTICE 'opportunity object not found; skipping native RBAC migration';
    RETURN;
  END IF;

  SELECT id INTO v_owner_field_id
  FROM core."fieldMetadata"
  WHERE "objectMetadataId" = v_object_id AND name = 'owner' AND "isActive" = true
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
    RAISE EXCEPTION 'opportunity owner/collaborator/member metadata not found';
  END IF;

  -- A role-level "read all" flag bypasses row predicates entirely. Keep the
  -- sales role object-scoped so the opportunity predicates below are applied.
  -- The primary customer/project objects receive explicit object permissions
  -- below so their existing pages remain available while their own row rules
  -- are completed separately.
  UPDATE core.role
     SET "canReadAllObjectRecords" = false,
         "canUpdateAllObjectRecords" = false,
         "canSoftDeleteAllObjectRecords" = false,
         "canDestroyAllObjectRecords" = false
   WHERE "workspaceId" = v_workspace_id
     AND label = '销售';

  INSERT INTO core."objectPermission" (
    id, "roleId", "objectMetadataId", "canReadObjectRecords",
    "canUpdateObjectRecords", "canSoftDeleteObjectRecords",
    "canDestroyObjectRecords", "workspaceId", "createdAt", "updatedAt",
    "universalIdentifier", "applicationId"
  )
  SELECT gen_random_uuid(), r.id, om.id, true, true, true, true,
         v_workspace_id, now(), now(), gen_random_uuid(), om."applicationId"
    FROM core.role r
    JOIN core."objectMetadata" om
      ON om."workspaceId" = v_workspace_id
     AND om."nameSingular" IN ('person', 'xiangMu')
     AND om."isActive" = true
   WHERE r."workspaceId" = v_workspace_id
     AND r.label = '销售'
  ON CONFLICT ("objectMetadataId", "roleId") DO UPDATE
    SET "canReadObjectRecords" = true,
        "canUpdateObjectRecords" = true,
        "canSoftDeleteObjectRecords" = true,
        "canDestroyObjectRecords" = true,
        "updatedAt" = now();

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
      true, v_role.label IN ('Admin', '销售主管'),
      v_role.label = 'Admin', v_workspace_id, now(), now(),
      gen_random_uuid(), v_application_id
    )
    ON CONFLICT ("objectMetadataId", "roleId") DO UPDATE
      SET "canReadObjectRecords" = true,
          "updatedAt" = now();

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

      -- Unassigned leads remain visible to every sales user. This is a
      -- nested AND group under the root OR group: owner, collaborator, and
      -- collaborator 2 must all be empty.
      v_unassigned_group_id := gen_random_uuid();
      INSERT INTO core."rowLevelPermissionPredicateGroup" (
        "universalIdentifier", "applicationId", id, "logicalOperator",
        "positionInRowLevelPermissionPredicateGroup", "workspaceId", "roleId",
        "createdAt", "updatedAt", "deletedAt", "objectMetadataId",
        "parentRowLevelPermissionPredicateGroupId"
      ) VALUES (
        v_unassigned_group_id, v_application_id, v_unassigned_group_id, 'AND', 1,
        v_workspace_id, v_role.id, now(), now(), NULL, v_object_id, v_group_id
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
          v_object_id, 'IS_EMPTY', NULL, NULL, NULL, NULL,
          v_unassigned_group_id, 0, v_workspace_id, v_role.id, now(), now(), NULL
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
END $$;

-- Owner/contact sync for Opportunity <-> Person <-> Project.
-- - Rename native owner label to 负责人.
-- - Keep native owner as the single accountable owner.
-- - Add a text field 协同负责人 for multiple/collaborating owners.
-- - Sync project text fields with native CRM owner/person relations when safe.

DO $$
DECLARE
  ws uuid := '438bc184-abf4-4992-8de4-c2669c4ca65b';
  object_record record;
BEGIN
  UPDATE core."fieldMetadata" fm
  SET label = '负责人', "updatedAt" = now()
  FROM core."objectMetadata" om
  WHERE fm."objectMetadataId" = om.id
    AND om."workspaceId" = ws
    AND om."nameSingular" IN ('opportunity', 'person')
    AND fm.name = 'owner'
    AND fm."isActive" = true;

  ALTER TABLE workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity ADD COLUMN IF NOT EXISTS "xieTongFuZeRen" text;
  ALTER TABLE workspace_3zyju8y4v9gnoifvksi4cn23f.person ADD COLUMN IF NOT EXISTS "xieTongFuZeRen" text;
  ALTER TABLE workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" ADD COLUMN IF NOT EXISTS "xieTongFuZeRen" text;

  FOR object_record IN
    SELECT
      om.id,
      om."workspaceId",
      om."applicationId"
    FROM core."objectMetadata" om
    WHERE om."workspaceId" = ws
      AND om."nameSingular" IN ('opportunity', 'person', 'xiangMu')
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM core."fieldMetadata" fm
      WHERE fm."objectMetadataId" = object_record.id
        AND fm.name = 'xieTongFuZeRen'
    ) THEN
      INSERT INTO core."fieldMetadata" (
        id,
        "objectMetadataId",
        type,
        name,
        label,
        icon,
        "isActive",
        "isSystem",
        "isUIReadOnly",
        "isNullable",
        "workspaceId",
        "applicationId",
        "universalIdentifier"
      )
      VALUES (
        uuid_generate_v4(),
        object_record.id,
        'TEXT',
        'xieTongFuZeRen',
        '协同负责人',
        'IconUsers',
        true,
        false,
        false,
        true,
        object_record."workspaceId",
        object_record."applicationId",
        uuid_generate_v4()
      );
    ELSE
      UPDATE core."fieldMetadata"
      SET label = '协同负责人', type = 'TEXT', "isActive" = true, "updatedAt" = now()
      WHERE "objectMetadataId" = object_record.id
        AND name = 'xieTongFuZeRen';
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION conv.workspace_member_display_name(p_member_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    btrim(
      COALESCE(wm."nameFirstName", '') ||
      CASE WHEN COALESCE(wm."nameFirstName", '') <> '' AND COALESCE(wm."nameLastName", '') <> '' THEN ' ' ELSE '' END ||
      COALESCE(wm."nameLastName", '')
    ),
    ''
  )
  FROM workspace_3zyju8y4v9gnoifvksi4cn23f."workspaceMember" wm
  WHERE wm.id = p_member_id
    AND wm."deletedAt" IS NULL
$$;

CREATE OR REPLACE FUNCTION conv.workspace_member_id_by_text(p_text text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  matched_id uuid;
BEGIN
  IF NULLIF(btrim(COALESCE(p_text, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT wm.id
  INTO matched_id
  FROM workspace_3zyju8y4v9gnoifvksi4cn23f."workspaceMember" wm
  WHERE wm."deletedAt" IS NULL
    AND (
      lower(btrim(COALESCE(wm."userEmail", ''))) = lower(btrim(p_text))
      OR lower(
        btrim(
          COALESCE(wm."nameFirstName", '') ||
          CASE WHEN COALESCE(wm."nameFirstName", '') <> '' AND COALESCE(wm."nameLastName", '') <> '' THEN ' ' ELSE '' END ||
          COALESCE(wm."nameLastName", '')
        )
      ) = lower(btrim(p_text))
    )
  GROUP BY wm.id
  HAVING count(*) = 1
  LIMIT 1;

  RETURN matched_id;
END;
$$;

CREATE OR REPLACE FUNCTION conv.person_display_name(p_person_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    btrim(
      COALESCE(p."nameFirstName", '') ||
      CASE WHEN COALESCE(p."nameFirstName", '') <> '' AND COALESCE(p."nameLastName", '') <> '' THEN ' ' ELSE '' END ||
      COALESCE(p."nameLastName", '')
    ),
    ''
  )
  FROM workspace_3zyju8y4v9gnoifvksi4cn23f.person p
  WHERE p.id = p_person_id
    AND p."deletedAt" IS NULL
$$;

CREATE OR REPLACE FUNCTION conv.apply_person_name_from_text(p_person_id uuid, p_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  clean_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  first_part text;
  last_part text;
BEGIN
  IF p_person_id IS NULL OR clean_name IS NULL THEN
    RETURN;
  END IF;

  IF position(' ' IN clean_name) > 0 THEN
    first_part := split_part(clean_name, ' ', 1);
    last_part := NULLIF(btrim(substr(clean_name, length(first_part) + 2)), '');
  ELSE
    first_part := clean_name;
    last_part := NULL;
  END IF;

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.person
  SET
    "nameFirstName" = first_part,
    "nameLastName" = last_part,
    "updatedAt" = now()
  WHERE id = p_person_id
    AND "deletedAt" IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION conv.sync_owner_contact_from_opportunity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_name text;
  contact_id uuid;
  contact_name text;
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  owner_name := conv.workspace_member_display_name(NEW."ownerId");
  contact_id := COALESCE(NEW."linkedPersonId", NEW."pointOfContactId");
  contact_name := conv.person_display_name(contact_id);

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.person AS p
  SET
    "ownerId" = COALESCE(NEW."ownerId", p."ownerId"),
    "sourceOpportunityId" = COALESCE(p."sourceOpportunityId", NEW.id),
    "linkedProjectId" = COALESCE(p."linkedProjectId", NEW."linkedProjectId"),
    "xieTongFuZeRen" = COALESCE(NULLIF(NEW."xieTongFuZeRen", ''), p."xieTongFuZeRen"),
    "updatedAt" = now()
  WHERE p."deletedAt" IS NULL
    AND (p."syncGroupCode" = NEW."syncGroupCode" OR p.id = NEW."pointOfContactId" OR p.id = NEW."linkedPersonId");

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" AS x
  SET
    "sourceOpportunityId" = COALESCE(x."sourceOpportunityId", NEW.id),
    "linkedPersonId" = COALESCE(x."linkedPersonId", contact_id),
    "fuZeRen" = COALESCE(owner_name, x."fuZeRen"),
    "lianXiRen" = COALESCE(contact_name, x."lianXiRen"),
    "xieTongFuZeRen" = COALESCE(NULLIF(NEW."xieTongFuZeRen", ''), x."xieTongFuZeRen"),
    "updatedAt" = now()
  WHERE x."deletedAt" IS NULL
    AND x."syncGroupCode" = NEW."syncGroupCode";

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION conv.sync_owner_contact_from_person()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_name text;
  contact_name text;
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  owner_name := conv.workspace_member_display_name(NEW."ownerId");
  contact_name := conv.person_display_name(NEW.id);

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity AS o
  SET
    "ownerId" = COALESCE(NEW."ownerId", o."ownerId"),
    "linkedPersonId" = COALESCE(o."linkedPersonId", NEW.id),
    "pointOfContactId" = COALESCE(o."pointOfContactId", NEW.id),
    "linkedProjectId" = COALESCE(o."linkedProjectId", NEW."linkedProjectId"),
    "xieTongFuZeRen" = COALESCE(NULLIF(NEW."xieTongFuZeRen", ''), o."xieTongFuZeRen"),
    "updatedAt" = now()
  WHERE o."deletedAt" IS NULL
    AND (
      o."syncGroupCode" = NEW."syncGroupCode"
      OR o.id = NEW."sourceOpportunityId"
      OR o."pointOfContactId" = NEW.id
      OR o."linkedPersonId" = NEW.id
    );

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" AS x
  SET
    "linkedPersonId" = COALESCE(x."linkedPersonId", NEW.id),
    "sourceOpportunityId" = COALESCE(x."sourceOpportunityId", NEW."sourceOpportunityId"),
    "fuZeRen" = COALESCE(owner_name, x."fuZeRen"),
    "lianXiRen" = COALESCE(contact_name, x."lianXiRen"),
    "xieTongFuZeRen" = COALESCE(NULLIF(NEW."xieTongFuZeRen", ''), x."xieTongFuZeRen"),
    "updatedAt" = now()
  WHERE x."deletedAt" IS NULL
    AND (x."syncGroupCode" = NEW."syncGroupCode" OR x."linkedPersonId" = NEW.id);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION conv.sync_owner_contact_from_project()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_id uuid;
  person_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  owner_id := conv.workspace_member_id_by_text(NEW."fuZeRen");
  person_id := NEW."linkedPersonId";

  IF person_id IS NULL THEN
    SELECT p.id
    INTO person_id
    FROM workspace_3zyju8y4v9gnoifvksi4cn23f.person p
    WHERE p."deletedAt" IS NULL
      AND p."syncGroupCode" = NEW."syncGroupCode"
    ORDER BY p."createdAt", p.id
    LIMIT 1;
  END IF;

  IF person_id IS NOT NULL AND NULLIF(NEW."lianXiRen", '') IS NOT NULL THEN
    PERFORM conv.apply_person_name_from_text(person_id, NEW."lianXiRen");
  END IF;

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity AS o
  SET
    "linkedProjectId" = COALESCE(o."linkedProjectId", NEW.id),
    "linkedPersonId" = COALESCE(o."linkedPersonId", person_id),
    "pointOfContactId" = COALESCE(o."pointOfContactId", person_id),
    "ownerId" = COALESCE(owner_id, o."ownerId"),
    "xieTongFuZeRen" = COALESCE(NULLIF(NEW."xieTongFuZeRen", ''), o."xieTongFuZeRen"),
    "updatedAt" = now()
  WHERE o."deletedAt" IS NULL
    AND (o."syncGroupCode" = NEW."syncGroupCode" OR o.id = NEW."sourceOpportunityId");

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.person AS p
  SET
    "linkedProjectId" = COALESCE(p."linkedProjectId", NEW.id),
    "sourceOpportunityId" = COALESCE(p."sourceOpportunityId", NEW."sourceOpportunityId"),
    "ownerId" = COALESCE(owner_id, p."ownerId"),
    "xieTongFuZeRen" = COALESCE(NULLIF(NEW."xieTongFuZeRen", ''), p."xieTongFuZeRen"),
    "updatedAt" = now()
  WHERE p."deletedAt" IS NULL
    AND (p."syncGroupCode" = NEW."syncGroupCode" OR p.id = person_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_owner_contact_sync_after_write ON workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity;
CREATE TRIGGER opportunity_owner_contact_sync_after_write
AFTER INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity
FOR EACH ROW
EXECUTE FUNCTION conv.sync_owner_contact_from_opportunity();

DROP TRIGGER IF EXISTS person_owner_contact_sync_after_write ON workspace_3zyju8y4v9gnoifvksi4cn23f.person;
CREATE TRIGGER person_owner_contact_sync_after_write
AFTER INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f.person
FOR EACH ROW
EXECUTE FUNCTION conv.sync_owner_contact_from_person();

DROP TRIGGER IF EXISTS project_owner_contact_sync_after_write ON workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu";
CREATE TRIGGER project_owner_contact_sync_after_write
AFTER INSERT OR UPDATE ON workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu"
FOR EACH ROW
EXECUTE FUNCTION conv.sync_owner_contact_from_project();

-- Backfill existing linked rows once.
UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.person p
SET
  "ownerId" = COALESCE(p."ownerId", o."ownerId"),
  "sourceOpportunityId" = COALESCE(p."sourceOpportunityId", o.id),
  "linkedProjectId" = COALESCE(p."linkedProjectId", o."linkedProjectId"),
  "xieTongFuZeRen" = COALESCE(p."xieTongFuZeRen", o."xieTongFuZeRen"),
  "updatedAt" = now()
FROM workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity o
WHERE p."deletedAt" IS NULL
  AND o."deletedAt" IS NULL
  AND o."syncGroupCode" = p."syncGroupCode"
  AND o."syncGroupCode" IS NOT NULL;

UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" x
SET
  "fuZeRen" = COALESCE(conv.workspace_member_display_name(o."ownerId"), x."fuZeRen"),
  "lianXiRen" = COALESCE(conv.person_display_name(COALESCE(o."linkedPersonId", o."pointOfContactId")), x."lianXiRen"),
  "xieTongFuZeRen" = COALESCE(x."xieTongFuZeRen", o."xieTongFuZeRen"),
  "updatedAt" = now()
FROM workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity o
WHERE x."deletedAt" IS NULL
  AND o."deletedAt" IS NULL
  AND o."syncGroupCode" = x."syncGroupCode"
  AND o."syncGroupCode" IS NOT NULL;

-- Remove 协同负责人 from Opportunity / Person / Project.
-- The native owner field remains the single accountable owner.

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
    "updatedAt" = now()
  WHERE p."deletedAt" IS NULL
    AND (p."syncGroupCode" = NEW."syncGroupCode" OR p.id = NEW."pointOfContactId" OR p.id = NEW."linkedPersonId");

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" AS x
  SET
    "sourceOpportunityId" = COALESCE(x."sourceOpportunityId", NEW.id),
    "linkedPersonId" = COALESCE(x."linkedPersonId", contact_id),
    "fuZeRen" = COALESCE(owner_name, x."fuZeRen"),
    "lianXiRen" = COALESCE(contact_name, x."lianXiRen"),
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
    "updatedAt" = now()
  WHERE o."deletedAt" IS NULL
    AND (o."syncGroupCode" = NEW."syncGroupCode" OR o.id = NEW."sourceOpportunityId");

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.person AS p
  SET
    "linkedProjectId" = COALESCE(p."linkedProjectId", NEW.id),
    "sourceOpportunityId" = COALESCE(p."sourceOpportunityId", NEW."sourceOpportunityId"),
    "ownerId" = COALESCE(owner_id, p."ownerId"),
    "updatedAt" = now()
  WHERE p."deletedAt" IS NULL
    AND (p."syncGroupCode" = NEW."syncGroupCode" OR p.id = person_id);

  RETURN NEW;
END;
$$;

UPDATE core."fieldMetadata" fm
SET "isActive" = false, "updatedAt" = now()
FROM core."objectMetadata" om
WHERE fm."objectMetadataId" = om.id
  AND om."workspaceId" = '438bc184-abf4-4992-8de4-c2669c4ca65b'
  AND om."nameSingular" IN ('opportunity', 'person', 'xiangMu')
  AND fm.name = 'xieTongFuZeRen';

ALTER TABLE workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity DROP COLUMN IF EXISTS "xieTongFuZeRen";
ALTER TABLE workspace_3zyju8y4v9gnoifvksi4cn23f.person DROP COLUMN IF EXISTS "xieTongFuZeRen";
ALTER TABLE workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" DROP COLUMN IF EXISTS "xieTongFuZeRen";

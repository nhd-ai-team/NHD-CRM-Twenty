-- Sync native owner / collaborator relation fields across Opportunity, Person and Project.
-- Current canonical fields:
--   opportunity.ownerId / opportunity.xieBanRenId
--   person.ownerId / person.xieBanRenId
--   _xiangMu.ownerId / _xiangMu.xieBanRenId
--
-- Values are propagated only when the source value is not null.
-- Empty source values never clear existing values in linked records.

CREATE OR REPLACE FUNCTION conv.sync_owner_contact_from_opportunity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  contact_id uuid;
  contact_name text;
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  contact_id := COALESCE(NEW."linkedPersonId", NEW."pointOfContactId");
  contact_name := conv.person_display_name(contact_id);

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.person AS p
  SET
    "ownerId" = COALESCE(NEW."ownerId", p."ownerId"),
    "xieBanRenId" = COALESCE(NEW."xieBanRenId", p."xieBanRenId"),
    "sourceOpportunityId" = COALESCE(p."sourceOpportunityId", NEW.id),
    "linkedProjectId" = COALESCE(p."linkedProjectId", NEW."linkedProjectId"),
    "updatedAt" = now()
  WHERE p."deletedAt" IS NULL
    AND (p."syncGroupCode" = NEW."syncGroupCode" OR p.id = NEW."pointOfContactId" OR p.id = NEW."linkedPersonId");

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" AS x
  SET
    "ownerId" = COALESCE(NEW."ownerId", x."ownerId"),
    "xieBanRenId" = COALESCE(NEW."xieBanRenId", x."xieBanRenId"),
    "sourceOpportunityId" = COALESCE(x."sourceOpportunityId", NEW.id),
    "linkedPersonId" = COALESCE(x."linkedPersonId", contact_id),
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
  contact_name text;
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

  contact_name := conv.person_display_name(NEW.id);

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity AS o
  SET
    "ownerId" = COALESCE(NEW."ownerId", o."ownerId"),
    "xieBanRenId" = COALESCE(NEW."xieBanRenId", o."xieBanRenId"),
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
    "ownerId" = COALESCE(NEW."ownerId", x."ownerId"),
    "xieBanRenId" = COALESCE(NEW."xieBanRenId", x."xieBanRenId"),
    "linkedPersonId" = COALESCE(x."linkedPersonId", NEW.id),
    "sourceOpportunityId" = COALESCE(x."sourceOpportunityId", NEW."sourceOpportunityId"),
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
  person_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."syncGroupCode" IS NULL THEN
    RETURN NEW;
  END IF;

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
    "ownerId" = COALESCE(NEW."ownerId", o."ownerId"),
    "xieBanRenId" = COALESCE(NEW."xieBanRenId", o."xieBanRenId"),
    "updatedAt" = now()
  WHERE o."deletedAt" IS NULL
    AND (o."syncGroupCode" = NEW."syncGroupCode" OR o.id = NEW."sourceOpportunityId");

  UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.person AS p
  SET
    "linkedProjectId" = COALESCE(p."linkedProjectId", NEW.id),
    "sourceOpportunityId" = COALESCE(p."sourceOpportunityId", NEW."sourceOpportunityId"),
    "ownerId" = COALESCE(NEW."ownerId", p."ownerId"),
    "xieBanRenId" = COALESCE(NEW."xieBanRenId", p."xieBanRenId"),
    "updatedAt" = now()
  WHERE p."deletedAt" IS NULL
    AND (p."syncGroupCode" = NEW."syncGroupCode" OR p.id = person_id);

  RETURN NEW;
END;
$$;

-- Backfill linked records once from the best available source in each sync group.
WITH group_values AS (
  SELECT
    "syncGroupCode",
    (array_remove(array_agg("ownerId" ORDER BY source_priority), NULL))[1] AS "ownerId",
    (array_remove(array_agg("xieBanRenId" ORDER BY source_priority), NULL))[1] AS "xieBanRenId"
  FROM (
    SELECT "syncGroupCode", "ownerId", "xieBanRenId", 1 AS source_priority
    FROM workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity
    WHERE "deletedAt" IS NULL AND "syncGroupCode" IS NOT NULL
    UNION ALL
    SELECT "syncGroupCode", "ownerId", "xieBanRenId", 2 AS source_priority
    FROM workspace_3zyju8y4v9gnoifvksi4cn23f.person
    WHERE "deletedAt" IS NULL AND "syncGroupCode" IS NOT NULL
    UNION ALL
    SELECT "syncGroupCode", "ownerId", "xieBanRenId", 3 AS source_priority
    FROM workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu"
    WHERE "deletedAt" IS NULL AND "syncGroupCode" IS NOT NULL
  ) candidates
  GROUP BY "syncGroupCode"
)
UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity o
SET
  "ownerId" = COALESCE(o."ownerId", g."ownerId"),
  "xieBanRenId" = COALESCE(o."xieBanRenId", g."xieBanRenId"),
  "updatedAt" = now()
FROM group_values g
WHERE o."deletedAt" IS NULL
  AND o."syncGroupCode" = g."syncGroupCode";

WITH group_values AS (
  SELECT
    "syncGroupCode",
    (array_remove(array_agg("ownerId" ORDER BY source_priority), NULL))[1] AS "ownerId",
    (array_remove(array_agg("xieBanRenId" ORDER BY source_priority), NULL))[1] AS "xieBanRenId"
  FROM (
    SELECT "syncGroupCode", "ownerId", "xieBanRenId", 1 AS source_priority
    FROM workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity
    WHERE "deletedAt" IS NULL AND "syncGroupCode" IS NOT NULL
    UNION ALL
    SELECT "syncGroupCode", "ownerId", "xieBanRenId", 2 AS source_priority
    FROM workspace_3zyju8y4v9gnoifvksi4cn23f.person
    WHERE "deletedAt" IS NULL AND "syncGroupCode" IS NOT NULL
    UNION ALL
    SELECT "syncGroupCode", "ownerId", "xieBanRenId", 3 AS source_priority
    FROM workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu"
    WHERE "deletedAt" IS NULL AND "syncGroupCode" IS NOT NULL
  ) candidates
  GROUP BY "syncGroupCode"
)
UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f.person p
SET
  "ownerId" = COALESCE(p."ownerId", g."ownerId"),
  "xieBanRenId" = COALESCE(p."xieBanRenId", g."xieBanRenId"),
  "updatedAt" = now()
FROM group_values g
WHERE p."deletedAt" IS NULL
  AND p."syncGroupCode" = g."syncGroupCode";

WITH group_values AS (
  SELECT
    "syncGroupCode",
    (array_remove(array_agg("ownerId" ORDER BY source_priority), NULL))[1] AS "ownerId",
    (array_remove(array_agg("xieBanRenId" ORDER BY source_priority), NULL))[1] AS "xieBanRenId"
  FROM (
    SELECT "syncGroupCode", "ownerId", "xieBanRenId", 1 AS source_priority
    FROM workspace_3zyju8y4v9gnoifvksi4cn23f.opportunity
    WHERE "deletedAt" IS NULL AND "syncGroupCode" IS NOT NULL
    UNION ALL
    SELECT "syncGroupCode", "ownerId", "xieBanRenId", 2 AS source_priority
    FROM workspace_3zyju8y4v9gnoifvksi4cn23f.person
    WHERE "deletedAt" IS NULL AND "syncGroupCode" IS NOT NULL
    UNION ALL
    SELECT "syncGroupCode", "ownerId", "xieBanRenId", 3 AS source_priority
    FROM workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu"
    WHERE "deletedAt" IS NULL AND "syncGroupCode" IS NOT NULL
  ) candidates
  GROUP BY "syncGroupCode"
)
UPDATE workspace_3zyju8y4v9gnoifvksi4cn23f."_xiangMu" x
SET
  "ownerId" = COALESCE(x."ownerId", g."ownerId"),
  "xieBanRenId" = COALESCE(x."xieBanRenId", g."xieBanRenId"),
  "updatedAt" = now()
FROM group_values g
WHERE x."deletedAt" IS NULL
  AND x."syncGroupCode" = g."syncGroupCode";

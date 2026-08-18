const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function findOpportunityObject(client) {
  const result = await client.query(`
    SELECT id, "workspaceId"
    FROM core."objectMetadata"
    WHERE "nameSingular" = 'opportunity'
      AND "isActive" = true
    ORDER BY "createdAt"
    LIMIT 1
  `);
  const object = result.rows[0];
  if (!object?.id) throw new Error('active opportunity object metadata not found');
  return object;
}

async function fieldId(client, objectMetadataId, name) {
  const result = await client.query(
    `SELECT id FROM core."fieldMetadata" WHERE "objectMetadataId" = $1 AND name = $2 AND "isActive" = true LIMIT 1`,
    [objectMetadataId, name],
  );
  return result.rows[0]?.id || null;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const opportunity = await findOpportunityObject(client);
    const nameFieldId = await fieldId(client, opportunity.id, 'name');
    const companyFieldId = await fieldId(client, opportunity.id, 'company');
    const leadNoFieldId = await fieldId(client, opportunity.id, 'leadNo');
    const customerIdentityKeyFieldId = await fieldId(client, opportunity.id, 'customerIdentityKey');

    if (!nameFieldId) throw new Error('opportunity.name field metadata not found');

    await client.query(
      `UPDATE core."fieldMetadata"
       SET label = '公司名称',
           "isLabelSyncedWithName" = false,
           "updatedAt" = now()
       WHERE id = $1`,
      [nameFieldId],
    );

    if (leadNoFieldId) {
      await client.query(
        `UPDATE core."fieldMetadata"
         SET label = '线索id',
             "isLabelSyncedWithName" = false,
             "updatedAt" = now()
         WHERE id = $1`,
        [leadNoFieldId],
      );
      await client.query(
        `UPDATE core."viewField" vf
         SET "isVisible" = true,
             position = LEAST(COALESCE(vf.position, 0.1), 0.1),
             "updatedAt" = now()
         FROM core."view" v
         WHERE vf."viewId" = v.id
           AND v."objectMetadataId" = $1
           AND v.type = 'TABLE'
           AND vf."fieldMetadataId" = $2`,
        [opportunity.id, leadNoFieldId],
      );
      await client.query(
        `INSERT INTO core."viewField" (
           "universalIdentifier",
           "fieldMetadataId",
           "isVisible",
           size,
           position,
           "viewId",
           "workspaceId",
           "applicationId"
         )
         SELECT
           uuid_generate_v4(),
           $2,
           true,
           120,
           0.1,
           v.id,
           v."workspaceId",
           v."applicationId"
         FROM core."view" v
         WHERE v."objectMetadataId" = $1
           AND v.type = 'TABLE'
           AND v."deletedAt" IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM core."viewField" vf
             WHERE vf."viewId" = v.id
               AND vf."fieldMetadataId" = $2
               AND vf."deletedAt" IS NULL
           )`,
        [opportunity.id, leadNoFieldId],
      );
    }

    if (companyFieldId) {
      await client.query(
        `UPDATE core."viewField" vf
         SET "isVisible" = false,
             "updatedAt" = now()
         FROM core."view" v
         WHERE vf."viewId" = v.id
           AND v."objectMetadataId" = $1
           AND v.type = 'TABLE'
           AND vf."fieldMetadataId" = $2`,
        [opportunity.id, companyFieldId],
      );
      await client.query(
        `UPDATE core."pageLayoutWidget" plw
         SET "deletedAt" = COALESCE(plw."deletedAt", now()),
             "updatedAt" = now()
         FROM core."pageLayoutTab" plt
         JOIN core."pageLayout" pl ON pl.id = plt."pageLayoutId"
         WHERE plw."pageLayoutTabId" = plt.id
           AND pl."objectMetadataId" = $1
           AND plw.type = 'FIELD'
           AND plw.configuration->>'fieldMetadataId' = $2
           AND plw."deletedAt" IS NULL`,
        [opportunity.id, companyFieldId],
      );
    }

    if (customerIdentityKeyFieldId) {
      await client.query(
        `UPDATE core."viewField" vf
         SET "isVisible" = false,
             "updatedAt" = now()
         FROM core."view" v
         WHERE vf."viewId" = v.id
           AND v."objectMetadataId" = $1
           AND v.type = 'TABLE'
           AND vf."fieldMetadataId" = $2`,
        [opportunity.id, customerIdentityKeyFieldId],
      );
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      ok: true,
      objectMetadataId: opportunity.id,
      workspaceId: opportunity.workspaceId,
      fields: {
        name: nameFieldId,
        company: companyFieldId,
        leadNo: leadNoFieldId,
        customerIdentityKey: customerIdentityKeyFieldId,
      },
      note: 'Restart Twenty server/worker or clear metadata cache if the UI still shows the old labels.',
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

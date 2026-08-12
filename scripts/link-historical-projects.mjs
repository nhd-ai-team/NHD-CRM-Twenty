#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { Pool } = require('../middleware/node_modules/pg');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv(path.join(ROOT, '.env'));

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
};

const mode = has('--apply') ? 'apply' : has('--mapping') ? 'mapping' : 'dry-run';
const mappingPath = valueOf('--mapping');
const schemaArg = valueOf('--schema');
const shouldOutputJson = has('--json');

const dbUser = process.env.PG_DATABASE_USER || 'postgres';
const dbPassword = process.env.PG_DATABASE_PASSWORD || '';
const dbHost = process.env.PG_DATABASE_HOST && process.env.PG_DATABASE_HOST !== 'db'
  ? process.env.PG_DATABASE_HOST
  : '127.0.0.1';
const dbPort = process.env.PG_DATABASE_PORT && process.env.PG_DATABASE_HOST !== 'db'
  ? process.env.PG_DATABASE_PORT
  : '15432';
const dbName = process.env.PG_DATABASE_NAME || 'default';
const DATABASE_URL = process.env.CRM_DATABASE_URL
  || `postgres://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/${encodeURIComponent(dbName)}`;
const pool = process.env.CRM_DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : new Pool({
    user: dbUser,
    password: String(dbPassword),
    host: dbHost,
    port: Number(dbPort),
    database: dbName,
  });

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function getWorkspaceSchema(client) {
  if (schemaArg) return schemaArg;
  const result = await client.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'workspace_%'
    ORDER BY schema_name
    LIMIT 1
  `);
  const schema = result.rows[0]?.schema_name;
  if (!schema) throw new Error('未找到 workspace schema，请用 --schema 指定');
  return schema;
}

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1];
    if (inQuotes && ch === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && ch === ',') {
      row.push(cell);
      cell = '';
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  if (rows.length === 0) return [];
  const headers = rows[0].map((item) => item.trim());
  return rows.slice(1).map((items) => Object.fromEntries(headers.map((header, index) => [header, String(items[index] || '').trim()])));
}

async function findCandidateReport(client, schema) {
  const s = quoteIdent(schema);
  const result = await client.query(`
    WITH opportunity_candidates AS (
      SELECT
        x.id AS project_id,
        x.name AS project_name,
        o.id AS opportunity_id,
        o."syncGroupCode",
        COALESCE(o."linkedPersonId", o."pointOfContactId") AS person_id,
        CASE
          WHEN o.id = x."sourceOpportunityId" THEN 'sourceOpportunityId'
          WHEN COALESCE(o."linkedPersonId", o."pointOfContactId") = x."linkedPersonId" THEN 'linkedPersonId'
          WHEN NULLIF(trim(COALESCE(o."guanWangLianJiePrimaryLinkUrl", '')), '') IS NOT NULL
           AND lower(trim(o."guanWangLianJiePrimaryLinkUrl")) = lower(trim(COALESCE(x."guanWangLianJiePrimaryLinkUrl", ''))) THEN 'website'
          WHEN NULLIF(trim(COALESCE(o.name, '')), '') IS NOT NULL
           AND lower(trim(o.name)) = lower(trim(COALESCE(x.name, ''))) THEN 'companyName'
          ELSE 'unknown'
        END AS reason
      FROM ${s}."_xiangMu" x
      JOIN ${s}.opportunity o ON o."deletedAt" IS NULL
        AND o."syncGroupCode" IS NOT NULL
        AND (
          o.id = x."sourceOpportunityId"
          OR COALESCE(o."linkedPersonId", o."pointOfContactId") = x."linkedPersonId"
          OR (
            NULLIF(trim(COALESCE(o."guanWangLianJiePrimaryLinkUrl", '')), '') IS NOT NULL
            AND lower(trim(o."guanWangLianJiePrimaryLinkUrl")) = lower(trim(COALESCE(x."guanWangLianJiePrimaryLinkUrl", '')))
          )
          OR (
            NULLIF(trim(COALESCE(o.name, '')), '') IS NOT NULL
            AND lower(trim(o.name)) = lower(trim(COALESCE(x.name, '')))
          )
        )
      WHERE x."deletedAt" IS NULL
        AND x."syncGroupCode" IS NULL
    ),
    person_candidates AS (
      SELECT
        x.id AS project_id,
        x.name AS project_name,
        p."sourceOpportunityId" AS opportunity_id,
        p."syncGroupCode",
        p.id AS person_id,
        CASE
          WHEN p.id = x."linkedPersonId" THEN 'linkedPersonId'
          WHEN NULLIF(trim(COALESCE(p."guanWangLianJiePrimaryLinkUrl", '')), '') IS NOT NULL
           AND lower(trim(p."guanWangLianJiePrimaryLinkUrl")) = lower(trim(COALESCE(x."guanWangLianJiePrimaryLinkUrl", ''))) THEN 'personWebsite'
          WHEN NULLIF(trim(COALESCE(p."gongSiMingCheng", '')), '') IS NOT NULL
           AND lower(trim(p."gongSiMingCheng")) = lower(trim(COALESCE(x.name, ''))) THEN 'personCompanyName'
          WHEN NULLIF(trim(COALESCE(p."fangKeId", '')), '') IS NOT NULL
           AND trim(p."fangKeId") = trim(COALESCE(x."fangKeId", '')) THEN 'visitorId'
          ELSE 'unknown'
        END AS reason
      FROM ${s}."_xiangMu" x
      JOIN ${s}.person p ON p."deletedAt" IS NULL
        AND p."syncGroupCode" IS NOT NULL
        AND (
          p.id = x."linkedPersonId"
          OR (
            NULLIF(trim(COALESCE(p."guanWangLianJiePrimaryLinkUrl", '')), '') IS NOT NULL
            AND lower(trim(p."guanWangLianJiePrimaryLinkUrl")) = lower(trim(COALESCE(x."guanWangLianJiePrimaryLinkUrl", '')))
          )
          OR (
            NULLIF(trim(COALESCE(p."gongSiMingCheng", '')), '') IS NOT NULL
            AND lower(trim(p."gongSiMingCheng")) = lower(trim(COALESCE(x.name, '')))
          )
          OR (
            NULLIF(trim(COALESCE(p."fangKeId", '')), '') IS NOT NULL
            AND trim(p."fangKeId") = trim(COALESCE(x."fangKeId", ''))
          )
        )
      WHERE x."deletedAt" IS NULL
        AND x."syncGroupCode" IS NULL
    ),
    candidates AS (
      SELECT * FROM opportunity_candidates
      UNION ALL
      SELECT * FROM person_candidates
    ),
    grouped AS (
      SELECT
        project_id,
        min(project_name) AS project_name,
        array_agg(DISTINCT "syncGroupCode" ORDER BY "syncGroupCode") AS matched_codes,
        array_agg(DISTINCT reason ORDER BY reason) AS reasons,
        (array_agg(opportunity_id ORDER BY reason, opportunity_id::text))[1] AS opportunity_id,
        (array_agg(person_id ORDER BY reason, opportunity_id::text, person_id::text))[1] AS person_id
      FROM candidates
      GROUP BY project_id
    )
    SELECT
      x.id AS "projectId",
      x.name AS "projectName",
      x."syncGroupCode" AS "currentSyncGroupCode",
      g.matched_codes AS "matchedCodes",
      g.reasons,
      g.opportunity_id AS "sourceOpportunityId",
      g.person_id AS "linkedPersonId",
      CASE
        WHEN x."syncGroupCode" IS NOT NULL THEN 'already_linked'
        WHEN g.project_id IS NULL THEN 'unmatched'
        WHEN cardinality(g.matched_codes) > 1 THEN 'ambiguous'
        WHEN EXISTS (
          SELECT 1 FROM ${s}."_xiangMu" other
          WHERE other."deletedAt" IS NULL
            AND other.id <> x.id
            AND other."syncGroupCode" = g.matched_codes[1]
        ) THEN 'duplicate_project_code'
        ELSE 'unique'
      END AS status
    FROM ${s}."_xiangMu" x
    LEFT JOIN grouped g ON g.project_id = x.id
    WHERE x."deletedAt" IS NULL
    ORDER BY status, x."createdAt", x.id
  `);
  return result.rows;
}

async function applyUniqueMatches(client, schema, report) {
  const s = quoteIdent(schema);
  const uniqueRows = report.filter((row) => row.status === 'unique');
  for (const row of uniqueRows) {
    const code = row.matchedCodes?.[0];
    await client.query(`
      UPDATE ${s}."_xiangMu"
      SET
        "syncGroupCode" = $2,
        "sourceOpportunityId" = COALESCE("sourceOpportunityId", $3),
        "linkedPersonId" = COALESCE("linkedPersonId", $4),
        "updatedAt" = now()
      WHERE id = $1 AND "deletedAt" IS NULL
    `, [row.projectId, code, row.sourceOpportunityId || null, row.linkedPersonId || null]);
    await client.query(`
      UPDATE ${s}.opportunity
      SET "linkedProjectId" = COALESCE("linkedProjectId", $2), "updatedAt" = now()
      WHERE "syncGroupCode" = $1 AND "deletedAt" IS NULL
    `, [code, row.projectId]);
    await client.query(`
      UPDATE ${s}.person
      SET "linkedProjectId" = COALESCE("linkedProjectId", $2), "updatedAt" = now()
      WHERE "syncGroupCode" = $1 AND "deletedAt" IS NULL
    `, [code, row.projectId]);
  }
  return uniqueRows.length;
}

async function applyMapping(client, schema, rows) {
  const s = quoteIdent(schema);
  let applied = 0;
  for (const row of rows) {
    const projectId = row.projectId || row.project_id || row['项目ID'];
    let syncGroupCode = row.syncGroupCode || row.sync_group_code || row['底层编号'];
    const sourceOpportunityId = row.sourceOpportunityId || row.source_opportunity_id || row['线索ID'] || null;
    const linkedPersonId = row.linkedPersonId || row.linked_person_id || row['客户ID'] || null;
    if (!projectId) throw new Error('mapping 缺少 projectId');
    if (!syncGroupCode && sourceOpportunityId) {
      const result = await client.query(`SELECT "syncGroupCode" FROM ${s}.opportunity WHERE id = $1 AND "deletedAt" IS NULL`, [sourceOpportunityId]);
      syncGroupCode = result.rows[0]?.syncGroupCode;
    }
    if (!syncGroupCode && linkedPersonId) {
      const result = await client.query(`SELECT "syncGroupCode" FROM ${s}.person WHERE id = $1 AND "deletedAt" IS NULL`, [linkedPersonId]);
      syncGroupCode = result.rows[0]?.syncGroupCode;
    }
    if (!syncGroupCode) throw new Error(`mapping ${projectId} 缺少 syncGroupCode，且无法从线索/客户推导`);
    const duplicate = await client.query(`
      SELECT id FROM ${s}."_xiangMu"
      WHERE "deletedAt" IS NULL AND id <> $1 AND "syncGroupCode" = $2
      LIMIT 1
    `, [projectId, syncGroupCode]);
    if (duplicate.rowCount) throw new Error(`syncGroupCode ${syncGroupCode} 已被项目 ${duplicate.rows[0].id} 占用`);
    await client.query(`
      UPDATE ${s}."_xiangMu"
      SET
        "syncGroupCode" = $2,
        "sourceOpportunityId" = COALESCE($3, "sourceOpportunityId"),
        "linkedPersonId" = COALESCE($4, "linkedPersonId"),
        "updatedAt" = now()
      WHERE id = $1 AND "deletedAt" IS NULL
    `, [projectId, syncGroupCode, sourceOpportunityId, linkedPersonId]);
    await client.query(`
      UPDATE ${s}.opportunity
      SET "linkedProjectId" = COALESCE("linkedProjectId", $2), "updatedAt" = now()
      WHERE "syncGroupCode" = $1 AND "deletedAt" IS NULL
    `, [syncGroupCode, projectId]);
    await client.query(`
      UPDATE ${s}.person
      SET "linkedProjectId" = COALESCE("linkedProjectId", $2), "updatedAt" = now()
      WHERE "syncGroupCode" = $1 AND "deletedAt" IS NULL
    `, [syncGroupCode, projectId]);
    applied += 1;
  }
  return applied;
}

function summarize(report) {
  return report.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
}

function printReport(report) {
  if (shouldOutputJson) {
    console.log(JSON.stringify({ summary: summarize(report), records: report }, null, 2));
    return;
  }
  console.log('Summary:', summarize(report));
  console.table(report.map((row) => ({
    status: row.status,
    projectId: row.projectId,
    projectName: row.projectName || '',
    matchedCode: row.matchedCodes?.join('|') || '',
    reasons: row.reasons?.join('|') || '',
    sourceOpportunityId: row.sourceOpportunityId || '',
    linkedPersonId: row.linkedPersonId || '',
  })));
}

const client = await pool.connect();
try {
  const schema = await getWorkspaceSchema(client);
  console.log(`Workspace schema: ${schema}`);
  await client.query('BEGIN');

  if (mode === 'mapping') {
    const rows = parseCsv(path.resolve(mappingPath));
    const count = await applyMapping(client, schema, rows);
    await client.query('COMMIT');
    console.log(`Mapping applied: ${count}`);
  } else {
    const before = await findCandidateReport(client, schema);
    printReport(before);
    if (mode === 'apply') {
      const count = await applyUniqueMatches(client, schema, before);
      await client.query('COMMIT');
      console.log(`Unique project links applied: ${count}`);
    } else {
      await client.query('ROLLBACK');
      console.log('Dry-run only. No database changes were written.');
    }
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

// 回滚 scripts/ensure-project-relation-fields.mjs：删除 项目(xiangMu) 的 company / pointOfContact 关系字段
// （deleteOneField 会一并删掉反向字段、物理列 companyId/pointOfContactId、FK、索引）。
// ⚠️ 删除前先执行触发器回滚（重跑 migrations/20260826_direction_a_stopgap_decouple_name_company.sql），
//    否则同步函数仍引用 companyId 会在写入时报错。
// 用法：docker compose exec -T -e TWENTY_API_KEY=... server node - < scripts/rollback-project-relation-fields.mjs

const apiUrl = process.env.TWENTY_METADATA_URL || 'http://server:3000/metadata';
const apiKey = process.env.TWENTY_API_KEY;
if (!apiKey) throw new Error('TWENTY_API_KEY is required');

const request = async (query, variables = {}) => {
  const r = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables }),
  });
  const p = await r.json();
  if (!r.ok || p.errors) throw new Error(p.errors?.[0]?.message || `Metadata request failed: ${r.status}`);
  return p.data;
};

const data = await request(`
  query { objects(paging: { first: 200 }) { edges { node { id nameSingular
    fields(paging: { first: 1000 }) { edges { node { id name type } } } } } } }
`);
const project = data.objects.edges.map(e => e.node).find(o => o.nameSingular === 'xiangMu');
if (!project) throw new Error('xiangMu object not found');

for (const name of ['company', 'pointOfContact']) {
  const f = project.fields.edges.map(e => e.node).find(n => n.name === name);
  if (!f) { console.log(`skip: xiangMu.${name} not found`); continue; }
  await request(`mutation($id: UUID!){ deleteOneField(input:{id:$id}){ id name } }`, { id: f.id });
  console.log(`deleted: xiangMu.${name}`);
}
console.log('done. 记得随后清元数据缓存 + 重启 server/worker。');

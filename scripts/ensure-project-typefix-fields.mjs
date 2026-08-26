// 项目(xiangMu) 字段改类型：Twenty 不支持原地改类型，用「建新字段(正确类型)+迁数据+停用旧字段」。
//   xunPanShiJian  TEXT     → xunPanRiQi     DATE_TIME  「初次询盘时间」(年/月文本按月初)
//   xiangMuChengBenJie TEXT → chengBenJiaGe  CURRENCY   「项目成本价」
// 幂等：已存在则跳过。建字段走 metadata API（原子建列/索引，避开 v2.17 幽灵字段）。
// 迁数据 + 停用旧字段 由后续 SQL 完成，不在本脚本。
// 用法：docker compose exec -T -e TWENTY_API_KEY=... server node - < scripts/ensure-project-typefix-fields.mjs

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
    fields(paging: { first: 1000 }) { edges { node { name type } } } } } } }
`);
const project = data.objects.edges.map(e => e.node).find(o => o.nameSingular === 'xiangMu');
if (!project) throw new Error('xiangMu object not found');

const fields = [
  { name: 'xunPanRiQi',    label: '初次询盘时间', type: 'DATE_TIME', icon: 'IconCalendar',
    description: '首次询盘日期（由 xunPanShiJian 文本迁移，年/月按当月 1 日）' },
  { name: 'chengBenJiaGe', label: '项目成本价',   type: 'CURRENCY',  icon: 'IconCoin',
    description: '项目成本价（由 xiangMuChengBenJie 文本迁移）' },
];

for (const f of fields) {
  if (project.fields.edges.some(({ node }) => node.name === f.name)) {
    console.log(`skip: xiangMu.${f.name} already exists`); continue;
  }
  const created = await request(`
    mutation($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) { id name label type }
    }
  `, {
    input: { field: {
      objectMetadataId: project.id,
      type: f.type, name: f.name, label: f.label, description: f.description,
      icon: f.icon, isNullable: true,
    } },
  });
  console.log(`created: xiangMu.${f.name} ->`, created.createOneField);
}
console.log('done.');

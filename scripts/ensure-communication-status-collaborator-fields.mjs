// 给沟通状态对象增加协办人 / 协办人2关系字段。
// 用法：TWENTY_METADATA_URL=http://localhost:3000/metadata TWENTY_API_KEY=... node scripts/ensure-communication-status-collaborator-fields.mjs

const apiUrl = process.env.TWENTY_METADATA_URL || 'http://localhost:3000/metadata';
const apiKey = process.env.TWENTY_API_KEY;
if (!apiKey) throw new Error('TWENTY_API_KEY is required');

const request = async (query, variables = {}) => {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(payload.errors?.[0]?.message || `Metadata request failed: ${response.status}`);
  }
  return payload.data;
};

const data = await request(`
  query {
    objects(paging: { first: 200 }) {
      edges { node { id nameSingular fields(paging: { first: 1000 }) { edges { node { name } } } } }
    }
  }
`);
const objects = Object.fromEntries(data.objects.edges.map(({ node }) => [node.nameSingular, node]));
const history = objects.duiHuaLiShi;
const workspaceMember = objects.workspaceMember;
if (!history || !workspaceMember) throw new Error('duiHuaLiShi/workspaceMember object not found');

const fields = [
  { name: 'xieBanRen', label: '协办人', reverseLabel: 'Co-handled Communication Status' },
  { name: 'xieZuoRen2', label: '协办人2', reverseLabel: 'Second Co-handled Communication Status' },
];

for (const field of fields) {
  if (history.fields.edges.some(({ node }) => node.name === field.name)) {
    console.log(`skip: duiHuaLiShi.${field.name} already exists`);
    continue;
  }
  const result = await request(`
    mutation($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) { id name label type }
    }
  `, { input: { field: {
    objectMetadataId: history.id,
    type: 'RELATION',
    name: field.name,
    label: field.label,
    description: `${field.label}，用于沟通状态行级可见范围`,
    icon: 'IconUsersGroup',
    isNullable: true,
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: workspaceMember.id,
      targetFieldLabel: field.reverseLabel,
      targetFieldIcon: 'IconUsersGroup',
    },
  } } });
  console.log(`created: duiHuaLiShi.${field.name} -> ${result.createOneField.id}`);
}


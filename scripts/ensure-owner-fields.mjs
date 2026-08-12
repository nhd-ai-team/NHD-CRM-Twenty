// 给 person / company 补一个与 opportunity.owner 等价的「负责人」关系字段
// （RELATION / MANY_TO_ONE → workspaceMember），走 Twenty metadata API，幂等。
// 用法（在 server 容器网络内）：
//   docker compose exec -T -e TWENTY_API_KEY=... server \
//     node - < scripts/ensure-owner-fields.mjs
// 或本机：TWENTY_METADATA_URL=http://localhost:3000/metadata TWENTY_API_KEY=... node scripts/ensure-owner-fields.mjs

const apiUrl = process.env.TWENTY_METADATA_URL || 'http://server:3000/metadata';
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
      edges {
        node {
          id
          nameSingular
          fields(paging: { first: 1000 }) {
            edges { node { name type } }
          }
        }
      }
    }
  }
`);

const objects = Object.fromEntries(
  data.objects.edges.map(({ node }) => [node.nameSingular, node]),
);

const workspaceMember = objects.workspaceMember;
if (!workspaceMember) throw new Error('workspaceMember object not found');

// 目标对象 → 反向字段标签（挂在 workspaceMember 上，镜像 opportunity.owner 的 ownedOpportunities）
const targets = [
  { nameSingular: 'person', reverseLabel: 'Owned People' },
  { nameSingular: 'company', reverseLabel: 'Owned Companies' },
];

for (const { nameSingular, reverseLabel } of targets) {
  const object = objects[nameSingular];
  if (!object) { console.log(`skip: object ${nameSingular} not found`); continue; }

  const already = object.fields.edges.some(({ node }) => node.name === 'owner');
  if (already) { console.log(`skip: ${nameSingular}.owner already exists`); continue; }

  const created = await request(`
    mutation($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) { id name label type }
    }
  `, {
    input: {
      field: {
        objectMetadataId: object.id,
        type: 'RELATION',
        name: 'owner',
        label: '负责人',
        description: '记录负责人，用于行级可见范围（负责人=我）',
        icon: 'IconUserCircle',
        isNullable: true,
        relationCreationPayload: {
          type: 'MANY_TO_ONE',
          targetObjectMetadataId: workspaceMember.id,
          targetFieldLabel: reverseLabel,
          targetFieldIcon: 'IconUserCircle',
        },
      },
    },
  });
  console.log(`created: ${nameSingular}.owner ->`, created.createOneField);
}

console.log('done.');

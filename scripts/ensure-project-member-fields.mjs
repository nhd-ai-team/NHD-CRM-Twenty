// 给项目(xiangMu)加 负责人(owner) + 协办人(xieBanRen) 单成员关系字段，
// 与 opportunity/person/company 上的同名字段同型，用于统一行级权限。幂等。
//   docker compose exec -T -e TWENTY_API_KEY=... -e TWENTY_METADATA_URL=http://localhost:3000/metadata \
//     server node - < scripts/ensure-project-member-fields.mjs

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
      edges { node { id nameSingular fields(paging: { first: 1000 }) { edges { node { name } } } } }
    }
  }
`);
const objects = Object.fromEntries(data.objects.edges.map(({ node }) => [node.nameSingular, node]));
const project = objects.xiangMu;
const workspaceMember = objects.workspaceMember;
if (!project) throw new Error('xiangMu object not found');
if (!workspaceMember) throw new Error('workspaceMember object not found');

const fields = [
  { name: 'owner', label: '负责人', icon: 'IconUserCircle', reverseLabel: 'Owned Projects',
    description: '项目负责人，用于行级可见范围（负责人=我）' },
  { name: 'xieBanRen', label: '协办人', icon: 'IconUsersGroup', reverseLabel: 'Co-handled Projects',
    description: '项目协办成员，用于行级可见范围（协办人=我 也可见）' },
];

for (const f of fields) {
  if (project.fields.edges.some(({ node }) => node.name === f.name)) {
    console.log(`skip: xiangMu.${f.name} already exists`);
    continue;
  }
  const created = await request(`
    mutation($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) { id name label type }
    }
  `, {
    input: {
      field: {
        objectMetadataId: project.id,
        type: 'RELATION',
        name: f.name,
        label: f.label,
        description: f.description,
        icon: f.icon,
        isNullable: true,
        relationCreationPayload: {
          type: 'MANY_TO_ONE',
          targetObjectMetadataId: workspaceMember.id,
          targetFieldLabel: f.reverseLabel,
          targetFieldIcon: f.icon,
        },
      },
    },
  });
  console.log(`created: xiangMu.${f.name} ->`, created.createOneField);
}
console.log('done.');

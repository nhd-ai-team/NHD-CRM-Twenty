// 方向A · 二期：给 项目(xiangMu) 补 company / pointOfContact 两个关系字段
// （RELATION / MANY_TO_ONE，走 Twenty metadata API，幂等）。
// 用 API 让 Twenty 原子地建好 fieldMetadata(正+反) + 物理列(companyId/pointOfContactId) + FK + 索引，
// 规避 v2.17 手搓 SQL 的「幽灵字段」问题。
// sourceOpportunity 本轮不做（sourceOpportunityId 仍作隐藏纽带列，与 person 现有模式一致）。
//
// 用法（server 容器网络内）：
//   docker compose exec -T -e TWENTY_API_KEY=... server node - < scripts/ensure-project-relation-fields.mjs
// 或本机：TWENTY_METADATA_URL=http://localhost:3000/metadata TWENTY_API_KEY=... node scripts/ensure-project-relation-fields.mjs

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

const project = objects.xiangMu;
if (!project) throw new Error('xiangMu (项目) object not found');

// 正向字段挂在 项目 上；反向字段挂在目标对象上，用英文 label 保证派生技术名干净，
// 建完后可另行改中文 label（低风险）。
const fields = [
  {
    name: 'company',
    label: '公司',
    description: '项目所属公司（方向A：公司=单一真相）',
    icon: 'IconBuildingSkyscraper',
    targetNameSingular: 'company',
    reverseLabel: 'Projects',
    reverseIcon: 'IconFolders',
  },
  {
    name: 'pointOfContact',
    label: '客户联系人',
    description: '项目对应的客户联系人（Person）',
    icon: 'IconUser',
    targetNameSingular: 'person',
    reverseLabel: 'Contact Projects',
    reverseIcon: 'IconFolders',
  },
];

for (const f of fields) {
  const target = objects[f.targetNameSingular];
  if (!target) { console.log(`skip: target object ${f.targetNameSingular} not found`); continue; }

  const already = project.fields.edges.some(({ node }) => node.name === f.name);
  if (already) { console.log(`skip: xiangMu.${f.name} already exists`); continue; }

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
          targetObjectMetadataId: target.id,
          targetFieldLabel: f.reverseLabel,
          targetFieldIcon: f.reverseIcon,
        },
      },
    },
  });
  console.log(`created: xiangMu.${f.name} ->`, created.createOneField);
}

console.log('done.');

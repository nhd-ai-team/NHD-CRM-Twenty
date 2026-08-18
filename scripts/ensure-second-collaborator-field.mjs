// 给 opportunity / person / xiangMu 各加一个「协办人2」单成员关系字段。
// 用于导入历史 Excel 中第三个负责人；字段为 RELATION / MANY_TO_ONE -> workspaceMember。
// 用法：
//   docker compose exec -T -e TWENTY_API_KEY=... server node - < scripts/ensure-second-collaborator-field.mjs

const apiUrl = process.env.TWENTY_METADATA_URL || 'http://server:3000/metadata';
const apiKey = process.env.TWENTY_API_KEY;

if (!apiKey) {
  throw new Error('TWENTY_API_KEY is required');
}

const request = async (query, variables = {}) => {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
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
            edges { node { name } }
          }
        }
      }
    }
  }
`);

const objects = Object.fromEntries(data.objects.edges.map(({ node }) => [node.nameSingular, node]));
const workspaceMember = objects.workspaceMember;

if (!workspaceMember) {
  throw new Error('workspaceMember object not found');
}

const FIELD_NAME = 'xieZuoRen2';
const targets = [
  { nameSingular: 'opportunity', reverseLabel: 'Second co-handled Opportunities' },
  { nameSingular: 'person', reverseLabel: 'Second co-handled People' },
  { nameSingular: 'xiangMu', reverseLabel: 'Second co-handled Projects' },
];

for (const { nameSingular, reverseLabel } of targets) {
  const object = objects[nameSingular];
  if (!object) {
    console.log(`skip: object ${nameSingular} not found`);
    continue;
  }

  if (object.fields.edges.some(({ node }) => node.name === FIELD_NAME)) {
    console.log(`skip: ${nameSingular}.${FIELD_NAME} already exists`);
    continue;
  }

  const created = await request(`
    mutation($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) { id name label type }
    }
  `, {
    input: {
      field: {
        objectMetadataId: object.id,
        type: 'RELATION',
        name: FIELD_NAME,
        label: '协办人2',
        description: '第二协办成员，用于导入历史负责人列表中的第三个人。',
        icon: 'IconUsersGroup',
        isNullable: true,
        relationCreationPayload: {
          type: 'MANY_TO_ONE',
          targetObjectMetadataId: workspaceMember.id,
          targetFieldLabel: reverseLabel,
          targetFieldIcon: 'IconUsersGroup',
        },
      },
    },
  });

  console.log(`created: ${nameSingular}.${FIELD_NAME} -> ${created.createOneField.id}`);
}

console.log('done.');

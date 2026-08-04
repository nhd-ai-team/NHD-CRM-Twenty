const apiUrl = process.env.TWENTY_METADATA_URL || 'http://server:3000/metadata';
const apiKey = process.env.TWENTY_API_KEY;

if (!apiKey) throw new Error('TWENTY_API_KEY is required');

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

const objectData = await request(`
  query {
    objects(paging: { first: 100 }) {
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

const targets = new Set(['person', 'opportunity', 'xiangMu']);
const objects = objectData.objects.edges
  .map(({ node }) => node)
  .filter((object) => targets.has(object.nameSingular));

for (const object of objects) {
  const exists = object.fields.edges.some(({ node }) => node.name === 'guanWangLianJie');
  if (exists) continue;

  await request(`
    mutation($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) { id name label type }
    }
  `, {
    input: {
      field: {
        objectMetadataId: object.id,
        type: 'LINKS',
        name: 'guanWangLianJie',
        label: '官网链接',
        description: '客户官方网站，用于跨线索、客户和项目进行重复性检查',
        icon: 'IconWorld',
        isNullable: true,
      },
    },
  });
  console.log(`Created guanWangLianJie on ${object.nameSingular}`);
}

console.log('Website dedup fields are ready.');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  attachmentFromUploadedFile,
  createUploadFileAllowed,
  fileMessageType,
  fileTypeFromName,
  normalizeOutboundAttachments,
  normalizeUploadFilename,
} = require('../lib/files');

test('normalizeUploadFilename keeps Chinese names and strips unsafe path chars', () => {
  assert.equal(normalizeUploadFilename('滴滴电子发票_5134.pdf'), '滴滴电子发票_5134.pdf');
  assert.equal(normalizeUploadFilename('../a:b\u0000.pdf'), '.._a_b_.pdf');
  assert.equal(normalizeUploadFilename(''), '附件');
});

test('file helpers infer message and file types without depending on routes', () => {
  assert.equal(fileMessageType({ mimetype: 'image/png' }), 'image');
  assert.equal(fileMessageType({ mimetype: 'application/pdf' }), 'file');
  assert.equal(fileTypeFromName('方案.PDF'), 'pdf');
  assert.equal(fileTypeFromName('', 'file'), 'file');
});

test('upload allowlist accepts configured extensions, mime prefixes and exact mime types', () => {
  const uploadFileAllowed = createUploadFileAllowed({
    allowedExtensions: new Set(['.pdf']),
    allowedMimePrefixes: ['image/'],
    allowedMimeTypes: new Set(['application/vnd.ms-powerpoint']),
  });

  assert.equal(uploadFileAllowed({ originalname: '报价.pdf', mimetype: 'application/octet-stream' }), true);
  assert.equal(uploadFileAllowed({ originalname: '图片.bin', mimetype: 'image/png' }), true);
  assert.equal(uploadFileAllowed({ originalname: 'slides.unknown', mimetype: 'application/vnd.ms-powerpoint' }), true);
  assert.equal(uploadFileAllowed({ originalname: 'script.js', mimetype: 'application/javascript' }), false);
});

test('attachmentFromUploadedFile preserves download URL and normalized title', () => {
  const req = { headers: { host: 'crm.chinanhd.com', 'x-forwarded-proto': 'https' } };
  const attachment = attachmentFromUploadedFile(req, {
    originalname: '合同.pdf',
    filename: 'stored.pdf',
    mimetype: 'application/pdf',
    size: 1234,
  }, '请看附件');

  assert.deepEqual(attachment, {
    title: '合同.pdf',
    fileType: 'pdf',
    contentType: 'application/pdf',
    sizeBytes: 1234,
    url: 'https://crm.chinanhd.com/conv-api/uploads/conversation-files/stored.pdf',
    caption: '请看附件',
  });
});

test('normalizeOutboundAttachments filters invalid attachments and caps length', () => {
  const attachments = normalizeOutboundAttachments([
    null,
    { title: 'a.pdf', url: 'https://example.com/a.pdf', size: '12' },
    { title: 'missing-url.pdf' },
    ...Array.from({ length: 12 }, (_, index) => ({ title: `${index}.png`, url: `https://example.com/${index}.png` })),
  ]);

  assert.equal(attachments.length, 10);
  assert.deepEqual(attachments[0], {
    attachmentId: undefined,
    title: 'a.pdf',
    fileType: 'pdf',
    contentType: undefined,
    sizeBytes: 12,
    url: 'https://example.com/a.pdf',
  });
});

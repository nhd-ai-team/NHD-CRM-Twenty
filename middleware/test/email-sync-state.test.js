const assert = require('node:assert/strict');
const test = require('node:test');

const { classifySyncMailbox } = require('../lib/email-sync');

test('email sync only accepts inbox, sent, and junk mailboxes', () => {
  assert.equal(classifySyncMailbox('INBOX'), 'inbox');
  assert.equal(classifySyncMailbox('收件箱'), 'inbox');
  assert.equal(classifySyncMailbox('已发送'), 'outbound');
  assert.equal(classifySyncMailbox('Sent'), 'outbound');
  assert.equal(classifySyncMailbox('垃圾邮件'), 'junk');
  assert.equal(classifySyncMailbox('Spam'), 'junk');
  assert.equal(classifySyncMailbox('01_中东'), null);
  assert.equal(classifySyncMailbox('客户文件夹'), null);
});

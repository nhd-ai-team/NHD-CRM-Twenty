function classifySyncMailbox(mailbox) {
  const value = String(mailbox || '').trim();
  if (/^(inbox|收件箱)$/i.test(value)) return 'inbox';
  if (/sent|已发送/i.test(value)) return 'outbound';
  if (/junk|垃圾|spam|广告/i.test(value)) return 'junk';
  return null;
}

module.exports = { classifySyncMailbox };

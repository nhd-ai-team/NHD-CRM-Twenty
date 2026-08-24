const fs = require('fs');
const path = require('path');

function publicFileUrl(req, storedName) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const isLocalDirect = host.startsWith('localhost:3002') || host.startsWith('127.0.0.1:3002');
  const proto = req.headers['x-forwarded-proto'] || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  const prefix = isLocalDirect ? '/api' : '/conv-api';
  const relative = `${prefix}/uploads/conversation-files/${encodeURIComponent(storedName)}`;
  return host ? `${proto}://${host}${relative}` : relative;
}

function fileMessageType(file = {}) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

function extensionFromName(name = '') {
  return path.extname(String(name || '').trim()).toLowerCase();
}

function fileTypeFromName(name = '', fallback = 'file') {
  const ext = extensionFromName(name).replace('.', '');
  return ext || fallback;
}

function normalizeUploadFilename(name = '') {
  const raw = String(name || '').trim();
  if (!raw) return '附件';
  const mojibakePattern = /[ÃÂâäåæçèéðÐÑ¤¥¦§¨©ª«¬®¯°±²³µ¶·¸¹º¼½¾¿]/;
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  const candidate = mojibakePattern.test(raw) && decoded && !decoded.includes('�') ? decoded : raw;
  return candidate
    .normalize('NFC')
    .replace(/[\\/:\0-\x1F\x7F]/g, '_')
    .trim()
    .slice(0, 180) || '附件';
}

function fileTitle(file = {}) {
  return file.displayName || normalizeUploadFilename(file.originalname || '附件');
}

function createUploadFileAllowed({
  allowedExtensions = new Set(),
  allowedMimePrefixes = [],
  allowedMimeTypes = new Set(),
} = {}) {
  return function uploadFileAllowed(file = {}) {
    const title = fileTitle(file);
    const ext = extensionFromName(title);
    const mime = String(file.mimetype || '').toLowerCase();
    if (allowedExtensions.has(ext)) return true;
    if (allowedMimePrefixes.some(prefix => mime.startsWith(prefix))) return true;
    return allowedMimeTypes.has(mime);
  };
}

function deleteUploadedFileBestEffort(file = {}) {
  if (!file.path) return;
  fs.unlink(file.path, () => {});
}

function attachmentFromUploadedFile(req, file, content = '') {
  const title = fileTitle(file);
  const messageType = fileMessageType(file);
  return {
    title,
    fileType: fileTypeFromName(title, messageType),
    contentType: file.mimetype || 'application/octet-stream',
    sizeBytes: file.size || 0,
    url: publicFileUrl(req, file.filename),
    caption: content || '',
  };
}

function normalizeOutboundAttachment(attachment = {}) {
  if (!attachment || typeof attachment !== 'object') return null;
  const url = String(attachment.url || attachment.href || '').trim();
  if (!url) return null;
  const title = normalizeUploadFilename(attachment.title || attachment.fileName || attachment.filename || '附件');
  const fileType = String(attachment.fileType || fileTypeFromName(title, 'file')).replace(/^\./, '').toLowerCase() || 'file';
  return {
    attachmentId: attachment.attachmentId || attachment.id || undefined,
    title,
    fileType,
    contentType: attachment.contentType || attachment.mimeType || attachment.mimetype || undefined,
    sizeBytes: Number(attachment.sizeBytes || attachment.size || 0) || undefined,
    url,
  };
}

function normalizeOutboundAttachments(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeOutboundAttachment)
    .filter(Boolean)
    .slice(0, 10);
}

module.exports = {
  attachmentFromUploadedFile,
  createUploadFileAllowed,
  deleteUploadedFileBestEffort,
  extensionFromName,
  fileMessageType,
  fileTitle,
  fileTypeFromName,
  normalizeOutboundAttachment,
  normalizeOutboundAttachments,
  normalizeUploadFilename,
  publicFileUrl,
};

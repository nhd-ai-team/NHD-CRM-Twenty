import { useState, useRef, useEffect } from 'react'
import { format } from 'date-fns'
import {
  UserCheck, Bot,
  Send, Paperclip,
  Menu, X, FileText,
} from 'lucide-react'
import { ChannelIcon } from './ChannelIcon'

function formatFileSize(size) {
  const n = Number(size || 0)
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const ACCEPTED_ATTACHMENT_TYPES = [
  '.pdf',
  '.ppt', '.pptx',
  '.doc', '.docx',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif',
].join(',')
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  'pdf', 'ppt', 'pptx', 'doc', 'docx',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif',
])

function fileExtension(name = '') {
  return String(name).split('.').pop()?.toLowerCase() || ''
}

function validateAttachment(file) {
  if (!file) return ''
  if (file.size > MAX_ATTACHMENT_BYTES) return '附件不能超过 25MB'
  const ext = fileExtension(file.name)
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(ext) && !String(file.type || '').startsWith('image/')) {
    return '当前仅支持 PDF、PPT、Word 和图片附件'
  }
  return ''
}

function StatusBadge({ status }) {
  const map = {
    open:     { label: '进行中',   bg: 'var(--green-soft)',   color: 'var(--green)' },
    takeover: { label: '人工接管', bg: 'var(--orange-soft)',  color: 'var(--orange)' },
    closed:   { label: '已关闭',   bg: 'var(--bg-active)',    color: 'var(--text-muted)' },
  }
  const s = map[status] || map.open
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
      background: s.bg, color: s.color,
    }}>{s.label}</span>
  )
}

function AttachmentCard({ attachment, isCustomer, content }) {
  const mediaUrl = attachment?.url || ''
  const fileName = attachment?.title || content || '附件'
  const contentType = String(attachment?.contentType || '').toLowerCase()
  const fileType = String(attachment?.fileType || fileExtension(fileName) || 'file').toLowerCase()
  const fileMeta = [fileType, formatFileSize(attachment?.sizeBytes)].filter(Boolean).join(' · ')
  const isImage = contentType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif'].includes(fileType)
  const isVideo = contentType.startsWith('video/')

  if (isImage && mediaUrl) {
    return (
      <a href={mediaUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none', display: 'block', marginTop: 6 }}>
        <img src={mediaUrl} alt={fileName} style={{ display: 'block', maxWidth: 240, maxHeight: 180, borderRadius: 6, objectFit: 'cover' }} />
      </a>
    )
  }
  if (isVideo && mediaUrl) {
    return <video src={mediaUrl} controls style={{ display: 'block', maxWidth: 260, maxHeight: 190, borderRadius: 6, marginTop: 6 }} />
  }
  return (
    <a href={mediaUrl || undefined} target="_blank" rel="noreferrer" download style={{
      display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 8,
      alignItems: 'center', color: 'inherit', textDecoration: 'none', minWidth: 180,
      marginTop: 6, pointerEvents: mediaUrl ? 'auto' : 'none', opacity: mediaUrl ? 1 : .72,
    }}>
      <span style={{
        width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center',
        background: isCustomer ? 'var(--bg-active)' : 'rgba(255,255,255,.18)',
      }}><FileText size={15} /></span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{fileName}</span>
        {fileMeta && <span style={{ display: 'block', marginTop: 2, fontSize: 11, opacity: .75 }}>{fileMeta}</span>}
      </span>
    </a>
  )
}

function MessageBubble({ msg }) {
  if (msg.contentType === 'system') return (
    <div style={{ textAlign: 'center', padding: '6px 0' }}>
      <span style={{
        fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-active)',
        padding: '3px 12px', borderRadius: 10,
      }}>{msg.content}</span>
    </div>
  )

  const isCustomer = msg.senderType === 'customer'
  const isAI = msg.senderType === 'ai'
  const timeStr = format(msg.sentAt, 'HH:mm')
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : []
  const mediaAttachments = attachments.length
    ? attachments
    : msg.mediaUrl
      ? [{ title: msg.content || '附件', fileType: msg.contentType || 'file', url: msg.mediaUrl }]
      : []
  const textContent = mediaAttachments.length === 1 && msg.content === mediaAttachments[0]?.title ? '' : msg.content

  return (
    <div style={{
      display: 'flex', flexDirection: isCustomer ? 'row' : 'row-reverse',
      gap: 8, marginBottom: 12, alignItems: 'flex-end',
    }}>
      <div style={{
        maxWidth: '68%',
        display: 'flex', flexDirection: 'column',
        alignItems: isCustomer ? 'flex-start' : 'flex-end',
      }}>
        {isAI && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>AI 自动回复</span>
        )}
        <div style={{
          padding: '8px 12px', borderRadius: isCustomer ? '2px 12px 12px 12px' : '12px 2px 12px 12px',
          background: isCustomer
            ? 'var(--bg-surface)'
            : isAI ? 'var(--accent-soft)' : 'var(--accent)',
          color: isCustomer
            ? 'var(--text-primary)'
            : isAI ? 'var(--accent-text)' : '#fff',
          border: isCustomer ? '1px solid var(--border)' : 'none',
          fontSize: 13, lineHeight: 1.55,
          boxShadow: 'var(--shadow-sm)',
        }}>
          {textContent && <div>{textContent}</div>}
          {mediaAttachments.map((attachment, index) => (
            <AttachmentCard key={`${attachment.url || attachment.title || index}-${index}`} attachment={attachment} isCustomer={isCustomer} content={textContent} />
          ))}
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{timeStr}</span>
      </div>
    </div>
  )
}

function ActionBar({ conv, onRequestAction }) {
  const isTakeover = conv.status === 'takeover'
  const isClosed = conv.status === 'closed'
  const aiControl = conv.aiControl || {}
  const permissions = conv.permissions || {}
  const aiReady = !!aiControl.enabled && !!aiControl.inTakeoverWindow
  const canTakeover = !isClosed && !isTakeover && aiReady && permissions.canTakeover !== false
  const canAiHost = !isClosed && isTakeover && aiReady && permissions.canReply !== false
  const disabledReason = permissions.viewerRole === 'boss'
    ? 'Boss 当前仅有查看权限'
    : !aiControl.enabled
    ? 'AI客服未激活，暂不可人工接管'
    : !aiControl.inTakeoverWindow
      ? '当前不在AI客服托管时间内'
      : ''

  // 无可用操作（如已关闭会话）时不渲染，避免底部残留空白栏
  if (!canTakeover && !canAiHost && isClosed) return null

  return (
    <div style={{
      display: 'flex', gap: 8, padding: '6px 16px',
      borderTop: '1px solid var(--border-soft)', flexWrap: 'wrap', alignItems: 'center',
      flexShrink: 0,
    }}>
      {/* Takeover */}
      {!isClosed && !isTakeover && (
        <button
          onClick={() => canTakeover && onRequestAction('takeover')}
          disabled={!canTakeover}
          title={canTakeover ? '人工接管后可回复客户' : disabledReason}
          style={btnStyle('accent', !canTakeover)}
        >
          <UserCheck size={13} /> 接管会话
        </button>
      )}
      {!isClosed && isTakeover && (
        <button
          onClick={() => canAiHost && onRequestAction('release')}
          disabled={!canAiHost}
          title={canAiHost ? '切换后由AI继续托管' : disabledReason}
          style={btnStyle('orange', !canAiHost)}
        >
          <Bot size={13} /> AI托管
        </button>
      )}
    </div>
  )
}

function btnStyle(variant, disabled = false) {
  const base = {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
    border: '1px solid var(--border)', cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
    transition: 'all .1s',
  }
  if (disabled) return { ...base, background: 'var(--bg-active)', color: 'var(--text-muted)', borderColor: 'var(--border-soft)', opacity: .72 }
  if (variant === 'accent')  return { ...base, background: 'var(--accent-soft)', color: 'var(--accent-text)', borderColor: 'var(--accent-soft)' }
  if (variant === 'orange')  return { ...base, background: 'var(--orange-soft)', color: 'var(--orange)', borderColor: 'var(--orange-soft)' }
  if (variant === 'green')   return { ...base, background: 'var(--green-soft)',  color: 'var(--green)',  borderColor: 'var(--green-soft)' }
  return { ...base, background: 'transparent', color: 'var(--text-secondary)' }
}

export function ChatPanel({ conv, onSend, onTakeover, layout, onToggleSidebar }) {
  const [input, setInput] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [switching, setSwitching] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conv?.messages])

  if (!conv) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 12 }}>
      {layout === 'narrow'
        ? <button onClick={onToggleSidebar} style={{ ...btnStyle('accent'), fontSize: 13, padding: '8px 18px' }}><Menu size={15} /> 选择会话</button>
        : <span>从左侧选择一个会话</span>
      }
    </div>
  )

  async function handleSend() {
    if (sending) return
    const text = input.trim()
    if (!text && !selectedFile) return
    if (conv.status !== 'takeover') {
      setSendError('请先人工接管会话后再发送消息')
      return
    }
    if (conv.permissions?.canReply === false) {
      setSendError('该会话未由当前账号接管，不能发送消息')
      return
    }
    setSendError('')
    setSending(true)
    try {
      await onSend(conv.id, text, selectedFile)
      setInput('')
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (error) {
      setSendError(error.message)
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  async function confirmStatusSwitch() {
    if (!pendingAction) return
    setSwitching(true)
    try {
      await onTakeover(pendingAction)
      setPendingAction(null)
      setSendError('')
    } catch (error) {
      setSendError(error.message)
    } finally {
      setSwitching(false)
    }
  }

  const supportsAttachments = ['website', 'whatsapp'].includes(conv.channel)
  function handleAttachmentClick() {
    if (!supportsAttachments) {
      setSendError('当前渠道暂不支持发送附件')
      return
    }
    if (conv.status !== 'takeover') {
      setSendError('请先点击「接管会话」后再发送附件')
      return
    }
    if (conv.permissions?.canReply === false) {
      setSendError('该会话未由当前账号接管，不能发送附件')
      return
    }
    fileInputRef.current?.click()
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0] || null
    const error = validateAttachment(file)
    if (error) {
      setSelectedFile(null)
      setSendError(error)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setSendError('')
    setSelectedFile(file)
  }

  const canSend = (!!input.trim() || !!selectedFile) && conv.status === 'takeover' && conv.permissions?.canReply !== false && !sending
  const confirmTitle = pendingAction === 'takeover' ? '确认人工接管？' : '确认 AI 托管？'
  const confirmBody = pendingAction === 'takeover'
    ? '确认后销售可以在工作台回复客户，AI客服将暂停托管此会话。'
    : '确认后此会话将重新交给AI客服托管，销售需要再次人工接管后才能回复。'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-primary)', flexShrink: 0,
      }}>
        <ChannelIcon channel={conv.channel} size={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              {conv.contact.name}
            </span>
            {conv.contact.phone && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{conv.contact.phone}</span>
            )}
            <StatusBadge status={conv.status} />
          </div>
          {conv.contact.company && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{conv.contact.company}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          {/* 窄屏汉堡：唤出会话列表 */}
          {layout === 'narrow' && (
            <button onClick={onToggleSidebar} style={{ padding: '4px 6px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', borderRadius: 4 }}>
              <Menu size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column' }}>
        {conv.messages.map((msg, i) => (
          <MessageBubble key={msg.id ?? i} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-primary)', flexShrink: 0 }}>
        {selectedFile && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, margin: '10px 12px 0',
            padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6,
            background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 12,
          }}>
            <FileText size={14} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedFile.name}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{formatFileSize(selectedFile.size)}</span>
            <button
              onClick={() => {
                setSelectedFile(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              title="移除附件"
              style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={conv.status === 'takeover' ? '请输入即将发送的内容……' : '请先点击「接管会话」后再回复客户'}
          style={{
            width: '100%', minHeight: 80, maxHeight: 160, padding: '12px 16px',
            border: 'none', outline: 'none', resize: 'none',
            background: 'transparent', color: 'var(--text-primary)',
            fontSize: 13, lineHeight: 1.55,
            fontFamily: 'inherit',
          }}
        />
        {/* Toolbar row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '6px 12px 10px', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', gap: 2 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_ATTACHMENT_TYPES}
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              title={!supportsAttachments ? '当前渠道暂不支持发送附件' : conv.status === 'takeover' ? '附件上传' : '请先接管会话'}
              onClick={handleAttachmentClick}
              disabled={sending}
              style={{
                padding: 6, border: 'none', background: 'transparent',
                cursor: sending ? 'not-allowed' : 'pointer',
                color: 'var(--text-muted)', borderRadius: 4,
                display: 'flex', alignItems: 'center', opacity: supportsAttachments && conv.status === 'takeover' ? 1 : .65,
              }}
            >
              <Paperclip size={15} />
            </button>
          </div>
          {sendError && (
            <div style={{ flex: 1, minWidth: 0, color: '#e1262b', fontSize: 12, padding: '0 8px' }}>
              {sendError}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Send */}
            <button
              onClick={handleSend}
              disabled={!canSend}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 16px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                border: 'none', cursor: canSend ? 'pointer' : 'not-allowed',
                background: canSend ? 'var(--accent)' : 'var(--bg-active)',
                color: canSend ? '#fff' : 'var(--text-muted)',
                transition: 'all .15s',
              }}
            >
              <Send size={13} /> {sending ? '发送中' : '发送'}
            </button>
          </div>
        </div>
      </div>

      {/* Action bar */}
      <ActionBar conv={conv} onRequestAction={setPendingAction} />

      {pendingAction && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 180, background: 'rgba(0,0,0,.42)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
        }}>
          <div style={{
            width: 'min(400px, 100%)', borderRadius: 8, background: 'var(--bg-primary)',
            border: '1px solid var(--border)', boxShadow: '0 18px 50px rgba(0,0,0,.28)',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 18px 10px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{confirmTitle}</div>
              <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                {confirmBody}
              </div>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px 16px',
              borderTop: '1px solid var(--border-soft)',
            }}>
              <button
                onClick={() => setPendingAction(null)}
                disabled={switching}
                style={{
                  padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)', cursor: switching ? 'default' : 'pointer',
                  fontSize: 12, fontWeight: 600,
                }}
              >
                取消
              </button>
              <button
                onClick={confirmStatusSwitch}
                disabled={switching}
                style={{
                  padding: '7px 14px', borderRadius: 6, border: 'none',
                  background: pendingAction === 'takeover' ? 'var(--accent)' : 'var(--orange)',
                  color: '#fff', cursor: switching ? 'default' : 'pointer',
                  opacity: switching ? 0.7 : 1, fontSize: 12, fontWeight: 700,
                }}
              >
                {switching ? '处理中…' : pendingAction === 'takeover' ? '确认接管' : '确认托管'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

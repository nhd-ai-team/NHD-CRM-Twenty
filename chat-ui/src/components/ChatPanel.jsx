import { useState, useRef, useEffect } from 'react'
import { format } from 'date-fns'
import {
  UserCheck, Bot,
  Send, Paperclip,
  Menu, X, FileText, History,
} from 'lucide-react'
import { ChannelIcon } from './ChannelIcon'
import { InlineNameEditor } from './InlineNameEditor'
import { fmtTimezone } from '../utils/timezone'

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

function StatusBadge({ status, aiControl }) {
  const map = {
    open:     { label: aiControl?.enabled ? 'AI 接管' : '进行中', bg: aiControl?.enabled ? 'var(--accent-soft)' : 'var(--green-soft)', color: aiControl?.enabled ? 'var(--accent)' : 'var(--green)' },
    takeover: { label: '人工接待', bg: 'var(--orange-soft)',  color: 'var(--orange)' },
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

// 需求二：出站消息送达状态。
// WhatsApp 有真实回执（message.ack → sent/delivered/read/failed）；
// 官网渠道以「访客回复下一条消息 = 已读」近似（后端把之前 agent/ai 出站消息标记 read），
// 因此 website 渠道仅展示 sent（已发送）/ read（已读）两档，不展示虚假的 delivered。
const DELIVERY_STATUS_LABEL = {
  pending: { text: '发送中', icon: '○', color: 'var(--text-muted)' },
  sent: { text: '已发送', icon: '✓', color: 'var(--text-muted)' },
  delivered: { text: '已送达', icon: '✓✓', color: 'var(--text-muted)' },
  read: { text: '已读', icon: '✓✓', color: 'var(--accent)' },
  failed: { text: '发送失败', icon: '!', color: 'var(--red)' },
}

function DeliveryStatus({ msg, channel }) {
  if (channel !== 'whatsapp' && channel !== 'website') return null
  if (msg.senderType !== 'agent' && msg.senderType !== 'ai') return null
  const status = DELIVERY_STATUS_LABEL[msg.deliveryStatus]
  if (!status) return null
  const tooltip = [
    msg.deliveryStatus === 'failed' ? msg.statusDetail : '',
    msg.readAt ? `已读 ${format(new Date(msg.readAt), 'MM-dd HH:mm')}` : '',
    msg.deliveredAt ? `送达 ${format(new Date(msg.deliveredAt), 'MM-dd HH:mm')}` : '',
  ].filter(Boolean).join(' · ')
  return (
    <span title={tooltip || status.text} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: status.color }}>
      <span style={{ fontSize: 10, letterSpacing: '-0.06em' }}>{status.icon}</span>
      <span>{status.text}</span>
    </span>
  )
}

export function MessageBubble({ msg, channel }) {
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
  const timeStr = format(msg.sentAt, 'MM-dd HH:mm')
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
        {/* 每条人工消息都标出是谁回复的（此前只有主管的消息显示名字，销售之间互相看不出谁回的）。
            senderName 由后端统一给出，取不到成员名时兜底为「未识别成员」。 */}
        {!isCustomer && !isAI && msg.senderName && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{msg.senderName}</span>
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
        <span style={{
          fontSize: 10, color: 'var(--text-muted)', marginTop: 3,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          {timeStr}
          <DeliveryStatus msg={msg} channel={channel} />
        </span>
      </div>
    </div>
  )
}

function ActionBar({ conv, onRequestAction }) {
  const isTakeover = conv.status === 'takeover'
  const isClosed = conv.status === 'closed'
  const aiControl = conv.aiControl || {}
  const permissions = conv.permissions || {}
  // AI 客服开启时才存在"接入人工/交还AI"概念；销售之间的会话转交使用独立动作。
  // 接入人工/交还 AI 不受排班时段限制（排班只决定 AI 是否自动回复）。
  const aiMode = !!aiControl.enabled
  const canTakeover = !isClosed && !isTakeover && aiMode && permissions.canTakeover !== false
  const canAiHost = !isClosed && isTakeover && aiMode && permissions.canReply !== false
  const canTransferSales = !isClosed && isTakeover && permissions.canTransferSales === true
  const canReturnSales = !isClosed && isTakeover && permissions.canReturnSales === true
  const disabledReason = permissions.viewerRole === 'boss'
    ? 'Boss 当前仅有查看权限'
    : !aiControl.enabled
      ? 'AI 客服未激活，暂不可接入人工'
      : ''

  // AI 关闭时只隐藏 AI 动作；销售之间的会话转交不依赖 AI 开关。
  if (!aiMode && !canTransferSales && !canReturnSales) return null
  if (!canTakeover && !canAiHost && !canTransferSales && !canReturnSales && isClosed) return null

  return (
    <div style={{
      display: 'flex', gap: 8, padding: '6px 16px',
      borderTop: '1px solid var(--border-soft)', flexWrap: 'wrap', alignItems: 'center',
      flexShrink: 0,
    }}>
      {/* AI -> 人工：这里不使用「接管销售会话」，避免与销售之间的转交混淆。 */}
      {aiMode && !isClosed && !isTakeover && (
        <button
          onClick={() => canTakeover && onRequestAction('takeover')}
          disabled={!canTakeover}
          title={canTakeover ? '接入人工后可回复客户' : disabledReason}
          style={btnStyle('accent', !canTakeover)}
        >
          <UserCheck size={13} /> 接入人工
        </button>
      )}
      {aiMode && !isClosed && isTakeover && (
        <button
          onClick={() => canAiHost && onRequestAction('release')}
          disabled={!canAiHost}
          title={canAiHost ? '切换后由AI继续托管' : disabledReason}
          style={btnStyle('orange', !canAiHost)}
        >
          <Bot size={13} /> AI托管
        </button>
      )}
      {canTransferSales && (
        <button
          type="button"
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRequestAction('transfer') }}
          title="通知当前销售后，10秒后完成会话转交"
          style={btnStyle('accent')}
        >
          <UserCheck size={13} /> 接管销售会话
        </button>
      )}
      {canReturnSales && (
        <button
          type="button"
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRequestAction('return') }}
          title="将会话发送权限交还给原销售"
          style={btnStyle('green')}
        >
          <UserCheck size={13} /> 交还会话
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

export function ChatPanel({ conv, onSend, onTakeover, onRename, onMarkHandoffNoticeSeen, layout, onToggleSidebar, presence }) {
  const [input, setInput] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [presencePromptOpen, setPresencePromptOpen] = useState(false)
  const [presenceSwitching, setPresenceSwitching] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [handoffPromptId, setHandoffPromptId] = useState(null)
  const [dismissedHandoffId, setDismissedHandoffId] = useState(null)
  const [returnNoticeId, setReturnNoticeId] = useState(null)
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)
  const composingRef = useRef(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conv?.messages])

  useEffect(() => {
    const requestId = conv?.permissions?.canRespondHandoff && conv?.handoff?.id !== dismissedHandoffId
      ? conv?.handoff?.id
      : null
    setHandoffPromptId(requestId || null)
  }, [conv?.id, conv?.permissions?.canRespondHandoff, conv?.handoff?.id, dismissedHandoffId])

  useEffect(() => {
    setReturnNoticeId(conv?.returnNotice?.id || null)
  }, [conv?.id, conv?.returnNotice?.id])

  const aiMode = !!(conv?.aiControl || {}).enabled

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
    if (aiMode && conv.status !== 'takeover') {
      setSendError('请先接入人工后再发送消息')
      return
    }
    if (conv.permissions?.canReply === false) {
      setSendError('该会话未由当前账号接管，不能发送消息')
      return
    }
    if (conv.channel === 'website' && presence?.status !== 'online') {
      setSendError('请先切换为「在岗」，再回复官网客户')
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
    // 中文等输入法组合输入期间，Enter 是"上屏确认候选词"而非发送。
    // React 合成事件不透传 isComposing，须读 nativeEvent；229 是旧浏览器的兼容标记；
    // composing ref 兜底 compositionend 与 keydown 的时序差。
    if (composingRef.current || e.nativeEvent?.isComposing || e.keyCode === 229) return
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

  async function confirmOnlineAndTakeover() {
    if (!presence?.setPresenceStatus || presenceSwitching) return
    setPresenceSwitching(true)
    try {
      const changed = await presence.setPresenceStatus('online')
      if (!changed) return
      setPresencePromptOpen(false)
      await onTakeover('takeover')
      setSendError('')
    } catch (error) {
      setSendError(error.message)
    } finally {
      setPresenceSwitching(false)
    }
  }

  function requestAction(action) {
    if (action === 'takeover' && conv.channel === 'website' && presence?.status !== 'online') {
      setPresencePromptOpen(true)
      return
    }
    setPendingAction(action)
  }

  const supportsAttachments = ['website', 'whatsapp'].includes(conv.channel)
  function handleAttachmentClick() {
    if (!supportsAttachments) {
      setSendError('当前渠道暂不支持发送附件')
      return
    }
    if (aiMode && conv.status !== 'takeover') {
      setSendError('请先点击「接入人工」后再发送附件')
      return
    }
    if (conv.permissions?.canReply === false) {
      setSendError('该会话未由当前账号接管，不能发送附件')
      return
    }
    if (conv.channel === 'website' && presence?.status !== 'online') {
      setSendError('请先切换为「在岗」，再发送附件')
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

  const canSend = aiMode
    ? ((!!input.trim() || !!selectedFile) && conv.status === 'takeover' && conv.permissions?.canReply !== false && (conv.channel !== 'website' || presence?.status === 'online') && !sending)
    : ((!!input.trim() || !!selectedFile) && conv.status !== 'closed' && conv.permissions?.canReply !== false && (conv.channel !== 'website' || presence?.status === 'online') && !sending)
  const confirmTitle = pendingAction === 'takeover'
    ? '确认接入人工？'
    : pendingAction === 'transfer'
      ? '确认接管销售会话？'
      : pendingAction === 'return'
        ? '确认交还销售？'
      : '确认 AI 托管？'
  const confirmBody = pendingAction === 'takeover'
    ? '确认后销售可以在工作台回复客户，AI 客服将暂停处理此会话。'
    : pendingAction === 'transfer'
      ? '当前销售会收到接管提示，10 秒后本会话将转交给您。转交完成后，原销售将不能继续发送消息。'
      : pendingAction === 'return'
        ? `确认后会话发送权限将交还给 ${conv.permissions?.returnAgentName || '原销售'}，主管仍可查看完整沟通记录。`
      : '确认后此会话将重新交给 AI 客服托管，销售需要再次接入人工后才能回复。'
  // 需求三：会话详情（客户资料上下文）展示推断地域（国家/地区/城市/时区——时区为用户明确要求保留字段，转 UTC±H 友好显示）；官网渠道带真实 IP，WhatsApp/邮件不显示伪造 IP
  const contactInfo = conv.contact || {}
  const geoParts = [contactInfo.country, contactInfo.region, contactInfo.city, fmtTimezone(contactInfo.timezone)].filter(Boolean)
  const utmParts = [
    contactInfo.utmSource ? `source=${contactInfo.utmSource}` : '',
    contactInfo.utmMedium ? `medium=${contactInfo.utmMedium}` : '',
    contactInfo.utmCampaign ? `campaign=${contactInfo.utmCampaign}` : '',
    contactInfo.utmTerm ? `term=${contactInfo.utmTerm}` : '',
    contactInfo.utmContent ? `content=${contactInfo.utmContent}` : '',
  ].filter(Boolean)

  function openHistory() {
    if (!conv?.id) return
    if (typeof window.parent?.openHistoryPanel === 'function') {
      window.parent.openHistoryPanel(conv.id)
      return
    }
    window.parent?.postMessage({ type: 'nhd-open-history', conversationId: conv.id }, window.location.origin)
  }

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
            {/* 需求一：顶部名称内联编辑；maxWidth 固定，编辑态不挤压手机号/状态徽标 */}
            <InlineNameEditor
              name={conv.contact?.name || ''}
              nameSource={conv.contact?.nameSource}
              channelName={conv.contact?.channelName}
              onSave={onRename ? (value => onRename(conv.id, value)) : undefined}
              canEdit={Boolean(onRename) && conv.permissions?.viewerRole !== 'boss'}
              fontSize={14}
              fontWeight={700}
              maxWidth={240}
            />
            {conv.contact.phone && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{conv.contact.phone}</span>
            )}
            <StatusBadge status={conv.status} aiControl={conv.aiControl} />
            {conv.status === 'takeover' && conv.permissions?.isSupervisor && conv.currentAgentName && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>由 {conv.currentAgentName} 接管</span>
            )}
          </div>
            {conv.contact.company && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{conv.contact.company}</div>
            )}
            {geoParts.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                📍 {geoParts.join(' · ')}{contactInfo.ip ? ` · IP ${contactInfo.ip}` : ''}
                {contactInfo.geoSource ? ` · 来源 ${contactInfo.geoSource}` : ''}
              </div>
            )}
            {(utmParts.length > 0 || contactInfo.pageUrl || contactInfo.referrer) && (
              <div
                title={[
                  utmParts.length ? `UTM ${utmParts.join(' · ')}` : '',
                  contactInfo.pageUrl ? `访问页 ${contactInfo.pageUrl}` : '',
                  contactInfo.referrer ? `来源页 ${contactInfo.referrer}` : '',
                ].filter(Boolean).join('\n')}
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 720,
                }}
              >
                🔗 {[utmParts.length ? `UTM ${utmParts.join(' · ')}` : '', contactInfo.pageUrl ? `访问页 ${contactInfo.pageUrl}` : '', contactInfo.referrer ? `来源页 ${contactInfo.referrer}` : ''].filter(Boolean).join(' · ')}
              </div>
            )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          <button
            onClick={openHistory}
            title="查看历史记录"
            aria-label="查看历史记录"
            style={{
              width: 30, height: 30, padding: 0, border: '1px solid var(--border)',
              borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-secondary)',
              display: 'grid', placeItems: 'center', cursor: 'pointer',
            }}
          >
            <History size={16} />
          </button>
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
          <MessageBubble key={msg.id ?? i} msg={msg} channel={conv.channel} />
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
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          placeholder={(aiMode && conv.status !== 'takeover') ? '请先点击「接入人工」后再回复客户' : (conv.channel === 'website' && presence?.status !== 'online') ? '请先切换为「在岗」后回复客户' : '请输入即将发送的内容……'}
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
            title={!supportsAttachments ? '当前渠道暂不支持发送附件' : (aiMode && conv.status !== 'takeover') ? '请先接入人工后再上传附件' : '附件上传'}
              onClick={handleAttachmentClick}
              disabled={sending}
              style={{
                padding: 6, border: 'none', background: 'transparent',
                cursor: sending ? 'not-allowed' : 'pointer',
                color: 'var(--text-muted)', borderRadius: 4,
                display: 'flex', alignItems: 'center', opacity: supportsAttachments && (conv.status === 'takeover' || !aiMode) ? 1 : .65,
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
      <ActionBar conv={conv} onRequestAction={requestAction} />

      {presencePromptOpen && (
        <div
          role="presentation"
          onClick={() => !presenceSwitching && setPresencePromptOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 290, background: 'rgba(0,0,0,.42)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="offline-takeover-title"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(390px, 100%)', borderRadius: 8, background: 'var(--bg-primary)',
              border: '1px solid var(--border)', boxShadow: '0 18px 50px rgba(0,0,0,.28)', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 18px 10px' }}>
              <div id="offline-takeover-title" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                当前处于离线状态
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                切换为人工接管前，需要先打开上线状态。保持离线时，会话将继续由 AI 接管。
              </div>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px 16px',
              borderTop: '1px solid var(--border-soft)',
            }}>
              <button
                type="button"
                onClick={() => setPresencePromptOpen(false)}
                disabled={presenceSwitching}
                style={{
                  height: 32, padding: '0 14px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)', cursor: presenceSwitching ? 'default' : 'pointer',
                  fontSize: 12, fontWeight: 600,
                }}
              >保持 AI 接管</button>
              <button
                type="button"
                onClick={confirmOnlineAndTakeover}
                disabled={presenceSwitching}
                style={{
                  height: 32, padding: '0 14px', borderRadius: 6, border: 'none', background: '#16a34a',
                  color: '#fff', cursor: presenceSwitching ? 'default' : 'pointer', opacity: presenceSwitching ? .7 : 1,
                  fontSize: 12, fontWeight: 700,
                }}
              >{presenceSwitching ? '处理中…' : '切换在线并接入人工'}</button>
            </div>
          </div>
        </div>
      )}

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
                  background: pendingAction === 'takeover' || pendingAction === 'transfer' ? 'var(--accent)' : pendingAction === 'return' ? 'var(--green)' : 'var(--orange)',
                  color: '#fff', cursor: switching ? 'default' : 'pointer',
                  opacity: switching ? 0.7 : 1, fontSize: 12, fontWeight: 700,
                }}
              >
                {switching ? '处理中…' : pendingAction === 'takeover' ? '确认接入人工' : pendingAction === 'transfer' ? '确认接管' : pendingAction === 'return' ? '确认交还' : '确认托管'}
              </button>
            </div>
          </div>
        </div>
      )}

      {handoffPromptId && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(0,0,0,.42)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
          }}
        >
          <div style={{
            width: 'min(400px, 100%)', borderRadius: 8, background: 'var(--bg-primary)',
            border: '1px solid var(--border)', boxShadow: '0 18px 50px rgba(0,0,0,.28)', overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 18px 10px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>销售主管请求接管会话</div>
              <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                {conv.handoff?.requestedByName || '销售主管'} 请求接管当前官网客服会话。请知悉：10 秒后会话将自动转交给主管。
              </div>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px 16px',
              borderTop: '1px solid var(--border-soft)',
            }}>
              <button
                onClick={() => {
                  setDismissedHandoffId(handoffPromptId)
                  setHandoffPromptId(null)
                }}
                style={{
                  padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)',
                  color: '#fff', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700,
                }}
              >知道了</button>
            </div>
          </div>
        </div>
      )}

      {returnNoticeId && (
        <div
          role="presentation"
          style={{
            position: 'fixed', inset: 0, zIndex: 195, background: 'rgba(0,0,0,.42)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{
              width: 'min(400px, 100%)', borderRadius: 8, background: 'var(--bg-primary)',
              border: '1px solid var(--border)', boxShadow: '0 18px 50px rgba(0,0,0,.28)', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 18px 10px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>会话已交还</div>
              <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                {conv.returnNotice?.message || '销售主管已将会话交还给你。'}
              </div>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'flex-end', padding: '12px 18px 16px',
              borderTop: '1px solid var(--border-soft)',
            }}>
              <button
                onClick={async () => {
                  try {
                    await onMarkHandoffNoticeSeen?.(returnNoticeId)
                    setReturnNoticeId(null)
                  } catch (error) {
                    setSendError(error.message)
                  }
                }}
                style={{
                  padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)',
                  color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                }}
              >知道了</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

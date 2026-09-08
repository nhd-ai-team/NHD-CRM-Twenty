import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Search, Paperclip, Flag, MoreHorizontal } from 'lucide-react'
import { ChannelIcon } from './ChannelIcon'
import { LeadSidebar } from './LeadSidebar'
import { useEmails } from '../hooks/useEmails'
import { useLeadForm } from '../hooks/useLeadForm'

function addressLabel(address) {
  if (!address) return ''
  return address.name ? `${address.name} <${address.address}>` : address.address
}

function addressesLabel(addresses) {
  return Array.isArray(addresses) ? addresses.map(addressLabel).filter(Boolean).join('、') : ''
}

// 邮件正文常带有历史引用；拆开后分别渲染，避免把客户当前来信和我方旧回复看成同一封邮件。
function splitQuotedEmail(content) {
  const text = String(content || '')
  const lines = text.split(/\r?\n/)
  const quoteStart = lines.findIndex((line, index) => index > 0 && (
    /^\s*>/.test(line) ||
    /^\s*(From|发件人)\s*:/i.test(line)
  ))
  if (quoteStart <= 0) return [{ content: text, quoted: false }]
  const current = lines.slice(0, quoteStart).join('\n').trim()
  const quoted = lines.slice(quoteStart).join('\n').trim()
  if (!current || !quoted) return [{ content: text, quoted: false }]
  const outbound = /sales@chinanhd\.com/i.test(quoted)
  return [
    { content: current, quoted: false },
    { content: quoted, quoted: true, direction: outbound ? 'outbound' : 'inbound' },
  ]
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function EmailListItem({ conv, active, onClick, onToggleFlag }) {
  const [hovered, setHovered] = useState(false)
  const last = conv.messages[conv.messages.length - 1]
  const subject = last?.subject || conv.lastMessage || '(无主题)'
  const when = conv.lastMessageAt ? format(new Date(conv.lastMessageAt), 'MM-dd HH:mm') : ''
  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{
      display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 14px', cursor: 'pointer',
      borderBottom: '1px solid var(--border-soft)',
      background: active ? 'var(--bg-active)' : 'transparent',
      borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {conv.contact?.name || conv.contact?.email || '未知发件人'}
        </span>
        {hovered && onToggleFlag && conv.latestMessageId && (
          <>
            <button type="button" title={conv.sourceIsFlagged ? '取消重点' : '标记为重点'} aria-label={conv.sourceIsFlagged ? '取消重点' : '标记为重点'} onClick={event => { event.stopPropagation(); onToggleFlag(conv) }} style={{ border: 'none', background: 'transparent', padding: 1, color: conv.sourceIsFlagged ? '#f04438' : 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', flexShrink: 0 }}>
              <Flag size={15} fill={conv.sourceIsFlagged ? 'currentColor' : 'none'} strokeWidth={1.8} />
            </button>
            <button type="button" title="更多操作" aria-label="更多操作" onClick={event => event.stopPropagation()} style={{ border: 'none', background: 'transparent', padding: 1, color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', flexShrink: 0 }}>
              <MoreHorizontal size={15} />
            </button>
          </>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subject}</div>
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{conv.contact?.email}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{when}</span>
      </div>
    </div>
  )
}

function EmailCard({ msg, fromLabel, directionOverride, quoted = false, onToggleFlag }) {
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : []
  const outbound = (directionOverride || msg.mailDirection) === 'outbound'
  const directionLabel = quoted ? `引用历史（${outbound ? '发件' : '收件'}）` : (outbound ? '发件邮件' : '收件邮件')
  const directionColor = outbound ? '#1677ff' : '#16834b'
  const directionBackground = outbound ? '#f4f8ff' : '#f5fbf7'
  const from = msg.fromAddress || (outbound ? '' : fromLabel)
  const to = addressesLabel(msg.toAddresses)
  const cc = addressesLabel(msg.ccAddresses)
  return (
    <div style={{
      border: quoted ? `1px dashed ${directionColor}` : '1px solid var(--border)', borderLeft: `4px solid ${directionColor}`, borderRadius: 8, background: directionBackground,
      marginBottom: 14, overflow: 'hidden', boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--border-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: directionColor, flexShrink: 0 }}>{directionLabel}</span>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', minWidth: 0 }}>{msg.subject || '(无主题)'}</div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 7, lineHeight: 1.55 }}>
          <div><strong style={{ color: 'var(--text-secondary)' }}>发件人</strong>：{from || '未知'}</div>
          {to && <div><strong style={{ color: 'var(--text-secondary)' }}>收件人</strong>：{to}</div>}
          {cc && <div><strong style={{ color: 'var(--text-secondary)' }}>抄送</strong>：{cc}</div>}
          <div>{format(msg.sentAt, 'yyyy-MM-dd HH:mm')}</div>
        </div>
      </div>
      <div style={{ padding: '12px 16px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {msg.content || <span style={{ color: 'var(--text-muted)' }}>（无正文）</span>}
      </div>
      {attachments.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-soft)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {attachments.map((a, i) => {
            const base = {
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5,
              padding: '4px 10px', borderRadius: 6, background: 'var(--bg-active)',
            }
            // 有 url 的可下载（新收邮件）；无 url 的是历史邮件，仅展示元数据、置灰不可点。
            return a.url ? (
              <a key={i} href={a.url} download title={`下载 ${a.filename}`}
                style={{ ...base, color: 'var(--text-secondary)', textDecoration: 'none', cursor: 'pointer' }}>
                <Paperclip size={12} /> {a.filename} <span style={{ color: 'var(--text-muted)' }}>{fmtSize(a.size)}</span>
              </a>
            ) : (
              <span key={i} title="历史邮件附件暂不支持下载"
                style={{ ...base, color: 'var(--text-secondary)', opacity: 0.72 }}>
                <Paperclip size={12} /> {a.filename} <span style={{ color: 'var(--text-muted)' }}>{fmtSize(a.size)}</span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function MailApp() {
  const { filtered, selected, selectedId, setSelectedId, search, setSearch, emailCategory, setEmailCategory, toggleFlag, loadMore, hasMore, loadingMore, totalCount } = useEmails()
  const leadForm = useLeadForm({ selected, selectedId })
  const bottomRef = useRef(null)
  const listBottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView() }, [selectedId, selected?.messages?.length])

  useEffect(() => {
    const node = listBottomRef.current
    if (!node || !hasMore) return undefined
    const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) loadMore() }, { rootMargin: '180px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  const fromLabel = selected
    ? `${selected.contact?.name || ''}${selected.contact?.email ? ` <${selected.contact.email}>` : ''}`.trim()
    : ''

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
      {/* 左：邮件列表 */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', borderBottom: '1px solid var(--border)' }}>
          <ChannelIcon channel="email" size={16} />
          <span style={{ fontWeight: 700, fontSize: 14 }}>邮箱</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{totalCount || filtered.length}</span>
        </div>
        <div style={{ padding: '8px 12px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, background: 'var(--bg-active)' }}>
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索发件人、邮箱、主题…"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--text-primary)', width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {[['inbox', '收件箱'], ['outbound', '发件箱'], ['flagged', '重点邮件'], ['junk', '垃圾邮件'], ['all', '全部']].map(([value, label]) => (
              <button key={value} type="button" onClick={() => setEmailCategory(value)} style={{ border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 11, cursor: 'pointer', color: emailCategory === value ? 'var(--accent)' : 'var(--text-secondary)', background: emailCategory === value ? 'var(--bg-active)' : 'transparent' }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {filtered.length === 0
            ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>暂无邮件</div>
            : filtered.map(conv => (
                <EmailListItem key={conv.id} conv={conv} active={conv.id === selectedId} onClick={() => setSelectedId(conv.id)} onToggleFlag={conv => toggleFlag(conv.id, conv.latestMessageId, !conv.sourceIsFlagged)} />
              ))
          }
          {hasMore && <div ref={listBottomRef} style={{ padding: '10px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>{loadingMore ? '正在加载…' : '继续下拉加载更多'}</div>}
        </div>
      </div>

      {/* 中：只读邮件线程 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>从左侧选择一封邮件</div>
        ) : (
          <>
            <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.contact?.name || selected.contact?.email}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selected.contact?.email}</div>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, minHeight: 0 }}>
              {selected.messages.map((msg, i) => (
                splitQuotedEmail(msg.content).map((part, partIndex) => (
                  <EmailCard
                    key={`${msg.id ?? i}-${partIndex}`}
                    msg={{ ...msg, content: part.content }}
                    fromLabel={fromLabel}
                    directionOverride={part.direction}
                    quoted={part.quoted}
                  />
                ))
              ))}
              <div ref={bottomRef} />
            </div>
          </>
        )}
      </div>

      {/* 右：资料表单（复用） */}
      <LeadSidebar form={leadForm} selected={selected} inline={true} open={true} />
    </div>
  )
}

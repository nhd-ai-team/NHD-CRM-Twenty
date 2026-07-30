import { useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { Search, Paperclip } from 'lucide-react'
import { ChannelIcon } from './ChannelIcon'
import { LeadSidebar } from './LeadSidebar'
import { useEmails } from '../hooks/useEmails'
import { useLeadForm } from '../hooks/useLeadForm'

function fmtSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function EmailListItem({ conv, active, onClick }) {
  const last = conv.messages[conv.messages.length - 1]
  const subject = last?.subject || conv.lastMessage || '(无主题)'
  const when = conv.lastMessageAt ? format(new Date(conv.lastMessageAt), 'MM-dd HH:mm') : ''
  return (
    <div onClick={onClick} style={{
      display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 14px', cursor: 'pointer',
      borderBottom: '1px solid var(--border-soft)',
      background: active ? 'var(--bg-active)' : 'transparent',
      borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {conv.contact?.name || conv.contact?.email || '未知发件人'}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{when}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subject}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.contact?.email}</div>
    </div>
  )
}

function EmailCard({ msg, fromLabel }) {
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : []
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-primary)',
      marginBottom: 14, overflow: 'hidden', boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--border-soft)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{msg.subject || '(无主题)'}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
          {fromLabel} · {format(msg.sentAt, 'yyyy-MM-dd HH:mm')}
        </div>
      </div>
      <div style={{ padding: '12px 16px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {msg.content || <span style={{ color: 'var(--text-muted)' }}>（无正文）</span>}
      </div>
      {attachments.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-soft)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {attachments.map((a, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5,
              padding: '4px 10px', borderRadius: 6, background: 'var(--bg-active)', color: 'var(--text-secondary)',
            }}>
              <Paperclip size={12} /> {a.filename} <span style={{ color: 'var(--text-muted)' }}>{fmtSize(a.size)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function MailApp() {
  const { filtered, selected, selectedId, setSelectedId, search, setSearch } = useEmails()
  const leadForm = useLeadForm({ selected, selectedId })
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView() }, [selectedId, selected?.messages?.length])

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
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{filtered.length}</span>
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
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {filtered.length === 0
            ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>暂无邮件</div>
            : filtered.map(conv => (
                <EmailListItem key={conv.id} conv={conv} active={conv.id === selectedId} onClick={() => setSelectedId(conv.id)} />
              ))
          }
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
                <EmailCard key={msg.id ?? i} msg={msg} fromLabel={fromLabel} />
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

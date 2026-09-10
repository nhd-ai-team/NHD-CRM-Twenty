import { useEffect, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

export function RelatedVisitorsPopover({ visitors = [], compact = false, onSelect }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  if (!visitors.length) return null

  useEffect(() => {
    if (!open) return undefined
    const close = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const count = visitors.length
  return (
    <span ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }} onClick={event => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        title="查看疑似关联访客会话"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: compact ? '1px 5px' : '2px 6px', borderRadius: 4,
          border: '1px solid #fed7aa', background: '#fff7ed', color: '#c2410c',
          fontSize: compact ? 10 : 11, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
        }}
      >
        <Users size={compact ? 11 : 12} /> 疑似关联 {count}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="疑似关联访客会话"
          style={{
            position: 'absolute', zIndex: 50, top: 'calc(100% + 6px)', right: 0,
            width: 270, maxWidth: 'min(270px, 80vw)', padding: 8,
            border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-primary)',
            boxShadow: '0 10px 28px rgba(0,0,0,.16)',
          }}
        >
          <div style={{ padding: '3px 5px 7px', fontSize: 11, color: 'var(--text-muted)' }}>
            同一公网 IP 下的其他官网会话
          </div>
          {visitors.map(visitor => (
            <button
              key={visitor.conversationId}
              type="button"
              onClick={() => { setOpen(false); onSelect?.(visitor.conversationId) }}
              style={{
                display: 'block', width: '100%', padding: '7px 6px', textAlign: 'left',
                border: 'none', borderTop: '1px solid var(--border-soft)', background: 'transparent',
                color: 'var(--text-primary)', cursor: onSelect ? 'pointer' : 'default',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {visitor.visitorName || '官网访客'}
              </div>
              <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {visitor.lastMessageAt ? formatDistanceToNow(new Date(visitor.lastMessageAt), { locale: zhCN, addSuffix: true }) : '暂无时间'}
                {visitor.pageUrl ? ` · ${visitor.pageUrl}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

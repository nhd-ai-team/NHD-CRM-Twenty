import { Search, Filter, SlidersHorizontal } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { CHANNELS, STATUS_FILTERS } from '../data/mock'
import { ChannelIcon } from './ChannelIcon'

function Avatar({ contact, size = 36 }) {
  const initials = contact.name.replace(/[^a-zA-Z一-龥]/g, '').slice(0, 2).toUpperCase() || '?'
  const colors = ['#7c3aed','#0891b2','#16a34a','#dc2626','#ea580c','#0284c7']
  const color = colors[(contact.name.charCodeAt(0) || 0) % colors.length]
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: size * 0.35, fontWeight: 600, flexShrink: 0,
      letterSpacing: '0.02em',
    }}>{initials}</div>
  )
}

function FiledTag({ status }) {
  if (status === 'unfiled') return (
    <span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'var(--tag-unfiled-bg)',color:'var(--tag-unfiled-text)',fontWeight:600,whiteSpace:'nowrap'}}>
      未建档
    </span>
  )
  if (status === 'customer') return (
    <span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'var(--tag-customer-bg)',color:'var(--tag-customer-text)',fontWeight:600,whiteSpace:'nowrap'}}>
      客户
    </span>
  )
  if (status === 'lead') return (
    <span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'var(--green-soft)',color:'var(--green)',fontWeight:600,whiteSpace:'nowrap'}}>
      线索
    </span>
  )
  return null
}

function ConvCard({ conv, isSelected, onSelect }) {
  const timeStr = formatDistanceToNow(conv.lastMessageAt, { locale: zhCN, addSuffix: false })
  return (
    <div
      onClick={onSelect}
      style={{
        padding: '10px 14px',
        background: isSelected ? 'var(--bg-active)' : 'transparent',
        borderBottom: '1px solid var(--border-soft)',
        cursor: 'pointer',
        transition: 'background .1s',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar contact={conv.contact} size={36} />
          <div style={{
            position: 'absolute', bottom: -1, right: -1,
            background: 'var(--bg-primary)', borderRadius: '50%', padding: 1,
          }}>
            <ChannelIcon channel={conv.channel} size={13} />
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
              {conv.contact.name}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timeStr}</span>
              {conv.unread > 0 && (
                <span style={{
                  minWidth: 16, height: 16, borderRadius: 8, background: 'var(--accent)',
                  color: '#fff', fontSize: 10, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                }}>{conv.unread}</span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <p style={{
              fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160,
              fontWeight: conv.unread > 0 ? 500 : 400,
            }}>{conv.lastMessage}</p>
            <FiledTag status={conv.contact.filedStatus} />
          </div>

          {conv.contact.country && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              📍 {conv.contact.country}{conv.contact.timezone ? ` · ${conv.contact.timezone}` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function ConversationSidebar({ conversations, selectedId, onSelect, activeChannel, setActiveChannel, activeStatus, setActiveStatus, search, setSearch }) {
  return (
    <div style={{
      width: 320, flexShrink: 0, borderRight: '1px solid var(--border)',
      background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {/* Channel tabs */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-primary)', overflowX: 'auto', flexShrink: 0,
      }}>
        {CHANNELS.map(ch => (
          <button
            key={ch.id}
            onClick={() => setActiveChannel(ch.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px',
              fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', border: 'none',
              background: 'transparent', cursor: 'pointer',
              color: activeChannel === ch.id ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: activeChannel === ch.id ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'color .15s',
            }}
          >
            {ch.id !== 'all' && <ChannelIcon channel={ch.id} size={13} />}
            {ch.label}
            {ch.id !== 'all' && (
              <span style={{
                fontSize: 10, padding: '0 5px', borderRadius: 10, fontWeight: 700,
                background: activeChannel === ch.id ? 'var(--accent-soft)' : 'var(--bg-active)',
                color: activeChannel === ch.id ? 'var(--accent-text)' : 'var(--text-muted)',
              }}>
                {conversations.filter(c => c.channel === ch.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '5px 10px',
        }}>
          <Search size={13} color="var(--text-muted)" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索联系人、消息、电话..."
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontSize: 12, color: 'var(--text-primary)',
            }}
          />
          <Filter size={13} color="var(--text-muted)" style={{ cursor: 'pointer' }} />
          <SlidersHorizontal size={13} color="var(--text-muted)" style={{ cursor: 'pointer' }} />
        </div>
      </div>

      {/* Status filters */}
      <div style={{
        display: 'flex', gap: 4, padding: '6px 12px',
        borderBottom: '1px solid var(--border-soft)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {STATUS_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setActiveStatus(f.id)}
            style={{
              padding: '3px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 500,
              border: 'none', cursor: 'pointer', transition: 'all .1s',
              background: activeStatus === f.id ? 'var(--accent)' : 'var(--bg-active)',
              color: activeStatus === f.id ? '#fff' : 'var(--text-secondary)',
            }}
          >{f.label}</button>
        ))}
      </div>

      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {conversations.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            暂无会话
          </div>
        ) : (
          conversations.map(conv => (
            <ConvCard
              key={conv.id}
              conv={conv}
              isSelected={conv.id === selectedId}
              onSelect={() => onSelect(conv.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

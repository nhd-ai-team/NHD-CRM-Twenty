import { MessageCircle, Search } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { STATUS_FILTERS } from '../data/mock'
import { ChannelIcon } from './ChannelIcon'
import { InlineNameEditor } from './InlineNameEditor'
import { fmtTimezone } from '../utils/timezone'

function Avatar({ contact, size = 36 }) {
  const name = String(contact?.name || '')
  const initials = name.replace(/[^a-zA-Z一-龥]/g, '').slice(0, 2).toUpperCase() || '?'
  const colors = ['#7c3aed','#0891b2','#16a34a','#dc2626','#ea580c','#0284c7']
  const color = colors[(name.charCodeAt(0) || 0) % colors.length]
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
  if (status === 'lead') return null
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
  return null
}

function ConvCard({ conv, isSelected, onSelect, onRename }) {
  const timeStr = formatDistanceToNow(conv.lastMessageAt, { locale: zhCN, addSuffix: false })
  // 需求三：列表显示推断地域（国家/地区/城市/时区——时区为用户明确要求保留字段，转 UTC±H 友好显示），缺失时明确标示「未知地区」
  const geoParts = [conv.contact?.country, conv.contact?.region, conv.contact?.city, fmtTimezone(conv.contact?.timezone)].filter(Boolean)
  const utmSource = conv.contact?.utmSource || conv.contact?.utmCampaign || ''
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
            {/* 需求一：名称旁内联编辑入口；固定 maxWidth 保证编辑态不撑开卡片宽度 */}
            <InlineNameEditor
              name={conv.contact?.name || ''}
              nameSource={conv.contact?.nameSource}
              channelName={conv.contact?.channelName}
              onSave={onRename ? (value => onRename(conv.id, value)) : undefined}
              canEdit={Boolean(onRename)}
              fontSize={13}
              fontWeight={600}
              maxWidth={150}
            />
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

          {/* 地域行仅官网渠道展示（其他渠道无 IP 概念，显示「未知地区」是噪音）；官网无地域时明确标示 */}
          {conv.channel === 'website' ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              📍 {geoParts.length > 0 ? geoParts.join(' · ') : '未知地区'}{utmSource ? ` · ${utmSource}` : ''}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function ConversationSidebar({ conversations, selectedId, onSelect, onNewWhatsApp, activeStatus, setActiveStatus, search, setSearch, showNewWhatsApp = true, onRename }) {
  return (
    <div style={{
      width: 280, flexShrink: 0, borderRight: '1px solid var(--border)',
      background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {/* Search */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0, display: 'flex', gap: 6 }}>
        <div style={{
          flex: 1,
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '5px 10px',
        }}>
          <Search size={13} color="var(--text-muted)" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索联系人、消息、WhatsApp..."
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontSize: 12, color: 'var(--text-primary)',
            }}
          />
        </div>
        {showNewWhatsApp && (
          <button onClick={onNewWhatsApp} title="新建 WhatsApp 会话" aria-label="新建 WhatsApp 会话" style={{ width: 30, height: 30, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <MessageCircle size={15} />
          </button>
        )}
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
              onRename={onRename}
            />
          ))
        )}
      </div>
    </div>
  )
}

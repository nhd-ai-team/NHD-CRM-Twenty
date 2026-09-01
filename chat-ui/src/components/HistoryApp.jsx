import { useEffect, useRef } from 'react'
import { ChannelIcon } from './ChannelIcon'
import { ConversationSidebar } from './ConversationSidebar'
import { MessageBubble } from './ChatPanel'
import { useConversations } from '../hooks/useConversations'

function statusText(status) {
  if (status === 'takeover') return '人工接待'
  if (status === 'closed') return '已关闭'
  return '进行中'
}

export function HistoryApp() {
  const {
    conversations, filtered, selected, selectedId, selectConversation,
    activeStatus, setActiveStatus, search, setSearch,
  } = useConversations({ includeEmail: false, view: 'history' })
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView() }, [selectedId, selected?.messages?.length])

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
      <ConversationSidebar
        conversations={filtered}
        selectedId={selectedId}
        onSelect={selectConversation}
        activeStatus={activeStatus}
        setActiveStatus={setActiveStatus}
        search={search}
        setSearch={setSearch}
        showNewWhatsApp={false}
      />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>沟通状态</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{conversations.length} 条会话</span>
          {selected && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <ChannelIcon channel={selected.channel} size={15} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selected.contact?.name || '未命名'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{statusText(selected.status)}</span>
            </div>
          )}
        </div>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            从左侧选择一条会话
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', minHeight: 0 }}>
            {selected.messages?.length ? (
              selected.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} channel={selected.channel} />)
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>暂无聊天记录</div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  )
}

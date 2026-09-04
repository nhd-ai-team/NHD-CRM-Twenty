import { useState, useEffect, useCallback, useRef } from 'react'
import { ConversationSidebar } from './components/ConversationSidebar'
import { ChatPanel } from './components/ChatPanel'
import { LeadSidebar } from './components/LeadSidebar'
import { useConversations } from './hooks/useConversations'
import { useAiSettings } from './hooks/useAiSettings'
import { useLeadForm } from './hooks/useLeadForm'
import { usePresence } from './hooks/usePresence'
import { AiConfigPopover } from './components/AiConfigPopover'
import { installTwentyAuthMessageListener } from './utils/twentyAuth'
import { CHANNELS } from './data/mock'
import { ChannelIcon } from './components/ChannelIcon'
import { NewWhatsAppConversationModal } from './components/NewWhatsAppConversationModal'
import { PanelRightOpen, PanelRightClose, Settings } from 'lucide-react'

// Layout breakpoints (iframe width)
function getLayout(w) {
  if (w >= 700) return 'wide'
  if (w >= 500) return 'medium'
  return 'narrow'
}

function topIconButtonStyle(active = false) {
  return {
    width: 30, height: 30, borderRadius: 6, border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: 'pointer',
  }
}

// 销售的官网接待状态。用「在岗/离岗」文字药丸而非图标：状态和可点击方向一眼可见，
// 不需要 hover 才知道当前是什么状态、点下去会变成什么。
function PresenceSwitch({ status, disabled, onClick }) {
  const online = status === 'online'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={online ? '当前在岗，可接待官网客户。点击切换为离岗' : '当前离岗，不接待官网客户。点击切换为在岗'}
      aria-label={online ? '当前在岗，切换为离岗' : '当前离岗，切换为在岗'}
      style={{
        height: 26, padding: '0 10px', borderRadius: 999,
        border: `1px solid ${online ? '#86efac' : 'var(--border)'}`,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: online ? '#dcfce7' : 'var(--bg-active)',
        color: online ? '#15803d' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .55 : 1,
        fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
        transition: 'background .18s ease, border-color .18s ease, opacity .18s ease',
      }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto',
        background: online ? '#16a34a' : 'var(--text-muted)',
      }} />
      {online ? '在岗' : '离岗'}
    </button>
  )
}

function ChannelBar({ conversations, activeChannel, setActiveChannel, contactOpen, onToggleContact, aiSettings, presence }) {
  const [aiOpen, setAiOpen] = useState(false)
  const [pendingPresenceStatus, setPendingPresenceStatus] = useState(null)
  const gearRef = useRef(null)
  const confirmPresenceChange = async () => {
    if (!pendingPresenceStatus) return
    const changed = await presence.setPresenceStatus(pendingPresenceStatus)
    if (changed) setPendingPresenceStatus(null)
  }
  return (
    <div style={{
      height: 44, flexShrink: 0, display: 'flex', alignItems: 'stretch',
      borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)',
      overflow: 'visible',
    }}>
      {CHANNELS.map((ch) => {
        const active = activeChannel === ch.id
        const count = ch.id === 'all' ? conversations.length : conversations.filter(c => c.channel === ch.id).length
        const unreadCount = ch.id === 'all'
          ? conversations.reduce((sum, conversation) => sum + (conversation.unread || 0), 0)
          : conversations.filter(c => c.channel === ch.id).reduce((sum, conversation) => sum + (conversation.unread || 0), 0)
        return (
          <button
            key={ch.id}
            onClick={() => setActiveChannel(ch.id)}
            style={{
              flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, padding: '0 10px', border: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent', color: active ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 12.5, fontWeight: active ? 700 : 500,
            }}
          >
            {ch.id !== 'all' && <ChannelIcon channel={ch.id} size={14} />}
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.label}</span>
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 700,
              background: active ? 'var(--accent-soft)' : 'var(--bg-active)',
              color: active ? 'var(--accent-text)' : 'var(--text-muted)',
            }}>{count}</span>
            {unreadCount > 0 && <span style={{
              minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700,
            }}>{unreadCount}</span>}
          </button>
        )
      })}
      <div style={{
        flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4,
        padding: '0 10px', borderLeft: '1px solid var(--border-soft)', position: 'relative',
      }}>
        <PresenceSwitch
          status={presence.status}
          disabled={presence.loading || presence.saving}
          onClick={() => setPendingPresenceStatus(presence.status === 'online' ? 'offline' : 'online')}
        />
        <button
          ref={gearRef}
          onClick={() => setAiOpen(o => !o)}
          title="AI配置"
          aria-label="AI配置"
          style={topIconButtonStyle(aiOpen)}
        >
          <Settings size={16} />
        </button>
        {aiOpen && (
          <AiConfigPopover
            settings={aiSettings.settings}
            loading={aiSettings.loading}
            error={aiSettings.error}
            onSave={aiSettings.save}
            onSaveAll={aiSettings.saveAll}
            onClose={() => setAiOpen(false)}
          />
        )}
        <button
          onClick={onToggleContact}
          title={contactOpen ? '收起资料表单' : '展开资料表单'}
          aria-label={contactOpen ? '收起资料表单' : '展开资料表单'}
          style={topIconButtonStyle(contactOpen)}
        >
          {contactOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
      {pendingPresenceStatus && (
        <div
          role="presentation"
          onClick={() => !presence.saving && setPendingPresenceStatus(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="presence-confirm-title"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(360px, 100%)', borderRadius: 8, background: 'var(--bg-primary)',
              border: '1px solid var(--border)', boxShadow: '0 18px 50px rgba(0,0,0,.28)', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 18px 10px' }}>
              <div id="presence-confirm-title" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                确认切换为{pendingPresenceStatus === 'online' ? '在岗' : '离岗'}？
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                {pendingPresenceStatus === 'online'
                  ? '在岗后，官网客户会分配给你，你也才能回复官网会话。'
                  : '离岗后不再分配新的官网客户，你正在接待的官网会话会交还 AI。WhatsApp、邮件不受影响。'}
              </div>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px 16px',
              borderTop: '1px solid var(--border-soft)',
            }}>
              <button
                onClick={() => setPendingPresenceStatus(null)}
                disabled={presence.saving}
                style={{
                  height: 32, padding: '0 14px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)', cursor: presence.saving ? 'default' : 'pointer',
                  fontSize: 12, fontWeight: 600,
                }}
              >取消</button>
              <button
                onClick={confirmPresenceChange}
                disabled={presence.saving}
                style={{
                  height: 32, padding: '0 14px', borderRadius: 6, border: 'none',
                  background: pendingPresenceStatus === 'online' ? '#16a34a' : '#6b7280', color: '#fff',
                  cursor: presence.saving ? 'default' : 'pointer', opacity: presence.saving ? .7 : 1,
                  fontSize: 12, fontWeight: 700,
                }}
              >{presence.saving ? '处理中…' : '确认切换'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  useEffect(() => installTwentyAuthMessageListener(), [])

  const {
    conversations, filtered, selected, selectedId, selectConversation,
    activeChannel, setActiveChannel,
    activeStatus, setActiveStatus,
    search, setSearch,
    sendMessage, setTakeover, markHandoffNoticeSeen, renameConversation, reload: reloadConversations,
  } = useConversations()

  const aiSettings = useAiSettings()
  const presence = usePresence()
  // 保存渠道 AI 配置后立即刷新会话列表，令「接入人工」按钮的灰/亮状态即时联动
  const handleAiSave = useCallback(async (channel, patch) => {
    const ok = await aiSettings.save(channel, patch)
    if (ok) reloadConversations().catch(() => {})
    return ok
  }, [aiSettings, reloadConversations])
  const handleAiSaveAll = useCallback(async (items) => {
    const ok = await aiSettings.saveAll(items)
    if (ok) reloadConversations().catch(() => {})
    return ok
  }, [aiSettings, reloadConversations])

  const [layout, setLayout] = useState(() => getLayout(window.innerWidth))
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(true)
  const [newWhatsAppOpen, setNewWhatsAppOpen] = useState(false)

  // 右侧「资料」草稿 + 转线索：抽到 useLeadForm，与邮箱视图共用。
  const leadForm = useLeadForm({
    selected,
    selectedId,
    onConverted: reloadConversations,
    onNameChanged: renameConversation,
  })

  useEffect(() => {
    function onResize() {
      const l = getLayout(window.innerWidth)
      setLayout(l)
      if (l !== 'narrow') setSidebarOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const isNarrow = layout === 'narrow'
  const isWide = layout === 'wide'

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
        <ChannelBar
          conversations={conversations}
          activeChannel={activeChannel}
          setActiveChannel={setActiveChannel}
          contactOpen={contactOpen}
          onToggleContact={() => setContactOpen((open) => !open)}
          aiSettings={{ ...aiSettings, save: handleAiSave, saveAll: handleAiSaveAll }}
          presence={presence}
        />

        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {isNarrow && sidebarOpen && (
            <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 48, background: 'rgba(0,0,0,.3)' }} />
          )}

          <div style={{
            position: isNarrow ? 'fixed' : 'relative', top: isNarrow ? 44 : 0, left: 0, bottom: 0,
            height: isNarrow ? 'calc(100vh - 44px)' : '100%',
            zIndex: isNarrow ? 49 : 'auto',
            transform: isNarrow && !sidebarOpen ? 'translateX(-100%)' : 'translateX(0)',
            transition: 'transform .2s ease', flexShrink: 0, display: 'flex',
          }}>
            <ConversationSidebar
              conversations={filtered}
              selectedId={selectedId}
              onSelect={(id) => { selectConversation(id); if (isNarrow) setSidebarOpen(false) }}
              onNewWhatsApp={() => setNewWhatsAppOpen(true)}
              activeStatus={activeStatus}
              setActiveStatus={setActiveStatus}
              search={search}
              setSearch={setSearch}
              onRename={renameConversation}
            />
          </div>

          <ChatPanel
            conv={selected}
            onSend={sendMessage}
            onTakeover={(action) => setTakeover(selected?.id, action)}
            onMarkHandoffNoticeSeen={(noticeId) => markHandoffNoticeSeen(selected?.id, noticeId)}
            onRename={renameConversation}
            layout={layout}
            onToggleSidebar={() => setSidebarOpen(o => !o)}
            presence={presence}
        />
        </div>
      </div>

      <LeadSidebar
        form={leadForm}
        selected={selected}
        inline={isWide}
        open={contactOpen}
      />
      <NewWhatsAppConversationModal
        open={newWhatsAppOpen}
        onClose={() => setNewWhatsAppOpen(false)}
        onCreated={async (conversationId) => {
          await reloadConversations()
          selectConversation(conversationId)
          setActiveChannel('whatsapp')
          setActiveStatus('all')
        }}
      />
    </div>
  )
}

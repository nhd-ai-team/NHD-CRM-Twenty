import { useState, useEffect, useCallback, useRef } from 'react'
import { ConversationSidebar } from './components/ConversationSidebar'
import { ChatPanel } from './components/ChatPanel'
import { LeadSidebar } from './components/LeadSidebar'
import { useConversations } from './hooks/useConversations'
import { useAiSettings } from './hooks/useAiSettings'
import { useLeadForm } from './hooks/useLeadForm'
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

function ChannelBar({ conversations, activeChannel, setActiveChannel, contactOpen, onToggleContact, aiSettings }) {
  const [aiOpen, setAiOpen] = useState(false)
  const gearRef = useRef(null)
  return (
    <div style={{
      height: 44, flexShrink: 0, display: 'flex', alignItems: 'stretch',
      borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)',
      overflow: 'hidden',
    }}>
      {CHANNELS.map((ch) => {
        const active = activeChannel === ch.id
        const count = ch.id === 'all' ? conversations.length : conversations.filter(c => c.channel === ch.id).length
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
          </button>
        )
      })}
      <div style={{
        flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4,
        padding: '0 10px', borderLeft: '1px solid var(--border-soft)', position: 'relative',
      }}>
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
    sendMessage, setTakeover, reload: reloadConversations,
  } = useConversations()

  const aiSettings = useAiSettings()
  // 保存渠道 AI 配置后立即刷新会话列表，令「接管会话」按钮的灰/亮状态即时联动
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
  const leadForm = useLeadForm({ selected, selectedId })

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
            />
          </div>

          <ChatPanel
            conv={selected}
            onSend={sendMessage}
            onTakeover={(action) => setTakeover(selected?.id, action)}
            layout={layout}
            onToggleSidebar={() => setSidebarOpen(o => !o)}
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

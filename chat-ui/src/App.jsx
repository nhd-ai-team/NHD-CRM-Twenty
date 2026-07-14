import { useState, useEffect } from 'react'
import { ConversationSidebar } from './components/ConversationSidebar'
import { ChatPanel } from './components/ChatPanel'
import { ContactPanel } from './components/ContactPanel'
import { ConvertToLeadDrawer } from './components/ConvertToLeadDrawer'
import { useConversations } from './hooks/useConversations'

export default function App() {
  const {
    filtered, selected, selectedId, selectConversation,
    activeChannel, setActiveChannel,
    activeStatus, setActiveStatus,
    search, setSearch,
    sendMessage, setTakeover, closeConversation,
  } = useConversations()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(() => window.innerWidth >= 900)
  // 窄 iframe (<500px) 默认收起会话列表，用汉堡按钮展开
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 500)

  useEffect(() => {
    function handleResize() {
      const w = window.innerWidth
      setContactOpen(w >= 900)
      setSidebarOpen(w >= 500)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div style={{
      display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden',
      background: 'var(--bg-primary)', color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      {/* 会话列表：宽屏内嵌，窄屏作为 overlay */}
      {window.innerWidth < 500 && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 48, background: 'rgba(0,0,0,.3)' }}
        />
      )}
      <div style={{
        position: window.innerWidth < 500 ? 'fixed' : 'relative',
        top: 0, left: 0, bottom: 0,
        zIndex: window.innerWidth < 500 ? 49 : 'auto',
        transform: window.innerWidth < 500 && !sidebarOpen ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform .2s ease',
        display: 'flex', flexShrink: 0,
      }}>
        <ConversationSidebar
          conversations={filtered}
          selectedId={selectedId}
          onSelect={(id) => { selectConversation(id); if (window.innerWidth < 500) setSidebarOpen(false) }}
          activeChannel={activeChannel}
          setActiveChannel={setActiveChannel}
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
        onClose={() => closeConversation(selected?.id)}
        onConvertLead={() => setDrawerOpen(true)}
        contactOpen={contactOpen}
        onToggleContact={() => setContactOpen(o => !o)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(o => !o)}
      />

      <ContactPanel conv={selected} open={contactOpen} onClose={() => setContactOpen(false)} />

      {drawerOpen && (
        <ConvertToLeadDrawer
          conv={selected}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  )
}

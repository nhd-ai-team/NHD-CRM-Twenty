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
  // 宽屏(≥900px)默认展开右栏，窄屏默认收起
  const [contactOpen, setContactOpen] = useState(() => window.innerWidth >= 900)

  useEffect(() => {
    function handleResize() {
      setContactOpen(window.innerWidth >= 900)
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
      <ConversationSidebar
        conversations={filtered}
        selectedId={selectedId}
        onSelect={selectConversation}
        activeChannel={activeChannel}
        setActiveChannel={setActiveChannel}
        activeStatus={activeStatus}
        setActiveStatus={setActiveStatus}
        search={search}
        setSearch={setSearch}
      />

      <ChatPanel
        conv={selected}
        onSend={sendMessage}
        onTakeover={(action) => setTakeover(selected?.id, action)}
        onClose={() => closeConversation(selected?.id)}
        onConvertLead={() => setDrawerOpen(true)}
        contactOpen={contactOpen}
        onToggleContact={() => setContactOpen(o => !o)}
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

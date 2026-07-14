import { useState } from 'react'
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
      />

      <ContactPanel conv={selected} />

      {drawerOpen && (
        <ConvertToLeadDrawer
          conv={selected}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  )
}

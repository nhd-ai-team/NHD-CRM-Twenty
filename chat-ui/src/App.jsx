import { useState, useEffect } from 'react'
import { ConversationSidebar } from './components/ConversationSidebar'
import { ChatPanel } from './components/ChatPanel'
import { ContactPanel } from './components/ContactPanel'
import { ConvertToLeadDrawer } from './components/ConvertToLeadDrawer'
import { useConversations } from './hooks/useConversations'

// Layout breakpoints (iframe width)
// wide   ≥700: 3-column inline (sidebar | chat | contact)
// medium 500–699: 2-column inline (sidebar | chat), contact as toggle overlay
// narrow <500: sidebar as drawer overlay, chat full width, contact as toggle overlay
function getLayout(w) {
  if (w >= 700) return 'wide'
  if (w >= 500) return 'medium'
  return 'narrow'
}

export default function App() {
  const {
    filtered, selected, selectedId, selectConversation,
    activeChannel, setActiveChannel,
    activeStatus, setActiveStatus,
    search, setSearch,
    sendMessage, setTakeover, closeConversation,
  } = useConversations()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [layout, setLayout] = useState(() => getLayout(window.innerWidth))
  const [sidebarOpen, setSidebarOpen] = useState(false) // only used in narrow mode
  const [contactOpen, setContactOpen] = useState(false) // only used in medium mode overlay

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
  const isWide   = layout === 'wide'

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      background: 'var(--bg-primary)', color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>

      {/* Narrow: backdrop for sidebar drawer */}
      {isNarrow && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 48, background: 'rgba(0,0,0,.3)' }}
        />
      )}

      {/* ConversationSidebar — inline on wide/medium, drawer on narrow */}
      <div style={{
        position: isNarrow ? 'fixed' : 'relative',
        top: 0, left: 0, bottom: 0,
        zIndex: isNarrow ? 49 : 'auto',
        transform: isNarrow && !sidebarOpen ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform .2s ease',
        flexShrink: 0,
        display: 'flex',
      }}>
        <ConversationSidebar
          conversations={filtered}
          selectedId={selectedId}
          onSelect={(id) => { selectConversation(id); if (isNarrow) setSidebarOpen(false) }}
          activeChannel={activeChannel}
          setActiveChannel={setActiveChannel}
          activeStatus={activeStatus}
          setActiveStatus={setActiveStatus}
          search={search}
          setSearch={setSearch}
        />
      </div>

      {/* ChatPanel — always takes remaining flex space */}
      <ChatPanel
        conv={selected}
        onSend={sendMessage}
        onTakeover={(action) => setTakeover(selected?.id, action)}
        onClose={() => closeConversation(selected?.id)}
        onConvertLead={() => setDrawerOpen(true)}
        layout={layout}
        contactOpen={contactOpen}
        onToggleContact={() => setContactOpen(o => !o)}
        onToggleSidebar={() => setSidebarOpen(o => !o)}
      />

      {/* ContactPanel — inline 3rd column on wide, overlay toggle on medium/narrow */}
      <ContactPanel
        conv={selected}
        inline={isWide}
        open={isWide || contactOpen}
        onClose={() => setContactOpen(false)}
      />

      {drawerOpen && (
        <ConvertToLeadDrawer
          conv={selected}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  )
}

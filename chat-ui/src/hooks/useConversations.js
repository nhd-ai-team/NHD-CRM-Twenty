import { useState, useMemo } from 'react'
import { CONVERSATIONS } from '../data/mock'

export function useConversations() {
  const [conversations, setConversations] = useState(CONVERSATIONS)
  const [activeChannel, setActiveChannel] = useState('all')
  const [activeStatus, setActiveStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(CONVERSATIONS[0]?.id ?? null)

  const filtered = useMemo(() => {
    return conversations.filter(c => {
      if (activeChannel !== 'all' && c.channel !== activeChannel) return false
      if (activeStatus === 'unread' && c.unread === 0) return false
      if (activeStatus === 'open' && c.status !== 'open') return false
      if (activeStatus === 'takeover' && c.status !== 'takeover') return false
      if (activeStatus === 'closed' && c.status !== 'closed') return false
      if (search) {
        const q = search.toLowerCase()
        if (!c.contact.name.toLowerCase().includes(q) &&
            !c.contact.phone.includes(q) &&
            !c.lastMessage.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [conversations, activeChannel, activeStatus, search])

  const selected = conversations.find(c => c.id === selectedId) ?? null

  function sendMessage(convId, content) {
    setConversations(prev => prev.map(c => {
      if (c.id !== convId) return c
      const msg = {
        id: `m${Date.now()}`,
        senderType: 'agent',
        content,
        sentAt: new Date(),
        contentType: 'text',
      }
      return {
        ...c,
        messages: [...c.messages, msg],
        lastMessage: content,
        lastMessageAt: new Date(),
        unread: 0,
      }
    }))
  }

  function setTakeover(convId, action) {
    setConversations(prev => prev.map(c => {
      if (c.id !== convId) return c
      const newStatus = action === 'takeover' ? 'takeover' : 'open'
      const sysMsg = {
        id: `m${Date.now()}`,
        senderType: 'system',
        content: action === 'takeover' ? '销售接管了此会话' : '已释放接管，恢复正常状态',
        sentAt: new Date(),
        contentType: 'system',
      }
      return { ...c, status: newStatus, messages: [...c.messages, sysMsg] }
    }))
  }

  function closeConversation(convId) {
    setConversations(prev => prev.map(c => c.id !== convId ? c : { ...c, status: 'closed' }))
  }

  function markRead(convId) {
    setConversations(prev => prev.map(c => c.id !== convId ? c : { ...c, unread: 0 }))
  }

  function selectConversation(id) {
    setSelectedId(id)
    markRead(id)
  }

  return {
    filtered, selected, selectedId, selectConversation,
    activeChannel, setActiveChannel,
    activeStatus, setActiveStatus,
    search, setSearch,
    sendMessage, setTakeover, closeConversation,
  }
}

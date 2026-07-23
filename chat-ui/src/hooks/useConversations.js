import { useState, useMemo, useEffect } from 'react'

export function useConversations() {
  const [conversations, setConversations] = useState([])
  const [activeChannel, setActiveChannel] = useState('all')
  const [activeStatus, setActiveStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  async function loadConversations() {
    const response = await fetch('/conv-api/conversations')
    if (!response.ok) throw new Error('无法加载会话')
    const list = await response.json()
    const withMessages = await Promise.all(list.map(async conv => {
      const messages = await fetch(`/conv-api/conversations/${conv.id}/messages`).then(r => r.ok ? r.json() : [])
      return { ...conv, messages: messages.map(m => ({ ...m, sentAt: new Date(m.sentAt) })), unread: 0 }
    }))
    setConversations(withMessages)
    setSelectedId(current => current || withMessages[0]?.id || null)
  }

  useEffect(() => {
    loadConversations().catch(error => console.error(error))
    const timer = setInterval(() => loadConversations().catch(() => {}), 10000)
    return () => clearInterval(timer)
  }, [])

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

  async function sendMessage(convId, content) {
    const response = await fetch(`/conv-api/conversations/${convId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
    if (!response.ok) throw new Error('WhatsApp 消息发送失败')
    window.setTimeout(() => loadConversations().catch(() => {}), 1000)
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

import { useState, useMemo, useEffect } from 'react'

export function useConversations() {
  const [conversations, setConversations] = useState([])
  const [activeChannel, setActiveChannel] = useState('all')
  const [activeStatus, setActiveStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  async function loadConversations() {
    // 附时间戳绕开 Cloudflare/浏览器对实时会话 API 的缓存
    const response = await fetch(`/conv-api/conversations?_=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('无法加载会话')
    // 邮箱是独立板块（见 useEmails），渠道工作台不展示 email 会话
    const list = (await response.json()).filter(c => c.channel !== 'email')
    const withMessages = await Promise.all(list.map(async conv => {
      const messages = await fetch(`/conv-api/conversations/${conv.id}/messages?_=${Date.now()}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : [])
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

  async function sendMessage(convId, content, file) {
    const options = { method: 'POST' }
    if (file) {
      const form = new FormData()
      if (content) form.append('content', content)
      form.append('file', file)
      options.body = form
    } else {
      options.headers = { 'Content-Type': 'application/json' }
      options.body = JSON.stringify({ content })
    }
    const response = await fetch(`/conv-api/conversations/${convId}/messages`, options)
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || '消息发送失败')
    }
    window.setTimeout(() => loadConversations().catch(() => {}), 1000)
  }

  async function setTakeover(convId, action) {
    if (!convId) return
    const response = await fetch(`/conv-api/conversations/${convId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || '会话状态切换失败')
    }
    await loadConversations()
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
    conversations, filtered, selected, selectedId, selectConversation,
    activeChannel, setActiveChannel,
    activeStatus, setActiveStatus,
    search, setSearch,
    sendMessage, setTakeover, closeConversation,
    reload: loadConversations,
  }
}

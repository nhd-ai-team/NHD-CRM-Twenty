import { useState, useMemo, useEffect } from 'react'
import { withTwentyAuthHeaders } from '../utils/twentyAuth'

export function useConversations({ includeEmail = false } = {}) {
  const [conversations, setConversations] = useState([])
  const [activeChannel, setActiveChannel] = useState('all')
  const [activeStatus, setActiveStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  async function loadConversations() {
    // 附时间戳绕开 Cloudflare/浏览器对实时会话 API 的缓存
    const response = await fetch(`/conv-api/conversations?_=${Date.now()}`, {
      cache: 'no-store',
      headers: withTwentyAuthHeaders(),
    })
    if (!response.ok) throw new Error('无法加载会话')
    // 邮箱是独立板块（见 useEmails），渠道工作台默认不展示 email 会话；只读历史页可按需复用全量接口。
    const list = (await response.json()).filter(c => includeEmail || c.channel !== 'email')
    setConversations(current => list.map(conv => ({
      ...conv,
      messages: current.find(item => item.id === conv.id)?.messages ?? [],
      unread: 0,
    })))
    setSelectedId(current => current || list[0]?.id || null)
  }

  async function loadMessages(convId) {
    if (!convId) return
    const response = await fetch(`/conv-api/conversations/${convId}/messages?_=${Date.now()}`, {
      cache: 'no-store',
      headers: withTwentyAuthHeaders(),
    })
    if (!response.ok) throw new Error('无法加载聊天记录')
    const messages = (await response.json()).map(message => ({
      ...message,
      sentAt: new Date(message.sentAt),
    }))
    setConversations(current => current.map(conv => conv.id === convId ? { ...conv, messages } : conv))
  }

  useEffect(() => {
    loadConversations().catch(error => console.error(error))
    const timer = setInterval(() => loadConversations().catch(() => {}), 10000)
    return () => clearInterval(timer)
  }, [includeEmail])

  useEffect(() => {
    loadMessages(selectedId).catch(error => console.error(error))
  }, [selectedId])

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
      options.headers = withTwentyAuthHeaders()
    } else {
      options.headers = withTwentyAuthHeaders({ 'Content-Type': 'application/json' })
      options.body = JSON.stringify({ content })
    }
    const response = await fetch(`/conv-api/conversations/${convId}/messages`, options)
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error([data.error, data.detail].filter(Boolean).join('：') || '消息发送失败')
    }
    window.setTimeout(() => {
      loadConversations().catch(() => {})
      loadMessages(convId).catch(() => {})
    }, 1000)
  }

  async function setTakeover(convId, action) {
    if (!convId) return
    const response = await fetch(`/conv-api/conversations/${convId}/status`, {
      method: 'PATCH',
      headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || '会话状态切换失败')
    }
    await loadConversations()
  }

  async function closeConversation(convId) {
    if (!convId) return
    const response = await fetch(`/conv-api/conversations/${convId}/status`, {
      method: 'PATCH',
      headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'close' }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || '关闭会话失败')
    }
    await loadConversations()
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

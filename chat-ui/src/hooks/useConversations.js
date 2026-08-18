import { useState, useMemo, useEffect } from 'react'
import { waitForTwentyAccessToken, withTwentyAuthHeaders } from '../utils/twentyAuth'

// 两批消息是否等价：条数、末条 id 与送达时间一致即视为没有新内容。
function sameMessageList(a = [], b = []) {
  if (a.length !== b.length) return false
  if (a.length === 0) return true
  const prev = a[a.length - 1]
  const next = b[b.length - 1]
  return prev.id === next.id && Number(prev.sentAt) === Number(next.sentAt)
}

export function useConversations({ includeEmail = false, view = 'chat' } = {}) {
  const [conversations, setConversations] = useState([])
  const [activeChannel, setActiveChannel] = useState('all')
  const [activeStatus, setActiveStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  async function loadConversations() {
    await waitForTwentyAccessToken()
    // 附时间戳绕开 Cloudflare/浏览器对实时会话 API 的缓存
    const params = new URLSearchParams({ _: String(Date.now()) })
    if (view === 'history') params.set('view', 'history')
    const response = await fetch(`/conv-api/conversations?${params.toString()}`, {
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
    setSelectedId(current => {
      if (current && list.some(conv => conv.id === current)) return current
      return list[0]?.id || null
    })
  }

  async function loadMessages(convId) {
    if (!convId) return
    await waitForTwentyAccessToken()
    const params = new URLSearchParams({ _: String(Date.now()) })
    if (view === 'history') params.set('view', 'history')
    const response = await fetch(`/conv-api/conversations/${convId}/messages?${params.toString()}`, {
      cache: 'no-store',
      headers: withTwentyAuthHeaders(),
    })
    if (!response.ok) throw new Error('无法加载聊天记录')
    const messages = (await response.json()).map(message => ({
      ...message,
      sentAt: new Date(message.sentAt),
    }))
    setConversations(current => current.map(conv => {
      if (conv.id !== convId) return conv
      // 轮询会反复拉到同一批消息；内容没变就复用旧数组，避免每次都换引用
      // 触发 ChatPanel 的滚动到底部，把销售正在看的历史位置顶掉。
      if (sameMessageList(conv.messages, messages)) return conv
      return { ...conv, messages }
    }))
  }

  useEffect(() => {
    loadConversations().catch(error => console.error(error))
    const timer = setInterval(() => loadConversations().catch(() => {}), 10000)
    return () => clearInterval(timer)
  }, [includeEmail, view])

  useEffect(() => {
    loadMessages(selectedId).catch(error => console.error(error))
    if (!selectedId) return undefined
    // 列表轮询只刷新会话摘要，且刻意保留旧 messages；当前打开的会话必须单独轮询，
    // 否则官网访客新消息和 AI 回复要等销售切走再切回来才显示。
    const timer = setInterval(() => loadMessages(selectedId).catch(() => {}), 5000)
    return () => clearInterval(timer)
  }, [selectedId, view])

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
    await waitForTwentyAccessToken()
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
    await waitForTwentyAccessToken()
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
    await waitForTwentyAccessToken()
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

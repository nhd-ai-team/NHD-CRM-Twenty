import { useState, useMemo, useEffect, useRef } from 'react'
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
  const [authExpired, setAuthExpired] = useState(false)
  const listRequestRef = useRef(0)
  const readInFlightRef = useRef(new Set())

  async function requireAccessToken() {
    const token = await waitForTwentyAccessToken()
    if (!token) {
      setAuthExpired(true)
      throw new Error('登录状态已失效，请刷新 CRM 后重试')
    }
    return token
  }

  async function loadConversations() {
    if (authExpired) return
    const requestId = ++listRequestRef.current
    await requireAccessToken()
    // 附时间戳绕开 Cloudflare/浏览器对实时会话 API 的缓存
    const params = new URLSearchParams({ _: String(Date.now()) })
    if (view === 'history') params.set('view', 'history')
    const response = await fetch(`/conv-api/conversations?${params.toString()}`, {
      cache: 'no-store',
      headers: withTwentyAuthHeaders(),
    })
    if (response.status === 401) {
      setAuthExpired(true)
      throw new Error('登录状态已失效，请刷新 CRM 后重试')
    }
    if (!response.ok) throw new Error('无法加载会话')
    // 邮箱是独立板块（见 useEmails），渠道工作台默认不展示 email 会话；只读历史页可按需复用全量接口。
    const list = (await response.json()).filter(c => includeEmail || c.channel !== 'email')
    // Mark-read-triggered requests supersede older polling responses.
    if (requestId != listRequestRef.current) return
    setConversations(current => list.map(conv => ({
      ...conv,
      messages: current.find(item => item.id === conv.id)?.messages ?? [],
      unread: Number(conv.unreadCount || 0),
    })))
    setSelectedId(current => {
      if (current && list.some(conv => conv.id === current)) return current
      return list[0]?.id || null
    })
  }

  async function loadMessages(convId) {
    if (!convId || authExpired) return
    await requireAccessToken()
    const params = new URLSearchParams({ _: String(Date.now()) })
    if (view === 'history') params.set('view', 'history')
    const response = await fetch(`/conv-api/conversations/${convId}/messages?${params.toString()}`, {
      cache: 'no-store',
      headers: withTwentyAuthHeaders(),
    })
    if (response.status === 401) {
      setAuthExpired(true)
      throw new Error('登录状态已失效，请刷新 CRM 后重试')
    }
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
    // 官网团队已读、WhatsApp 个人已读都以服务端游标为准；页面在前台且消息加载成功后才标记。
    if (document.visibilityState === 'visible') {
      await markRead(convId).catch(error => console.error(error))
    }
  }

  useEffect(() => {
    if (authExpired) return undefined
    loadConversations().catch(error => console.error(error))
    const timer = setInterval(() => loadConversations().catch(() => {}), 10000)
    return () => clearInterval(timer)
  }, [includeEmail, view, authExpired])

  useEffect(() => {
    if (authExpired) return undefined
    loadMessages(selectedId).catch(error => console.error(error))
    if (!selectedId) return undefined
    // 列表轮询只刷新会话摘要，且刻意保留旧 messages；当前打开的会话必须单独轮询，
    // 否则官网访客新消息和 AI 回复要等销售切走再切回来才显示。
    const timer = setInterval(() => loadMessages(selectedId).catch(() => {}), 5000)
    return () => clearInterval(timer)
  }, [selectedId, view, authExpired])

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
    await requireAccessToken()
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
    await requireAccessToken()
    const response = await fetch(`/conv-api/conversations/${convId}/status`, {
      method: 'PATCH',
      headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || '会话状态切换失败')
    }
    if (action === 'return' && data.agentId) {
      setConversations(current => current.map(conv => conv.id !== convId ? conv : {
        ...conv,
        agentId: data.agentId,
        currentAgentName: data.agentName || conv.currentAgentName,
        permissions: {
          ...conv.permissions,
          canReturnSales: false,
          canTransferSales: true,
          canReply: true,
          returnAgentId: null,
          returnAgentName: null,
        },
      }))
    }
    // 交还成功后不立即全量刷新：当前会话已经在本地更新，后台轮询会完成最终对齐。
    // 这样不会让宿主 CRM 在交还动作后因列表请求波动重置嵌入式工作台。
    if (action !== 'return') loadConversations().catch(error => console.error(error))
  }

  async function respondHandoff(convId, action) {
    if (!convId) return
    await requireAccessToken()
    const response = await fetch(`/conv-api/conversations/${convId}/handoff`, {
      method: 'PATCH',
      headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || '接管请求处理失败')
    }
    await loadConversations()
    await loadMessages(convId)
  }

  async function markHandoffNoticeSeen(convId, noticeId) {
    if (!convId || !noticeId) return
    await requireAccessToken()
    const response = await fetch(`/conv-api/conversations/${convId}/handoff-notice/${noticeId}`, {
      method: 'PATCH',
      headers: withTwentyAuthHeaders(),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || '通知状态更新失败')
    setConversations(current => current.map(conv => conv.id === convId
      ? { ...conv, returnNotice: null }
      : conv))
  }

  async function closeConversation(convId) {
    if (!convId) return
    await requireAccessToken()
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

  // 需求一：对话名称人工编辑。name 传空字符串 = 清除人工名并恢复渠道原始名。
  async function renameConversation(convId, name) {
    if (!convId) return null
    await requireAccessToken()
    const response = await fetch(`/conv-api/conversations/${convId}/name`, {
      method: 'PATCH',
      headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: String(name ?? '') }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error([data.error, data.detail].filter(Boolean).join('：') || '名称保存失败')
    }
    // 先本地生效（不等 10s 列表轮询），再拉一次后端对齐真实字段。
    setConversations(current => current.map(conv => conv.id !== convId ? conv : {
      ...conv,
      contact: {
        ...conv.contact,
        name: data.name || '',
        nameSource: data.source || 'channel',
        channelName: data.channelName ?? conv.contact?.channelName ?? '',
      },
    }))
    loadConversations().catch(() => {})
    return data
  }

  async function markRead(convId) {
    if (!convId || document.visibilityState !== 'visible') return
    if (readInFlightRef.current.has(convId)) return
    readInFlightRef.current.add(convId)
    try {
      await requireAccessToken()
      const response = await fetch('/conv-api/conversations/' + convId + '/read', {
        method: 'POST',
        headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
      })
      if (!response.ok) throw new Error('标记已读失败')
      setConversations(prev => prev.map(c => c.id !== convId ? c : { ...c, unread: 0, unreadCount: 0 }))
      // Reconcile with the server cursor before the next polling cycle.
      await loadConversations()
    } finally {
      readInFlightRef.current.delete(convId)
    }
  }
  function selectConversation(id) {
    setSelectedId(id)
  }

  return {
    conversations, filtered, selected, selectedId, selectConversation,
    activeChannel, setActiveChannel,
    activeStatus, setActiveStatus,
    search, setSearch,
    sendMessage, setTakeover, respondHandoff, markHandoffNoticeSeen, closeConversation, renameConversation,
    reload: loadConversations,
  }
}

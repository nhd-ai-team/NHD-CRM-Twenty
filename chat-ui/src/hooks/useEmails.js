import { useState, useEffect, useCallback, useRef } from 'react'
import { waitForTwentyAccessToken, withTwentyAuthHeaders, notifyTwentyAuthExpired } from '../utils/twentyAuth'

// 邮箱视图数据：复用 conv-api，仅取 channel='email' 的会话（只读，无发送/接管）。
export function useEmails() {
  const [emails, setEmails] = useState([]) // 会话（按发件人归集），带 messages
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [emailCategory, setEmailCategory] = useState('inbox')
  const [authExpired, setAuthExpired] = useState(false)
  const nextCursorRef = useRef('')
  const loadedCategoryRef = useRef('')
  const hasMoreRef = useRef(true)
  const loadingMoreRef = useRef(false)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [totalCount, setTotalCount] = useState(0)

  const requireAccessToken = useCallback(async () => {
    const token = await waitForTwentyAccessToken()
    if (!token) {
      setAuthExpired(true)
      notifyTwentyAuthExpired()
      throw new Error('登录状态已失效，请刷新 CRM 后重试')
    }
    return token
  }, [])

  const load = useCallback(async ({ append = false } = {}) => {
    if (authExpired) return
    if (append && (!hasMoreRef.current || loadingMoreRef.current)) return
    if (append) { loadingMoreRef.current = true; setLoadingMore(true) }
    try {
      await requireAccessToken()
      const params = new URLSearchParams({ _: String(Date.now()), includeEmail: 'true', channel: 'email', emailCategory, limit: '30' })
      if (append && nextCursorRef.current) params.set('cursor', nextCursorRef.current)
      const response = await fetch(`/conv-api/conversations?${params.toString()}`, {
        cache: 'no-store',
        headers: withTwentyAuthHeaders(),
      })
      if (response.status === 401) {
        setAuthExpired(true)
        notifyTwentyAuthExpired()
        throw new Error('登录状态已失效，请刷新 CRM 后重试')
      }
      if (!response.ok) throw new Error('无法加载邮件')
      const list = (await response.json()).filter(c => c.channel === 'email')
      const nextCursor = response.headers.get('X-Conversation-Next-Cursor') || ''
      const responseHasMore = response.headers.get('X-Conversation-Has-More') === 'true'
      const responseTotalCount = Number(response.headers.get('X-Conversation-Total-Count'))
      nextCursorRef.current = nextCursor
      hasMoreRef.current = responseHasMore
      setHasMore(responseHasMore)
      if (Number.isFinite(responseTotalCount)) setTotalCount(responseTotalCount)
      setEmails(current => {
        const page = list.map(conv => ({ ...conv, messages: current.find(item => item.id === conv.id)?.messages ?? [] }))
        const pageIds = new Set(page.map(conv => conv.id))
        const categoryChanged = loadedCategoryRef.current !== emailCategory
        loadedCategoryRef.current = emailCategory
        if (categoryChanged) return page
        return append ? [...current.filter(conv => !pageIds.has(conv.id)), ...page] : [...page, ...current.filter(conv => !pageIds.has(conv.id))]
      })
      if (!append) setSelectedId(current => current && list.some(conv => conv.id === current) ? current : list[0]?.id || null)
    } finally {
      if (append) { loadingMoreRef.current = false; setLoadingMore(false) }
    }
  }, [authExpired, emailCategory, requireAccessToken])

  const loadMessages = useCallback(async (convId) => {
    if (!convId || authExpired) return
    await requireAccessToken()
    const response = await fetch(`/conv-api/conversations/${convId}/messages?_=${Date.now()}`, {
      cache: 'no-store',
      headers: withTwentyAuthHeaders(),
    })
    if (response.status === 401) {
      setAuthExpired(true)
      notifyTwentyAuthExpired()
      throw new Error('登录状态已失效，请刷新 CRM 后重试')
    }
    if (!response.ok) throw new Error('无法加载邮件正文')
    const messages = (await response.json()).map(m => ({ ...m, sentAt: new Date(m.sentAt) }))
    setEmails(current => current.map(conv => conv.id === convId ? { ...conv, messages } : conv))
  }, [authExpired, requireAccessToken])

  const toggleFlag = useCallback(async (convId, messageId, flagged) => {
    await requireAccessToken()
    const response = await fetch(`/conv-api/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(messageId)}/flag`, {
      method: 'POST', cache: 'no-store',
      headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ flagged }),
    })
    if (response.status === 401) {
      setAuthExpired(true)
      notifyTwentyAuthExpired()
      throw new Error('登录状态已失效，请刷新 CRM 后重试')
    }
    if (!response.ok) throw new Error('重点标记失败')
    const result = await response.json()
    setEmails(current => current.map(conv => conv.id === convId
      ? { ...conv, messages: conv.messages.map(msg => msg.id === messageId ? { ...msg, isFlagged: result.isFlagged } : msg) }
      : conv))
    return result
  }, [authExpired, requireAccessToken])

  useEffect(() => {
    if (authExpired) return undefined
    load().catch(error => console.error(error))
    const timer = setInterval(() => load().catch(() => {}), 15000)
    return () => clearInterval(timer)
  }, [load, authExpired])

  useEffect(() => {
    if (!selectedId || authExpired) return undefined
    loadMessages(selectedId).catch(error => console.error(error))
    const timer = setInterval(() => loadMessages(selectedId).catch(() => {}), 15000)
    return () => clearInterval(timer)
  }, [selectedId, loadMessages, authExpired])

  const filtered = search
    ? emails.filter(c => {
        const q = search.toLowerCase()
        return (c.contact?.name || '').toLowerCase().includes(q)
          || (c.contact?.email || '').toLowerCase().includes(q)
          || (c.lastMessage || '').toLowerCase().includes(q)
      })
    : emails

  const selected = emails.find(c => c.id === selectedId) ?? null

  return { emails, filtered, selected, selectedId, setSelectedId, search, setSearch, emailCategory, setEmailCategory, toggleFlag, reload: load, loadMore: () => load({ append: true }), hasMore, loadingMore, totalCount }
}

import { useState, useEffect, useCallback } from 'react'
import { waitForTwentyAccessToken, withTwentyAuthHeaders } from '../utils/twentyAuth'

// 邮箱视图数据：复用 conv-api，仅取 channel='email' 的会话（只读，无发送/接管）。
export function useEmails() {
  const [emails, setEmails] = useState([]) // 会话（按发件人归集），带 messages
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [authExpired, setAuthExpired] = useState(false)

  const requireAccessToken = useCallback(async () => {
    const token = await waitForTwentyAccessToken()
    if (!token) {
      setAuthExpired(true)
      throw new Error('登录状态已失效，请刷新 CRM 后重试')
    }
    return token
  }, [])

  const load = useCallback(async () => {
    if (authExpired) return
    await requireAccessToken()
    const response = await fetch(`/conv-api/conversations?_=${Date.now()}`, {
      cache: 'no-store',
      headers: withTwentyAuthHeaders(),
    })
    if (response.status === 401) {
      setAuthExpired(true)
      throw new Error('登录状态已失效，请刷新 CRM 后重试')
    }
    if (!response.ok) throw new Error('无法加载邮件')
    const list = (await response.json()).filter(c => c.channel === 'email')
    setEmails(current => list.map(conv => ({
      ...conv,
      messages: current.find(item => item.id === conv.id)?.messages ?? [],
    })))
    setSelectedId(current => {
      if (current && list.some(conv => conv.id === current)) return current
      return list[0]?.id || null
    })
  }, [authExpired, requireAccessToken])

  const loadMessages = useCallback(async (convId) => {
    if (!convId || authExpired) return
    await requireAccessToken()
    const response = await fetch(`/conv-api/conversations/${convId}/messages?_=${Date.now()}`, {
      cache: 'no-store',
      headers: withTwentyAuthHeaders(),
    })
    if (response.status === 401) {
      setAuthExpired(true)
      throw new Error('登录状态已失效，请刷新 CRM 后重试')
    }
    if (!response.ok) throw new Error('无法加载邮件正文')
    const messages = (await response.json()).map(m => ({ ...m, sentAt: new Date(m.sentAt) }))
    setEmails(current => current.map(conv => conv.id === convId ? { ...conv, messages } : conv))
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

  return { emails, filtered, selected, selectedId, setSelectedId, search, setSearch, reload: load }
}

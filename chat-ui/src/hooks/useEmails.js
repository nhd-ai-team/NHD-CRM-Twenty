import { useState, useEffect, useCallback } from 'react'
import { withTwentyAuthHeaders } from '../utils/twentyAuth'

// 邮箱视图数据：复用 conv-api，仅取 channel='email' 的会话（只读，无发送/接管）。
export function useEmails() {
  const [emails, setEmails] = useState([]) // 会话（按发件人归集），带 messages
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const response = await fetch(`/conv-api/conversations?_=${Date.now()}`, {
      cache: 'no-store',
      headers: withTwentyAuthHeaders(),
    })
    if (!response.ok) throw new Error('无法加载邮件')
    const list = (await response.json()).filter(c => c.channel === 'email')
    const withMessages = await Promise.all(list.map(async conv => {
      const messages = await fetch(`/conv-api/conversations/${conv.id}/messages?_=${Date.now()}`, {
        cache: 'no-store',
        headers: withTwentyAuthHeaders(),
      })
        .then(r => r.ok ? r.json() : [])
      return { ...conv, messages: messages.map(m => ({ ...m, sentAt: new Date(m.sentAt) })) }
    }))
    setEmails(withMessages)
    setSelectedId(current => current || withMessages[0]?.id || null)
  }, [])

  useEffect(() => {
    load().catch(error => console.error(error))
    const timer = setInterval(() => load().catch(() => {}), 15000)
    return () => clearInterval(timer)
  }, [load])

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

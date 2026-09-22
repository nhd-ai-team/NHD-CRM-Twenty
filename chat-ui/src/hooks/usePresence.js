import { useCallback, useEffect, useState } from 'react'
import { waitForTwentyAccessToken, withTwentyAuthHeaders, notifyTwentyAuthExpired } from '../utils/twentyAuth'

export function usePresence() {
  const [status, setStatus] = useState('offline')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [members, setMembers] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await waitForTwentyAccessToken()
      if (!token) {
        notifyTwentyAuthExpired()
        throw new Error('登录状态已失效，请刷新 CRM 后重试')
      }
      const response = await fetch('/conv-api/presence', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: withTwentyAuthHeaders({}, token),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 401) notifyTwentyAuthExpired()
      if (!response.ok) throw new Error(data.error || '无法读取接待状态')
      setStatus(data.status === 'online' ? 'online' : 'offline')
      setError('')
    } catch (e) {
      setError(e.message || '无法读取接待状态')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMembers = useCallback(async () => {
    try {
      const token = await waitForTwentyAccessToken()
      if (!token) return
      const response = await fetch('/conv-api/presence/members', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: withTwentyAuthHeaders({}, token),
      })
      if (!response.ok) return
      const data = await response.json().catch(() => ({}))
      setMembers(Array.isArray(data.members) ? data.members : [])
    } catch {
      // 在线状态列表是辅助信息，不阻断当前账号的接待状态。
    }
  }, [])

  useEffect(() => {
    load()
    loadMembers()
    const timer = window.setInterval(loadMembers, 15000)
    return () => window.clearInterval(timer)
  }, [load, loadMembers])

  // 在线状态需要持续更新时间，否则列表里的“最近活跃”只能反映上次手动切换状态的时间。
  useEffect(() => {
    if (status !== 'online') return undefined
    const timer = window.setInterval(async () => {
      try {
        const token = await waitForTwentyAccessToken()
        if (!token) return
        await fetch('/conv-api/presence', {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }, token),
          body: JSON.stringify({ status: 'online' }),
        })
      } catch {
        // 心跳失败不打断当前页面，下一次心跳继续尝试。
      }
    }, 30000)
    return () => window.clearInterval(timer)
  }, [status])

  const setPresenceStatus = useCallback(async (nextStatus) => {
    if (saving || loading) return false
    setSaving(true)
    try {
      const token = await waitForTwentyAccessToken()
      if (!token) {
        notifyTwentyAuthExpired()
        throw new Error('登录状态已失效，请刷新 CRM 后重试')
      }
      const response = await fetch('/conv-api/presence', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }, token),
        body: JSON.stringify({ status: nextStatus }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 401) notifyTwentyAuthExpired()
      if (!response.ok) throw new Error(data.error || '接待状态保存失败')
      setStatus(data.status === 'online' ? 'online' : 'offline')
      setError('')
      return true
    } catch (e) {
      setError(e.message || '接待状态保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }, [loading, saving])

  const toggle = useCallback(() => setPresenceStatus(status === 'online' ? 'offline' : 'online'), [setPresenceStatus, status])

  return { status, loading, saving, error, members, toggle, setPresenceStatus, reload: load, reloadMembers: loadMembers }
}

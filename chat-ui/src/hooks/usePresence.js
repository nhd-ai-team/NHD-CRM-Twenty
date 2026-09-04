import { useCallback, useEffect, useState } from 'react'
import { waitForTwentyAccessToken, withTwentyAuthHeaders } from '../utils/twentyAuth'

export function usePresence() {
  const [status, setStatus] = useState('offline')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await waitForTwentyAccessToken()
      if (!token) throw new Error('登录状态已失效，请刷新 CRM 后重试')
      const response = await fetch('/conv-api/presence', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: withTwentyAuthHeaders({}, token),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '无法读取接待状态')
      setStatus(data.status === 'online' ? 'online' : 'offline')
      setError('')
    } catch (e) {
      setError(e.message || '无法读取接待状态')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const setPresenceStatus = useCallback(async (nextStatus) => {
    if (saving || loading) return false
    setSaving(true)
    try {
      const token = await waitForTwentyAccessToken()
      if (!token) throw new Error('登录状态已失效，请刷新 CRM 后重试')
      const response = await fetch('/conv-api/presence', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }, token),
        body: JSON.stringify({ status: nextStatus }),
      })
      const data = await response.json().catch(() => ({}))
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

  return { status, loading, saving, error, toggle, setPresenceStatus, reload: load }
}

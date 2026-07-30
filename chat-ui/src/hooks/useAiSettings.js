import { useState, useEffect, useCallback } from 'react'

// 渠道级 AI 自动回复开关（工作台齿轮的「生效范围」）
export function useAiSettings() {
  const [settings, setSettings] = useState([]) // [{ channel, enabled }]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/conv-api/ai-settings?_=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('无法加载 AI 配置')
      setSettings(await response.json())
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 乐观更新：先切 UI，失败再回滚
  const toggle = useCallback(async (channel, enabled) => {
    setSettings(prev => prev.map(s => s.channel === channel ? { ...s, enabled } : s))
    try {
      const response = await fetch('/conv-api/ai-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, enabled }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'AI 配置保存失败')
      }
      return true
    } catch (e) {
      setSettings(prev => prev.map(s => s.channel === channel ? { ...s, enabled: !enabled } : s))
      setError(e.message)
      return false
    }
  }, [])

  return { settings, loading, error, reload: load, toggle }
}

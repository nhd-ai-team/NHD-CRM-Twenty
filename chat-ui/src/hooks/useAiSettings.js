import { useState, useEffect, useCallback } from 'react'
import { waitForTwentyAccessToken, withTwentyAuthHeaders } from '../utils/twentyAuth'

// 渠道级 AI 自动回复配置（工作台齿轮的「生效范围」）
export function useAiSettings() {
  const [settings, setSettings] = useState([]) // [{ channel, enabled, scheduleEnabled, scheduleStart, scheduleEnd, timezone, takeoverAiFallbackMinutes }]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      await waitForTwentyAccessToken()
      const response = await fetch(`/conv-api/ai-settings?_=${Date.now()}`, {
        cache: 'no-store',
        headers: withTwentyAuthHeaders(),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || data.detail || '无法加载 AI 配置')
      }
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
  const save = useCallback(async (channel, patch) => {
    const previous = settings.find(s => s.channel === channel)
    if (!previous) return false
    const next = { ...previous, ...patch }
    setSettings(prev => prev.map(s => s.channel === channel ? next : s))
    try {
      const response = await fetch('/conv-api/ai-settings', {
        method: 'PATCH',
        headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          channel,
          enabled: !!next.enabled,
          scheduleEnabled: !!next.scheduleEnabled,
          scheduleStart: next.scheduleStart || null,
          scheduleEnd: next.scheduleEnd || null,
          timezone: next.timezone || 'Asia/Shanghai',
          takeoverAiFallbackMinutes: Number(next.takeoverAiFallbackMinutes) || 1,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'AI 配置保存失败')
      }
      const saved = await response.json()
      setSettings(prev => prev.map(s => s.channel === channel ? { ...next, ...saved } : s))
      setError('')
      return true
    } catch (e) {
      setSettings(prev => prev.map(s => s.channel === channel ? previous : s))
      setError(e.message)
      return false
    }
  }, [settings])

  const saveAll = useCallback(async (items) => {
    const patches = Array.isArray(items) ? items : []
    if (patches.length === 0) return true
    const previous = settings
    const byChannel = new Map(patches.map(item => [item.channel, item]))
    const nextSettings = settings.map(setting => {
      const patch = byChannel.get(setting.channel)
      return patch ? { ...setting, ...patch } : setting
    })
    setSettings(nextSettings)
    try {
      const response = await fetch('/conv-api/ai-settings/batch', {
        method: 'PATCH',
        headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          settings: patches.map(item => ({
            channel: item.channel,
            enabled: !!item.enabled,
            scheduleEnabled: !!item.scheduleEnabled,
            scheduleStart: item.scheduleStart || null,
            scheduleEnd: item.scheduleEnd || null,
            timezone: item.timezone || 'Asia/Shanghai',
            takeoverAiFallbackMinutes: Number(item.takeoverAiFallbackMinutes) || 1,
          })),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'AI 配置保存失败')
      }
      const saved = await response.json()
      const savedByChannel = new Map((saved.settings || []).map(item => [item.channel, item]))
      setSettings(prev => prev.map(setting => savedByChannel.has(setting.channel)
        ? { ...setting, ...savedByChannel.get(setting.channel) }
        : setting))
      setError('')
      return true
    } catch (e) {
      setSettings(previous)
      setError(e.message)
      return false
    }
  }, [settings])

  const toggle = useCallback((channel, enabled) => save(channel, { enabled }), [save])

  return { settings, loading, error, reload: load, save, saveAll, toggle }
}

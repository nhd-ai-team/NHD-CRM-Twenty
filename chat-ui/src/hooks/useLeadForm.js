import { useState, useEffect, useCallback } from 'react'
import { withTwentyAuthHeaders } from '../utils/twentyAuth'
import { buildDraft, applyContactMethodStage } from '../utils/leadDraft'

// 右侧「资料」草稿：编辑就地进行、失焦自动暂存(jsonb)，「转为线索」一键写 Opportunity。
// 渠道工作台与邮箱视图共用同一套逻辑。
export function useLeadForm({ selected, selectedId }) {
  const [draft, setDraft] = useState({})
  const [converting, setConverting] = useState(false)
  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false)
  const [toast, setToast] = useState(null) // { type: 'ok' | 'err', msg }

  // 切换会话时重建草稿（用 selectedId，避免轮询刷新覆盖正在编辑的内容）。
  useEffect(() => { setDraft(buildDraft(selected)) }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const setField = useCallback((k, v) => setDraft((d) => {
    const next = { ...d, [k]: v }
    return (k === 'phone' || k === 'email' || k === 'source') ? applyContactMethodStage(next) : next
  }), [])

  const saveDraft = useCallback(async (next) => {
    if (!selectedId) return
    try {
      await fetch(`/conv-api/conversations/${selectedId}/draft`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
      })
    } catch { /* 暂存失败不打扰用户，下次失焦会重试 */ }
  }, [selectedId])

  const setFields = useCallback((patch, save = false) => {
    setDraft((d) => {
      const next = applyContactMethodStage({ ...d, ...patch })
      if (save) saveDraft(next)
      return next
    })
  }, [saveDraft])

  const requestConvertLead = useCallback(() => {
    if (!selected || converting) return
    setConvertConfirmOpen(true)
  }, [selected, converting])

  const convertLead = useCallback(async () => {
    if (!selected || converting) return
    setConvertConfirmOpen(false)
    setConverting(true)
    try {
      await saveDraft(draft) // 先确保最新草稿落库
      const res = await fetch(`/conv-api/conversations/${selectedId}/convert-to-lead`, {
        method: 'POST', headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(draft),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setToast({ type: 'err', msg: d.error || `转化失败 (${res.status})` }); return }
      const skip = Array.isArray(d.skipped) && d.skipped.length
        ? `（${d.skipped.map((s) => (s === 'phone' ? 'WhatsApp' : s === 'email' ? '邮箱' : s)).join('、')}格式无效已跳过）` : ''
      setToast({ type: 'ok', msg: (d.updated ? '已更新到线索' : '已转为线索并写入线索') + skip })
    } catch (e) {
      setToast({ type: 'err', msg: e.message })
    } finally {
      setConverting(false)
    }
  }, [selected, selectedId, draft, converting, saveDraft])

  return {
    draft, setField, setFields, saveDraft,
    converting, convertConfirmOpen, setConvertConfirmOpen,
    requestConvertLead, convertLead,
    toast, setToast,
  }
}

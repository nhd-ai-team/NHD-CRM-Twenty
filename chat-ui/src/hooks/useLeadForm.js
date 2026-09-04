import { useState, useEffect, useCallback, useRef } from 'react'
import { withTwentyAuthHeaders } from '../utils/twentyAuth'
import { buildDraft, applyContactMethodStage } from '../utils/leadDraft'

// 右侧「资料」草稿：编辑就地进行、失焦自动暂存(jsonb)，「转为线索」一键写 Opportunity。
// 渠道工作台与邮箱视图共用同一套逻辑。
export function useLeadForm({ selected, selectedId, onConverted, onNameChanged }) {
  const [draft, setDraft] = useState({})
  const [converting, setConverting] = useState(false)
  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false)
  const [toast, setToast] = useState(null) // { type: 'ok' | 'err', msg }
  const nameDirtyRef = useRef(false)

  useEffect(() => {
    nameDirtyRef.current = false
  }, [selectedId])

  const crmDraftKey = selected?.crmLeadDraft ? JSON.stringify(selected.crmLeadDraft) : ''

  // 切换会话时重建草稿；已关联 CRM 线索时，CRM 字段变化也同步回右侧表单。
  useEffect(() => { setDraft(buildDraft(selected)) }, [selectedId, crmDraftKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const setField = useCallback((k, v) => setDraft((d) => {
    if (k === 'name') nameDirtyRef.current = true
    const next = { ...d, [k]: v }
    return (k === 'phone' || k === 'email' || k === 'source') ? applyContactMethodStage(next) : next
  }), [])

  const saveDraft = useCallback(async (next) => {
    if (!selectedId) return
    try {
      await fetch(`/conv-api/conversations/${selectedId}/draft`, {
        method: 'PUT', headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(next),
      })
    } catch { /* 暂存失败不打扰用户，下次失焦会重试 */ }
    if (!nameDirtyRef.current || typeof next.name !== 'string' || !onNameChanged) return
    try {
      await onNameChanged(selectedId, next.name.trim())
      nameDirtyRef.current = false
    } catch { /* 姓名同步失败时保留 dirty 状态，后续失焦可重试 */ }
  }, [selectedId, onNameChanged])

  const setFields = useCallback((patch, save = false) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) nameDirtyRef.current = true
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
      if (!res.ok) { setToast({ type: 'err', msg: [d.error, d.detail].filter(Boolean).join('：') || `转化失败 (${res.status})` }); return }
      setToast({ type: 'ok', msg: (d.updated ? '已更新到线索' : '已转为线索并写入线索') })
      onConverted?.()
    } catch (e) {
      setToast({ type: 'err', msg: e.message })
    } finally {
      setConverting(false)
    }
  }, [selected, selectedId, draft, converting, saveDraft, onConverted])

  return {
    draft, setField, setFields, saveDraft,
    converting, convertConfirmOpen, setConvertConfirmOpen,
    requestConvertLead, convertLead,
    toast, setToast,
  }
}

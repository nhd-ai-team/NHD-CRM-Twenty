import { useEffect, useState } from 'react'
import { MessageCircle, X } from 'lucide-react'
import { withTwentyAuthHeaders } from '../utils/twentyAuth'

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.42)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
}

export function NewWhatsAppConversationModal({ open, onClose, onCreated }) {
  const [phone, setPhone] = useState('')
  const [content, setContent] = useState('')
  const [recipient, setRecipient] = useState(null)
  const [checking, setChecking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [requestId, setRequestId] = useState('')

  useEffect(() => {
    if (!open) return
    setPhone('')
    setContent('')
    setRecipient(null)
    setChecking(false)
    setConfirming(false)
    setSending(false)
    setError('')
    setRequestId(crypto.randomUUID())
  }, [open])

  if (!open) return null

  function handlePhoneChange(event) {
    setPhone(event.target.value)
    setRecipient(null)
    setConfirming(false)
    setError('')
  }

  async function checkRecipient() {
    if (!phone.trim()) {
      setError('请先填写 WhatsApp 号码')
      return
    }
    setChecking(true)
    setError('')
    setRecipient(null)
    try {
      const response = await fetch(`/conv-api/conversations/whatsapp/check?phone=${encodeURIComponent(phone)}`, {
        headers: withTwentyAuthHeaders(),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error([data.error, data.detail && typeof data.detail === 'string' ? data.detail : ''].filter(Boolean).join('：') || 'WhatsApp 账号搜索失败')
      setRecipient(data)
      setPhone(data.phone || phone)
    } catch (checkError) {
      setError(checkError.message)
    } finally {
      setChecking(false)
    }
  }

  async function submit() {
    setSending(true)
    setError('')
    try {
      const response = await fetch('/conv-api/conversations/whatsapp', {
        method: 'POST',
        headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ phone, content, idempotencyKey: requestId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error([data.error, data.detail].filter(Boolean).join('：') || '会话创建失败')
      onCreated(data.conversationId).catch((refreshError) => console.error('会话已创建，但列表刷新失败', refreshError))
      onClose()
    } catch (submitError) {
      setError(submitError.message)
      setConfirming(false)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={overlayStyle} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="new-wa-title" style={{
        width: 'min(460px, 100%)', borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--bg-primary)', boxShadow: '0 18px 50px rgba(0,0,0,.24)', overflow: 'hidden',
      }}>
        <div style={{ height: 48, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid var(--border)' }}>
          <MessageCircle size={18} color="var(--green)" />
          <strong id="new-wa-title" style={{ flex: 1, fontSize: 14 }}>新建 WhatsApp 会话</strong>
          <button aria-label="关闭" title="关闭" onClick={onClose} disabled={sending} style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 16, display: 'grid', gap: 14 }}>
          {!confirming ? <>
            <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              WhatsApp 号码
              <div style={{ display: 'flex', gap: 8 }}>
                <input autoFocus value={phone} onChange={handlePhoneChange} disabled={checking || sending} placeholder="包含国家区号，例如 +1 202 555 0147" style={{ flex: 1, minWidth: 0, height: 36, border: '1px solid var(--border)', borderRadius: 6, padding: '0 10px', background: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none' }} />
                <button type="button" onClick={checkRecipient} disabled={checking || sending || !phone.trim()} style={{ height: 36, padding: '0 12px', border: 0, borderRadius: 6, background: checking || !phone.trim() ? 'var(--bg-secondary)' : 'var(--green)', color: checking || !phone.trim() ? 'var(--text-muted)' : '#fff', cursor: checking || !phone.trim() ? 'not-allowed' : 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>{checking ? '搜索中...' : '搜索账号'}</button>
              </div>
            </label>
            {recipient && <div style={{ padding: 10, borderRadius: 6, border: '1px solid rgba(34,197,94,.35)', background: 'rgba(34,197,94,.08)', color: 'var(--text-secondary)', fontSize: 12.5, display: 'grid', gap: 4 }}>
              <strong style={{ color: 'var(--green)', fontSize: 13 }}>已找到 WhatsApp 账号</strong>
              <span>目标号码：<strong style={{ color: 'var(--text-primary)' }}>{recipient.phone}</strong></span>
              {recipient.reused && <span>CRM 已有该号码会话，发送后将复用原会话。</span>}
              {recipient.fromAccount?.phone && <span>发送账号：{recipient.fromAccount.displayName ? `${recipient.fromAccount.displayName} ` : ''}{recipient.fromAccount.phone}</span>}
            </div>}
            <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              首条消息
              <textarea value={content} maxLength={4096} onChange={(event) => setContent(event.target.value)} disabled={!recipient || checking || sending} placeholder={recipient ? '输入发送给客户的第一条消息' : '请先搜索并确认 WhatsApp 账号'} rows={5} style={{ resize: 'vertical', minHeight: 100, border: '1px solid var(--border)', borderRadius: 6, padding: 10, background: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', opacity: recipient ? 1 : .62 }} />
            </label>
          </> : <div style={{ padding: '8px 0', display: 'grid', gap: 10 }}>
            <strong style={{ fontSize: 14 }}>确认主动联系该客户？</strong>
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>消息将通过当前绑定的 WhatsApp 账号发送至 <strong style={{ color: 'var(--text-primary)' }}>{recipient?.phone || phone}</strong>。发送后会话进入人工接管状态。</p>
            {recipient?.reused && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>CRM 已有该号码会话，本次发送会复用原会话。</p>}
            <div style={{ padding: 10, borderRadius: 6, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{content}</div>
          </div>}
          {error && <div role="alert" style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--red-soft)', color: 'var(--red)', fontSize: 12 }}>{error}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <button onClick={() => confirming ? setConfirming(false) : onClose()} disabled={sending} style={{ height: 34, padding: '0 14px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-primary)', color: 'var(--text-secondary)', cursor: 'pointer' }}>{confirming ? '返回修改' : '取消'}</button>
          {!confirming ? <button onClick={() => { setError(''); if (!recipient) return setError('请先搜索并确认 WhatsApp 账号'); if (!content.trim()) return setError('请填写首条消息'); setConfirming(true) }} disabled={checking || sending} style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 6, background: recipient && content.trim() ? 'var(--green)' : 'var(--bg-secondary)', color: recipient && content.trim() ? '#fff' : 'var(--text-muted)', cursor: recipient && content.trim() ? 'pointer' : 'not-allowed', fontWeight: 600 }}>下一步</button>
            : <button onClick={submit} disabled={sending} style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 6, background: 'var(--green)', color: '#fff', cursor: sending ? 'wait' : 'pointer', fontWeight: 600 }}>{sending ? '正在发送...' : '确认并发送'}</button>}
        </div>
      </div>
    </div>
  )
}

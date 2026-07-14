import { useState } from 'react'
import { X, UserPlus, CheckCircle } from 'lucide-react'

export function ConvertToLeadDrawer({ conv, onClose }) {
  const [form, setForm] = useState({
    name: conv?.contact?.name ?? '',
    phone: conv?.contact?.phone ?? '',
    company: conv?.contact?.company ?? '',
    note: '',
  })
  const [submitted, setSubmitted] = useState(false)

  if (!conv) return null

  function handleSubmit(e) {
    e.preventDefault()
    // Phase 3+: POST to middleware which calls Twenty GraphQL createPerson
    console.log('[ConvertToLead] mock submit', form)
    setSubmitted(true)
    setTimeout(onClose, 1400)
  }

  const inputStyle = {
    width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 13,
    border: '1px solid var(--border)', background: 'var(--bg-surface)',
    color: 'var(--text-primary)', outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 50,
        }}
      />
      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 380,
        background: 'var(--bg-primary)', boxShadow: '-4px 0 24px rgba(0,0,0,.18)',
        zIndex: 51, display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserPlus size={16} style={{ color: 'var(--green)' }} />
            <span style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)' }}>转为线索</span>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {submitted ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <CheckCircle size={40} style={{ color: 'var(--green)' }} />
            <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>线索创建成功</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>已自动同步到 Twenty CRM</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>姓名 *</label>
              <input
                required value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>电话</label>
              <input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>公司</label>
              <input
                value={form.company}
                onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>备注</label>
              <textarea
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                rows={4}
                placeholder="在此输入该线索的背景信息..."
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8 }}>
              <button type="button" onClick={onClose} style={{
                flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 13, fontWeight: 500,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}>取消</button>
              <button type="submit" style={{
                flex: 2, padding: '8px 0', borderRadius: 7, fontSize: 13, fontWeight: 600,
                border: 'none', background: 'var(--green)', color: '#fff', cursor: 'pointer',
              }}>创建线索并同步至 CRM</button>
            </div>
          </form>
        )}
      </div>
    </>
  )
}

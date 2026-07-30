import { useState, useRef, useEffect } from 'react'
import { X, UserPlus, CheckCircle, Loader2, Info } from 'lucide-react'
import { withTwentyAuthHeaders } from '../utils/twentyAuth'

// 下拉选项与 Opportunity 的 SELECT 字段选项一一对应（label 显示 / value 入库）。
const SOURCE_OPTIONS = [
  ['官网表单', 'GUAN_WANG_BIAO_DAN'], ['官网客服', 'GUAN_WANG_KE_FU'],
  ['WhatsApp', 'WHATSAPP'], ['ins', 'INS'], ['Facebook', 'FACEBOOK'],
]
const COMPANY_TYPE_OPTIONS = [
  ['中间商', 'ZHONG_JIAN_SHANG'], ['业主', 'YE_ZHU'], ['EPC', 'EPC'], ['技术咨询', 'JI_SHU_ZI_XUN'],
]
const STAGE_OPTIONS = [
  ['线索', 'XIANSUO'], ['有效线索', 'YOUXIAO_XIANSUO'], ['询价', 'XUNJIA'], ['报价', 'BAOJIA'],
  ['审样', 'SHENYANG'], ['谈判', 'TANPAN'], ['已下单', 'YIXIADAN'], ['已付款', 'YIFUKUAN'],
  ['已发货', 'YIFAHUO'], ['已成交', 'YICHENGJIAO'],
]
// 会话渠道 → 客户来源默认值
const SOURCE_BY_CHANNEL = { whatsapp: 'WHATSAPP', website: 'GUAN_WANG_KE_FU', instagram: 'INS', facebook: 'FACEBOOK' }

export function ConvertToLeadDrawer({ conv, onClose }) {
  const [form, setForm] = useState({
    name: conv?.contact?.name ?? '',
    company: '',
    phone: conv?.contact?.phone ?? '',
    email: '',
    country: '',
    source: SOURCE_BY_CHANNEL[conv?.channel] ?? '',
    product: '',
    companyType: '',
    stage: 'XIANSUO',
    note: '',
  })
  const [status, setStatus] = useState('idle') // idle | saving | done | error
  const [error, setError] = useState('')
  const [skipped, setSkipped] = useState([])

  // 防止请求 in-flight 时组件卸载后再 setState。
  // 注意：setup 里必须重置为 true —— StrictMode 会 mount→unmount→remount，
  // 若只在 cleanup 置 false，再挂载后会一直是 false，导致成功回调被跳过。
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  if (!conv) return null

  const saving = status === 'saving'
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const safeClose = () => { if (!saving) onClose() } // 保存中不允许点遮罩关闭

  async function handleSubmit(e) {
    e.preventDefault()
    setStatus('saving'); setError('')
    try {
      const res = await fetch(`/conv-api/conversations/${conv.id}/convert-to-lead`, {
        method: 'POST',
        headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(form),
      })
      const d = await res.json().catch(() => ({}))
      if (!mounted.current) return
      if (res.status === 409 && d.alreadyConverted) { setStatus('error'); setError('该客户已转为线索，无需重复转化'); return }
      if (!res.ok) { setStatus('error'); setError(d.error || `请求失败 (${res.status})`); return }
      setSkipped(Array.isArray(d.skipped) ? d.skipped : [])
      setStatus('done')
      setTimeout(() => { if (mounted.current) onClose() }, 1800)
    } catch (err) {
      if (mounted.current) { setStatus('error'); setError(err.message) }
    }
  }

  return (
    <>
      <div onClick={safeClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 50 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 400, maxWidth: '92vw',
        background: 'var(--bg-primary)', boxShadow: '-4px 0 24px rgba(0,0,0,.18)',
        zIndex: 51, display: 'flex', flexDirection: 'column',
      }}>
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

        {status === 'done' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <CheckCircle size={40} style={{ color: 'var(--green)' }} />
            <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>线索创建成功</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>已写入线索</div>
            {skipped.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                <Info size={12} />{skipped.map((s) => (s === 'phone' ? 'WhatsApp' : s === 'email' ? '邮箱' : s)).join('、')}格式无效，已跳过
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FormField label="姓名"><input value={form.name} onChange={set('name')} style={inputStyle} placeholder="客户姓名" /></FormField>
            <FormField label="公司"><input value={form.company} onChange={set('company')} style={inputStyle} placeholder="公司名称（暂不关联，转入后在线索内维护）" /></FormField>
            <Row>
              <FormField label="WhatsApp"><input value={form.phone} onChange={set('phone')} style={inputStyle} /></FormField>
              <FormField label="邮箱"><input value={form.email} onChange={set('email')} style={inputStyle} placeholder="多个邮箱可用空格/逗号分隔" /></FormField>
            </Row>
            <Row>
              <FormField label="国家"><input value={form.country} onChange={set('country')} style={inputStyle} /></FormField>
              <FormField label="客户来源">
                <select value={form.source} onChange={set('source')} style={inputStyle}>
                  <option value="">—</option>
                  {SOURCE_OPTIONS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </FormField>
            </Row>
            <Row>
              <FormField label="公司类型">
                <select value={form.companyType} onChange={set('companyType')} style={inputStyle}>
                  <option value="">—</option>
                  {COMPANY_TYPE_OPTIONS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </FormField>
              <FormField label="线索阶段">
                <select value={form.stage} onChange={set('stage')} style={inputStyle}>
                  {STAGE_OPTIONS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </FormField>
            </Row>
            <FormField label="客户需求产品"><input value={form.product} onChange={set('product')} style={inputStyle} placeholder="如：隔膜压滤机" /></FormField>
            <FormField label="备注">
              <textarea value={form.note} onChange={set('note')} rows={3} placeholder="线索背景信息…" style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </FormField>

            {status === 'error' && (
              <div style={{ fontSize: 12, color: '#e1262b', background: 'rgba(225,38,43,.08)', padding: '8px 10px', borderRadius: 6 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8 }}>
              <button type="button" onClick={onClose} style={{
                flex: 1, padding: '9px 0', borderRadius: 7, fontSize: 13, fontWeight: 500,
                border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
              }}>取消</button>
              <button type="submit" disabled={status === 'saving'} style={{
                flex: 2, padding: '9px 0', borderRadius: 7, fontSize: 13, fontWeight: 600,
                border: 'none', background: 'var(--green)', color: '#fff',
                cursor: status === 'saving' ? 'default' : 'pointer', opacity: status === 'saving' ? .7 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                {status === 'saving' && <Loader2 size={13} className="spin" />}
                {status === 'saving' ? '写入中…' : '创建线索并写入线索'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  )
}

function FormField({ label, children }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}
function Row({ children }) {
  return <div style={{ display: 'flex', gap: 10 }}>{children}</div>
}

const inputStyle = {
  width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 13,
  border: '1px solid var(--border)', background: 'var(--bg-surface)',
  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
}

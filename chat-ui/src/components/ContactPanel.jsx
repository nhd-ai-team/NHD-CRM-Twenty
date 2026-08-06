import { useEffect, useState } from 'react'
import { Loader2, UserPlus, Trash2 } from 'lucide-react'
import { ChannelIcon } from './ChannelIcon'
import { withTwentyAuthHeaders } from '../utils/twentyAuth'

const TABS = ['资料', '跟进']

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

const inputStyle = {
  width: '100%', padding: '6px 9px', borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
  border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none',
}

function TextField({ label, value, onChange, onBlur, type = 'text', placeholder }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
      <input type={type} value={value ?? ''} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur} style={inputStyle} />
    </div>
  )
}
function CompanyField({ value, selectedId, onChange, onPick, onBlur }) {
  const [options, setOptions] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = String(value || '').trim()
    if (q.length < 2 || selectedId) { setOptions([]); return }
    let active = true
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/conv-api/companies/search?q=${encodeURIComponent(q)}`, {
          headers: withTwentyAuthHeaders(),
        })
        const data = await res.json().catch(() => [])
        if (active) setOptions(Array.isArray(data) ? data : [])
      } catch {
        if (active) setOptions([])
      } finally {
        if (active) setLoading(false)
      }
    }, 220)
    return () => { active = false; clearTimeout(timer) }
  }, [value, selectedId])

  return (
    <div style={{ marginBottom: 10, position: 'relative' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>公司</div>
      <input
        value={value ?? ''}
        placeholder="搜索库内公司；没有则输入新公司名"
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onBlur={() => { setTimeout(() => setOpen(false), 140); onBlur?.() }}
        style={inputStyle}
      />
      <div style={{ fontSize: 10.5, color: selectedId ? 'var(--green)' : 'var(--text-muted)', marginTop: 4 }}>
        {selectedId ? '已选择库内公司' : '未选择库内公司时，更新线索会按名称匹配；仍不存在则新建公司'}
      </div>
      {open && !selectedId && (options.length > 0 || loading) && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 54, zIndex: 20,
          border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-primary)',
          boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden',
        }}>
          {loading && <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>搜索中…</div>}
          {!loading && options.map((company) => (
            <button
              key={company.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(company); setOpen(false) }}
              style={{
                width: '100%', padding: '8px 10px', border: 'none', background: 'transparent',
                textAlign: 'left', cursor: 'pointer', fontSize: 12.5, color: 'var(--text-primary)',
              }}
            >
              {company.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
function SelectField({ label, value, onChange, onBlur, options, allowEmpty = true }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
      <select value={value ?? ''} onChange={(e) => { onChange(e.target.value); onBlur?.() }} style={inputStyle}>
        {allowEmpty && <option value="">—</option>}
        {options.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}
function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ padding: '10px 16px' }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: '2px 0 8px',
        border: 'none', background: 'transparent', cursor: 'pointer',
        color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
      }}>{open ? '▾' : '▸'} {title}</button>
      {open && children}
    </div>
  )
}
function PlaceholderTab({ label }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 8, padding: 24 }}>
      <div style={{ fontSize: 32 }}>🚧</div>
      <div style={{ fontSize: 13, textAlign: 'center' }}>{label}功能即将上线</div>
    </div>
  )
}

function formatFollowUpTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function FollowUpTab({ conv }) {
  const [items, setItems] = useState([])
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canWrite = conv?.permissions?.viewerRole !== 'boss'

  async function load() {
    if (!conv?.id) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/conv-api/follow-ups?subjectType=conversation&subjectId=${encodeURIComponent(conv.id)}&_=${Date.now()}`, {
        cache: 'no-store',
        headers: withTwentyAuthHeaders(),
      })
      const data = await res.json().catch(() => [])
      if (!res.ok) throw new Error(data.error || '无法加载跟进记录')
      setItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message || '无法加载跟进记录')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [conv?.id])

  async function addFollowUp() {
    const text = content.trim()
    if (!text || !conv?.id || saving || !canWrite) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/conv-api/follow-ups', {
        method: 'POST',
        headers: withTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ subjectType: 'conversation', subjectId: conv.id, content: text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '新增跟进记录失败')
      setItems((current) => [data, ...current])
      setContent('')
    } catch (e) {
      setError(e.message || '新增跟进记录失败')
    } finally {
      setSaving(false)
    }
  }

  async function deleteFollowUp(id) {
    if (!id || !canWrite) return
    setError('')
    try {
      const res = await fetch(`/conv-api/follow-ups/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: withTwentyAuthHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '删除跟进记录失败')
      setItems((current) => current.filter((item) => item.id !== id))
    } catch (e) {
      setError(e.message || '删除跟进记录失败')
    }
  }

  return (
    <div style={{ padding: 16 }}>
      {canWrite && (
        <div style={{ marginBottom: 14 }}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="记录本次跟进要点、客户反馈、下一步动作…"
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', minHeight: 92 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>销售只能看到自己创建的跟进记录</span>
            <button
              onClick={addFollowUp}
              disabled={saving || !content.trim()}
              style={{
                padding: '6px 12px', borderRadius: 6, border: 'none',
                background: content.trim() && !saving ? 'var(--accent)' : 'var(--bg-active)',
                color: content.trim() && !saving ? '#fff' : 'var(--text-muted)',
                cursor: content.trim() && !saving ? 'pointer' : 'not-allowed',
                fontSize: 12, fontWeight: 600,
              }}
            >
              {saving ? '保存中' : '新增'}
            </button>
          </div>
        </div>
      )}
      {!canWrite && (
        <div style={{ marginBottom: 12, fontSize: 11, color: 'var(--text-muted)' }}>
          Boss 当前为查看权限，可查看该会话下所有跟进记录。
        </div>
      )}
      {error && <div style={{ color: '#e1262b', fontSize: 12, marginBottom: 10 }}>{error}</div>}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 12 }}>
          <Loader2 size={13} className="spin" /> 加载中…
        </div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>暂无跟进记录</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((item) => (
            <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg-primary)', padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.createdByName || 'CRM 用户'} · {formatFollowUpTime(item.createdAt)}
                </div>
                {canWrite && (
                  <button
                    onClick={() => deleteFollowUp(item.id)}
                    title="删除跟进记录"
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-primary)' }}>{item.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ContactPanel({ conv, open = true, inline = false, draft = {}, onField, onFields, onBlurSave, onConvert, converting }) {
  const [activeTab, setActiveTab] = useState('资料')
  if (!open) return null

  const c = conv ? conv.contact : null
  const converted = c?.filedStatus === 'lead'
  const channelLabel = conv
    ? (conv.channel === 'whatsapp' ? 'WhatsApp' : conv.channel === 'website' ? '官网聊天' : conv.channel)
    : ''

  const panelStyle = inline
    ? { width: 270, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', height: '100%' }
    : { position: 'fixed', top: 0, right: 0, bottom: 0, width: 300, borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', zIndex: 50, boxShadow: '-4px 0 16px rgba(0,0,0,.08)' }

  const f = (k) => (v) => onField(k, v)
  const updateCompany = (value) => {
    if (onFields) onFields({ company: value, companyId: draft.companyId ? '' : draft.companyId })
    else {
      onField('company', value)
      if (draft.companyId) onField('companyId', '')
    }
  }
  const pickCompany = (company) => {
    if (onFields) onFields({ company: company.name, companyId: company.id }, true)
    else {
      onField('company', company.name)
      onField('companyId', company.id)
    }
  }

  return (
    <>
      <div style={panelStyle}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)', flexShrink: 0 }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              flex: 1, textAlign: 'center',
              padding: '10px 4px', fontSize: 12, fontWeight: 500, border: 'none', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap',
              color: activeTab === t ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: activeTab === t ? '2px solid var(--accent)' : '2px solid transparent',
            }}>{t}</button>
          ))}
        </div>

        {activeTab === '跟进' && c ? (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <FollowUpTab conv={conv} />
          </div>
        ) : activeTab !== '资料' ? (
          <PlaceholderTab label={activeTab} />
        ) : !c ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>请先选择一个会话</div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Header: avatar + channel + 转为线索 */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
                  {(c.name || '?').replace(/[^a-zA-Z一-龥]/g, '').slice(0, 2).toUpperCase() || '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><ChannelIcon channel={conv.channel} size={12} />{channelLabel}</span>
                    {converted && <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--green)', background: 'var(--green-soft)', padding: '1px 7px', borderRadius: 20 }}>✓ 已更新</span>}
                  </div>
                </div>
              </div>

              <button onClick={onConvert} disabled={converting} style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '8px 0', borderRadius: 7, fontSize: 13, fontWeight: 600, border: 'none',
                background: 'var(--green)', color: '#fff', cursor: converting ? 'default' : 'pointer', opacity: converting ? 0.7 : 1,
              }}>
                {converting ? <Loader2 size={13} className="spin" /> : <UserPlus size={13} />}
                {converting ? (converted ? '更新中…' : '写入中…') : (converted ? '更新线索' : '转为线索')}
              </button>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
                {converted ? '补填信息后可再次「更新线索」' : '信息随填随存 · 转为线索写入线索'}
              </div>
            </div>

            {/* Editable fields — 对齐 Opportunity，失焦自动暂存 */}
            <Section title="客户信息">
              <TextField label="姓名" value={draft.name} onChange={f('name')} onBlur={onBlurSave} placeholder="客户姓名" />
              <CompanyField value={draft.company} selectedId={draft.companyId} onChange={updateCompany} onPick={pickCompany} onBlur={onBlurSave} />
              <TextField label="WhatsApp" value={draft.phone} onChange={f('phone')} onBlur={onBlurSave} />
              <TextField label="邮箱" value={draft.email} onChange={f('email')} onBlur={onBlurSave} placeholder="多个邮箱可用空格/逗号分隔" />
              <TextField label="国家" value={draft.country} onChange={f('country')} onBlur={onBlurSave} />
            </Section>

            <div style={{ height: 1, background: 'var(--border-soft)', margin: '0 16px' }} />

            <Section title="线索信息">
              <SelectField label="客户来源" value={draft.source} onChange={f('source')} onBlur={onBlurSave} options={SOURCE_OPTIONS} />
              <SelectField label="公司类型" value={draft.companyType} onChange={f('companyType')} onBlur={onBlurSave} options={COMPANY_TYPE_OPTIONS} />
              <SelectField label="线索阶段" value={draft.stage} onChange={f('stage')} onBlur={onBlurSave} options={STAGE_OPTIONS} allowEmpty={false} />
              <TextField label="客户需求产品" value={draft.product} onChange={f('product')} onBlur={onBlurSave} placeholder="如：隔膜压滤机" />
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>备注</div>
                <textarea value={draft.note ?? ''} onChange={(e) => onField('note', e.target.value)} onBlur={onBlurSave} rows={3}
                  placeholder="线索背景信息…" style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </Section>
          </div>
        )}
      </div>
    </>
  )
}

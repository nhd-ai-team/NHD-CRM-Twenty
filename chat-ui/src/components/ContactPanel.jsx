import { useState } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { ChannelIcon } from './ChannelIcon'

const TABS = ['资料', '话术', '智能物料', '翻译']

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

export function ContactPanel({ conv, open = true, onClose, inline = false, draft = {}, onField, onBlurSave, onConvert, converting }) {
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

  return (
    <>
      {!inline && <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,.25)' }} />}
      <div style={panelStyle}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)', overflowX: 'auto', flexShrink: 0 }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              padding: '10px 14px', fontSize: 12, fontWeight: 500, border: 'none', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap',
              color: activeTab === t ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: activeTab === t ? '2px solid var(--accent)' : '2px solid transparent',
            }}>{t}</button>
          ))}
        </div>

        {activeTab !== '资料' ? (
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    <ChannelIcon channel={conv.channel} size={12} />{channelLabel}
                  </div>
                </div>
              </div>

              {converted ? (
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--green)', background: 'var(--green-soft)', padding: '7px 10px', borderRadius: 6, textAlign: 'center' }}>✓ 已转为线索</span>
              ) : (
                <button onClick={onConvert} disabled={converting} style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '8px 0', borderRadius: 7, fontSize: 13, fontWeight: 600, border: 'none',
                  background: 'var(--green)', color: '#fff', cursor: converting ? 'default' : 'pointer', opacity: converting ? 0.7 : 1,
                }}>
                  {converting ? <Loader2 size={13} className="spin" /> : <UserPlus size={13} />}
                  {converting ? '写入中…' : '转为线索'}
                </button>
              )}
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
                信息随填随存 · 转为线索写入商机（Opportunity）
              </div>
            </div>

            {/* Editable fields — 对齐 Opportunity，失焦自动暂存 */}
            <Section title="客户信息">
              <TextField label="姓名" value={draft.name} onChange={f('name')} onBlur={onBlurSave} placeholder="客户姓名" />
              <TextField label="公司" value={draft.company} onChange={f('company')} onBlur={onBlurSave} placeholder="公司名称（关系在商机内维护）" />
              <TextField label="电话" value={draft.phone} onChange={f('phone')} onBlur={onBlurSave} />
              <TextField label="邮箱" type="email" value={draft.email} onChange={f('email')} onBlur={onBlurSave} />
              <TextField label="国家" value={draft.country} onChange={f('country')} onBlur={onBlurSave} />
            </Section>

            <div style={{ height: 1, background: 'var(--border-soft)', margin: '0 16px' }} />

            <Section title="商机信息">
              <SelectField label="客户来源" value={draft.source} onChange={f('source')} onBlur={onBlurSave} options={SOURCE_OPTIONS} />
              <SelectField label="公司类型" value={draft.companyType} onChange={f('companyType')} onBlur={onBlurSave} options={COMPANY_TYPE_OPTIONS} />
              <SelectField label="商机阶段" value={draft.stage} onChange={f('stage')} onBlur={onBlurSave} options={STAGE_OPTIONS} allowEmpty={false} />
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

import { useState } from 'react'
import { ExternalLink, Edit2, MoreHorizontal, ChevronDown, ChevronRight } from 'lucide-react'
import { ChannelIcon } from './ChannelIcon'

const TABS = ['资料', '话术', '智能物料', '翻译']

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, width: '100%',
          padding: '8px 16px', border: 'none', background: 'transparent',
          cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div style={{ padding: '0 16px 8px' }}>{children}</div>}
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? 'var(--text-primary)' : 'var(--text-muted)' }}>
        {value || '—'}
      </div>
    </div>
  )
}

function PlaceholderTab({ label }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-muted)', gap: 8, padding: 24,
    }}>
      <div style={{ fontSize: 32 }}>🚧</div>
      <div style={{ fontSize: 13, textAlign: 'center' }}>{label}功能即将上线</div>
    </div>
  )
}

// ContactPanel renders as a fixed overlay — never takes horizontal layout space.
// Wide viewports (≥900px): shows inline-like on the right edge without backdrop.
// Narrow viewports (<900px): shows with a semi-transparent backdrop; click backdrop to close.
export function ContactPanel({ conv, open = true, onClose }) {
  const [activeTab, setActiveTab] = useState('资料')

  if (!open) return null

  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 900
  const c = conv ? conv.contact : null
  const channelLabel = conv
    ? (conv.channel === 'whatsapp' ? 'WhatsApp' : conv.channel === 'website' ? '官网聊天' : conv.channel)
    : ''

  return (
    <>
      {isNarrow && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 49,
            background: 'rgba(0,0,0,.25)',
          }}
        />
      )}

      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 280,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        display: 'flex', flexDirection: 'column',
        zIndex: 50,
        boxShadow: '-4px 0 16px rgba(0,0,0,.08)',
      }}>
        {/* Tab bar */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-primary)', overflowX: 'auto', flexShrink: 0,
        }}>
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              style={{
                padding: '10px 14px', fontSize: 12, fontWeight: 500,
                border: 'none', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap',
                color: activeTab === t ? 'var(--accent)' : 'var(--text-secondary)',
                borderBottom: activeTab === t ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >{t}</button>
          ))}
        </div>

        {/* Content */}
        {activeTab !== '资料' ? (
          <PlaceholderTab label={activeTab} />
        ) : !c ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            请先选择一个会话
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Contact header */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'var(--accent)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: '#fff', fontSize: 15, fontWeight: 700, flexShrink: 0,
                }}>
                  {c.name.replace(/[^a-zA-Z一-龥]/g, '').slice(0, 2).toUpperCase() || '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </div>
                  {c.company && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{c.company}</div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button style={actionBtn('accent')}>
                  <Edit2 size={11} /> 编辑
                </button>
                {c.twentyPersonId ? (
                  <button
                    onClick={() => window.open(`${window.location.origin}/people/${c.twentyPersonId}`, '_blank')}
                    style={actionBtn('accent')}
                  >
                    <ExternalLink size={11} /> 查看 CRM
                  </button>
                ) : (
                  <button style={actionBtn('green')}>转为线索</button>
                )}
                <button style={{ ...actionBtn('ghost'), marginLeft: 'auto', padding: '4px 8px' }}>
                  <MoreHorizontal size={13} />
                </button>
              </div>
            </div>

            {/* Channel info */}
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 3 }}>渠道类型</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <ChannelIcon channel={conv.channel} size={13} />
                    <span style={{ color: 'var(--accent-text)', fontWeight: 500 }}>{channelLabel}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 3 }}>建档状态</div>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                    background: c.filedStatus === 'unfiled' ? 'var(--tag-unfiled-bg)' : 'var(--tag-customer-bg)',
                    color: c.filedStatus === 'unfiled' ? 'var(--tag-unfiled-text)' : 'var(--tag-customer-text)',
                  }}>
                    {c.filedStatus === 'unfiled' ? '未建档' : c.filedStatus === 'customer' ? '客户' : '线索'}
                  </span>
                </div>
              </div>
            </div>

            {/* Detail sections */}
            <Section title="备注信息">
              <Field label="姓名" value={c.name} />
              <Field label="职位" value={null} />
              <Field label="公司名称" value={c.company} />
              <Field label="电话" value={c.phone} />
              <Field label="国家" value={c.country} />
              <Field label="时区" value={c.timezone} />
            </Section>

            <div style={{ height: 1, background: 'var(--border-soft)', margin: '0 16px' }} />

            <Section title="跟进信息" defaultOpen={false}>
              <Field label="意向等级" value={null} />
              <Field label="感兴趣产品" value={null} />
              <Field label="备注" value={null} />
            </Section>
          </div>
        )}
      </div>
    </>
  )
}

function actionBtn(variant) {
  const base = {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 10px', borderRadius: 5, fontSize: 11.5, fontWeight: 500,
    border: '1px solid var(--border)', cursor: 'pointer',
  }
  if (variant === 'accent') return { ...base, background: 'var(--accent-soft)', color: 'var(--accent-text)', borderColor: 'var(--accent-soft)' }
  if (variant === 'green')  return { ...base, background: 'var(--green-soft)',  color: 'var(--green)',  borderColor: 'var(--green-soft)' }
  return { ...base, background: 'transparent', color: 'var(--text-secondary)' }
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { ConversationSidebar } from './components/ConversationSidebar'
import { ChatPanel } from './components/ChatPanel'
import { ContactPanel } from './components/ContactPanel'
import { useConversations } from './hooks/useConversations'
import { useAiSettings } from './hooks/useAiSettings'
import { AiConfigPopover } from './components/AiConfigPopover'
import { installTwentyAuthMessageListener, withTwentyAuthHeaders } from './utils/twentyAuth'
import { CHANNELS } from './data/mock'
import { ChannelIcon } from './components/ChannelIcon'
import { PanelRightOpen, PanelRightClose, Settings } from 'lucide-react'

// Layout breakpoints (iframe width)
function getLayout(w) {
  if (w >= 700) return 'wide'
  if (w >= 500) return 'medium'
  return 'narrow'
}

const SOURCE_BY_CHANNEL = { whatsapp: 'WHATSAPP', website: 'GUAN_WANG_KE_FU', instagram: 'INS', facebook: 'FACEBOOK' }
const INITIAL_STAGE = 'XIANSUO'
const CONTACT_METHOD_STAGE = 'YOUXIAO_XIANSUO'

function hasContactMethod(draft) {
  return !!String(draft?.phone || '').trim() || !!String(draft?.email || '').trim()
}

function applyContactMethodStage(draft) {
  if (!hasContactMethod(draft)) return draft
  if (draft.stage && draft.stage !== INITIAL_STAGE) return draft
  return { ...draft, stage: CONTACT_METHOD_STAGE }
}

// 用已保存草稿 + 联系人/渠道默认值，组装侧栏表单初值。
function buildDraft(conv) {
  const s = conv?.leadDraft || {}
  return applyContactMethodStage({
    // 姓名不预填系统占位名（如「网站访客 xxx」），留空让销售填真实联系人姓名。
    name: s.name ?? '',
    company: s.company ?? '',
    companyId: s.companyId ?? '',
    phone: s.phone ?? conv?.contact?.phone ?? '',
    email: s.email ?? '',
    country: s.country ?? '',
    source: s.source ?? SOURCE_BY_CHANNEL[conv?.channel] ?? '',
    companyType: s.companyType ?? '',
    stage: s.stage ?? INITIAL_STAGE,
    product: s.product ?? '',
    note: s.note ?? '',
  })
}

function topIconButtonStyle(active = false) {
  return {
    width: 30, height: 30, borderRadius: 6, border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: 'pointer',
  }
}

function ChannelBar({ conversations, activeChannel, setActiveChannel, contactOpen, onToggleContact, aiSettings }) {
  const [aiOpen, setAiOpen] = useState(false)
  const gearRef = useRef(null)
  return (
    <div style={{
      height: 44, flexShrink: 0, display: 'flex', alignItems: 'stretch',
      borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)',
      overflow: 'hidden',
    }}>
      {CHANNELS.map((ch) => {
        const active = activeChannel === ch.id
        const count = ch.id === 'all' ? conversations.length : conversations.filter(c => c.channel === ch.id).length
        return (
          <button
            key={ch.id}
            onClick={() => setActiveChannel(ch.id)}
            style={{
              flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, padding: '0 10px', border: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent', color: active ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 12.5, fontWeight: active ? 700 : 500,
            }}
          >
            {ch.id !== 'all' && <ChannelIcon channel={ch.id} size={14} />}
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.label}</span>
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 700,
              background: active ? 'var(--accent-soft)' : 'var(--bg-active)',
              color: active ? 'var(--accent-text)' : 'var(--text-muted)',
            }}>{count}</span>
          </button>
        )
      })}
      <div style={{
        flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4,
        padding: '0 10px', borderLeft: '1px solid var(--border-soft)', position: 'relative',
      }}>
        <button
          ref={gearRef}
          onClick={() => setAiOpen(o => !o)}
          title="AI配置"
          aria-label="AI配置"
          style={topIconButtonStyle(aiOpen)}
        >
          <Settings size={16} />
        </button>
        {aiOpen && (
          <AiConfigPopover
            anchorRect={gearRef.current?.getBoundingClientRect()}
            settings={aiSettings.settings}
            error={aiSettings.error}
            onToggle={aiSettings.toggle}
            onClose={() => setAiOpen(false)}
          />
        )}
        <button
          onClick={onToggleContact}
          title={contactOpen ? '收起资料表单' : '展开资料表单'}
          aria-label={contactOpen ? '收起资料表单' : '展开资料表单'}
          style={topIconButtonStyle(contactOpen)}
        >
          {contactOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  useEffect(() => installTwentyAuthMessageListener(), [])

  const {
    conversations, filtered, selected, selectedId, selectConversation,
    activeChannel, setActiveChannel,
    activeStatus, setActiveStatus,
    search, setSearch,
    sendMessage, setTakeover, reload: reloadConversations,
  } = useConversations()

  const aiSettings = useAiSettings()
  // 拨动渠道 AI 开关后立即刷新会话列表，令「接管会话」按钮的灰/亮状态即时联动
  const handleAiToggle = useCallback(async (channel, enabled) => {
    const ok = await aiSettings.toggle(channel, enabled)
    if (ok) reloadConversations().catch(() => {})
  }, [aiSettings, reloadConversations])

  const [layout, setLayout] = useState(() => getLayout(window.innerWidth))
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(true)

  // ── 右侧「资料」草稿：编辑就地进行，失焦自动暂存；「转为线索」一键推送 Opportunity ──
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
    return (k === 'phone' || k === 'email') ? applyContactMethodStage(next) : next
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

  useEffect(() => {
    function onResize() {
      const l = getLayout(window.innerWidth)
      setLayout(l)
      if (l !== 'narrow') setSidebarOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const isNarrow = layout === 'narrow'
  const isWide = layout === 'wide'

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
        <ChannelBar
          conversations={conversations}
          activeChannel={activeChannel}
          setActiveChannel={setActiveChannel}
          contactOpen={contactOpen}
          onToggleContact={() => setContactOpen((open) => !open)}
          aiSettings={{ ...aiSettings, toggle: handleAiToggle }}
        />

        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {isNarrow && sidebarOpen && (
            <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 48, background: 'rgba(0,0,0,.3)' }} />
          )}

          <div style={{
            position: isNarrow ? 'fixed' : 'relative', top: isNarrow ? 44 : 0, left: 0, bottom: 0,
            height: isNarrow ? 'calc(100vh - 44px)' : '100%',
            zIndex: isNarrow ? 49 : 'auto',
            transform: isNarrow && !sidebarOpen ? 'translateX(-100%)' : 'translateX(0)',
            transition: 'transform .2s ease', flexShrink: 0, display: 'flex',
          }}>
            <ConversationSidebar
              conversations={filtered}
              selectedId={selectedId}
              onSelect={(id) => { selectConversation(id); if (isNarrow) setSidebarOpen(false) }}
              activeStatus={activeStatus}
              setActiveStatus={setActiveStatus}
              search={search}
              setSearch={setSearch}
            />
          </div>

          <ChatPanel
            conv={selected}
            onSend={sendMessage}
            onTakeover={(action) => setTakeover(selected?.id, action)}
            layout={layout}
            onToggleSidebar={() => setSidebarOpen(o => !o)}
          />
        </div>
      </div>

      <ContactPanel
        conv={selected}
        inline={isWide}
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        draft={draft}
        onField={setField}
        onFields={setFields}
        onBlurSave={() => saveDraft(draft)}
        onConvert={requestConvertLead}
        converting={converting}
      />

      {convertConfirmOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 180, background: 'rgba(0,0,0,.42)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
        }}>
          <div style={{
            width: 'min(420px, 100%)', borderRadius: 8, background: 'var(--bg-primary)',
            border: '1px solid var(--border)', boxShadow: '0 18px 50px rgba(0,0,0,.28)',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 18px 10px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                确认{selected?.contact?.filedStatus === 'lead' ? '更新线索' : '转为线索'}？
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                当前右侧资料会写入线索。请确认客户姓名、公司、WhatsApp、邮箱、国家、客户来源、公司类型、线索阶段、需求产品和备注无误。
              </div>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px 16px',
              borderTop: '1px solid var(--border-soft)',
            }}>
              <button
                onClick={() => setConvertConfirmOpen(false)}
                disabled={converting}
                style={{
                  padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)', cursor: converting ? 'default' : 'pointer',
                  fontSize: 12, fontWeight: 600,
                }}
              >
                取消
              </button>
              <button
                onClick={convertLead}
                disabled={converting}
                style={{
                  padding: '7px 14px', borderRadius: 6, border: 'none',
                  background: 'var(--green)', color: '#fff', cursor: converting ? 'default' : 'pointer',
                  opacity: converting ? 0.7 : 1, fontSize: 12, fontWeight: 700,
                }}
              >
                {converting ? '处理中…' : `确认${selected?.contact?.filedStatus === 'lead' ? '更新' : '写入'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 200, padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          color: '#fff', boxShadow: '0 6px 24px rgba(0,0,0,.2)', maxWidth: '86vw',
          background: toast.type === 'ok' ? 'var(--green, #1f9d5f)' : '#e1262b',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

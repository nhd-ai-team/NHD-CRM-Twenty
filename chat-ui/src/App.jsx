import { useState, useEffect, useCallback } from 'react'
import { ConversationSidebar } from './components/ConversationSidebar'
import { ChatPanel } from './components/ChatPanel'
import { ContactPanel } from './components/ContactPanel'
import { useConversations } from './hooks/useConversations'

// Layout breakpoints (iframe width)
function getLayout(w) {
  if (w >= 700) return 'wide'
  if (w >= 500) return 'medium'
  return 'narrow'
}

const SOURCE_BY_CHANNEL = { whatsapp: 'WHATSAPP', website: 'GUAN_WANG_KE_FU', instagram: 'INS', facebook: 'FACEBOOK' }

// 用已保存草稿 + 联系人/渠道默认值，组装侧栏表单初值。
function buildDraft(conv) {
  const s = conv?.leadDraft || {}
  return {
    // 姓名不预填系统占位名（如「网站访客 xxx」），留空让销售填真实联系人姓名。
    name: s.name ?? '',
    company: s.company ?? '',
    phone: s.phone ?? conv?.contact?.phone ?? '',
    email: s.email ?? '',
    country: s.country ?? '',
    source: s.source ?? SOURCE_BY_CHANNEL[conv?.channel] ?? '',
    companyType: s.companyType ?? '',
    stage: s.stage ?? 'XIANSUO',
    product: s.product ?? '',
    note: s.note ?? '',
  }
}

export default function App() {
  const {
    filtered, selected, selectedId, selectConversation,
    activeChannel, setActiveChannel,
    activeStatus, setActiveStatus,
    search, setSearch,
    sendMessage, setTakeover, closeConversation,
  } = useConversations()

  const [layout, setLayout] = useState(() => getLayout(window.innerWidth))
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)

  // ── 右侧「资料」草稿：编辑就地进行，失焦自动暂存；「转为线索」一键推送 Opportunity ──
  const [draft, setDraft] = useState({})
  const [converting, setConverting] = useState(false)
  const [toast, setToast] = useState(null) // { type: 'ok' | 'err', msg }

  // 切换会话时重建草稿（用 selectedId，避免轮询刷新覆盖正在编辑的内容）。
  useEffect(() => { setDraft(buildDraft(selected)) }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const setField = useCallback((k, v) => setDraft((d) => ({ ...d, [k]: v })), [])

  const saveDraft = useCallback(async (next) => {
    if (!selectedId) return
    try {
      await fetch(`/conv-api/conversations/${selectedId}/draft`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
      })
    } catch { /* 暂存失败不打扰用户，下次失焦会重试 */ }
  }, [selectedId])

  const convertLead = useCallback(async () => {
    if (!selected || converting) return
    if (!draft.name?.trim() && !draft.company?.trim()) { setToast({ type: 'err', msg: '请先填写姓名或公司' }); return }
    setConverting(true)
    try {
      await saveDraft(draft) // 先确保最新草稿落库
      const res = await fetch(`/conv-api/conversations/${selectedId}/convert-to-lead`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      })
      const d = await res.json().catch(() => ({}))
      if (res.status === 409 && d.alreadyConverted) { setToast({ type: 'err', msg: '该客户已转为线索，无需重复转化' }); return }
      if (!res.ok) { setToast({ type: 'err', msg: d.error || `转化失败 (${res.status})` }); return }
      const skip = Array.isArray(d.skipped) && d.skipped.length
        ? `（${d.skipped.map((s) => (s === 'phone' ? '电话' : s === 'email' ? '邮箱' : s)).join('、')}格式无效已跳过）` : ''
      setToast({ type: 'ok', msg: '已转为线索并写入商机' + skip })
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
      {isNarrow && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 48, background: 'rgba(0,0,0,.3)' }} />
      )}

      <div style={{
        position: isNarrow ? 'fixed' : 'relative', top: 0, left: 0, bottom: 0,
        zIndex: isNarrow ? 49 : 'auto',
        transform: isNarrow && !sidebarOpen ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform .2s ease', flexShrink: 0, display: 'flex',
      }}>
        <ConversationSidebar
          conversations={filtered}
          selectedId={selectedId}
          onSelect={(id) => { selectConversation(id); if (isNarrow) setSidebarOpen(false) }}
          activeChannel={activeChannel}
          setActiveChannel={setActiveChannel}
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
        onClose={() => closeConversation(selected?.id)}
        onConvertLead={convertLead}
        converting={converting}
        layout={layout}
        contactOpen={contactOpen}
        onToggleContact={() => setContactOpen(o => !o)}
        onToggleSidebar={() => setSidebarOpen(o => !o)}
      />

      <ContactPanel
        conv={selected}
        inline={isWide}
        open={isWide || contactOpen}
        onClose={() => setContactOpen(false)}
        draft={draft}
        onField={setField}
        onBlurSave={() => saveDraft(draft)}
        onConvert={convertLead}
        converting={converting}
      />

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

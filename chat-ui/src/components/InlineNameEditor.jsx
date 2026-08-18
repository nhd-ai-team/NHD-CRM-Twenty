import { useEffect, useRef, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'

// 需求一：对话名称内联编辑（会话列表卡片 + 聊天顶部共用一套组件）。
// 约定：
//  - 显示名一律来自后端 contact.name，前端不自行拼接「访客 + ID」。
//  - 清空输入框后保存 = 清除人工名，由后端恢复渠道原始名。
//  - 错误提示用绝对定位浮层，避免撑开卡片宽度或让消息区抖动。
const NAME_MAX_LENGTH = 120

function iconButtonStyle(color, disabled) {
  return {
    flexShrink: 0, width: 18, height: 18, padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', background: 'transparent', color,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}

export function InlineNameEditor({
  name,
  nameSource,
  channelName,
  onSave,
  fontSize = 13,
  fontWeight = 600,
  maxWidth,
  canEdit = true,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  // 非编辑态跟随后端最新名称；编辑态保留用户输入（含保存失败的输入）。
  useEffect(() => { if (!editing) setDraft(name || '') }, [name, editing])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  function openEditor(event) {
    event.stopPropagation()
    setDraft(name || '')
    setError('')
    setEditing(true)
  }

  function cancel(event) {
    event?.stopPropagation()
    setSaving(false)
    setError('')
    setDraft(name || '')
    setEditing(false)
  }

  async function submit(event) {
    event?.stopPropagation()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await onSave(draft.trim())
      setEditing(false)
    } catch (err) {
      setError(err?.message || '名称保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    const hint = nameSource === 'manual' && channelName && channelName !== name
      ? `人工命名（渠道原始名：${channelName}）`
      : name || ''
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth }}>
        <span title={hint} style={{
          fontWeight, fontSize, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{name || '未命名'}</span>
        {canEdit && (
          <button onClick={openEditor} title="修改名称" aria-label="修改名称" style={iconButtonStyle('var(--text-muted)', false)}>
            <Pencil size={11} />
          </button>
        )}
      </span>
    )
  }

  return (
    <span
      onClick={event => event.stopPropagation()}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1, maxWidth }}
    >
      <input
        ref={inputRef}
        value={draft}
        autoFocus
        disabled={saving}
        maxLength={NAME_MAX_LENGTH}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') submit(event)
          if (event.key === 'Escape') cancel(event)
        }}
        placeholder={channelName ? `留空恢复：${channelName}` : '留空恢复渠道名称'}
        title="留空保存可恢复渠道原始名称"
        style={{
          flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box', height: 22,
          fontSize, fontWeight, color: 'var(--text-primary)',
          background: 'var(--bg-surface)',
          border: `1px solid ${error ? 'var(--red)' : 'var(--accent)'}`,
          borderRadius: 4, padding: '1px 6px', outline: 'none',
        }}
      />
      <button onClick={submit} disabled={saving} title="保存" aria-label="保存" style={iconButtonStyle('var(--green)', saving)}>
        <Check size={12} />
      </button>
      <button onClick={cancel} disabled={saving} title="取消" aria-label="取消" style={iconButtonStyle('var(--text-muted)', saving)}>
        <X size={12} />
      </button>
      {error && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 3, zIndex: 20,
          maxWidth: 220, fontSize: 10.5, lineHeight: 1.35, whiteSpace: 'normal',
          color: 'var(--red)', background: 'var(--bg-surface)',
          border: '1px solid var(--red)', borderRadius: 4, padding: '3px 6px',
          boxShadow: '0 4px 12px rgba(0,0,0,.14)',
        }}>{error}</div>
      )}
    </span>
  )
}

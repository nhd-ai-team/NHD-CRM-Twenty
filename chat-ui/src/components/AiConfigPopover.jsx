import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CHANNELS } from '../data/mock'
import { ChannelIcon } from './ChannelIcon'

const AI_CHANNELS = CHANNELS.filter(c => c.id !== 'all')

function Toggle({ on, onClick }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      style={{
        width: 34, height: 20, borderRadius: 10, border: 'none', padding: 0, cursor: 'pointer',
        background: on ? 'var(--accent)' : 'var(--bg-active)',
        position: 'relative', flexShrink: 0, transition: 'background .15s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'left .15s',
      }} />
    </button>
  )
}

// 齿轮下方浮层：渠道级 AI 自动回复开关。用 portal + fixed 定位以脱离顶栏的 overflow:hidden。
// anchorRect: 齿轮按钮的 getBoundingClientRect()。onToggle(channel, nextEnabled)
export function AiConfigPopover({ anchorRect, settings, error, onToggle, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const enabledOf = (id) => settings.find(s => s.channel === id)?.enabled ?? false
  const WIDTH = 244
  const top = (anchorRect?.bottom ?? 44) + 6
  // 右对齐到锚点右缘，并夹取避免超出视口
  const right = Math.max(8, window.innerWidth - (anchorRect?.right ?? window.innerWidth))

  return createPortal(
    <>
      {/* 点击遮罩关闭 */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
      <div style={{
        position: 'fixed', top, right, zIndex: 201, width: WIDTH,
        background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8,
        boxShadow: '0 12px 32px rgba(0,0,0,.18)', overflow: 'hidden',
      }}>
        <div style={{ padding: '11px 14px 9px', borderBottom: '1px solid var(--border-soft)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>AI 自动回复</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>选择哪些渠道由 AI 客服自动接待</div>
        </div>
        <div style={{ padding: '4px 0' }}>
          {AI_CHANNELS.map(ch => {
            const on = enabledOf(ch.id)
            return (
              <div key={ch.id} style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px',
              }}>
                <ChannelIcon channel={ch.id} size={15} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-primary)' }}>{ch.label}</span>
                <span style={{ fontSize: 10.5, color: on ? 'var(--accent)' : 'var(--text-muted)' }}>{on ? '开' : '关'}</span>
                <Toggle on={on} onClick={() => onToggle(ch.id, !on)} />
              </div>
            )
          })}
        </div>
        {error && (
          <div style={{ padding: '7px 14px', fontSize: 11, color: '#e1262b', borderTop: '1px solid var(--border-soft)' }}>{error}</div>
        )}
      </div>
    </>,
    document.body,
  )
}

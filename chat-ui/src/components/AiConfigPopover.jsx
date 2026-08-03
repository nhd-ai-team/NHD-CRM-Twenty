import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Clock3, X } from 'lucide-react'
import { CHANNELS } from '../data/mock'
import { ChannelIcon } from './ChannelIcon'

// 官网置顶，其余按原顺序
const AI_CHANNELS = CHANNELS
  .filter(c => c.id !== 'all')
  .sort((a, b) => (a.id === 'website' ? -1 : b.id === 'website' ? 1 : 0))

function Toggle({ on, disabled, onClick }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 38, height: 22, borderRadius: 11, border: 'none', padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? 'var(--accent)' : 'var(--bg-active)',
        position: 'relative', flexShrink: 0, transition: 'background .15s', opacity: disabled ? .6 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'left .15s',
      }} />
    </button>
  )
}

function modeButtonStyle(active) {
  return {
    height: 28, padding: '0 12px', borderRadius: 6, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-soft)' : 'var(--bg-primary)',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer',
  }
}

function timeInputStyle(disabled) {
  return {
    height: 30, width: 104, borderRadius: 6, border: '1px solid var(--border)',
    background: disabled ? 'var(--bg-secondary)' : 'var(--bg-primary)',
    color: 'var(--text-primary)', padding: '0 8px', fontSize: 12,
  }
}

function activeLabel(setting) {
  if (!setting?.enabled) return '已关闭'
  if (setting.scheduleEnabled && !setting.activeNow) return '非生效时间'
  return '生效中'
}

export function AiConfigPopover({ settings, loading, error, onSave, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const settingOf = (id) => settings.find(s => s.channel === id) || {
    channel: id,
    enabled: id === 'website',
    scheduleEnabled: false,
    scheduleStart: '09:00',
    scheduleEnd: '18:00',
    timezone: 'Asia/Shanghai',
  }

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.16)' }} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="AI自动回复配置"
        style={{
          position: 'fixed', top: 62, right: 24, bottom: 24, zIndex: 201,
          width: 'min(680px, calc(100vw - 48px))', display: 'flex', flexDirection: 'column',
          background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 18px 42px rgba(0,0,0,.22)', overflow: 'hidden',
        }}
      >
        <header style={{
          height: 58, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 12,
          borderBottom: '1px solid var(--border-soft)', flexShrink: 0,
        }}>
          <span style={{
            width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center',
            background: 'var(--accent-soft)', color: 'var(--accent)',
          }}>
            <Clock3 size={17} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>AI 自动回复配置</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              配置每个渠道是否允许 AI 客服回复，以及每天的生效时间段
            </div>
          </div>
          <button
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
            style={{
              width: 30, height: 30, borderRadius: 6, border: 'none', background: 'transparent',
              color: 'var(--text-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}
          >
            <X size={17} />
          </button>
        </header>

        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-soft)', fontSize: 11.5, color: 'var(--text-secondary)' }}>
          时间按中国时间 Asia/Shanghai 生效。开始时间晚于结束时间时，系统会按跨天时间段处理，例如 18:00 到 09:00。
        </div>

        <div style={{ overflow: 'auto', padding: '10px 18px 18px' }}>
          {AI_CHANNELS.map(ch => {
            const setting = settingOf(ch.id)
            const scheduleEnabled = !!setting.scheduleEnabled
            const disabled = loading
            const start = setting.scheduleStart || '09:00'
            const end = setting.scheduleEnd || '18:00'
            return (
              <div key={ch.id} style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(150px, 1.1fr) minmax(168px, .9fr) minmax(238px, 1.2fr)',
                alignItems: 'center', gap: 14, minHeight: 74,
                borderBottom: '1px solid var(--border-soft)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <ChannelIcon channel={ch.id} size={18} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{ch.label}</div>
                    <div style={{
                      marginTop: 3, fontSize: 11, color: setting.enabled && (!scheduleEnabled || setting.activeNow) ? 'var(--accent)' : 'var(--text-muted)',
                    }}>
                      {activeLabel(setting)}
                    </div>
                  </div>
                  <div style={{ marginLeft: 'auto' }}>
                    <Toggle
                      on={!!setting.enabled}
                      disabled={disabled}
                      onClick={() => onSave(ch.id, { enabled: !setting.enabled })}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    disabled={disabled}
                    onClick={() => onSave(ch.id, { scheduleEnabled: false, scheduleStart: start, scheduleEnd: end })}
                    style={modeButtonStyle(!scheduleEnabled)}
                  >
                    全天
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() => onSave(ch.id, { scheduleEnabled: true, scheduleStart: start, scheduleEnd: end })}
                    style={modeButtonStyle(scheduleEnabled)}
                  >
                    按时段
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                  <input
                    type="time"
                    value={start}
                    disabled={disabled || !scheduleEnabled}
                    onChange={e => onSave(ch.id, { scheduleEnabled: true, scheduleStart: e.target.value, scheduleEnd: end })}
                    style={timeInputStyle(disabled || !scheduleEnabled)}
                  />
                  <span>至</span>
                  <input
                    type="time"
                    value={end}
                    disabled={disabled || !scheduleEnabled}
                    onChange={e => onSave(ch.id, { scheduleEnabled: true, scheduleStart: start, scheduleEnd: e.target.value })}
                    style={timeInputStyle(disabled || !scheduleEnabled)}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {error && (
          <div style={{
            padding: '10px 18px', fontSize: 12, color: '#e1262b',
            borderTop: '1px solid var(--border-soft)', background: 'rgba(225,38,43,.06)',
          }}>
            {error}
          </div>
        )}
      </section>
    </>,
    document.body,
  )
}

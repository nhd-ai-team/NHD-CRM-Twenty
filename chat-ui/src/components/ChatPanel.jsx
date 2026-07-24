import { useState, useRef, useEffect } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import {
  MoreHorizontal, UserCheck, UserX, XCircle, UserPlus,
  Send, Smile, Paperclip, Image, File, Languages, Mic,
  Settings, Bot, PanelRightOpen, PanelRightClose, Menu,
} from 'lucide-react'
import { ChannelIcon } from './ChannelIcon'

function StatusBadge({ status }) {
  const map = {
    open:     { label: '进行中',   bg: 'var(--green-soft)',   color: 'var(--green)' },
    takeover: { label: '人工接管', bg: 'var(--orange-soft)',  color: 'var(--orange)' },
    closed:   { label: '已关闭',   bg: 'var(--bg-active)',    color: 'var(--text-muted)' },
  }
  const s = map[status] || map.open
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
      background: s.bg, color: s.color,
    }}>{s.label}</span>
  )
}

function MessageBubble({ msg, onAdopt }) {
  // AI 建议（建议模式）：不是已发送消息，是待销售确认的草稿，点击填入输入框
  if (msg.contentType === 'ai_suggestion') return (
    <div style={{ display: 'flex', flexDirection: 'row-reverse', marginBottom: 12 }}>
      <div
        onClick={() => onAdopt?.(msg.content)}
        style={{
          maxWidth: '72%', cursor: 'pointer',
          border: '1px dashed var(--accent)', borderRadius: '12px 2px 12px 12px',
          background: 'var(--accent-soft)', color: 'var(--accent-text)',
          padding: '8px 12px', fontSize: 13, lineHeight: 1.55,
        }}
        title="点击填入输入框，确认后发送"
      >
        <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600, marginBottom: 3 }}>
          🤖 AI 建议 · 点击填入输入框
        </div>
        {msg.content}
      </div>
    </div>
  )

  if (msg.contentType === 'system') return (
    <div style={{ textAlign: 'center', padding: '6px 0' }}>
      <span style={{
        fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-active)',
        padding: '3px 12px', borderRadius: 10,
      }}>{msg.content}</span>
    </div>
  )

  const isCustomer = msg.senderType === 'customer'
  const isAI = msg.senderType === 'ai'
  const timeStr = format(msg.sentAt, 'HH:mm')

  return (
    <div style={{
      display: 'flex', flexDirection: isCustomer ? 'row' : 'row-reverse',
      gap: 8, marginBottom: 12, alignItems: 'flex-end',
    }}>
      <div style={{
        maxWidth: '68%',
        display: 'flex', flexDirection: 'column',
        alignItems: isCustomer ? 'flex-start' : 'flex-end',
      }}>
        {isAI && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>AI 自动回复</span>
        )}
        <div style={{
          padding: '8px 12px', borderRadius: isCustomer ? '2px 12px 12px 12px' : '12px 2px 12px 12px',
          background: isCustomer
            ? 'var(--bg-surface)'
            : isAI ? 'var(--accent-soft)' : 'var(--accent)',
          color: isCustomer
            ? 'var(--text-primary)'
            : isAI ? 'var(--accent-text)' : '#fff',
          border: isCustomer ? '1px solid var(--border)' : 'none',
          fontSize: 13, lineHeight: 1.55,
          boxShadow: 'var(--shadow-sm)',
        }}>
          {msg.contentType === 'image' ? (
            <div style={{ fontSize: 12, color: 'inherit', opacity: .8 }}>📷 图片</div>
          ) : msg.content}
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{timeStr}</span>
      </div>
    </div>
  )
}

function ActionBar({ conv, onTakeover, onClose, onConvertLead }) {
  const isTakeover = conv.status === 'takeover'
  const isClosed = conv.status === 'closed'

  return (
    <div style={{
      display: 'flex', gap: 8, padding: '8px 16px',
      borderTop: '1px solid var(--border-soft)', flexWrap: 'wrap', alignItems: 'center',
    }}>
      {/* Takeover */}
      {!isClosed && !isTakeover && (
        <button onClick={() => onTakeover('takeover')} style={btnStyle('accent')}>
          <UserCheck size={13} /> 接管会话
        </button>
      )}
      {!isClosed && isTakeover && (
        <button onClick={() => onTakeover('release')} style={btnStyle('orange')}>
          <UserX size={13} /> 释放接管
        </button>
      )}

      {/* Close */}
      {!isClosed && (
        <button onClick={onClose} style={btnStyle('ghost')}>
          <XCircle size={13} /> 结束会话
        </button>
      )}

      {/* Convert to lead */}
      <button onClick={onConvertLead} style={btnStyle('green')}>
        <UserPlus size={13} /> 转为线索
      </button>

      {/* AI config placeholder */}
      <button disabled style={{ ...btnStyle('ghost'), opacity: .4, cursor: 'not-allowed', marginLeft: 'auto' }}>
        <Bot size={13} /> AI 回复配置
      </button>
    </div>
  )
}

function btnStyle(variant) {
  const base = {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
    border: '1px solid var(--border)', cursor: 'pointer', whiteSpace: 'nowrap',
    transition: 'all .1s',
  }
  if (variant === 'accent')  return { ...base, background: 'var(--accent-soft)', color: 'var(--accent-text)', borderColor: 'var(--accent-soft)' }
  if (variant === 'orange')  return { ...base, background: 'var(--orange-soft)', color: 'var(--orange)', borderColor: 'var(--orange-soft)' }
  if (variant === 'green')   return { ...base, background: 'var(--green-soft)',  color: 'var(--green)',  borderColor: 'var(--green-soft)' }
  return { ...base, background: 'transparent', color: 'var(--text-secondary)' }
}

export function ChatPanel({ conv, onSend, onTakeover, onClose, onConvertLead, layout, contactOpen, onToggleContact, onToggleSidebar }) {
  const [input, setInput] = useState('')
  const [lang, setLang] = useState('中文')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conv?.messages])

  if (!conv) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 12 }}>
      {layout === 'narrow'
        ? <button onClick={onToggleSidebar} style={{ ...btnStyle('accent'), fontSize: 13, padding: '8px 18px' }}><Menu size={15} /> 选择会话</button>
        : <span>从左侧选择一个会话</span>
      }
    </div>
  )

  function handleSend() {
    const text = input.trim()
    if (!text) return
    onSend(conv.id, text)
    setInput('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-primary)', flexShrink: 0,
      }}>
        <ChannelIcon channel={conv.channel} size={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              {conv.contact.name}
            </span>
            {conv.contact.phone && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{conv.contact.phone}</span>
            )}
            <StatusBadge status={conv.status} />
          </div>
          {conv.contact.company && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{conv.contact.company}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          {/* 窄屏汉堡：唤出会话列表 */}
          {layout === 'narrow' && (
            <button onClick={onToggleSidebar} style={{ padding: '4px 6px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', borderRadius: 4 }}>
              <Menu size={16} />
            </button>
          )}
          <button style={{ ...btnStyle('ghost'), padding: '4px 8px', fontSize: 11 }}>
            <Settings size={12} /> AI 配置
          </button>
          {/* 中等宽度：显示联系人面板切换按钮 */}
          {layout === 'medium' && (
            <button onClick={onToggleContact} title={contactOpen ? '收起联系人信息' : '展开联系人信息'}
              style={{ padding: '4px 6px', border: 'none', background: 'transparent', cursor: 'pointer', color: contactOpen ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 4 }}>
              {contactOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </button>
          )}
          <button
            onClick={onToggleContact}
            title={contactOpen ? '收起联系人信息' : '展开联系人信息'}
            style={{ padding: '4px 6px', border: 'none', background: 'transparent', cursor: 'pointer', color: contactOpen ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 4 }}
          >
            {contactOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
          <button style={{ padding: '4px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column' }}>
        {conv.messages.map((msg, i) => (
          <MessageBubble key={msg.id ?? i} msg={msg} onAdopt={setInput} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-primary)', flexShrink: 0 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='请输入即将发送的内容……  或 输入 "AI" 唤起 AI 工具栏'
          style={{
            width: '100%', minHeight: 80, maxHeight: 160, padding: '12px 16px',
            border: 'none', outline: 'none', resize: 'none',
            background: 'transparent', color: 'var(--text-primary)',
            fontSize: 13, lineHeight: 1.55,
            fontFamily: 'inherit',
          }}
        />
        {/* Toolbar row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '6px 12px 10px', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', gap: 2 }}>
            {[
              [Smile,       '表情'],
              [Paperclip,   '附件'],
              [Image,       '图片'],
              [File,        '文件'],
              [Mic,         '语音'],
            ].map(([Icon, tip]) => (
              <button key={tip} title={tip} style={{
                padding: 6, border: 'none', background: 'transparent', cursor: 'pointer',
                color: 'var(--text-muted)', borderRadius: 4,
                display: 'flex', alignItems: 'center',
              }}>
                <Icon size={15} />
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Language selector */}
            <select
              value={lang}
              onChange={e => setLang(e.target.value)}
              style={{
                fontSize: 11, padding: '3px 6px', borderRadius: 5,
                border: '1px solid var(--border)', background: 'var(--bg-surface)',
                color: 'var(--text-secondary)', cursor: 'pointer', outline: 'none',
              }}
            >
              {['中文','英语','西班牙语','阿拉伯语','法语'].map(l => (
                <option key={l}>{l}</option>
              ))}
            </select>
            {/* Translate placeholder */}
            <button disabled title="AI 翻译（即将上线）" style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 5, fontSize: 11.5, fontWeight: 500,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-muted)', cursor: 'not-allowed', opacity: .5,
            }}>
              <Languages size={13} /> 翻译
            </button>
            {/* Send */}
            <button
              onClick={handleSend}
              disabled={!input.trim() || conv.status === 'closed'}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 16px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                border: 'none', cursor: input.trim() && conv.status !== 'closed' ? 'pointer' : 'not-allowed',
                background: input.trim() && conv.status !== 'closed' ? 'var(--accent)' : 'var(--bg-active)',
                color: input.trim() && conv.status !== 'closed' ? '#fff' : 'var(--text-muted)',
                transition: 'all .15s',
              }}
            >
              <Send size={13} /> 发送
            </button>
          </div>
        </div>
      </div>

      {/* Action bar */}
      <ActionBar conv={conv} onTakeover={onTakeover} onClose={onClose} onConvertLead={onConvertLead} />
    </div>
  )
}

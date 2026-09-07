import { RefreshCw, ShieldAlert } from 'lucide-react'

export function AuthExpiredScreen({ reason = '登录状态已失效，请刷新 CRM 后重试' }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: 'var(--bg-primary)', color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <ShieldAlert size={38} strokeWidth={1.7} color="#d97706" />
        <h1 style={{ margin: '16px 0 8px', fontSize: 18 }}>登录状态已失效</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7 }}>
          {reason || '请刷新 CRM，登录后再继续操作。'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 20, height: 36, padding: '0 16px', border: 0, borderRadius: 6,
            display: 'inline-flex', alignItems: 'center', gap: 7, background: '#16a34a',
            color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          <RefreshCw size={15} /> 刷新并重新登录
        </button>
      </div>
    </div>
  )
}

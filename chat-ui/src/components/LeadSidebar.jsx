import { ContactPanel } from './ContactPanel'

// 右侧资料表单 + 转线索确认弹窗 + toast 的组合，供渠道工作台与邮箱视图共用。
// form: useLeadForm() 的返回值。
export function LeadSidebar({ form, selected, inline = true, open = true, customerNameOptions = [] }) {
  const {
    draft, setField, setFields, saveDraft,
    converting, convertConfirmOpen, setConvertConfirmOpen,
    requestConvertLead, convertLead, duplicateLead, setDuplicateLead, continueDuplicateLead, toast,
  } = form
  const isLead = selected?.contact?.filedStatus === 'lead'

  return (
    <>
      <ContactPanel
        conv={selected}
        inline={inline}
        open={open}
        draft={draft}
        onField={setField}
        onFields={setFields}
        onBlurSave={() => saveDraft(draft)}
        onConvert={requestConvertLead}
        converting={converting}
        customerNameOptions={customerNameOptions}
      />

      {convertConfirmOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 180, background: 'rgba(0,0,0,.42)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
        }}>
          <div style={{
            width: 'min(420px, 100%)', borderRadius: 8, background: 'var(--bg-primary)',
            border: '1px solid var(--border)', boxShadow: '0 18px 50px rgba(0,0,0,.28)', overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 18px 10px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                确认{isLead ? '更新线索' : '转为线索'}？
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
                {converting ? '处理中…' : `确认${isLead ? '更新' : '写入'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateLead && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(0,0,0,.42)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
        }}>
          <div style={{
            width: 'min(500px, 100%)', borderRadius: 8, background: 'var(--bg-primary)',
            border: '1px solid var(--border)', boxShadow: '0 18px 50px rgba(0,0,0,.28)', overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 18px 10px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>发现疑似重复线索</div>
              <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                当前资料与以下已有线索的 WhatsApp、邮箱或官网链接相同。请确认是否仍要继续转化。
              </div>
              <div style={{ marginTop: 12, maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-soft)', borderRadius: 6 }}>
                {(duplicateLead.duplicates || []).map((item) => (
                  <div key={item.id} style={{ padding: '9px 11px', borderBottom: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-secondary)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{item.name || '未命名线索'}</div>
                    <div style={{ marginTop: 3 }}>{item.matchedBy || '身份字段匹配'}{item.leadNo ? ` · ${item.leadNo}` : ''}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px 16px',
              borderTop: '1px solid var(--border-soft)',
            }}>
              <button
                onClick={() => setDuplicateLead(null)}
                disabled={converting}
                style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: converting ? 'default' : 'pointer', fontSize: 12, fontWeight: 600 }}
              >
                取消转化
              </button>
              <button
                onClick={continueDuplicateLead}
                disabled={converting}
                style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--green)', color: '#fff', cursor: converting ? 'default' : 'pointer', opacity: converting ? 0.7 : 1, fontSize: 12, fontWeight: 700 }}
              >
                {converting ? '处理中…' : '仍然转化'}
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
    </>
  )
}

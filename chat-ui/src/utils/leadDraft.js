// 右侧「资料」表单的草稿装配与阶段推断，供渠道工作台与邮箱视图共用。

export const SOURCE_BY_CHANNEL = { whatsapp: 'WHATSAPP', website: 'GUAN_WANG_KE_FU', instagram: 'INS', facebook: 'FACEBOOK', email: '' }
export const INITIAL_STAGE = 'XIANSUO'
export const CONTACT_METHOD_STAGE = 'YOUXIAO_XIANSUO'

export function hasContactMethod(draft) {
  return !!String(draft?.phone || '').trim() || !!String(draft?.email || '').trim()
}

export function applyContactMethodStage(draft) {
  if (!hasContactMethod(draft)) return draft
  if (draft.stage && draft.stage !== INITIAL_STAGE) return draft
  return { ...draft, stage: CONTACT_METHOD_STAGE }
}

// 用已保存草稿 + 联系人/渠道默认值，组装侧栏表单初值。
export function buildDraft(conv) {
  const s = conv?.leadDraft || {}
  return applyContactMethodStage({
    // 姓名不预填系统占位名（如「网站访客 xxx」），留空让销售填真实联系人姓名。
    name: s.name ?? '',
    company: s.company ?? '',
    companyId: s.companyId ?? '',
    phone: s.phone ?? conv?.contact?.phone ?? '',
    // 邮箱渠道用联系人邮箱地址预填，方便直接转线索。
    email: s.email ?? conv?.contact?.email ?? '',
    country: s.country ?? '',
    source: s.source ?? SOURCE_BY_CHANNEL[conv?.channel] ?? '',
    companyType: s.companyType ?? '',
    stage: s.stage ?? INITIAL_STAGE,
    product: s.product ?? '',
    note: s.note ?? '',
  })
}

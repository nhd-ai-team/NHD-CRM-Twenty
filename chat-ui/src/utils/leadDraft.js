// 右侧「资料」表单的草稿装配与阶段推断，供渠道工作台与邮箱视图共用。

export const SOURCE_BY_CHANNEL = { whatsapp: 'WHATSAPP', website: 'GUAN_WANG_KE_FU', instagram: 'INS', facebook: 'FACEBOOK', email: '' }
export const INITIAL_STAGE = 'XIANSUO'
export const CONTACT_METHOD_STAGE = 'YOUXIAO_XIANSUO'
export const STAGE_OPTIONS = [
  ['未处理线索', 'WEI_CHU_LI_XIANSUO'],
  ['线索', 'XIANSUO'],
  ['有效线索', 'YOUXIAO_XIANSUO'],
  ['确认询盘', 'QUE_REN_XUN_PAN'],
  ['询盘转总部', 'XUN_PAN_ZHUAN_ZONGBU'],
  ['总部方案报价', 'ZONGBU_FANG_AN_BAO_JIA'],
  ['技术澄清', 'JI_SHU_CHENG_QING'],
  ['商务澄清', 'SHANG_WU_CHENG_QING'],
  ['已签单付款', 'YI_QIAN_DAN_FU_KUAN'],
  ['已发货', 'YI_FA_HUO'],
]

const LEGACY_STAGE_MAP = {
  XUNJIA: 'QUE_REN_XUN_PAN',
  BAOJIA: 'ZONGBU_FANG_AN_BAO_JIA',
  SHENYANG: 'JI_SHU_CHENG_QING',
  TANPAN: 'SHANG_WU_CHENG_QING',
  YIXIADAN: 'YI_QIAN_DAN_FU_KUAN',
  YIFUKUAN: 'YI_QIAN_DAN_FU_KUAN',
  YICHENGJIAO: 'YI_QIAN_DAN_FU_KUAN',
  YIFAHUO: 'YI_FA_HUO',
}
const VALID_STAGE_VALUES = new Set(STAGE_OPTIONS.map(([, value]) => value))

export function normalizeStage(value, fallback = INITIAL_STAGE) {
  const raw = String(value || '').trim()
  const mapped = LEGACY_STAGE_MAP[raw] || raw
  return VALID_STAGE_VALUES.has(mapped) ? mapped : fallback
}

export function hasContactMethod(draft) {
  return !!String(draft?.phone || '').trim() || !!String(draft?.email || '').trim()
}

export function applyContactMethodStage(draft) {
  const normalized = { ...draft, stage: normalizeStage(draft?.stage, '') }
  if (normalized?.source === 'GUAN_WANG_BIAO_DAN') return { ...normalized, stage: INITIAL_STAGE }
  if (!hasContactMethod(normalized)) return normalized
  if (normalized.stage && normalized.stage !== INITIAL_STAGE) return normalized
  return { ...normalized, stage: CONTACT_METHOD_STAGE }
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
    stage: normalizeStage(s.stage, INITIAL_STAGE),
    product: s.product ?? '',
    note: s.note ?? '',
  })
}

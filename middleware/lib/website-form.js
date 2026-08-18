const crypto = require('crypto');
const EMAIL_SEPARATOR_RE = /[\s,;，；]+/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const VALID_OPPORTUNITY_STAGES = new Set([
  'WEI_CHU_LI_XIANSUO',
  'XIANSUO',
  'YOUXIAO_XIANSUO',
  'QUE_REN_XUN_PAN',
  'XUN_PAN_ZHUAN_ZONGBU',
  'ZONGBU_FANG_AN_BAO_JIA',
  'JI_SHU_CHENG_QING',
  'SHANG_WU_CHENG_QING',
  'YI_QIAN_DAN_FU_KUAN',
  'YI_FA_HUO',
]);

const LEGACY_OPPORTUNITY_STAGE_MAP = {
  XUNJIA: 'QUE_REN_XUN_PAN',
  BAOJIA: 'ZONGBU_FANG_AN_BAO_JIA',
  SHENYANG: 'JI_SHU_CHENG_QING',
  TANPAN: 'SHANG_WU_CHENG_QING',
  YIXIADAN: 'YI_QIAN_DAN_FU_KUAN',
  YIFUKUAN: 'YI_QIAN_DAN_FU_KUAN',
  YICHENGJIAO: 'YI_QIAN_DAN_FU_KUAN',
  YIFAHUO: 'YI_FA_HUO',
};
const SOURCE_MAP = {
  官网表单: 'GUAN_WANG_BIAO_DAN',
  官网留言: 'GUAN_WANG_BIAO_DAN',
  website_form: 'GUAN_WANG_BIAO_DAN',
  form: 'GUAN_WANG_BIAO_DAN',
  GUAN_WANG_BIAO_DAN: 'GUAN_WANG_BIAO_DAN',
  官网客服: 'GUAN_WANG_KE_FU',
  website: 'GUAN_WANG_KE_FU',
  GUAN_WANG_KE_FU: 'GUAN_WANG_KE_FU',
  WHATSAPP: 'WHATSAPP',
  whatsapp: 'WHATSAPP',
  INS: 'INS',
  instagram: 'INS',
  FACEBOOK: 'FACEBOOK',
  facebook: 'FACEBOOK',
};
const CUSTOMER_TYPE_MAP = {
  中间商: 'ZHONG_JIAN_SHANG',
  ZHONG_JIAN_SHANG: 'ZHONG_JIAN_SHANG',
  业主: 'YE_ZHU',
  YE_ZHU: 'YE_ZHU',
  EPC: 'EPC',
  技术咨询: 'JI_SHU_ZI_XUN',
  JI_SHU_ZI_XUN: 'JI_SHU_ZI_XUN',
};

function firstString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeEmailList(value) {
  return String(value || '')
    .split(EMAIL_SEPARATOR_RE)
    .map((item) => item.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''))
    .filter(Boolean);
}

function firstValidEmail(...values) {
  for (const value of values) {
    const found = normalizeEmailList(value).find((item) => EMAIL_RE.test(item));
    if (found) return found;
  }
  return null;
}

function normalizeOpportunityStage(value, fallback = 'XIANSUO') {
  const raw = String(value || '').trim();
  const mapped = LEGACY_OPPORTUNITY_STAGE_MAP[raw] || raw;
  return VALID_OPPORTUNITY_STAGES.has(mapped) ? mapped : fallback;
}

function normalizeSource(value, fallback = 'GUAN_WANG_BIAO_DAN') {
  const raw = String(value || '').trim();
  return SOURCE_MAP[raw] || fallback;
}

function normalizeCustomerType(value) {
  const raw = String(value || '').trim();
  return CUSTOMER_TYPE_MAP[raw] || null;
}

function normalizePhoneInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s()-]+/g, '');
  // 中国大陆手机号：11 位，可带或不带 +86 / 86 前缀。统一转成 E.164（+86139...），
  // 与 Person 创建成功范式一致（Twenty 电话校验不认拆分的 callingCode/countryCode）。
  const chinaMatch = compact.match(/^\+?86(1\d{10})$/);
  if (chinaMatch) {
    return { primaryPhoneNumber: `+86${chinaMatch[1]}` };
  }
  if (/^1\d{10}$/.test(compact)) {
    return { primaryPhoneNumber: `+86${compact}` };
  }
  // 已带 + 的国际号码，原样保留（E.164）。
  if (/^\+\d{5,15}$/.test(compact)) {
    return { primaryPhoneNumber: compact };
  }
  // 不带 + 的国际号码，补 + 前缀。
  if (/^\d{5,15}$/.test(compact)) {
    return { primaryPhoneNumber: `+${compact}` };
  }
  return null;
}

function mapLegacyOpportunityInput(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { data, changed: false };
  const next = { ...data };
  let changed = false;

  const assignIfMissing = (targetKey, value) => {
    if (value === undefined || value === null || value === '') return;
    if (next[targetKey] === undefined || next[targetKey] === null || next[targetKey] === '') {
      next[targetKey] = value;
      changed = true;
    }
  };

  if (next.phone !== undefined && next.whatsapp === undefined) {
    const normalizedPhone = typeof next.phone === 'object'
      ? {
          primaryPhoneNumber: next.phone.primaryPhoneNumber,
          primaryPhoneCallingCode: next.phone.primaryPhoneCallingCode,
          primaryPhoneCountryCode: next.phone.primaryPhoneCountryCode,
        }
      : normalizePhoneInput(next.phone);
    if (normalizedPhone) assignIfMissing('whatsapp', normalizedPhone);
    delete next.phone;
    changed = true;
  }

  if (next.email !== undefined && next.youXiang === undefined) {
    const email = firstValidEmail(next.email);
    if (email) assignIfMissing('youXiang', { primaryEmail: email });
    delete next.email;
    changed = true;
  }

  if (typeof next.youXiang === 'string') {
    const email = firstValidEmail(next.youXiang);
    next.youXiang = email ? { primaryEmail: email } : undefined;
    changed = true;
  }

  if (next.country !== undefined && next.guoJiaDiQu === undefined) {
    const country = typeof next.country === 'object'
      ? {
          addressCountry: next.country.addressCountry,
          addressState: next.country.addressState,
          addressCity: next.country.addressCity,
          addressStreet1: next.country.addressStreet1,
          addressStreet2: next.country.addressStreet2,
          addressPostcode: next.country.addressPostcode,
        }
      : { addressCountry: String(next.country || '').trim() };
    if (country.addressCountry) assignIfMissing('guoJiaDiQu', country);
    delete next.country;
    changed = true;
  }

  if (next.keHuLeiXing !== undefined && next.gongSiLeiXing === undefined) {
    const customerType = normalizeCustomerType(next.keHuLeiXing);
    if (customerType) assignIfMissing('gongSiLeiXing', customerType);
    delete next.keHuLeiXing;
    changed = true;
  }

  if (next.message !== undefined && next.guanWangBeiZhu === undefined) {
    const note = String(next.message || '').trim();
    if (note) assignIfMissing('guanWangBeiZhu', { blocknote: buildBlockNoteDoc(note), markdown: note });
    delete next.message;
    changed = true;
  }

  if (next.note !== undefined && next.guanWangBeiZhu === undefined) {
    const note = String(next.note || '').trim();
    if (note) assignIfMissing('guanWangBeiZhu', { blocknote: buildBlockNoteDoc(note), markdown: note });
    delete next.note;
    changed = true;
  }

  return { data: next, changed };
}

function mapLegacyCreateOpportunityGraphQLPayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { payload, changed: false };
  const query = String(payload.query || '');
  const variables = payload.variables;
  const data = variables && typeof variables === 'object' ? variables.data : null;
  if (!/\bcreateOpportunity\b/.test(query) || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { payload, changed: false };
  }
  const mapped = mapLegacyOpportunityInput(data);
  if (!mapped.changed) return { payload, changed: false };
  return {
    payload: {
      ...payload,
      variables: {
        ...variables,
        data: mapped.data,
      },
    },
    changed: true,
  };
}

// 把一段文本构造成 Twenty RICH_TEXT（BlockNote）字段所需的 blocknote JSON 字符串。
// 真实格式取自 opportunity.zuiXinGenJinBlocknote 列：段落数组，每块含 id/type/props/content/children。
function buildBlockNoteDoc(text) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks = (lines.length ? lines : ['']).map((line) => ({
    id: crypto.randomUUID(),
    type: 'paragraph',
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
    content: [{ type: 'text', text: line, styles: {} }],
    children: [],
  }));
  return JSON.stringify(blocks);
}

function normalizeWebsiteFormPayload(body = {}) {
  const form = body.form && typeof body.form === 'object' ? body.form : body;
  const name = firstString(form.name, form.fullName, form.full_name, form.contactName, form.contact_name, form.customerName, form.customer_name);
  const company = firstString(form.company, form.companyName, form.company_name, form.organization, form.organisation);
  const email = firstValidEmail(form.email, form.mail, form.youXiang, form.youXiangPrimaryEmail);
  const phone = firstString(form.phone, form.mobile, form.tel, form.telephone, form.whatsapp, form.whatsappPrimaryPhoneNumber);
  const normalizedPhone = normalizePhoneInput(phone);
  const country = firstString(form.country, form.region, form.guoJiaDiQu, form.guoJiaDiQuAddressCountry);
  const product = firstString(form.product, form.requirementProduct, form.keHuXuQiuChanPin, form.interestedProduct, form.interested_product);
  const note = firstString(form.message, form.note, form.remark, form.comments, form.content, form.description);
  const websiteUrl = firstString(form.websiteUrl, form.website, form.url, form.pageUrl, form.page_url, form.referrer);
  const websiteLabel = firstString(form.websiteLabel, form.pageTitle, form.page_title, form.sourcePage);
  const companyType = normalizeCustomerType(firstString(form.companyType, form.gongSiLeiXing, form.keHuLeiXing));
  const source = normalizeSource(firstString(form.source, form.keHuLaiYuan));
  const stage = normalizeOpportunityStage(form.stage, 'WEI_CHU_LI_XIANSUO');

  const opportunity = {
    // 标题不再用联系人 name（name 改为建客户联系人 Person，见 index.js createWebsiteFormOpportunity）
    name: company || email || phone || '官网表单线索',
    keHuLaiYuan: source,
    stage,
  };
  if (product) opportunity.keHuXuQiuChanPin = product;
  if (companyType) opportunity.gongSiLeiXing = companyType;
  if (email) opportunity.youXiang = { primaryEmail: email };
  if (normalizedPhone) opportunity.whatsapp = normalizedPhone;
  if (country) opportunity.guoJiaDiQu = { addressCountry: country };
  if (websiteUrl) {
    opportunity.guanWangLianJie = {
      primaryLinkUrl: websiteUrl,
      primaryLinkLabel: websiteLabel || websiteUrl,
    };
  }
  if (note) {
    // 官网表单备注单独存到 guanWangBeiZhu（RICH_TEXT），与线索跟进 zuiXinGenJin 区分；
    // RICH_TEXT 需合法 blocknote JSON 字符串 + markdown，按真实段落数组格式构造。
    opportunity.guanWangBeiZhu = {
      blocknote: buildBlockNoteDoc(note),
      markdown: note,
    };
  }

  return {
    opportunity,
    raw: {
      name,
      company,
      email,
      phone,
      country,
      product,
      note,
      websiteUrl,
      websiteLabel,
      companyType,
      source,
      stage,
    },
  };
}

function isWebsiteFormPayload(body = {}) {
  const type = String(body.type || body.event || body.eventType || body.sourceType || '').toLowerCase();
  if (type.includes('form')) return true;
  const form = body.form && typeof body.form === 'object' ? body.form : body;
  return !!(form.email || form.mail || form.phone || form.mobile || form.tel || form.product || form.requirementProduct || form.keHuXuQiuChanPin);
}

module.exports = {
  firstValidEmail,
  isWebsiteFormPayload,
  mapLegacyCreateOpportunityGraphQLPayload,
  mapLegacyOpportunityInput,
  normalizeEmailList,
  normalizeCustomerType,
  normalizeOpportunityStage,
  normalizePhoneInput,
  normalizeSource,
  normalizeWebsiteFormPayload,
};

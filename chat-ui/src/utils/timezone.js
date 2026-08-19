// 时区友好化：IANA 时区名（Asia/Shanghai）→ UTC±H 缩写（UTC+8）。
// 用 Intl.DateTimeFormat 计算当前偏移，避免硬编码映射表（时区随 DST 变化）。
// 解析失败/无值时返回空串（前端 filter(Boolean) 会自动跳过）。

export function fmtTimezone(tz) {
  if (!tz) return ''
  try {
    const offset = getTimezoneOffsetMinutes(tz)
    if (offset === null) return tz // 解析失败：原样返回，至少不丢信息
    const sign = offset < 0 ? '-' : '+'
    const abs = Math.abs(offset)
    const h = Math.floor(abs / 60)
    const m = abs % 60
    return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`
  } catch (e) {
    return tz
  }
}

// 返回该时区相对 UTC 的分钟偏移（+480 = UTC+8）；解析失败返回 null。
// 算法：取 2000-01-15 12:00 UTC 为锚点（该日无 DST 跳变，北半球冬令时/南半球夏令时），
//       用 formatToParts 得到该时区的本地时刻，local - 720 即分钟偏移。
function getTimezoneOffsetMinutes(tz) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const parts = dtf.formatToParts(new Date(Date.UTC(2000, 0, 15, 12, 0, 0)))
    const map = {}
    for (const p of parts) map[p.type] = Number(p.value)
    if (map.year !== 2000 || Number.isNaN(map.hour) || Number.isNaN(map.minute)) return null
    // 个别实现把午夜渲染成 "24"，归一化到 0
    const hour = map.hour === 24 ? 0 : map.hour
    let offset = (hour * 60 + map.minute) - 720
    if (offset > 720) offset -= 1440
    if (offset < -720) offset += 1440
    return offset
  } catch (e) {
    return null
  }
}

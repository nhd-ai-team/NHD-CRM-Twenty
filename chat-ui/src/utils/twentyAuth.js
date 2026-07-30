function getCookie(name) {
  const prefix = `${name}=`
  return (document.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || ''
}

function getTwentyAccessTokenFromCookie() {
  try {
    const raw = getCookie('tokenPair')
    if (!raw) return ''
    const tokenPair = JSON.parse(decodeURIComponent(raw))
    return tokenPair?.accessToken?.token || ''
  } catch {
    return ''
  }
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(window.atob(normalized))
  } catch {
    return null
  }
}

export function getTwentyAccessToken() {
  const hash = window.location.hash?.replace(/^#/, '') || ''
  const params = new URLSearchParams(hash)
  return params.get('twentyAccessToken') || getTwentyAccessTokenFromCookie()
}

export function withTwentyAuthHeaders(headers = {}) {
  const token = getTwentyAccessToken()
  if (!token) return headers
  const userId = decodeJwtPayload(token)?.sub || ''
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
    'X-Twenty-Access-Token': token,
    ...(userId ? { 'X-Twenty-User-Id': userId } : {}),
  }
}

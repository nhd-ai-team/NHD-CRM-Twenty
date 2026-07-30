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

export function getTwentyAccessToken() {
  const hash = window.location.hash?.replace(/^#/, '') || ''
  const params = new URLSearchParams(hash)
  return params.get('twentyAccessToken') || getTwentyAccessTokenFromCookie()
}

export function withTwentyAuthHeaders(headers = {}) {
  const token = getTwentyAccessToken()
  if (!token) return headers
  return { ...headers, Authorization: `Bearer ${token}` }
}

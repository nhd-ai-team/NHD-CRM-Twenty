function readCookie(sourceWindow, name) {
  try {
    const prefix = `${name}=`
    return (sourceWindow.document.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length) || ''
  } catch {
    return ''
  }
}

function parseTokenFromValue(value) {
  try {
    const raw = decodeURIComponent(String(value || ''))
    if (!raw) return ''
    if (raw.split('.').length === 3) return raw
    const parsed = JSON.parse(raw)
    if (parsed?.accessToken?.token) return parsed.accessToken.token
    if (parsed?.tokenPair?.accessToken?.token) return parsed.tokenPair.accessToken.token
    if (parsed?.token && String(parsed.token).split('.').length === 3) return parsed.token
  } catch {
    if (String(value || '').split('.').length === 3) return String(value)
  }
  return ''
}

function getTwentyAccessTokenFromCookie(sourceWindow = window) {
  return parseTokenFromValue(readCookie(sourceWindow, 'tokenPair'))
}

function isUsableAccessToken(token) {
  const payload = decodeJwtPayload(token)
  if (!payload?.workspaceId) return false
  const now = Math.floor(Date.now() / 1000)
  return typeof payload.exp !== 'number' || payload.exp > now + 30
}

function getTwentyAccessTokenFromStorage(sourceWindow = window) {
  try {
    const stores = [sourceWindow.sessionStorage, sourceWindow.localStorage]
    for (const store of stores) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i)
        const token = parseTokenFromValue(store.getItem(key))
        if (isUsableAccessToken(token)) return token
      }
    }
  } catch {
    return ''
  }
  return ''
}

function getTwentyAccessTokenFromParent() {
  try {
    if (!window.parent || window.parent === window) return ''
    return getTwentyAccessTokenFromCookie(window.parent) || getTwentyAccessTokenFromStorage(window.parent)
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
  const candidates = [
    params.get('twentyAccessToken'),
    sessionStorage.getItem('twentyAccessToken'),
    getTwentyAccessTokenFromCookie(),
    getTwentyAccessTokenFromStorage(),
    getTwentyAccessTokenFromParent(),
  ]
  for (const token of candidates) {
    if (isUsableAccessToken(token)) return token
  }
  return ''
}

export function waitForTwentyAccessToken(timeoutMs = 5000) {
  const token = getTwentyAccessToken()
  if (token) return Promise.resolve(token)

  return new Promise((resolve) => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const nextToken = getTwentyAccessToken()
      if (nextToken || Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer)
        resolve(nextToken || '')
      }
    }, 250)
  })
}

export function withTwentyAuthHeaders(headers = {}) {
  const token = getTwentyAccessToken()
  const baseHeaders = { ...headers, 'X-Chat-Ui-Version': '20260730-auth-2' }
  if (!token) return baseHeaders
  const userId = decodeJwtPayload(token)?.sub || ''
  return {
    ...baseHeaders,
    Authorization: `Bearer ${token}`,
    'X-Twenty-Access-Token': token,
    ...(userId ? { 'X-Twenty-User-Id': userId } : {}),
  }
}

export function installTwentyAuthMessageListener() {
  const onMessage = (event) => {
    if (event.origin !== window.location.origin) return
    if (event.data?.type !== 'twenty-auth-token') return
    const token = parseTokenFromValue(event.data.token)
    if (!isUsableAccessToken(token)) return
    sessionStorage.setItem('twentyAccessToken', token)
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

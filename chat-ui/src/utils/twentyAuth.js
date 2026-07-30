export function getTwentyAccessToken() {
  const hash = window.location.hash?.replace(/^#/, '') || ''
  const params = new URLSearchParams(hash)
  return params.get('twentyAccessToken') || ''
}

export function withTwentyAuthHeaders(headers = {}) {
  const token = getTwentyAccessToken()
  if (!token) return headers
  return { ...headers, Authorization: `Bearer ${token}` }
}

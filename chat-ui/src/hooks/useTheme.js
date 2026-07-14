import { useEffect } from 'react'

// Reads Twenty's theme preference from localStorage and applies it to <html>
// Twenty stores theme under the key 'colorScheme' or similar.
// Falls back to prefers-color-scheme (handled by CSS).
const TWENTY_THEME_KEYS = ['colorScheme', 'twenty-color-scheme', 'theme']

export function useTheme() {
  useEffect(() => {
    function applyTheme() {
      let theme = null
      for (const key of TWENTY_THEME_KEYS) {
        const val = localStorage.getItem(key)
        if (val === 'dark' || val === 'light') { theme = val; break }
      }
      if (theme) {
        document.documentElement.setAttribute('data-theme', theme)
      } else {
        document.documentElement.removeAttribute('data-theme')
      }
    }

    applyTheme()

    // Listen for storage changes (e.g. user toggles theme in Twenty)
    window.addEventListener('storage', applyTheme)
    return () => window.removeEventListener('storage', applyTheme)
  }, [])
}

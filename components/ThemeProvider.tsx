'use client'

import { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

interface ThemeCtx {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeCtx>({ theme: 'dark', toggleTheme: () => {} })

function applyTheme(t: Theme) {
  if (t === 'light') {
    document.documentElement.classList.add('light')
  } else {
    document.documentElement.classList.remove('light')
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const stored = localStorage.getItem('yuzee-theme') as Theme | null
    const t: Theme = stored === 'light' ? 'light' : 'dark'
    applyTheme(t)
    const id = setTimeout(() => setTheme(t), 0)
    return () => clearTimeout(id)
  }, [])

  const toggleTheme = () => {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('yuzee-theme', next)
      applyTheme(next)
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

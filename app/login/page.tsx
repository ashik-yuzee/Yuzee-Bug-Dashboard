'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { loginAction } from '@/app/actions/auth'
import { Bug, User, Lock, AlertCircle, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await loginAction(username, password)
      if (result.error) {
        setError(result.error)
      } else {
        router.push('/dashboard')
        router.refresh()
      }
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px'
    }}>
      {/* Background grid */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        backgroundImage: 'linear-gradient(rgba(48,54,61,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(48,54,61,0.5) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        pointerEvents: 'none'
      }} />

      <div className="fade-in" style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '420px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '10px',
            background: 'var(--surface-1)', border: '1px solid var(--border)',
            borderRadius: '12px', padding: '12px 20px', marginBottom: '20px'
          }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '8px',
              background: 'var(--orange)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Bug size={18} color="#fff" />
            </div>
            <span style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700, fontSize: '18px', color: 'var(--tx-1)'
            }}>
              Yuzee Bug Dashboard
            </span>
          </div>
          <p style={{ color: 'var(--tx-2)', fontSize: '14px' }}>
            Internal monitoring panel — sign in to continue
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--surface-1)', border: '1px solid var(--border)',
          borderRadius: '16px', padding: '32px'
        }}>
          <h1 style={{
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600,
            fontSize: '22px', color: 'var(--tx-1)', marginBottom: '24px'
          }}>
            Sign In
          </h1>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--tx-2)', marginBottom: '6px' }}>
                Username
              </label>
              <div style={{ position: 'relative' }}>
                <User size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--tx-3)', pointerEvents: 'none' }} />
                <input
                  type="text" required value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="admin"
                  style={{
                    width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: '8px', padding: '10px 12px 10px 38px',
                    color: 'var(--tx-1)', fontSize: '14px', outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={e => e.target.style.borderColor = 'var(--orange)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--tx-2)', marginBottom: '6px' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--tx-3)', pointerEvents: 'none' }} />
                <input
                  type="password" required value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{
                    width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: '8px', padding: '10px 12px 10px 38px',
                    color: 'var(--tx-1)', fontSize: '14px', outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={e => e.target.style.borderColor = 'var(--orange)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                />
              </div>
            </div>

            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '8px', padding: '10px 12px',
                color: '#ef4444', fontSize: '13px'
              }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                background: loading ? 'rgba(249,115,22,0.5)' : 'var(--orange)',
                color: '#fff', border: 'none', borderRadius: '8px',
                padding: '11px', fontSize: '14px', fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                transition: 'all 0.2s', marginTop: '4px'
              }}
            >
              {loading ? <><Loader2 size={16} className="spinner" /> Signing in…</> : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

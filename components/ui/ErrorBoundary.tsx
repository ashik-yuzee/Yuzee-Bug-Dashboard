'use client'

import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
  label?: string
}
interface State { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback

    const msg = this.state.error.message || 'An unexpected error occurred.'

    return (
      <div
        role="alert"
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 16, padding: '60px 24px',
          color: 'var(--tx-2)', textAlign: 'center',
        }}
      >
        <AlertTriangle size={36} color="var(--warning)" aria-hidden />
        <div>
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 6 }}>
            {this.props.label || 'Something went wrong'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--tx-2)', maxWidth: 440, lineHeight: 1.6 }}>
            {msg}
          </p>
        </div>
        <button
          onClick={this.reset}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)', padding: '8px 16px',
            fontSize: 13, fontWeight: 500, color: 'var(--tx-1)',
            cursor: 'pointer', transition: 'background .15s',
          }}
        >
          <RefreshCw size={14} aria-hidden /> Try again
        </button>
      </div>
    )
  }
}

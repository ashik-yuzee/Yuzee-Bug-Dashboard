/**
 * Sliding-window rate limiter for Gemini API.
 * Gemini 2.0 Flash Lite free tier: 15 RPM, 1500 RPD.
 * We cap at 12 RPM for a safety margin.
 */

const WINDOW_MS = 60_000
const MAX_RPM = 12

class GeminiRateLimiter {
  private requests: number[] = []
  private dailyCount = 0
  private dailyReset = Date.now() + 86_400_000 // 24h from now
  private readonly maxDaily = 1400  // safely below 1500 RPD

  private prune() {
    const now = Date.now()
    this.requests = this.requests.filter(t => now - t < WINDOW_MS)
    if (now > this.dailyReset) {
      this.dailyCount = 0
      this.dailyReset = now + 86_400_000
    }
  }

  canRequest(): { ok: boolean; waitMs: number; reason?: string } {
    this.prune()
    if (this.dailyCount >= this.maxDaily) {
      return { ok: false, waitMs: this.dailyReset - Date.now(), reason: 'Daily quota reached. Resets in ~24h.' }
    }
    if (this.requests.length >= MAX_RPM) {
      const oldest = this.requests[0]
      const waitMs = WINDOW_MS - (Date.now() - oldest)
      return { ok: false, waitMs, reason: `Rate limit: ${MAX_RPM} requests/min. Wait ${Math.ceil(waitMs / 1000)}s.` }
    }
    return { ok: true, waitMs: 0 }
  }

  record() {
    this.prune()
    this.requests.push(Date.now())
    this.dailyCount++
  }

  remaining(): number {
    this.prune()
    return MAX_RPM - this.requests.length
  }

  dailyRemaining(): number {
    this.prune()
    return this.maxDaily - this.dailyCount
  }
}

// Singleton — safe because this file only runs in browser context
const geminiLimiter = new GeminiRateLimiter()
export default geminiLimiter

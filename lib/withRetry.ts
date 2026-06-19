/**
 * Retry wrapper with exponential backoff.
 * Does NOT retry on 4xx client errors (except 429 which has special handling).
 */

interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void
  signal?: AbortSignal
}

export class RetryAbortedError extends Error {
  constructor() { super('Retries aborted') }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 800, onRetry, signal } = opts
  let lastErr: Error = new Error('Unknown')

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new RetryAbortedError()

    try {
      return await fn()
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))

      // Never retry: auth errors, bad requests, aborts, or final attempt
      const msg = lastErr.message
      const isClientError = msg.includes('400') || msg.includes('401') ||
        msg.includes('403') || msg.includes('404')
      const isAbort = lastErr.name === 'AbortError' || msg.includes('aborted')

      if (isAbort) throw lastErr
      if (isClientError || attempt === maxRetries) throw lastErr

      // 429: Gemini rate limit — back off more aggressively
      const isRateLimit = msg.includes('429') || msg.includes('rate')
      const delay = isRateLimit
        ? 15_000 // hard 15s back-off for 429
        : baseDelayMs * Math.pow(2, attempt) + Math.random() * 300

      onRetry?.(attempt + 1, lastErr, delay)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastErr
}

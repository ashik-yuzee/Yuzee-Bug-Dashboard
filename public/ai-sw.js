// Background AI processing service worker.
// Drains the monitor_anomalies AI analysis backlog every 5 minutes,
// even when the user has navigated to a different browser tab or minimized the window.

const INTERVAL_MS = 5 * 60 * 1000

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

let timerId = null

function scheduleNext() {
  if (timerId) return
  timerId = setInterval(async () => {
    try {
      // POST with empty array — the API drains pending rows from the DB
      await fetch('/api/anomalies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '[]',
      })
    } catch {
      // best-effort; errors are silently ignored
    }
  }, INTERVAL_MS)
}

scheduleNext()

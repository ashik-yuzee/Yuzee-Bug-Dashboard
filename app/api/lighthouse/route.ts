import { NextRequest, NextResponse } from 'next/server'

export interface LighthouseResult {
  url: string
  fetchedAt: string
  scores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null }
  metrics: {
    fcp: number | null       // First Contentful Paint (ms)
    lcp: number | null       // Largest Contentful Paint (ms)
    tbt: number | null       // Total Blocking Time (ms)
    cls: number | null       // Cumulative Layout Shift (unitless)
    tti: number | null       // Time to Interactive (ms)
    speedIndex: number | null
    ttfb: number | null      // Server Response Time (ms)
  }
  opportunities: { id: string; title: string; savingsMs: number }[]
  diagnostics: { id: string; title: string; description: string }[]
}

// GET /api/lighthouse?url=https://...&strategy=mobile|desktop
export async function GET(req: NextRequest) {
  const url      = req.nextUrl.searchParams.get('url')
  const strategy = req.nextUrl.searchParams.get('strategy') ?? 'desktop'
  const apiKey   = process.env.GOOGLE_PAGESPEED_KEY

  if (!url) return NextResponse.json({ error: 'url param required' }, { status: 400 })

  if (!apiKey) {
    return NextResponse.json(
      { error: 'GOOGLE_PAGESPEED_KEY env var not set — add it to .env.local to enable Lighthouse audits' },
      { status: 503 }
    )
  }

  const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`
    + `?url=${encodeURIComponent(url)}&strategy=${strategy}&key=${apiKey}`
    + `&category=performance&category=accessibility&category=best-practices&category=seo`

  try {
    const res = await fetch(psiUrl, { next: { revalidate: 3600 } }) // cache 1 h
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err?.error?.message ?? `PSI API error ${res.status}` }, { status: res.status })
    }
    const data = await res.json()
    const cats = data.lighthouseResult?.categories ?? {}
    const aud  = data.lighthouseResult?.audits ?? {}

    const score = (key: string) => {
      const s = cats[key]?.score
      return s != null ? Math.round(s * 100) : null
    }
    const numVal = (auditId: string): number | null => {
      const v = aud[auditId]?.numericValue
      return v != null ? Math.round(v) : null
    }

    const opportunities = Object.values(aud as Record<string, { id: string; title: string; details?: { type: string; overallSavingsMs?: number }; score: number | null }>)
      .filter(a => a.details?.type === 'opportunity' && (a.details.overallSavingsMs ?? 0) > 50 && a.score !== null && a.score < 0.9)
      .map(a => ({ id: a.id, title: a.title, savingsMs: Math.round(a.details?.overallSavingsMs ?? 0) }))
      .sort((a, b) => b.savingsMs - a.savingsMs)
      .slice(0, 5)

    const diagnosticIds = ['uses-long-cache-ttl','dom-size','bootup-time','mainthread-work-breakdown','render-blocking-resources']
    const diagnostics = diagnosticIds
      .map(id => aud[id])
      .filter(a => a && a.score !== null && a.score < 0.9)
      .map(a => ({ id: a.id, title: a.title, description: a.description ?? '' }))

    const result: LighthouseResult = {
      url,
      fetchedAt: new Date().toISOString(),
      scores: {
        performance:   score('performance'),
        accessibility: score('accessibility'),
        bestPractices: score('best-practices'),
        seo:           score('seo'),
      },
      metrics: {
        fcp:        numVal('first-contentful-paint'),
        lcp:        numVal('largest-contentful-paint'),
        tbt:        numVal('total-blocking-time'),
        cls:        aud['cumulative-layout-shift']?.numericValue != null
                      ? Math.round(aud['cumulative-layout-shift'].numericValue * 1000) / 1000
                      : null,
        tti:        numVal('interactive'),
        speedIndex: numVal('speed-index'),
        ttfb:       numVal('server-response-time'),
      },
      opportunities,
      diagnostics,
    }

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

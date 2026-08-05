import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const cwClient = new CloudWatchLogsClient({
  region: process.env.AWS_REGION ?? 'ap-southeast-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

export async function GET(req: NextRequest) {
  const s          = req.nextUrl.searchParams
  const logGroup   = s.get('logGroup')
  const start      = parseInt(s.get('start') ?? '0', 10)
  const end        = parseInt(s.get('end') ?? '0', 10)
  const filter     = s.get('filter') ?? undefined
  // Optional: if provided, the analysis is written back to monitor_anomalies
  const monitorId  = s.get('monitorId') ?? undefined
  const checkedAt  = s.get('checkedAt') ?? undefined

  if (!logGroup || !start || !end) {
    return NextResponse.json({ error: 'Missing required params: logGroup, start, end' }, { status: 400 })
  }

  try {
    const cmd = new FilterLogEventsCommand({
      logGroupName: logGroup,
      startTime: start,
      endTime: end,
      filterPattern: filter ? `"${filter}"` : undefined,
      limit: 50,
    })
    const result = await cwClient.send(cmd)
    const events = (result.events ?? []).map(e => ({
      timestamp: e.timestamp ?? null,
      message: (e.message ?? '').replace(/\n$/, ''),
    }))

    // AI analysis
    let analysis: string | null = null
    const apiKey = process.env.OPENROUTER_API_KEY
    if (apiKey && events.length > 0) {
      const logText = events.slice(0, 25).map(e => e.message).join('\n').slice(0, 3000)
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://yuzee.com',
            'X-Title': 'Yuzee Bug Monitor',
          },
          body: JSON.stringify({
            model: 'google/gemma-4-26b-a4b-it:free',
            messages: [{
              role: 'user',
              content: [
                'You are a backend reliability engineer. These CloudWatch logs are from the time window around a server anomaly.',
                'Diagnose the root cause in 2-3 sentences. Be specific — name the exact error, service, or line if visible.',
                '',
                'Logs:',
                logText,
                '',
                'Reply with only the diagnosis, no preamble.',
              ].join('\n'),
            }],
            max_tokens: 180,
            temperature: 0.3,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          analysis = data.choices?.[0]?.message?.content?.trim() ?? null
        }
      } catch { /* best-effort */ }
    }

    // Persist analysis to monitor_anomalies if caller supplied the identity keys
    // Only writes if the row doesn't already have an analysis (don't overwrite richer data)
    if (analysis && monitorId && checkedAt) {
      try {
        const cookieStore = await cookies()
        const supabase = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { cookies: { getAll: () => cookieStore.getAll(), setAll: (c) => { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } } }
        )
        await supabase
          .from('monitor_anomalies')
          .update({ ai_analysis: analysis })
          .eq('monitor_id', monitorId)
          .eq('checked_at', checkedAt)
          .is('ai_analysis', null)   // never overwrite an existing analysis
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ events, analysis, logGroup })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'CloudWatch error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

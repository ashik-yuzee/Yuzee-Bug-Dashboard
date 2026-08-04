import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

interface AnomalyPayload {
  monitor_id: string
  monitor_name: string
  monitor_target: string
  checked_at: string
  anomaly_type: 'spike' | 'down' | 'degraded'
  response_time_ms: number | null
  avg_ms: number | null
  spike_ratio: number | null
  error_class: string | null
  error_message: string | null
  status_code: number | null
  cloudwatch_url: string | null
}

function makeSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (c) => { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } } }
  )
}

export async function POST(req: NextRequest) {
  const anomalies: AnomalyPayload[] = await req.json()
  const cookieStore = await cookies()
  const supabase = makeSupabase(cookieStore)

  // 30-day retention cleanup (fire-and-forget)
  supabase.from('monitor_anomalies')
    .delete()
    .lt('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    .then(() => {})

  if (anomalies?.length) {
    // Upsert new detections — skip duplicates (same monitor + checked_at)
    await supabase
      .from('monitor_anomalies')
      .upsert(anomalies, { onConflict: 'monitor_id,checked_at', ignoreDuplicates: true })
  }

  // Analyze ALL pending rows (null ai_analysis, last 30 days) — drains backlog too
  const { data: pending } = await supabase
    .from('monitor_anomalies')
    .select('id, monitor_name, monitor_target, anomaly_type, response_time_ms, avg_ms, spike_ratio, error_class, error_message, status_code')
    .is('ai_analysis', null)
    .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(5)

  let analyzed = 0
  for (const row of (pending ?? [])) {
    const analysis = await analyzeAnomaly(row)
    if (analysis) {
      await supabase.from('monitor_anomalies').update({ ai_analysis: analysis }).eq('id', row.id)
      analyzed++
    }
  }

  return NextResponse.json({ upserted: anomalies?.length ?? 0, analyzed })
}

// GET /api/anomalies?days=30 — read stored anomalies for the Anomalies tab
export async function GET(req: NextRequest) {
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10)
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const cookieStore = await cookies()
  const supabase = makeSupabase(cookieStore)

  const { data, error } = await supabase
    .from('monitor_anomalies')
    .select('*')
    .gte('created_at', since)
    .order('checked_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

async function analyzeAnomaly(anomaly: {
  monitor_name: string; monitor_target: string; anomaly_type: string
  response_time_ms: number | null; avg_ms: number | null; spike_ratio: number | null
  error_class: string | null; error_message: string | null; status_code: number | null
}): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const lines = [
    'You are a backend reliability engineer. Analyze this server monitor anomaly and give a 1-2 sentence technical diagnosis of the most likely cause.',
    '',
    `Monitor: ${anomaly.monitor_name} (${anomaly.monitor_target})`,
    `Type: ${anomaly.anomaly_type}`,
    anomaly.response_time_ms != null
      ? `Response: ${anomaly.response_time_ms}ms (baseline avg: ${anomaly.avg_ms ?? '?'}ms, ${anomaly.spike_ratio?.toFixed(1) ?? '?'}× normal)`
      : '',
    anomaly.status_code != null ? `HTTP status: ${anomaly.status_code}` : '',
    anomaly.error_class        ? `Error class: ${anomaly.error_class}` : '',
    anomaly.error_message      ? `Error message: ${anomaly.error_message}` : '',
    '',
    'Reply with only the diagnosis, no preamble or labels.',
  ].filter(Boolean)

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
        model: 'meta-llama/llama-3.2-3b-instruct:free',
        messages: [{ role: 'user', content: lines.join('\n') }],
        max_tokens: 120,
        temperature: 0.3,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() ?? null
  } catch {
    return null
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

interface AnomalyPayload {
  monitor_id: string
  monitor_name: string
  monitor_target: string
  checked_at: string
  anomaly_type: 'spike' | 'down'
  response_time_ms: number | null
  avg_ms: number | null
  spike_ratio: number | null
  error_class: string | null
  error_message: string | null
  status_code: number | null
  cloudwatch_url: string | null
}

function fingerprint(a: Pick<AnomalyPayload, 'anomaly_type' | 'error_class'>): string {
  return `${a.anomaly_type}:${a.error_class ?? 'none'}`
}

function makeSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (c) => { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } } }
  )
}

export async function POST(req: NextRequest) {
  const incoming: AnomalyPayload[] = await req.json()
  const cookieStore = await cookies()
  const supabase = makeSupabase(cookieStore)

  // 30-day retention cleanup (fire-and-forget)
  supabase.from('monitor_anomalies')
    .delete()
    .lt('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    .then(() => {})

  let upserted = 0

  if (incoming?.length) {
    // Deduplicate incoming by fingerprint (take the most severe per group)
    const byKey = new Map<string, AnomalyPayload>()
    for (const a of incoming) {
      const key = `${a.monitor_id}:${fingerprint(a)}`
      const existing = byKey.get(key)
      // Keep the one with the highest spike_ratio (or any response_time_ms for downs)
      if (!existing || (a.spike_ratio ?? 0) > (existing.spike_ratio ?? 0)) {
        byKey.set(key, a)
      }
    }
    const toProcess = Array.from(byKey.values())

    // Per-fingerprint 30-min cooldown: skip groups updated very recently
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString()
    const fingerprints = toProcess.map(a => fingerprint(a))
    const monitorIds   = [...new Set(toProcess.map(a => a.monitor_id))]

    const { data: recentRows } = await supabase
      .from('monitor_anomalies')
      .select('id, monitor_id, error_fingerprint, occurrence_count, ai_analysis')
      .in('monitor_id', monitorIds)
      .in('error_fingerprint', fingerprints)

    const recentMap = new Map<string, { id: string; occurrence_count: number; ai_analysis: string | null; updatedRecently: boolean }>(
      (recentRows ?? []).map(r => [
        `${r.monitor_id}:${r.error_fingerprint}`,
        {
          id: r.id,
          occurrence_count: r.occurrence_count,
          ai_analysis: r.ai_analysis,
          updatedRecently: false, // we'll check last_seen separately
        },
      ])
    )

    // Check which fingerprints were updated in the last 30 min
    const { data: recentlyUpdated } = await supabase
      .from('monitor_anomalies')
      .select('monitor_id, error_fingerprint')
      .in('monitor_id', monitorIds)
      .gte('last_seen', thirtyMinAgo)

    const cooldownSet = new Set((recentlyUpdated ?? []).map(r => `${r.monitor_id}:${r.error_fingerprint}`))

    const toInsert: typeof toProcess = []
    const toUpdate: Array<{ id: string; checked_at: string; occurrence_count: number; response_time_ms: number | null; spike_ratio: number | null; cloudwatch_url: string | null }> = []

    for (const a of toProcess) {
      const key = `${a.monitor_id}:${fingerprint(a)}`
      if (cooldownSet.has(key)) continue  // updated recently, skip
      const existing = recentMap.get(key)
      if (existing) {
        toUpdate.push({
          id: existing.id,
          checked_at: a.checked_at,
          occurrence_count: existing.occurrence_count + 1,
          response_time_ms: a.response_time_ms,
          spike_ratio: a.spike_ratio,
          cloudwatch_url: a.cloudwatch_url,
        })
      } else {
        toInsert.push(a)
      }
    }

    if (toInsert.length) {
      await supabase.from('monitor_anomalies').insert(
        toInsert.map(a => ({
          monitor_id:       a.monitor_id,
          monitor_name:     a.monitor_name,
          monitor_target:   a.monitor_target,
          error_fingerprint: fingerprint(a),
          anomaly_type:     a.anomaly_type,
          error_class:      a.error_class,
          error_message:    a.error_message,
          status_code:      a.status_code,
          response_time_ms: a.response_time_ms,
          avg_ms:           a.avg_ms,
          spike_ratio:      a.spike_ratio,
          cloudwatch_url:   a.cloudwatch_url,
          checked_at:       a.checked_at,
          first_seen:       a.checked_at,
          last_seen:        a.checked_at,
          occurrence_count: 1,
        }))
      )
      upserted += toInsert.length
    }

    for (const u of toUpdate) {
      await supabase.from('monitor_anomalies').update({
        occurrence_count: u.occurrence_count,
        last_seen:        u.checked_at,
        checked_at:       u.checked_at,
        response_time_ms: u.response_time_ms,
        spike_ratio:      u.spike_ratio,
        cloudwatch_url:   u.cloudwatch_url ?? undefined,
      }).eq('id', u.id)
      upserted++
    }
  }

  // AI analysis: only for rows that have no analysis yet AND have enough signal
  const { data: pending } = await supabase
    .from('monitor_anomalies')
    .select('id, monitor_name, monitor_target, anomaly_type, response_time_ms, avg_ms, spike_ratio, error_class, error_message, status_code, occurrence_count, first_seen, last_seen')
    .is('ai_analysis', null)
    .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    .order('occurrence_count', { ascending: false }) // analyze high-frequency anomalies first
    .limit(10) // tight limit — free tier burns fast

  // Skip spikes with no error signal — AI cannot diagnose them without CloudWatch data
  const analyzable = (pending ?? []).filter(row =>
    row.anomaly_type === 'down' || row.error_class !== null
  )

  let analyzed = 0
  let tokensUsed = 0
  let rateLimitResetMs: number | null = null

  for (const row of analyzable) {
    const result = await analyzeAnomaly(row)
    if (result && 'rateLimited' in result) { rateLimitResetMs = result.resetMs; break }
    if (result && 'text' in result) {
      await supabase.from('monitor_anomalies').update({ ai_analysis: result.text }).eq('id', row.id)
      analyzed++
      tokensUsed += result.tokens
    }
  }

  return NextResponse.json({ upserted, analyzed, tokensUsed, rateLimitResetMs })
}

// GET /api/anomalies?days=30
export async function GET(req: NextRequest) {
  const days  = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10)
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const cookieStore = await cookies()
  const supabase = makeSupabase(cookieStore)

  const { data, error } = await supabase
    .from('monitor_anomalies')
    .select('*')
    .gte('last_seen', since)
    .order('last_seen', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

async function analyzeAnomaly(anomaly: {
  monitor_name: string; monitor_target: string; anomaly_type: string
  response_time_ms: number | null; avg_ms: number | null; spike_ratio: number | null
  error_class: string | null; error_message: string | null; status_code: number | null
  occurrence_count: number; first_seen: string; last_seen: string
}): Promise<{ text: string; tokens: number } | { rateLimited: true; resetMs: number } | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const duration = anomaly.first_seen !== anomaly.last_seen
    ? ` (recurring: first seen ${new Date(anomaly.first_seen).toISOString().slice(0, 16)}Z, last seen ${new Date(anomaly.last_seen).toISOString().slice(0, 16)}Z, ${anomaly.occurrence_count} occurrences)`
    : ` (first seen ${new Date(anomaly.first_seen).toISOString().slice(0, 16)}Z, ${anomaly.occurrence_count} occurrence)`

  const lines = [
    'You are a backend reliability engineer reviewing a server monitoring alert.',
    'Give a concise 1-2 sentence technical diagnosis of the most likely root cause.',
    'Base your answer strictly on the data provided. If the data is insufficient to identify a specific cause, reply: "Insufficient data — check CloudWatch logs for this time window to diagnose."',
    'Do not speculate about causes not supported by the data. Do not add preamble, labels, or explanations.',
    '',
    `Monitor: ${anomaly.monitor_name} (${anomaly.monitor_target})`,
    `Alert type: ${anomaly.anomaly_type}${duration}`,
    anomaly.response_time_ms != null
      ? `Response: ${anomaly.response_time_ms}ms (normal avg: ${anomaly.avg_ms ?? '?'}ms${anomaly.spike_ratio != null ? `, ${anomaly.spike_ratio.toFixed(1)}× slower` : ''})`
      : 'Response: no response (connection failed)',
    anomaly.status_code  != null ? `HTTP status: ${anomaly.status_code}` : '',
    anomaly.error_class  ? `Error class: ${anomaly.error_class}` : '',
    anomaly.error_message ? `Error message: ${anomaly.error_message.slice(0, 200)}` : '',
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
        model: 'google/gemma-4-26b-a4b-it:free',
        messages: [{ role: 'user', content: lines.join('\n') }],
        max_tokens: 100,
        temperature: 0.2,
      }),
    })
    if (res.status === 429) {
      const resetMs = parseInt(res.headers.get('X-RateLimit-Reset') ?? '0', 10) || null
      return { rateLimited: true, resetMs: resetMs ?? 0 }
    }
    if (!res.ok) return null
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim() ?? null
    if (!text) return null
    const prompt    = lines.join('\n')
    const estimated = Math.ceil(prompt.length / 4) + Math.ceil(text.length / 4)
    return { text, tokens: data.usage?.total_tokens || estimated }
  } catch {
    return null
  }
}

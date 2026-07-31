import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { checkAuth as checkApiAuth } from '@/lib/apiAuth'

// PATCH /api/requeue-bug?id=<queue_row_id>  — re-queue single item
// PATCH /api/requeue-bug?all=true            — re-queue all stuck items (queued > 30 min)
export async function PATCH(request: NextRequest) {
  const authError = await checkApiAuth()
  if (authError) return authError

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (c) => { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } } }
  )

  const { searchParams } = new URL(request.url)
  const id  = searchParams.get('id')
  const all = searchParams.get('all') === 'true'

  try {
    // Reset processed_at to epoch zero so n8n's "processed_at < now() - 5min" filter
    // always matches immediately, even if the row had a future backoff timestamp.
    const EPOCH_ZERO = '1970-01-01T00:00:00.000Z'

    if (all) {
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60_000).toISOString()
      const { data, error } = await supabase
        .from('gemini_queue')
        .update({ status: 'queued', processed_at: EPOCH_ZERO })
        .in('status', ['queued', 'processing'])   // also recover stuck-in-processing rows
        .lt('created_at', thirtyMinsAgo)
        .select('id')
      if (error) throw error
      return NextResponse.json({ requeued: data?.length ?? 0 })
    }

    if (id) {
      const { data, error } = await supabase
        .from('gemini_queue')
        .update({ status: 'queued', processed_at: EPOCH_ZERO })
        .eq('id', id)
        .select('id')
      if (error) throw error
      return NextResponse.json({ requeued: data?.length ?? 0 })
    }

    return NextResponse.json({ error: 'Provide ?id=<id> or ?all=true' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

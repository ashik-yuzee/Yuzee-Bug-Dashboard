import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import DashboardClient from '@/components/DashboardClient'

export const dynamic = 'force-dynamic'

type Tab = 'overview' | 'bugs' | 'clusters' | 'pipeline' | 'triage' | 'feedback' | 'developer' | 'reports' | 'daily' | 'tickets' | 'posthog' | 'server-health' | 'guide'
const VALID_TABS: Tab[] = ['overview','bugs','clusters','pipeline','triage','feedback','developer','reports','daily','tickets','posthog','server-health','guide']

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const isAuthenticated = cookieStore.get('auth_session')?.value === 'authenticated'
  if (!isAuthenticated) redirect('/login')

  const rawTab = cookieStore.get('yuzee_active_tab')?.value as Tab | undefined
  const initialTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : undefined

  const supabase = await createClient()
  const { data: bugs, error } = await supabase
    .from('bug_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1500)

  if (error) console.error('[dashboard] initial fetch failed:', error.message)

  return <DashboardClient user={{ email: 'admin' }} initialBugs={bugs || []} initialTab={initialTab} />
}

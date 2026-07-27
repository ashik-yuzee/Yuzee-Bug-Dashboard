import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import DashboardClient from '@/components/DashboardClient'

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const isAuthenticated = cookieStore.get('auth_session')?.value === 'authenticated'
  if (!isAuthenticated) redirect('/login')

  const supabase = await createClient()
  const { data: bugs, error } = await supabase
    .from('bug_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1500)

  if (error) console.error('[dashboard] initial fetch failed:', error.message)

  return <DashboardClient user={{ email: 'admin' }} initialBugs={bugs || []} />
}

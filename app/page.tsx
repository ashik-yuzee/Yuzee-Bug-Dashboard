import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export default async function Home() {
  const cookieStore = await cookies()
  const isAuthenticated = cookieStore.get('auth_session')?.value === 'authenticated'
  redirect(isAuthenticated ? '/dashboard' : '/login')
}

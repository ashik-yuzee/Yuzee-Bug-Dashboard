import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function checkAuth(): Promise<NextResponse | null> {
  const cookieStore = await cookies()
  const isAuth = cookieStore.get('auth_session')?.value === 'authenticated'
  if (!isAuth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}

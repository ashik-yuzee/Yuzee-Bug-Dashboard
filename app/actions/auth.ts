'use server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD = 'yuzeeadmin@2026'
const COOKIE_NAME = 'auth_session'
const COOKIE_VALUE = 'authenticated'

export async function loginAction(username: string, password: string): Promise<{ error?: string }> {
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const cookieStore = await cookies()
    cookieStore.set(COOKIE_NAME, COOKIE_VALUE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    })
    return {}
  }
  return { error: 'Invalid username or password' }
}

export async function logoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
  redirect('/login')
}

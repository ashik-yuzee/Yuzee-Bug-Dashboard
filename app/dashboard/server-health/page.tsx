import { redirect } from 'next/navigation'

// Server Health is now embedded in the main dashboard sidebar.
export default function ServerHealthRoute() {
  redirect('/dashboard')
}

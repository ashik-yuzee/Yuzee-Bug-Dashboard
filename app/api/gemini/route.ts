import { NextRequest, NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'

const GEMINI_KEY = process.env.GEMINI_API_KEY_SERVER || ''

export async function POST(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied

  if (!GEMINI_KEY) return NextResponse.json({ error: 'Gemini API key not configured on server (GEMINI_API_KEY_SERVER)' }, { status: 503 })

  try {
    const body = await req.json()
    const prompt = body.prompt || body.contents || ''
    if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: body.generationConfig || { temperature: 0.3 } }),
    })

    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json({ error: `Gemini error ${res.status}`, detail: txt }, { status: res.status })
    }

    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return NextResponse.json({ text, raw: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

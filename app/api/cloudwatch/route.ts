import { NextRequest, NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'
import { createHmac, createHash } from 'crypto'

const AWS_REGION   = process.env.AWS_REGION            || 'ap-southeast-1'
const AWS_KEY_ID   = process.env.AWS_ACCESS_KEY_ID     || ''
const AWS_SECRET   = process.env.AWS_SECRET_ACCESS_KEY || ''
const LOG_GROUP    = process.env.CLOUDWATCH_LOG_GROUP  || ''

/* Minimal AWS SigV4 signing for CloudWatch Logs */
function sign(method: string, host: string, path: string, payload: string, region: string, service: string): Record<string, string> {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  const canonicalHeaders = `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\n`
  const signedHeaders    = 'content-type;host;x-amz-date'
  const payloadHash      = createHash('sha256').update(payload).digest('hex')

  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credentialScope  = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign     = ['AWS4-HMAC-SHA256', amzDate, credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')

  const sign = (key: Buffer | string, msg: string) => createHmac('sha256', key).update(msg).digest()
  const signingKey = sign(sign(sign(sign(`AWS4${AWS_SECRET}`, dateStamp), region), service), 'aws4_request')
  const signature  = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return {
    'Content-Type': 'application/x-amz-json-1.1',
    'Host': host,
    'X-Amz-Date': amzDate,
    'Authorization': `AWS4-HMAC-SHA256 Credential=${AWS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

/* GET /api/cloudwatch?timestamp=2025-01-15T10:00:00Z&minutes=10 */
export async function GET(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied

  if (!AWS_KEY_ID || !AWS_SECRET) return NextResponse.json({ error: 'AWS credentials not configured', code: 'no_creds' }, { status: 503 })
  if (!LOG_GROUP) return NextResponse.json({ error: 'CLOUDWATCH_LOG_GROUP not configured', code: 'no_group' }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const timestamp = searchParams.get('timestamp')
  const minutesStr = searchParams.get('minutes') || '10'
  const filterPattern = searchParams.get('filter') || 'ERROR'

  if (!timestamp) return NextResponse.json({ error: 'timestamp is required' }, { status: 400 })

  const center  = new Date(timestamp).getTime()
  const minutes = Math.min(Math.max(parseInt(minutesStr) || 10, 1), 60)
  const half    = minutes * 60 * 1000 / 2
  const startMs = center - half
  const endMs   = center + half

  const host    = `logs.${AWS_REGION}.amazonaws.com`
  const service = 'logs'

  const payload = JSON.stringify({
    logGroupName: LOG_GROUP,
    startTime: startMs,
    endTime: endMs,
    filterPattern,
    limit: 100,
  })

  const hdrs = sign('POST', host, '/', payload, AWS_REGION, service)

  try {
    const res = await fetch(`https://${host}/`, {
      method: 'POST',
      headers: {
        ...hdrs,
        'X-Amz-Target': 'Logs_20140328.FilterLogEvents',
      },
      body: payload,
    })

    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json({ error: `CloudWatch error ${res.status}`, detail: txt }, { status: res.status })
    }

    const data = await res.json() as {
      events?: Array<{ timestamp: number; message: string; logStreamName?: string }>
    }

    const events = (data.events || []).map(e => ({
      timestamp: new Date(e.timestamp).toISOString(),
      message: e.message,
      stream: e.logStreamName,
    }))

    return NextResponse.json({
      count: events.length,
      logGroup: LOG_GROUP,
      windowMinutes: minutes,
      filterPattern,
      events,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

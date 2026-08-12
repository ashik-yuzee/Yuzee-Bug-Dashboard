import { NextRequest } from 'next/server'
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  DescribeLogGroupsCommand,
  type ResultField,
} from '@aws-sdk/client-cloudwatch-logs'
import { deflateRawSync } from 'node:zlib'
import { checkAuth } from '@/lib/apiAuth'

// ── Constants ─────────────────────────────────────────────────────────────────

const LOG_GROUPS = [
  'AwsLogsAppender',
  '/aws/eks/eks-dev-yuzee-dev/cluster',
  '/aws/lambda/StopInstance',
  '/aws/lambda/Yuzee-Course-Matcher',
  '/aws/lambda/Yuzee-Institution-Dashboard',
  '/aws/lambda/andriod-apk',
  '/aws/lambda/andriod_apo',
  '/aws/lambda/course_recommender',
  '/aws/lambda/course_search',
  '/aws/lambda/daily-course-embedding',
  '/aws/lambda/instance_scaleUp',
  '/aws/lambda/kube-instance-stop',
  '/aws/lambda/kube-instances-start',
  '/aws/lambda/startinstance',
  '/aws/vendedlogs/events/event-bus/Yuzee-Course-Trigger-Event',
  '/aws/vendedlogs/pipes/Course-Data-Processing',
  '/aws/yuzee/common-service',
  '/aws/yuzee/company-service',
  '/aws/yuzee/connection-service',
  '/aws/yuzee/elastic-search-service',
  '/aws/yuzee/gemini-adapter-service',
  '/aws/yuzee/institute-service',
  '/aws/yuzee/job-service',
  '/aws/yuzee/storage-service',
  '/aws/yuzee/syncing-service',
  '/aws/yuzee/user-service',
  '/aws/yuzee/workflow-service',
  '/ecs/yuzee-cleanup-task',
  '/ecs/yuzee-course-processor-task',
  '/ecs/yuzee-graph-builder-task',
  '/ecs/yuzee-job-processor-task',
]

const CW_QUERY = `fields @timestamp, @log as log_group, @logStream as log_stream, @ptr, @message
| filter @message like /ERROR/
    or @message like /Exception/
    or @message like /FATAL/
    or @message like /CRITICAL/
    or @message like /PANIC/
    or @message like /OutOfMemory/
    or @message like /StackOverflow/
    or @message like /Segmentation fault/
| filter @message not like /errorCount["=: ]+0/
| filter @message not like /errors["=: ]+0/
| parse @message /(?<correlation_id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/
| sort @timestamp asc
| limit 10000`

const MIN_SLICE_SECONDS = 1
const ROLLBAR_BASE = 'https://api.rollbar.com/api/1'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExportConfig {
  runMode: 'ONE_DAY_DOWNLOAD' | 'RANGE_GENERATE'
  selectedDay: string
  rangeMode: 'CUSTOM' | 'LAST_N_DAYS'
  customStartDate: string
  customEndDate: string
  daysToExport: number
  includeToday: boolean
  sources: { cloudwatch: boolean; rollbar: boolean }
}

interface CwRow {
  '@timestamp': string
  log_group: string
  log_stream: string
  correlation_id: string
  '@message': string
  '@ptr'?: string
  [key: string]: string | undefined
}

interface RollbarItem {
  id: number
  counter: number
  title: string
  level: string
  total_occurrences: number
  framework: number | null
}

interface RollbarInstance {
  id: number
  item_id: number
  timestamp: number
  data: Record<string, unknown>
}

// ── SSE ───────────────────────────────────────────────────────────────────────

type SendFn = (data: object) => void

function makeSend(controller: ReadableStreamDefaultController, encoder: TextEncoder): SendFn {
  return (data) => {
    try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch {}
  }
}

// ── ZIP (node:zlib, no extra dependency) ─────────────────────────────────────

function crc32(buf: Buffer): number {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  let crc = 0xFFFFFFFF
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xFF]
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function buildZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = []
  const centralDir: Buffer[] = []
  const localOffsets: number[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8')
    const compressed = deflateRawSync(file.data, { level: 6 })
    const crc = crc32(file.data)
    localOffsets.push(offset)

    const lh = Buffer.alloc(30 + nameBytes.length)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8)
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12)
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(compressed.length, 18)
    lh.writeUInt32LE(file.data.length, 22); lh.writeUInt16LE(nameBytes.length, 26)
    lh.writeUInt16LE(0, 28); nameBytes.copy(lh, 30)
    parts.push(lh, compressed)
    offset += lh.length + compressed.length

    const cd = Buffer.alloc(46 + nameBytes.length)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(compressed.length, 20)
    cd.writeUInt32LE(file.data.length, 24); cd.writeUInt16LE(nameBytes.length, 28)
    cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38); cd.writeUInt32LE(localOffsets[centralDir.length], 42)
    nameBytes.copy(cd, 46)
    centralDir.push(cd)
  }

  const cdBuf = Buffer.concat(centralDir)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...parts, cdBuf, eocd])
}

// ── CSV builder ───────────────────────────────────────────────────────────────

function buildCsv(headers: string[], rows: Record<string, string | number | undefined | null>[]): string {
  const escape = (v: string | number | undefined | null) => {
    const s = String(v ?? '')
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map(h => escape(row[h])).join(','))
  return lines.join('\r\n') + '\r\n'
}

// ── Day slices ────────────────────────────────────────────────────────────────

function buildDaySlices(rangeStart: Date, rangeEnd: Date) {
  const slices: Array<{ start: Date; end: Date; label: string }> = []
  let cursor = new Date(rangeStart)
  while (cursor < rangeEnd) {
    const nextMidnight = new Date(cursor)
    nextMidnight.setUTCHours(0, 0, 0, 0)
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1)
    const sliceEnd = nextMidnight < rangeEnd ? nextMidnight : new Date(rangeEnd)
    slices.push({ start: new Date(cursor), end: sliceEnd, label: cursor.toISOString().slice(0, 10) })
    cursor = sliceEnd
  }
  return slices
}

// ── CloudWatch ────────────────────────────────────────────────────────────────

async function loadLogGroupMeta(client: CloudWatchLogsClient) {
  const meta = new Map<string, { creationTs: number; retentionDays: number | null }>()
  const wanted = new Set(LOG_GROUPS)
  let nextToken: string | undefined
  do {
    const resp = await client.send(new DescribeLogGroupsCommand({ nextToken, limit: 50 }))
    for (const g of resp.logGroups ?? []) {
      if (g.logGroupName && wanted.has(g.logGroupName)) {
        meta.set(g.logGroupName, {
          creationTs: Math.ceil((g.creationTime ?? 0) / 1000),
          retentionDays: g.retentionInDays ?? null,
        })
      }
    }
    nextToken = resp.nextToken
  } while (nextToken)
  return meta
}

function dedupe(rows: CwRow[]): CwRow[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    const key = r['@ptr'] || JSON.stringify(r)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function runCwQuery(
  client: CloudWatchLogsClient,
  logGroup: string,
  startTs: number,
  endTs: number,
  queryLimit: number,
  depth = 0,
): Promise<CwRow[]> {
  const startResp = await client.send(new StartQueryCommand({
    logGroupName: logGroup,
    startTime: startTs,
    endTime: endTs,
    queryString: CW_QUERY,
    limit: queryLimit,
  }))
  if (!startResp.queryId) throw new Error(`No queryId returned for ${logGroup}`)
  const queryId = startResp.queryId

  let rows: CwRow[] = []
  let matched = 0
  while (true) {
    const result = await client.send(new GetQueryResultsCommand({ queryId }))
    const status = result.status
    if (status === 'Complete') {
      rows = (result.results ?? []).map(row => {
        const r: CwRow = { '@timestamp': '', log_group: '', log_stream: '', correlation_id: '', '@message': '' }
        for (const f of (row as ResultField[])) {
          if (f.field && f.value !== undefined) r[f.field] = f.value
        }
        return r
      })
      matched = parseInt(String(result.statistics?.recordsMatched ?? '0'), 10)
      break
    }
    if (status === 'Failed' || status === 'Cancelled' || status === 'Timeout') {
      throw new Error(`Query ${status} for ${logGroup}`)
    }
    await new Promise(res => setTimeout(res, 2000))
  }

  const saturated = rows.length >= queryLimit || matched > rows.length
  if (!saturated) return dedupe(rows)

  const duration = endTs - startTs
  if (duration <= MIN_SLICE_SECONDS) {
    throw new Error(`${logGroup} exceeded ${queryLimit} results in a 1-second window — completeness cannot be guaranteed`)
  }

  const mid = startTs + Math.floor(duration / 2)
  const left = await runCwQuery(client, logGroup, startTs, mid, queryLimit, depth + 1)
  const right = await runCwQuery(client, logGroup, mid, endTs, queryLimit, depth + 1)
  return dedupe([...left, ...right])
}

// ── CloudWatch CSV reducer (port of reduce_cloudwatch.py) ─────────────────────

function extractServiceName(logGroup: string): string {
  const clean = logGroup.replace(/^\d+:/, '')
  const parts = clean.replace(/^\//, '').split('/')
  return parts[parts.length - 1] || logGroup
}

function extractErrorInfo(message: string): [string, string] {
  if (!message) return ['unknown', '']
  const first = message.split('\n')[0].trim()

  let m = first.match(/\[(?:ERROR|WARN)\]\s+(?:Runtime\.)?([A-Za-z][A-Za-z0-9._]*):\s*(.+)/)
  if (m) return [m[1].split('.').pop()!, m[2].slice(0, 300)]

  m = first.match(/\[(?:ERROR|WARN)\]\s+(.+)/)
  if (m) return ['LambdaError', m[1].slice(0, 300)]

  m = first.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+\s+(ERROR|WARN|INFO|DEBUG|FATAL)\s+\[([^\]]+)\]\s+-\s+(?:\[correlation_id:[^\]]*\]\s+)?(?:\[trace_id:[^\]]*\]\s+)?-\s+(.+)/)
  if (m) {
    const [, level, threadCls, desc] = m
    if (/[└┌┐┘│─├┤┼╔╗╚╝║═]/.test(desc)) {
      return ['ProvisioningError', (threadCls.includes(':') ? threadCls.split(':').pop()! : threadCls).slice(0, 200)]
    }
    let errorType = level + 'Log'
    let errorDesc = desc
    for (const line of message.split('\n').slice(1, 5)) {
      const em = line.trim().match(/([a-z][a-z.]+[A-Z][A-Za-z]+(?:Exception|Error|Failure|Timeout)):\s*(.+)/)
      if (em) { errorType = em[1].split('.').pop()!; errorDesc = em[2].slice(0, 300); break }
    }
    return [errorType, errorDesc.slice(0, 300)]
  }

  return ['Error', first.slice(0, 300)]
}

const UUID_RE   = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const EC2IDS_RE = /'i-[0-9a-f]+(,\s*i-[0-9a-f]+)+'/gi
const EC2ID_RE  = /\bi-[0-9a-f]{8,17}\b/gi
const NUMID_RE  = /\b\d{6,}\b/g
const TS_RE     = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?\b/g
const WS_RE     = /\s+/g

function normalizeDesc(desc: string): string {
  return desc
    .replace(UUID_RE, '{UUID}').replace(EC2IDS_RE, "'i-{IDs}'").replace(EC2ID_RE, 'i-{ID}')
    .replace(NUMID_RE, '{ID}').replace(TS_RE, '{TS}').replace(WS_RE, ' ').trim().slice(0, 300)
}

const CW_HEADERS = ['@timestamp', 'log_group', 'log_stream', 'correlation_id', '@message']
const REDUCED_HEADERS = ['service', 'error_type', 'error_pattern', 'count', 'first_seen', 'last_seen', 'sample_message', 'log_group']

function reduceCwRows(rows: CwRow[], maxMsgLen = 400): Record<string, string | number>[] {
  type Group = { count: number; firstSeen: string; lastSeen: string; sampleMsg: string; logGroups: Set<string> }
  const groups = new Map<string, Group>()

  for (const row of rows) {
    const service = extractServiceName(row.log_group)
    const [errType, desc] = extractErrorInfo(row['@message'])
    const key = `${service}\x00${errType}\x00${normalizeDesc(desc)}`
    const ts = row['@timestamp']
    let g = groups.get(key)
    if (!g) {
      g = { count: 0, firstSeen: ts, lastSeen: ts, sampleMsg: row['@message'], logGroups: new Set() }
      groups.set(key, g)
    }
    g.count++; g.logGroups.add(row.log_group)
    if (ts < g.firstSeen) g.firstSeen = ts
    if (ts > g.lastSeen) { g.lastSeen = ts; g.sampleMsg = row['@message'] }
  }

  return [...groups.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([key, g]) => {
      const [service, error_type, error_pattern] = key.split('\x00')
      return {
        service, error_type, error_pattern,
        count: g.count,
        first_seen: g.firstSeen,
        last_seen: g.lastSeen,
        sample_message: g.sampleMsg.replace(/\n/g, ' | ').slice(0, maxMsgLen),
        log_group: [...g.logGroups].sort().join('; '),
      }
    })
}

// ── Rollbar ───────────────────────────────────────────────────────────────────

async function rollbarGet(token: string, path: string, params: Record<string, string | number> = {}) {
  const url = new URL(`${ROLLBAR_BASE}${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) })
      if (r.status === 429) {
        const wait = parseInt(r.headers.get('Retry-After') ?? '60', 10)
        await new Promise(res => setTimeout(res, wait * 1000))
        continue
      }
      if (!r.ok) return null
      return r.json()
    } catch { await new Promise(res => setTimeout(res, 5000)) }
  }
  return null
}

async function fetchRollbarItems(token: string): Promise<Map<number, RollbarItem>> {
  const items = new Map<number, RollbarItem>()
  let page = 1
  while (true) {
    const data = await rollbarGet(token, '/items/', { page, per_page: 100 }) as { err: number; result?: { items: RollbarItem[] } } | null
    if (!data || data.err !== 0 || !data.result?.items?.length) break
    for (const item of data.result.items) items.set(item.id, item)
    page++
    await new Promise(res => setTimeout(res, 400))
  }
  return items
}

async function fetchRollbarInstances(token: string, startTs: number, endTs: number): Promise<RollbarInstance[]> {
  const all: RollbarInstance[] = []
  const seen = new Set<number>()
  for (let page = 1; page <= 200; page++) {
    const data = await rollbarGet(token, '/instances/', { page, per_page: 100 }) as { err: number; result?: { instances: RollbarInstance[] } } | null
    if (!data || data.err !== 0) break
    const batch = data.result?.instances ?? []
    if (!batch.length) break
    for (const inst of batch) {
      if (seen.has(inst.id)) continue
      seen.add(inst.id)
      if (inst.timestamp <= endTs && inst.timestamp >= startTs) all.push(inst)
    }
    const oldest = Math.min(...batch.map(i => i.timestamp))
    if (oldest < startTs) break
    await new Promise(res => setTimeout(res, 300))
  }
  return all
}

const ROLLBAR_HEADERS = [
  'item_id', 'item_counter', 'item_title', 'item_level', 'item_total', 'framework',
  'occurrence_id', 'timestamp', 'environment', 'code_version', 'error_class', 'error_message',
  'top_file', 'top_method', 'top_line', 'correlation_id', 'url', 'http_method',
  'user_ip', 'user_id', 'user_email', 'host', 'browser',
]

function extractRollbarFields(item: RollbarItem | undefined, occ: RollbarInstance): Record<string, string | number> {
  const occData = (occ.data ?? {}) as Record<string, unknown>
  const request = (occData.request ?? {}) as Record<string, unknown>
  const headers = (request.headers ?? {}) as Record<string, string>
  const headersLow: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) headersLow[k.toLowerCase()] = v
  const custom = (occData.custom ?? {}) as Record<string, string>
  const correlationId = custom.correlation_id || custom.correlationId
    || headersLow['x-correlation-id'] || headersLow['correlation-id'] || ''
  const person = (occData.person ?? {}) as Record<string, string>
  const body = (occData.body ?? {}) as Record<string, unknown>
  const trace = (body.trace ?? {}) as Record<string, unknown>
  const exc = (trace.exception ?? {}) as Record<string, string>
  const frames = (trace.frames ?? []) as Record<string, unknown>[]
  const topFrame = frames[frames.length - 1] ?? {}
  const server = (occData.server ?? {}) as Record<string, string>
  const clientD = (occData.client ?? {}) as Record<string, unknown>
  const js = (clientD.javascript ?? {}) as Record<string, string>
  return {
    item_id: item?.id ?? '',
    item_counter: item?.counter ?? '',
    item_title: item?.title ?? '',
    item_level: item?.level ?? '',
    item_total: item?.total_occurrences ?? '',
    framework: item?.framework ?? '',
    occurrence_id: occ.id,
    timestamp: occ.timestamp ? new Date(occ.timestamp * 1000).toISOString() : '',
    environment: String(occData.environment ?? ''),
    code_version: js.code_version || String(occData.code_version ?? ''),
    error_class: exc.class ?? '',
    error_message: exc.message ?? '',
    top_file: String(topFrame.filename ?? ''),
    top_method: String(topFrame.method ?? ''),
    top_line: String(topFrame.lineno ?? ''),
    correlation_id: correlationId,
    url: String(request.url ?? ''),
    http_method: String(request.method ?? ''),
    user_ip: String(request.user_ip ?? ''),
    user_id: person.id ?? '',
    user_email: person.email ?? '',
    host: server.host ?? '',
    browser: js.browser ?? '',
  }
}

// ── Main export runner ────────────────────────────────────────────────────────

async function runExport(config: ExportConfig, send: SendFn) {
  const now = new Date()
  let rangeStart: Date
  let rangeEnd: Date

  if (config.runMode === 'ONE_DAY_DOWNLOAD') {
    rangeStart = new Date(config.selectedDay + 'T00:00:00Z')
    rangeEnd = new Date(Math.min(rangeStart.getTime() + 86_400_000, now.getTime()))
    if (rangeStart >= now) throw new Error('Selected day must not be in the future')
  } else {
    if (config.rangeMode === 'CUSTOM') {
      rangeStart = new Date(config.customStartDate + 'T00:00:00Z')
      const reqEnd = new Date(config.customEndDate + 'T00:00:00Z')
      if (reqEnd < rangeStart) throw new Error('End date must be on or after start date')
      rangeEnd = new Date(Math.min(reqEnd.getTime() + 86_400_000, now.getTime()))
    } else {
      const days = Math.max(1, config.daysToExport)
      if (config.includeToday) {
        rangeStart = new Date(now.getTime() - (days - 1) * 86_400_000)
        rangeStart.setUTCHours(0, 0, 0, 0)
        rangeEnd = now
      } else {
        rangeEnd = new Date(now); rangeEnd.setUTCHours(0, 0, 0, 0)
        rangeStart = new Date(rangeEnd.getTime() - days * 86_400_000)
      }
    }
  }

  if (rangeStart >= rangeEnd) throw new Error('Export start must be earlier than export end')

  const daySlices = buildDaySlices(rangeStart, rangeEnd)
  send({ type: 'log', text: `Window: ${rangeStart.toISOString().slice(0, 16)}Z → ${rangeEnd.toISOString().slice(0, 16)}Z  (${daySlices.length} day${daySlices.length > 1 ? 's' : ''})` })

  const zipFiles: Array<{ name: string; data: Buffer }> = []

  // ── CloudWatch ────────────────────────────────────────────────────────────
  if (config.sources.cloudwatch) {
    const cwClient = new CloudWatchLogsClient({
      region: process.env.AWS_REGION ?? 'ap-southeast-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })

    send({ type: 'progress', message: 'Loading CloudWatch log group metadata...', pct: 2 })
    const meta = await loadLogGroupMeta(cwClient)
    const available = LOG_GROUPS.filter(g => meta.has(g))
    const unavailable = LOG_GROUPS.filter(g => !meta.has(g))
    send({ type: 'log', text: `CloudWatch: ${available.length}/${LOG_GROUPS.length} log groups accessible` })
    if (unavailable.length) send({ type: 'log', text: `  ⚠ Skipped: ${unavailable.map(g => g.split('/').pop()).join(', ')}` })

    for (let di = 0; di < daySlices.length; di++) {
      const { start, end, label } = daySlices[di]
      const startTs = Math.floor(start.getTime() / 1000)
      const endTs = Math.floor(end.getTime() / 1000)
      const dayRows: CwRow[] = []
      const cwPct = 5 + Math.round((di / daySlices.length) * 45)

      send({ type: 'progress', message: `CloudWatch: day ${di + 1}/${daySlices.length} — ${label}`, pct: cwPct })

      for (let gi = 0; gi < available.length; gi++) {
        const lg = available[gi]
        const shortName = lg.split('/').pop()!
        const groupMeta = meta.get(lg)!
        let validStart = Math.max(startTs, groupMeta.creationTs)
        if (groupMeta.retentionDays !== null) {
          const retentionStart = Math.ceil(Date.now() / 1000 - groupMeta.retentionDays * 86400)
          validStart = Math.max(validStart, retentionStart)
        }
        if (validStart >= endTs) continue

        send({ type: 'log', text: `  [${gi + 1}/${available.length}] ${shortName}...` })
        try {
          const rows = await runCwQuery(cwClient, lg, validStart, endTs, 10000)
          dayRows.push(...rows)
          if (rows.length) send({ type: 'log', text: `    ✓ ${rows.length} rows` })
        } catch (err) {
          send({ type: 'log', text: `    ⚠ ${shortName}: ${err instanceof Error ? err.message : err}` })
        }
      }

      const uniqueRows = dedupe(dayRows)
      send({ type: 'log', text: `  CloudWatch ${label}: ${uniqueRows.length} rows total` })

      if (uniqueRows.length > 0) {
        const reduced = reduceCwRows(uniqueRows)
        const reducedCsv = buildCsv(REDUCED_HEADERS, reduced)
        const reducedName = `cloudwatch_errors_${label}_reduced.csv`
        const reducedBuf = Buffer.from(reducedCsv, 'utf8')
        zipFiles.push({ name: reducedName, data: reducedBuf })
        send({ type: 'file', name: reducedName, content: reducedBuf.toString('base64'), sizeBytes: reducedBuf.length })
        send({ type: 'log', text: `  Reduced: ${uniqueRows.length} rows → ${reduced.length} patterns` })
      }
    }
  }

  // ── Rollbar ───────────────────────────────────────────────────────────────
  if (!config.sources.rollbar) {
    send({ type: 'log', text: 'Rollbar skipped (not selected)' })
  }
  const rollbarSources = config.sources.rollbar ? [
    { token: process.env.ROLLBAR_READ_WEB!, projectName: 'YuzeeWebRollbar', baseName: 'rollbar_web_occurrences' },
    { token: process.env.ROLLBAR_READ_APP!, projectName: 'NewYuzeeApp',     baseName: 'rollbar_app_occurrences' },
  ] : []

  const totalStartTs = Math.floor(rangeStart.getTime() / 1000)
  const totalEndTs = Math.floor(rangeEnd.getTime() / 1000)

  for (let pi = 0; pi < rollbarSources.length; pi++) {
    const { token, projectName, baseName } = rollbarSources[pi]
    const pct = 50 + Math.round(((pi + 0.5) / rollbarSources.length) * 45)
    send({ type: 'progress', message: `Rollbar: ${projectName}`, pct })

    if (!token) {
      send({ type: 'log', text: `  ⚠ ${projectName}: missing token (check env vars)` })
      continue
    }

    send({ type: 'log', text: `Rollbar ${projectName}: fetching items...` })
    const items = await fetchRollbarItems(token)
    send({ type: 'log', text: `  ${items.size} items fetched` })
    send({ type: 'log', text: `  Fetching instances in window...` })
    const instances = await fetchRollbarInstances(token, totalStartTs, totalEndTs)
    send({ type: 'log', text: `  ${instances.length} instances in window` })

    const allRows = instances.map(inst => extractRollbarFields(items.get(inst.item_id), inst))
    const unmatched = instances.filter(inst => !items.has(inst.item_id)).length
    if (unmatched) send({ type: 'log', text: `  ⚠ ${unmatched} instances had no matching item` })

    for (const { start, end, label } of daySlices) {
      const dayStartTs = Math.floor(start.getTime() / 1000)
      const dayEndTs = Math.floor(end.getTime() / 1000)
      const dayRows = allRows.filter(r => {
        if (!r.timestamp) return false
        const ts = Math.floor(new Date(r.timestamp as string).getTime() / 1000)
        return ts >= dayStartTs && ts < dayEndTs
      })
      if (!dayRows.length) continue
      const csvContent = buildCsv(ROLLBAR_HEADERS, dayRows)
      const csvName = `${baseName}_${label}.csv`
      const csvBuf = Buffer.from(csvContent, 'utf8')
      zipFiles.push({ name: csvName, data: csvBuf })
      send({ type: 'file', name: csvName, content: csvBuf.toString('base64'), sizeBytes: csvBuf.length })
      send({ type: 'log', text: `  ${projectName} ${label}: ${dayRows.length} rows` })
    }
  }

  // ── ZIP ───────────────────────────────────────────────────────────────────
  if (zipFiles.length > 0) {
    send({ type: 'progress', message: 'Building ZIP archive...', pct: 98 })
    const label = daySlices.length === 1
      ? daySlices[0].label
      : `${daySlices[0].label}_to_${daySlices[daySlices.length - 1].label}`
    const zipBuf = buildZip(zipFiles)
    const zipName = `errors_${label}.zip`
    send({ type: 'zip', name: zipName, content: zipBuf.toString('base64'), sizeBytes: zipBuf.length })
    send({ type: 'log', text: `ZIP: ${zipName} (${(zipBuf.length / 1024).toFixed(0)} KB, ${zipFiles.length} files)` })
  }

  send({ type: 'progress', message: 'Export complete', pct: 100 })
  send({ type: 'done', fileCount: zipFiles.length })
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authError = await checkAuth()
  if (authError) return authError

  const config: ExportConfig = await req.json()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = makeSend(controller, encoder)
      try {
        await runExport(config, send)
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        try { controller.close() } catch {}
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

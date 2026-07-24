'use client'

import { useState, useCallback, useRef } from 'react'

export interface PHOverview {
  dau: number
  mau: number
  sessions: number
  eventsToday: number
  events30d: number
  bounceRate: number
  avgSessionSec: number
  topCustomEvents: { event: string; count: number; users: number }[]
}

export interface PHDayPoint     { date: string; users: number }
export interface PHEventTrend   { date: string; customEvents: number; autoEvents: number; total: number; users: number }
export interface PHTopEvent     { event: string; total: number; uniqueUsers: number; today: number; prevTotal: number; changePct: number | null }
export interface PHPage         { path: string; views: number; uniqueUsers: number; sessions: number }
export interface PHScreen       { screen: string; views: number; users: number }
export interface PHSession {
  sessionId: string; userId: string; browser: string; os: string
  deviceType: string; country: string; startedAt: string; lastEventAt: string
  durationSec: number; eventCount: number; pages: number; pageviews: number; referrer: string
}
export interface PHPlatforms {
  os:      { name: string; users: number }[]
  browser: { name: string; users: number }[]
  device:  { name: string; users: number }[]
  country: { name: string; users: number }[]
}
export interface PHUser {
  distinctId: string; email: string; name: string; country: string
  os: string; browser: string; firstSeen: string; lastSeen: string
  sessions: number; events: number
}
export interface PHFeatureFlag {
  id: number; key: string; name: string; enabled: boolean
  rolloutPercentage: number | null; hasVariants: boolean
  variants: unknown; groupCount: number; createdAt: string; updatedAt: string
}
export interface PHFunnelStep {
  label: string; count: number; pct: number; dropPct: number
}
export interface PHError {
  date: string; errorType: string; occurrences: number; usersAffected: number
}
export interface PHNewVsReturning { date: string; newUsers: number; returningUsers: number }

// Pathway / journey analysis
export interface PHPathways {
  transitions:       { from: string; to: string; count: number }[]
  topPaths:          { screens: string[]; count: number; avgDurSec: number }[]
  timeBeforeDropoff: { bucket: string; sessions: number; avgSec: number }[]
  avgSessionSec:    number
  medianSessionSec: number
  totalSessions:    number
}

// Drop-off analysis
export interface PHDropoff {
  exitScreens:  { screen: string; exits: number; users: number }[]
  exitPages:    { page: string;   exits: number; users: number }[]
  lastAction:   { event: string;  sessions: number; users: number }[]
  depth:        { bucket: string; sessions: number; avgDuration: number }[]
  entryScreens: { screen: string; sessions: number; avgEventsAfter: number }[]
}

// Module engagement
export interface PHModule {
  module: string; views: number; users: number; sessions: number; avgEventsPerSession: number
}
export interface PHModules { modules: PHModule[] }

// User search & journey
export interface PHUserSearchResult { distinctId: string; email: string; name: string; lastSeen: string; events: number }
export interface PHUserSearch { users: PHUserSearchResult[] }
export interface PHUserJourneyEvent {
  event: string; timestamp: string; screen: string; sessionId: string
  os: string; browser: string; device: string
}
export interface PHUserJourney { userId: string; events: PHUserJourneyEvent[] }

// Cohort retention
export interface PHCohortWeek { weekNum: number; retained: number; pct: number }
export interface PHCohort { week: string; size: number; weeks: PHCohortWeek[] }
export interface PHCohorts { cohorts: PHCohort[] }

// Activity heatmap
export interface PHHeatmapCell { dow: number; hour: number; events: number; users: number }

// Growth analytics
export interface PHGrowth {
  weeklyNew: { week: string; newUsers: number }[]
  sources:   { source: string; users: number; events: number; sessions: number }[]
  countries: { country: string; users: number; events: number }[]
}

// Engagement segments
export interface PHSegmentUser {
  distinctId: string; email: string; name: string
  events: number; sessions: number; firstSeen: string; lastSeen: string
  daysSinceLast: number; segment: string
}
export interface PHSegments { users: PHSegmentUser[]; summary: Record<string, number>; totalUsers: number }

// AI usage
export interface PHAiOverview {
  totalRequests: number; uniqueUsers: number; totalTokens: number; estimatedCost: number
}
export interface PHAiTrendPoint {
  date: string; requests: number; users: number; tokens: number; cost: number
}
export interface PHAiEvent {
  event: string; total: number; users: number; tokens: number; cost: number
}
export interface PHAiUser {
  distinctId: string; email: string; name: string
  requests: number; tokens: number; sessionsWithAI: number; lastUsed: string; cost: number
}
export interface PHAiModel {
  model: string; total: number; tokens: number; cost: number
}
export interface PHAiUsage {
  overview: PHAiOverview
  trend:    PHAiTrendPoint[]
  events:   PHAiEvent[]
  users:    PHAiUser[]
  models:   PHAiModel[]
}

export interface PHGeoDetail {
  cities:     { city: string; country: string; users: number; events: number }[]
  timezones:  { tz: string; users: number; events: number }[]
  continents: { continent: string; users: number; events: number }[]
  regions:    { region: string; country: string; users: number }[]
}
export interface PHDeviceDetail {
  osVersions:     { version: string; users: number; events: number }[]
  browserVersions: { version: string; users: number; events: number }[]
  screenSizes:    { size: string; users: number; sessions: number }[]
  deviceModels:   { model: string; users: number; events: number }[]
  networkTypes:   { network: string; users: number; events: number }[]
}

interface Slot<T> { data: T | null; loading: boolean; error: string | null; loadedAt: number | null }

function makeSlot<T>(): Slot<T> { return { data: null, loading: false, error: null, loadedAt: null } }

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function usePostHogAnalytics() {
  const [overview,       setOverview]       = useState<Slot<PHOverview>>(makeSlot())
  const [dau,            setDau]            = useState<Slot<PHDayPoint[]>>(makeSlot())
  const [eventTrend,     setEventTrend]     = useState<Slot<PHEventTrend[]>>(makeSlot())
  const [topEvents,      setTopEvents]      = useState<Slot<PHTopEvent[]>>(makeSlot())
  const [pages,          setPages]          = useState<Slot<PHPage[]>>(makeSlot())
  const [screens,        setScreens]        = useState<Slot<PHScreen[]>>(makeSlot())
  const [sessions,       setSessions]       = useState<Slot<PHSession[]>>(makeSlot())
  const [platforms,      setPlatforms]      = useState<Slot<PHPlatforms>>(makeSlot())
  const [users,          setUsers]          = useState<Slot<PHUser[]>>(makeSlot())
  const [featureFlags,   setFeatureFlags]   = useState<Slot<PHFeatureFlag[]>>(makeSlot())
  const [funnel,         setFunnel]         = useState<Slot<PHFunnelStep[]>>(makeSlot())
  const [errors,         setErrors]         = useState<Slot<PHError[]>>(makeSlot())
  const [newVsReturning, setNewVsReturning] = useState<Slot<PHNewVsReturning[]>>(makeSlot())
  const [pathways,       setPathways]       = useState<Slot<PHPathways>>(makeSlot())
  const [dropoff,        setDropoff]        = useState<Slot<PHDropoff>>(makeSlot())
  const [modules,        setModules]        = useState<Slot<PHModules>>(makeSlot())
  const [aiUsage,        setAiUsage]        = useState<Slot<PHAiUsage>>(makeSlot())
  const [cohorts,        setCohorts]        = useState<Slot<PHCohorts>>(makeSlot())
  const [heatmap,        setHeatmap]        = useState<Slot<PHHeatmapCell[]>>(makeSlot())
  const [growth,         setGrowth]         = useState<Slot<PHGrowth>>(makeSlot())
  const [segments,       setSegments]       = useState<Slot<PHSegments>>(makeSlot())
  const [userJourney,    setUserJourney]    = useState<Slot<PHUserJourney>>(makeSlot())
  const [geoDetail,    setGeoDetail]    = useState<Slot<PHGeoDetail>>(makeSlot())
  const [deviceDetail, setDeviceDetail] = useState<Slot<PHDeviceDetail>>(makeSlot())

  // Days range shared across queries that support it
  const [days, setDays] = useState(30)

  const inFlight = useRef(new Set<string>())

  async function fetchSlot<T>(
    key: string,
    url: string,
    setter: React.Dispatch<React.SetStateAction<Slot<T>>>,
    force = false,
  ) {
    if (inFlight.current.has(key)) return
    setter(prev => {
      if (!force && prev.loadedAt && Date.now() - prev.loadedAt < CACHE_TTL) return prev
      return { ...prev, loading: true, error: null }
    })
    inFlight.current.add(key)
    try {
      const res = await fetch(url)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setter({ data: json as T, loading: false, error: null, loadedAt: Date.now() })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setter(prev => ({ ...prev, loading: false, error: msg }))
    } finally {
      inFlight.current.delete(key)
    }
  }

  const base = (type: string, d = days) => `/api/posthog/analytics?type=${type}&days=${d}`

  const loadOverview    = useCallback((force = false) => fetchSlot<PHOverview>('overview', base('overview'), setOverview, force), [days])
  const loadDau         = useCallback((force = false) => fetchSlot<PHDayPoint[]>('dau', base('dau'), setDau, force), [days])
  const loadEventTrend  = useCallback((force = false) => fetchSlot<PHEventTrend[]>('evt_trend', base('events_trend'), setEventTrend, force), [days])
  const loadTopEvents   = useCallback((force = false) => fetchSlot<PHTopEvent[]>('top_events', base('top_events'), setTopEvents, force), [days])
  const loadPages       = useCallback((force = false) => fetchSlot<PHPage[]>('pages', base('pages'), setPages, force), [days])
  const loadScreens     = useCallback((force = false) => fetchSlot<PHScreen[]>('screens', base('screens'), setScreens, force), [days])
  const loadSessions    = useCallback((force = false) => fetchSlot<PHSession[]>('sessions', base('sessions', Math.min(days, 14)), setSessions, force), [days])
  const loadPlatforms   = useCallback((force = false) => fetchSlot<PHPlatforms>('platforms', base('platforms'), setPlatforms, force), [days])
  const loadUsers       = useCallback((force = false) => fetchSlot<PHUser[]>('users', base('users'), setUsers, force), [days])
  const loadFeatureFlags= useCallback((force = false) => fetchSlot<PHFeatureFlag[]>('flags', '/api/posthog/analytics?type=feature_flags', setFeatureFlags, force), [])
  const loadFunnel      = useCallback((force = false) => fetchSlot<PHFunnelStep[]>('funnel', base('funnel'), setFunnel, force), [days])
  const loadErrors      = useCallback((force = false) => fetchSlot<PHError[]>('errors', base('errors'), setErrors, force), [days])
  const loadNewVsReturn = useCallback((force = false) => fetchSlot<PHNewVsReturning[]>('nvr', base('new_vs_returning'), setNewVsReturning, force), [days])
  const loadPathways    = useCallback((force = false) => fetchSlot<PHPathways>('pathways', base('pathways'), setPathways, force), [days])
  const loadDropoff     = useCallback((force = false) => fetchSlot<PHDropoff>('dropoff', base('dropoff'), setDropoff, force), [days])
  const loadModules     = useCallback((force = false) => fetchSlot<PHModules>('modules', base('modules'), setModules, force), [days])
  const loadAiUsage     = useCallback((force = false) => fetchSlot<PHAiUsage>('ai_usage', base('ai_usage'), setAiUsage, force), [days])
  const loadCohorts     = useCallback((force = false) => fetchSlot<PHCohorts>('cohorts', '/api/posthog/analytics?type=cohorts', setCohorts, force), [])
  const loadHeatmap     = useCallback((force = false, module = '') => {
    const url = module ? `${base('heatmap')}&module=${encodeURIComponent(module)}` : base('heatmap')
    return fetchSlot<PHHeatmapCell[]>('heatmap', url, setHeatmap, force)
  }, [days])
  const loadGrowth      = useCallback((force = false) => fetchSlot<PHGrowth>('growth', base('growth'), setGrowth, force), [days])
  const loadSegments    = useCallback((force = false) => fetchSlot<PHSegments>('segments', '/api/posthog/analytics?type=segments', setSegments, force), [])
  const loadGeoDetail    = useCallback((force = false) => fetchSlot<PHGeoDetail>('geo_detail', base('geo_detail'), setGeoDetail, force), [days])
  const loadDeviceDetail = useCallback((force = false) => fetchSlot<PHDeviceDetail>('device_detail', base('device_detail'), setDeviceDetail, force), [days])
  const loadUserJourney = useCallback((userId: string, force = false) =>
    fetchSlot<PHUserJourney>(`journey_${userId}`, `/api/posthog/analytics?type=user_journey&userId=${encodeURIComponent(userId)}&days=${days}`, setUserJourney, force),
  [days])

  return {
    days, setDays,
    overview,    loadOverview,
    dau,         loadDau,
    eventTrend,  loadEventTrend,
    topEvents,   loadTopEvents,
    pages,       loadPages,
    screens,     loadScreens,
    sessions,    loadSessions,
    platforms,   loadPlatforms,
    users,       loadUsers,
    featureFlags, loadFeatureFlags,
    funnel,      loadFunnel,
    errors,      loadErrors,
    newVsReturning, loadNewVsReturn,
    pathways,    loadPathways,
    dropoff,     loadDropoff,
    modules,     loadModules,
    aiUsage,     loadAiUsage,
    cohorts,     loadCohorts,
    heatmap,     loadHeatmap,
    growth,      loadGrowth,
    segments,    loadSegments,
    userJourney, loadUserJourney,
    geoDetail,    loadGeoDetail,
    deviceDetail, loadDeviceDetail,
  }
}

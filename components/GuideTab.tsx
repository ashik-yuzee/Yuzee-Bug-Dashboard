'use client'

import { useEffect, useRef, useState } from 'react'
import {
  BarChart3, List, Layers, Activity, ShieldCheck, MessageSquare,
  Code2, FileText, Calendar, Ticket as TicketIcon, LayoutGrid, Lightbulb, BookOpen,
} from 'lucide-react'

const SECTIONS = [
  { id: 'welcome',    label: 'Welcome',        icon: <BookOpen    size={13} /> },
  { id: 'navigating', label: 'Navigating',     icon: <LayoutGrid  size={13} /> },
  { id: 'overview',   label: 'Overview',        icon: <BarChart3   size={13} /> },
  { id: 'bugs',       label: 'Bug Reports',     icon: <List        size={13} /> },
  { id: 'clusters',   label: 'Error Clusters',  icon: <Layers      size={13} /> },
  { id: 'pipeline',   label: 'Pipeline',        icon: <Activity    size={13} /> },
  { id: 'triage',     label: 'Triage & Rules',  icon: <ShieldCheck size={13} /> },
  { id: 'feedback',   label: 'Feedback',        icon: <MessageSquare size={13} /> },
  { id: 'developer',  label: 'Developer',       icon: <Code2       size={13} /> },
  { id: 'reports',    label: 'Reports',         icon: <FileText    size={13} /> },
  { id: 'daily',      label: 'Daily Digest',    icon: <Calendar    size={13} /> },
  { id: 'tickets',    label: 'Tickets',         icon: <TicketIcon  size={13} /> },
  { id: 'faq',        label: 'Tips & FAQ',      icon: <Lightbulb  size={13} /> },
]

function SectionCard({ id, icon, title, children }: { id: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 12 }}>
      <div style={{
        background: 'var(--surface-1)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)', overflow: 'hidden', marginBottom: 12,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 18px', borderBottom: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}>
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 'var(--r-md)',
            background: 'var(--orange-dim)', color: 'var(--orange)', flexShrink: 0,
          }}>
            {icon}
          </span>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-1)', margin: 0 }}>{title}</h2>
        </div>
        <div style={{ padding: '14px 18px', fontSize: 13, lineHeight: 1.7, color: 'var(--tx-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {children}
        </div>
      </div>
    </section>
  )
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((it, i) => <li key={i} style={{ color: 'var(--tx-2)' }}>{it}</li>)}
    </ul>
  )
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 10, background: 'var(--orange-dim)',
      border: '1px solid rgba(249,115,22,.25)', borderRadius: 'var(--r-md)', padding: '10px 14px',
    }}>
      <Lightbulb size={14} color="var(--orange)" style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 12, color: 'var(--tx-1)', lineHeight: 1.6 }}>{children}</span>
    </div>
  )
}

export default function GuideTab() {
  const [activeSection, setActiveSection] = useState('welcome')
  const scrollRef = useRef<HTMLDivElement>(null)

  const jumpTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveSection(id)
    }
  }

  // Track which section is in view as the user scrolls the content area
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const handler = () => {
      for (const sec of [...SECTIONS].reverse()) {
        const el = container.querySelector(`#${sec.id}`) as HTMLElement | null
        if (el && el.offsetTop - container.scrollTop <= 60) {
          setActiveSection(sec.id)
          break
        }
      }
    }
    container.addEventListener('scroll', handler, { passive: true })
    return () => container.removeEventListener('scroll', handler)
  }, [])

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface-1)', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <BookOpen size={18} color="var(--orange)" />
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--tx-1)', margin: 0 }}>Dashboard Guide</h1>
          <p style={{ fontSize: 12, color: 'var(--tx-3)', margin: 0, marginTop: 1 }}>
            Quick reference for every section — click a section in the nav to jump to it.
          </p>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* Sticky left nav */}
        <div style={{
          width: 200, flexShrink: 0,
          borderRight: '1px solid var(--border)', overflowY: 'auto',
          padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {SECTIONS.map(s => {
            const active = activeSection === s.id
            return (
              <button key={s.id} onClick={() => jumpTo(s.id)} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, fontWeight: active ? 600 : 400,
                padding: '6px 10px', borderRadius: 'var(--r-md)', textAlign: 'left',
                background: active ? 'var(--orange-dim)' : 'transparent',
                color: active ? 'var(--orange)' : 'var(--tx-3)',
                border: 'none', cursor: 'pointer', transition: 'all .12s', width: '100%',
              }}>
                <span style={{ color: active ? 'var(--orange)' : 'var(--tx-3)', flexShrink: 0 }}>{s.icon}</span>
                {s.label}
              </button>
            )
          })}
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          <SectionCard id="welcome" icon={<BookOpen size={14} />} title="Welcome">
            <p style={{ margin: 0 }}>
              The Yuzee Bug Dashboard is the control panel for the automated bug pipeline — Rollbar and CloudWatch
              catch errors, n8n triages them with Gemini AI and creates Jira tickets, and this dashboard is where the
              team reviews, filters, and acts on everything that pipeline produces. It also hosts a lightweight
              internal ticketing system for work that isn&apos;t an automated bug report, including a mirror of your
              team&apos;s Jira tickets.
            </p>
          </SectionCard>

          <SectionCard id="navigating" icon={<LayoutGrid size={14} />} title="Navigating the dashboard">
            <p style={{ margin: 0 }}>All sections live in the top navigation bar.</p>
            <Bullets items={[
              <>The colored dot or number badge next to a nav item flags something worth a look (e.g. bugs pending review, open tickets).</>,
              <>The top bar has — on the right — the AI Analyse button (only when bugs are selected), the <strong>Legacy on/off</strong> toggle, refresh, and sign out.</>,
              <>The <strong>Legacy</strong> toggle switches whether bugs reported before 10 Jul 2026 are included — most days you can leave it off.</>,
              <>Every page has a small info banner at the top explaining what it shows — click the chevron to collapse it once you know the page.</>,
            ]} />
          </SectionCard>

          <SectionCard id="overview" icon={<BarChart3 size={14} />} title="Overview">
            <p style={{ margin: 0 }}>The landing page — a single-screen health check of the whole pipeline.</p>
            <Bullets items={[
              'KPI cards for total bugs, P1/critical count, resolved rate, duplicates, and Jira coverage, with a time-range toggle.',
              'Daily bug volume chart, severity/status/routing/component breakdowns — all clickable, jumping straight to the matching bugs.',
              'AI Triage Pipeline and Internal Tickets summary widgets, each linking straight to their full tab.',
              'Actionable Insights — auto-generated callouts for things that need attention (Jira-pending tickets, a stalled pipeline, a spike in one component, etc).',
            ]} />
          </SectionCard>

          <SectionCard id="bugs" icon={<List size={14} />} title="Bug Reports">
            <p style={{ margin: 0 }}>The full, filterable table of every automated bug report.</p>
            <Bullets items={[
              'Use the filter bar to narrow by severity, platform, component, status, environment, Jira status, or duplicate flag — or just search by description, report ID, or Jira key.',
              'Click any row to open its detail panel: the AI triage summary, the raw Rollbar exception and stack trace, a pre-crash telemetry timeline, and quick links to Jira, Rollbar, CloudWatch, and session replay.',
              <>From that same panel you can re-queue a bug for AI triage, mark it resolved or duplicate, or <strong>create an Internal Ticket</strong> linked to it.</>,
            ]} />
            <Callout>Can&apos;t find a bug? Check whether the Legacy toggle in the top bar needs to be turned on — anything before 10 Jul 2026 is hidden by default.</Callout>
          </SectionCard>

          <SectionCard id="clusters" icon={<Layers size={14} />} title="Error Clusters">
            <p style={{ margin: 0 }}>
              Bugs are automatically grouped by a normalized version of their error message, so the same underlying
              failure shows up once instead of dozens of times.
            </p>
            <Bullets items={[
              'Filter by severity, routing (BACKEND/MOBILE/WEB), or component, and search by error text.',
              'Sort by most reports, highest severity, most recent, oldest, or component.',
              'Click "View N bugs →" on any cluster to jump to Bug Reports pre-filtered to that exact pattern.',
            ]} />
          </SectionCard>

          <SectionCard id="pipeline" icon={<Activity size={14} />} title="Pipeline">
            <p style={{ margin: 0 }}>Health of the automation itself — three sub-views:</p>
            <Bullets items={[
              <><strong>Queue Health</strong> — how the Gemini AI triage queue is doing (queued/processed/stale/failed, average triage time), with a one-click re-queue for anything stuck.</>,
              <><strong>Data Quality</strong> — the pipeline&apos;s own self-check: missing correlation IDs, missing Jira keys, incomplete triage.</>,
              <><strong>CloudWatch</strong> — when each log group was last scanned, flagged if it&apos;s gone quiet for more than 15 minutes.</>,
            ]} />
          </SectionCard>

          <SectionCard id="triage" icon={<ShieldCheck size={14} />} title="Triage & Rules">
            <p style={{ margin: 0 }}>The governance layer behind the AI triage:</p>
            <Bullets items={[
              <><strong>Bug Rules</strong> — regex overrides that run before Gemini triage (force a severity, team, or suppress a ticket entirely).</>,
              <><strong>Triage Feedback</strong> — human corrections logged from Jira comments; enough of them (weight ≥ 3) auto-promotes into a permanent rule.</>,
              <><strong>Jira Comments</strong> — the full log of every comment the automation has read and acted on.</>,
            ]} />
          </SectionCard>

          <SectionCard id="feedback" icon={<MessageSquare size={14} />} title="Feedback">
            <p style={{ margin: 0 }}>
              In-app product feedback — a separate stream from automated bug reports, classified by sentiment and
              category. Filter by sentiment, category, or whether Gemini flagged it as actionable.
            </p>
          </SectionCard>

          <SectionCard id="developer" icon={<Code2 size={14} />} title="Developer">
            <p style={{ margin: 0 }}>
              Per-developer workload, worked out automatically from where a bug came from (routing), not manual
              assignment. Each card shows severity breakdown, Jira coverage, and open/closed tickets assigned to them.
              Additional developers discovered from ticket assignees are shown automatically.
            </p>
          </SectionCard>

          <SectionCard id="reports" icon={<FileText size={14} />} title="Reports">
            <p style={{ margin: 0 }}>
              Deeper analytics for retrospectives: 30-day bug volume by severity, mean time to triage against a
              5-minute target, resolution rate and duplicate rate over 12 weeks, bugs by component and platform,
              and P1/P2 response time. Most charts jump to the matching bugs when clicked. There&apos;s also an
              on-demand AI-generated standup summary.
            </p>
          </SectionCard>

          <SectionCard id="daily" icon={<Calendar size={14} />} title="Daily Digest">
            <p style={{ margin: 0 }}>
              Every night at 9 PM, an n8n workflow summarizes the last 24 hours of bugs with Gemini and saves a full
              HTML report to Supabase Storage — the same report posted to Microsoft Teams. This tab lists every
              report, most recent first, with an inline preview and a link to open it on its own.
            </p>
          </SectionCard>

          <SectionCard id="tickets" icon={<TicketIcon size={14} />} title="Tickets">
            <p style={{ margin: 0 }}>
              A lightweight, internal alternative to Jira for work that isn&apos;t an automated bug — refactors,
              investigations, anything the pipeline wouldn&apos;t generate — shown alongside a mirror of your real Jira
              tickets.
            </p>
            <Bullets items={[
              <>Filter by space (YSDT/YSC), platform (BACKEND/MOBILE/WEB), and assignee — all in one filter bar.</>,
              <><strong>Board</strong> view — four columns (To Do / In Progress / In Review / Done).</>,
              <><strong>List</strong> view — a sortable, filterable table.</>,
              <>Create a ticket from scratch with <strong>New Ticket</strong>, or from a bug&apos;s detail panel — the two stay linked both ways.</>,
            ]} />
          </SectionCard>

          <SectionCard id="faq" icon={<Lightbulb size={14} />} title="Tips & FAQ">
            <Bullets items={[
              <><strong>What are P0–P4?</strong> Severity levels: P0 is a catastrophic emergency, P1 is critical, P4 is low priority. P0 triggers the top alert banner and overrides all other priorities.</>,
              <><strong>What do BACKEND / MOBILE / WEB mean?</strong> The &quot;routing token&quot; — where a bug came from, which also decides which developer it&apos;s attributed to on the Developer tab.</>,
              <><strong>Why does a bug have no Jira ticket?</strong> Either it&apos;s still being triaged, it was suppressed by a rule, it&apos;s a duplicate, or ticket creation failed (look for a &quot;Jira Pending&quot; flag).</>,
              <><strong>What&apos;s the difference between a TIX-# and a real Jira ticket?</strong> TIX-# tickets are created directly in this dashboard. YSC-#/YSDT-# are real Jira tickets, either created by the automation or mirrored in from Jira.</>,
              <><strong>Something looks stuck or wrong.</strong> Hit the refresh icon in the top bar first — most tables auto-retry on their own, but a manual refresh always gets the latest.</>,
            ]} />
          </SectionCard>

        </div>
      </div>
    </div>
  )
}

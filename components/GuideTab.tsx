'use client'

import { useState } from 'react'
import {
  BarChart3, List, Layers, Activity, ShieldCheck, MessageSquare,
  Code2, FileText, Calendar, Ticket as TicketIcon, LayoutGrid, Lightbulb, BookOpen,
} from 'lucide-react'

const SECTIONS = [
  { id: 'welcome', label: 'Welcome', icon: <Lightbulb size={13} /> },
  { id: 'navigating', label: 'Navigating', icon: <LayoutGrid size={13} /> },
  { id: 'overview', label: 'Overview', icon: <BarChart3 size={13} /> },
  { id: 'bugs', label: 'Bug Reports', icon: <List size={13} /> },
  { id: 'clusters', label: 'Error Clusters', icon: <Layers size={13} /> },
  { id: 'pipeline', label: 'Pipeline', icon: <Activity size={13} /> },
  { id: 'triage', label: 'Triage & Rules', icon: <ShieldCheck size={13} /> },
  { id: 'feedback', label: 'Feedback', icon: <MessageSquare size={13} /> },
  { id: 'developer', label: 'Developer', icon: <Code2 size={13} /> },
  { id: 'reports', label: 'Reports', icon: <FileText size={13} /> },
  { id: 'daily', label: 'Daily Digest', icon: <Calendar size={13} /> },
  { id: 'tickets', label: 'Tickets', icon: <TicketIcon size={13} /> },
  { id: 'faq', label: 'Tips & FAQ', icon: <Lightbulb size={13} /> },
]

function Section({ id, icon, title, children }: { id: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 12, marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 'var(--r-md)', background: 'var(--orange-dim)', color: 'var(--orange)', flexShrink: 0 }}>
          {icon}
        </span>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif' }}>{title}</h2>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--tx-2)' }}>{children}</div>
    </section>
  )
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul style={{ margin: '8px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((it, i) => <li key={i} style={{ color: 'var(--tx-2)' }}>{it}</li>)}
    </ul>
  )
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, background: 'var(--orange-dim)', border: '1px solid rgba(249,115,22,.25)', borderRadius: 'var(--r-md)', padding: '10px 14px', margin: '10px 0' }}>
      <Lightbulb size={15} color="var(--orange)" style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 13, color: 'var(--tx-1)', lineHeight: 1.6 }}>{children}</span>
    </div>
  )
}

export default function GuideTab() {
  const [activeSection, setActiveSection] = useState('welcome')

  const jumpTo = (id: string) => {
    setActiveSection(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <BookOpen size={20} color="var(--orange)" />
        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif' }}>Guide — How to Use This Dashboard</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--tx-3)', marginBottom: 16, maxWidth: 760, lineHeight: 1.6 }}>
        A quick reference for what each part of the dashboard does. Jump to any section below, or just scroll.
      </p>

      {/* Jump-to pill nav */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 24, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 6 }}>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => jumpTo(s.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: activeSection === s.id ? 600 : 400,
              padding: '5px 10px', borderRadius: 'var(--r-sm)',
              background: activeSection === s.id ? 'var(--orange-dim)' : 'transparent',
              color: activeSection === s.id ? 'var(--orange)' : 'var(--tx-3)',
              border: 'none', cursor: 'pointer', transition: 'all .15s',
            }}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 780 }}>
        <Section id="welcome" icon={<Lightbulb size={15} />} title="Welcome">
          <p>
            The Yuzee Bug Dashboard is the control panel for the automated bug pipeline — Rollbar and CloudWatch
            catch errors, n8n triages them with Gemini AI and creates Jira tickets, and this dashboard is where the
            team reviews, filters, and acts on everything that pipeline produces. It also hosts a lightweight
            internal ticketing system (the <strong>Tickets</strong> tab) for work that isn&apos;t an automated bug report,
            including a mirror of your team&apos;s Jira tickets alongside it.
          </p>
        </Section>

        <Section id="navigating" icon={<LayoutGrid size={15} />} title="Navigating the dashboard">
          <p>All sections live in the sidebar on the left.</p>
          <Bullets items={[
            <>Click the <strong>«</strong> icon at the bottom of the sidebar to collapse it to icons-only — useful on smaller screens or when you want more room for a table. Your preference is remembered.</>,
            <>The colored dot or number badge next to a sidebar item flags something worth a look (e.g. bugs pending review, open tickets).</>,
            <>The top bar shows the current page, a small green/red dot for the live-update connection, and — on the right — the AI Analyse button (only when bugs are selected), the <strong>Legacy on/off</strong> toggle, refresh, and sign out.</>,
            <>The <strong>Legacy</strong> toggle switches whether bugs reported before 10 Jul 2026 are included — most days you can leave it off.</>,
            <>Every page has a small info banner like this one at the top explaining what it shows — click the chevron to collapse it once you know the page.</>,
          ]} />
        </Section>

        <Section id="overview" icon={<BarChart3 size={15} />} title="Overview">
          <p>The landing page — a single-screen health check of the whole pipeline.</p>
          <Bullets items={[
            'KPI cards for total bugs, P1/critical count, resolved rate, duplicates, and Jira coverage, with a time-range toggle.',
            'Daily bug volume chart, severity/status/routing/component breakdowns — all clickable, jumping straight to the matching bugs.',
            'AI Triage Pipeline and Internal Tickets summary widgets, each linking straight to their full tab.',
            'Actionable Insights — auto-generated callouts for things that need attention (Jira-pending tickets, a stalled pipeline, a spike in one component, etc).',
          ]} />
        </Section>

        <Section id="bugs" icon={<List size={15} />} title="Bug Reports">
          <p>The full, filterable table of every automated bug report.</p>
          <Bullets items={[
            'Use the filter bar to narrow by severity, platform, component, status, environment, Jira status, or duplicate flag — or just search by description, report ID, or Jira key.',
            'Click any row to open its detail panel: the AI triage summary, the raw Rollbar exception and stack trace, a pre-crash telemetry timeline, and quick links to Jira, Rollbar, CloudWatch, and session replay.',
            <>From that same panel you can re-queue a bug for AI triage, mark it resolved or duplicate, or <strong>create an Internal Ticket</strong> linked to it.</>,
          ]} />
          <Callout>Can&apos;t find a bug? Check whether the Legacy toggle in the top bar needs to be turned on — anything before 10 Jul 2026 is hidden by default.</Callout>
        </Section>

        <Section id="clusters" icon={<Layers size={15} />} title="Error Clusters">
          <p>
            Bugs are automatically grouped by a normalized version of their error message, so the same underlying
            failure shows up once instead of dozens of times.
          </p>
          <Bullets items={[
            'Filter by severity, routing (BACKEND/MOBILE/WEB), or component, and search by error text.',
            'Sort by most reports, highest severity, most recent, oldest, or component.',
            'Click "View N bugs →" on any cluster to jump to Bug Reports pre-filtered to that exact pattern.',
          ]} />
        </Section>

        <Section id="pipeline" icon={<Activity size={15} />} title="Pipeline">
          <p>Health of the automation itself, not the bugs it produces — three sub-views:</p>
          <Bullets items={[
            <><strong>Queue Health</strong> — how the Gemini AI triage queue is doing (queued/processed/stale/failed, average triage time), with a one-click re-queue for anything stuck.</>,
            <><strong>Data Quality</strong> — the pipeline&apos;s own self-check: missing correlation IDs, missing Jira keys, incomplete triage.</>,
            <><strong>CloudWatch</strong> — when each log group was last scanned, flagged if it&apos;s gone quiet for more than 15 minutes.</>,
          ]} />
        </Section>

        <Section id="triage" icon={<ShieldCheck size={15} />} title="Triage & Rules">
          <p>The governance layer behind the AI triage:</p>
          <Bullets items={[
            <><strong>Bug Rules</strong> — regex overrides that run before Gemini triage (force a severity, team, or suppress a ticket entirely).</>,
            <><strong>Triage Feedback</strong> — human corrections logged from Jira comments; enough of them (weight ≥ 3) auto-promotes into a permanent rule.</>,
            <><strong>Jira Comments</strong> — the full log of every comment the automation has read and acted on.</>,
          ]} />
        </Section>

        <Section id="feedback" icon={<MessageSquare size={15} />} title="Feedback">
          <p>
            In-app product feedback — a separate stream from automated bug reports, classified by sentiment and
            category. Filter by sentiment, category, or whether Gemini flagged it as actionable.
          </p>
        </Section>

        <Section id="developer" icon={<Code2 size={15} />} title="Developer">
          <p>
            Per-developer workload, worked out automatically from where a bug came from (routing), not manual
            assignment. Each card shows severity breakdown, Jira coverage, and open Internal Tickets assigned to them.
          </p>
        </Section>

        <Section id="reports" icon={<FileText size={15} />} title="Reports">
          <p>
            Deeper analytics for retrospectives: 30-day bug volume by severity, mean time to triage against a
            5-minute target, resolution rate and duplicate rate over 12 weeks, bugs by component (including a
            component × severity matrix) and platform, and P1/P2 response time. Most charts jump to the matching
            bugs when clicked. There&apos;s also an on-demand AI-generated standup summary.
          </p>
        </Section>

        <Section id="daily" icon={<Calendar size={15} />} title="Daily Digest">
          <p>
            Every night at 9 PM, an n8n workflow summarizes the last 24 hours of bugs with Gemini and saves a full
            HTML report to Supabase Storage — the same report posted to Microsoft Teams. This tab lists every report,
            most recent first, with an inline preview and a link to open it on its own.
          </p>
        </Section>

        <Section id="tickets" icon={<TicketIcon size={15} />} title="Tickets">
          <p>
            A lightweight, internal alternative to Jira for work that isn&apos;t an automated bug — refactors,
            investigations, anything the pipeline wouldn&apos;t generate on its own — shown alongside a mirror of your
            team&apos;s real Jira tickets.
          </p>
          <Bullets items={[
            <><strong>Board</strong> view — four columns (To Do / In Progress / In Review / Done); use the &quot;Move to →&quot; button on a card to advance it.</>,
            <><strong>List</strong> view — a sortable, filterable table if you prefer rows over cards.</>,
            'Click a ticket to open its detail panel: edit the title, description, and labels; change status, priority, assignee, or type (each change is logged); leave comments; and, if it was created from a bug, jump straight back to that bug.',
            <>Create a ticket from scratch with <strong>New Ticket</strong>, or from a bug&apos;s own detail panel with <strong>Create Internal Ticket</strong> — the two stay linked both ways.</>,
            <>Tickets synced in from Jira are clearly marked and link back to the real ticket — use the toggle to hide them if you only want to see internally-created work.</>,
          ]} />
        </Section>

        <Section id="faq" icon={<Lightbulb size={15} />} title="Tips & FAQ">
          <Bullets items={[
            <><strong>What are P1–P4?</strong> Severity, used everywhere: P1 is critical, P4 is low priority.</>,
            <><strong>What do BACKEND / MOBILE / WEB mean?</strong> The &quot;routing token&quot; — where a bug came from, which also decides which developer it&apos;s attributed to on the Developer tab.</>,
            <><strong>Why does a bug have no Jira ticket?</strong> Either it&apos;s still being triaged, it was suppressed by a rule, it&apos;s a duplicate, or ticket creation failed (look for a &quot;Jira Pending&quot; flag — that always means a manual retry is needed).</>,
            <><strong>What&apos;s the difference between a TIX-# and a real Jira ticket?</strong> TIX-# tickets are created directly in this dashboard. YSC-#/YSDT-# are real Jira tickets, either created by the automation or mirrored in from Jira.</>,
            <><strong>Something looks stuck or wrong.</strong> Hit the refresh icon in the top bar first — most tables auto-retry on their own, but a manual refresh always gets the latest.</>,
          ]} />
        </Section>
      </div>
    </div>
  )
}

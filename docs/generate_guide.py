# -*- coding: utf-8 -*-
"""
Generates the full Yuzee Bug Dashboard guide PDF.
Run: python generate_guide.py
"""
import os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    PageBreak, NextPageTemplate, FrameBreak, KeepTogether, ListFlowable, ListItem,
    HRFlowable,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfgen import canvas as canvas_mod

OUT_PATH = os.path.join(os.path.dirname(__file__), "Yuzee_Bug_Dashboard_Guide.pdf")

# ─────────────────────────────────────────────────────────────────────────────
# Palette — professional, print-safe (light background, dark text). All pairs
# below meet at least WCAG AA (4.5:1) for body text / 3:1 for large text.
# ─────────────────────────────────────────────────────────────────────────────
INK        = colors.HexColor("#1e2430")   # primary body text
INK_SOFT   = colors.HexColor("#475467")   # secondary text
PAPER      = colors.HexColor("#ffffff")
PAPER_TINT = colors.HexColor("#f5f6fa")   # zebra / callout background
BORDER     = colors.HexColor("#d7dbe3")

INDIGO      = colors.HexColor("#312e81")  # section headers / TOC
INDIGO_MID  = colors.HexColor("#4338ca")  # H2
INDIGO_SOFT = colors.HexColor("#eef0fc")  # light tint backgrounds
SLATE_HEAD  = colors.HexColor("#334155")  # table header bg
ACCENT      = colors.HexColor("#4f46e5")  # links / accents

P1_RED    = colors.HexColor("#b91c1c")
P2_AMBER  = colors.HexColor("#b45309")
P3_BLUE   = colors.HexColor("#1d4ed8")
P4_GRAY   = colors.HexColor("#4b5563")
SUCCESS   = colors.HexColor("#15803d")
WARNING_BG = colors.HexColor("#fff7ed")
WARNING_BD = colors.HexColor("#fdba74")
WARNING_TX = colors.HexColor("#9a3412")

PAGE_W, PAGE_H = LETTER
MARGIN = 0.85 * inch
CONTENT_W = PAGE_W - 2 * MARGIN

# ─────────────────────────────────────────────────────────────────────────────
# Styles
# ─────────────────────────────────────────────────────────────────────────────
ss = getSampleStyleSheet()

def style(name, base='Normal', **kw):
    s = ParagraphStyle(name, parent=ss[base], **kw)
    ss.add(s, alias=name)
    return s

style('CoverTitle', fontName='Helvetica-Bold', fontSize=30, leading=36, textColor=INDIGO, spaceAfter=10, alignment=TA_LEFT)
style('CoverSubtitle', fontName='Helvetica', fontSize=14, leading=20, textColor=INK_SOFT, spaceAfter=6)
style('CoverMeta', fontName='Helvetica', fontSize=10.5, leading=16, textColor=INK_SOFT)

style('H1', fontName='Helvetica-Bold', fontSize=19, leading=24, textColor=INDIGO, spaceBefore=4, spaceAfter=12)
style('H2', fontName='Helvetica-Bold', fontSize=13.5, leading=18, textColor=INDIGO_MID, spaceBefore=16, spaceAfter=8)
style('H3', fontName='Helvetica-Bold', fontSize=11, leading=15, textColor=SLATE_HEAD, spaceBefore=10, spaceAfter=5)

style('Body', fontName='Helvetica', fontSize=9.7, leading=14.5, textColor=INK, spaceAfter=7, alignment=TA_LEFT)
style('BodySmall', fontName='Helvetica', fontSize=8.7, leading=12.5, textColor=INK_SOFT, spaceAfter=5)
style('BulletItem', fontName='Helvetica', fontSize=9.5, leading=14, textColor=INK, spaceAfter=3)
style('Mono', fontName='Courier', fontSize=8.3, leading=12, textColor=INDIGO_MID)
style('MonoCell', fontName='Courier', fontSize=7.8, leading=10.5, textColor=INK)
style('TableHead', fontName='Helvetica-Bold', fontSize=8.4, leading=11, textColor=colors.white)
style('TableBody', fontName='Helvetica', fontSize=8.4, leading=11.5, textColor=INK)
style('Caption', fontName='Helvetica-Oblique', fontSize=8.3, leading=11, textColor=INK_SOFT, spaceBefore=3, spaceAfter=10)
style('TOCHeading', fontName='Helvetica-Bold', fontSize=22, leading=26, textColor=INDIGO, spaceAfter=16)

toc_style_l1 = ParagraphStyle('TOC1', fontName='Helvetica-Bold', fontSize=11, leading=16, textColor=INDIGO, leftIndent=0)
toc_style_l2 = ParagraphStyle('TOC2', fontName='Helvetica', fontSize=9.5, leading=14, textColor=INK_SOFT, leftIndent=14)

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def mono_id(identifier):
    return f'<font face="Courier" size="7.6">{identifier}</font>'

def p(text, s='Body'):
    return Paragraph(text, ss[s])

def h1(text):
    return [Paragraph(text, ss['H1']), HRFlowable(width="100%", thickness=1.4, color=INDIGO, spaceAfter=10)]

def h2(text):
    return Paragraph(text, ss['H2'])

def h3(text):
    return Paragraph(text, ss['H3'])

def callout(text, kind='info'):
    bg, bd, tx = (WARNING_BG, WARNING_BD, WARNING_TX) if kind == 'warning' else (INDIGO_SOFT, colors.HexColor("#c7d2fe"), INDIGO)
    t = Table([[Paragraph(text, ParagraphStyle('callout', fontName='Helvetica', fontSize=9, leading=13, textColor=tx))]],
              colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg),
        ('BOX', (0, 0), (-1, -1), 0.75, bd),
        ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    return t

def badge_text(label, color):
    return f'<font color="{color.hexval()[2:] if hasattr(color, "hexval") else color}"><b>{label}</b></font>'

def make_table(headers, rows, col_widths, small_font=8.2, header_bg=SLATE_HEAD, zebra=True, cell_style='TableBody'):
    """All cells are Paragraphs so long text wraps instead of overflowing."""
    head_style = ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=small_font + 0.2, leading=small_font + 3.2, textColor=colors.white)
    body_style = ss[cell_style]
    if body_style.fontSize != small_font:
        body_style = ParagraphStyle('tb_local', parent=body_style, fontSize=small_font, leading=small_font + 3.4)

    def cell(v, s):
        # Pass already-built flowables (e.g. a Paragraph with inline <b>/<font> markup)
        # through untouched — wrapping a Paragraph in str() prints its Python repr, not its text.
        return v if hasattr(v, 'wrap') else Paragraph(str(v), s)

    data = [[cell(h, head_style) for h in headers]]
    for row in rows:
        data.append([cell(c, body_style) for c in row])

    t = Table(data, colWidths=col_widths, repeatRows=1)
    cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), header_bg),
        ('LINEBELOW', (0, 0), (-1, 0), 1, header_bg),
        ('BOX', (0, 0), (-1, -1), 0.6, BORDER),
        ('INNERGRID', (0, 0), (-1, -1), 0.4, BORDER),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]
    if zebra:
        for i in range(1, len(data)):
            if i % 2 == 0:
                cmds.append(('BACKGROUND', (0, i), (-1, i), PAPER_TINT))
    t.setStyle(TableStyle(cmds))
    return t

def bullets(items, style_name='BulletItem'):
    return ListFlowable(
        [ListItem(Paragraph(it, ss[style_name]), leftIndent=6, spaceAfter=3) for it in items],
        bulletType='bullet', start='•', bulletFontSize=7, bulletColor=INDIGO_MID, leftIndent=14,
    )

# ─────────────────────────────────────────────────────────────────────────────
# Document template w/ header, footer, page numbers, and TOC bookmark hooks
# ─────────────────────────────────────────────────────────────────────────────
class GuideDocTemplate(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            text = flowable.getPlainText()
            style_name = flowable.style.name
            if style_name == 'H1':
                self.notify('TOCEntry', (0, text, self.page))
                key = f'h1-{text}'
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level=0, closed=False)
            elif style_name == 'H2':
                self.notify('TOCEntry', (1, text, self.page))
                key = f'h2-{text}-{self.page}'
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level=1, closed=True)


def draw_header_footer(canv: canvas_mod.Canvas, doc):
    canv.saveState()
    # Footer
    canv.setStrokeColor(BORDER)
    canv.setLineWidth(0.6)
    canv.line(MARGIN, 0.62 * inch, PAGE_W - MARGIN, 0.62 * inch)
    canv.setFont('Helvetica', 8)
    canv.setFillColor(INK_SOFT)
    canv.drawString(MARGIN, 0.45 * inch, "Yuzee Bug Dashboard — Complete Guide & Reference")
    canv.drawRightString(PAGE_W - MARGIN, 0.45 * inch, f"Page {doc.page}")
    canv.restoreState()


def draw_cover(canv, doc):
    canv.saveState()
    canv.setFillColor(INDIGO)
    canv.rect(0, PAGE_H - 2.1 * inch, PAGE_W, 2.1 * inch, stroke=0, fill=1)
    canv.setFillColor(colors.white)
    canv.setFont('Helvetica-Bold', 9)
    canv.drawString(MARGIN, PAGE_H - 0.55 * inch, "INTERNAL ENGINEERING DOCUMENTATION")
    canv.restoreState()


frame_full = Frame(MARGIN, MARGIN, CONTENT_W, PAGE_H - 2 * MARGIN, id='full')
frame_cover = Frame(MARGIN, MARGIN, CONTENT_W, PAGE_H - 2.6 * inch, id='cover')

doc = GuideDocTemplate(OUT_PATH, pagesize=LETTER,
                       leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN,
                       title="Yuzee Bug Dashboard — Complete Guide & Reference", author="Yuzee Engineering")
doc.addPageTemplates([
    PageTemplate(id='Cover', frames=[frame_cover], onPage=draw_cover),
    PageTemplate(id='Normal', frames=[frame_full], onPage=draw_header_footer),
])

toc = TableOfContents()
toc.levelStyles = [toc_style_l1, toc_style_l2]

story = []

# ═══════════════════════════════════════════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════════════════════════════════════════
story += [
    Spacer(1, 0.55 * inch),
    Paragraph("Yuzee Bug Dashboard", ss['CoverTitle']),
    Paragraph("Complete Guide &amp; Reference", ss['CoverSubtitle']),
    Spacer(1, 0.35 * inch),
    Paragraph(
        "A single reference for how the dashboard works end to end: the automated bug pipeline it observes "
        "(Rollbar, CloudWatch, Jira, Gemini, n8n), every tab in the UI, the Supabase schema behind it, the "
        "security model, and a full change log of what has been built and why.",
        ss['Body']
    ),
    Spacer(1, 0.5 * inch),
    Paragraph("Prepared for: Yuzee Engineering (ashik@yuzee.com)", ss['CoverMeta']),
    Paragraph("Covers dashboard state as of: 21 July 2026", ss['CoverMeta']),
    Paragraph("Document version: 1.0", ss['CoverMeta']),
]
story.append(NextPageTemplate('Normal'))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# TABLE OF CONTENTS
# ═══════════════════════════════════════════════════════════════════════════
story.append(Paragraph("Contents", ss['TOCHeading']))
story.append(toc)
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# 1. EXECUTIVE SUMMARY
# ═══════════════════════════════════════════════════════════════════════════
story += h1("1. Executive Summary")
story.append(p(
    "The Yuzee Bug Dashboard is an internal, admin-only Next.js application that gives the engineering team a "
    "single place to observe, triage, and act on the automated bug-tracking pipeline. It reads live from a "
    "Supabase Postgres database that the n8n automation layer writes to continuously, and it now also hosts a "
    "lightweight internal ticketing system for work that isn't an automated bug report."
))
story.append(p(
    "The dashboard does not replace Rollbar, CloudWatch, Jira, or Gemini — it is the human-facing control panel "
    "that sits on top of the data those systems (and the n8n workflows that connect them) produce."
))
story.append(h2("Who it's for"))
story.append(bullets([
    "<b>Ashik</b> — admin, oversees the whole pipeline and the engineering team's workload.",
    "<b>Junaid</b> (Backend), <b>Shaqeeba</b> (Mobile), <b>Ramzan</b> (Web), <b>Asif</b> (AI/Data) — the four engineers whose "
    "work is routed to them automatically based on where a bug originates.",
]))
story.append(h2("Tech stack"))
story.append(bullets([
    "Next.js 16 (App Router) + React 19 + TypeScript, deployed with a single admin login (custom cookie session, not Supabase Auth).",
    "Supabase Postgres for all data, read and written directly from the browser via the anon key, gated by row-level security (RLS) policies rather than Supabase Auth roles.",
    "Recharts for all analytics charts; lucide-react for icons; no CSS framework — a hand-built dark design system using CSS custom properties.",
    "Gemini (2.5 Flash / Flash-Lite) for AI triage, summaries, and comment classification, called from n8n and from the dashboard's own AI Analysis panel.",
]))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# 2. ARCHITECTURE & DATA PIPELINE
# ═══════════════════════════════════════════════════════════════════════════
story += h1("2. Architecture &amp; Data Pipeline")
story.append(p(
    "Six n8n workflows populate and maintain the data the dashboard displays. Understanding what each one does "
    "makes the dashboard's tabs much easier to read — most tabs are a direct window onto one or two of these workflows."
))

workflows = [
    ("Bug Automation", "Rollbar webhook → Jira",
     "Normalizes an incoming Rollbar error, checks suppression rules and duplicates, applies bug_rules overrides, "
     "runs Gemini AI triage if no rule fully covers it, decides whether to create/deduplicate/suppress a ticket, "
     "writes the enriched row to bug_reports, and creates the Jira ticket (plus a linked YSDT ticket for P1/P2)."),
    ("Daily Bug Report", "Cron 9 PM daily",
     "Aggregates the last 24h/7d of bug_reports into KPIs, generates a full HTML report with Gemini, uploads it, "
     "and posts a summary card to Microsoft Teams. (The dashboard's Daily Digest tab is ready to display this once "
     "a daily_bug_reports table is added to persist it — see §7.)"),
    ("CloudWatch Bug Poller", "Cron every 10 minutes",
     "Scans each active CloudWatch log group (tracked in cw_scan_state) for new errors, fingerprints and "
     "deduplicates them, and forwards new ones into the same Bug Automation intake as Rollbar errors."),
    ("Rule Promoter", "Cron midnight",
     "Looks for triage_feedback corrections with enough confidence (weight ≥ 3) and automatically promotes "
     "them into permanent bug_rules, so the same human correction doesn't have to be made twice."),
    ("Feedback Automation", "Webhook /feedback-intake",
     "Accepts in-app user feedback (not bug reports), classifies it with Gemini, creates a Jira ticket by category "
     "(Bug / Feature Request / Support), and stores everything in feedback_reports."),
    ("Jira Comment Watcher", "Cron every 5 minutes",
     "Reads new comments on auto-created Jira tickets, classifies intent with Gemini (mark duplicate / reclassify "
     "team / change severity / close / no action), takes the corresponding action on the ticket, and logs every "
     "comment it processes to jira_comment_actions."),
]
rows = [[Paragraph(f"<b>{n}</b><br/><font size=7.5 color='#475467'>{t}</font>", ss['TableBody']),
         Paragraph(d, ss['TableBody'])] for n, t, d in workflows]
story.append(make_table(["Workflow", "What it does"], rows, col_widths=[1.55 * inch, CONTENT_W - 1.55 * inch]))
story.append(Spacer(1, 10))

story.append(h2("External systems"))
story.append(bullets([
    "<b>Rollbar</b> — automatic error capture for backend (Java/Spring) and web/mobile clients; source of session replay and stack traces.",
    "<b>AWS CloudWatch</b> — backend log groups polled for errors Rollbar doesn't catch directly.",
    "<b>Jira (YSC / YSDT)</b> — ticket of record; YSC holds every bug, YSDT only P1/P2 with an assignee.",
    "<b>Gemini</b> — AI triage, summaries, comment classification, and the dashboard's on-demand AI Analysis panel.",
    "<b>PostHog</b> — session recording integration; wired into the schema but not yet populated by the pipeline (see §7).",
]))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# 3. TAB-BY-TAB WALKTHROUGH
# ═══════════════════════════════════════════════════════════════════════════
story += h1("3. Tab-by-Tab Walkthrough")
story.append(p("The dashboard has ten top-level tabs, in the order they appear in the navigation bar (which scrolls "
                "horizontally rather than wrapping, so it never breaks the header layout)."))

def tab_section(number, name, purpose, details, subtabs=None):
    story.append(h2(f"3.{number}  {name}"))
    story.append(p(purpose))
    story.append(bullets(details))
    if subtabs:
        story.append(Spacer(1, 3))
        story.append(p(f"<b>Sub-views:</b> {subtabs}", 'BodySmall'))
    story.append(Spacer(1, 6))

tab_section(1, "Overview", "The landing page — a single-screen health check of the whole pipeline.", [
    "KPI row: total bugs, P1/critical count, resolved rate, duplicates, Jira coverage, pending review — with a This Week / This Month / Last 3 Months range toggle.",
    "Daily bug volume chart (7/14/30-day toggle), severity/status/routing/component distribution bars.",
    "AI Triage Pipeline widget (queued/processed/stale/failed counts, average triage time, stuck-item warning with one-click re-queue).",
    "Internal Tickets widget — open/in-progress/in-review/done counts with a direct link into the Tickets board.",
    "Jira Spaces panel, Actionable Insights (auto-generated: Jira-pending alerts, pipeline stalls, component spikes, duplicate rate), and Top Error Clusters.",
])
tab_section(2, "Bug Reports", "The full, filterable table of every row in bug_reports, with a detailed side panel per bug.", [
    "Filter bar: severity, platform/routing, component, source, status, environment, has-Jira, duplicate, Jira-pending, plus free-text search and a date range.",
    "25-row pagination; every column is sortable; each row shows severity, routing, component, description + AI summary, source, device, environment, Jira link, Rollbar link, relative time, and flags.",
    "Clicking a row opens a side panel with: AI triage detail, the raw Rollbar exception and stack trace, the pre-crash telemetry timeline, active feature flags, debug links (correlation ID → CloudWatch, Rollbar session replay, PostHog), and manual actions (re-queue for AI triage, mark resolved, mark duplicate, create or view a linked Internal Ticket).",
])
tab_section(3, "Error Clusters", "Bugs grouped by a normalized version of their description, so repeated failures show up as one entry instead of dozens.", [
    "Each cluster shows its dominant severity, routing token, most common component, occurrence count, and first/last seen dates.",
    "“View N bugs →” jumps to Bug Reports pre-filtered to that exact error pattern; clusters can also be sent straight to the AI Analysis panel.",
])
tab_section(4, "Pipeline", "System health for the automation itself, not the bugs it produces.", [
    "<b>Queue Health</b> — gemini_queue counts (queued/processed/stale/failed) over the last 7 days, average triage time against a 5-minute target, and a re-queue action for anything stuck.",
    "<b>Data Quality</b> — counts of missing correlation IDs, missing Jira keys, incomplete AI triage, and unclassified components — the pipeline's own self-check.",
    "<b>CloudWatch</b> — every polled log group's last-scanned time (flagged if stale ≥ 15 min) and 24h error count (flagged if ≥ 10).",
], subtabs="Queue Health · Data Quality · CloudWatch")
tab_section(5, "Triage &amp; Rules", "The governance layer behind the AI triage — what rules exist, what humans have corrected, and what the Jira comment bot has done.", [
    "<b>Bug Rules</b> — every regex override that runs before Gemini triage, with priority, forced fields, and an enabled/disabled state.",
    "<b>Triage Feedback</b> — human corrections logged from Jira comments, each with a weight; weight ≥ 3 auto-promotes into a permanent Bug Rule.",
    "<b>Jira Comments</b> — the full log of every comment the automation has classified and acted on, with a 7-day intent-count summary at the top.",
], subtabs="Bug Rules · Triage Feedback · Jira Comments")
tab_section(6, "Feedback", "In-app product feedback (a separate stream from automated bug reports).", [
    "Sentiment, category, actionable, severity, and Jira-linkage filters over feedback_reports.",
    "Currently empty in production (0 submissions to date) — the tab shows an explicit, friendly empty state rather than a blank table.",
])
tab_section(7, "Developer", "Per-developer workload, derived automatically from routing (not manual assignment).", [
    "Each of the four engineers gets a card: severity breakdown, bugs with no Jira ticket, Jira-pending failures, and — as of this update — an open Internal Tickets count with a link into the board.",
    "A team summary table ranks developers by P1 load, then total volume.",
])
tab_section(8, "Reports", "Deeper analytics for retrospectives and reporting upward.", [
    "Six charts: 30-day bug volume by severity, mean time to triage vs. a 5-minute target, resolution rate over 12 weeks, bugs by component, bugs by platform/routing (donut), and P1/P2 response time (creation → Jira ticket) by week.",
    "An on-demand AI-generated standup summary via Gemini, rate-limited client-side.",
])
tab_section(9, "Daily Digest", "Placeholder for the nightly HTML report the Daily Bug Report workflow already generates and posts to Teams.", [
    "Shows a clear explanation rather than an error when the daily_bug_reports table doesn't exist yet (it doesn't, today) — see §7 for what's needed to activate it.",
])
tab_section(10, "Tickets", "A lightweight, internal Jira-alternative for work that isn't an automated bug — refactors, investigations, anything the pipeline wouldn't generate on its own.", [
    "<b>Board</b> — a four-column Kanban (To Do / In Progress / In Review / Done); each card shows key, title, priority, type, and assignee, with a one-click “move to next status” action.",
    "<b>List</b> — a sortable/filterable table (status, priority, assignee, type) with the same columns plus created/updated timestamps and a linked-bug column.",
    "Every ticket has its own detail panel: editable title/description/labels, status/priority/assignee/type dropdowns (each change is written through immediately and recorded in an activity log), a comment thread, and — if it was created from a bug — a live link back to that bug's own detail panel.",
    "Tickets can be created from scratch (“New Ticket”) or directly from a bug's detail panel (“Create Internal Ticket”, which pre-fills title/description/priority and links the two records together both ways).",
], subtabs="Board · List")
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# 4. DATABASE SCHEMA REFERENCE
# ═══════════════════════════════════════════════════════════════════════════
story += h1("4. Database Schema Reference")
story.append(p("All tables live in the public schema of the spqgjumefasdmgeeokgv Supabase project. This is a summary "
               "of purpose and scale, not the full column list (see CLAUDE.md in the repository for that)."))

tables = [
    ("bug_reports", "~330+", "The central table. Every automated bug from Rollbar/CloudWatch lands here after full AI triage — severity, ownership, ticketability scoring, device/browser context, Rollbar replay pointers, feature flags at crash time, and the Jira ticket it produced."),
    ("gemini_queue", "~75", "Tracks each bug's AI-triage request lifecycle: queued → processed (observed statuses in production today), with timing used for the Pipeline tab's throughput metrics."),
    ("bug_rules", "9", "Regex-based overrides applied before Gemini triage — force a severity/category/team/owner, or suppress ticket creation entirely."),
    ("triage_feedback", "5", "Human corrections extracted from Jira comments; weight ≥ 3 auto-promotes into bug_rules."),
    ("jira_comment_actions", "100+", "Log of every Jira comment the automation has classified and acted on."),
    ("cw_scan_state", "13", "Last-scanned bookkeeping per CloudWatch log group, used to detect a stalled poller."),
    ("feedback_reports", "0 (live)", "In-app product feedback, separate from bug_reports; AI-classified by category/sentiment."),
    ("bug_suppression_rules", "0 (live)", "Pattern-based rules that stop a bug from ever creating a ticket."),
    ("internal_tickets", "new", "This session's addition — the Jira-alternative ticket record: key, title, description, type, status, priority, assignee, labels, and an optional link to a bug_reports row."),
    ("internal_ticket_comments", "new", "Comment thread per internal ticket."),
    ("internal_ticket_activity", "new", "Field-change audit log per internal ticket (status/priority/assignee/type transitions)."),
]
rows = [[Paragraph(mono_id(n), ss['TableBody']), r, d] for n, r, d in tables]
story.append(make_table(["Table", "Rows", "Purpose"], rows, col_widths=[1.75 * inch, 0.5 * inch, CONTENT_W - 2.25 * inch]))
story.append(Spacer(1, 10))
story.append(callout(
    "<b>Note on internal_tickets.ticket_key</b> — auto-generated as <font face='Courier'>TIX-1</font>, "
    "<font face='Courier'>TIX-2</font>, ... via a Postgres sequence and a BEFORE INSERT trigger, deliberately using "
    "a different prefix than Jira's YSC/YSDT so nobody mistakes an internal ticket for a real Jira ticket.",
    kind='info'
))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# 5. SECURITY & ACCESS MODEL
# ═══════════════════════════════════════════════════════════════════════════
story += h1("5. Security &amp; Access Model")
story.append(p(
    "The dashboard's authentication is a single shared admin login (username/password checked server-side, stored "
    "as an HttpOnly cookie) — it is <b>not</b> Supabase Auth. Because of that, every read and write the browser "
    "makes to Supabase goes through the public anon key, which means row-level security (RLS) policies — not "
    "application roles — are the only thing standing between “logged into the dashboard” and “can "
    "read/write this table.”"
))
story.append(h2("What each table allows"))
rows = [
    ["bug_reports", "SELECT", "Pre-existing. Dashboard never writes new bug rows directly; it does update status/is_duplicate on existing rows."],
    ["gemini_queue", "SELECT, INSERT, UPDATE, DELETE (ALL)", "Pre-existing, broad by necessity (n8n and the dashboard both write here); flagged by Supabase's own advisor as permissive — not changed by this project."],
    ["bug_rules / triage_feedback / jira_comment_actions / cw_scan_state / feedback_reports", "SELECT only", "Added this project (previously had zero policies — fully unreadable). Read-only was a deliberate, narrower choice than gemini_queue's pattern."],
    ["internal_tickets / internal_ticket_comments / internal_ticket_activity", "SELECT, INSERT, UPDATE (no DELETE)", "Added this session so the Tickets tab can create/edit tickets and comments. No delete policy — closing work out is modeled as a status change (“Done”), not row removal."],
]
story.append(make_table(["Table(s)", "Anon-key access", "Why"], rows, col_widths=[1.7*inch, 1.15*inch, CONTENT_W - 2.85*inch], small_font=7.8))
story.append(Spacer(1, 10))
story.append(callout(
    "Every RLS change in this project has been applied only after explicit, in-the-moment sign-off — "
    "read-only grants and read/write grants alike. None grant DELETE, and none were widened beyond what the "
    "corresponding UI feature actually needs.", kind='info'
))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# 6. CHANGE LOG
# ═══════════════════════════════════════════════════════════════════════════
story += h1("6. Change Log")

story.append(h2("Session 1 — Pipeline schema catch-up + five new tabs"))
story.append(bullets([
    "Verified the live schema directly rather than trusting either the previous CLAUDE.md or a new prompt file — both were stale in places (e.g. gemini_queue's real status values didn't match what either document claimed).",
    "Extended the BugReport TypeScript type with ~30 real columns that existed live but weren't yet modeled (device/browser info, Rollbar replay fields, feature flags, ownership fields, ticketability scoring).",
    "Fixed a real bug: the “Session Replay” quick-link was wired to a PostHog field that's null on every row; added a proper Rollbar replay URL builder and verified it against a bug with real replay data.",
    "Added read-only RLS policies (with explicit sign-off) so five previously-unreadable tables could be surfaced: bug_rules, triage_feedback, jira_comment_actions, cw_scan_state, feedback_reports.",
    "Built five new pieces of UI: a Triage &amp; Rules tab (3 sub-views), a CloudWatch pane inside Pipeline, a Feedback tab, and a Daily Digest placeholder tab — plus the nav bar was made horizontally scrollable to fit the growing tab count without breaking the layout.",
]))

story.append(h2("Session 2 — Internal Tickets (“Jira-lite”) + this guide"))
story.append(bullets([
    "Added a full internal ticketing system: three new tables (internal_tickets, internal_ticket_comments, internal_ticket_activity), a Kanban board, a list view, a detail panel with comments and an activity log, and a creation modal.",
    "Wired it into the rest of the dashboard rather than leaving it standalone: a bug's detail panel can create or jump to its linked ticket; the Overview tab shows a ticket-status summary; each Developer card shows their open ticket count.",
    "Added read/write RLS policies (SELECT/INSERT/UPDATE, no DELETE, with explicit sign-off) so the ticket feature can actually persist data through the same anon-key model the rest of the dashboard uses.",
    "Produced this document.",
]))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# 7. KNOWN LIMITATIONS / OUT OF SCOPE
# ═══════════════════════════════════════════════════════════════════════════
story += h1("7. Known Limitations &amp; Out of Scope")
story.append(bullets([
    "<b>Daily Digest</b> is a placeholder until a daily_bug_reports table is added and the Daily Bug Report n8n workflow is updated to write its stats + HTML there instead of only posting to Teams.",
    "<b>PostHog session replay</b> is modeled in the schema (posthog_session_url, posthog_session_id) but not yet populated by the pipeline — the dashboard will pick it up automatically once it is.",
    "<b>Internal Tickets</b> deliberately does not replicate: sprints/epics, story points, file attachments, per-ticket permissions, email notifications, or custom workflows/fields. It covers issue CRUD, a four-status workflow, assignee/priority/type/labels, comments, and a field-change activity log — enough for lightweight internal tracking without becoming a second Jira to maintain.",
    "<b>No drag-and-drop</b> on the ticket board by design — status changes are a single click (“Move to →”), which avoids pulling in a drag-and-drop dependency for a feature this size.",
]))
story.append(Spacer(1, 14))
story.append(h2("Glossary"))
gloss = [
    ("P1–P4", "Severity scale used everywhere in the dashboard (bugs, feedback, and tickets): P1 critical → P4 low."),
    ("Routing token", "BACKEND / MOBILE / WEB — derived automatically from a bug's platform/category, used to assign it to a developer."),
    ("Ticketability score", "Gemini's own confidence that a bug is worth creating a Jira ticket for, vs. deduplicating or suppressing it."),
    ("TIX-#", "Internal ticket key, distinct from Jira's YSC-#/YSDT-# so the two systems are never confused."),
]
rows = [[Paragraph(f"<b>{a}</b>", ss['TableBody']), b] for a, b in gloss]
story.append(make_table(["Term", "Meaning"], rows, col_widths=[1.3*inch, CONTENT_W - 1.3*inch]))

# ─────────────────────────────────────────────────────────────────────────────
doc.multiBuild(story)
print(f"Wrote {OUT_PATH}")

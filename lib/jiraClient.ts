const JIRA_BASE  = process.env.JIRA_BASE_URL || 'https://yuzeeau.atlassian.net'
const JIRA_EMAIL = process.env.JIRA_EMAIL    || ''
const JIRA_KEY    = process.env.JIRA_API_KEY  || ''

export function jiraConfigured(): boolean {
  return !!JIRA_KEY
}

export function jiraAuthHeaders(): Record<string, string> {
  return {
    Authorization: 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_KEY}`).toString('base64'),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

export function jiraBrowseUrl(key: string): string {
  return `${JIRA_BASE}/browse/${key}`
}

export interface JiraSearchResult {
  issues: Array<{
    key: string
    fields: Record<string, unknown>
  }>
  nextPageToken?: string
  isLast?: boolean
}

/**
 * The legacy GET/POST /rest/api/3/search endpoint returns 410 Gone as of the
 * Atlassian migration (developer.atlassian.com/changelog/#CHANGE-2046).
 * The replacement, POST /rest/api/3/search/jql, drops the cheap `total` count —
 * pagination is cursor-based (`nextPageToken`/`isLast`) instead of `startAt`/`total`.
 */
export async function searchJiraJql(jql: string, fields: string[], maxResults = 50, nextPageToken?: string): Promise<JiraSearchResult> {
  const res = await fetch(`${JIRA_BASE}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: jiraAuthHeaders(),
    body: JSON.stringify({ jql, fields, maxResults, ...(nextPageToken ? { nextPageToken } : {}) }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Jira search/jql ${res.status}: ${text.slice(0, 300)}`)
  }

  return res.json()
}

/** Pages through searchJiraJql until isLast, capped at maxPages as a runaway guard. */
export async function searchJiraJqlAll(jql: string, fields: string[], pageSize = 100, maxPages = 20): Promise<Array<{ key: string; fields: Record<string, unknown> }>> {
  const all: Array<{ key: string; fields: Record<string, unknown> }> = []
  let token: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const res = await searchJiraJql(jql, fields, pageSize, token)
    all.push(...res.issues)
    if (res.isLast || !res.nextPageToken) break
    token = res.nextPageToken
  }
  return all
}

export { JIRA_BASE }

/**
 * GoHighLevel CRM helpers used by both the Clerk and Stripe webhooks.
 * All functions are no-ops when GHL_API_KEY is not set.
 */

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

function apiKey(): string | null {
  return process.env.GHL_API_KEY ?? null
}

function locationId(): string {
  return process.env.GHL_LOCATION_ID ?? '3rXkjhSCKHbyMoFFgvek'
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
    Version: GHL_VERSION,
  }
}

/** Map our internal plan names to the GHL tag we apply on upgrade. */
export function planToGhlTag(plan: string): string | null {
  const map: Record<string, string> = {
    starter: 'IgualAI Starter',
    pro: 'IgualAI Pro',
    growth: 'IgualAI Business',
    max: 'IgualAI Max',
  }
  return map[plan] ?? null
}

/**
 * Find a GHL contact ID by email address.
 * Returns the contact ID string, or null if not found / on error.
 */
export async function ghlFindContactByEmail(email: string): Promise<string | null> {
  if (!apiKey()) {
    console.log('[GHL] Skipping ghlFindContactByEmail — GHL_API_KEY not set')
    return null
  }

  const url = `${GHL_BASE}/contacts/?locationId=${locationId()}&email=${encodeURIComponent(email)}`
  console.log('[GHL] Looking up contact by email:', email)

  try {
    const res = await fetch(url, { method: 'GET', headers: headers() })
    const text = await res.text()
    console.log('[GHL] Find contact response:', res.status, text)

    if (!res.ok) {
      console.error('[GHL] Find contact failed:', res.status, text)
      return null
    }

    const data = JSON.parse(text)
    const contactId = data.contacts?.[0]?.id ?? null
    console.log('[GHL] Found contact id:', contactId)
    return contactId
  } catch (err) {
    console.error('[GHL] Find contact error:', err)
    return null
  }
}

/**
 * Create a new GHL contact.
 * If GHL returns a 400 duplicate-contact error (contactId in meta), falls back
 * to adding only the "IgualAI Lead" tag to the existing contact instead.
 * Returns the contact ID (new or existing), or null on error.
 */
export async function ghlCreateContact(
  email: string,
  firstName: string,
  lastName: string,
  tags: string[]
): Promise<string | null> {
  if (!apiKey()) {
    console.log('[GHL] Skipping ghlCreateContact — GHL_API_KEY not set')
    return null
  }

  const payload = {
    locationId: locationId(),
    email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    tags,
  }

  console.log('[GHL] Creating contact:', JSON.stringify(payload))

  let res: Response
  let responseText: string
  try {
    res = await fetch(`${GHL_BASE}/contacts/`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
    })
    responseText = await res.text()
  } catch (err) {
    console.error('[GHL] Create contact fetch failed:', err)
    return null
  }

  console.log('[GHL] Create contact response:', res.status, responseText)

  if (res.ok) {
    let data: { contact?: { id?: string } } = {}
    try { data = JSON.parse(responseText) } catch {}
    const contactId = data.contact?.id ?? null
    console.log('[GHL] Contact created successfully, id:', contactId)
    return contactId
  }

  // 400 duplicate — GHL returns the existing contactId in meta
  if (res.status === 400) {
    let errorData: { meta?: { contactId?: string } } = {}
    try { errorData = JSON.parse(responseText) } catch {}

    const existingId = errorData.meta?.contactId
    if (existingId) {
      console.log('[GHL] Duplicate contact detected, id:', existingId, '— adding IgualAI Lead tag')
      await ghlAddTags(existingId, ['IgualAI Lead'])
      return existingId
    }
  }

  console.error('[GHL] Contact creation failed:', res.status, responseText)
  return null
}

/**
 * Add one or more tags to an existing GHL contact.
 */
export async function ghlAddTags(contactId: string, tags: string[]): Promise<void> {
  if (!apiKey()) {
    console.log('[GHL] Skipping ghlAddTags — GHL_API_KEY not set')
    return
  }

  console.log('[GHL] Adding tags to', contactId, ':', tags)

  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ tags }),
    })
    const text = await res.text()
    console.log('[GHL] Add tags response:', res.status, text)

    if (!res.ok) {
      console.error('[GHL] Add tags failed:', res.status, text)
    }
  } catch (err) {
    console.error('[GHL] Add tags error:', err)
  }
}

/**
 * Remove one or more tags from an existing GHL contact.
 */
export async function ghlRemoveTags(contactId: string, tags: string[]): Promise<void> {
  if (!apiKey()) {
    console.log('[GHL] Skipping ghlRemoveTags — GHL_API_KEY not set')
    return
  }

  console.log('[GHL] Removing tags from', contactId, ':', tags)

  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: 'DELETE',
      headers: headers(),
      body: JSON.stringify({ tags }),
    })
    const text = await res.text()
    console.log('[GHL] Remove tags response:', res.status, text)

    if (!res.ok) {
      console.error('[GHL] Remove tags failed:', res.status, text)
    }
  } catch (err) {
    console.error('[GHL] Remove tags error:', err)
  }
}

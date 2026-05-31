/**
 * URL blocking rules for the clone endpoint.
 * Blocks categories that pose legal, ethical, or liability risks,
 * plus SSRF targets (private/internal networks, cloud metadata).
 */

import { promises as dns } from 'dns'

// Exact hostnames (with and without www)
const BLOCKED_HOSTNAMES = new Set([
  // Banking & financial
  'stripe.com', 'paypal.com', 'venmo.com', 'wise.com', 'revolut.com',
  'cashapp.com', 'zelle.com', 'chime.com', 'sofi.com', 'robinhood.com',
  'coinbase.com', 'chase.com', 'bankofamerica.com', 'wellsfargo.com',
  'citibank.com', 'capitalone.com', 'americanexpress.com', 'discover.com',
  'schwab.com', 'fidelity.com', 'vanguard.com', 'td.com', 'usbank.com',
  'pnc.com', 'ally.com', 'synchrony.com', 'navyfederal.org',
  // Crypto / NFT
  'binance.com', 'kraken.com', 'gemini.com', 'ftx.com', 'crypto.com',
  'opensea.io', 'rarible.com', 'foundation.app', 'blur.io', 'uniswap.org',
  'metamask.io', 'ledger.com', 'trezor.io', 'bitfinex.com', 'bybit.com',
  'okx.com', 'kucoin.com', 'gate.io',
  // Social media
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'snapchat.com', 'pinterest.com', 'reddit.com', 'linkedin.com',
  'youtube.com', 'twitch.tv', 'discord.com', 'telegram.org', 'whatsapp.com',
  'threads.net', 'bsky.app', 'mastodon.social', 'tumblr.com', 'quora.com',
  // News & media
  'nytimes.com', 'washingtonpost.com', 'theguardian.com', 'bbc.com',
  'bbc.co.uk', 'cnn.com', 'foxnews.com', 'msnbc.com', 'nbcnews.com',
  'abcnews.go.com', 'cbsnews.com', 'reuters.com', 'apnews.com',
  'bloomberg.com', 'wsj.com', 'ft.com', 'forbes.com', 'fortune.com',
  'businessinsider.com', 'techcrunch.com', 'theverge.com', 'wired.com',
  'ars technica.com', 'arstechnica.com', 'engadget.com', 'gizmodo.com',
  'buzzfeed.com', 'huffpost.com', 'axios.com', 'politico.com', 'vice.com',
  // Gambling
  'draftkings.com', 'fanduel.com', 'betmgm.com', 'caesars.com',
  'pointsbet.com', 'barstoolsportsbook.com', 'williamhill.com',
  'bet365.com', 'betway.com', 'unibet.com', 'pokerstars.com',
  'partypoker.com', '888casino.com', 'bovada.lv',
  // Real estate listings
  'zillow.com', 'realtor.com', 'redfin.com', 'trulia.com', 'apartments.com',
  'homes.com', 'homesnap.com', 'loopnet.com', 'costar.com', 'rightmove.co.uk',
  'zoopla.co.uk',
  // Healthcare
  'webmd.com', 'healthline.com', 'mayoclinic.org', 'clevelandclinic.org',
  'medscape.com', 'drugs.com', 'rxlist.com', 'everydayhealth.com',
  // Legal services
  'legalzoom.com', 'rocketlawyer.com', 'findlaw.com', 'nolo.com',
  'avvo.com', 'martindale.com', 'justia.com',
])

// TLD patterns — blocks all .gov and .edu domains worldwide
const BLOCKED_TLD_PATTERNS = [
  /\.gov(\..*)?$/i,        // .gov, .gov.uk, .gov.au, etc.
  /\.edu(\..*)?$/i,        // .edu, .edu.au, etc.
  /\.mil(\..*)?$/i,        // military
  /\.gc\.ca$/i,            // Canadian government
  /\.gouv\./i,             // French government domains
  /\.gob\./i,              // Spanish-speaking government domains
  /\.govt\.nz$/i,          // New Zealand government
]

// Keyword patterns matched against the full hostname
const BLOCKED_HOSTNAME_KEYWORDS = [
  'casino', 'poker', 'betting', 'gambling', 'slots', 'lottery',
  'porn', 'xxx', 'adult', 'sex', 'escort',
  'crypto', 'bitcoin', 'ethereum', 'nft', 'defi', 'blockchain', 'token',
  'bank', 'banking', 'mortgage', 'lending', 'loans', 'insurance',
  'pharmacy', 'pharma', 'clinic', 'hospital', 'health',
]

export interface BlockResult {
  blocked: boolean
  reason?: string
}

export function checkUrlBlocked(rawUrl: string): BlockResult {
  let url: URL
  try {
    url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
  } catch {
    return { blocked: true, reason: 'Invalid URL.' }
  }

  const hostname = url.hostname.replace(/^www\./, '').toLowerCase()

  // Exact hostname match
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { blocked: true, reason: `Cloning ${hostname} is not permitted.` }
  }

  // TLD pattern match
  for (const pattern of BLOCKED_TLD_PATTERNS) {
    if (pattern.test(hostname)) {
      return { blocked: true, reason: 'Government, military, and educational institution websites cannot be cloned.' }
    }
  }

  // Keyword match in hostname
  for (const keyword of BLOCKED_HOSTNAME_KEYWORDS) {
    if (hostname.includes(keyword)) {
      return { blocked: true, reason: `Websites in this category (${keyword}) are not permitted.` }
    }
  }

  return { blocked: false }
}

// ── SSRF guards ──────────────────────────────────────────────────────────────

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true
  const [a, b, c] = parts
  if (a === 0) return true                                    // 0.0.0.0/8
  if (a === 10) return true                                   // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return true           // 100.64.0.0/10 CGNAT
  if (a === 127) return true                                  // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true                     // 169.254/16 link-local (AWS/GCP metadata)
  if (a === 172 && b >= 16 && b <= 31) return true            // 172.16/12 private
  if (a === 192 && b === 0 && c === 0) return true            // 192.0.0/24 protocol assignments
  if (a === 192 && b === 0 && c === 2) return true            // 192.0.2/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true          // 192.88.99/24 6to4 relay
  if (a === 192 && b === 168) return true                     // 192.168/16 private
  if (a === 198 && (b === 18 || b === 19)) return true        // 198.18/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true         // 198.51.100/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true          // 203.0.113/24 TEST-NET-3
  if (a >= 224 && a <= 239) return true                       // 224/4 multicast
  if (a >= 240) return true                                   // 240/4 reserved + 255.255.255.255
  return false
}

export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true   // loopback
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true    // unspecified
  if (/^fc/.test(lower) || /^fd/.test(lower)) return true            // fc00::/7 ULA
  if (/^fe[89ab]/.test(lower)) return true                           // fe80::/10 link-local
  if (/^ff/.test(lower)) return true                                 // ff00::/8 multicast
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)      // IPv4-mapped IPv6
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1])
  return false
}

const IPV4_LITERAL = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

/**
 * SSRF-safe URL check. Resolves the hostname (when not already a literal IP)
 * and rejects any address in private/loopback/link-local/cloud-metadata ranges.
 * Use before any fetch() that takes a user-controlled URL.
 *
 * Note: this is best-effort and not robust against DNS rebinding (where the
 * hostname resolves to a public IP at check time, then to a private IP at
 * fetch time). For true rebinding protection, capture the resolved IP and
 * pin the fetch to it. We accept that gap for now.
 */
export async function isSafeRemoteUrl(rawUrl: string): Promise<BlockResult> {
  let url: URL
  try {
    url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
  } catch {
    return { blocked: true, reason: 'Invalid URL.' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { blocked: true, reason: `Protocol ${url.protocol} is not allowed.` }
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')

  // Literal IPv4
  if (IPV4_LITERAL.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      return { blocked: true, reason: 'URL points to a private/internal IP.' }
    }
    return { blocked: false }
  }

  // Literal IPv6 (contains ':')
  if (hostname.includes(':')) {
    if (isPrivateIPv6(hostname)) {
      return { blocked: true, reason: 'URL points to a private/internal IPv6.' }
    }
    return { blocked: false }
  }

  // Hostname — resolve and check every record
  try {
    const records = await dns.lookup(hostname, { all: true })
    for (const r of records) {
      if (r.family === 4 && isPrivateIPv4(r.address)) {
        return { blocked: true, reason: 'Hostname resolves to a private/internal IP.' }
      }
      if (r.family === 6 && isPrivateIPv6(r.address)) {
        return { blocked: true, reason: 'Hostname resolves to a private/internal IPv6.' }
      }
    }
  } catch {
    return { blocked: true, reason: 'Could not resolve hostname.' }
  }

  return { blocked: false }
}

/**
 * Cheap synchronous check — only rejects URLs whose hostname is already a
 * literal private/internal IP. Misses DNS-based attacks but is safe to call
 * from hot loops (CSS / asset rehosting) without adding DNS latency per URL.
 */
export function isLiteralPrivateIpUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
  } catch {
    return false
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (IPV4_LITERAL.test(hostname)) return isPrivateIPv4(hostname)
  if (hostname.includes(':')) return isPrivateIPv6(hostname)
  return false
}

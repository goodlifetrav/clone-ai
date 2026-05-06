/**
 * URL blocking rules for the clone endpoint.
 * Blocks categories that pose legal, ethical, or liability risks.
 */

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

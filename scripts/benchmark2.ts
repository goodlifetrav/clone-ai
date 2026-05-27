/**
 * Phase 1 Step 1.3 benchmark runner.
 *
 * Runs the full clone pipeline (extract → inlineCss → absolutify → urlMap →
 * rehostImages → rehostFonts → resolveCloneBg → cleanHtml → Pillar 2 trigger
 * decision) against 15 benchmark URLs and writes:
 *   /tmp/benchmark2/<slug>.html    — saved clone HTML
 *   /tmp/benchmark2/<slug>.log     — [CLONE-DEBUG] stdout for that URL
 *   /tmp/benchmark2/_summary.json  — per-URL signals + heuristic score
 *
 * Skips DB save (no project row created) and skips R2 if creds missing.
 * Pipeline code path is identical to the production runDomPipeline EXCEPT for
 * the final Supabase update — the goal here is benchmark fidelity, not
 * provisioning real projects.
 *
 * Run with: DOTENV_PATH=/tmp/prod.env npx tsx scripts/benchmark.ts
 */
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'fs'

const envPath = process.env.DOTENV_PATH || '.env.local'
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

const OUT_DIR = '/tmp/benchmark2'
mkdirSync(OUT_DIR, { recursive: true })

// Use a random projectId so R2 paths don't collide with real projects.
const FAKE_PROJECT_PREFIX = 'bench-' + Date.now().toString(36)

const SITES: { url: string; label: string; expect: string }[] = [
  // Tier 1 simple/static
  { url: 'https://wordpress.org', label: 'wordpress-org', expect: 'static' },
  { url: 'https://shopify.com', label: 'shopify-com', expect: 'static' },
  { url: 'https://webflow.com', label: 'webflow-com', expect: 'static' },
  { url: 'https://hellofresh.com', label: 'hellofresh', expect: 'simple-spa' },
  { url: 'https://patagonia.com', label: 'patagonia', expect: 'shopify' },
  // Tier 2 SPAs
  { url: 'https://nike.com', label: 'nike', expect: 'spa' },
  { url: 'https://redbull.com', label: 'redbull', expect: 'spa' },
  { url: 'https://linear.app', label: 'linear-app', expect: 'spa' },
  { url: 'https://vercel.com', label: 'vercel-com', expect: 'spa' },
  { url: 'https://notion.so', label: 'notion-so', expect: 'spa' },
  // Tier 3 heavy JS / animation
  { url: 'https://stripe.com', label: 'stripe-com', expect: 'heavy-js' },
  { url: 'https://framer.com', label: 'framer-com', expect: 'heavy-js' },
  { url: 'https://airbnb.com', label: 'airbnb', expect: 'heavy-js' },
  // Tier 4 bot-protected (expected to fail with BotProtectionError)
  { url: 'https://masterclass.com', label: 'masterclass', expect: 'bot-protected' },
  { url: 'https://ticketmaster.com', label: 'ticketmaster', expect: 'bot-protected' },
]

interface Result {
  label: string
  url: string
  expect: string
  status: 'ok' | 'bot-blocked' | 'error'
  extractMs?: number
  totalMs?: number
  extractedLen?: number
  finalLen?: number
  bodyLen?: number
  imgCount?: number
  headingCount?: number
  frameworkDetected?: string | null
  pillar2Triggered?: boolean
  visionAccepted?: boolean
  errorMessage?: string
  scoreHeuristic?: number
  scoreReason?: string
}

function slugSafeWrite(label: string, ext: string, content: string | Buffer) {
  writeFileSync(`${OUT_DIR}/${label}.${ext}`, content)
}

function htmlScore(extractedLen: number, finalLen: number, bodyLen: number, imgCount: number, headingCount: number, isBotBlocked: boolean): { score: number; reason: string } {
  if (isBotBlocked) return { score: 0, reason: 'bot-blocked (expected for protected sites)' }
  if (!finalLen || finalLen < 1000) return { score: 0, reason: `tiny output (${finalLen} chars)` }
  if (bodyLen < 500) return { score: 1, reason: `body essentially empty (${bodyLen} chars)` }
  if (bodyLen < 5000 && imgCount === 0) return { score: 1, reason: `body small + 0 images` }
  if (imgCount === 0 && headingCount === 0) return { score: 2, reason: `no images, no headings` }
  if (imgCount < 3) return { score: 2, reason: `only ${imgCount} images` }
  if (bodyLen < 30000) return { score: 3, reason: `small body (${bodyLen} chars)` }
  if (bodyLen < 100000 || imgCount < 10) return { score: 4, reason: `decent (body=${bodyLen}, imgs=${imgCount})` }
  return { score: 5, reason: `rich (body=${bodyLen}, imgs=${imgCount}, headings=${headingCount})` }
}

async function runOne(site: { url: string; label: string; expect: string }, idx: number, total: number): Promise<Result> {
  const projectId = `${FAKE_PROJECT_PREFIX}-${site.label}`
  const tStart = Date.now()

  // Per-URL log capture: tee stdout to a per-URL log file by hijacking console.log.
  const logPath = `${OUT_DIR}/${site.label}.log`
  writeFileSync(logPath, `=== ${site.url} (${idx + 1}/${total}) ===\n`)
  const realLog = console.log
  console.log = (...args: unknown[]) => {
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n'
    appendFileSync(logPath, line)
    realLog(...args)
  }

  const result: Result = { label: site.label, url: site.url, expect: site.expect, status: 'error' }

  try {
    const [{ extractSite }, { inlineCss }, asset, { cleanHtml }] = await Promise.all([
      import('@/lib/extractor'),
      import('@/lib/css-inliner'),
      import('@/lib/asset-rehost'),
      import('@/lib/html-cleaner'),
    ])
    const { makeUrlsAbsolute, rehostImages, rehostFonts } = asset

    console.log(`\n>>> [${idx + 1}/${total}] ${site.url}`)

    const tExtract = Date.now()
    let extracted
    try {
      extracted = await extractSite(site.url, projectId)
    } catch (err) {
      if (err && typeof err === 'object' && 'kind' in err && (err as { kind?: string }).kind === 'bot-protection') {
        result.status = 'bot-blocked'
        result.errorMessage = (err as Error).message
        result.totalMs = Date.now() - tStart
        const score = htmlScore(0, 0, 0, 0, 0, true)
        result.scoreHeuristic = score.score
        result.scoreReason = score.reason
        console.log = realLog
        return result
      }
      throw err
    }

    result.extractMs = Date.now() - tExtract
    result.extractedLen = extracted.html.length
    result.frameworkDetected = extracted.frameworkDetected

    let html = extracted.html
    html = await inlineCss(html, site.url)
    html = html.replace(/url\(&quot;([^&]+)&quot;\)/gi, 'url($1)')
    html = html.replace(/url\(&apos;([^&]+)&apos;\)/gi, 'url($1)')
    html = makeUrlsAbsolute(html, site.url)
    if (extracted.urlMap.size > 0) {
      const sorted = [...extracted.urlMap.entries()].sort((a, b) => b[0].length - a[0].length)
      for (const [orig, r2] of sorted) {
        html = html.split(orig).join(r2)
        const encoded = orig.replace(/&/g, '&amp;')
        if (encoded !== orig) html = html.split(encoded).join(r2)
      }
    }
    html = await rehostImages(html, projectId)
    html = await rehostFonts(html, projectId)
    // resolveCloneBg is in app/api/clone/route.ts, inline it here
    html = html.replace(
      /(<[a-zA-Z][^>]*\sstyle=")([^"]*var\(--clone-bg\)[^"]*)"/g,
      (_match, tagPrefix, styleContent) => {
        const bgMatch = styleContent.match(/--clone-bg:\s*url\(([^)]+)\)/)
        if (!bgMatch) return _match
        const bgUrl = bgMatch[1].trim()
        let resolved = styleContent.replace(/\bvar\(--clone-bg\)/g, `url(${bgUrl})`)
        resolved = resolved
          .replace(/;?\s*--clone-bg:[^;]+(;|$)/g, ';')
          .replace(/;{2,}/g, ';')
          .replace(/;\s*$/, '')
        return `${tagPrefix}${resolved}"`
      }
    )
    html = cleanHtml(html, site.url)

    result.status = 'ok'
    result.finalLen = html.length

    // Compute simple structural metrics
    const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i)
    result.bodyLen = bodyMatch?.[0]?.length ?? 0
    result.imgCount = (html.match(/<img\b/g) || []).length
    result.headingCount = (html.match(/<h[1-3]\b/g) || []).length

    // Pillar 2 trigger decision (informational only — we don't run Vision in benchmark)
    const isSparse = extracted.contentDensity.imgs < 4 && extracted.contentDensity.textLen < 800
    const isEmptyShell = extracted.frameworkDetected !== null &&
      (extracted.frameworkDetected === 'spa-shell' ||
        (extracted.contentDensity.imgs < 8 && extracted.contentDensity.textLen < 2500))
    const hasSubstantialHtml = html.length >= 100_000
    result.pillar2Triggered = (isSparse || isEmptyShell) && !hasSubstantialHtml && !!extracted.screenshotBase64

    slugSafeWrite(site.label, 'html', html)
    const score = htmlScore(result.extractedLen ?? 0, result.finalLen ?? 0, result.bodyLen ?? 0, result.imgCount ?? 0, result.headingCount ?? 0, false)
    result.scoreHeuristic = score.score
    result.scoreReason = score.reason
    result.totalMs = Date.now() - tStart
  } catch (err) {
    result.errorMessage = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)
    result.totalMs = Date.now() - tStart
    const score = htmlScore(0, 0, 0, 0, 0, false)
    result.scoreHeuristic = score.score
    result.scoreReason = `error: ${result.errorMessage}`
  } finally {
    console.log = realLog
  }

  return result
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('Missing env vars — set DOTENV_PATH=/tmp/prod.env before running')
    process.exit(1)
  }
  console.log(`Loaded env from: ${envPath}`)
  console.log(`Output dir: ${OUT_DIR}`)
  console.log(`Running ${SITES.length} sites sequentially...\n`)

  const results: Result[] = []
  for (let i = 0; i < SITES.length; i++) {
    const r = await runOne(SITES[i], i, SITES.length)
    results.push(r)
    console.log(`\n>>> [${i + 1}/${SITES.length}] ${SITES[i].label} → status=${r.status} score=${r.scoreHeuristic} (${r.scoreReason})\n`)
  }

  writeFileSync(`${OUT_DIR}/_summary.json`, JSON.stringify(results, null, 2))

  // Pretty table to stdout
  console.log('\n\n========== BENCHMARK SUMMARY ==========')
  console.log('| Site | Score | Status | Extract ms | Body chars | Imgs | Framework | Note |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const r of results) {
    const note = r.scoreReason ?? r.errorMessage ?? ''
    console.log(`| ${r.label} | ${r.scoreHeuristic} | ${r.status} | ${r.extractMs ?? '-'} | ${r.bodyLen ?? '-'} | ${r.imgCount ?? '-'} | ${r.frameworkDetected ?? 'none'} | ${note.slice(0, 80)} |`)
  }
  const validScores = results.filter(r => r.expect !== 'bot-protected').map(r => r.scoreHeuristic ?? 0)
  const avg = validScores.reduce((a, b) => a + b, 0) / Math.max(1, validScores.length)
  console.log(`\nAverage (excluding bot-protected): ${avg.toFixed(2)}`)
  console.log(`Sites scoring 0 or 1: ${validScores.filter(s => s <= 1).length}`)
  console.log(`Sites scoring 4+: ${validScores.filter(s => s >= 4).length}`)
}

main().catch(err => {
  console.error('Benchmark crashed:', err)
  process.exit(1)
})

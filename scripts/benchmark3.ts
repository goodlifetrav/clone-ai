/**
 * Focused re-benchmark: nike (the target of the fix) + 3 regression sites
 * that scored 5/5 previously (hellofresh, vercel, stripe). Confirms fix
 * works AND doesn't regress good sites.
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

const OUT_DIR = '/tmp/benchmark3'
mkdirSync(OUT_DIR, { recursive: true })
const FAKE_PROJECT_PREFIX = 'bench3-' + Date.now().toString(36)

const SITES = [
  { url: 'https://nike.com', label: 'nike', expect: 'spa' },
  { url: 'https://hellofresh.com', label: 'hellofresh', expect: 'simple-spa' },
  { url: 'https://vercel.com', label: 'vercel-com', expect: 'spa' },
  { url: 'https://stripe.com', label: 'stripe-com', expect: 'heavy-js' },
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
  errorMessage?: string
  scoreHeuristic?: number
  scoreReason?: string
}

function htmlScore(_extractedLen: number, finalLen: number, bodyLen: number, imgCount: number, headingCount: number, isBotBlocked: boolean): { score: number; reason: string } {
  if (isBotBlocked) return { score: 0, reason: 'bot-blocked' }
  if (!finalLen || finalLen < 1000) return { score: 0, reason: `tiny (${finalLen})` }
  if (bodyLen < 500) return { score: 1, reason: `body empty (${bodyLen})` }
  if (bodyLen < 5000 && imgCount === 0) return { score: 1, reason: `small + 0 imgs` }
  if (imgCount === 0 && headingCount === 0) return { score: 2, reason: `no imgs/headings` }
  if (imgCount < 3) return { score: 2, reason: `only ${imgCount} imgs` }
  if (bodyLen < 30000) return { score: 3, reason: `small body (${bodyLen})` }
  if (bodyLen < 100000 || imgCount < 10) return { score: 4, reason: `decent body=${bodyLen} imgs=${imgCount}` }
  return { score: 5, reason: `rich body=${bodyLen} imgs=${imgCount} hdg=${headingCount}` }
}

async function runOne(site: typeof SITES[0], idx: number, total: number): Promise<Result> {
  const projectId = `${FAKE_PROJECT_PREFIX}-${site.label}`
  const tStart = Date.now()
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
      const e = err as { kind?: string; message?: string }
      if (e?.kind === 'bot-protection') {
        result.status = 'bot-blocked'
        result.errorMessage = e.message
        result.totalMs = Date.now() - tStart
        const score = htmlScore(0, 0, 0, 0, 0, true)
        result.scoreHeuristic = score.score
        result.scoreReason = score.reason
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
    const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i)
    result.bodyLen = bodyMatch?.[0]?.length ?? 0
    result.imgCount = (html.match(/<img\b/g) || []).length
    result.headingCount = (html.match(/<h[1-3]\b/g) || []).length
    writeFileSync(`${OUT_DIR}/${site.label}.html`, html)
    const score = htmlScore(result.extractedLen ?? 0, result.finalLen ?? 0, result.bodyLen ?? 0, result.imgCount ?? 0, result.headingCount ?? 0, false)
    result.scoreHeuristic = score.score
    result.scoreReason = score.reason
    result.totalMs = Date.now() - tStart
  } catch (err) {
    result.errorMessage = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)
    result.totalMs = Date.now() - tStart
    result.scoreHeuristic = 0
    result.scoreReason = `error: ${result.errorMessage}`
  } finally {
    console.log = realLog
  }
  return result
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('Missing env — set DOTENV_PATH=/tmp/prod.env')
    process.exit(1)
  }
  console.log(`Running ${SITES.length} sites (nike + 3 regression)...\n`)
  const results: Result[] = []
  for (let i = 0; i < SITES.length; i++) {
    const r = await runOne(SITES[i], i, SITES.length)
    results.push(r)
    console.log(`\n>>> [${i + 1}/${SITES.length}] ${SITES[i].label} → status=${r.status} score=${r.scoreHeuristic} (${r.scoreReason})\n`)
  }
  writeFileSync(`${OUT_DIR}/_summary.json`, JSON.stringify(results, null, 2))
  console.log('\n\n========== DELTA TABLE ==========')
  const previous: Record<string, { score: number; bodyLen: number; imgCount: number }> = {
    'nike': { score: 1, bodyLen: 13, imgCount: 0 },
    'hellofresh': { score: 5, bodyLen: 3958878, imgCount: 915 },
    'vercel-com': { score: 5, bodyLen: 424591, imgCount: 48 },
    'stripe-com': { score: 5, bodyLen: 876852, imgCount: 47 },
  }
  console.log('| Site | Before | After | Body | Imgs | Note |')
  console.log('|---|---|---|---|---|---|')
  for (const r of results) {
    const p = previous[r.label]
    console.log(`| ${r.label} | ${p?.score ?? '?'} | ${r.scoreHeuristic} | ${r.bodyLen ?? '-'} | ${r.imgCount ?? '-'} | ${(r.scoreReason ?? r.errorMessage ?? '').slice(0, 60)} |`)
  }
}

main().catch(err => {
  console.error('Crashed:', err)
  process.exit(1)
})

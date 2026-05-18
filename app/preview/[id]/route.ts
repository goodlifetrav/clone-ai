import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

// CSS injected into every preview to fix common cloning artifacts.
// Do NOT add background-color here — it breaks dark-themed stores.
const CSS_RESET = `<style>
/* EasyLockdown and similar Shopify app content-gates wrap the full page in
   a div with style="display:none" pending JS auth. Since static clones have
   no JS, forcibly show the content. */
.easylockdown-content,
[class*="easylockdown"],
[id*="easylockdown"] {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
}
</style>`

// Proxy script: runs in-browser on every preview.
// 1. Removes EasyLockdown and similar content-gate inline styles (JS wins over CSS)
// 2. Retries blocked images through corsproxy.io when they fail to load.
// Uses no regex — only string methods — to stay template-literal safe.
const PROXY_SCRIPT = `<script>
(function(){
  // ── Remove app content gates (EasyLockdown etc.) via direct style mutation ──
  // CSS !important can lose to inlined site styles of same specificity.
  // Directly removing the inline style property always wins.
  function unlockGates() {
    var gates = document.querySelectorAll(
      '.easylockdown-content, [class*="easylockdown"], [id*="easylockdown"],' +
      '.lockdown-content, [class*="content-gate"], [class*="contentgate"],' +
      '[data-lockdown], [data-content-gate]'
    );
    gates.forEach(function(el) {
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
      el.removeAttribute('hidden');
    });
  }
  unlockGates();
  // Re-run after a tick in case the gate element is injected by an inline script
  setTimeout(unlockGates, 0);
  setTimeout(unlockGates, 500);

  // ── CORS image proxy ──────────────────────────────────────────────────────────
  var PROXY = 'https://corsproxy.io/?url=';
  function retry(img) {
    if (img.getAttribute('data-proxy')) return;
    img.setAttribute('data-proxy', '1');
    var orig = img.src || '';
    if (orig.indexOf('http') === 0 && orig.indexOf('corsproxy.io') === -1) {
      img.src = PROXY + encodeURIComponent(orig);
    }
  }
  function attach(img) {
    img.addEventListener('error', function(){ retry(img); });
    if (img.complete && img.naturalWidth === 0 && img.src) retry(img);
  }
  document.querySelectorAll('img').forEach(attach);
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if (n.nodeType !== 1) return;
        if (n.tagName === 'IMG') attach(n);
        if (n.querySelectorAll) n.querySelectorAll('img').forEach(attach);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
</script>`

function prepareHtml(raw: string): string {
  let html = raw.replace(
    /<html([^>]*)>/i,
    (_, attrs) => `<html${attrs.replace(/\s*data-theme=["'][^"']*["']/gi, '')}>`
  )
  // HEAD_INJECT: <base target="_blank"> ensures all links open in a new tab,
  // followed by the CSS reset to force light mode.
  const HEAD_INJECT = '<base target="_blank">' + CSS_RESET
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, () => HEAD_INJECT + '</head>')
  } else if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/(<head[^>]*>)/i, (m) => m + HEAD_INJECT)
  } else {
    html = HEAD_INJECT + html
  }
  // Inject CORS proxy script before </body> so broken images retry via proxy.
  // Use function-form replace to prevent $ in the script string being
  // interpreted as regex back-references.
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, () => PROXY_SCRIPT + '</body>')
  } else if (/<\/html>/i.test(html)) {
    html = html.replace(/<\/html>/i, () => PROXY_SCRIPT + '</html>')
  } else {
    html += PROXY_SCRIPT
  }
  return html
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    console.log('[preview] GET /preview/' + id)

    if (!id) {
      console.log('[preview] ERROR: no id in params')
      return new Response('Missing project ID', { status: 400 })
    }

    const supabase = createServiceClient()
    console.log('[preview] Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)

    const { data: project, error } = await supabase
      .from('projects')
      .select('html_content')
      .eq('id', id)
      .single()

    console.log('[preview] Supabase error:', error)
    console.log('[preview] project found:', !!project)
    console.log('[preview] html_content length:', project?.html_content?.length ?? 0)
    console.log('[preview] html_content preview:', project?.html_content?.slice(0, 200))

    if (error || !project) {
      return new Response(`Project not found: ${error?.message ?? 'no data'}`, { status: 404 })
    }

    if (!project.html_content) {
      console.log('[preview] ERROR: html_content is empty/null')
      return new Response('<html><body><p>No HTML content saved for this project yet.</p></body></html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    const html = prepareHtml(project.html_content)
    console.log('[preview] Serving HTML, length:', html.length)

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // Allow all external images (R2, CDNs, original sites) to load
        'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
      },
    })
  } catch (err) {
    console.error('[preview] Unexpected error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}

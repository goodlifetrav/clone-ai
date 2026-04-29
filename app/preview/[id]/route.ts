import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

const CSS_RESET = `
<meta name="color-scheme" content="light only">
<style id="__preview_reset__">
  :root, [data-theme], [data-color-scheme], [class*="dark"], [class*="theme"] {
    --background: #ffffff !important;
    --bg: #ffffff !important;
    --bg-color: #ffffff !important;
    --body-bg: #ffffff !important;
    --page-bg: #ffffff !important;
    --color-bg: #ffffff !important;
    --color-background: #ffffff !important;
    --color-canvas-default: #ffffff !important;
    --color-canvas-subtle: #f6f8fa !important;
    --surface-background: #ffffff !important;
    --app-background: #ffffff !important;
    color-scheme: light !important;
  }
  html, body {
    background: #ffffff !important;
    background-color: #ffffff !important;
  }
</style>
`

// Proxy script: retry blocked images through corsproxy.io when they fail to load.
// Uses no regex — only string methods — to stay template-literal safe.
const PROXY_SCRIPT = `<script>
(function(){
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
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${CSS_RESET}</head>`)
  } else if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${CSS_RESET}`)
  } else {
    html = CSS_RESET + html
  }
  // Inject CORS proxy script before </body> so broken images retry via proxy
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${PROXY_SCRIPT}</body>`)
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

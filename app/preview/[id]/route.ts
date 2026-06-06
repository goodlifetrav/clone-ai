import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getAuth } from '@/lib/auth'
import { isAdminEmail } from '@/lib/admin'

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
/* Salient/Nectar theme: .row-bg starts at opacity:0 and requires JS to add
   the 'top-level' class to the section before the opacity:1 rule fires.
   Without JS that class is never added, so the hero background stays invisible.
   Force all .row-bg elements visible for static clones. */
.row-bg {
  opacity: 1 !important;
}
/* Fix fullscreen hero sliders (Swiper-based) whose carousel wrapper was normalized
   by the static layout cleanup to a 320px-wide flex-wrap product grid.
   Stylesheet !important beats normal inline styles, so this repairs existing clones.
   Targets containers with "fullscreen" in their class and Nobu's n-slideshow. */
[class*="fullscreen"] .swiper-wrapper,
[class*="n-slideshow"] .swiper-wrapper {
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  flex-wrap: unset !important;
}
[class*="fullscreen"] .swiper-slide,
[class*="n-slideshow"] .swiper-slide {
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
  flex: none !important;
}
[class*="fullscreen"] .swiper-slide + .swiper-slide,
[class*="n-slideshow"] .swiper-slide + .swiper-slide {
  display: none !important;
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

  // Fix Salient/Nectar: .row-bg.using-image { background-image: none !important }
  // That CSS rule wipes the inline background-image. Re-apply the inline value with
  // !important so it wins the cascade. Runs on existing clones where the inline
  // style lacks !important; harmless on new clones that already have it.
  function fixRowBgImages() {
    document.querySelectorAll('.row-bg').forEach(function(el) {
      var inlineBg = el.style.backgroundImage;
      if (inlineBg && inlineBg !== 'none') {
        el.style.setProperty('background-image', inlineBg, 'important');
      }
    });
  }
  fixRowBgImages();
  setTimeout(fixRowBgImages, 0);
  setTimeout(fixRowBgImages, 500);

  // Fix false-positive opacity override: the clone pipeline injects a CSS rule
  // [style*="opacity: 0"] { opacity: 1 !important } to reveal animated elements,
  // but "opacity: 0" is a substring of "opacity: 0.5", so overlays and other
  // semi-transparent elements get forced fully opaque. Restore any element that
  // has a decimal inline opacity (0.1–0.9) back to its correct value.
  (function fixDecimalOpacity() {
    document.querySelectorAll('[style]').forEach(function(el) {
      var style = el.getAttribute('style') || '';
      var match = style.match(/opacity:\s*(0\.\d+)/);
      if (match) {
        el.style.setProperty('opacity', match[1], 'important');
      }
    });
  })();

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

// Resolve var(--clone-bg) → direct url() so existing projects render correctly.
// New projects get this resolved at save-time (pipeline step 4c), but projects
// cloned before that fix still have var(--clone-bg) in their html_content.
function resolveCloneBg(html: string): string {
  return html.replace(
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
}

// Fix the false-positive opacity CSS rule baked into extracted HTML by the extractor.
// The extractor injects: [style*="opacity: 0"] { opacity: 1 !important }
// to reveal animated elements, but the substring selector also matches "opacity: 0.5",
// "opacity: 0.3", etc. — forcing semi-transparent overlays fully opaque (solid black cover).
// Add :not([style*="opacity: 0."]) to both selectors to exclude decimal opacity values.
function fixOpacityOverrideRule(html: string): string {
  // Match exactly the selectors the extractor generates (with or without * universal selector)
  return html
    .replace(
      /\*?\[style\*="opacity: 0"\]:not\(script\):not\(style\)/g,
      '[style*="opacity: 0"]:not([style*="opacity: 0."]):not(script):not(style)'
    )
    .replace(
      /\*?\[style\*="opacity:0"\]:not\(script\):not\(style\)/g,
      '[style*="opacity:0"]:not([style*="opacity:0."]):not(script):not(style)'
    )
}

function prepareHtml(raw: string): string {
  let html = resolveCloneBg(raw)
  html = fixOpacityOverrideRule(html)
  // Do NOT strip data-theme — sites like Linear use it as the dark-mode
  // trigger (data-theme="dark" → white text on dark bg). Removing it makes
  // the page fall back to its default light theme, producing dark text on
  // an already-dark background (because color-scheme stays via inline
  // style). The editor PreviewPane never stripped this, so the two render
  // paths now match.

  // ── Strip EasyLockdown content-gate display:none ──────────────────────────────
  // Confirmed structure from Death Wish Coffee (and any site using EasyLockdown):
  //   <div class='easylockdown-content' style='display:none;'>
  // The app wraps ALL page content and removes display:none after JS auth check.
  // We have no auth cookie so the wrapper stays locked — strip it server-side
  // so all existing clones work immediately without re-cloning.
  html = html.replace(
    /(<(?:div|section|main)\b[^>]*easylockdown[^>]*?)\s+style=(["'])display\s*:\s*none\s*;?\2/gi,
    '$1'
  )
  // Also handle style attribute appearing before class attribute
  html = html.replace(
    /(<(?:div|section|main)\b[^>]*?)style=(["'])display\s*:\s*none\s*;?\2(\s[^>]*easylockdown[^>]*>)/gi,
    '$1$3'
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

    if (!id) {
      return new Response('Missing project ID', { status: 400 })
    }

    // Require auth — previously this route was public, which let any visitor
    // pull any project's html_content by guessing/sniffing UUIDs. Admins may
    // view any project; non-admins must own it.
    const { userId } = await getAuth()
    if (!userId) {
      return new Response('Unauthorized', { status: 401 })
    }

    const supabase = createServiceClient()

    const { data: user } = await supabase
      .from('users')
      .select('id, email, is_admin')
      .eq('clerk_id', userId)
      .single()
    if (!user) {
      return new Response('User not found', { status: 404 })
    }
    const isAdmin = user.is_admin || isAdminEmail(user.email)

    const projectQuery = supabase
      .from('projects')
      .select('html_content')
      .eq('id', id)
    if (!isAdmin) projectQuery.eq('user_id', user.id)
    const { data: project, error } = await projectQuery.single()

    if (error || !project) {
      return new Response('Project not found', { status: 404 })
    }

    if (!project.html_content) {
      return new Response('<html><body><p>No HTML content saved for this project yet.</p></body></html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    const html = prepareHtml(project.html_content)

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // CSP for cloned-content rendering MUST allow external scripts and
        // styles — AI-rebuilt pages use cdn.tailwindcss.com to compile their
        // class="bg-red-500" etc. at runtime, original-site clones often
        // embed jQuery/Swiper/etc. from CDNs (and html-cleaner already
        // allowlists known-trusted hosts before they reach this point).
        // A tight script-src silently breaks all of those, producing an
        // unstyled page. Route is now auth-gated + ownership-checked, which
        // already removes the cross-tenant XSS scenario the tighter CSP was
        // meant to defend against. Keep object-src/frame-ancestors as the
        // cheap, non-breaking wins (no Flash/plugins, no clickjacking).
        'Content-Security-Policy': [
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
          "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
          "style-src * 'unsafe-inline'",
          "img-src * data: blob:",
          "font-src * data:",
          "object-src 'none'",
          "base-uri 'none'",
          "frame-ancestors 'self'",
        ].join('; '),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch (err) {
    console.error('[preview] Unexpected error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}

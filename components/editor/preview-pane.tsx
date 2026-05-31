'use client'

import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PreviewPaneProps {
  projectId: string
  html: string
  className?: string
}

// Resolve var(--clone-bg) → direct url() so background images render in the editor.
// Same logic as preview/[id]/route.ts — must be kept in sync.
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

// Inject a <base target="_blank"> so all links open in new tabs,
// a click interceptor that prevents in-app navigation,
// and an image proxy that retries blocked images through corsproxy.io.
// Fix the false-positive opacity CSS rule baked by the extractor.
// [style*="opacity: 0"] also matches "opacity: 0.5" — add :not([style*="opacity: 0."]).
function fixOpacityOverrideRule(html: string): string {
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

function injectLinkInterceptor(html: string): string {
  html = resolveCloneBg(html)
  html = fixOpacityOverrideRule(html)
  const baseTag = '<base target="_blank"><style>' +
    '.row-bg{opacity:1!important}' +
    // Fix fullscreen hero sliders normalized to a 320px flex-wrap grid by the static layout cleanup
    '[class*="fullscreen"] .swiper-wrapper,[class*="n-slideshow"] .swiper-wrapper{display:block!important;width:100%!important;height:100%!important;flex-wrap:unset!important}' +
    '[class*="fullscreen"] .swiper-slide,[class*="n-slideshow"] .swiper-slide{width:100%!important;max-width:none!important;min-width:0!important;flex:none!important}' +
    '[class*="fullscreen"] .swiper-slide + .swiper-slide,[class*="n-slideshow"] .swiper-slide + .swiper-slide{display:none!important}' +
    '</style>'
  const script = `<script>
(function(){
  // ── Fix Salient/Nectar .row-bg.using-image { background-image: none !important } ──
  // That CSS rule wipes inline background-image values. Re-apply with !important
  // so the inline value beats the stylesheet rule. Works on old clones (no !important
  // in inline style) and is harmless on new clones that already have it.
  function fixRowBgImages() {
    document.querySelectorAll('.row-bg').forEach(function(el) {
      var inlineBg = el.style.backgroundImage;
      if (inlineBg && inlineBg !== 'none') {
        el.style.setProperty('background-image', inlineBg, 'important');
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixRowBgImages);
  } else {
    fixRowBgImages();
  }
  setTimeout(fixRowBgImages, 0);
  setTimeout(fixRowBgImages, 500);

  // ── Fix false-positive opacity override ──────────────────────────────
  // The clone pipeline injects [style*="opacity: 0"] { opacity: 1 !important }
  // which also matches "opacity: 0.5" (substring). Restore decimal opacities.
  (function fixDecimalOpacity() {
    document.querySelectorAll('[style]').forEach(function(el) {
      var style = el.getAttribute('style') || '';
      var match = style.match(/opacity:\s*(0\.\d+)/);
      if (match) {
        el.style.setProperty('opacity', match[1], 'important');
      }
    });
  })();

  // ── Link interceptor ──────────────────────────────────────────────────
  document.addEventListener('click', function(e){
    var a = e.target.closest('a');
    if(a && a.href){
      e.preventDefault();
      e.stopPropagation();
      window.open(a.href, '_blank', 'noopener,noreferrer');
    }
  }, true);

  // ── Image proxy: retry hotlink-blocked images via corsproxy.io ────────
  var PROXY = 'https://corsproxy.io/?url=';

  function proxyUrl(url) {
    return PROXY + encodeURIComponent(url);
  }

  function isProxiable(url) {
    return typeof url === 'string' &&
      (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) &&
      url.indexOf('corsproxy.io') === -1;
  }

  // Parse all http(s) URLs out of a CSS string (handles url("…"), url('…'), url(…))
  // Uses only string operations — no regex — to avoid template-literal escape issues.
  function extractCssUrls(text) {
    var results = [];
    var pos = 0;
    while (true) {
      var idx = text.indexOf('url(', pos);
      if (idx === -1) break;
      idx += 4;
      var q = text[idx];
      var quoted = (q === '"' || q === "'");
      var start = quoted ? idx + 1 : idx;
      var end = quoted ? text.indexOf(q, start) : text.indexOf(')', start);
      if (end === -1) { pos = idx; continue; }
      var url = text.slice(start, end).trim();
      if (isProxiable(url)) results.push(url);
      pos = end + 1;
    }
    return results;
  }

  // Fix a single <img> element — add onerror and handle already-broken images
  function fixImg(img) {
    if (img.getAttribute('data-proxy')) return;
    function retry() {
      if (img.getAttribute('data-proxy')) return;
      img.setAttribute('data-proxy', '1');
      var orig = img.getAttribute('data-orig-src') || img.src;
      img.setAttribute('data-orig-src', orig);
      if (isProxiable(orig)) img.src = proxyUrl(orig);
    }
    img.addEventListener('error', retry);
    // Already broken (complete but zero-size — errored before listener attached)
    if (img.complete && img.naturalWidth === 0 && isProxiable(img.src)) retry();
  }

  // Fix a single element's inline background-image style
  function fixInlineBg(el) {
    var bg = el.style && el.style.backgroundImage;
    if (!bg) return;
    extractCssUrls(bg).forEach(function(url) {
      var tester = new Image();
      tester.onerror = function() {
        if (el.style.backgroundImage.indexOf('corsproxy.io') === -1) {
          el.style.backgroundImage = el.style.backgroundImage.split(url).join(proxyUrl(url));
        }
      };
      tester.src = url;
    });
  }

  // Fix all url() references inside <style> tags
  function fixStyleTags() {
    document.querySelectorAll('style').forEach(function(styleEl) {
      var urls = extractCssUrls(styleEl.textContent || '');
      urls.forEach(function(url) {
        var tester = new Image();
        tester.onerror = function() {
          if ((styleEl.textContent || '').indexOf('corsproxy.io') !== -1) return;
          styleEl.textContent = (styleEl.textContent || '').split(url).join(proxyUrl(url));
        };
        tester.src = url;
      });
    });
  }

  function applyAll() {
    document.querySelectorAll('img').forEach(fixImg);
    document.querySelectorAll('[style]').forEach(fixInlineBg);
    fixStyleTags();
  }

  // Watch for dynamically added nodes
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType !== 1) return;
        if (node.tagName === 'IMG') fixImg(node);
        if (node.style && node.style.backgroundImage) fixInlineBg(node);
        if (node.querySelectorAll) {
          node.querySelectorAll('img').forEach(fixImg);
          node.querySelectorAll('[style]').forEach(fixInlineBg);
        }
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAll);
  } else {
    applyAll();
  }
})();
</script>`

  if (/<head[^>]*>/i.test(html)) {
    return html
      .replace(/(<head[^>]*>)/i, `$1${baseTag}`)
      .replace(/<\/body>/i, `${script}</body>`)
  }
  // No <head> — prepend base tag and append script
  return baseTag + html + script
}

function isValidHtmlDocument(html: string): boolean {
  if (!html || html.length < 100) return false
  const trimmed = html.trimStart()
  return /^<!doctype\s+html/i.test(trimmed) || /^<html/i.test(trimmed)
}

export function PreviewPane({ projectId, html, className = '' }: PreviewPaneProps) {
  const valid = isValidHtmlDocument(html)
  const safeHtml = valid ? injectLinkInterceptor(html) : html

  return (
    <div className={`relative flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex-shrink-0">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 mx-2 bg-white dark:bg-neutral-800 rounded text-xs text-neutral-400 px-2 py-0.5 border border-neutral-200 dark:border-neutral-700 truncate">
          preview
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-6 text-xs px-2"
          onClick={() => window.open(`/preview/${projectId}`, '_blank')}
        >
          <ExternalLink className="w-3 h-3" />
          Open in new tab
        </Button>
      </div>

      {/* Preview iframe */}
      <div className="flex-1 min-h-0">
        {valid ? (
          <iframe
            srcDoc={safeHtml}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            title="Preview"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
            <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
              <ExternalLink className="w-5 h-5 text-neutral-400" />
            </div>
            <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">Preview not available</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 max-w-xs">
              The last AI generation didn&apos;t produce valid HTML. Use the AI chat to generate a new version.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

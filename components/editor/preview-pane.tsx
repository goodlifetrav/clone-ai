'use client'

import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PreviewPaneProps {
  projectId: string
  html: string
  className?: string
}

// Inject a <base target="_blank"> so all links open in new tabs,
// a click interceptor that prevents in-app navigation,
// and an image proxy that retries blocked images through corsproxy.io.
function injectLinkInterceptor(html: string): string {
  const baseTag = '<base target="_blank">'
  const script = `<script>
(function(){
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
    return url &&
      (url.startsWith('http://') || url.startsWith('https://')) &&
      url.indexOf('corsproxy.io') === -1;
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
    // Already broken (loaded but empty, or error before listener attached)
    if (img.complete && img.naturalWidth === 0 && isProxiable(img.src)) retry();
  }

  // Fix a single element's inline background-image style
  function fixInlineBg(el) {
    var bg = el.style && el.style.backgroundImage;
    if (!bg) return;
    var match = bg.match(/url\\(['"]?(https?:\\/\\/[^'"\\)\\s]+)['"]?\\)/);
    if (!match || !isProxiable(match[1])) return;
    var url = match[1];
    var tester = new Image();
    tester.onerror = function() {
      if (el.style.backgroundImage.indexOf('corsproxy.io') === -1) {
        el.style.backgroundImage = el.style.backgroundImage.replace(url, proxyUrl(url));
      }
    };
    tester.src = url;
  }

  // Fix all url() references inside <style> tags
  function fixStyleTags() {
    var urlRe = /url\\(['"]?(https?:\\/\\/[^'"\\)\\s]+)['"]?\\)/g;
    document.querySelectorAll('style').forEach(function(styleEl) {
      var css = styleEl.textContent || '';
      var seen = {};
      var m;
      urlRe.lastIndex = 0;
      while ((m = urlRe.exec(css)) !== null) {
        var url = m[1];
        if (!isProxiable(url) || seen[url]) continue;
        seen[url] = true;
        (function(u) {
          var tester = new Image();
          tester.onerror = function() {
            if ((styleEl.textContent || '').indexOf('corsproxy.io') !== -1) return;
            var escaped = u.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
            styleEl.textContent = (styleEl.textContent || '').replace(
              new RegExp(escaped, 'g'),
              proxyUrl(u)
            );
          };
          tester.src = u;
        })(url);
      }
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

export function PreviewPane({ projectId, html, className = '' }: PreviewPaneProps) {
  const safeHtml = html ? injectLinkInterceptor(html) : html

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
        <iframe
          srcDoc={safeHtml}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title="Preview"
        />
      </div>
    </div>
  )
}

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

'use client'

import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PreviewPaneProps {
  projectId: string
  html: string
  className?: string
}

// Inject a <base target="_blank"> so all links open in new tabs,
// and a click interceptor that prevents in-app navigation for any
// links that don't already have a target set.
function injectLinkInterceptor(html: string): string {
  const baseTag = '<base target="_blank">'
  const script = `<script>
(function(){
  document.addEventListener('click', function(e){
    var a = e.target.closest('a');
    if(a && a.href){
      e.preventDefault();
      e.stopPropagation();
      window.open(a.href, '_blank', 'noopener,noreferrer');
    }
  }, true);
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

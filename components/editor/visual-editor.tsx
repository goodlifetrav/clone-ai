'use client'

import { useEffect, useCallback } from 'react'
import { Wand2, MousePointer2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface VisualEditorProps {
  html: string
  hasBeenAiRebuilt: boolean
  onHtmlChange: (html: string) => void
  onOpenRebuild: () => void
  className?: string
}

// Injected into the iframe to enable inline text editing.
// Marked with id="__ve__" so it's stripped from the saved HTML snapshot.
const EDIT_SCRIPT = `<script id="__ve__">
(function(){
  var SEL='h1,h2,h3,h4,h5,h6,p,a,button,span,li,td,th,label,blockquote,figcaption,small,strong,em,b,i';
  var active=null;

  function saveAndExit(){
    if(!active)return;
    var el=active;
    el.removeAttribute('contenteditable');
    el.style.outline='';
    el.style.outlineOffset='';
    el.style.cursor='';
    active=null;
    var clone=document.documentElement.cloneNode(true);
    var ve=clone.querySelector('#__ve__');
    if(ve)ve.parentNode.removeChild(ve);
    window.parent.postMessage({type:'inline-edit',html:'<!DOCTYPE html>\\n'+clone.outerHTML},'*');
  }

  document.addEventListener('mouseover',function(e){
    var el=e.target.closest(SEL);
    if(!el||el===active)return;
    el.style.outline='2px dashed rgba(139,92,246,0.45)';
    el.style.outlineOffset='2px';
    el.style.cursor='text';
  },true);

  document.addEventListener('mouseout',function(e){
    var el=e.target.closest(SEL);
    if(!el||el===active)return;
    el.style.outline='';
    el.style.outlineOffset='';
    el.style.cursor='';
  },true);

  document.addEventListener('click',function(e){
    var el=e.target.closest(SEL);
    if(!el){saveAndExit();return;}
    e.preventDefault();
    e.stopPropagation();
    if(active&&active!==el)saveAndExit();
    active=el;
    el.contentEditable='true';
    el.style.outline='2px solid rgba(139,92,246,0.85)';
    el.style.outlineOffset='2px';
    el.focus();
    if(document.caretRangeFromPoint){
      var r=document.caretRangeFromPoint(e.clientX,e.clientY);
      if(r){var s=window.getSelection();s.removeAllRanges();s.addRange(r);}
    }
  },true);

  document.addEventListener('keydown',function(e){
    if(!active)return;
    if(e.key==='Escape'){saveAndExit();return;}
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();saveAndExit();}
  },true);

  document.addEventListener('blur',function(e){
    if(active&&e.target===active)setTimeout(function(){if(active)saveAndExit();},150);
  },true);
})();
<\/script>`

function injectEditScript(html: string): string {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${EDIT_SCRIPT}</body>`)
  }
  return html + EDIT_SCRIPT
}

export function VisualEditor({
  html,
  hasBeenAiRebuilt,
  onHtmlChange,
  onOpenRebuild,
  className = '',
}: VisualEditorProps) {
  const handleMessage = useCallback(
    (e: MessageEvent) => {
      if (e.data?.type === 'inline-edit' && typeof e.data.html === 'string') {
        onHtmlChange(e.data.html)
      }
    },
    [onHtmlChange]
  )

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  if (!hasBeenAiRebuilt) {
    return (
      <div className={`flex flex-col items-center justify-center gap-4 p-8 text-center ${className}`}>
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-600 to-purple-400 flex items-center justify-center">
          <Wand2 className="w-6 h-6 text-white" />
        </div>
        <div className="space-y-1.5">
          <h3 className="font-semibold text-neutral-900 dark:text-white">Rebuild with Your Brand</h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs">
            Direct visual editing isn&apos;t available for cloned sites. Use AI Brand Rebuild to
            instantly redesign this page with your colors, copy, and logo.
          </p>
        </div>
        <Button
          onClick={onOpenRebuild}
          className="gap-2 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white border-0"
        >
          <Wand2 className="w-4 h-4" />
          Start Brand Rebuild
        </Button>
      </div>
    )
  }

  const editableHtml = html ? injectEditScript(html) : ''

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-800 bg-purple-50 dark:bg-purple-950/30 flex-shrink-0">
        <MousePointer2 className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
        <span className="text-xs text-purple-700 dark:text-purple-300">
          Click any text to edit it directly. Press{' '}
          <kbd className="px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900 font-mono text-[10px]">Enter</kbd>
          {' '}or{' '}
          <kbd className="px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900 font-mono text-[10px]">Esc</kbd>
          {' '}to save.
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <iframe
          srcDoc={editableHtml}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title="Visual Editor"
        />
      </div>
    </div>
  )
}

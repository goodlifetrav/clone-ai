'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { Wand2, MousePointer2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface VisualEditorProps {
  html: string
  hasBeenAiRebuilt: boolean
  onHtmlChange: (html: string) => void
  onOpenRebuild: () => void
  className?: string
}

// Injected into the iframe to enable inline text editing and image replacement.
// Marked with id="__ve__" so it's stripped from the saved HTML snapshot.
const EDIT_SCRIPT = `<script id="__ve__">
(function(){
  var STRICT='h1,h2,h3,h4,h5,h6,p,a,button,span,li,td,th,label,blockquote,figcaption,small,strong,em,b,i';
  var SKIP='SCRIPT,STYLE,IFRAME,INPUT,TEXTAREA,SELECT,CANVAS,VIDEO,AUDIO';
  var active=null;

  // Returns true if el has at least one non-empty direct text node
  function hasDirectText(el){
    for(var i=0;i<el.childNodes.length;i++){
      if(el.childNodes[i].nodeType===3&&el.childNodes[i].textContent.trim())return true;
    }
    return false;
  }

  // Find the best editable text element from a click target.
  // First tries the strict selector, then walks up looking for direct text.
  function findTextEl(target){
    if(SKIP.indexOf(target.tagName)!==-1)return null;
    var found=target.closest?target.closest(STRICT):null;
    if(found)return found;
    var cur=target;
    while(cur&&cur!==document.body){
      if(SKIP.indexOf(cur.tagName)===-1&&hasDirectText(cur))return cur;
      cur=cur.parentElement;
    }
    return null;
  }

  function snapshot(){
    var clone=document.documentElement.cloneNode(true);
    ['#__ve__','#__ve_img__'].forEach(function(sel){
      var el=clone.querySelector(sel);
      if(el)el.parentNode.removeChild(el);
    });
    window.parent.postMessage({type:'inline-edit',html:'<!DOCTYPE html>\\n'+clone.outerHTML},'*');
  }

  function saveAndExit(){
    if(!active)return;
    active.removeAttribute('contenteditable');
    active.style.outline='';
    active.style.outlineOffset='';
    active.style.cursor='';
    active=null;
    snapshot();
  }

  // ── Image editor overlay ─────────────────────────────────────────────────
  function showImageEditor(img){
    var existing=document.getElementById('__ve_img__');
    if(existing)existing.parentNode.removeChild(existing);

    var rect=img.getBoundingClientRect();
    var wrap=document.createElement('div');
    wrap.id='__ve_img__';
    wrap.style.cssText=[
      'position:fixed',
      'z-index:2147483647',
      'background:#1e1b4b',
      'border:1px solid rgba(139,92,246,0.6)',
      'border-radius:10px',
      'padding:12px 14px',
      'display:flex',
      'flex-direction:column',
      'gap:8px',
      'width:300px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
      'top:'+Math.min(rect.bottom+8, window.innerHeight-140)+'px',
      'left:'+Math.max(8,Math.min(rect.left,window.innerWidth-316))+'px',
    ].join(';');

    var lbl=document.createElement('p');
    lbl.textContent='Replace image — paste a URL or type a picsum seed word:';
    lbl.style.cssText='color:#c4b5fd;font-size:11px;margin:0;line-height:1.4;';

    var inp=document.createElement('input');
    inp.type='text';
    var cur=img.src||'';
    var m=cur.match(/picsum\\.photos\\/seed\\/([^\\/]+)/);
    inp.value=m?m[1]:cur;
    inp.placeholder='e.g. coffee  or  https://…';
    inp.style.cssText='width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(139,92,246,0.5);background:#312e81;color:#fff;font-size:13px;outline:none;box-sizing:border-box;';

    var row=document.createElement('div');
    row.style.cssText='display:flex;gap:6px;';

    function makeBtn(label,bg){
      var b=document.createElement('button');
      b.textContent=label;
      b.style.cssText='flex:1;padding:6px 0;background:'+bg+';color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;';
      return b;
    }
    var saveBtn=makeBtn('Save','#7c3aed');
    var cancelBtn=makeBtn('Cancel','#4b5563');

    function apply(){
      var val=inp.value.trim();
      if(val){
        var newSrc=val.indexOf('://')!==-1?val:'https://picsum.photos/seed/'+val+'/800/600';
        img.src=newSrc;
        // Also update srcset if present to avoid browser ignoring src
        img.removeAttribute('srcset');
      }
      wrap.parentNode.removeChild(wrap);
      snapshot();
    }
    function cancel(){ wrap.parentNode.removeChild(wrap); }

    saveBtn.addEventListener('click',apply);
    cancelBtn.addEventListener('click',cancel);
    inp.addEventListener('keydown',function(e){
      e.stopPropagation();
      if(e.key==='Enter')apply();
      if(e.key==='Escape')cancel();
    });

    row.appendChild(saveBtn);
    row.appendChild(cancelBtn);
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    wrap.appendChild(row);
    document.body.appendChild(wrap);
    inp.focus();inp.select();
  }

  // ── Hover highlight ──────────────────────────────────────────────────────
  document.addEventListener('mouseover',function(e){
    if(e.target.tagName==='IMG'){
      e.target.style.outline='2px dashed rgba(139,92,246,0.45)';
      e.target.style.cursor='pointer';
      return;
    }
    var el=findTextEl(e.target);
    if(!el||el===active)return;
    el.style.outline='2px dashed rgba(139,92,246,0.45)';
    el.style.outlineOffset='2px';
    el.style.cursor='text';
  },true);

  document.addEventListener('mouseout',function(e){
    if(e.target.tagName==='IMG'&&e.target!==active){
      e.target.style.outline='';
      e.target.style.cursor='';
      return;
    }
    var el=findTextEl(e.target);
    if(!el||el===active)return;
    el.style.outline='';
    el.style.outlineOffset='';
    el.style.cursor='';
  },true);

  // ── Click ────────────────────────────────────────────────────────────────
  document.addEventListener('click',function(e){
    // Always block navigation — nothing in the visual editor should navigate the iframe
    e.preventDefault();
    e.stopPropagation();
    // Image click → open image editor
    if(e.target.tagName==='IMG'){
      if(active)saveAndExit();
      showImageEditor(e.target);
      return;
    }
    // Close image editor on outside click
    var imgWrap=document.getElementById('__ve_img__');
    if(imgWrap&&!imgWrap.contains(e.target)){
      imgWrap.parentNode.removeChild(imgWrap);
    }
    var el=findTextEl(e.target);
    if(!el){saveAndExit();return;}
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

  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const DESKTOP_WIDTH = 1280

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      setScale(w >= DESKTOP_WIDTH ? 1 : w / DESKTOP_WIDTH)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const editableHtml = html ? injectEditScript(html) : ''
  // When scaled down, the iframe still occupies DESKTOP_WIDTH px but is visually
  // shrunk. The outer container needs explicit height so it doesn't collapse.
  const scaledHeight = `calc(100vh / ${scale})`

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
      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div
          style={{
            width: DESKTOP_WIDTH,
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
            // Compensate container height so scroll works correctly
            height: scale < 1 ? `${scale * 100}%` : undefined,
          }}
        >
          <iframe
            srcDoc={editableHtml}
            className="border-0"
            style={{ width: DESKTOP_WIDTH, height: scaledHeight, minHeight: '100vh' }}
            sandbox="allow-scripts allow-same-origin"
            title="Visual Editor"
          />
        </div>
      </div>
    </div>
  )
}

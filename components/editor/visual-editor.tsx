'use client'

import { useState, useCallback } from 'react'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface VisualEditorProps {
  onScriptChange: (script: string) => void
  className?: string
}

interface StyleConfig {
  fontFamily: string
  fontSize: number
  primaryColor: string
  backgroundColor: string
  textColor: string
  borderRadius: number
  spacing: number
}

const FONT_OPTIONS = [
  { value: 'system-ui, sans-serif', label: 'System UI' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Inter', sans-serif", label: 'Inter' },
  { value: "'Roboto', sans-serif", label: 'Roboto' },
  { value: "'Playfair Display', serif", label: 'Playfair Display' },
  { value: 'monospace', label: 'Monospace' },
]

function Label_({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1"
    >
      {children}
    </label>
  )
}

export function VisualEditor({ onScriptChange, className = '' }: VisualEditorProps) {
  const [config, setConfig] = useState<StyleConfig>({
    fontFamily: 'system-ui, sans-serif',
    fontSize: 16,
    primaryColor: '#000000',
    backgroundColor: '#ffffff',
    textColor: '#111111',
    borderRadius: 4,
    spacing: 1,
  })

  const generateScript = useCallback((cfg: StyleConfig): string => {
    const parts: string[] = []

    // Background color — only elements that already have a background
    parts.push(
      `const bg='${cfg.backgroundColor}';` +
      `document.querySelectorAll('*').forEach(el=>{` +
      `const computed=window.getComputedStyle(el).backgroundColor;` +
      `if(computed!=='rgba(0, 0, 0, 0)'&&computed!=='transparent'){` +
      `el.style.setProperty('background-color',bg,'important');}});`
    )

    // Text color
    parts.push(
      `document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,span,a,li,td,th,label,div').forEach(el=>el.style.setProperty('color','${cfg.textColor}','important'));`
    )

    // Font family
    parts.push(
      `document.querySelectorAll('*').forEach(el=>el.style.setProperty('font-family','${cfg.fontFamily}','important'));`
    )

    return parts.join('\n')
  }, [])

  const updateConfig = (partial: Partial<StyleConfig>) => {
    const newConfig = { ...config, ...partial }
    setConfig(newConfig)
    onScriptChange(generateScript(newConfig))
  }

  return (
    <div className={`p-4 space-y-5 overflow-y-auto ${className}`}>
      <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Visual Editor</h3>

      {/* Font Family */}
      <div>
        <Label_>Font Family</Label_>
        <Select
          value={config.fontFamily}
          onValueChange={(val) => updateConfig({ fontFamily: val })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_OPTIONS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Font Size */}
      <div>
        <Label_>Font Size: {config.fontSize}px</Label_>
        <Slider
          min={12}
          max={24}
          step={1}
          value={[config.fontSize]}
          onValueChange={([val]) => updateConfig({ fontSize: val })}
          className="mt-2"
        />
      </div>

      {/* Primary Color */}
      <div>
        <Label_>Primary Color</Label_>
        <div className="flex items-center gap-2 mt-1">
          <input
            type="color"
            value={config.primaryColor}
            onChange={(e) => updateConfig({ primaryColor: e.target.value })}
            className="w-8 h-8 rounded cursor-pointer border border-neutral-200 dark:border-neutral-700"
          />
          <span className="text-xs text-neutral-500 font-mono">{config.primaryColor}</span>
        </div>
      </div>

      {/* Background Color */}
      <div>
        <Label_>Background Color</Label_>
        <div className="flex items-center gap-2 mt-1">
          <input
            type="color"
            value={config.backgroundColor}
            onChange={(e) => updateConfig({ backgroundColor: e.target.value })}
            className="w-8 h-8 rounded cursor-pointer border border-neutral-200 dark:border-neutral-700"
          />
          <span className="text-xs text-neutral-500 font-mono">{config.backgroundColor}</span>
        </div>
      </div>

      {/* Text Color */}
      <div>
        <Label_>Text Color</Label_>
        <div className="flex items-center gap-2 mt-1">
          <input
            type="color"
            value={config.textColor}
            onChange={(e) => updateConfig({ textColor: e.target.value })}
            className="w-8 h-8 rounded cursor-pointer border border-neutral-200 dark:border-neutral-700"
          />
          <span className="text-xs text-neutral-500 font-mono">{config.textColor}</span>
        </div>
      </div>

      {/* Border Radius */}
      <div>
        <Label_>Button Radius: {config.borderRadius}px</Label_>
        <Slider
          min={0}
          max={24}
          step={1}
          value={[config.borderRadius]}
          onValueChange={([val]) => updateConfig({ borderRadius: val })}
          className="mt-2"
        />
      </div>

      {/* Spacing */}
      <div>
        <Label_>Spacing Scale: {config.spacing}x</Label_>
        <Slider
          min={0.5}
          max={2}
          step={0.1}
          value={[config.spacing]}
          onValueChange={([val]) => updateConfig({ spacing: parseFloat(val.toFixed(1)) })}
          className="mt-2"
        />
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { Sparkles, ArrowRight, ArrowLeft, X } from 'lucide-react'

interface BrandData {
  brandName: string
  tagline: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
  logoUrl: string
  brandDescription: string
  headline: string
  subheadline: string
  ctaText: string
}

interface BrandWizardProps {
  projectId: string
  folderId?: string
  onClose: () => void
  onRebuildStart: () => void
  onHtmlChunk: (chunk: string) => void
  onRebuildComplete: (html: string) => void
  onRebuildError: (err: string) => void
  onImageGenStatus?: (status: { current: number; total: number } | null) => void
}

const STEPS = [
  { id: 1, title: 'Brand Identity', description: 'Tell us about your brand' },
  { id: 2, title: 'Colors', description: 'Choose your brand colors' },
  { id: 3, title: 'Content', description: 'Key copy for your site' },
]

const DEFAULT_BRAND: BrandData = {
  brandName: '',
  tagline: '',
  primaryColor: '#6366f1',
  secondaryColor: '#f8fafc',
  accentColor: '#8b5cf6',
  logoUrl: '',
  brandDescription: '',
  headline: '',
  subheadline: '',
  ctaText: 'Get Started',
}

export function BrandWizard({
  projectId,
  folderId,
  onClose,
  onRebuildStart,
  onHtmlChunk,
  onRebuildComplete,
  onRebuildError,
  onImageGenStatus,
}: BrandWizardProps) {
  const [step, setStep] = useState(1)
  const [brand, setBrand] = useState<BrandData>(DEFAULT_BRAND)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loading, setLoading] = useState(!!folderId)

  // Load brand from folder on mount
  useEffect(() => {
    if (!folderId) return
    fetch(`/api/folders/${folderId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.folder?.brand_profile) {
          setBrand({ ...DEFAULT_BRAND, ...data.folder.brand_profile })
        }
      })
      .catch(() => {/* ignore */})
      .finally(() => setLoading(false))
  }, [folderId])

  const saveBrandToFolder = async (data: BrandData) => {
    if (!folderId) return
    await fetch(`/api/folders/${folderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_profile: data }),
    }).catch(() => {/* ignore */})
  }

  const update = (key: keyof BrandData, value: string) =>
    setBrand((prev) => ({ ...prev, [key]: value }))

  const canNext = () => {
    if (step === 1) return brand.brandName.trim().length > 0 && brand.brandDescription.trim().length > 0
    if (step === 2) return true
    if (step === 3) return true
    return false
  }

  const handleNext = async () => {
    await saveBrandToFolder(brand)
    setStep(step + 1)
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    await saveBrandToFolder(brand)
    onRebuildStart()
    onClose()

    try {
      const res = await fetch(`/api/projects/${projectId}/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brand),
      })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        onRebuildError(data.error || 'Rebuild failed')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const parsed = JSON.parse(line.slice(6))
            if (parsed.htmlChunk) {
              onHtmlChunk(parsed.htmlChunk)
            }
            if (parsed.status === 'generating_images') {
              onImageGenStatus?.({
                current: parsed.current ?? 1,
                total: parsed.total ?? 3,
              })
            }
            if (parsed.done && parsed.html) {
              onImageGenStatus?.(null)
              onRebuildComplete(parsed.html)
            }
            if (parsed.error) {
              onImageGenStatus?.(null)
              onRebuildError(parsed.error)
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      onRebuildError('Network error during rebuild')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-lg border border-neutral-200 dark:border-neutral-700">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-purple-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-neutral-900 dark:text-white text-sm">AI Brand Rebuild</h2>
              <p className="text-xs text-neutral-500">{STEPS[step - 1].description}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 px-6 py-3">
          {STEPS.map((s) => (
            <div key={s.id} className="flex items-center gap-2 flex-1">
              <div className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors',
                step >= s.id
                  ? 'bg-purple-600 text-white'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400'
              )}>
                {s.id}
              </div>
              <span className={cn(
                'text-xs font-medium hidden sm:block',
                step >= s.id ? 'text-neutral-700 dark:text-neutral-300' : 'text-neutral-400'
              )}>
                {s.title}
              </span>
              {s.id < STEPS.length && (
                <div className={cn(
                  'flex-1 h-px',
                  step > s.id ? 'bg-purple-300' : 'bg-neutral-200 dark:bg-neutral-700'
                )} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="px-6 py-4 space-y-4 min-h-[240px]">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-5 h-5 rounded-full border-2 border-purple-600 border-t-transparent animate-spin" />
            </div>
          ) : (
            <>
              {step === 1 && (
                <>
                  {!folderId && (
                    <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2.5">
                      <span className="text-amber-500 mt-0.5 text-sm">💡</span>
                      <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                        Add this project to a folder to share brand settings across all pages of the same site.
                      </p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Brand Name *</Label>
                    <Input
                      placeholder="e.g. Acme Corp"
                      value={brand.brandName}
                      onChange={(e) => update('brandName', e.target.value)}
                      className="h-9 text-sm"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Tagline</Label>
                    <Input
                      placeholder="e.g. Build faster, ship better"
                      value={brand.tagline}
                      onChange={(e) => update('tagline', e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Describe your brand *</Label>
                    <textarea
                      placeholder="e.g. We help startups automate their marketing with AI. Our customers are B2B SaaS founders who want to grow without hiring a big team."
                      value={brand.brandDescription}
                      onChange={(e) => update('brandDescription', e.target.value)}
                      className="w-full h-24 px-3 py-2 text-sm rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder:text-neutral-400 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Logo URL <span className="text-neutral-400">(optional)</span></Label>
                    <Input
                      placeholder="https://yoursite.com/logo.png"
                      value={brand.logoUrl}
                      onChange={(e) => update('logoUrl', e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <p className="text-xs text-neutral-500">Pick your brand colors. These will be applied throughout the redesigned site.</p>
                  {[
                    { key: 'primaryColor', label: 'Primary Color', hint: 'Main brand color — navbars, buttons, headings' },
                    { key: 'secondaryColor', label: 'Secondary Color', hint: 'Background sections, cards' },
                    { key: 'accentColor', label: 'Accent / CTA Color', hint: 'Call-to-action buttons, highlights' },
                  ].map(({ key, label, hint }) => (
                    <div key={key} className="space-y-1.5">
                      <Label className="text-xs font-medium">{label}</Label>
                      <p className="text-xs text-neutral-400">{hint}</p>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={brand[key as keyof BrandData]}
                          onChange={(e) => update(key as keyof BrandData, e.target.value)}
                          className="w-10 h-9 rounded cursor-pointer border border-neutral-200 dark:border-neutral-700 p-0.5 bg-white"
                        />
                        <Input
                          value={brand[key as keyof BrandData]}
                          onChange={(e) => update(key as keyof BrandData, e.target.value)}
                          placeholder="#6366f1"
                          className="h-9 text-sm font-mono"
                        />
                      </div>
                    </div>
                  ))}
                </>
              )}

              {step === 3 && (
                <>
                  <p className="text-xs text-neutral-500">Key copy for your site. Leave blank to auto-generate from your brand description.</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Hero Headline</Label>
                    <Input
                      placeholder={`e.g. ${brand.brandName || 'Your Brand'} — ${brand.tagline || 'Your Tagline'}`}
                      value={brand.headline}
                      onChange={(e) => update('headline', e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Hero Subheadline</Label>
                    <Input
                      placeholder="e.g. The all-in-one platform for modern teams"
                      value={brand.subheadline}
                      onChange={(e) => update('subheadline', e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">CTA Button Text</Label>
                    <Input
                      placeholder="e.g. Get Started, Book a Demo, Try for Free"
                      value={brand.ctaText}
                      onChange={(e) => update('ctaText', e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-6 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => step > 1 ? setStep(step - 1) : onClose()}
            className="gap-1 text-xs"
          >
            <ArrowLeft className="w-3 h-3" />
            {step > 1 ? 'Back' : 'Cancel'}
          </Button>

          {step < STEPS.length ? (
            <Button
              size="sm"
              onClick={handleNext}
              disabled={!canNext() || loading}
              className="gap-1 text-xs bg-purple-600 hover:bg-purple-500 text-white"
            >
              Next
              <ArrowRight className="w-3 h-3" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting || loading}
              className="gap-1.5 text-xs bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white border-0"
            >
              <Sparkles className="w-3 h-3" />
              Rebuild with AI
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

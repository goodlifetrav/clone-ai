'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { Sparkles, ArrowRight, ArrowLeft, X, FolderOpen, FolderPlus, Check, ChevronDown } from 'lucide-react'

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
  productName: string
  productDescription: string
}

interface Folder {
  id: string
  name: string
}

interface BrandWizardProps {
  projectId: string
  projectUrl?: string
  folderId?: string
  onClose: () => void
  onRebuildStart: () => void
  onHtmlChunk: (chunk: string) => void
  onRebuildComplete: (html: string) => void
  onRebuildError: (err: string) => void
  onImageGenStatus?: (status: { current: number; total: number } | null) => void
  onFolderAssigned?: (folderId: string, folderName: string) => void
}

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
  productName: '',
  productDescription: '',
}

function detectPageType(url?: string): 'homepage' | 'product' | 'collection' | 'other' {
  if (!url) return 'homepage'
  try {
    const path = new URL(url).pathname
    if (/\/products\//i.test(path)) return 'product'
    if (/\/collections\//i.test(path)) return 'collection'
    if (/\/cart|\/account|\/pages\//i.test(path)) return 'other'
    if (path === '/' || path === '') return 'homepage'
    return 'other'
  } catch {
    return 'homepage'
  }
}

export function BrandWizard({
  projectId,
  projectUrl,
  folderId: folderIdProp,
  onClose,
  onRebuildStart,
  onHtmlChunk,
  onRebuildComplete,
  onRebuildError,
  onImageGenStatus,
  onFolderAssigned,
}: BrandWizardProps) {
  const pageType = detectPageType(projectUrl)
  const isHomepage = pageType === 'homepage'

  const step3 = isHomepage
    ? { id: 3, title: 'Content', description: 'Key copy for your homepage' }
    : pageType === 'product'
      ? { id: 3, title: 'Product', description: 'Tell us about this product' }
      : null

  const STEPS = [
    { id: 1, title: 'Brand Identity', description: 'Tell us about your brand' },
    { id: 2, title: 'Colors', description: 'Choose your brand colors' },
    ...(step3 ? [step3] : []),
  ]

  const [step, setStep] = useState(1)
  const [brand, setBrand] = useState<BrandData>(DEFAULT_BRAND)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loading, setLoading] = useState(!!folderIdProp)

  // Active folder state — starts from prop, can be assigned inline
  const [activeFolderId, setActiveFolderId] = useState<string | undefined>(folderIdProp)
  const [activeFolderName, setActiveFolderName] = useState<string | undefined>()

  // Folder picker state
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderMode, setFolderMode] = useState<'idle' | 'pick' | 'create'>('idle')
  const [newFolderName, setNewFolderName] = useState('')
  const [assigning, setAssigning] = useState(false)

  // Load existing folders when no folder assigned
  useEffect(() => {
    if (activeFolderId) return
    fetch('/api/folders')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.folders) setFolders(data.folders) })
      .catch(() => {})
  }, [activeFolderId])

  // Load brand from folder on mount
  useEffect(() => {
    if (!activeFolderId) return
    setLoading(true)
    fetch(`/api/folders/${activeFolderId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.folder?.brand_profile) {
          setBrand({ ...DEFAULT_BRAND, ...data.folder.brand_profile })
        }
        if (data?.folder?.name) setActiveFolderName(data.folder.name)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [activeFolderId])

  const assignToFolder = async (folderId: string, folderName: string) => {
    setAssigning(true)
    try {
      // Move project into folder
      await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: folderId }),
      })
      setActiveFolderId(folderId)
      setActiveFolderName(folderName)
      setFolderMode('idle')
      onFolderAssigned?.(folderId, folderName)
    } catch {/* ignore */} finally {
      setAssigning(false)
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    setAssigning(true)
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName.trim() }),
      })
      const data = await res.json()
      if (data?.folder) {
        await assignToFolder(data.folder.id, data.folder.name)
        setNewFolderName('')
      }
    } catch {/* ignore */} finally {
      setAssigning(false)
    }
  }

  const saveBrandToFolder = async (data: BrandData) => {
    if (!activeFolderId) return
    // Exclude product-specific fields — they belong to individual pages, not the shared brand
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { productName, productDescription, ...brandProfile } = data
    await fetch(`/api/folders/${activeFolderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_profile: brandProfile }),
    }).catch(() => {})
  }

  const update = (key: keyof BrandData, value: string) =>
    setBrand((prev) => ({ ...prev, [key]: value }))

  const canNext = () => {
    if (step === 1) return brand.brandName.trim().length > 0 && brand.brandDescription.trim().length > 0
    return true
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
        body: JSON.stringify({ ...brand, pageType }),
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
            if (parsed.htmlChunk) onHtmlChunk(parsed.htmlChunk)
            if (parsed.status === 'generating_images') {
              onImageGenStatus?.({ current: parsed.current ?? 1, total: parsed.total ?? 3 })
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
                step >= s.id ? 'bg-purple-600 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400'
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
                <div className={cn('flex-1 h-px', step > s.id ? 'bg-purple-300' : 'bg-neutral-200 dark:bg-neutral-700')} />
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
                  {/* Folder assignment — inline, actionable */}
                  {activeFolderId ? (
                    <div className="flex items-center gap-2 rounded-xl bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 px-4 py-2.5">
                      <Check className="w-4 h-4 text-green-500 shrink-0" />
                      <p className="text-xs text-green-800 dark:text-green-300 font-medium">
                        Saved to <span className="font-semibold">{activeFolderName}</span> — brand syncs across all pages in this folder
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-3 bg-neutral-50 dark:bg-neutral-800/60">
                        <FolderOpen className="w-4 h-4 text-purple-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">Add to a folder</p>
                          <p className="text-xs text-neutral-500 leading-relaxed">Brand settings will auto-fill on every other page in the folder.</p>
                        </div>
                      </div>

                      {folderMode === 'idle' && (
                        <div className="flex gap-2 px-4 py-3 border-t border-neutral-200 dark:border-neutral-700">
                          {folders.length > 0 && (
                            <button
                              onClick={() => setFolderMode('pick')}
                              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors"
                            >
                              <ChevronDown className="w-3 h-3" />
                              Add to existing folder
                            </button>
                          )}
                          <button
                            onClick={() => setFolderMode('create')}
                            className={cn(
                              'flex items-center justify-center gap-1.5 text-xs font-medium py-2 px-3 rounded-lg transition-colors',
                              folders.length > 0
                                ? 'border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                                : 'flex-1 bg-purple-600 hover:bg-purple-500 text-white'
                            )}
                          >
                            <FolderPlus className="w-3 h-3" />
                            Create new folder
                          </button>
                        </div>
                      )}

                      {folderMode === 'pick' && (
                        <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-700 space-y-2">
                          <p className="text-xs text-neutral-500">Select a folder:</p>
                          <div className="space-y-1 max-h-36 overflow-y-auto">
                            {folders.map(f => (
                              <button
                                key={f.id}
                                onClick={() => assignToFolder(f.id, f.name)}
                                disabled={assigning}
                                className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-950/40 hover:text-purple-700 dark:hover:text-purple-300 transition-colors text-neutral-700 dark:text-neutral-300 flex items-center gap-2"
                              >
                                <FolderOpen className="w-3 h-3 shrink-0 text-neutral-400" />
                                {f.name}
                              </button>
                            ))}
                          </div>
                          <button onClick={() => setFolderMode('idle')} className="text-xs text-neutral-400 hover:text-neutral-600">← Back</button>
                        </div>
                      )}

                      {folderMode === 'create' && (
                        <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-700 space-y-2">
                          <p className="text-xs text-neutral-500">Name your folder (e.g. "Death Wish Coffee"):</p>
                          <div className="flex gap-2">
                            <Input
                              placeholder="Folder name"
                              value={newFolderName}
                              onChange={(e) => setNewFolderName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                              className="h-8 text-xs"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              onClick={handleCreateFolder}
                              disabled={!newFolderName.trim() || assigning}
                              className="h-8 text-xs bg-purple-600 hover:bg-purple-500 text-white shrink-0"
                            >
                              {assigning ? '…' : 'Create'}
                            </Button>
                          </div>
                          <button onClick={() => setFolderMode('idle')} className="text-xs text-neutral-400 hover:text-neutral-600">← Back</button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Brand Name *</Label>
                    <Input
                      placeholder="e.g. Valhalla Roast"
                      value={brand.brandName}
                      onChange={(e) => update('brandName', e.target.value)}
                      className="h-9 text-sm"
                      autoFocus={!!activeFolderId}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Tagline</Label>
                    <Input
                      placeholder="e.g. Fuel for the Bold"
                      value={brand.tagline}
                      onChange={(e) => update('tagline', e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Describe your brand *</Label>
                    <textarea
                      placeholder="e.g. Bold, rebellious coffee brand. Dark aesthetic, USDA organic, fair trade. Target: serious coffee drinkers 25-45."
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

              {step === 3 && pageType === 'product' && (
                <>
                  <p className="text-xs text-neutral-500">Help the AI style this product page. Both fields are optional — leave blank to auto-generate from your brand.</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Product Name <span className="text-neutral-400">(optional)</span></Label>
                    <Input
                      placeholder="e.g. Norse Winter Beard Oil"
                      value={brand.productName}
                      onChange={(e) => update('productName', e.target.value)}
                      className="h-9 text-sm"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Describe this product <span className="text-neutral-400">(optional)</span></Label>
                    <textarea
                      placeholder="e.g. Cold-weather beard oil with pine and cedarwood. Deep conditioning formula for dry, coarse beards. Best seller in the winter collection."
                      value={brand.productDescription}
                      onChange={(e) => update('productDescription', e.target.value)}
                      className="w-full h-28 px-3 py-2 text-sm rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder:text-neutral-400 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </>
              )}

              {step === 3 && isHomepage && (
                <>
                  <p className="text-xs text-neutral-500">Key copy for your homepage. Leave blank to auto-generate from your brand description.</p>
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
                      placeholder="e.g. Shop Now, Book a Demo, Try for Free"
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

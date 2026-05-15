'use client'

import { useState, useEffect } from 'react'

const WORDS = ['Website', 'Shopify Store', 'Funnel', 'Sales Page', 'Landing Page']
const TYPE_SPEED = 75
const DELETE_SPEED = 45
const WAIT_AFTER = 2400
const WAIT_BEFORE = 320

export function TypewriterHeadline() {
  const [wordIndex, setWordIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(WORDS[0].length)
  const [phase, setPhase] = useState<'waiting' | 'deleting' | 'typing'>('waiting')

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>

    if (phase === 'waiting') {
      timeout = setTimeout(() => setPhase('deleting'), WAIT_AFTER)
    } else if (phase === 'deleting') {
      if (charIndex > 0) {
        timeout = setTimeout(() => setCharIndex(c => c - 1), DELETE_SPEED)
      } else {
        timeout = setTimeout(() => {
          setWordIndex(i => (i + 1) % WORDS.length)
          setPhase('typing')
        }, WAIT_BEFORE)
      }
    } else {
      const target = WORDS[wordIndex].length
      if (charIndex < target) {
        timeout = setTimeout(() => setCharIndex(c => c + 1), TYPE_SPEED)
      } else {
        setPhase('waiting')
      }
    }

    return () => clearTimeout(timeout)
  }, [phase, charIndex, wordIndex])

  const displayed = WORDS[wordIndex].slice(0, charIndex)

  return (
    <h1 className="text-5xl md:text-7xl font-bold text-center tracking-tight text-neutral-900 dark:text-white max-w-4xl leading-tight mb-6">
      Clone Any{' '}
      <span className="inline-block relative whitespace-nowrap">
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-500 to-violet-400">
          {displayed}
        </span>
        <span className="inline-block w-[3px] h-[0.85em] bg-purple-400 ml-1 align-middle rounded-full animate-pulse" />
      </span>
    </h1>
  )
}

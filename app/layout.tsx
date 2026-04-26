import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { ThemeProvider } from 'next-themes'
import './globals.css'

export const metadata: Metadata = {
  title: 'CloneAI — Clone Any Website with AI',
  description:
    'Paste a URL and get an editable, AI-powered clone in seconds. Powered by Claude AI.',
  keywords: ['website cloner', 'AI', 'web development', 'clone', 'design'],
  openGraph: {
    title: 'CloneAI — Clone Any Website with AI',
    description: 'Paste a URL and get an editable, AI-powered clone in seconds.',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}

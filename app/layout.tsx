import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import { AuthModal } from '@/components/auth-modal'
import './globals.css'

export const metadata: Metadata = {
  title: 'IgualAI — Clone Any Website',
  description:
    'Paste a URL and get an editable, AI-powered clone in seconds. Customize with chat, deploy anywhere.',
  keywords: ['website cloner', 'AI', 'web development', 'clone', 'design'],
  openGraph: {
    title: 'IgualAI — Clone Any Website',
    description:
      'Paste a URL and get an editable, AI-powered clone in seconds. Customize with chat, deploy anywhere.',
    url: 'https://igualai.com',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'IgualAI — Clone Any Website',
    description:
      'Paste a URL and get an editable, AI-powered clone in seconds. Customize with chat, deploy anywhere.',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <AuthModal />
        </ThemeProvider>
      </body>
    </html>
  )
}

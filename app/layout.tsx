import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { ThemeProvider } from 'next-themes'
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
    <ClerkProvider
      localization={{
        signIn: {
          start: {
            title: 'Sign in to IgualAI',
            subtitle: 'Welcome back! Please sign in to continue',
          },
        },
        signUp: {
          start: {
            title: 'Create your IgualAI account',
            subtitle: 'Clone any website with AI in seconds',
          },
        },
      }}
    >
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

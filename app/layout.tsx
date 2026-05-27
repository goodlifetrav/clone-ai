import type { Metadata } from 'next'
import Script from 'next/script'
import { ThemeProvider } from 'next-themes'
import { AuthModal } from '@/components/auth-modal'
import { AnalyticsTracker } from '@/components/analytics-tracker'
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
          <AnalyticsTracker />
        </ThemeProvider>
        <Script id="meta-pixel" strategy="afterInteractive">{`
          !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
          n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
          document,'script','https://connect.facebook.net/en_US/fbevents.js');
          fbq('init','978544731579259');
          fbq('track','PageView');
        `}</Script>
        <noscript><img height="1" width="1" style={{display:'none'}}
          src="https://www.facebook.com/tr?id=978544731579259&ev=PageView&noscript=1" alt=""
        /></noscript>
      </body>
    </html>
  )
}

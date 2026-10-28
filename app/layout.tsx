import { DM_Sans, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { ChunkLoadErrorHandler } from '@/components/chunk-load-error-handler'
import type { Metadata } from 'next'

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-sans' })
const jakartaSans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-display' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

const API_KEY = process.env.SHOPIFY_API_KEY ?? ''

// Favicons use the App Router file conventions (app/favicon.ico, app/icon.png,
// app/apple-icon.png); Next.js emits the <link rel="icon"/"apple-touch-icon"> tags itself,
// so no `icons` field is set here.
export const metadata: Metadata = {
  title: 'OXIVOLT Bulk Editor',
  description: 'Bulk edit vendor, price and inventory across all your Shopify products in seconds.',
  openGraph: {
    title: 'OXIVOLT Bulk Editor',
    description: 'Bulk edit vendor, price and inventory across all your Shopify products in seconds.',
    images: ['/og-image.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Shopify App Bridge must load first, before any other script. */}
        <meta name="shopify-api-key" content={API_KEY} />
        {/* Must stay a plain, synchronous <script> (not next/script): Shopify requires App
            Bridge to load before any other script, so the no-sync-scripts rule is disabled here. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      </head>
      <body className={`${dmSans.variable} ${jakartaSans.variable} ${jetbrainsMono.variable} font-sans`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors position="top-center" />
          {/* IMPORTANT: Do not remove — handles chunk loading race conditions in the dev server */}
          <ChunkLoadErrorHandler />
        </ThemeProvider>
      </body>
    </html>
  )
}

import { NextRequest } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { Resend } from 'resend'
import { createServiceClient, uploadThumbnail } from '@/lib/supabase'
import { scrapeWebsite } from '@/lib/playwright'
import { generateCloneStreaming } from '@/lib/anthropic'
import { extractDomain } from '@/lib/utils'
import { isAdminEmail } from '@/lib/admin'

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      // Wrapping send() in try/catch means stream write errors (e.g. client
      // disconnected) never abort the server-side processing — the scrape and
      // AI generation continue even if the browser tab is closed.
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Client disconnected — processing continues server-side
        }
      }

      try {
        const { userId } = await auth()
        if (!userId) {
          send({ error: 'Unauthorized' })
          return
        }

        const { url } = await request.json()
        if (!url) {
          send({ error: 'URL is required' })
          return
        }

        const supabase = createServiceClient()

        // Get or create user record
        let { data: user, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('clerk_id', userId)
          .single()

        if (userError || !user) {
          const clerkUser = await currentUser()
          const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? ''
          const name = clerkUser
            ? `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim()
            : ''

          const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
              clerk_id: userId,
              email,
              name,
              plan: 'free',
              tokens_used: 0,
              clones_count: 0,
            })
            .select()
            .single()

          if (createError) {
            console.error('Error creating user:', createError)
            send({ error: 'Failed to create user record' })
            return
          }
          user = newUser
        }

        // Check free tier limits — DB admins and ADMIN_EMAILS are exempt
        const adminByEmail = isAdminEmail(user.email)
        if (!user.is_admin && !adminByEmail && user.plan === 'free' && user.clones_count >= 1) {
          send({
            error: 'Free tier limit reached. Upgrade to clone more websites.',
            upgradeRequired: true,
          })
          return
        }

        // Create project row immediately so it appears in the dashboard as
        // "processing" even if the user closes the tab before we finish.
        const { data: project, error: projectCreateError } = await supabase
          .from('projects')
          .insert({
            user_id: user.id,
            name: extractDomain(url) || new URL(url).hostname,
            url,
            thumbnail_url: null,
            html_content: '',
            status: 'processing',
          })
          .select()
          .single()

        if (projectCreateError) {
          console.error('Project create error:', projectCreateError)
          send({ error: 'Failed to create project' })
          return
        }

        // Send the project ID immediately — client redirects to the editor
        // which shows a processing state, and can safely close the tab.
        send({ processing: true, projectId: project.id })

        // ── Everything below runs even if the client disconnects ──────────

        // Scrape with live progress — check cache first (24h window)
        let scrapeResult
        const cacheWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: cachedScrape } = await supabase
          .from('scrape_cache')
          .select('html, screenshot_base64, title')
          .eq('url', url)
          .gte('scraped_at', cacheWindow)
          .order('scraped_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (cachedScrape) {
          send({ step: 'Using cached page data...' })
          scrapeResult = {
            html: cachedScrape.html,
            screenshotBase64: cachedScrape.screenshot_base64,
            title: cachedScrape.title ?? '',
          }
        } else {
          try {
            scrapeResult = await scrapeWebsite(url, (step) => send({ step }))
            // Store in cache (fire-and-forget — don't block on errors)
            void supabase.from('scrape_cache').insert({
              url,
              html: scrapeResult.html,
              screenshot_base64: scrapeResult.screenshotBase64,
              title: scrapeResult.title,
            })
          } catch (err: unknown) {
            const error = err as Error
            console.error('Scrape error:', error)
            await supabase
              .from('projects')
              .update({ status: 'error' })
              .eq('id', project.id)
            if (
              error.message?.includes('playwright') ||
              error.message?.includes('chromium') ||
              error.message?.includes('Playwright')
            ) {
              send({ error: `Playwright not configured: ${error.message}` })
            } else {
              send({ error: `Failed to access website: ${error.message}` })
            }
            return
          }
        }

        // Generate clone with Claude (streaming — saves partial HTML to DB live)
        send({ step: 'Sending to Claude AI...' })
        let html: string
        let tokensUsed: number
        try {
          ;({ html, tokensUsed } = await generateCloneStreaming(
            scrapeResult.html,
            scrapeResult.screenshotBase64,
            url,
            async (partialText) => {
              // Save partial HTML so the editor can show live progress
              await supabase
                .from('projects')
                .update({ html_content: partialText })
                .eq('id', project.id)
            }
          ))
        } catch (err: unknown) {
          const error = err as Error
          console.error('Claude error:', error)
          await supabase
            .from('projects')
            .update({ status: 'error' })
            .eq('id', project.id)
          send({ error: `AI generation failed: ${error.message}` })
          return
        }

        send({ step: 'Saving project...' })

        const projectName =
          scrapeResult.title || extractDomain(url) || new URL(url).hostname

        // Update project with final HTML, real name, and completed status
        await supabase
          .from('projects')
          .update({
            name: projectName,
            html_content: html,
            status: 'complete',
          })
          .eq('id', project.id)

        // Upload thumbnail
        const pngBuffer = Buffer.from(scrapeResult.screenshotBase64, 'base64')
        const thumbnailUrl = await uploadThumbnail(project.id, pngBuffer)
        if (thumbnailUrl) {
          await supabase
            .from('projects')
            .update({ thumbnail_url: thumbnailUrl })
            .eq('id', project.id)
        }

        // Update user stats
        await supabase
          .from('users')
          .update({
            tokens_used: (user.tokens_used || 0) + tokensUsed,
            clones_count: (user.clones_count || 0) + 1,
          })
          .eq('id', user.id)

        await supabase.from('project_versions').insert({
          project_id: project.id,
          html_content: html,
          version_number: 1,
        })

        send({ done: true, projectId: project.id })

        // Send completion email
        const resendKey = process.env.RESEND_API_KEY
        const userEmail = user.email
        if (resendKey && userEmail) {
          try {
            const resend = new Resend(resendKey)
            const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
            const editorLink = `${appUrl}/editor/${project.id}`
            await resend.emails.send({
              from: 'IgualAI <noreply@igualai.com>',
              to: userEmail,
              subject: 'Your clone is ready!',
              html: `<p>Your clone of <strong>${url}</strong> is ready to view and edit.</p><p><a href="${editorLink}">Open in editor</a></p>`,
            })
          } catch (emailErr) {
            // Non-fatal — log but don't fail the request
            console.error('Failed to send completion email:', emailErr)
          }
        }
      } catch (err) {
        const error = err as Error
        console.error('Clone API error:', error.message, error.stack)
        send({ error: error.message || 'Internal server error' })
      } finally {
        try {
          controller.close()
        } catch {
          // Already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

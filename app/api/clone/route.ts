import { NextRequest } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { Resend } from 'resend'
import { createServiceClient, uploadThumbnail } from '@/lib/supabase'
import { scrapeWebsite } from '@/lib/playwright'
import { generateClone } from '@/lib/anthropic'
import { extractDomain } from '@/lib/utils'

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const { userId } = await auth()
        if (!userId) {
          send({ error: 'Unauthorized' })
          controller.close()
          return
        }

        const { url } = await request.json()
        if (!url) {
          send({ error: 'URL is required' })
          controller.close()
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
          const name = clerkUser ? `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim() : ''

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
            controller.close()
            return
          }
          user = newUser
        }

        // Check free tier limits — admins are exempt
        if (!user.is_admin && user.plan === 'free' && user.clones_count >= 1) {
          send({
            error: 'Free tier limit reached. Upgrade to clone more websites.',
            upgradeRequired: true,
          })
          controller.close()
          return
        }

        // Scrape with live progress
        let scrapeResult
        try {
          scrapeResult = await scrapeWebsite(url, (step) => send({ step }))
        } catch (err: unknown) {
          const error = err as Error
          console.error('Scrape error:', error)
          if (
            error.message?.includes('playwright') ||
            error.message?.includes('chromium') ||
            error.message?.includes('Playwright')
          ) {
            send({ error: `Playwright not configured: ${error.message}` })
          } else {
            send({ error: `Failed to access website: ${error.message}` })
          }
          controller.close()
          return
        }

        // Generate clone with Claude
        send({ step: 'Sending to Claude AI...' })
        let html: string
        let tokensUsed: number
        try {
          ;({ html, tokensUsed } = await generateClone(
            scrapeResult.html,
            scrapeResult.screenshotBase64,
            url
          ))
        } catch (err: unknown) {
          const error = err as Error
          console.error('Claude error:', error)
          send({ error: `AI generation failed: ${error.message}` })
          controller.close()
          return
        }

        send({ step: 'Saving project...' })

        const projectName =
          scrapeResult.title || extractDomain(url) || new URL(url).hostname

        // Insert project first to get the ID, then upload thumbnail using it
        const { data: project, error: projectError } = await supabase
          .from('projects')
          .insert({
            user_id: user.id,
            name: projectName,
            url,
            thumbnail_url: null,
            html_content: html,
          })
          .select()
          .single()

        if (projectError) {
          console.error('Project insert error:', projectError)
          send({ error: 'Failed to save project' })
          controller.close()
          return
        }

        // Upload thumbnail to Supabase Storage and update the project row
        const pngBuffer = Buffer.from(scrapeResult.screenshotBase64, 'base64')
        const thumbnailUrl = await uploadThumbnail(project.id, pngBuffer)
        if (thumbnailUrl) {
          await supabase
            .from('projects')
            .update({ thumbnail_url: thumbnailUrl })
            .eq('id', project.id)
        }

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
        controller.close()
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

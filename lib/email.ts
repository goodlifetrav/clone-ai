import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendCommunityInviteEmail(to: string, name: string): Promise<void> {
  const displayName = name?.split(' ')[0] || 'there'
  const sendAt = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour from now

  await resend.emails.send({
    from: 'IgualAI <hello@igualai.com>',
    to,
    subject: 'Join the IgualAI community',
    scheduledAt: sendAt,
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e5;">

          <!-- Header -->
          <tr>
            <td style="background:#0a0a0a;padding:32px;text-align:center;">
              <table cellpadding="0" cellspacing="0" style="display:inline-table;">
                <tr>
                  <td style="background:#171717;border-radius:10px;width:36px;height:36px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:18px;font-weight:bold;">⚡</span>
                  </td>
                  <td style="padding-left:10px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">IgualAI</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0a0a0a;letter-spacing:-0.5px;">Hey ${displayName}, join our community</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#525252;line-height:1.6;">
                Hope you're enjoying IgualAI! We have a free community on Whop where you can get support, share your work, and connect with other users.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="padding:8px 0;">
                    <span style="color:#0a0a0a;font-size:14px;">✦</span>
                    <span style="color:#404040;font-size:14px;padding-left:10px;">Get help from the team and other members</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;">
                    <span style="color:#0a0a0a;font-size:14px;">✦</span>
                    <span style="color:#404040;font-size:14px;padding-left:10px;">Share what you've built</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;">
                    <span style="color:#0a0a0a;font-size:14px;">✦</span>
                    <span style="color:#404040;font-size:14px;padding-left:10px;">Be first to hear about new features</span>
                  </td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#0a0a0a;border-radius:10px;">
                    <a href="https://whop.com/checkout/plan_RqjBsFXY6jcfP/?redirect_url=https%3A%2F%2Figualai.com%2Fdashboard" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:-0.2px;">
                      Join the Community — Free →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:13px;color:#a3a3a3;line-height:1.6;">
                Questions? Reply to this email or reach us at
                <a href="mailto:hello@igualai.com" style="color:#0a0a0a;text-decoration:none;">hello@igualai.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  })
}

export async function sendAgencyWelcomeEmail(to: string, name: string): Promise<void> {
  const displayName = name?.split(' ')[0] || 'there'

  await resend.emails.send({
    from: 'IgualAI <hello@igualai.com>',
    to,
    subject: 'Welcome to IgualAI Agency — your priority support is ready',
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e5;">

          <!-- Header -->
          <tr>
            <td style="background:#0a0a0a;padding:32px;text-align:center;">
              <table cellpadding="0" cellspacing="0" style="display:inline-table;">
                <tr>
                  <td style="background:#171717;border-radius:10px;width:36px;height:36px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:18px;font-weight:bold;">⚡</span>
                  </td>
                  <td style="padding-left:10px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">IgualAI</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0a0a0a;letter-spacing:-0.5px;">Welcome to Agency, ${displayName} 🎉</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#525252;line-height:1.6;">
                You're on our highest plan — 60 clones/month, 6M AI tokens, and direct access to our priority support channel.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="padding:8px 0;">
                    <span style="color:#0a0a0a;font-size:14px;">✦</span>
                    <span style="color:#404040;font-size:14px;padding-left:10px;">60 page clones per month</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;">
                    <span style="color:#0a0a0a;font-size:14px;">✦</span>
                    <span style="color:#404040;font-size:14px;padding-left:10px;">~85 full AI brand rebuilds per month</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;">
                    <span style="color:#0a0a0a;font-size:14px;">✦</span>
                    <span style="color:#404040;font-size:14px;padding-left:10px;">Priority support — direct access to the team</span>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 20px;font-size:15px;color:#525252;line-height:1.6;">
                Join our community to access your <strong style="color:#0a0a0a;">priority support channel</strong> — post any question and we'll get back to you fast.
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#0a0a0a;border-radius:10px;">
                    <a href="https://whop.com/igualai" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:-0.2px;">
                      Join Priority Support →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:13px;color:#a3a3a3;line-height:1.6;">
                You can also reply directly to this email and I'll get back to you personally.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:13px;color:#a3a3a3;line-height:1.6;">
                Questions? Reply to this email or reach us at
                <a href="mailto:hello@igualai.com" style="color:#0a0a0a;text-decoration:none;">hello@igualai.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  })
}

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const displayName = name?.split(' ')[0] || 'there'

  await resend.emails.send({
    from: 'IgualAI <hello@igualai.com>',
    to,
    subject: 'Welcome to IgualAI',
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e5;">

          <!-- Header -->
          <tr>
            <td style="background:#0a0a0a;padding:32px;text-align:center;">
              <table cellpadding="0" cellspacing="0" style="display:inline-table;">
                <tr>
                  <td style="background:#171717;border-radius:10px;width:36px;height:36px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:18px;font-weight:bold;">⚡</span>
                  </td>
                  <td style="padding-left:10px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">IgualAI</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0a0a0a;letter-spacing:-0.5px;">Welcome, ${displayName}!</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#525252;line-height:1.6;">
                You're in. IgualAI lets you clone any website and customize it with AI — in seconds.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="padding:8px 0;">
                    <span style="color:#0a0a0a;font-size:14px;">✦</span>
                    <span style="color:#404040;font-size:14px;padding-left:10px;">Paste any URL to clone a page instantly</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;">
                    <span style="color:#0a0a0a;font-size:14px;">✦</span>
                    <span style="color:#404040;font-size:14px;padding-left:10px;">Edit with AI chat — change colors, copy, layout</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;">
                    <span style="color:#0a0a0a;font-size:14px;">✦</span>
                    <span style="color:#404040;font-size:14px;padding-left:10px;">Download as ZIP or deploy to your domain</span>
                  </td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#0a0a0a;border-radius:10px;">
                    <a href="https://igualai.com/dashboard" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:-0.2px;">
                      Go to Dashboard →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:13px;color:#a3a3a3;line-height:1.6;">
                Questions? Reply to this email or reach us at
                <a href="mailto:hello@igualai.com" style="color:#0a0a0a;text-decoration:none;">hello@igualai.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  })
}

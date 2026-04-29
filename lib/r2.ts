import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

function getClient(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.CLOUDFLARE_R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
    },
  })
}

/**
 * Upload a buffer to Cloudflare R2 and return its public URL.
 * Throws if R2 env vars are not configured.
 */
export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const client = getClient()
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )
  const base = (process.env.CLOUDFLARE_R2_PUBLIC_URL ?? '').replace(/\/$/, '')
  return `${base}/${key}`
}

/** Returns true only when all required R2 env vars are present. */
export function isR2Configured(): boolean {
  return !!(
    process.env.CLOUDFLARE_R2_ENDPOINT &&
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY &&
    process.env.CLOUDFLARE_R2_BUCKET &&
    process.env.CLOUDFLARE_R2_PUBLIC_URL
  )
}

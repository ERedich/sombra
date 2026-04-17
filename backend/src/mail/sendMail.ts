import nodemailer from 'nodemailer'
import pino from 'pino'
import { env } from '../env.js'

const logger = pino({ level: env.NODE_ENV === 'production' ? 'info' : 'debug' })

let cachedTransport: nodemailer.Transporter | null = null

function getTransport(): nodemailer.Transporter | null {
  if (!env.MAIL_ENABLED) return null
  if (!env.SMTP_HOST?.trim()) {
    logger.warn('MAIL_ENABLED is true but SMTP_HOST is empty; mail disabled.')
    return null
  }
  if (cachedTransport) return cachedTransport
  cachedTransport = nodemailer.createTransport({
    host: env.SMTP_HOST.trim(),
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER?.trim() && env.SMTP_PASS !== undefined
        ? {
            user: env.SMTP_USER.trim(),
            pass: env.SMTP_PASS,
          }
        : undefined,
  })
  return cachedTransport
}

export type SendMailInput = {
  to: string[]
  subject: string
  text: string
}

/** True when a message was handed to the transporter (not skipped). */
export async function sendMail(input: SendMailInput): Promise<boolean> {
  const transport = getTransport()
  if (!transport) {
    logger.debug(
      { to: input.to, subject: input.subject },
      'mail skipped (MAIL_ENABLED off or SMTP not configured)',
    )
    return false
  }
  const from = env.MAIL_FROM.trim()
  if (!from) {
    logger.error('MAIL_FROM is required when MAIL_ENABLED is true.')
    return false
  }
  await transport.sendMail({
    from,
    to: input.to.join(', '),
    subject: input.subject,
    text: input.text,
  })
  return true
}

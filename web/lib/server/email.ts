import { insertEmailToken, deleteEmailTokens } from './gameDb';
import { hashToken, newToken } from './auth';
import { appUrl } from '../appUrl';

// Resend's REST API. Plain fetch, no npm dependency.
//
// Cloudflare Email Sending was the original choice (the domain already lives
// on Cloudflare), but it requires the $5/mo Workers Paid plan -- not worth it
// for a feature a handful of players will use a few times a year. Resend's
// free tier is permanent at 3,000/month (100/day), which is orders of
// magnitude more than this app will ever send.
//
// The whole provider dependency is the send() function below: swapping again
// means changing the endpoint, the auth header, and the body shape, and
// nothing else. The token/verify/reset logic never touches it.
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'noreply@bingbongblitz.com';
const FROM_NAME = 'Guesswhere';

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

/** Whether a mail transport is actually wired up. Every email feature checks
 * this and degrades to "unavailable" rather than throwing -- local dev has no
 * token and must keep working exactly as it did before accounts existed. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}


async function send(to: string, subject: string, html: string, text: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Resend takes `from` as a single RFC-5322 string, not an object.
        from: `${FROM_NAME} <${FROM_ADDRESS}>`,
        to: [to],
        subject,
        // Both html and text. Resend will auto-generate text from the HTML if
        // it's omitted, but a hand-written plain-text part reads better and
        // its presence measurably helps spam scoring.
        html,
        text,
      }),
    });
    if (!res.ok) {
      // Log the status only -- never the request body, which contains the
      // recipient's address. The status alone identifies a config problem
      // (401 bad key, 403 unverified domain, 422 malformed).
      console.warn(`email send failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('email send threw:', e);
    return false;
  }
}

function layout(heading: string, body: string, buttonLabel: string, url: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#18181b;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#e4e4e7">
  <div style="max-width:480px;margin:0 auto;background:#27272a;border-radius:12px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:22px;color:#fff">${heading}</h1>
    <p style="margin:0 0 24px;line-height:1.6;color:#a1a1aa">${body}</p>
    <a href="${url}" style="display:inline-block;background:#fff;color:#000;text-decoration:none;padding:12px 24px;border-radius:9999px;font-weight:600">${buttonLabel}</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a">
      If the button doesn't work, copy this link into your browser:<br>
      <span style="word-break:break-all">${url}</span>
    </p>
  </div>
</body></html>`;
}

/** Issues a fresh verification token and mails the link. Returns whether the
 * mail actually went out. */
export async function sendVerificationEmail(userId: string, email: string): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  const token = newToken();
  deleteEmailTokens(userId, 'verify');
  insertEmailToken({
    token_hash: hashToken(token),
    user_id: userId,
    kind: 'verify',
    email,
    expires_at: Date.now() + VERIFY_TTL_MS,
    used_at: null,
  });

  const url = `${appUrl()}/verify?token=${token}`;
  return send(
    email,
    'Verify your Guesswhere email',
    layout(
      'Verify your email',
      'Confirming this address is what lets you reset your Guesswhere password later. The link expires in 24 hours.',
      'Verify email',
      url
    ),
    `Verify your Guesswhere email address by opening this link (expires in 24 hours):\n\n${url}\n\nIf you didn't sign up for Guesswhere, you can ignore this message.`
  );
}

export async function sendPasswordResetEmail(userId: string, email: string): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  const token = newToken();
  // Requesting a new link invalidates any outstanding one.
  deleteEmailTokens(userId, 'reset');
  insertEmailToken({
    token_hash: hashToken(token),
    user_id: userId,
    kind: 'reset',
    email,
    expires_at: Date.now() + RESET_TTL_MS,
    used_at: null,
  });

  const url = `${appUrl()}/reset-password?token=${token}`;
  return send(
    email,
    'Reset your Guesswhere password',
    layout(
      'Reset your password',
      "Choose a new password using the link below. It expires in one hour, and using it signs you out everywhere else. If you didn't ask for this, nothing has changed and you can ignore this email.",
      'Reset password',
      url
    ),
    `Reset your Guesswhere password using this link (expires in one hour):\n\n${url}\n\nIf you didn't request this, nothing has changed and you can ignore this message.`
  );
}

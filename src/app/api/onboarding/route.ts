import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { onboardingGet, onboardingPost } from '@/lib/onboarding-api';

// Onboarding board (Clients > Onboarding). The actions are documented, and
// handled, in lib/onboarding-api.ts.

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  return onboardingGet(ctx);
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  // The address people use (not the internal one behind the proxy) — Stripe
  // sends the client back to it after the card is saved.
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const origin = host ? `${req.headers.get('x-forwarded-proto') ?? 'https'}://${host}` : new URL(req.url).origin;
  return onboardingPost(ctx, await req.json().catch(() => ({})) as Record<string, unknown>, origin);
}

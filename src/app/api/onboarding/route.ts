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
  return onboardingPost(ctx, await req.json().catch(() => ({})) as Record<string, unknown>);
}

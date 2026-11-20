import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { cardVaultGet, cardVaultPost } from '@/lib/card-vault';

// Card vault — a client's card, stored encrypted. What it does, and the rules
// it keeps, are in lib/card-vault.ts. Reached with Onboarding access; reading a
// card back takes an admin and their password.

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const params = new URL(req.url).searchParams;
  return cardVaultGet(ctx, params.get('client_id'), params.get('past_id'));
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  return cardVaultPost(ctx, await req.json().catch(() => ({})) as Record<string, unknown>);
}

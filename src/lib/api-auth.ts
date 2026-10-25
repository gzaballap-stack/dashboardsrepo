import { createAuthClient, createServiceClient } from './supabase';
import { NextResponse } from 'next/server';

export type AuthContext = {
  userId: string;
  service: ReturnType<typeof createServiceClient>;
};

export async function getAuthContext(): Promise<AuthContext | NextResponse> {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return {
    userId: user.id,
    service: createServiceClient(),
  };
}

export function isAuthError(val: unknown): val is NextResponse {
  return val instanceof NextResponse;
}

// Validates a webhook request against the shared secret
export function validateWebhookSecret(req: Request): boolean {
  const secret = process.env.ADMIN_WEBHOOK_SECRET;
  if (!secret) return false;
  // Senders vary: Make writes "Bearer <secret>", GHL's webhook action may pad
  // the value or change the case of "Bearer", and some tools send the bare
  // secret. Compare the secret itself, not the decoration around it.
  const raw = (req.headers.get('authorization') ?? '').trim();
  const token = raw.replace(/^bearer\s+/i, '').trim();
  return token.length > 0 && token === secret;
}

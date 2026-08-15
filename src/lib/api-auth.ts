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
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.ADMIN_WEBHOOK_SECRET;
}

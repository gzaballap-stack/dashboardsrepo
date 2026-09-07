import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { sanitizeViews } from '@/lib/feature-access';

// Who is signed in and what they are allowed to see. Drives which sections the
// dashboard shell renders.
export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data } = await ctx.service
    .from('profiles')
    .select('is_admin, allowed_views')
    .eq('id', ctx.userId)
    .maybeSingle();

  const isAdmin = data?.is_admin === true;

  return NextResponse.json({
    id: ctx.userId,
    is_admin: isAdmin,
    // Admins are never restricted.
    allowed_views: isAdmin ? null : sanitizeViews(data?.allowed_views),
  });
}

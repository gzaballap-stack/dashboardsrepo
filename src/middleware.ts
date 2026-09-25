import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { canReachPath } from '@/lib/feature-access';

// Routes that handle their own auth (API key or admin secret) or are public
const BYPASS_ROUTES = [
  '/api/webhooks',
  '/api/ad-spend',
  '/api/b2b-ad-spend',
  '/api/b2b-metrics',
  '/api/b2b-adsets',
  '/api/b2b-ads',
  '/api/admin/onboard',
  '/api/admin/seed-v2',
  '/api/admin/backfill-closes',
  '/api/admin/seed-zip-performance',
  '/api/admin/seed-sessions',
  '/api/admin/backfill-history',
  '/api/admin/backfill-campaigns',
  '/api/admin/run-schema',
  '/api/admin/run-b2b-migration',
  '/api/admin/seed-b2b-events',
  '/api/admin/backfill-ghl-attribution',
  '/api/admin/backfill-zips',
  '/api/admin/seed-client-sessions',
  '/api/admin/rename-sessions',
  '/api/cron/seed-daily',
  // Read-only lifting-log export — the share token in the query string is the
  // credential, so it must be reachable without a session.
  '/api/lift-log/export',
  '/api/auth/clear',
  '/api/setup',
  '/api/users',
  '/setup',
  '/login',
  '/auth',
  '/report',
  // The home-screen app manifest: public metadata only, and the browser fetches
  // it before sign-in, so it must not redirect to /login.
  '/manifest.webmanifest',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (BYPASS_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Corrupted session cookie — send to /api/auth/clear which returns a 200 with
    // Set-Cookie expiry headers (Railway CDN strips Set-Cookie from 3xx redirects).
    return NextResponse.redirect(new URL('/api/auth/clear', request.url));
  }

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Per-user feature access. `allowed_views` is mirrored onto the auth user
  // whenever an admin edits it, so this costs no extra query. Absent means
  // unrestricted — which is every account that predates the feature.
  const meta = user.app_metadata as { is_admin?: boolean; allowed_views?: string[] } | undefined;
  const allowed = meta?.is_admin === true ? null : meta?.allowed_views;
  if (Array.isArray(allowed) && !canReachPath(pathname, allowed)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return supabaseResponse;
}

export const config = {
  // Static assets must bypass auth — .png was not excluded, so image
  // requests were being redirected to /login and never rendered.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)).*)'],
};

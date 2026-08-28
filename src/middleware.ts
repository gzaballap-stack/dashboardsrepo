import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
  '/api/admin/run-schema',
  '/api/admin/run-b2b-migration',
  '/api/admin/seed-b2b-events',
  '/api/cron/seed-daily',
  '/api/auth/clear',
  '/api/setup',
  '/api/users',
  '/setup',
  '/login',
  '/auth',
  '/report',
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

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.svg).*)'],
};

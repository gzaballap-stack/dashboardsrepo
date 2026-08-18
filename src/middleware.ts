import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that handle their own auth (API key or admin secret) or are public
const BYPASS_ROUTES = [
  '/api/webhooks',
  '/api/ad-spend',
  '/api/admin/onboard',
  '/api/admin/seed-v2',
  '/api/admin/backfill-closes',
  '/api/admin/seed-zip-performance',
  '/api/admin/seed-sessions',
  '/api/admin/backfill-history',
  '/api/admin/run-schema',
  '/api/cron/seed-daily',
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
    // Corrupted or invalid session cookie — clear sb-* cookies and redirect to login
    const loginResponse = NextResponse.redirect(new URL('/login', request.url));
    request.cookies.getAll()
      .filter(c => c.name.startsWith('sb-'))
      .forEach(c => loginResponse.cookies.delete(c.name));
    return loginResponse;
  }

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)'],
};

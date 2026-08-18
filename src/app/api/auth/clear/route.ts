import { NextRequest } from "next/server";

// Clears all Supabase auth cookies and redirects to /login.
// Returns a 200 HTML response (not a 3xx redirect) so that Set-Cookie headers
// reach the browser — Railway's Hikari CDN strips Set-Cookie from redirect responses.
export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sbCookieNames = cookieHeader
    .split(";")
    .map((c) => c.trim().split("=")[0].trim())
    .filter((name) => name.startsWith("sb-"));

  const setCookieHeaders = sbCookieNames.map(
    (name) => `${name}=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly`
  );

  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  setCookieHeaders.forEach((v) => headers.append("Set-Cookie", v));

  return new Response(
    `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=/login"></head>
     <body><script>location.replace('/login');</script></body></html>`,
    { status: 200, headers }
  );
}

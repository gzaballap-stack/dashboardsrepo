import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { getUsdEurRate } from '@/lib/fx';

// Today's USD→EUR rate, so the sheet can preview a euro figure in dollars.
export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const rate = await getUsdEurRate();
  return NextResponse.json({ rate, date: new Date().toISOString().slice(0, 10) });
}

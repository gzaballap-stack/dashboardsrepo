// Google Docs work the Make scenarios used to do (copy the territory template,
// fill the sales-call numbers). The app has no Google credentials of its own:
// it calls a small Apps Script web app that runs as the Google account owning
// the docs (`scripts/google-docs-bridge.gs`, deployed as "Execute as: Me").
// Env: GOOGLE_DOCS_SCRIPT_URL (the /exec URL); the script checks DIRECT_WEBHOOK_TOKEN.

type BridgeResult = { ok: true; id?: string; replaced?: number } | { ok: false; error: string };

async function call(body: Record<string, unknown>): Promise<BridgeResult> {
  const url = process.env.GOOGLE_DOCS_SCRIPT_URL;
  if (!url) return { ok: false, error: 'GOOGLE_DOCS_SCRIPT_URL is not set' };
  try {
    // Apps Script answers POSTs with a 302 to the result; fetch follows it.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ ...body, token: process.env.DIRECT_WEBHOOK_TOKEN }),
    });
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, error: `Docs script answered ${res.status}` };
    return json.ok ? json : { ok: false, error: json.error ?? 'Docs script failed' };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Copy a template doc and replace each {{key}} in it. Returns the new doc id. */
export const createFromTemplate = (templateId: string, name: string, values: Record<string, string>) =>
  call({ action: 'create_from_template', templateId, name, values });

/** Replace literal text in an existing doc. */
export const replaceText = (docId: string, replacements: { find: string; replace: string }[]) =>
  call({ action: 'replace_text', docId, replacements });

// Minimal Slack Web API client — posts a message and attaches files to a channel.
// Needs a bot token with chat:write + files:write, invited to the channel.

const API = 'https://slack.com/api';

type SlackResp = { ok: boolean; error?: string; ts?: string };

async function call<T extends SlackResp>(method: string, token: string, body: Record<string, unknown> | URLSearchParams): Promise<T> {
  const isForm = body instanceof URLSearchParams;
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8',
    },
    body: isForm ? body : JSON.stringify(body),
  });
  const json = await res.json() as T;
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error ?? 'unknown error'}`);
  return json;
}

export async function postMessage(token: string, channel: string, text: string): Promise<string | undefined> {
  const r = await call<SlackResp>('chat.postMessage', token, { channel, text, unfurl_links: false });
  return r.ts;
}

export type SlackFile = { filename: string; title: string; content: string };

// files.upload v2 flow: reserve URL → upload bytes → complete (attaches to channel, optionally in a thread).
export async function uploadFiles(token: string, channel: string, files: SlackFile[], threadTs?: string): Promise<void> {
  const uploaded: { id: string; title: string }[] = [];
  for (const f of files) {
    const bytes = new TextEncoder().encode(f.content);
    const reserve = await call<SlackResp & { upload_url: string; file_id: string }>(
      'files.getUploadURLExternal', token,
      new URLSearchParams({ filename: f.filename, length: String(bytes.byteLength) }),
    );
    const put = await fetch(reserve.upload_url, { method: 'POST', body: bytes });
    if (!put.ok) throw new Error(`Slack upload of ${f.filename} failed: HTTP ${put.status}`);
    uploaded.push({ id: reserve.file_id, title: f.title });
  }
  await call<SlackResp>('files.completeUploadExternal', token, {
    files: uploaded,
    channel_id: channel,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
}

// Fallback for an incoming-webhook URL: text only, no attachments.
export async function postWebhook(url: string, text: string): Promise<void> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`Slack webhook: HTTP ${res.status}`);
}

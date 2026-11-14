// How a name someone typed (a client, an expense) is shown on screen:
// each word capitalised — "dave" → "Dave", "rio rent for august" →
// "Rio Rent for August". Only words typed entirely in lowercase change, so
// "AEGIS (Matt)", "iFood" and "McDonald" stay exactly as written. Display
// only: what is stored is never rewritten by this.

const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'per', 'to', 'via', 'vs']);
// Short forms people type in lowercase that read as capitals.
const ACRONYMS: Record<string, string> = {
  llc: 'LLC', ghl: 'GHL', sms: 'SMS', fb: 'FB', ai: 'AI', usa: 'USA', hvac: 'HVAC',
  mma: 'MMA', bjj: 'BJJ', tkd: 'TKD', vsl: 'VSL', va: 'VA', ppa: 'PPA', crm: 'CRM',
};

export function displayName(name: string | null | undefined): string {
  if (!name) return name ?? '';
  const parts = name.split(/(\s+)/);
  let seen = false;
  return parts.map((p, i) => {
    if (!/\S/.test(p)) return p;
    const first = !seen;
    seen = true;
    const last = !parts.slice(i + 1).some(q => /\S/.test(q));
    const m = p.match(/^([^A-Za-z0-9]*)([a-z][a-z'’]*)((?:[-][a-z][a-z'’]*)*)([^A-Za-z]*)$/);
    if (!m) return p;
    const [, lead, word, hyph, tail] = m;
    if (/['’]$/.test(lead)) return p;
    if (ACRONYMS[word] && !hyph) return lead + ACRONYMS[word] + tail;
    if (!first && !last && !hyph && SMALL.has(word)) return p;
    // O'Brien, D'Angelo
    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).replace(/^(['’])([a-z])/, (_, a, c) => a + c.toUpperCase());
    return lead + cap(word) + hyph.replace(/-([a-z])/g, (_, c) => '-' + c.toUpperCase()) + tail;
  }).join('');
}

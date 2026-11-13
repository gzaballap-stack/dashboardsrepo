// What a funnel version says and shows.
//
// A funnel is two pages (the landing page and the "you're booked" page), each a
// list of sections in order, plus the wording of the form. The website renders
// exactly this; the dashboard edits it. The same file lives in both projects
// (dashboard: src/lib/funnel-content.ts, website: src/lib/funnel-content.ts) —
// keep them identical.
//
// Text can mark words with *asterisks*: the page shows them in its highlight
// style (green on the headline, blue or bold elsewhere).

export type FunnelVideo = { id: string; title: string; headline: string };

export type SectionType =
  | "logo" | "badge" | "headline" | "subline" | "form" | "testimonials" | "button" | "footer" | "text"
  | "booked_heading" | "video" | "steps" | "pill" | "link";

export type FunnelSection = {
  id: string;
  type: SectionType;
  text?: string;
  lines?: string[];
  heading?: string;
  sub?: string;
  videos?: FunnelVideo[];
  layout?: "grid" | "stack";
  youtube?: string;
  title?: string;
  items?: string[];
  url?: string;
};

export type FunnelForm = {
  heading: string;
  sub: string;
  q1: string;
  q2: string;
  q2Sub: string;
  /** Revenue answers that end the form, the same way "No" does on the first question. */
  disqualify: string[];
  q3: string;
  q3Sub: string;
  q4: string;
  q4Sub: string;
  q5: string;
  q5Sub: string;
  rejected: string;
};

export type FunnelContent = {
  landing: FunnelSection[];
  form: FunnelForm;
  booked: FunnelSection[];
};

/** The revenue answers. Fixed: they are the options of the GoHighLevel field the answer is saved in. */
export const REVENUE_OPTIONS = ["$0 - $500k", "$500k - $750k", "$750k - $1m", "$1m - $5m", "$5m+"];

const VIDEOS: FunnelVideo[] = [
  { id: "_CYwGn2lQ7E", title: "Robert, Luxury Renovations: $250k in 5 months", headline: "$250k in contracted work in 5 months for Robert, Luxury Renovations" },
  { id: "HiNp02PFrjE", title: "Edin: a $20k kitchen job closed 4 days in", headline: "Edin closed a $20k kitchen job 4 days in" },
  { id: "fR0ENIDFsBc", title: "Tulio, Mr. Handy Plus Services: quality jobs on his terms", headline: "Tulio went from chasing leads to quality jobs on his terms, Mr. Handy Plus Services, Houston" },
  { id: "pSe8oQipbxs", title: "Brian: from maybe breaking even to fully booked", headline: "Brian went from “maybe breaking even” to fully booked" },
];

/** The funnel as it was first built. Version 1 starts from this. */
export const DEFAULT_CONTENT: FunnelContent = {
  landing: [
    { id: "logo", type: "logo" },
    { id: "badge", type: "badge", text: "For kitchen & bathroom remodelers over $500k/year" },
    {
      id: "headline", type: "headline",
      lines: ["Tired of *shared leads?*", "Get exclusive in-person appointments with qualified homeowners, on a *pay-per-sit* basis."],
    },
    { id: "subline", type: "subline", text: "If you don’t meet with a homeowner we both agree is qualified, *you don’t pay.*" },
    { id: "form", type: "form" },
    {
      id: "testimonials", type: "testimonials",
      heading: "What Our Clients *Say*", sub: "Real Kitchen & Bath Remodelers. Real results.", layout: "grid", videos: VIDEOS,
    },
    { id: "button", type: "button", text: "Check Your Market →" },
    { id: "footer", type: "footer" },
  ],
  form: {
    heading: "See If Your Market Is *Available*",
    sub: "We only work with 1 kitchen & bath remodeler per market — answer a few quick questions.",
    q1: "Are you a kitchen and bathroom remodeler looking for more qualified in-person appointments?",
    q2: "What's your current yearly revenue?",
    q2Sub: "Helps us see if we're the right fit.",
    disqualify: ["$0 - $500k"],
    q3: "What is the name of your company?",
    q3Sub: "We'll use this to confirm your market and book your call.",
    q4: "Your contact details",
    q4Sub: "We'll use this to confirm your market and book your call.",
    q5: "Pick a time that *works for you*",
    q5Sub: "Choose a slot below to lock in your strategy call.",
    rejected:
      "This program is exclusively for kitchen and bathroom remodelers doing over $500k a year who want more qualified in-person appointments. If that ever changes, we’d love to hear from you.",
  },
  booked: [
    {
      id: "booked_heading", type: "booked_heading",
      heading: "You're Booked. *Here's What Happens Next.*",
      sub: "Your strategy call is booked. Watch this to see exactly how our system works and what we'll cover.",
    },
    { id: "video", type: "video", youtube: "IfN9KalnDNo", title: "What happens on your call" },
    {
      id: "steps", type: "steps", heading: "Your Next Steps:",
      items: [
        "Be available for your call at the scheduled time. The details are in your booking confirmation.",
        "Be in a quiet spot, with a rough idea of your numbers, so we can focus on your business.",
        "Watch the video above to see what to expect on your call.",
      ],
    },
    { id: "pill", type: "pill", text: "★ Trusted by kitchen & bath remodelers" },
    { id: "testimonials", type: "testimonials", heading: "", sub: "", layout: "stack", videos: VIDEOS },
    { id: "link", type: "link", text: "Watch on YouTube", url: "https://www.youtube.com/@GonzaloZaballa" },
  ],
};

/** What each kind of section is called and which parts of it can be edited. */
export type FieldKind = "text" | "long" | "lines" | "videos" | "layout";
export const SECTION_INFO: Record<SectionType, { label: string; pages: ("landing" | "booked")[]; fields: { key: keyof FunnelSection; label: string; kind: FieldKind }[] }> = {
  logo:           { label: "Logo",                 pages: ["landing", "booked"], fields: [] },
  badge:          { label: "Badge",                pages: ["landing"],           fields: [{ key: "text", label: "Text", kind: "text" }] },
  headline:       { label: "Headline",             pages: ["landing"],           fields: [{ key: "lines", label: "Lines (one per row, *highlight*)", kind: "lines" }] },
  subline:        { label: "Line under the headline", pages: ["landing"],        fields: [{ key: "text", label: "Text (*bold*)", kind: "long" }] },
  form:           { label: "The form",             pages: ["landing"],           fields: [] },
  testimonials:   { label: "Client videos",        pages: ["landing", "booked"], fields: [
    { key: "heading", label: "Heading (*highlight*)", kind: "text" }, { key: "sub", label: "Line under it", kind: "text" },
    { key: "layout", label: "Layout", kind: "layout" }, { key: "videos", label: "Videos", kind: "videos" },
  ] },
  button:         { label: "Button to the form",   pages: ["landing"],           fields: [{ key: "text", label: "Text", kind: "text" }] },
  footer:         { label: "Footer",               pages: ["landing", "booked"], fields: [] },
  text:           { label: "Text",                 pages: ["landing", "booked"], fields: [{ key: "heading", label: "Heading", kind: "text" }, { key: "text", label: "Text", kind: "long" }] },
  booked_heading: { label: "Heading",              pages: ["booked"],            fields: [{ key: "heading", label: "Heading (*highlight*)", kind: "text" }, { key: "sub", label: "Line under it", kind: "long" }] },
  video:          { label: "Main video",           pages: ["booked"],            fields: [{ key: "youtube", label: "YouTube link or id", kind: "text" }, { key: "title", label: "Title", kind: "text" }] },
  steps:          { label: "Numbered steps",       pages: ["booked"],            fields: [{ key: "heading", label: "Heading", kind: "text" }, { key: "items", label: "Steps (one per row)", kind: "lines" }] },
  pill:           { label: "Small label",          pages: ["booked"],            fields: [{ key: "text", label: "Text", kind: "text" }] },
  link:           { label: "Link button",          pages: ["booked"],            fields: [{ key: "text", label: "Text", kind: "text" }, { key: "url", label: "Link", kind: "text" }] },
};

export const FORM_FIELDS: { key: Exclude<keyof FunnelForm, "disqualify">; label: string; kind: "text" | "long" }[] = [
  { key: "heading", label: "Heading above the form (*highlight*)", kind: "text" },
  { key: "sub", label: "Line under it", kind: "long" },
  { key: "q1", label: "Question 1 (Yes / No)", kind: "long" },
  { key: "q2", label: "Question 2 (revenue)", kind: "text" },
  { key: "q2Sub", label: "Question 2, small line", kind: "text" },
  { key: "q3", label: "Question 3 (company)", kind: "text" },
  { key: "q3Sub", label: "Question 3, small line", kind: "text" },
  { key: "q4", label: "Question 4 (contact details)", kind: "text" },
  { key: "q4Sub", label: "Question 4, small line", kind: "text" },
  { key: "q5", label: "Calendar heading (*highlight*)", kind: "text" },
  { key: "q5Sub", label: "Calendar, small line", kind: "text" },
  { key: "rejected", label: "Message when they don't qualify", kind: "long" },
];

const str = (v: unknown, max = 600): string => (typeof v === "string" ? v.slice(0, max) : "");
const strs = (v: unknown, max = 600, count = 12): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, max)).slice(0, count) : [];

/** The video id out of a YouTube link (or the id itself). */
export function youtubeId(v: string): string {
  const s = v.trim();
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{6,20})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{6,20}$/.test(s) ? s : "";
}

function section(raw: unknown, i: number, page: "landing" | "booked"): FunnelSection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as SectionType;
  const info = SECTION_INFO[type];
  if (!info || !info.pages.includes(page)) return null;
  const out: FunnelSection = { id: str(r.id, 40) || `${type}-${i}`, type };
  for (const f of info.fields) {
    if (f.kind === "lines") out[f.key as "lines" | "items"] = strs(r[f.key]).filter((x) => x.trim());
    else if (f.kind === "layout") out.layout = r.layout === "stack" ? "stack" : "grid";
    else if (f.kind === "videos") {
      out.videos = (Array.isArray(r.videos) ? r.videos : [])
        .map((v) => {
          const o = (v ?? {}) as Record<string, unknown>;
          return { id: youtubeId(str(o.id, 200)), title: str(o.title, 200), headline: str(o.headline, 300) };
        })
        .filter((v) => v.id)
        .slice(0, 12);
    } else if (f.key === "youtube") out.youtube = youtubeId(str(r.youtube, 200));
    else out[f.key as "text" | "heading" | "sub" | "title" | "url"] = str(r[f.key], f.kind === "long" ? 1200 : 300);
  }
  return out;
}

function sections(raw: unknown, page: "landing" | "booked"): FunnelSection[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : [])
    .map((s, i) => section(s, i, page))
    .filter((s): s is FunnelSection => !!s)
    .slice(0, 30)
    .map((s) => {
      let id = s.id;
      while (seen.has(id)) id = `${id}-x`;
      seen.add(id);
      return { ...s, id };
    });
}

/**
 * Cleans content before it is saved or shown: unknown sections and fields are
 * dropped, text is kept to a sane length, and the landing page always has the
 * form exactly once. Anything unusable falls back to the original funnel.
 */
export function normalizeContent(raw: unknown): FunnelContent {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let landing = sections(r.landing, "landing");
  if (!landing.length) landing = DEFAULT_CONTENT.landing;
  let formSeen = false;
  landing = landing.filter((s) => (s.type !== "form" ? true : formSeen ? false : (formSeen = true)));
  if (!formSeen) landing = [...landing, { id: "form", type: "form" }];
  let booked = sections(r.booked, "booked");
  if (!booked.length) booked = DEFAULT_CONTENT.booked;

  const f = (r.form && typeof r.form === "object" ? r.form : {}) as Record<string, unknown>;
  const form = { ...DEFAULT_CONTENT.form };
  for (const field of FORM_FIELDS) {
    const v = str(f[field.key], 1200);
    if (v.trim()) form[field.key] = v;
  }
  if (Array.isArray(f.disqualify)) form.disqualify = strs(f.disqualify).filter((o) => REVENUE_OPTIONS.includes(o));
  // Every answer ending the form would leave nobody able to book.
  if (form.disqualify.length >= REVENUE_OPTIONS.length) form.disqualify = DEFAULT_CONTENT.form.disqualify;
  return { landing, form, booked };
}

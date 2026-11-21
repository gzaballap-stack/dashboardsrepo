import PublicSurvey from "@/components/PublicSurvey";

// The client's New Client Survey link. Public on purpose: the token is the key
// (lib/survey-links.ts). Kept out of search engines.

export const metadata = { title: "Welcome to Tomsi Media", robots: { index: false, follow: false } };

export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicSurvey token={token} />;
}

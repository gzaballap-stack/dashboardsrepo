// Where Stripe sends someone after its "put a card on file" page (the link the
// Onboarding board hands out). Public on purpose — the client may be the one
// who opened the link — and it says nothing about anyone.

export const metadata = { title: "All set" };

export default function CardSaved() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: "#fafafa" }}>
      <div className="w-full rounded-2xl p-8 text-center" style={{ maxWidth: 420, background: "#ffffff", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <h1 className="text-xl font-semibold" style={{ color: "#111111" }}>You&rsquo;re all set</h1>
        <p className="text-sm mt-2" style={{ color: "#767676" }}>
          If you saved a card, it is now securely on file with Stripe. You can close this page.
        </p>
      </div>
    </main>
  );
}

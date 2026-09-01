"use client";

/**
 * Fixed, non-interactive page backdrop: a bagua ring, a taijitu and a few
 * flowing brush curves echoing the Tomsi brand sheet.
 *
 * Deliberately near-invisible (2–5% black). It should register as texture on a
 * white page, never compete with data. Rendered behind everything and inert to
 * pointer events.
 */

// The eight trigrams, each three lines read top to bottom.
// true = solid (yang), false = broken (yin).
const TRIGRAMS: boolean[][] = [
  [true, true, true],    // ☰ qian
  [true, true, false],   // ☱ dui
  [true, false, true],   // ☲ li
  [true, false, false],  // ☳ zhen
  [false, true, true],   // ☴ xun
  [false, true, false],  // ☵ kan
  [false, false, true],  // ☶ gen
  [false, false, false], // ☷ kun
];

function Bagua({ size = 620, stroke = "#000" }: { size?: number; stroke?: string }) {
  const c = size / 2;
  const rOuter = size * 0.46;
  const barW = size * 0.115;
  const barH = size * 0.016;
  const gap = size * 0.026;
  const gapCentre = barW * 0.16;

  return (
    <g>
      <circle cx={c} cy={c} r={rOuter * 0.995} fill="none" stroke={stroke} strokeWidth={1} opacity={0.5} />
      <circle cx={c} cy={c} r={rOuter * 0.66} fill="none" stroke={stroke} strokeWidth={1} opacity={0.35} />

      {TRIGRAMS.map((lines, i) => {
        const angle = (i * 360) / TRIGRAMS.length;
        const ry = rOuter * 0.83;
        return (
          <g key={i} transform={`rotate(${angle} ${c} ${c})`}>
            {lines.map((solid, li) => {
              const y = c - ry + li * gap;
              if (solid) {
                return <rect key={li} x={c - barW / 2} y={y} width={barW} height={barH} fill={stroke} />;
              }
              const half = (barW - gapCentre * 2) / 2;
              return (
                <g key={li}>
                  <rect x={c - barW / 2} y={y} width={half} height={barH} fill={stroke} />
                  <rect x={c + gapCentre} y={y} width={half} height={barH} fill={stroke} />
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Taijitu — the S-curve is two half-circles meeting at the centre. */}
      <g transform={`translate(${c} ${c})`}>
        {(() => {
          const r = rOuter * 0.3;
          return (
            <>
              <circle r={r} fill="none" stroke={stroke} strokeWidth={1} opacity={0.5} />
              <path
                d={`M 0 ${-r} A ${r / 2} ${r / 2} 0 0 1 0 0 A ${r / 2} ${r / 2} 0 0 0 0 ${r} A ${r} ${r} 0 0 1 0 ${-r} Z`}
                fill={stroke}
                opacity={0.5}
              />
              <circle cx={0} cy={-r / 2} r={r * 0.13} fill="#fff" />
              <circle cx={0} cy={r / 2} r={r * 0.13} fill={stroke} opacity={0.5} />
            </>
          );
        })()}
      </g>
    </g>
  );
}

export default function DaoBackground() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* Flowing brush curves, echoing the brand sheet. */}
      <svg
        width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, opacity: 0.045 }}
      >
        <g fill="none" stroke="#000" strokeWidth={1.25}>
          <path d="M -100 760 C 260 620, 420 880, 780 700 S 1300 420, 1750 560" />
          <path d="M -100 820 C 300 690, 460 940, 820 760 S 1340 480, 1750 620" />
          <path d="M -100 120 C 320 40, 560 260, 900 150 S 1400 -40, 1750 90" />
        </g>
      </svg>

      {/* Bagua, anchored bottom-right and bled off the edge. */}
      <svg
        width={620} height={620} viewBox="0 0 620 620"
        style={{ position: "absolute", right: "-9%", bottom: "-14%", opacity: 0.035 }}
      >
        <Bagua size={620} />
      </svg>
    </div>
  );
}

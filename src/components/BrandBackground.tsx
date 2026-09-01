"use client";

/**
 * Page backdrop: the soft sweeping curves from the Tomsi brand sheet over a
 * warm paper tone, with a fine grain so the surface reads as stock rather than
 * a flat screen.
 *
 * Fixed, inert, and very low contrast — texture, never decoration.
 */
export default function BrandBackground() {
  return (
    <div
      aria-hidden
      style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}
    >
      {/* Warm paper base */}
      <div style={{ position: "absolute", inset: 0, background: "#f6f5f3" }} />

      {/* Sweeping brand curves — wide, soft, mostly off-canvas, as on the sheet. */}
      <svg
        width="100%" height="100%" viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="55%"  stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="sweepSoft" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Broad light masses, like the folds on the banner */}
        <path d="M -200 900 C 250 640, 520 880, 900 640 S 1450 220, 1900 380 L 1900 900 Z" fill="url(#sweep)" />
        <path d="M -200 0 C 300 -60, 620 240, 1000 120 S 1560 -80, 1900 40 L 1900 -100 L -200 -100 Z" fill="url(#sweepSoft)" />
        <path d="M -200 720 C 300 560, 640 820, 1020 600 S 1520 300, 1900 460 L 1900 900 L -200 900 Z" fill="#ffffff" opacity="0.55" />

        {/* Hairline creases catching the light */}
        <g fill="none" stroke="#000" strokeOpacity="0.045" strokeWidth="1">
          <path d="M -100 742 C 300 586, 640 842, 1020 622 S 1520 322, 1900 482" />
          <path d="M -100 806 C 320 664, 660 904, 1040 690 S 1540 396, 1900 552" />
          <path d="M -100 96 C 320 22, 620 268, 1000 148 S 1520 -44, 1900 74" />
        </g>
      </svg>

      {/* Paper grain */}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.32, mixBlendMode: "multiply" }}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.09" />
          </feComponentTransfer>
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </div>
  );
}

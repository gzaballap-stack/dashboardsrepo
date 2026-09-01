"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { fmt$ } from "@/lib/zip-score";

export type Pin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  radius: number;
  zips: string[];
  features: object[];
  loading: boolean;
  color: string;
  type: "include" | "exclude";
  scores?: Record<string, { score: number; grade: "A" | "B" | "C" | "D" }>;
};

export type ZipPerfCircle = {
  score: number;
  leads: number;
  appointments: number;
  shows: number;
  closes: number;
  revenue: number;
};

type Props = {
  pins: Pin[];
  selectedPinId: string | null;
  onMapClick: (lat: number, lng: number) => void;
  onSelectPin: (id: string | null) => void;
  onDeletePin: (id: string) => void;
  onZipClick?: (zip: string) => void;
  focusZip?: string | null;
  manualExcludes?: Set<string>;
  pinMode?: "include" | "exclude";
  onExcludeToggle?: (zip: string) => void;
  // zip -> composite performance score/metrics for the connected client; drives choropleth fill.
  perfCircles?: Record<string, ZipPerfCircle>;
  flyTrigger?: number;
};

const GRADE_COLORS: Record<string, string> = {
  A: "#111111", B: "#000000", C: "#000000", D: "#c0392b",
};

// Choropleth: maps a 0–100 relative perf score (min-max across the client's territory)
// to a fill color. Blue (cold/low) → green (mid) → amber (hot/high).
function perfScoreToFill(score: number): { color: string; opacity: number } {
  const t = Math.max(0, Math.min(100, score)) / 100;
  let r: number, g: number, b: number;
  if (t < 0.5) {
    // #000000 (blue) → #000000 (green)
    const u = t * 2;
    r = Math.round(29  + u * (34  - 29));
    g = Math.round(78  + u * (197 - 78));
    b = Math.round(216 + u * (94  - 216));
  } else {
    // #000000 (green) → #000000 (amber)
    const u = (t - 0.5) * 2;
    r = Math.round(34  + u * (217 - 34));
    g = Math.round(197 + u * (119 - 197));
    b = Math.round(94  + u * (6   - 94));
  }
  return { color: `rgb(${r},${g},${b})`, opacity: 0.35 + t * 0.35 };
}

export default function ZipMap({
  pins, selectedPinId, onMapClick, onSelectPin, onDeletePin,
  onZipClick, focusZip,
  manualExcludes, pinMode = "include", onExcludeToggle,
  perfCircles, flyTrigger,
}: Props) {
  // Refs to avoid stale closures in persistent Leaflet event listeners
  const onZipClickRef      = useRef(onZipClick);
  const onMapClickRef      = useRef(onMapClick);
  const onExcludeToggleRef = useRef(onExcludeToggle);
  const pinModeRef         = useRef(pinMode);
  const focusZipRef        = useRef(focusZip);
  const manualExcludesRef  = useRef(manualExcludes);

  useEffect(() => { onZipClickRef.current      = onZipClick; },      [onZipClick]);
  useEffect(() => { onMapClickRef.current      = onMapClick; },      [onMapClick]);
  useEffect(() => { onExcludeToggleRef.current = onExcludeToggle; }, [onExcludeToggle]);
  useEffect(() => { pinModeRef.current         = pinMode; },         [pinMode]);
  useEffect(() => { focusZipRef.current        = focusZip; },        [focusZip]);
  useEffect(() => { manualExcludesRef.current  = manualExcludes; },  [manualExcludes]);

  const containerRef       = useRef<HTMLDivElement>(null);
  const mapRef             = useRef<any>(null);
  const pinLayersRef       = useRef<Map<string, any[]>>(new Map());
  const zipBoundsRef       = useRef<Map<string, any>>(new Map());
  const prevPinsRef        = useRef<Pin[] | null>(null);
  const prevSelectedPinRef = useRef<string | null>(null);
  const flewToFocusZipRef  = useRef<string | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    import("leaflet").then((L) => {
      const map = L.map(containerRef.current!, { zoomControl: true, center: [39, -98], zoom: 4 });
      const cartoKey = process.env.NEXT_PUBLIC_CARTO_API_KEY;
      const tileUrl = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${cartoKey ? `?key=${cartoKey}` : ""}`;
      L.tileLayer(tileUrl, {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);

      map.on("click", (e: any) => {
        // Drop a pin only in include mode; exclude mode uses polygon clicks only
        if (pinModeRef.current === "include") {
          onMapClickRef.current(e.latlng.lat, e.latlng.lng);
        }
      });

      mapRef.current = map;
    });
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      pinLayersRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync pin layers whenever pins, selection, or excludes change
  useEffect(() => {
    if (!mapRef.current) return;
    import("leaflet").then((L) => {
      const map      = mapRef.current;
      const existing = pinLayersRef.current;
      const currentIds = new Set(pins.map(p => p.id));

      // Track transitions for auto-fly
      const didSelectionChange = selectedPinId !== prevSelectedPinRef.current;
      if (didSelectionChange) prevSelectedPinRef.current = selectedPinId;

      // Remove deleted pins
      for (const [id, layers] of existing) {
        if (!currentIds.has(id)) {
          layers.forEach(l => map.removeLayer(l));
          existing.delete(id);
        }
      }

      for (const pin of pins) {
        const prevPin = prevPinsRef.current?.find(p => p.id === pin.id);
        const justFinishedLoading = prevPin?.loading === true && pin.loading === false;
        const old = existing.get(pin.id);
        if (old) old.forEach(l => map.removeLayer(l));

        const isSelected = pin.id === selectedPinId;
        const layers: any[] = [];

        // 1. ZCTA polygon fills + labels
        if (pin.features.length > 0 && !pin.loading) {
          const geoLayer = L.geoJSON(
            { type: "FeatureCollection", features: pin.features } as any,
            {
              style: (feat: any) => {
                const zip = feat?.properties?.zip ?? feat?.properties?.ZCTA5;
                const isExcluded = manualExcludes?.has(zip);

                if (isExcluded) {
                  return { fillColor: '#c0392b', fillOpacity: 0.22, color: '#c0392b', weight: 1.5, opacity: 0.9, dashArray: '5,4' };
                }

                // Perf outline when a client is connected — fill is transparent, stroke is colored
                if (perfCircles) {
                  const perf = perfCircles[zip];
                  if (perf) {
                    const { color } = perfScoreToFill(perf.score);
                    return { fillOpacity: 0, color, weight: isSelected ? 3 : 2, opacity: 0.9 };
                  }
                  // In territory but no perf row → faint outline only
                  return { fillOpacity: 0, color: 'rgba(0,0,0,0.21)', weight: 0.8, opacity: 0.8 };
                }

                // No connected client → grade-based fill
                const grade = pin.scores?.[zip]?.grade;
                const fc = grade ? GRADE_COLORS[grade] : pin.color;
                return {
                  fillColor: fc,
                  fillOpacity: isSelected ? 0.50 : 0.32,
                  color: fc,
                  weight: isSelected ? 1.5 : 0.8,
                  opacity: isSelected ? 0.9 : 0.6,
                };
              },
              onEachFeature: (feat: any, layer: any) => {
                const zip = feat.properties?.zip ?? feat.properties?.ZCTA5;

                // Register bounds for fly-to
                if (zip) {
                  try {
                    const b = layer.getBounds();
                    if (b?.isValid()) zipBoundsRef.current.set(zip, b);
                  } catch {}
                }

                // Zip code label on the polygon
                if (zip) {
                  layer.bindTooltip(zip, {
                    permanent:   true,
                    direction:   "center",
                    className:   "zip-label",
                    opacity:     1,
                    interactive: false,
                  });
                }

                // Hover popup with perf breakdown (only when client is connected)
                if (zip && perfCircles?.[zip] && !manualExcludes?.has(zip)) {
                  const perf = perfCircles[zip];
                  const { color } = perfScoreToFill(perf.score);
                  const html = `<div style="font-family:system-ui;min-width:160px;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                      <div style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0;"></div>
                      <span style="font-size:12px;font-weight:700;color:#000000;">${zip}</span>
                      <span style="font-size:10px;color:#4a4a4a;margin-left:auto;">score ${perf.score}</span>
                    </div>
                    <div style="font-size:11px;color:#333333;line-height:2.0;">
                      <span style="color:#a3e635;">${perf.leads}</span>&thinsp;leads &ensp;
                      <span style="color:#4a4a4a;">${perf.appointments}</span>&thinsp;appts &ensp;
                      <span style="color:#6b6b6b;">${perf.shows}</span>&thinsp;shows<br/>
                      <span style="color:#4a4a4a;">${perf.closes}</span>&thinsp;closed &ensp;
                      <span style="color:#000000;">${fmt$(perf.revenue)}</span>
                    </div>
                  </div>`;
                  layer.bindPopup(html, { className: 'zip-perf-popup', closeButton: false, autoPan: false });
                  layer.on('mouseover', () => { try { layer.openPopup(); } catch {} });
                  layer.on('mouseout',  () => { try { layer.closePopup(); } catch {} });
                  layer.on('click',     () => { try { layer.closePopup(); } catch {} });
                }

                // Click handler
                layer.on("click", (e: any) => {
                  L.DomEvent.stopPropagation(e);
                  if (!zip) return;
                  if (pinModeRef.current === "exclude") {
                    onExcludeToggleRef.current?.(zip);
                  } else {
                    onSelectPin(pin.id);
                    onZipClickRef.current?.(zip);
                  }
                });
              },
            },
          ).addTo(map);
          layers.push(geoLayer);

          // Auto-fly to pin bounds when a newly placed pin finishes loading
          if (justFinishedLoading && pin.id === selectedPinId) {
            let ub: any = null;
            for (const z of pin.zips) {
              const b = zipBoundsRef.current.get(z);
              if (!b?.isValid()) continue;
              ub = ub ? ub.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
            }
            if (ub?.isValid()) {
              try { map.flyToBounds(ub, { padding: [50, 50], maxZoom: 13, duration: 0.8 }); } catch {}
            }
          }
        }

        // 2. Radius ring (non-interactive so it doesn't steal clicks)
        const ring = L.circle([pin.lat, pin.lng], {
          radius:      pin.radius * 1609.344,
          color:       pin.color,
          fillColor:   pin.color,
          fillOpacity: 0.03,
          weight:      isSelected ? 2.5 : 1.5,
          dashArray:   "6,4",
          interactive: false,
        }).addTo(map);
        layers.push(ring);

        // 3. Pin marker
        const idx  = pins.indexOf(pin);
        const icon = L.divIcon({
          html: `<div style="
              background:${pin.color};width:30px;height:30px;
              border-radius:50% 50% 50% 0;transform:rotate(-45deg);
              display:flex;align-items:center;justify-content:center;
              border:2.5px solid rgba(0,0,0,1);
              box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:pointer;">
              <span style="transform:rotate(45deg);color:#fff;font-weight:800;font-size:12px;line-height:1;">${idx + 1}</span>
            </div>`,
          iconSize:   [30, 30],
          iconAnchor: [15, 30],
          className:  "",
        });

        const marker = L.marker([pin.lat, pin.lng], { icon, zIndexOffset: 1000 }).addTo(map);
        marker.on("click", (e: any) => {
          L.DomEvent.stopPropagation(e);
          onSelectPin(pin.id === selectedPinId ? null : pin.id);
        });

        marker.bindPopup(`
          <div style="font-family:system-ui;text-align:center;min-width:120px;">
            <div style="font-size:13px;font-weight:700;color:#000000;margin-bottom:8px">${pin.label}</div>
            <div style="font-size:11px;color:#4a4a4a;margin-bottom:10px">${pin.zips.length} zip codes · ${pin.radius} mi</div>
            <button onclick="window.__deletePin && window.__deletePin('${pin.id}')"
              style="background:#c0392b;border:none;color:#fff;padding:5px 14px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">
              Delete Pin
            </button>
          </div>
        `, { className: "zip-pin-popup", maxWidth: 180, closeButton: false });

        layers.push(marker);
        existing.set(pin.id, layers);
      }

      // Auto-fly when user clicks an already-loaded pin in the sidebar or on the map
      if (didSelectionChange && selectedPinId) {
        const pin = pins.find(p => p.id === selectedPinId);
        if (pin && !pin.loading && pin.zips.length) {
          let ub: any = null;
          for (const z of pin.zips) {
            const b = zipBoundsRef.current.get(z);
            if (!b?.isValid()) continue;
            ub = ub ? ub.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
          }
          if (ub?.isValid()) {
            try { map.flyToBounds(ub, { padding: [50, 50], maxZoom: 13, duration: 0.8 }); } catch {}
          }
        }
      }

      prevPinsRef.current = pins.map(p => ({ ...p }));
    });
  }, [pins, selectedPinId, onSelectPin, manualExcludes, perfCircles]);

  // Fly to all pins combined when flyTrigger increments (session load)
  useEffect(() => {
    if (!flyTrigger || !mapRef.current) return;
    import("leaflet").then((L) => {
      const map = mapRef.current;
      if (!map) return;
      let combined: any = null;
      for (const [, b] of zipBoundsRef.current) {
        if (!b?.isValid()) continue;
        combined = combined ? combined.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
      }
      if (combined?.isValid()) {
        try { map.flyToBounds(combined, { padding: [50, 50], maxZoom: 12, duration: 1.0 }); } catch {}
      }
    });
  }, [flyTrigger]);

  // Fly to focusZip when it changes or when its polygon first becomes available (deferred case).
  // flewToFocusZipRef guards against re-flying on every pins update once we've already flown.
  useEffect(() => {
    if (!focusZip || !mapRef.current) return;
    if (flewToFocusZipRef.current === focusZip) return;
    const bounds = zipBoundsRef.current.get(focusZip);
    if (bounds?.isValid()) {
      try { mapRef.current.flyToBounds(bounds, { padding: [60, 60], maxZoom: 14, duration: 0.6 }); } catch {}
      flewToFocusZipRef.current = focusZip;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusZip, pins]);

  // Wire delete handler for popup button
  useEffect(() => {
    (window as any).__deletePin = (id: string) => {
      mapRef.current?.closePopup();
      onDeletePin(id);
    };
    return () => { delete (window as any).__deletePin; };
  }, [onDeletePin]);

  const crosshair = pinMode === "include";

  return (
    <>
      <style>{`
        .zip-pin-popup .leaflet-popup-content-wrapper {
          background:#0c1828; border:1px solid rgba(0,0,0,0.162);
          color:#111111; border-radius:10px; box-shadow:0 8px 32px rgba(0,0,0,0.6);
        }
        .zip-pin-popup .leaflet-popup-tip { background:#0c1828; }
        .zip-pin-popup .leaflet-popup-content { margin:12px 14px; }
        .leaflet-container { cursor:${crosshair ? "crosshair" : "default"} !important; }
        .leaflet-interactive { cursor:pointer; }

        /* Zip code labels on polygons */
        .zip-label {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
          margin: 0 !important;
          pointer-events: none !important;
        }
        .zip-label .leaflet-tooltip-content,
        .leaflet-tooltip.zip-label {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          font-size: 8.5px;
          font-weight: 800;
          font-family: monospace;
          color: rgba(0,0,0,1);
          text-shadow: 0 0 4px rgba(0,0,0,0.95), 0 1px 3px rgba(0,0,0,0.85);
          white-space: nowrap;
          letter-spacing: 0.02em;
        }
        .zip-label::before { display: none !important; }

        /* Choropleth hover popup */
        .zip-perf-popup .leaflet-popup-content-wrapper {
          background: #0f172a; border: 1px solid rgba(0,0,0,0.162);
          color: #111111; border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6); padding: 0;
        }
        .zip-perf-popup .leaflet-popup-content { margin: 10px 13px; }
        .zip-perf-popup .leaflet-popup-tip-container { display: none; }
        .zip-perf-popup .leaflet-popup-close-button { display: none; }
      `}</style>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </>
  );
}

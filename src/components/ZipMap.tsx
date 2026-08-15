"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { scoreToRadius, fmt$ } from "@/lib/zip-score";

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
  // zip -> composite performance score/metrics for the connected client, drawn as a
  // circle overlay on top of the existing grade-colored polygons (sized by score).
  perfCircles?: Record<string, ZipPerfCircle>;
};

const GRADE_COLORS: Record<string, string> = {
  A: "#10b981", B: "#3b82f6", C: "#f59e0b", D: "#ef4444",
};

export default function ZipMap({
  pins, selectedPinId, onMapClick, onSelectPin, onDeletePin,
  onZipClick, focusZip,
  manualExcludes, pinMode = "include", onExcludeToggle,
  perfCircles,
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

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    import("leaflet").then((L) => {
      const map = L.map(containerRef.current!, { zoomControl: true, center: [39, -98], zoom: 4 });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
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
          const perfCenters: { zip: string; center: any }[] = [];

          const geoLayer = L.geoJSON(
            { type: "FeatureCollection", features: pin.features } as any,
            {
              style: (feat: any) => {
                const zip  = feat?.properties?.zip ?? feat?.properties?.ZCTA5;
                const grade = pin.scores?.[zip]?.grade;
                const isExcluded = manualExcludes?.has(zip);
                const fc = isExcluded
                  ? "#ef4444"
                  : (grade ? GRADE_COLORS[grade] : pin.color);
                return {
                  fillColor:   fc,
                  fillOpacity: isExcluded ? 0.22 : (isSelected ? 0.5 : 0.32),
                  color:       fc,
                  weight:      isExcluded ? 1.5 : (isSelected ? 1.5 : 0.8),
                  opacity:     isExcluded ? 0.9 : (isSelected ? 0.9 : 0.6),
                  dashArray:   isExcluded ? "5,4" : undefined,
                };
              },
              onEachFeature: (feat: any, layer: any) => {
                const zip = feat.properties?.zip ?? feat.properties?.ZCTA5;

                // Register bounds for fly-to
                if (zip) {
                  try {
                    const b = layer.getBounds();
                    if (b?.isValid()) zipBoundsRef.current.set(zip, b);
                    if (b?.isValid() && perfCircles?.[zip] && !manualExcludes?.has(zip)) {
                      perfCenters.push({ zip, center: b.getCenter() });
                    }
                  } catch {}
                }

                // Zip code label on the polygon
                if (zip) {
                  layer.bindTooltip(zip, {
                    permanent:  true,
                    direction:  "center",
                    className:  "zip-label",
                    opacity:    1,
                    interactive: false,
                  });
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

          // 1b. Performance circle overlay — drawn after (on top of) the polygon fills,
          // sized by each zip's composite lead/appointment/show/close/revenue score.
          for (const { zip, center } of perfCenters) {
            const perf = perfCircles![zip];
            const circle = L.circleMarker(center, {
              radius:      scoreToRadius(perf.score),
              color:       "#f8fafc",
              weight:      2,
              fillColor:   "#f8fafc",
              fillOpacity: 0.12,
              opacity:     0.8,
            }).addTo(map);
            circle.bindTooltip(
              `<div style="font-family:monospace;line-height:1.6;">
                <b>${zip}</b> · Perf ${perf.score}<br/>
                ${perf.leads}L · ${perf.appointments}A · ${perf.shows}S · ${perf.closes}C<br/>
                ${fmt$(perf.revenue)}
              </div>`,
              { direction: "top", className: "zip-perf-tooltip", opacity: 1 },
            );
            circle.on("click", (e: any) => {
              L.DomEvent.stopPropagation(e);
              if (pinModeRef.current === "exclude") {
                onExcludeToggleRef.current?.(zip);
              } else {
                onSelectPin(pin.id);
                onZipClickRef.current?.(zip);
              }
            });
            layers.push(circle);
          }

          // Deferred fly-to: if focusZip just became available, fly to it
          const fz = focusZipRef.current;
          if (fz) {
            const b = zipBoundsRef.current.get(fz);
            if (b?.isValid()) {
              try { map.flyToBounds(b, { padding: [60, 60], maxZoom: 14, duration: 0.6 }); } catch {}
            }
          }

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
              border:2.5px solid rgba(255,255,255,0.9);
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
            <div style="font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:8px">${pin.label}</div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:10px">${pin.zips.length} zip codes · ${pin.radius} mi</div>
            <button onclick="window.__deletePin && window.__deletePin('${pin.id}')"
              style="background:#ef4444;border:none;color:#fff;padding:5px 14px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">
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

  // Fly to zip when focusZip changes
  useEffect(() => {
    if (!focusZip || !mapRef.current) return;
    const bounds = zipBoundsRef.current.get(focusZip);
    if (bounds?.isValid()) {
      try { mapRef.current.flyToBounds(bounds, { padding: [60, 60], maxZoom: 14, duration: 0.6 }); } catch {}
    }
  }, [focusZip]);

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
          background:#0c1828; border:1px solid rgba(255,255,255,0.12);
          color:#e2e8f0; border-radius:10px; box-shadow:0 8px 32px rgba(0,0,0,0.6);
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
          color: rgba(255,255,255,0.92);
          text-shadow: 0 0 4px rgba(0,0,0,0.95), 0 1px 3px rgba(0,0,0,0.85);
          white-space: nowrap;
          letter-spacing: 0.02em;
        }
        .zip-label::before { display: none !important; }

        /* Performance circle hover tooltip */
        .zip-perf-tooltip.leaflet-tooltip {
          background: #0c1828; border: 1px solid rgba(255,255,255,0.12);
          color: #e2e8f0; border-radius: 8px; font-size: 11px; padding: 6px 9px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        }
        .zip-perf-tooltip.leaflet-tooltip::before { display: none !important; }
      `}</style>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </>
  );
}

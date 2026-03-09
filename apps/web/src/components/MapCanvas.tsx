import type { PickingInfo } from "@deck.gl/core";
import { GeoJsonLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type {
  FrameLayerData,
  GeoJsonFeatureCollection,
  LayerDefinition,
  MapHexResponse
} from "@argcis/shared";
import { riskColor } from "@argcis/shared";
import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { LayerState } from "./LayerPanel";

interface MapCanvasProps {
  layers: LayerDefinition[];
  frameLayers: FrameLayerData[];
  hex: MapHexResponse | null;
  layerState: Record<string, LayerState>;
  onBoundsChange(bbox: string): void;
}

const STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL ?? "https://demotiles.maplibre.org/style.json";

export function MapCanvas({
  layers,
  frameLayers,
  hex,
  layerState,
  onBoundsChange
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [24.9, 55.2],
      zoom: 6.5
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay);

    map.on("load", () => {
      emitBounds(map, onBoundsChange);
    });
    map.on("moveend", () => {
      emitBounds(map, onBoundsChange);
    });

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [onBoundsChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const applyLayers = () => {
      for (const layer of layers) {
        if (layer.id === "risk-hex") {
          continue;
        }

        const payload = frameLayers.find((item) => item.layer_id === layer.id)?.feature_collection;
        syncMapLayer(map, layer.id, payload, layer.render_type, layerState[layer.id]);
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", applyLayers);
      return () => {
        map.off("load", applyLayers);
      };
    }

    applyLayers();
  }, [frameLayers, layerState, layers]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const map = mapRef.current;
    if (!overlay || !map) {
      return;
    }

    const visible = layerState["risk-hex"]?.visible ?? true;
    const opacity = layerState["risk-hex"]?.opacity ?? 0.65;

    const data: GeoJsonFeatureCollection = {
      type: "FeatureCollection",
      features: (hex?.cells ?? []).map((cell) => ({
        type: "Feature",
        id: cell.h3_index,
        geometry: cell.geometry,
        properties: {
          risk_level: cell.risk_level,
          recommended_action: cell.recommended_action,
          risk_summary: cell.risk_summary,
          ...cell.raw_metrics
        }
      }))
    };

    overlay.setProps({
      layers: visible
        ? [
            new GeoJsonLayer({
              id: "risk-hex-deck",
              data,
              pickable: true,
              stroked: true,
              filled: true,
              getFillColor: (feature: { properties?: Record<string, unknown> }) =>
                toRgba(
                  riskColor(
                    String(feature.properties?.risk_level) as "green" | "yellow" | "red"
                  ),
                  opacity
                ),
              getLineColor: [15, 23, 42, 160],
              getLineWidth: 1,
              onClick: (info: PickingInfo) => {
                if (!info.coordinate || !info.object) {
                  return;
                }

                new maplibregl.Popup({ offset: 12 })
                  .setLngLat([info.coordinate[0], info.coordinate[1]])
                  .setHTML(
                    `<strong>${info.object.properties?.risk_level ?? "unknown"}</strong><p>${
                      info.object.properties?.risk_summary ?? ""
                    }</p><small>${info.object.properties?.recommended_action ?? ""}</small>`
                  )
                  .addTo(map);
              }
            })
          ]
        : []
    });
  }, [hex, layerState]);

  return <div className="map-canvas" ref={containerRef} />;
}

function syncMapLayer(
  map: maplibregl.Map,
  layerId: string,
  data: GeoJsonFeatureCollection | undefined,
  renderType: LayerDefinition["render_type"],
  state?: LayerState
) {
  const sourceId = `${layerId}-source`;
  const mapLayerId = `${layerId}-layer`;

  if (!data) {
    if (map.getLayer(mapLayerId)) {
      map.removeLayer(mapLayerId);
    }
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
    return;
  }

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "geojson",
      data
    });
  } else {
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
    source.setData(data as never);
  }

  if (!map.getLayer(mapLayerId)) {
    map.addLayer(
      (renderType === "fill"
        ? {
            id: mapLayerId,
            source: sourceId,
            type: "fill",
            paint: {
              "fill-color": "#14b8a6",
              "fill-opacity": state?.opacity ?? 0.35
            }
          }
        : {
            id: mapLayerId,
            source: sourceId,
            type: "circle",
            paint: {
              "circle-radius": 6,
              "circle-color":
                layerId === "road-alerts"
                  ? "#ef4444"
                  : layerId === "road-weather-points"
                    ? "#f59e0b"
                    : "#2563eb",
              "circle-opacity": state?.opacity ?? 0.85,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1.5
            }
          }) as never
    );
  }

  map.setLayoutProperty(
    mapLayerId,
    "visibility",
    state?.visible === false ? "none" : "visible"
  );

  if (renderType === "fill") {
    map.setPaintProperty(mapLayerId, "fill-opacity", state?.opacity ?? 0.35);
  } else {
    map.setPaintProperty(mapLayerId, "circle-opacity", state?.opacity ?? 0.85);
  }
}

function emitBounds(map: maplibregl.Map, onBoundsChange: (bbox: string) => void) {
  const bounds = map.getBounds();
  onBoundsChange(
    [
      bounds.getWest().toFixed(4),
      bounds.getSouth().toFixed(4),
      bounds.getEast().toFixed(4),
      bounds.getNorth().toFixed(4)
    ].join(",")
  );
}

function toRgba(hex: string, opacity: number): [number, number, number, number] {
  const normalized = hex.replace("#", "");
  const bigint = Number.parseInt(normalized, 16);
  const red = (bigint >> 16) & 255;
  const green = (bigint >> 8) & 255;
  const blue = bigint & 255;
  return [red, green, blue, Math.round(opacity * 255)];
}

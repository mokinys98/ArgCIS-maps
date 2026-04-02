import type { PickingInfo } from "@deck.gl/core";
import { GeoJsonLayer, IconLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type {
  FrameLayerData,
  H3OutlineCell,
  LayerDefinition,
  MapHexResponse
} from "@argcis/shared";
import { deriveRiskLevelFromScore, riskColor } from "@argcis/shared";
import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { createBasemapStyle } from "../lib/basemap";
import type { LayerState } from "./LayerPanel";

interface MapCanvasProps {
  layers: LayerDefinition[];
  frameLayers: FrameLayerData[];
  hex: MapHexResponse | null;
  layerState: Record<string, LayerState>;
  onBoundsChange(bbox: string): void;
  onLayersUpdated?: () => void;
}

export function MapCanvas({
  layers,
  frameLayers,
  hex,
  layerState,
  onBoundsChange,
  onLayersUpdated
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [mapZoom, setMapZoom] = useState(7);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createBasemapStyle(),
      center: [24.9, 55.2],
      zoom: 7,
      maxZoom: 19
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay);

    map.on("load", () => {
      setMapZoom(map.getZoom());
      emitBounds(map, onBoundsChange);
    });
    map.on("moveend", () => {
      setMapZoom(map.getZoom());
      emitBounds(map, onBoundsChange);
    });
    map.on("zoom", () => {
      setMapZoom(map.getZoom());
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
    const overlay = overlayRef.current;
    const map = mapRef.current;
    if (!overlay || !map) {
      return;
    }

    const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
    const frameLayerMap = new Map(frameLayers.map((layer) => [layer.layer_id, layer]));

    overlay.setProps({
      layers: buildOverlayLayers({
        map,
        layers,
        layerState,
        frameLayerMap,
        riskCells: hex?.cells ?? [],
        outlineCells: hex?.outline_cells ?? [],
        layerMap,
        zoom: mapZoom
      })
    });

    // Notify parent that layers were updated. Prefer deck.gl's
    // onAfterRender if available so callers wait for a finished render.
    if (typeof onLayersUpdated === "function") {
      const deck = (overlay as any).deck ?? overlayRef.current?.deck;
      if (deck && typeof deck.setProps === "function") {
        const oneTime = () => {
          try {
            onLayersUpdated();
          } finally {
            try {
              // remove the handler after first run
              deck.setProps({ onAfterRender: undefined });
            } catch (_) {
              // ignore
            }
          }
        };

        try {
          deck.setProps({ onAfterRender: oneTime });
        } catch (_) {
          // fallback if deck doesn't accept setProps here
          requestAnimationFrame(() => onLayersUpdated());
        }
      } else {
        // last-resort fallback: next animation frame
        requestAnimationFrame(() => onLayersUpdated());
      }
    }
  }, [hex, layerState, layers, frameLayers, mapZoom]);

  return <div className="map-canvas" ref={containerRef} />;
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

function buildOverlayLayers({
  map,
  layers,
  layerState,
  frameLayerMap,
  riskCells,
  outlineCells,
  layerMap,
  zoom
}: {
  map: maplibregl.Map;
  layers: LayerDefinition[];
  layerState: Record<string, LayerState>;
  frameLayerMap: Map<string, FrameLayerData>;
  riskCells: MapHexResponse["cells"];
  outlineCells: H3OutlineCell[];
  layerMap: Map<string, LayerDefinition>;
  zoom: number;
}) {
  const deckLayers: Array<GeoJsonLayer | IconLayer<PointMarker>> = [];
  const shouldRenderFillZonesOnly = !isCenterInLithuania(map.getCenter());
  const isRiskVisible = layerState["risk-hex"]?.visible !== false;
  const isHexOutlineVisible = layerState["h3-grid-outline"]?.visible !== false;

  if ((isRiskVisible || isHexOutlineVisible) && outlineCells.length > 0) {
    deckLayers.push(
      new GeoJsonLayer({
        id: "h3-grid-base-outline-deck",
        data: {
          type: "FeatureCollection",
          features: outlineCells.map((cell) => ({
            type: "Feature",
            id: `outline-${cell.h3_index}`,
            geometry: cell.geometry,
            properties: {
              label: cell.h3_index
            }
          }))
        },
        pickable: true,
        stroked: true,
        filled: false,
        getLineColor: [15, 23, 42, isHexOutlineVisible ? 160 : 90],
        getLineWidth: getDynamicHexOutlineWidth(zoom, isHexOutlineVisible),
        lineWidthUnits: "pixels",
        onClick: (info: PickingInfo) => showPopup(map, info)
      })
    );
  }

  for (const layer of layers) {
    if (layerState[layer.id]?.visible === false) {
      continue;
    }
    if (shouldRenderFillZonesOnly && !isRenderableOutsideLithuania(layer)) {
      continue;
    }

    if (layer.id === "risk-hex") {
      deckLayers.push(
        new GeoJsonLayer({
          id: "risk-hex-deck",
          data: {
            type: "FeatureCollection",
            features: riskCells.map((cell) => ({
              type: "Feature",
              id: cell.h3_index,
              geometry: cell.geometry,
              properties: {
                risk_score: cell.risk_score,
                signal_count: cell.signal_count,
                red_signal_count: cell.red_signal_count,
                yellow_signal_count: cell.yellow_signal_count,
                confidence_multiplier: cell.confidence_multiplier,
                risk_level: cell.risk_level,
                recommended_action: cell.recommended_action,
                risk_summary: cell.risk_summary,
                ...cell.raw_metrics
              }
            }))
          },
          pickable: true,
          stroked: false,
          filled: true,
          getFillColor: (feature: { properties?: Record<string, unknown> }) =>
            toRgba(
              riskColor(
                deriveRiskLevelFromScore(Number(feature.properties?.risk_score ?? 0))
              ),
              layer.default_opacity
            ),
          onClick: (info: PickingInfo) => showPopup(map, info)
        })
      );
      continue;
    }

    if (layer.id === "h3-grid-outline") {
      continue;
    }

    const frameLayer = frameLayerMap.get(layer.id);
    if (!frameLayer) {
      continue;
    }

    if (layer.id === "meteo-forecast-points" || layer.id === "road-weather-points") {
      const pointData = toPointMarkers(frameLayer);
      if (pointData.length === 0) {
        continue;
      }

      deckLayers.push(
        new IconLayer<PointMarker>({
          id: `${layer.id}-icon`,
          data: pointData,
          pickable: true,
          billboard: true,
          sizeUnits: "pixels",
          sizeMinPixels: 18,
          sizeMaxPixels: 64,
          getPosition: (item) => item.coordinates,
          getIcon: (item) => item.icon,
          getSize: () => getDynamicIconSize(layer.id, zoom),
          onClick: (info: PickingInfo<PointMarker>) => showPopup(map, info)
        })
      );
      continue;
    }

    deckLayers.push(
      new GeoJsonLayer({
        id: `${layer.id}-deck`,
        data: frameLayer.feature_collection,
        pickable: true,
        stroked: true,
        filled: layer.render_type === "fill",
        pointType: "circle",
        getPointRadius: getDynamicPointRadius(layer.id, zoom),
        radiusUnits: "pixels",
        radiusMinPixels: 4,
        radiusMaxPixels: 22,
        getLineWidth: 0,
        lineWidthUnits: "pixels",
        getFillColor: (feature: { properties?: Record<string, unknown> }) =>
          chooseFillColor(layer.id, feature, layerMap),
        getLineColor: (feature: { properties?: Record<string, unknown> }) =>
          chooseLineColor(layer.id, feature),
        getPointColor: (feature: { properties?: Record<string, unknown> }) =>
          choosePointColor(layer.id, feature),
        onClick: (info: PickingInfo) => showPopup(map, info)
      })
    );
  }

  return deckLayers;
}

function isCenterInLithuania(center: maplibregl.LngLat): boolean {
  return (
    center.lng >= 20.5 &&
    center.lng <= 27 &&
    center.lat >= 53.8 &&
    center.lat <= 56.6
  );
}

function isRenderableOutsideLithuania(layer: LayerDefinition): boolean {
  return (
    layer.id === "risk-hex" ||
    layer.id === "h3-grid-outline" ||
    layer.id === "exercise-areas" ||
    layer.id === "activity-risk"
  );
}

function getDynamicPointRadius(layerId: string, zoom: number): number {
  const baseRadius =
    layerId === "road-alerts" ? 8 : layerId === "road-weather-points" ? 7 : layerId === "meteo-forecast-points" ? 6 : 5;
  const clampedZoom = Math.max(4, Math.min(12, zoom));
  const zoomOutBoost = (12 - clampedZoom) * 1.25;
  return baseRadius + zoomOutBoost;
}

function getDynamicIconSize(layerId: string, zoom: number): number {
  const baseSize = layerId === "road-weather-points" ? 22 : 20;
  const clampedZoom = Math.max(4, Math.min(12, zoom));
  return baseSize + (12 - clampedZoom) * 2.2;
}

function getDynamicHexOutlineWidth(zoom: number, isGridOutline: boolean): number {
  const clampedZoom = Math.max(4, Math.min(13, zoom));
  const baseWidth = isGridOutline ? 1.4 : 0;
  const zoomInBoost = Math.max(0, clampedZoom - 7) * (isGridOutline ? 0.22 : 0.18);
  const zoomOutBoost = Math.max(0, 7 - clampedZoom) * (isGridOutline ? 0.12 : 0.08);
  return baseWidth + zoomInBoost + zoomOutBoost;
}

interface PointMarker {
  id: string;
  coordinates: [number, number];
  properties: Record<string, unknown>;
  icon: {
    url: string;
    width: number;
    height: number;
    anchorY: number;
  };
}

const METEO_ICON = {
  url: makeSvgIcon("#2563eb", "M"),
  width: 96,
  height: 96,
  anchorY: 96
};

const ROAD_WEATHER_ICON = {
  url: makeSvgIcon("#f59e0b", "R"),
  width: 96,
  height: 96,
  anchorY: 96
};

function toPointMarkers(frameLayer: FrameLayerData): PointMarker[] {
  return frameLayer.feature_collection.features
    .map((feature) => {
      if (feature.geometry.type !== "Point") {
        return null;
      }

      return {
        id: String(feature.id ?? crypto.randomUUID()),
        coordinates: feature.geometry.coordinates,
        properties: (feature.properties as Record<string, unknown>) ?? {},
        icon:
          frameLayer.layer_id === "road-weather-points"
            ? ROAD_WEATHER_ICON
            : METEO_ICON
      } satisfies PointMarker;
    })
    .filter((item): item is PointMarker => item !== null);
}

function makeSvgIcon(color: string, label: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">` +
    `<circle cx="32" cy="26" r="18" fill="${color}" stroke="#ffffff" stroke-width="4"/>` +
    `<text x="32" y="32" text-anchor="middle" font-family="Arial" font-size="18" fill="#ffffff" font-weight="700">${label}</text>` +
    `<path d="M32 60 L22 40 L42 40 Z" fill="${color}" stroke="#ffffff" stroke-width="4"/>` +
    `</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function chooseFillColor(
  layerId: string,
  feature: { properties?: Record<string, unknown> },
  layerMap: Map<string, LayerDefinition>
): [number, number, number, number] {
  if (layerId === "activity-risk") {
    return toRgba(
      riskColor(deriveRiskLevelFromScore(Number(feature.properties?.risk_score ?? 0))),
      0.4
    );
  }

  const colorHint = layerMap.get(layerId)?.color_hint ?? "#14b8a6";
  return toRgba(colorHint, 0.28);
}

function chooseLineColor(
  layerId: string,
  feature: { properties?: Record<string, unknown> }
): [number, number, number, number] {
  if (layerId === "activity-risk") {
    return toRgba(
      riskColor(deriveRiskLevelFromScore(Number(feature.properties?.risk_score ?? 0))),
      0.95
    );
  }

  if (layerId === "exercise-areas") {
    return [20, 184, 166, 255];
  }

  if (layerId === "road-alerts") {
    return [220, 38, 38, 255];
  }

  return [37, 99, 235, 220];
}

function choosePointColor(
  layerId: string,
  feature: { properties?: Record<string, unknown> }
): [number, number, number, number] {
  if (layerId === "road-alerts") {
    return [220, 38, 38, 255];
  }

  if (layerId === "road-weather-points") {
    return [245, 158, 11, 240];
  }

  if (layerId === "activity-risk") {
    return toRgba(
      riskColor(deriveRiskLevelFromScore(Number(feature.properties?.risk_score ?? 0))),
      0.95
    );
  }

  return [31, 111, 235, 230];
}

function showPopup(map: maplibregl.Map, info: PickingInfo) {
  if (!info.coordinate || !info.object) {
    return;
  }

  const properties = (info.object as { properties?: Record<string, unknown> }).properties ?? {};
  const title =
    String(
      properties.label ??
        properties.alert_name ??
        (properties.risk_score !== undefined
          ? `Score ${properties.risk_score}`
          : properties.risk_level) ??
        "Objektas"
    );
  const body =
    String(
      properties.risk_summary ??
        (properties.risk_score !== undefined
          ? `Risk score: ${properties.risk_score}`
          : properties.surface_state ?? properties.alert_code) ??
        ""
    );
  const action = String(properties.recommended_action ?? "");
  const signalCount = Number(properties.signal_count ?? NaN);
  const redSignalCount = Number(properties.red_signal_count ?? NaN);
  const yellowSignalCount = Number(properties.yellow_signal_count ?? NaN);
  const confidence = Number(properties.confidence_multiplier ?? NaN);
  const confidenceLabel =
    Number.isFinite(confidence) && signalCount > 0
      ? confidence < 1
        ? `Confidence: ${confidence.toFixed(2)} (low confidence)`
        : `Confidence: ${confidence.toFixed(2)}`
      : "";
  const scoreMeta =
    properties.risk_score !== undefined
      ? `Risk score: ${properties.risk_score}`
      : "";
  const signalMeta =
    Number.isFinite(signalCount) && signalCount > 0
      ? `Signals: ${signalCount} | Red: ${Number.isFinite(redSignalCount) ? redSignalCount : 0} | Yellow: ${Number.isFinite(yellowSignalCount) ? yellowSignalCount : 0}`
      : "";
  const meta = [scoreMeta, signalMeta, confidenceLabel].filter(Boolean).join("<br/>");

  new maplibregl.Popup({ offset: 12 })
    .setLngLat([info.coordinate[0], info.coordinate[1]])
    .setHTML(
      `<strong>${title}</strong><p>${body}</p><small>${meta}</small><br/><small>${action}</small>`
    )
    .addTo(map);
}

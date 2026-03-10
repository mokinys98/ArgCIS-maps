import type { PickingInfo } from "@deck.gl/core";
import { GeoJsonLayer, IconLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type {
  FrameLayerData,
  H3OutlineCell,
  LayerDefinition,
  MapHexResponse
} from "@argcis/shared";
import { riskColor } from "@argcis/shared";
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
}

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
                risk_level: cell.risk_level,
                recommended_action: cell.recommended_action,
                risk_summary: cell.risk_summary,
                ...cell.raw_metrics
              }
            }))
          },
          pickable: true,
          stroked: true,
          filled: true,
          getFillColor: (feature: { properties?: Record<string, unknown> }) =>
            toRgba(
              riskColor(
                String(feature.properties?.risk_level) as "green" | "yellow" | "red"
              ),
              layer.default_opacity
            ),
          getLineColor: [15, 23, 42, 160],
          getLineWidth: getDynamicHexOutlineWidth(zoom, false),
          lineWidthUnits: "pixels",
          onClick: (info: PickingInfo) => showPopup(map, info)
        })
      );
      continue;
    }

    if (layer.id === "h3-grid-outline") {
      deckLayers.push(
        new GeoJsonLayer({
          id: "h3-grid-outline-deck",
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
          getLineColor: [15, 23, 42, 220],
          getLineWidth: getDynamicHexOutlineWidth(zoom, true),
          lineWidthUnits: "pixels",
          onClick: (info: PickingInfo) => showPopup(map, info)
        })
      );
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
        getLineWidth: 2,
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
  const baseWidth = isGridOutline ? 2.6 : 1.2;
  const zoomInBoost = Math.max(0, clampedZoom - 7) * (isGridOutline ? 0.4 : 0.18);
  const zoomOutBoost = Math.max(0, 7 - clampedZoom) * (isGridOutline ? 0.2 : 0.08);
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
      riskColor(String(feature.properties?.risk_level) as "green" | "yellow" | "red"),
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
      riskColor(String(feature.properties?.risk_level) as "green" | "yellow" | "red"),
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
      riskColor(String(feature.properties?.risk_level) as "green" | "yellow" | "red"),
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
    String(properties.label ?? properties.alert_name ?? properties.risk_level ?? "Objektas");
  const body =
    String(properties.risk_summary ?? properties.surface_state ?? properties.alert_code ?? "");
  const action = String(properties.recommended_action ?? "");

  new maplibregl.Popup({ offset: 12 })
    .setLngLat([info.coordinate[0], info.coordinate[1]])
    .setHTML(`<strong>${title}</strong><p>${body}</p><small>${action}</small>`)
    .addTo(map);
}

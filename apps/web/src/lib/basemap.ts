import type { StyleSpecification } from "maplibre-gl";

const DEFAULT_OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const OSM_SOURCE_ID = "osm-base";

export function createBasemapStyle(): StyleSpecification {
  const tileUrl = import.meta.env.VITE_OSM_TILE_URL ?? DEFAULT_OSM_TILE_URL;
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      [OSM_SOURCE_ID]: {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        attribution: "OpenStreetMap contributors"
      }
    },
    layers: [
      {
        id: OSM_SOURCE_ID,
        type: "raster",
        source: OSM_SOURCE_ID,
        minzoom: 0,
        maxzoom: 19
      }
    ]
  };
}

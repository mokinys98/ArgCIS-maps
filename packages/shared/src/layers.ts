import type { LayerDefinition } from "./types";

export const LAYER_CATALOG: LayerDefinition[] = [
  {
    id: "meteo-forecast-points",
    name: "Meteo forecast taskai",
    description: "Zali forecast taskai is meteorologiniu vietoviu.",
    kind: "raw",
    render_type: "circle",
    default_visible: true,
    default_opacity: 0.85,
    color_hint: "#1f6feb"
  },
  {
    id: "road-weather-points",
    name: "Keliu oro taskai",
    description: "Momentines ir forecast keliu salygos.",
    kind: "raw",
    render_type: "circle",
    default_visible: true,
    default_opacity: 0.9,
    color_hint: "#f59e0b"
  },
  {
    id: "road-alerts",
    name: "Keliu perspejimai",
    description: "Perspejimai ir apribojimai is keliu oro saltinio.",
    kind: "raw",
    render_type: "circle",
    default_visible: true,
    default_opacity: 1,
    color_hint: "#dc2626"
  },
  {
    id: "exercise-areas",
    name: "Pratybu geometrijos",
    description: "Scenariju ir veiklu geometrijos.",
    kind: "exercise",
    render_type: "fill",
    default_visible: true,
    default_opacity: 0.35,
    color_hint: "#14b8a6"
  },
  {
    id: "risk-hex",
    name: "H3 risk layer",
    description: "Skaiciuojamas H3 risk sluoksnis su paaiskinimu.",
    kind: "calculated",
    render_type: "hex",
    default_visible: true,
    default_opacity: 0.65,
    color_hint: "#ef4444"
  },
  {
    id: "activity-risk",
    name: "Veiklu risk suvestine",
    description: "Pratybu veiklu risk suvestines pagal laika ir vieta.",
    kind: "calculated",
    render_type: "fill",
    default_visible: true,
    default_opacity: 0.45,
    color_hint: "#8b5cf6"
  }
];

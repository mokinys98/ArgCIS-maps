import type {
  RawSignalMetrics,
  RecommendedAction,
  RiskLevel,
  RiskSummary
} from "./types";

const HEX_AGGREGATION_THRESHOLDS = {
  redThresholdScore: 85,
  yellowThresholdScore: 45,
  averageWeight: 0.35,
  severeShareWeight: 0.25,
  maxPointScoreWeight: 0.4,
  yellowShareValue: 55,
  roadDominantBonus: 15,
  roadPresentBonus: 8
} as const;

export interface ThresholdConfig {
  yellowWindGustMs: number;
  redWindGustMs: number;
  yellowVisibilityM: number;
  redVisibilityM: number;
  yellowThunderProbability: number;
  redThunderProbability: number;
  yellowPrecipitationMm: number;
}

export interface RiskAggregationContext {
  layer_id?: string;
  source?: "meteo" | "road";
}

export interface RiskAggregationItem extends RiskAggregationContext {
  summary: RiskSummary;
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  yellowWindGustMs: 14,
  redWindGustMs: 20,
  yellowVisibilityM: 1000,
  redVisibilityM: 300,
  yellowThunderProbability: 30,
  redThunderProbability: 70,
  yellowPrecipitationMm: 10
};

export function deriveRiskLevelFromScore(score: number): RiskLevel {
  if (score >= HEX_AGGREGATION_THRESHOLDS.redThresholdScore) {
    return "red";
  }

  if (score >= HEX_AGGREGATION_THRESHOLDS.yellowThresholdScore) {
    return "yellow";
  }

  return "green";
}

function pushReason(target: string[], reason: string): void {
  if (!target.includes(reason)) {
    target.push(reason);
  }
}

export function confidenceMultiplierForSignalCount(signalCount: number): number {
  if (signalCount >= 3) {
    return 1;
  }

  if (signalCount === 2) {
    return 0.85;
  }

  if (signalCount === 1) {
    return 0.75;
  }

  return 0;
}

export function evaluateRisk(
  metrics: RawSignalMetrics,
  thresholds: ThresholdConfig = DEFAULT_THRESHOLDS
): RiskSummary {
  const reasons: string[] = [];
  let score = 0;

  if ((metrics.thunder_probability ?? 0) >= thresholds.redThunderProbability) {
    pushReason(reasons, "perkunija");
    score = Math.max(score, 85);
  } else if (
    (metrics.thunder_probability ?? 0) >= thresholds.yellowThunderProbability
  ) {
    pushReason(reasons, "perkunijos tikimybe");
    score = Math.max(score, 45);
  }

  if ((metrics.wind_gust_ms ?? 0) >= thresholds.redWindGustMs) {
    pushReason(reasons, `gusiai virs ${thresholds.redWindGustMs} m/s`);
    score = Math.max(score, 80);
  } else if ((metrics.wind_gust_ms ?? 0) >= thresholds.yellowWindGustMs) {
    pushReason(reasons, `gusiai virs ${thresholds.yellowWindGustMs} m/s`);
    score = Math.max(score, 45);
  }

  if (
    metrics.visibility_m !== undefined &&
    metrics.visibility_m <= thresholds.redVisibilityM
  ) {
    pushReason(reasons, "rukas");
    score = Math.max(score, 90);
  } else if (
    metrics.visibility_m !== undefined &&
    metrics.visibility_m <= thresholds.yellowVisibilityM
  ) {
    pushReason(reasons, "sumazejas matomumas");
    score = Math.max(score, 40);
  }

  if (metrics.road_ice || metrics.surface_state === "ice") {
    pushReason(reasons, "kelio danga apledejusi");
    score = Math.max(score, 95);
  }

  if (metrics.road_restriction) {
    pushReason(reasons, "eismo apribojimas");
    score = Math.max(score, 90);
  }

  if ((metrics.precipitation_mm ?? 0) >= thresholds.yellowPrecipitationMm) {
    pushReason(reasons, "stiprus krituliai");
    score = Math.max(score, 35);
  }

  const level = deriveRiskLevelFromScore(score);
  const recommended_action = chooseAction(level, reasons);
  const risk_summary =
    reasons.length === 0
      ? "Rizika zema, ribojimu nera."
      : `Rizika ${level} (${score}): ${reasons.join(", ")}.`;

  return {
    risk_score: score,
    signal_count: 1,
    red_signal_count: level === "red" ? 1 : 0,
    yellow_signal_count: level === "yellow" ? 1 : 0,
    confidence_multiplier: 1,
    risk_level: level,
    risk_reasons: reasons,
    recommended_action,
    risk_summary
  };
}

export function aggregateRiskSummaries(items: RiskSummary[]): RiskSummary {
  if (items.length === 0) {
    return {
      risk_score: 0,
      signal_count: 0,
      red_signal_count: 0,
      yellow_signal_count: 0,
      confidence_multiplier: 0,
      risk_level: "green",
      risk_reasons: [],
      recommended_action: "vykdyti",
      risk_summary: "Rizikos signalu nerasta."
    };
  }

  const normalizedItems = items.map(normalizeAggregationItem);

  const redItems = normalizedItems.filter((item) => item.summary.risk_level === "red");
  const yellowItems = normalizedItems.filter((item) => item.summary.risk_level === "yellow");
  const yellowOrRedItems = [...redItems, ...yellowItems];
  const signalCount = items.length;
  const redSignalCount = redItems.length;
  const yellowSignalCount = yellowItems.length;
  const totalItemWeight = normalizedItems.reduce(
    (total, item) => total + aggregationWeightForItem(item),
    0
  );
  const safeTotalWeight = totalItemWeight > 0 ? totalItemWeight : 1;
  const redShare =
    redItems.reduce((total, item) => total + aggregationWeightForItem(item), 0) /
    safeTotalWeight;
  const yellowShare =
    yellowItems.reduce((total, item) => total + aggregationWeightForItem(item), 0) /
    safeTotalWeight;
  const averageStationScore =
    normalizedItems.reduce(
      (total, item) =>
        total + item.summary.risk_score * aggregationWeightForItem(item),
      0
    ) / safeTotalWeight;
  const severeShareScore =
    redShare * 100 + yellowShare * HEX_AGGREGATION_THRESHOLDS.yellowShareValue;
  const maxPointScore = Math.max(
    ...normalizedItems.map((item) => item.summary.risk_score * layerWeightForItem(item))
  );
  const roadHardCount = normalizedItems.filter((item) =>
    item.summary.risk_reasons.some(
      (reason) =>
        reason === "kelio danga apledejusi" || reason === "eismo apribojimas"
    )
  ).length;
  const roadShare =
    normalizedItems
      .filter((item) =>
        item.summary.risk_reasons.some(
          (reason) =>
            reason === "kelio danga apledejusi" || reason === "eismo apribojimas"
        )
      )
      .reduce((total, item) => total + aggregationWeightForItem(item), 0) / safeTotalWeight;
  const roadHardBonus =
    roadShare >= 0.3
      ? HEX_AGGREGATION_THRESHOLDS.roadDominantBonus
      : roadHardCount > 0 && signalCount >= 3
        ? HEX_AGGREGATION_THRESHOLDS.roadPresentBonus
        : 0;
  const rawHexScore =
    averageStationScore * HEX_AGGREGATION_THRESHOLDS.averageWeight +
    severeShareScore * HEX_AGGREGATION_THRESHOLDS.severeShareWeight +
    maxPointScore * HEX_AGGREGATION_THRESHOLDS.maxPointScoreWeight +
    roadHardBonus;
  const confidenceMultiplier = confidenceMultiplierForSignalCount(signalCount);
  const aggregateScore = Math.min(
    100,
    Math.round(rawHexScore * confidenceMultiplier)
  );

  const aggregateLevel = deriveRiskLevelFromScore(aggregateScore);
  const contributingItems =
    aggregateLevel === "red"
      ? redItems
      : aggregateLevel === "yellow"
        ? yellowOrRedItems
        : [];

  const combinedReasons =
    aggregateLevel === "green"
      ? []
      : Array.from(
          new Set(contributingItems.flatMap((item) => item.summary.risk_reasons))
        );

  return {
    risk_score: aggregateScore,
    signal_count: signalCount,
    red_signal_count: redSignalCount,
    yellow_signal_count: yellowSignalCount,
    confidence_multiplier: confidenceMultiplier,
    risk_level: aggregateLevel,
    risk_reasons: combinedReasons,
    recommended_action: chooseAction(aggregateLevel, combinedReasons),
    risk_summary:
      combinedReasons.length === 0
        ? "Rizikos signalu nerasta."
        : `Bendra rizika ${aggregateLevel} (${aggregateScore}): ${combinedReasons.join(", ")}.`
  };
}

function normalizeAggregationItem(item: RiskSummary | RiskAggregationItem): RiskAggregationItem {
  if ("summary" in item) {
    return item;
  }

  return {
    summary: item
  };
}

function aggregationWeightForItem(item: RiskAggregationItem): number {
  return layerWeightForItem(item) * impactWeightForSummary(item.summary);
}

function layerWeightForItem(item: RiskAggregationItem): number {
  switch (item.layer_id) {
    case "road-alerts":
      return 1.35;
    case "road-weather-points":
      return 1.15;
    case "meteo-forecast-points":
      return 1.2;
    default:
      return item.source === "road" ? 1.15 : item.source === "meteo" ? 1.2 : 1;
  }
}

function impactWeightForSummary(summary: RiskSummary): number {
  if (summary.risk_level === "red") {
    return 1.15;
  }

  if (summary.risk_level === "yellow") {
    return 1;
  }

  if (summary.risk_score > 0 || summary.risk_reasons.length > 0) {
    return 0.4;
  }

  return 0.02;
}

export function riskColor(level: RiskLevel): string {
  switch (level) {
    case "green":
      return "#2f9e44";
    case "yellow":
      return "#f59f00";
    case "red":
      return "#e03131";
  }
}

function chooseAction(
  level: RiskLevel,
  reasons: string[]
): RecommendedAction {
  if (level === "green") {
    return "vykdyti";
  }

  if (level === "yellow") {
    return reasons.includes("eismo apribojimas")
      ? "keisti marsruta"
      : "vykdyti su ribojimais";
  }

  if (reasons.includes("eismo apribojimas")) {
    return "keisti marsruta";
  }

  if (reasons.includes("kelio danga apledejusi")) {
    return "perkelti";
  }

  return "stabdyti";
}

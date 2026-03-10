import type {
  RawSignalMetrics,
  RecommendedAction,
  RiskLevel,
  RiskSummary
} from "./types";

const RISK_WEIGHT: Record<RiskLevel, number> = {
  green: 0,
  yellow: 1,
  red: 2
};

const HEX_AGGREGATION_THRESHOLDS = {
  redRatio: 0.45,
  yellowRatio: 0.35,
  minRedCount: 2,
  minYellowCount: 2
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

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  yellowWindGustMs: 14,
  redWindGustMs: 20,
  yellowVisibilityM: 1000,
  redVisibilityM: 300,
  yellowThunderProbability: 30,
  redThunderProbability: 70,
  yellowPrecipitationMm: 10
};

function pushReason(target: string[], reason: string): void {
  if (!target.includes(reason)) {
    target.push(reason);
  }
}

export function evaluateRisk(
  metrics: RawSignalMetrics,
  thresholds: ThresholdConfig = DEFAULT_THRESHOLDS
): RiskSummary {
  const reasons: string[] = [];
  let level: RiskLevel = "green";

  if ((metrics.thunder_probability ?? 0) >= thresholds.redThunderProbability) {
    pushReason(reasons, "perkunija");
    level = "red";
  } else if (
    (metrics.thunder_probability ?? 0) >= thresholds.yellowThunderProbability
  ) {
    pushReason(reasons, "perkunijos tikimybe");
    level = escalate(level, "yellow");
  }

  if ((metrics.wind_gust_ms ?? 0) >= thresholds.redWindGustMs) {
    pushReason(reasons, `gusiai virs ${thresholds.redWindGustMs} m/s`);
    level = "red";
  } else if ((metrics.wind_gust_ms ?? 0) >= thresholds.yellowWindGustMs) {
    pushReason(reasons, `gusiai virs ${thresholds.yellowWindGustMs} m/s`);
    level = escalate(level, "yellow");
  }

  if (
    metrics.visibility_m !== undefined &&
    metrics.visibility_m <= thresholds.redVisibilityM
  ) {
    pushReason(reasons, "rukas");
    level = "red";
  } else if (
    metrics.visibility_m !== undefined &&
    metrics.visibility_m <= thresholds.yellowVisibilityM
  ) {
    pushReason(reasons, "sumazejas matomumas");
    level = escalate(level, "yellow");
  }

  if (metrics.road_ice || metrics.surface_state === "ice") {
    pushReason(reasons, "kelio danga apledejusi");
    level = "red";
  }

  if (metrics.road_restriction) {
    pushReason(reasons, "eismo apribojimas");
    level = "red";
  }

  if ((metrics.precipitation_mm ?? 0) >= thresholds.yellowPrecipitationMm) {
    pushReason(reasons, "stiprus krituliai");
    level = escalate(level, "yellow");
  }

  const recommended_action = chooseAction(level, reasons);
  const risk_summary =
    reasons.length === 0
      ? "Rizika zema, ribojimu nera."
      : `Rizika ${level}: ${reasons.join(", ")}.`;

  return {
    risk_level: level,
    risk_reasons: reasons,
    recommended_action,
    risk_summary
  };
}

export function aggregateRiskSummaries(items: RiskSummary[]): RiskSummary {
  if (items.length === 0) {
    return {
      risk_level: "green",
      risk_reasons: [],
      recommended_action: "vykdyti",
      risk_summary: "Rizikos signalu nerasta."
    };
  }

  if (items.length === 1) {
    return items[0]!;
  }

  const redItems = items.filter((item) => item.risk_level === "red");
  const yellowItems = items.filter((item) => item.risk_level === "yellow");
  const yellowOrRedItems = [...redItems, ...yellowItems];

  const redThreshold = Math.max(
    HEX_AGGREGATION_THRESHOLDS.minRedCount,
    Math.ceil(items.length * HEX_AGGREGATION_THRESHOLDS.redRatio)
  );
  const yellowThreshold = Math.max(
    HEX_AGGREGATION_THRESHOLDS.minYellowCount,
    Math.ceil(items.length * HEX_AGGREGATION_THRESHOLDS.yellowRatio)
  );

  let aggregateLevel: RiskLevel = "green";
  let contributingItems: RiskSummary[] = [];

  if (redItems.length >= redThreshold) {
    aggregateLevel = "red";
    contributingItems = redItems;
  } else if (yellowOrRedItems.length >= yellowThreshold) {
    aggregateLevel = "yellow";
    contributingItems = yellowOrRedItems;
  }

  const combinedReasons =
    aggregateLevel === "green"
      ? []
      : Array.from(
          new Set(contributingItems.flatMap((item) => item.risk_reasons))
        );

  return {
    risk_level: aggregateLevel,
    risk_reasons: combinedReasons,
    recommended_action: chooseAction(aggregateLevel, combinedReasons),
    risk_summary:
      combinedReasons.length === 0
        ? "Rizikos signalu nerasta."
        : `Bendra rizika ${aggregateLevel}: ${combinedReasons.join(", ")}.`
  };
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

function escalate(current: RiskLevel, incoming: RiskLevel): RiskLevel {
  return RISK_WEIGHT[incoming] > RISK_WEIGHT[current] ? incoming : current;
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

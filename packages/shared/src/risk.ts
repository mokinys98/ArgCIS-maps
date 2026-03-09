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

  const combinedReasons = Array.from(
    new Set(items.flatMap((item) => item.risk_reasons))
  );
  const maxLevel = items.reduce<RiskLevel>(
    (current, item) =>
      RISK_WEIGHT[item.risk_level] > RISK_WEIGHT[current]
        ? item.risk_level
        : current,
    "green"
  );

  return {
    risk_level: maxLevel,
    risk_reasons: combinedReasons,
    recommended_action: chooseAction(maxLevel, combinedReasons),
    risk_summary:
      combinedReasons.length === 0
        ? "Rizikos signalu nerasta."
        : `Bendra rizika ${maxLevel}: ${combinedReasons.join(", ")}.`
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

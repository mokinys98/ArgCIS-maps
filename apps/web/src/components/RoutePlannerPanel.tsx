import { riskColor, type RouteRiskResponse } from "@argcis/shared";

interface RoutePlannerPanelProps {
  fromAddress: string;
  toAddress: string;
  selectedTime: string;
  route: RouteRiskResponse | null;
  loading: boolean;
  error: string | null;
  onFromAddressChange(value: string): void;
  onToAddressChange(value: string): void;
  onSubmit(): void;
}

export function RoutePlannerPanel({
  fromAddress,
  toAddress,
  selectedTime,
  route,
  loading,
  error,
  onFromAddressChange,
  onToAddressChange,
  onSubmit
}: RoutePlannerPanelProps) {
  const visibleSteps = route?.segments.slice(0, 16) ?? [];
  const hiddenStepCount = Math.max(0, (route?.segments.length ?? 0) - visibleSteps.length);

  return (
    <section className="panel route-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Marsruto planavimas</p>
          <h2>Kelione ir rizika</h2>
        </div>
      </div>

      <div className="route-form">
        <label>
          <input 
            style ={{fontSize: "0.88rem" , padding: "0.5rem"}}
            value={fromAddress}
            onChange={(event) => onFromAddressChange(event.target.value)}
            placeholder="Vilnius, Gedimino pr. 1"
          />
        </label>

        <label>
          <input
            style ={{fontSize: "0.88rem" , padding: "0.5rem"}}
            value={toAddress}
            onChange={(event) => onToAddressChange(event.target.value)}
            placeholder="Kaunas, Laisves al. 96"
          />
        </label>

        <button style={{ fontSize: "0.88rem", padding: "0.5rem" }} type="button" onClick={onSubmit} disabled={loading}>
          {loading ? "Skaiciuojama..." : "Planuoti kelione"}
        </button>
        <br />
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {!route && !loading && !error ? (
        <p className="empty-state">
          Iveskite du adresus ir gaukite marsruta su rizikos ivertinimu.
        </p>
      ) : null}

      {route ? (
        <div className="route-results-scroll">
          <div className="route-results">
          <article className="route-summary-card">
            <div className="activity-head">
              <strong>{formatDistance(route.route.distance_m)}</strong>
              <span
                className="risk-pill"
                style={{ backgroundColor: riskColor(route.summary.risk_level) }}
              >
                {route.summary.risk_level}
              </span>
            </div>
            <small>{formatDuration(route.route.duration_s)}</small>
            <p>{route.summary.risk_summary}</p>
            <small>Veiksmas: {route.summary.recommended_action}</small>
          </article>

          <article
            className="route-endpoint-card"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}
          >
            <div style={{ textAlign: "left" }}>
              <strong>Nuo: </strong>
              <small>{route.origin.address}</small>
            </div>

            <div style={{ textAlign: "right" }}>
              <strong>Iki: </strong>
              <small>{route.destination.address}</small>
            </div>
          </article>

          <div className="activity-list">
            {visibleSteps.map((segment, index) => (
                <article className="activity-card" key={segment.id}>
                  <div className="activity-head">
                    <strong>{index + 1}. {segment.instruction ?? `Zingsnis ${index + 1}`}</strong>
                    <span
                      className="risk-pill"
                      style={{ backgroundColor: riskColor(segment.risk_level) }}
                    >
                      {segment.risk_level}
                    </span>
                  </div>
                  <small style={{ display: "block", marginTop: "0.25rem" }}>
                    {formatDistance(segment.distance_m)} • {formatDuration(segment.duration_s)}
                  </small>
                  <small style={{ display: "block", marginTop: "0.04rem" }}>
                    {segment.risk_summary}
                  </small>
                  <small style={{ display: "block", marginTop: "0.04em" }}>
                    Priezastys: {segment.risk_reasons.join(", ") || "Nera"}
                  </small>
                </article>
              ))}
            {hiddenStepCount > 0 ? (
              <p className="empty-state">
                Rodyti pirmi {visibleSteps.length} zingsniu. Dar yra {hiddenStepCount} zingsniu.
              </p>
            ) : null}
          </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatDistance(distanceM: number): string {
  return distanceM >= 1000
    ? `${(distanceM / 1000).toFixed(1)} km`
    : `${Math.round(distanceM)} m`;
}

function formatDuration(durationS: number): string {
  const hours = Math.floor(durationS / 3600);
  const minutes = Math.round((durationS % 3600) / 60);

  if (hours > 0) {
    return `${hours} val. ${minutes} min.`;
  }

  return `${minutes} min.`;
}

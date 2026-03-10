import { riskColor } from "@argcis/shared";
import type { ExerciseActivity, ExerciseScenario } from "@argcis/shared";

interface ActivityPanelProps {
  scenarios: ExerciseScenario[];
  activities: ExerciseActivity[];
}

export function ActivityPanel({ scenarios, activities }: ActivityPanelProps) {
  const isEmpty = scenarios.length === 0 && activities.length === 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Pratybu planavimas</p>
          <h2>Scenarijai ir veiklos</h2>
        </div>
      </div>

      {isEmpty ? (
        <p className="empty-state">
          Pratybu geometriju ir veiklu siuo metu nera.
        </p>
      ) : null}

      <div className="scenario-list">
        {scenarios.map((scenario) => (
          <article className="scenario-card" key={scenario.id}>
            <strong>{scenario.name}</strong>
            <small>{scenario.description ?? "Be apraso"}</small>
          </article>
        ))}
      </div>

      <div className="activity-list">
        {activities.map((activity) => (
          <article className="activity-card" key={activity.id}>
            <div className="activity-head">
              <strong>{activity.name}</strong>
              <span
                className="risk-pill"
                style={{ backgroundColor: riskColor(activity.risk_level) }}
              >
                {activity.risk_level}
              </span>
            </div>
            <small>{activity.activity_type}</small>
            <p>{activity.risk_summary}</p>
            <small>Veiksmas: {activity.recommended_action}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

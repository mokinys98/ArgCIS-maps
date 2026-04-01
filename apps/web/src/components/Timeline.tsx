interface TimelineProps {
  availableTimes: string[];
  selectedTime: string;
  isPlaying: boolean;
  onChange(value: string): void;
  onStep(direction: -1 | 1): void;
  onTogglePlayback(): void;
}

export function Timeline({
  availableTimes,
  selectedTime,
  isPlaying,
  onChange,
  onStep,
  onTogglePlayback
}: TimelineProps) {
  const selectedIndex = Math.max(availableTimes.indexOf(selectedTime), 0);
  const selectedLabel = new Date(selectedTime).toLocaleString();
  const timelineStartLabel = availableTimes[0]
    ? new Date(availableTimes[0]).toLocaleString()
    : "--";
  const timelineEndLabel = availableTimes.at(-1)
    ? new Date(availableTimes.at(-1)!).toLocaleString()
    : "--";

  return (
    <section className="panel timeline-panel">
      <div className="timeline-controls">
        <div>
          <p className="eyebrow">Forecast animacija</p>
          <h2>24 valandu laiko juosta: kas 1 valanda.</h2>
        </div>
        <div aria-label="Laiko juostos valdymas" className="timeline-transport" role="group">
          <button
            aria-label="Ankstesnis kadras"
            className="transport-button secondary"
            onClick={() => onStep(-1)}
            type="button"
          >
            {"<<"}
          </button>
          <button
            aria-label={isPlaying ? "Pauze" : "Grojimas"}
            className="transport-button play"
            onClick={onTogglePlayback}
            type="button"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            aria-label="Kitas kadras"
            className="transport-button secondary"
            onClick={() => onStep(1)}
            type="button"
          >
            {">>"}
          </button>
        </div>
      </div>

      <div className="timeline-slider-wrap">
        <input
          className="timeline-range"
          type="range"
          min={0}
          max={Math.max(availableTimes.length - 1, 0)}
          value={selectedIndex}
          onChange={(event) => onChange(availableTimes[Number(event.target.value)] ?? selectedTime)}
        />

        <div className="timeline-scale">
          <span>{timelineStartLabel}</span>
          <span>{timelineEndLabel}</span>
        </div>
      </div>

      <div className="timeline-meta">
        <div className="timeline-current">
          <strong>{selectedLabel}</strong>
          <span>{selectedIndex + 1} / {availableTimes.length || 1}</span>
        </div>
        <div className="timeline-badges">
          <span className="timeline-phase active">Forecast langas: 24 val.</span>
          <span className="timeline-phase">Rezoliucija: kas 1 val.</span>
        </div>
      </div>
    </section>
  );
}

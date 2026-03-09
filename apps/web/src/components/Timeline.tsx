interface TimelineProps {
  availableTimes: string[];
  selectedTime: string;
  isPlaying: boolean;
  onChange(value: string): void;
  onTogglePlayback(): void;
}

export function Timeline({
  availableTimes,
  selectedTime,
  isPlaying,
  onChange,
  onTogglePlayback
}: TimelineProps) {
  const selectedIndex = Math.max(availableTimes.indexOf(selectedTime), 0);

  return (
    <section className="panel timeline-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Forecast animacija</p>
          <h2>7 dienu laiko juosta</h2>
        </div>
        <button onClick={onTogglePlayback} type="button">
          {isPlaying ? "Pause" : "Play"}
        </button>
      </div>

      <input
        className="timeline-range"
        type="range"
        min={0}
        max={Math.max(availableTimes.length - 1, 0)}
        value={selectedIndex}
        onChange={(event) => onChange(availableTimes[Number(event.target.value)] ?? selectedTime)}
      />

      <div className="timeline-meta">
        <strong>{new Date(selectedTime).toLocaleString()}</strong>
        <span>{selectedIndex + 1} / {availableTimes.length || 1}</span>
      </div>
    </section>
  );
}

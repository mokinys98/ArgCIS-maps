import type { LayerDefinition, SavedMap } from "@argcis/shared";

export interface LayerState {
  visible: boolean;
}

interface LayerPanelProps {
  layers: LayerDefinition[];
  layerState: Record<string, LayerState>;
  savedMaps: SavedMap[];
  draftName: string;
  onDraftNameChange(value: string): void;
  onToggle(layerId: string): void;
  onSavePreset(): void;
  onApplySavedMap(savedMap: SavedMap): void;
}

export function LayerPanel({
  layers,
  layerState,
  savedMaps,
  draftName,
  onDraftNameChange,
  onToggle,
  onSavePreset,
  onApplySavedMap
}: LayerPanelProps) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Layer katalogas</p>
          <h2>Aktyvus vaizdas</h2>
        </div>
      </div>

      <div className="layer-list">
        {layers.map((layer) => {
          const current = layerState[layer.id];
          return (
            <article className="layer-card" key={layer.id}>
              <label className="layer-toggle">
                <input
                  type="checkbox"
                  checked={current?.visible ?? false}
                  onChange={() => onToggle(layer.id)}
                />
                <span>
                  <strong>{layer.name}</strong>
                  <small>{layer.description}</small>
                </span>
              </label>
            </article>
          );
        })}
      </div>

      <div className="preset-block">
        <div className="preset-form">
          <input
            value={draftName}
            onChange={(event) => onDraftNameChange(event.target.value)}
            placeholder="Pavadinkite preset'a"
          />
          <button onClick={onSavePreset} type="button">
            Issaugoti
          </button>
        </div>

        <div className="saved-list">
          {savedMaps.map((savedMap) => (
            <button
              className="saved-item"
              key={savedMap.id}
              onClick={() => onApplySavedMap(savedMap)}
              type="button"
            >
              <strong>{savedMap.name}</strong>
              <small>{savedMap.description ?? "Be apraso"}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

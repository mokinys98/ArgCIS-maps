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
  savedMaps: _savedMaps,
  draftName: _draftName,
  onDraftNameChange: _onDraftNameChange,
  onToggle,
  onSavePreset: _onSavePreset,
  onApplySavedMap: _onApplySavedMap
}: LayerPanelProps) {
  const visibleLayers = layers.filter(
    (layer) =>
      layer.id !== "road-alerts" &&
      layer.id !== "exercise-areas" &&
      layer.id !== "activity-risk"
  );

  return (
    <section className="panel layer-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Layer katalogas</p>
          <h2>Aktyvus vaizdas</h2>
        </div>
      </div>

      <div className="layer-panel-scroll">
        <div className="layer-list">
          {visibleLayers.map((layer) => {
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
                  </span>
                </label>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

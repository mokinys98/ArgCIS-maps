import type {
  ExerciseActivity,
  ExerciseScenario,
  LayerDefinition,
  MapFrameResponse,
  MapHexResponse,
  SavedMap
} from "@argcis/shared";
import {
  demoFrame,
  demoLayerCatalog,
  demoTimeline,
  findClosestForecastTime,
  floorToForecastHour
} from "@argcis/shared";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useState,
  useDeferredValue
} from "react";
import { ActivityPanel } from "./components/ActivityPanel";
import { LayerPanel, type LayerState } from "./components/LayerPanel";
import { LoginScreen } from "./components/LoginScreen";
import { MapCanvas } from "./components/MapCanvas";
import { Timeline } from "./components/Timeline";
import { api } from "./lib/api";
import { demoMode, supabase } from "./lib/auth";

function buildInitialLayerState(layers: LayerDefinition[]): Record<string, LayerState> {
  return Object.fromEntries(
    layers.map((layer) => [
      layer.id,
      {
        visible: layer.default_visible
      }
    ])
  );
}

export default function App() {
  const TIMELINE_API_DELAY_MS = 350;
  const PLAYBACK_INTERVAL_MS = 1000;
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<LayerDefinition[]>(demoLayerCatalog().layers);
  const [layerState, setLayerState] = useState<Record<string, LayerState>>(
    buildInitialLayerState(demoLayerCatalog().layers)
  );
  const [selectedTime, setSelectedTime] = useState(
    floorToForecastHour(new Date())
  );
  const [requestedTime, setRequestedTime] = useState(
    floorToForecastHour(new Date())
  );
  const [frame, setFrame] = useState<MapFrameResponse | null>(null);
  const [hex, setHex] = useState<MapHexResponse | null>(null);
  const [savedMaps, setSavedMaps] = useState<SavedMap[]>([]);
  const [scenarios, setScenarios] = useState<ExerciseScenario[]>([]);
  const [activities, setActivities] = useState<ExerciseActivity[]>([]);
  const [bbox, setBbox] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [uiError, setUiError] = useState<string | null>(null);

  const visibleLayerIds = layers
    .filter((layer) => layerState[layer.id]?.visible)
    .map((layer) => layer.id);
  const deferredLayerKey = useDeferredValue(visibleLayerIds.join(","));

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setRequestedTime(selectedTime);
    }, TIMELINE_API_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedTime]);

  useEffect(() => {
    if (demoMode || !supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSessionToken(data.session?.access_token ?? null);
      setLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionToken(session?.access_token ?? null);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!demoMode && !sessionToken) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      api.getLayerCatalog(sessionToken),
      api.getSavedMaps(sessionToken),
      api.getExercises(sessionToken)
    ])
      .then(([catalog, presets, exerciseScenarios]) => {
        if (cancelled) {
          return;
        }

        setLayers(catalog.layers);
        setLayerState((current) => ({
          ...buildInitialLayerState(catalog.layers),
          ...current
        }));
        setSavedMaps(presets);
        setScenarios(exerciseScenarios);
      })
      .catch((error) => {
        if (!cancelled) {
          setUiError(error instanceof Error ? error.message : "Nepavyko uzkrauti katalogo.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  useEffect(() => {
    if (!demoMode && !sessionToken) {
      return;
    }

    let cancelled = false;
    startTransition(() => {
      const requestedLayers = deferredLayerKey
        ? deferredLayerKey.split(",").filter(Boolean)
        : [];
      const shouldFetchHex =
        requestedLayers.includes("risk-hex") ||
        requestedLayers.includes("h3-grid-outline");

      Promise.all([
        api.getFrame(requestedTime, requestedLayers, sessionToken),
        shouldFetchHex ? api.getHex(requestedTime, bbox, sessionToken) : Promise.resolve(null),
        api.getActivities(requestedTime, sessionToken)
      ])
        .then(([frameResponse, hexResponse, activityResponse]) => {
          if (cancelled) {
            return;
          }

          const resolvedTime = frameResponse.available_times.includes(requestedTime)
            ? requestedTime
            : findClosestForecastTime(frameResponse.available_times, requestedTime);

          if (resolvedTime && resolvedTime !== requestedTime) {
            setSelectedTime(resolvedTime);
            setRequestedTime(resolvedTime);
            return;
          }

          setFrame(frameResponse);
          setHex(hexResponse);
          setActivities(activityResponse);
        })
        .catch((error) => {
          if (!cancelled) {
            setUiError(error instanceof Error ? error.message : "Nepavyko uzkrauti laiko kadro.");
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [sessionToken, requestedTime, deferredLayerKey, bbox]);

  const getNextTimelineTime = useEffectEvent((direction: -1 | 1, wrap = false) => {
    const timeline = frame?.available_times ?? demoTimeline();
    if (timeline.length === 0) {
      return null;
    }

    const currentIndex = timeline.indexOf(selectedTime);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    let nextIndex = safeIndex + direction;

    if (wrap) {
      if (nextIndex < 0) {
        nextIndex = timeline.length - 1;
      }

      if (nextIndex >= timeline.length) {
        nextIndex = 0;
      }
    } else {
      nextIndex = Math.min(Math.max(nextIndex, 0), timeline.length - 1);
    }

    return timeline[nextIndex] ?? selectedTime;
  });

  const stepTimeline = useEffectEvent((direction: -1 | 1, wrap = false) => {
    const nextTime = getNextTimelineTime(direction, wrap);
    if (!nextTime) {
      return null;
    }

    setSelectedTime(nextTime);
    return nextTime;
  });

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const intervalId = window.setInterval(() => {
      stepTimeline(1, true);
    }, PLAYBACK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isPlaying, stepTimeline]);

  async function handleLogin(email: string, password: string) {
    if (!supabase) {
      return;
    }

    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      setAuthError(error.message);
      return;
    }

    setSessionToken(data.session?.access_token ?? null);
  }

  function toggleLayer(layerId: string) {
    setLayerState((current) => ({
      ...current,
      [layerId]: {
        ...current[layerId],
        visible: !current[layerId]?.visible
      }
    }));
  }

  async function savePreset() {
    if (!draftName.trim()) {
      setUiError("Iveskite preset pavadinima.");
      return;
    }

    const saved = await api.saveMap(
      {
        name: draftName.trim(),
        active_time_utc: selectedTime,
        layers: layers.map((layer, index) => ({
          layer_id: layer.id,
          ordering: index,
          visible: layerState[layer.id]?.visible ?? layer.default_visible,
          opacity: layer.default_opacity,
          filters: {},
          active_time_utc: selectedTime
        }))
      },
      sessionToken
    );

    setSavedMaps((current) => [saved, ...current]);
    setDraftName("");
  }

  function applySavedMap(savedMap: SavedMap) {
    setDraftName(savedMap.name);
    setSelectedTime(savedMap.active_time_utc ?? selectedTime);
    setLayerState((current) => {
      const next = { ...current };
      for (const layer of savedMap.layers) {
        next[layer.layer_id] = {
          visible: layer.visible
        };
      }
      return next;
    });
  }

  const activeTime = frame?.time ?? requestedTime;
  const frameLayers = frame?.layers ?? demoFrame(activeTime).layers;
  const availableTimes = frame?.available_times ?? demoTimeline();

  if (!demoMode && !sessionToken && !loading) {
    return <LoginScreen error={authError} onSubmit={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-panel">
          <p className="eyebrow">ArgCIS Maps</p>
          <h1>Meteorologiniu ir logistiniu riziku vaizdavimas viename zemelapyje</h1>
          <p className="muted">
            Forecast, keliu salygos, H3 risk sluoksnis ir pratybu veiklos.
          </p>
          <div className="status-row">
            <span className="status-pill">{demoMode ? "DEMO" : "AUTH"}</span>
            <span className="status-pill">{activeTime}</span>
          </div>
          {uiError ? <p className="error-text">{uiError}</p> : null}
        </div>

        <LayerPanel
          layers={layers}
          layerState={layerState}
          savedMaps={savedMaps}
          draftName={draftName}
          onDraftNameChange={setDraftName}
          onToggle={toggleLayer}
          onSavePreset={savePreset}
          onApplySavedMap={applySavedMap}
        />

        <ActivityPanel scenarios={scenarios} activities={activities} />
      </aside>

      <main className="workspace">
        <Timeline
          availableTimes={availableTimes}
          selectedTime={selectedTime}
          isPlaying={isPlaying}
          onChange={setSelectedTime}
          onStep={(direction) => stepTimeline(direction)}
          onTogglePlayback={() => setIsPlaying((current) => !current)}
        />
        <MapCanvas
          layers={layers}
          frameLayers={frameLayers}
          hex={hex}
          layerState={layerState}
          onBoundsChange={setBbox}
        />
      </main>
    </div>
  );
}

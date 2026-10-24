import { exportFrameEngineLabel } from "../../core/exporter/frame-backend";
import {
  applyExportDialogSize,
  EXPORT_FPS_PRESETS,
  EXPORT_SIZE_PRESETS,
  type ExportDialogState,
} from "../../core/exporter/dialog";

interface Props {
  state: ExportDialogState;
  onCancel: () => void;
  onClose: () => void;
  onChange?: (next: ExportDialogState) => void;
  onStart?: () => void;
}

export function ExportDialog({ state, onCancel, onClose, onChange, onStart }: Props) {
  if (!state.open) return null;
  const running = state.phase === "running";
  const ready = state.phase === "ready";
  const dismiss = running ? onCancel : onClose;
  return (
    <div className="export-dialog-layer" data-testid="export-dialog">
      <div
        className="export-dialog"
        data-phase={state.phase}
        role="dialog"
        aria-modal="false"
        aria-label="Export"
      >
        <header className="export-dialog-head">
          <h2>Export</h2>
          <button
            type="button"
            className="export-dialog-x"
            data-testid="export-dialog-x"
            aria-label={running ? "Abbrechen" : "Schließen"}
            onClick={dismiss}
          >
            ×
          </button>
        </header>
        <p className="export-dialog-file" data-testid="export-dialog-file">
          {state.fileName || "export.mp4"}
        </p>
        <p className="export-dialog-engine" data-testid="export-frame-engine">
          Frame Engine: {exportFrameEngineLabel()}
        </p>
        {ready ? (
          <div className="export-dialog-presets" data-testid="export-dialog-presets">
            <div className="export-dialog-preset-row">
              {EXPORT_SIZE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`export-size-${p.id}`}
                  className={state.width === p.width && state.height === p.height ? "active" : undefined}
                  onClick={() => onChange?.(applyExportDialogSize(state, { width: p.width, height: p.height }))}
                >
                  {p.id}
                </button>
              ))}
            </div>
            <div className="export-dialog-preset-row">
              {EXPORT_FPS_PRESETS.map((fps) => (
                <button
                  key={fps}
                  type="button"
                  data-testid={`export-fps-${fps}`}
                  className={state.fps === fps ? "active" : undefined}
                  onClick={() => onChange?.(applyExportDialogSize(state, { fps }))}
                >
                  {fps} fps
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <p className="export-dialog-meta" data-testid="export-dialog-meta">
          {state.width}×{state.height} · {state.fps} fps
        </p>
        {ready ? null : (
          <div className="export-dialog-bar" aria-hidden="true">
            <div
              className="export-dialog-bar-fill"
              data-testid="export-dialog-bar"
              style={{ width: `${Math.max(0, Math.min(100, state.percent))}%` }}
            />
          </div>
        )}
        <p
          className="export-dialog-status"
          data-testid="export-dialog-status"
          data-export-fail-dump={state.phase === "failed" ? "1" : undefined}
        >
          {state.phase === "done"
            ? `Fertig — ${state.fileName}`
            : state.phase === "aborted"
              ? "Abgebrochen"
              : state.phase === "failed"
                ? (state.error ?? "Export failed")
                : state.phase === "ready"
                  ? "Größe wählen, dann Export"
                  : `${state.percent}% · ${state.stage}`}
        </p>
        <footer className="export-dialog-actions">
          {running ? (
            <button type="button" data-testid="export-cancel" onClick={onCancel}>
              Abbrechen
            </button>
          ) : ready ? (
            <button type="button" className="primary" data-testid="export-start" onClick={onStart}>
              Export
            </button>
          ) : (
            <button type="button" className="primary" data-testid="export-close" onClick={onClose}>
              Schließen
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

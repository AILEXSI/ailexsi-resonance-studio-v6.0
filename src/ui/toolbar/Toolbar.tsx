import type { ProductionScreen } from "../../app/screens";
import { AILEXSI_PRODUCT_VERSION } from "../../core/build-info";
import { ScreenNav } from "../screens/ScreenNav";

interface Props {
  exporting: boolean;
  screen?: ProductionScreen;
  onSelectScreen?: (screen: ProductionScreen) => void;
  onToggleFile?: () => void;
  filePanelOpen?: boolean;
  onImport: () => void;
  onExport: () => void;
  projectName?: string;
  onRenameProject?: (name: string) => void;
  projectDirty?: boolean;
  directorEnabled?: boolean;
  onToggleDirector?: () => void;
}

export function Toolbar({
  exporting,
  screen = "arrange",
  onSelectScreen,
  onToggleFile,
  filePanelOpen = false,
  onImport,
  onExport,
  projectName = "Untitled Resonance",
  onRenameProject,
  projectDirty = false,
  directorEnabled = false,
  onToggleDirector,
}: Props) {
  return (
    <header className="toolbar" data-testid="toolbar">
      <div className="toolbar-group" data-group="file">
        <button
          type="button"
          data-testid="toolbar-file"
          aria-pressed={filePanelOpen}
          aria-expanded={filePanelOpen}
          onClick={() => onToggleFile?.()}
        >
          File
        </button>
        <div className="toolbar-file-row">
        <button type="button" onClick={onImport}>
          Import
        </button>
        <button
          type="button"
          className="primary"
          data-testid="export-btn"
          onClick={onExport}
          disabled={exporting}
        >
          Export
        </button>
        <ScreenNav screen={screen} onSelect={onSelectScreen ?? (() => {})} />
        <button
          type="button"
          data-testid="toolbar-ai"
          className={directorEnabled ? "active" : undefined}
          aria-pressed={directorEnabled}
          onClick={() => onToggleDirector?.()}
        >
          AI
        </button>
        </div>
      </div>
      <div className="toolbar-brand">
        <input
          className="project-name"
          data-testid="project-name"
          aria-label="Project name"
          key={projectName}
          defaultValue={projectName}
          onBlur={(e) => onRenameProject?.(e.target.value)}
        />
        {projectDirty ? (
          <span
            className="project-dirty"
            data-testid="project-dirty"
            aria-label="Unsaved changes"
            title="Unsaved changes"
          >
            *
          </span>
        ) : null}
        <span className="version" data-testid="app-version">V{AILEXSI_PRODUCT_VERSION}</span>
      </div>
    </header>
  );
}

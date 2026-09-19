import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { kindOfTrack, trackById, type Project, type TrackId } from "../../core/models";

function blurChrome(target: EventTarget | null): void {
  if (target instanceof HTMLElement) target.blur();
}
import { arrangeRows } from "../../core/track-groups";
import {
  clampLinearVolume,
  dbToFader,
  dbToLinear,
  faderToDb,
  formatDb,
  formatPan,
  linearToDb,
  meterHeightPct,
  peakToDb,
} from "../../core/volume";
import {
  automationValueAt,
  volumeAutomationIsActive,
  volumeAutomationOf,
} from "../../core/volume-automation";

export type MixPeaks = { master: number } & Record<string, number>;

/** Trackpad X, shift+wheel, or vertical wheel all pan the channel strip row. */
export function mixerChannelPanDelta(e: { deltaX: number; deltaY: number; shiftKey?: boolean }): number {
  const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  if (e.shiftKey || horiz) return horiz ? e.deltaX : e.deltaY;
  return e.deltaY;
}

interface Props {
  project: Project;
  selectedTrackId: TrackId;
  selectedTrackIds?: readonly TrackId[];
  peaks: MixPeaks;
  collapsed?: boolean;
  /** Director Focus: hide channel strips, keep Master. UI-only — not mixerCollapsed prefs. */
  masterOnly?: boolean;
  onToggleCollapsed?: () => void;
  onResizePointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onSelectTrack: (id: TrackId, opts?: { toggle?: boolean }) => void;
  onVolume: (id: TrackId, linear: number) => void;
  onMasterVolume: (linear: number) => void;
  onToggleMute: (id: TrackId) => void;
  onToggleSolo: (id: TrackId) => void;
  onPan?: (id: TrackId, pan: number) => void;
  collapsedGroupIds?: readonly string[];
  onToggleGroupCollapsed?: (groupId: string) => void;
  playing?: boolean;
  volumeWriteArmedIds?: readonly TrackId[];
  volumeWriteTrackId?: TrackId | null;
  volumeWriteValue?: number | null;
  onToggleVolumeWriteArm?: (id: TrackId) => void;
  onVolumeWritePointerUp?: () => void;
}

function Strip(props: {
  id: string;
  label: string;
  volume: number;
  muted?: boolean;
  solo?: boolean;
  pan?: number;
  selected?: boolean;
  peak: number;
  kind: "video" | "audio" | "master";
  effectiveVolume?: number;
  automationActive?: boolean;
  writeArmed?: boolean;
  writeActive?: boolean;
  writeValue?: number;
  onSelect?: (opts?: { toggle?: boolean }) => void;
  onVolume: (linear: number) => void;
  onPan?: (pan: number) => void;
  onMute?: () => void;
  onSolo?: () => void;
  onToggleWrite?: () => void;
  onVolumeWritePointerUp?: () => void;
}) {
  const displayVolume = props.writeActive && props.writeValue != null ? props.writeValue : props.volume;
  const pos = dbToFader(linearToDb(displayVolume));
  const dbLabel = formatDb(linearToDb(props.writeActive && props.writeValue != null ? props.writeValue : props.volume));
  const meterDb = formatDb(peakToDb(props.peak));
  const showAuto = props.automationActive === true && props.effectiveVolume != null;
  const autoPos = showAuto ? dbToFader(linearToDb(props.effectiveVolume!)) : pos;
  const autoLabel = showAuto ? formatDb(linearToDb(props.effectiveVolume!)) : null;
  return (
    <div
      className={`mix-strip ${props.kind}${props.selected ? " selected" : ""}${props.muted ? " muted" : ""}${props.solo ? " soloed" : ""}${props.automationActive ? " auto-read" : ""}${props.writeArmed ? " write-armed" : ""}${props.writeActive ? " write-active" : ""}`}
      data-testid={`mix-${props.id}`}
      data-write-armed={props.writeArmed ? "true" : "false"}
      data-write-active={props.writeActive ? "true" : "false"}
      onClick={(e) => props.onSelect?.({ toggle: e.ctrlKey || e.metaKey })}
    >
      <div className="mix-name">{props.label}</div>
      <div className="mix-meter" aria-hidden="true">
        <div className="mix-meter-fill" style={{ height: `${meterHeightPct(props.peak)}%` }} />
      </div>
      {props.kind !== "master" ? (
        <>
          <input
            type="range"
            className="mix-pan"
            min={-1}
            max={1}
            step={0.01}
            value={props.pan ?? 0}
            aria-label={`${props.label} pan`}
            title={formatPan(props.pan ?? 0)}
            data-testid={`mix-pan-${props.id}`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => props.onPan?.(Number(e.target.value))}
          />
          <div className="mix-pan-label" data-testid={`mix-pan-label-${props.id}`}>
            {formatPan(props.pan ?? 0)}
          </div>
        </>
      ) : null}
      <div className="mix-fader-wrap">
        {showAuto ? (
          <span
            className="mix-auto-ghost"
            data-testid={`mix-auto-ghost-${props.id}`}
            style={{ bottom: `${autoPos * 100}%` }}
            title={`Automation ${autoLabel}`}
          />
        ) : null}
        <input
          type="range"
          className="mix-fader"
          min={0}
          max={1}
          step={0.005}
          value={pos}
          aria-label={`${props.label} volume`}
          title={dbLabel}
          data-testid={`mix-fader-${props.id}`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            e.stopPropagation();
            blurChrome(e.currentTarget);
          }}
          onPointerUp={(e) => {
            props.onVolumeWritePointerUp?.();
            blurChrome(e.currentTarget);
          }}
          onKeyDown={(e) => {
            if (e.code === "Space" || e.key === " ") e.preventDefault();
          }}
          onChange={(e) => props.onVolume(dbToLinear(faderToDb(Number(e.target.value))))}
        />
      </div>
      <div className="mix-db" data-testid={`mix-db-${props.id}`}>
        {dbLabel}
      </div>
      {autoLabel ? (
        <div className="mix-auto-db" data-testid={`mix-auto-db-${props.id}`}>
          {autoLabel}
        </div>
      ) : null}
      <div className="mix-peak">{meterDb}</div>
      {props.onMute ? (
        <div className="mix-ms">
          <button
            type="button"
            className={props.muted ? "active mute-btn" : "mute-btn"}
            title={props.muted ? `Unmute ${props.label}` : `Mute ${props.label}`}
            data-testid={`mix-mute-${props.id}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onMute?.();
              blurChrome(e.currentTarget);
            }}
          >
            M
          </button>
          {props.onSolo ? (
            <button
              type="button"
              className={props.solo ? "active solo-btn" : "solo-btn"}
              title={props.solo ? `Unsolo ${props.label}` : `Solo ${props.label}`}
              data-testid={`mix-solo-${props.id}`}
              onClick={(e) => {
                e.stopPropagation();
                props.onSolo?.();
                blurChrome(e.currentTarget);
              }}
            >
              S
            </button>
          ) : null}
          {props.onToggleWrite ? (
            <button
              type="button"
              className={props.writeArmed ? "active write-arm-btn" : "write-arm-btn"}
              title={props.writeArmed ? `Disarm write ${props.label}` : `Arm write ${props.label}`}
              aria-label={props.writeArmed ? `Disarm volume write ${props.label}` : `Arm volume write ${props.label}`}
              aria-pressed={props.writeArmed ? true : false}
              data-testid={`mix-write-${props.id}`}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleWrite?.();
                blurChrome(e.currentTarget);
              }}
            >
              W
            </button>
          ) : null}
        </div>
      ) : (
        <span className="mix-master-tag">MST</span>
      )}
    </div>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {collapsed ? (
        <path d="M4 2 L9 6 L4 10" fill="none" stroke="currentColor" strokeWidth="1.6" />
      ) : (
        <path d="M8 2 L3 6 L8 10" fill="none" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  );
}

export function Mixer({
  project,
  selectedTrackId,
  selectedTrackIds,
  peaks,
  collapsed = false,
  masterOnly = false,
  onToggleCollapsed,
  onResizePointerDown,
  onSelectTrack,
  onVolume,
  onMasterVolume,
  onToggleMute,
  onToggleSolo,
  onPan,
  collapsedGroupIds,
  onToggleGroupCollapsed,
  playing = false,
  volumeWriteArmedIds,
  volumeWriteTrackId,
  volumeWriteValue,
  onToggleVolumeWriteArm,
  onVolumeWritePointerUp,
}: Props) {
  const rows = arrangeRows(project, { collapsedGroupIds });
  const channelScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = channelScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const delta = mixerChannelPanDelta(e);
      if (delta === 0) return;
      e.preventDefault();
      e.stopPropagation();
      el.scrollLeft += delta;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [collapsed, masterOnly, rows.length]);
  const hideChannels = collapsed || masterOnly;
  return (
    <aside
      className={`mixer${collapsed ? " collapsed" : ""}${masterOnly ? " master-only" : ""}`}
      data-testid="mixer"
      data-collapsed={collapsed ? "true" : "false"}
      data-master-only={masterOnly ? "true" : "false"}
      data-playing={playing ? "true" : "false"}
    >
      {hideChannels || !onResizePointerDown ? null : (
        <div
          className="mixer-resize"
          data-testid="mixer-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Mixerbreite"
          title="Mixer breiter / schmaler"
          style={{ cursor: "col-resize" }}
          onPointerDown={onResizePointerDown}
        />
      )}
      <div className="mixer-chrome">
        <button
          type="button"
          className="mixer-collapse"
          data-testid="mixer-collapse"
          aria-expanded={!collapsed}
          aria-controls="mixer-channels"
          title={collapsed ? "Kanäle ausklappen" : "Kanäle einklappen — nur Master"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapsed?.();
          }}
        >
          <CollapseIcon collapsed={collapsed} />
        </button>
        {collapsed ? null : <span className="mixer-chrome-label">Mix</span>}
      </div>
      <div className="mixer-strips" id="mixer-channels" data-testid="mixer-channels">
        {hideChannels ? null : (
          <div
            ref={channelScrollRef}
            className="mixer-channel-scroll"
            data-testid="mixer-channel-scroll"
            style={{ overflowX: "scroll", overflowY: "hidden" }}
          >
            {rows.map((row) => {
              if (row.kind === "group") {
                return (
                  <div
                    key={`group:${row.group.id}`}
                    className={`mix-strip group${row.collapsed ? " collapsed" : ""}`}
                    data-testid={`mix-group-${row.group.id}`}
                    data-collapsed={row.collapsed ? "true" : "false"}
                    title={row.group.name}
                  >
                    <button
                      type="button"
                      className="mix-group-collapse"
                      data-testid={`mix-group-collapse-${row.group.id}`}
                      title={row.collapsed ? "Expand group" : "Collapse group"}
                      aria-expanded={!row.collapsed}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleGroupCollapsed?.(row.group.id);
                      }}
                    >
                      <CollapseIcon collapsed={row.collapsed} />
                    </button>
                    <div className="mix-name">{row.group.name}</div>
                    <span className="mix-group-count">{row.memberIds.length}</span>
                  </div>
                );
              }
              const id = row.trackId;
              const track = trackById(project, id);
              if (!track) return null;
              const selectedSet = new Set(
                selectedTrackIds && selectedTrackIds.length > 0 ? selectedTrackIds : [selectedTrackId],
              );
              const auto = volumeAutomationOf(track);
              const autoActive = volumeAutomationIsActive(auto);
              const writeArmed = track.kind === "audio" && (volumeWriteArmedIds?.includes(id) ?? false);
              const writeActive = writeArmed && volumeWriteTrackId === id && volumeWriteValue != null;
              const effective = autoActive
                ? clampLinearVolume((track.volume ?? 1) * automationValueAt(auto, project.playheadMs))
                : undefined;
              return (
                <Strip
                  key={id}
                  id={id}
                  label={track.name || id}
                  kind={track.kind === "audio" ? "audio" : kindOfTrack(id)}
                  volume={track.volume ?? 1}
                  pan={track.pan ?? 0}
                  muted={track.muted === true}
                  solo={track.solo === true}
                  selected={selectedSet.has(id)}
                  peak={peaks[id] ?? 0}
                  automationActive={autoActive}
                  effectiveVolume={effective}
                  writeArmed={writeArmed}
                  writeActive={writeActive}
                  writeValue={writeActive ? volumeWriteValue ?? undefined : undefined}
                  onSelect={(opts) => onSelectTrack(id, opts)}
                  onVolume={(v) => onVolume(id, v)}
                  onPan={onPan ? (p) => onPan(id, p) : undefined}
                  onMute={() => onToggleMute(id)}
                  onSolo={() => onToggleSolo(id)}
                  onToggleWrite={
                    track.kind === "audio" && onToggleVolumeWriteArm
                      ? () => onToggleVolumeWriteArm(id)
                      : undefined
                  }
                  onVolumeWritePointerUp={onVolumeWritePointerUp}
                />
              );
            })}
          </div>
        )}
        <Strip
          id="master"
          label="MST"
          kind="master"
          volume={project.masterVolume ?? 1}
          peak={peaks.master}
          onVolume={onMasterVolume}
        />
      </div>
    </aside>
  );
}

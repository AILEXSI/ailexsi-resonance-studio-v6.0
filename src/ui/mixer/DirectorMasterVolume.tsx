import { dbToFader, dbToLinear, faderToDb, formatDb, linearToDb } from "../../core/volume";

/**
 * One master fader for the full-height Director layout.
 * Same curve and callback as the mixer MST strip. No separate audio path.
 */
export function DirectorMasterVolume(props: { volume: number; onVolume: (linear: number) => void }) {
  const pos = dbToFader(linearToDb(props.volume));
  const dbLabel = formatDb(linearToDb(props.volume));
  return (
    <aside className="director-master" data-testid="director-master" aria-label="Master volume">
      <div className="mix-name">MST</div>
      <div className="mix-fader-wrap">
        <input
          type="range"
          className="mix-fader"
          min={0}
          max={1}
          step={0.005}
          value={pos}
          aria-label="Master volume"
          title={dbLabel}
          data-testid="director-master-volume"
          onChange={(e) => props.onVolume(dbToLinear(faderToDb(Number(e.target.value))))}
        />
      </div>
      <div className="mix-db" data-testid="director-master-db">
        {dbLabel}
      </div>
    </aside>
  );
}

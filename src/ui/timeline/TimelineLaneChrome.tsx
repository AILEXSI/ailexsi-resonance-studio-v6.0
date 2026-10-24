import { useEffect, useState } from "react";
import type { TrackId } from "../../core/models";

export function GroupCollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
      {collapsed ? (
        <path d="M4 2 L9 6 L4 10" fill="none" stroke="currentColor" strokeWidth="1.6" />
      ) : (
        <path d="M2 4 L6 9 L10 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  );
}

export function LaneGroupAssign({
  trackId,
  groupId,
  groups,
  onAssign,
  onCreate,
}: {
  trackId: TrackId;
  groupId?: string;
  groups: { id: string; name: string }[];
  onAssign: (trackIds: TrackId[], groupId: string | null) => void;
  onCreate?: (trackIds: TrackId[]) => void;
}) {
  return (
    <select
      className="lane-group-assign"
      data-testid={`lane-group-assign-${trackId}`}
      data-header-control="groupAssign"
      aria-label="Track group"
      title="Assign to chapter group"
      value={groupId ?? ""}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const value = e.target.value;
        if (value === "__new__") {
          onCreate?.([trackId]);
          return;
        }
        onAssign([trackId], value === "" ? null : value);
      }}
    >
      <option value="">—</option>
      {groups.map((group) => (
        <option key={group.id} value={group.id}>
          {group.name}
        </option>
      ))}
      <option value="__new__">New group…</option>
    </select>
  );
}

export function GroupNameField({
  groupId,
  name,
  onRename,
}: {
  groupId: string;
  name: string;
  onRename?: (groupId: string, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);
  if (!onRename || !editing) {
    return (
      <button
        type="button"
        className="lane-group-name"
        data-testid={`lane-group-name-${groupId}`}
        title="Rename group"
        onClick={(e) => {
          e.stopPropagation();
          if (!onRename) return;
          setDraft(name);
          setEditing(true);
        }}
      >
        {name}
      </button>
    );
  }
  return (
    <input
      className="lane-group-name-input"
      data-testid={`lane-group-name-input-${groupId}`}
      value={draft}
      autoFocus
      aria-label="Group name"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onRename(groupId, draft);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onRename(groupId, draft);
          setEditing(false);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setDraft(name);
          setEditing(false);
        }
      }}
    />
  );
}


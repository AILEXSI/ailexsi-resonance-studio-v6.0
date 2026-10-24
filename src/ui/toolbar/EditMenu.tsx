import { useState } from "react";
import type { EditorCommand } from "../../app/commands";
import { DEFAULT_FADE_MS } from "../../core/fades";
import { DEFAULT_CROSSFADE_MS } from "../../core/transition";
import { CLIP_MENU_SHORTCUTS } from "../shortcuts/labels";

type Item = {
  id: string;
  label: string;
  shortcut?: string;
  command: EditorCommand;
};

export const EDIT_MENU_ITEMS: Item[] = [
  { id: "copy", label: "Copy", shortcut: CLIP_MENU_SHORTCUTS.copy, command: { type: "copy" } },
  { id: "paste", label: "Paste", shortcut: CLIP_MENU_SHORTCUTS.paste, command: { type: "paste" } },
  { id: "duplicate", label: "Duplicate", shortcut: CLIP_MENU_SHORTCUTS.duplicate, command: { type: "duplicate" } },
  { id: "select-all", label: "Select all", shortcut: CLIP_MENU_SHORTCUTS.selectAll, command: { type: "selectAll" } },
  { id: "trim-in", label: "Trim in to playhead", shortcut: CLIP_MENU_SHORTCUTS.trimInToPlayhead, command: { type: "trimToPlayhead", edge: "in" } },
  { id: "trim-out", label: "Trim out to playhead", shortcut: CLIP_MENU_SHORTCUTS.trimOutToPlayhead, command: { type: "trimToPlayhead", edge: "out" } },
  { id: "ripple-trim-in", label: "Ripple trim in to playhead", shortcut: CLIP_MENU_SHORTCUTS.rippleTrimInToPlayhead, command: { type: "rippleTrimToPlayhead", edge: "in" } },
  { id: "ripple-trim-out", label: "Ripple trim out to playhead", shortcut: CLIP_MENU_SHORTCUTS.rippleTrimOutToPlayhead, command: { type: "rippleTrimToPlayhead", edge: "out" } },
  { id: "fade-in", label: "Fade in", shortcut: CLIP_MENU_SHORTCUTS.fadeIn, command: { type: "setSelectionFades", fadeInMs: DEFAULT_FADE_MS } },
  { id: "fade-out", label: "Fade out", shortcut: CLIP_MENU_SHORTCUTS.fadeOut, command: { type: "setSelectionFades", fadeOutMs: DEFAULT_FADE_MS } },
  { id: "crossfade", label: "Crossfade", shortcut: CLIP_MENU_SHORTCUTS.crossfade, command: { type: "addCrossfade", durationMs: DEFAULT_CROSSFADE_MS } },
  { id: "ripple-delete", label: "Ripple delete", shortcut: CLIP_MENU_SHORTCUTS.rippleDelete, command: { type: "rippleDelete" } },
  { id: "lift-delete", label: "Lift delete", shortcut: CLIP_MENU_SHORTCUTS.delete, command: { type: "liftDelete" } },
];

export function EditMenu({ onCommand }: { onCommand: (command: EditorCommand) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="toolbar-edit">
      <button
        type="button"
        data-testid="toolbar-edit"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        Edit
      </button>
      {open ? (
        <div className="clip-menu edit-menu" data-testid="edit-menu" role="menu">
          {EDIT_MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-testid={`edit-menu-${item.id}`}
              onClick={() => {
                onCommand(item.command);
                setOpen(false);
              }}
            >
              <span>{item.label}</span>
              {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

import { useState } from "react";
import type { EditorCommand } from "../../app/commands";
import { CLIP_MENU_SHORTCUTS } from "../shortcuts/labels";

type Item = {
  id: string;
  label: string;
  shortcut?: string;
  command: EditorCommand;
};

const ITEMS: Item[] = [
  { id: "trim-in", label: "Trim in to playhead", shortcut: CLIP_MENU_SHORTCUTS.trimInToPlayhead, command: { type: "trimToPlayhead", edge: "in" } },
  { id: "trim-out", label: "Trim out to playhead", shortcut: CLIP_MENU_SHORTCUTS.trimOutToPlayhead, command: { type: "trimToPlayhead", edge: "out" } },
  { id: "ripple-trim-in", label: "Ripple trim in to playhead", shortcut: CLIP_MENU_SHORTCUTS.rippleTrimInToPlayhead, command: { type: "rippleTrimToPlayhead", edge: "in" } },
  { id: "ripple-trim-out", label: "Ripple trim out to playhead", shortcut: CLIP_MENU_SHORTCUTS.rippleTrimOutToPlayhead, command: { type: "rippleTrimToPlayhead", edge: "out" } },
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
          {ITEMS.map((item) => (
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

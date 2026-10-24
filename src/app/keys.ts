import { DEFAULT_FADE_MS } from "../core/fades";
import { firstClipIdWithLivingMate } from "../core/link";
import { FRAME_MS, projectDurationMs } from "../core/models";
import { DEFAULT_CROSSFADE_MS } from "../core/transition";
import { isSlideBlock } from "../core/timeline";
import { applyCommand, type EditorCommand } from "./commands";
import { applyPlayhead, selectionOf, volumeWriteArmTarget, type Session } from "./session";

export interface EditorKeyEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  /** True when focus is an input/textarea/select/contenteditable/spinbutton. */
  formFocus?: boolean;
  /** True when typing in a real text/number field. Space still plays on range/button. */
  textEditFocus?: boolean;
}

export type EditorKeyAction =
  | { type: "session"; session: Session; preventDefault?: boolean }
  | { type: "toggleShortcuts"; preventDefault: true }
  | { type: "cycleScreen"; dir: 1 | -1; preventDefault: true }
  | { type: "save"; preventDefault: true }
  | { type: "saveAs"; preventDefault: true }
  | { type: "none" };

function commandFromKey(
  e: EditorKeyEvent,
  session: Session,
): EditorCommand | "toggleShortcuts" | null {
  if (e.key === "?") return "toggleShortcuts";

  const mod = Boolean(e.ctrlKey || e.metaKey);
  const letter = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (e.code === "Space" || e.key === " ") return { type: "playPause" };

  if (mod) {
    if (letter === "z" && !e.shiftKey) return { type: "undo" };
    if (letter === "y" || (letter === "z" && e.shiftKey)) return { type: "redo" };
    if (letter === "c") return { type: "copy" };
    if (letter === "x") return { type: "cut" };
    if (letter === "v") return { type: "paste" };
    if (letter === "d") return { type: "duplicate" };
    if (letter === "a") return e.shiftKey ? { type: "selectAllOnTrack" } : { type: "selectAll" };
    if (letter === "l" && e.shiftKey) {
      const clipId = firstClipIdWithLivingMate(session.project, selectionOf(session));
      return clipId ? { type: "unlinkClips", clipId } : null;
    }
    return null;
  }

  const comma = e.key === "," || e.key === "<" || e.code === "Comma";
  const period = e.key === "." || e.key === ">" || e.code === "Period";
  if (e.altKey && (comma || period)) {
    if (!session.selectedClipId) return null;
    const deltaMs = (period ? 1 : -1) * FRAME_MS;
    if (e.shiftKey) {
      const ids = selectionOf(session);
      if (ids.length >= 2 && isSlideBlock(session.project, ids)) {
        return { type: "slideClip", clipId: session.selectedClipId ?? ids[0]!, clipIds: ids, deltaMs };
      }
      return { type: "slideClip", clipId: session.selectedClipId, deltaMs };
    }
    const ids = selectionOf(session);
    if (ids.length >= 2) {
      return { type: "slip", clipId: session.selectedClipId ?? ids[0]!, clipIds: ids, deltaMs };
    }
    return { type: "slip", clipId: session.selectedClipId, deltaMs };
  }

  if (e.altKey && !e.shiftKey && !mod) {
    if (e.code === "Digit1") return { type: "setSelectionRate", rate: 0.5 };
    if (e.code === "Digit2") return { type: "setSelectionRate", rate: 1 };
    if (e.code === "Digit3") return { type: "setSelectionRate", rate: 2 };
  }
  if (letter === "r") return e.shiftKey ? { type: "freezeFrame" } : { type: "toggleReverse" };
  if (!e.altKey && letter === "v") return { type: "addKeyframe" };
  if (letter === "s") return { type: "split" };
  if (letter === "g") return { type: "closeGap" };
  if (letter === "q") return { type: "rippleTrimToPlayhead", edge: "in" };
  if (e.key === "[" || e.code === "BracketLeft") return { type: "trimToPlayhead", edge: "in" };
  if (e.key === "]" || e.code === "BracketRight") return { type: "trimToPlayhead", edge: "out" };
  if (!e.altKey && letter === "f") {
    return e.shiftKey
      ? { type: "setSelectionFades", fadeOutMs: DEFAULT_FADE_MS }
      : { type: "setSelectionFades", fadeInMs: DEFAULT_FADE_MS };
  }
  if (!e.altKey && letter === "t") return { type: "addCrossfade", durationMs: DEFAULT_CROSSFADE_MS };
  if (letter === "w") {
    if (e.altKey) return { type: "rippleTrimToPlayhead", edge: "out" };
    if (e.shiftKey) return null;
    const trackId = volumeWriteArmTarget(session);
    return trackId ? { type: "toggleVolumeWriteArm", trackId } : null;
  }
  if (letter === "m") return { type: "addMarker" };
  if (letter === "x" || (letter === "i" && e.shiftKey)) return { type: "clearInOut" };
  if (letter === "i") return { type: "markIn" };
  if (letter === "o") return { type: "markOut" };
  if (letter === "j") return { type: "shuttle", dir: -1 };
  if (letter === "k") return { type: "shuttle", dir: 0 };
  if (letter === "l") return { type: "shuttle", dir: 1 };

  if (e.key === ";" || e.code === "Semicolon") return { type: "liftRange" };
  if (e.key === "'" || e.key === '"' || e.code === "Quote") return { type: "extractRange" };

  if (e.key === "Delete" || e.key === "Backspace") {
    return e.shiftKey ? { type: "rippleDelete" } : { type: "liftDelete" };
  }
  if (e.key === "ArrowLeft") return { type: "nudgePlayhead", deltaMs: -FRAME_MS };
  if (e.key === "ArrowRight") return { type: "nudgePlayhead", deltaMs: FRAME_MS };
  if (e.key === "ArrowDown") return { type: "gotoNextEdit" };
  if (e.key === "ArrowUp") return { type: "gotoPrevEdit" };

  if (comma || period) {
    const frames = e.shiftKey || e.key === "<" || e.key === ">" ? 10 : 1;
    return { type: "nudgeClip", deltaMs: (period ? 1 : -1) * frames * FRAME_MS };
  }
  return null;
}

/**
 * Editor key routing. Modifier chords run before bare letters.
 * Split is S (not V). Ctrl+S / Cmd+S saves. Ctrl+Shift+S save-as. Ctrl+V pastes. Ctrl+X cuts. Bare X clears IN/OUT.
 * Bare W arms volume write on the focused/selected audio track (no-op if none — never trims). Alt+W ripple-trims out.
 * Space play/pauses unless a real text field is focused (mixer fader / W / VOL do not swallow Space).
 * Home/End seek start/duration. Shift+Home/End seek IN/OUT (no-op if unset).
 * Shift+I still clears marks — do not steal I/O.
 * All mutations go through `applyCommand` except playhead seeks (`applyPlayhead`).
 */
export function isTransportSpaceKey(e: Pick<EditorKeyEvent, "key" | "code">): boolean {
  return e.code === "Space" || e.key === " ";
}

export function dispatchEditorKey(
  session: Session,
  _playing: boolean,
  e: EditorKeyEvent,
): EditorKeyAction {
  if (e.key === "Tab") {
    if (e.formFocus) return { type: "none" };
    return { type: "cycleScreen", dir: e.shiftKey ? -1 : 1, preventDefault: true };
  }
  const mod = Boolean(e.ctrlKey || e.metaKey);
  const saveLetter = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod && saveLetter === "s" && !e.shiftKey) {
    return { type: "save", preventDefault: true };
  }
  if (mod && saveLetter === "s" && e.shiftKey) {
    return { type: "saveAs", preventDefault: true };
  }
  if (e.formFocus) {
    const spaceOk = isTransportSpaceKey(e) && !e.textEditFocus && !mod;
    if (!spaceOk) return { type: "none" };
  }
  if (!mod && (e.key === "Home" || e.code === "Home")) {
    if (e.shiftKey) {
      if (session.project.inPointMs == null) return { type: "none" };
      return {
        type: "session",
        session: applyPlayhead(session, session.project.inPointMs),
        preventDefault: true,
      };
    }
    return { type: "session", session: applyPlayhead(session, 0), preventDefault: true };
  }
  if (!mod && (e.key === "End" || e.code === "End")) {
    if (e.shiftKey) {
      if (session.project.outPointMs == null) return { type: "none" };
      return {
        type: "session",
        session: applyPlayhead(session, session.project.outPointMs),
        preventDefault: true,
      };
    }
    return {
      type: "session",
      session: applyPlayhead(session, projectDurationMs(session.project)),
      preventDefault: true,
    };
  }
  const command = commandFromKey(e, session);
  if (!command) return { type: "none" };
  if (command === "toggleShortcuts") return { type: "toggleShortcuts", preventDefault: true };
  const preventDefault =
    command.type === "playPause" ||
    command.type === "undo" ||
    command.type === "redo" ||
    command.type === "copy" ||
    command.type === "cut" ||
    command.type === "paste" ||
    command.type === "duplicate" ||
    command.type === "clearInOut" ||
    command.type === "liftDelete" ||
    command.type === "rippleDelete" ||
    command.type === "nudgeClip" ||
    command.type === "shuttle" ||
    command.type === "slip" ||
    command.type === "slideClip" ||
    command.type === "liftRange" ||
    command.type === "extractRange" ||
    command.type === "unlinkClips" ||
    command.type === "gotoNextEdit" ||
    command.type === "gotoPrevEdit" ||
    command.type === "closeGap" ||
    command.type === "rippleTrimToPlayhead" ||
    command.type === "trimToPlayhead" ||
    command.type === "setSelectionFades" ||
    command.type === "addCrossfade" ||
    command.type === "setSelectionRate" ||
    command.type === "toggleReverse" ||
    command.type === "freezeFrame" ||
    command.type === "addKeyframe" ||
    command.type === "toggleVolumeWriteArm" ||
    command.type === "selectAll" ||
    command.type === "selectAllOnTrack";
  return {
    type: "session",
    session: applyCommand(session, command),
    preventDefault,
  };
}

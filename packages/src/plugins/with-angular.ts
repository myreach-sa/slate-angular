import {
  Editor,
  Node,
  Transforms,
  Range,
  Path,
  Operation,
  PathRef,
  Point,
} from "slate";
import {
  EDITOR_TO_ON_CHANGE,
  NODE_TO_KEY,
  isDOMText,
  getPlainText,
  Key,
  getSlateFragmentAttribute,
  EDITOR_TO_SCHEDULE_FLUSH,
  EDITOR_TO_PENDING_INSERTION_MARKS,
  EDITOR_TO_PENDING_DIFFS,
  EDITOR_TO_USER_MARKS,
  EDITOR_TO_KEY_TO_ELEMENT,
  EDITOR_TO_PENDING_ACTION,
  EDITOR_TO_PENDING_SELECTION,
  EDITOR_TO_USER_SELECTION,
} from "../utils";
import { AngularEditor } from "./angular-editor";
import { SlateError } from "../types/error";
import { findCurrentLineRange } from "../utils/lines";
import {
  transformTextDiff,
  TextDiff,
  transformPendingRange,
  transformPendingPoint,
} from "../utils/diff-text";

export const withAngular = <T extends Editor>(
  editor: T,
  clipboardFormatKey = "x-slate-fragment"
) => {
  const e = editor as T & AngularEditor;
  const { apply, onChange, deleteBackward, addMark, removeMark } = e;

  // The WeakMap which maps a key to a specific HTMLElement must be scoped to the editor instance to
  // avoid collisions between editors in the DOM that share the same value.
  EDITOR_TO_KEY_TO_ELEMENT.set(e, new WeakMap());

  e.addMark = (key, value) => {
    EDITOR_TO_SCHEDULE_FLUSH.get(e)?.();

    if (
      !EDITOR_TO_PENDING_INSERTION_MARKS.get(e) &&
      EDITOR_TO_PENDING_DIFFS.get(e)?.length
    ) {
      // Ensure the current pending diffs originating from changes before the addMark
      // are applied with the current formatting
      EDITOR_TO_PENDING_INSERTION_MARKS.set(e, null);
    }

    EDITOR_TO_USER_MARKS.delete(editor);

    addMark(key, value);
  };

  e.removeMark = (key) => {
    if (
      !EDITOR_TO_PENDING_INSERTION_MARKS.get(e) &&
      EDITOR_TO_PENDING_DIFFS.get(e)?.length
    ) {
      // Ensure the current pending diffs originating from changes before the addMark
      // are applied with the current formatting
      EDITOR_TO_PENDING_INSERTION_MARKS.set(e, null);
    }

    EDITOR_TO_USER_MARKS.delete(editor);

    removeMark(key);
  };

  e.deleteBackward = (unit) => {
    if (unit !== "line") {
      return deleteBackward(unit);
    }

    if (editor.selection && Range.isCollapsed(editor.selection)) {
      const parentBlockEntry = Editor.above(editor, {
        match: (n) => Editor.isBlock(editor, n),
        at: editor.selection,
      });

      if (parentBlockEntry) {
        const [, parentBlockPath] = parentBlockEntry;
        const parentElementRange = Editor.range(
          editor,
          parentBlockPath,
          editor.selection.anchor
        );

        const currentLineRange = findCurrentLineRange(e, parentElementRange);

        if (!Range.isCollapsed(currentLineRange)) {
          Transforms.delete(editor, { at: currentLineRange });
        }
      }
    }
  };

  // This attempts to reset the NODE_TO_KEY entry to the correct value
  // as apply() changes the object reference and hence invalidates the NODE_TO_KEY entry
  e.apply = (op: Operation) => {
    const matches: [Path, Key][] = [];

    const pendingDiffs = EDITOR_TO_PENDING_DIFFS.get(editor);
    if (pendingDiffs?.length) {
      const transformed = pendingDiffs
        .map((textDiff) => transformTextDiff(textDiff, op))
        .filter(Boolean) as TextDiff[];

      EDITOR_TO_PENDING_DIFFS.set(editor, transformed);
    }

    const pendingSelection = EDITOR_TO_PENDING_SELECTION.get(editor);
    if (pendingSelection) {
      EDITOR_TO_PENDING_SELECTION.set(
        editor,
        transformPendingRange(editor, pendingSelection, op)
      );
    }
    const pendingAction = EDITOR_TO_PENDING_ACTION.get(editor);
    if (pendingAction) {
      const at = Point.isPoint(pendingAction?.at)
        ? transformPendingPoint(editor, pendingAction.at, op)
        : transformPendingRange(editor, pendingAction.at, op);

      EDITOR_TO_PENDING_ACTION.set(
        editor,
        at ? { ...pendingAction, at } : null
      );
    }

    switch (op.type) {
      case "insert_text":
      case "remove_text":
      case "set_node":
      case "split_node": {
        matches.push(...getMatches(e, op.path));
        break;
      }

      case "set_selection": {
        // Selection was manually set, don't restore the user selection after the change.
        EDITOR_TO_USER_SELECTION.get(editor)?.unref();
        EDITOR_TO_USER_SELECTION.delete(editor);
        break;
      }

      case "insert_node":
      case "remove_node": {
        matches.push(...getMatches(e, Path.parent(op.path)));
        break;
      }

      case "merge_node": {
        const prevPath = Path.previous(op.path);
        matches.push(...getMatches(e, prevPath));
        break;
      }

      case "move_node": {
        const commonPath = Path.common(
          Path.parent(op.path),
          Path.parent(op.newPath)
        );
        matches.push(...getMatches(e, commonPath));
        break;
      }
    }

    apply(op);

    for (const [path, key] of matches) {
      const [node] = Editor.node(e, path);
      NODE_TO_KEY.set(node, key);
    }
  };

  e.setFragmentData = (data: Pick<DataTransfer, "getData" | "setData">) => {
    const { selection } = e;

    if (!selection) {
      return;
    }

    const [start, end] = Range.edges(selection);
    const startVoid = Editor.void(e, { at: start.path });
    const endVoid = Editor.void(e, { at: end.path });

    if (Range.isCollapsed(selection) && !startVoid) {
      return;
    }

    // Create a fake selection so that we can add a Base64-encoded copy of the
    // fragment to the HTML, to decode on future pastes.
    const domRange = AngularEditor.toDOMRange(e, selection);
    let contents = domRange.cloneContents();
    let attach = contents.childNodes[0] as HTMLElement;

    // Make sure attach is non-empty, since empty nodes will not get copied.
    contents.childNodes.forEach((node) => {
      if (node.textContent && node.textContent.trim() !== "") {
        attach = node as HTMLElement;
      }
    });

    // COMPAT: If the end node is a void node, we need to move the end of the
    // range from the void node's spacer span, to the end of the void node's
    // content, since the spacer is before void's content in the DOM.
    if (endVoid) {
      const [voidNode] = endVoid;
      const r = domRange.cloneRange();
      const domNode = AngularEditor.toDOMNode(e, voidNode);
      r.setEndAfter(domNode);
      contents = r.cloneContents();
    }

    // COMPAT: If the start node is a void node, we need to attach the encoded
    // fragment to the void node's content node instead of the spacer, because
    // attaching it to empty `<div>/<span>` nodes will end up having it erased by
    // most browsers. (2018/04/27)
    if (startVoid) {
      attach = contents.querySelector("[data-slate-spacer]")! as HTMLElement;
    }

    // Remove any zero-width space spans from the cloned DOM so that they don't
    // show up elsewhere when pasted.
    Array.from(contents.querySelectorAll("[data-slate-zero-width]")).forEach(
      (zw: HTMLElement) => {
        const isNewline = zw.getAttribute("data-slate-zero-width") === "n";
        zw.textContent = isNewline ? "\n" : "";
      }
    );

    // Set a `data-slate-fragment` attribute on a non-empty node, so it shows up
    // in the HTML, and can be used for intra-Slate pasting. If it's a text
    // node, wrap it in a `<span>` so we have something to set an attribute on.
    if (isDOMText(attach)) {
      const span = attach.ownerDocument.createElement("span");
      // COMPAT: In Chrome and Safari, if we don't add the `white-space` style
      // then leading and trailing spaces will be ignored. (2017/09/21)
      span.style.whiteSpace = "pre";
      span.appendChild(attach);
      contents.appendChild(span);
      attach = span;
    }

    const fragment = e.getFragment();
    const string = JSON.stringify(fragment);
    const encoded = window.btoa(encodeURIComponent(string));
    attach.setAttribute("data-slate-fragment", encoded);
    data.setData(`application/${clipboardFormatKey}`, encoded);

    // Add the content to a <div> so that we can get its inner HTML.
    const div = contents.ownerDocument.createElement("div");
    div.appendChild(contents);
    div.setAttribute("hidden", "true");
    contents.ownerDocument.body.appendChild(div);
    data.setData("text/html", div.innerHTML);
    data.setData("text/plain", getPlainText(div));
    contents.ownerDocument.body.removeChild(div);
    return data;
  };

  e.insertData = (data: DataTransfer) => {
    if (!e.insertFragmentData(data)) {
      e.insertTextData(data);
    }
  };

  e.insertFragmentData = (data: DataTransfer): boolean => {
    /**
     * Checking copied fragment from application/x-slate-fragment or data-slate-fragment
     */
    const fragment =
      data.getData(`application/${clipboardFormatKey}`) ||
      getSlateFragmentAttribute(data);

    if (fragment) {
      const decoded = decodeURIComponent(window.atob(fragment));
      const parsed = JSON.parse(decoded) as Node[];
      e.insertFragment(parsed);
      return true;
    }
    return false;
  };

  e.insertTextData = (data: DataTransfer): boolean => {
    const text = data.getData("text/plain");

    if (text) {
      const lines = text.split(/\r\n|\r|\n/);
      let split = false;

      for (const line of lines) {
        if (split) {
          Transforms.splitNodes(e, { always: true });
        }

        e.insertText(line);
        split = true;
      }
      return true;
    }
    return false;
  };

  e.onChange = () => {
    const onContextChange = EDITOR_TO_ON_CHANGE.get(e);

    if (onContextChange) {
      onContextChange();
    }

    onChange();
  };

  e.isBlockCard = (element) => false;

  return e;
};

const getMatches = (e: AngularEditor, path: Path) => {
  const matches: [Path, Key][] = [];
  for (const [n, p] of Editor.levels(e, { at: path })) {
    const key = AngularEditor.findKey(e, n);
    matches.push([p, key]);
  }
  return matches;
};

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  forwardRef,
  HostListener,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from "@angular/core";
import { NG_VALUE_ACCESSOR } from "@angular/forms";
import getDirection from "direction";
import { debounce, throttle } from "lodash";
import {
  BasePoint,
  BaseRange,
  Editor,
  Element,
  Node,
  NodeEntry,
  Path,
  Range,
  Text,
  Transforms,
} from "slate";
import { useAndroidInputManager } from "../../hooks/android-input-manager/use-android-input-manager";
import { useTrackUserInput } from "../../hooks/use-track-user-input";
import { AngularEditor } from "../../plugins/angular-editor";
import { ViewType } from "../../types";
import { UseRef, useRef } from "../../types/react-workaround";
import { check, normalize } from "../../utils";
import { TRIPLE_CLICK } from "../../utils/constants";
import {
  DOMElement,
  DOMNode,
  DOMRange,
  DOMSelection,
  DOMText,
  getDefaultView,
  isDOMElement,
  isDOMNode,
  isPlainTextOnlyPaste,
} from "../../utils/dom";
import {
  HAS_BEFORE_INPUT_SUPPORT,
  IS_ANDROID,
  IS_CHROME,
  IS_FIREFOX,
  IS_FIREFOX_LEGACY,
  IS_IOS,
  IS_QQBROWSER,
  IS_SAFARI,
  IS_UC_MOBILE,
  IS_WECHATBROWSER,
} from "../../utils/environment";
import Hotkeys from "../../utils/hotkeys";
import {
  EDITOR_TO_ELEMENT,
  EDITOR_TO_ON_CHANGE,
  EDITOR_TO_PENDING_INSERTION_MARKS,
  EDITOR_TO_USER_MARKS,
  EDITOR_TO_USER_SELECTION,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  IS_COMPOSING,
  IS_FOCUSED,
  IS_READ_ONLY,
  MARK_PLACEHOLDER_SYMBOL,
  NODE_TO_ELEMENT,
  PLACEHOLDER_SYMBOL,
} from "../../utils/weak-maps";
import { SlateChildrenContext, SlateViewContext } from "../../view/context";
import { SlateStringTemplateComponent } from "../string/template.component";

type DeferredOperation = () => void;

interface EditableState {
  isDraggingInternally: boolean;
  isUpdatingSelection: boolean;
  latestElement: DOMElement | null;
  hasMarkPlaceholder: boolean;
}

// https://github.com/sliteteam/slate-1/tree/working-android-input
@Component({
  selector: "slate-editable",
  host: {
    class: "slate-editable-container",
    "[attr.contenteditable]": "readOnly ? undefined : true",
    "[attr.role]": `readOnly ? undefined : 'textbox'`,
    "[attr.spellCheck]": `!hasBeforeInputSupport ? false : spellCheck`,
    "[attr.autoCorrect]": `!hasBeforeInputSupport ? 'false' : autoCorrect`,
    "[attr.autoCapitalize]": `!hasBeforeInputSupport ? 'false' : autoCapitalize`,
  },
  templateUrl: "editable.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => EditableComponent),
      multi: true,
    },
  ],
})
export class EditableComponent implements OnInit, OnDestroy {
  // #region Event Handlers

  @Input()
  public onBeforeInput?: (event: Event) => void;

  @Input()
  public onBlur?: (event: FocusEvent) => void;

  @Input()
  public onFocus?: (event: FocusEvent) => void;

  @Input()
  public onClick?: (event: MouseEvent) => void;

  @Input()
  public onCompositionEnd?: (event: CompositionEvent) => void;

  @Input()
  public onCompositionUpdate?: (event: CompositionEvent) => void;

  @Input()
  public onCompositionStart?: (event: CompositionEvent) => void;

  @Input()
  public onCopy?: (event: ClipboardEvent) => void;

  @Input()
  public onCut?: (event: ClipboardEvent) => void;

  @Input()
  public onPaste?: (event: ClipboardEvent) => void;

  @Input()
  public onDragOver?: (event: DragEvent) => void;

  @Input()
  public onDragStart?: (event: DragEvent) => void;

  @Input()
  public onDrop?: (event: DragEvent) => void;

  @Input()
  public onDragEnd?: (event: DragEvent) => void;

  @Input()
  public onKeydown?: (event: KeyboardEvent) => void;

  // #endregion

  @Input()
  public editor!: AngularEditor;

  @Input() trackBy: (node: Element) => any = () => null;

  private _autoFocus = false;

  @Input()
  public set autoFocus(autoFocus: boolean) {
    this._autoFocus = autoFocus;
    if (this._autoFocus && this.ref.current) {
      try {
        this.ref.current.focus();
      } catch (error) {}
    }
  }

  public get autoFocus(): boolean {
    return this._autoFocus;
  }

  @Input()
  public decorate = EditableUtils.decorate;

  @Input()
  public placeholder?: string;

  @Input()
  public renderElement?: (element: Element) => ViewType | null;

  @Input()
  public renderLeaf?: (text: Text) => ViewType | null;

  @Input()
  public renderText?: (text: Text) => ViewType | null;

  @Input()
  public isStrictDecorate: boolean = true;

  @Input()
  public scrollSelectionIntoView = EditableUtils.scrollSelectionIntoView;

  // #region DOM attr

  @Input()
  public readOnly = false;

  @Input()
  public spellCheck = false;

  @Input()
  public autoCorrect = false;

  @Input()
  public autoCapitalize = false;

  public readonly _hasBeforeInputSupport = HAS_BEFORE_INPUT_SUPPORT;

  @ViewChild("templateComponent", { static: true })
  templateComponent: SlateStringTemplateComponent;

  @ViewChild("templateComponent", { static: true, read: ElementRef })
  templateElementRef: ElementRef<any>;

  // #endregion

  private _selectionChangeHandlerInner = throttle(() => {
    if (
      (IS_ANDROID || !AngularEditor.isComposing(this.editor)) &&
      (!this.state.isUpdatingSelection ||
        this.androidInputManager?.isFlushing()) &&
      !this.state.isDraggingInternally
    ) {
      const root = AngularEditor.findDocumentOrShadowRoot(this.editor);
      const { activeElement } = root;
      const el = AngularEditor.toDOMNode(this.editor, this.editor);
      const domSelection = root.getSelection();

      if (activeElement === el) {
        this.state.latestElement = activeElement;
        IS_FOCUSED.set(this.editor, true);
      } else {
        IS_FOCUSED.delete(this.editor);
      }

      if (!domSelection) {
        return Transforms.deselect(this.editor);
      }

      const { anchorNode, focusNode } = domSelection;

      const anchorNodeSelectable =
        EditableUtils.hasEditableTarget(this.editor, anchorNode) ||
        EditableUtils.isTargetInsideNonReadonlyVoid(this.editor, anchorNode);

      const focusNodeSelectable =
        EditableUtils.hasEditableTarget(this.editor, focusNode) ||
        EditableUtils.isTargetInsideNonReadonlyVoid(this.editor, focusNode);

      if (anchorNodeSelectable && focusNodeSelectable) {
        const range = AngularEditor.toSlateRange(this.editor, domSelection, {
          exactMatch: false,
          suppressThrow: true,
        });

        if (range) {
          if (
            !AngularEditor.isComposing(this.editor) &&
            !this.androidInputManager?.hasPendingDiffs() &&
            !this.androidInputManager?.isFlushing()
          ) {
            Transforms.select(this.editor, range);
          } else {
            this.androidInputManager?.handleUserSelect(range);
          }
        }
      }
    }
  }, 100);

  private scheduleOnDOMSelectionChange = debounce(
    this._selectionChangeHandlerInner.bind(this),
    0
  );

  private androidInputManager: any;

  private readonly state = {
    isDraggingInternally: false,
    isUpdatingSelection: false,
    latestElement: null as DOMElement | null,
    hasMarkPlaceholder: false,
  };

  private isComposing = false;
  private setIsComposing(isComposing: boolean): void {
    this.isComposing = isComposing;
  }

  private deferredOperations: UseRef<(() => void)[]> = useRef([]);

  private get ref(): UseRef<HTMLElement> {
    return useRef(this.elementRef.nativeElement);
  }

  private onUserInput!: () => void;
  public receivedUserInput!: UseRef<boolean>;

  public viewContext!: SlateViewContext;
  public context!: SlateChildrenContext;

  constructor(
    private readonly elementRef: ElementRef<HTMLElement>,
    private readonly cdRef: ChangeDetectorRef,
    private readonly ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.initializeViewContext();
    this.initializeContext();
    this.initialization();
  }

  ngOnDestroy(): void {}

  private initialization(): void {
    // Update element-related weak maps with the DOM element ref.
    let window;

    if (this.ref.current && (window = getDefaultView(this.ref.current))) {
      EDITOR_TO_WINDOW.set(this.editor, window);
      EDITOR_TO_ELEMENT.set(this.editor, this.ref.current);
      NODE_TO_ELEMENT.set(this.editor, this.ref.current);
      ELEMENT_TO_NODE.set(this.ref.current, this.editor);
    } else {
      NODE_TO_ELEMENT.delete(this.editor);
    }

    IS_READ_ONLY.set(this.editor, this.readOnly);

    EDITOR_TO_ON_CHANGE.set(this.editor, () => {
      this.ngZone.run(() => {
        this.onChanges();
      });
    });

    this.androidInputManager = useAndroidInputManager(this.editor, {
      node: this.ref.current,
      onDOMSelectionChange: this._selectionChangeHandlerInner,
      scheduleOnDOMSelectionChange: this.scheduleOnDOMSelectionChange,
    });
    const userInput = useTrackUserInput(this.editor);

    this.onUserInput = userInput.onUserInput;
    this.receivedUserInput = userInput.receivedUserInput;
  }

  private onChanges(): void {
    console.log("DEBUG onChanges");
    this.updateMarksOnChanges();
    this.updateSelectionOnChanges();
    this._onChange(this.editor.children);
  }

  private updateMarksOnChanges(): BaseRange[] {
    const decorations = this.decorate([this.editor, []]);

    if (
      this.placeholder &&
      this.editor.children.length === 1 &&
      Array.from(Node.texts(this.editor)).length === 1 &&
      Node.string(this.editor) === "" &&
      !this.isComposing
    ) {
      const start = Editor.start(this.editor, []);
      decorations.push({
        [PLACEHOLDER_SYMBOL]: true,
        placeholder: this.placeholder,
        anchor: start,
        focus: start,
      } as any);
    }

    const { marks } = this.editor;
    this.state.hasMarkPlaceholder = false;

    if (
      this.editor.selection &&
      Range.isCollapsed(this.editor.selection) &&
      marks
    ) {
      const { anchor } = this.editor.selection;
      const { text, ...rest } = Node.leaf(this.editor, anchor.path);

      if (!Text.equals(rest as Text, marks as Text, { loose: true })) {
        this.state.hasMarkPlaceholder = true;

        const unset = Object.keys(rest).reduce((acc, mark) => {
          return {
            ...acc,
            [mark]: null,
          };
        }, {});

        decorations.push({
          [MARK_PLACEHOLDER_SYMBOL]: true,
          ...unset,
          ...marks,

          anchor,
          focus: anchor,
        });
      }
    }

    setTimeout(() => {
      if (marks) {
        EDITOR_TO_PENDING_INSERTION_MARKS.set(this.editor, marks);
      } else {
        EDITOR_TO_PENDING_INSERTION_MARKS.delete(this.editor);
      }
    });

    return decorations as any;
  }

  private updateSelectionOnChanges(): void {
    // Make sure the DOM selection state is in sync.
    const { selection } = this.editor;
    const root = AngularEditor.findDocumentOrShadowRoot(this.editor);
    const domSelection = root.getSelection();

    if (
      !domSelection ||
      !AngularEditor.isFocused(this.editor) ||
      this.androidInputManager?.hasPendingAction()
    ) {
      return;
    }

    const setDomSelection = (forceChange?: boolean) => {
      const hasDomSelection = domSelection.type !== "None";

      // If the DOM selection is properly unset, we're done.
      if (!selection && !hasDomSelection) {
        return;
      }

      // verify that the dom selection is in the editor
      const editorElement = EDITOR_TO_ELEMENT.get(this.editor)!;
      let hasDomSelectionInEditor = false;
      if (
        editorElement.contains(domSelection.anchorNode) &&
        editorElement.contains(domSelection.focusNode)
      ) {
        hasDomSelectionInEditor = true;
      }

      // If the DOM selection is in the editor and the editor selection is already correct, we're done.
      if (
        hasDomSelection &&
        hasDomSelectionInEditor &&
        selection &&
        !forceChange
      ) {
        const slateRange = AngularEditor.toSlateRange(
          this.editor,
          domSelection,
          {
            exactMatch: true,

            // domSelection is not necessarily a valid Slate range
            // (e.g. when clicking on contentEditable:false element)
            suppressThrow: true,
          }
        );

        if (slateRange && Range.equals(slateRange, selection)) {
          if (!this.state.hasMarkPlaceholder) {
            return;
          }

          // Ensure selection is inside the mark placeholder
          const { anchorNode } = domSelection;
          if (
            anchorNode?.parentElement?.hasAttribute(
              "data-slate-mark-placeholder"
            )
          ) {
            return;
          }
        }
      }

      // when <Editable/> is being controlled through external value
      // then its children might just change - DOM responds to it on its own
      // but Slate's value is not being updated through any operation
      // and thus it doesn't transform selection on its own
      if (selection && !AngularEditor.hasRange(this.editor, selection)) {
        this.editor.selection = AngularEditor.toSlateRange(
          this.editor,
          domSelection,
          {
            exactMatch: false,
            suppressThrow: true,
          }
        );
        return;
      }

      // Otherwise the DOM selection is out of sync, so update it.
      this.state.isUpdatingSelection = true;

      const newDomRange: DOMRange | null =
        selection && AngularEditor.toDOMRange(this.editor, selection);

      if (newDomRange) {
        if (Range.isBackward(selection!)) {
          domSelection.setBaseAndExtent(
            newDomRange.endContainer,
            newDomRange.endOffset,
            newDomRange.startContainer,
            newDomRange.startOffset
          );
        } else {
          domSelection.setBaseAndExtent(
            newDomRange.startContainer,
            newDomRange.startOffset,
            newDomRange.endContainer,
            newDomRange.endOffset
          );
        }
        this.scrollSelectionIntoView(this.editor, newDomRange);
      } else {
        domSelection.removeAllRanges();
      }

      return newDomRange;
    };

    const newDomRange = setDomSelection();
    const ensureSelection = this.androidInputManager?.isFlushing() === "action";

    if (!IS_ANDROID || !ensureSelection) {
      setTimeout(() => {
        // COMPAT: In Firefox, it's not enough to create a range, you also need
        // to focus the contenteditable element too. (2016/11/16)
        if (newDomRange && IS_FIREFOX) {
          const el = AngularEditor.toDOMNode(this.editor, this.editor);
          el.focus();
        }

        this.state.isUpdatingSelection = false;
      });
      return;
    }

    let timeoutId: number | null = null;
    const animationFrameId = requestAnimationFrame(() => {
      if (ensureSelection) {
        const ensureDomSelection = (forceChange?: boolean) => {
          try {
            const el = AngularEditor.toDOMNode(this.editor, this.editor);
            el.focus();

            setDomSelection(forceChange);
          } catch (e) {
            // Ignore, dom and state might be out of sync
          }
        };

        // Compat: Android IMEs try to force their selection by manually re-applying it even after we set it.
        // This essentially would make setting the slate selection during an update meaningless, so we force it
        // again here. We can't only do it in the setTimeout after the animation frame since that would cause a
        // visible flicker.
        ensureDomSelection();

        timeoutId = setTimeout(() => {
          // COMPAT: While setting the selection in an animation frame visually correctly sets the selection,
          // it doesn't update GBoards spellchecker state. We have to manually trigger a selection change after
          // the animation frame to ensure it displays the correct state.
          ensureDomSelection(true);
          this.state.isUpdatingSelection = false;
        });
      }
    });
  }

  private initializeContext() {
    this.context = {
      parent: this.editor,
      selection: this.editor.selection,
      decorations: this.updateMarksOnChanges(),
      decorate: this.decorate as any,
      readonly: this.readOnly,
    };
  }

  private initializeViewContext() {
    this.viewContext = {
      editor: this.editor,
      renderElement: this.renderElement,
      renderLeaf: this.renderLeaf,
      renderText: this.renderText,
      trackBy: this.trackBy,
      isStrictDecorate: this.isStrictDecorate,
      templateComponent: this.templateComponent,
    };
  }

  // #region NG_VALUE_ACCESSOR

  public _onChange(_: any): void {}

  public _onTouched(_: any): void {}

  public writeValue(value: Element[]): void {
    if (value && value.length) {
      if (check(value)) {
        this.editor.children = value;
      } else {
        this.editor.onError({
          code: 123123,
          name: "initialize invalid data",
          data: value,
        });
        this.editor.children = normalize(value);
      }
      this.initializeContext();
      this.cdRef.detectChanges();
    }
  }

  public registerOnChange(fn: any): void {
    this._onChange = fn;
    this.cdRef.detectChanges();
  }

  public registerOnTouched(fn: any): void {
    this._onTouched = fn;
    this.cdRef.detectChanges();
  }

  public setDisabledState(_isDisabled: boolean): void {}

  // #endregion

  // #region listeners

  @HostListener("document:selectionchange")
  public _selectionChangeHandler(): void {
    this.scheduleOnDOMSelectionChange();
  }

  @HostListener("beforeinput", ["$event"])
  public _beforeInputHandler(event: InputEvent): void {
    console.log("DEBUG beforeInput", event);
    this.onUserInput();

    if (
      !this.readOnly &&
      EditableUtils.hasEditableTarget(this.editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onBeforeInput)
    ) {
      // COMPAT: BeforeInput events aren't cancelable on android, so we have to handle them differently using the android input manager.
      if (this.androidInputManager) {
        return this.androidInputManager.handleDOMBeforeInput(event);
      }

      // Some IMEs/Chrome extensions like e.g. Grammarly set the selection immediately before
      // triggering a `beforeinput` expecting the change to be applied to the immediately before
      // set selection.
      this.scheduleOnDOMSelectionChange.flush();
      this._selectionChangeHandlerInner.flush();

      const { selection } = this.editor;
      const { inputType: type } = event;
      const data = (event as any).dataTransfer || event.data || undefined;

      const isCompositionChange =
        type === "insertCompositionText" || type === "deleteCompositionText";

      // COMPAT: use composition change events as a hint to where we should insert
      // composition text if we aren't composing to work around https://github.com/ianstormtaylor/slate/issues/5038
      if (isCompositionChange && AngularEditor.isComposing(this.editor)) {
        return;
      }

      let native = false;
      if (
        type === "insertText" &&
        selection &&
        Range.isCollapsed(selection) &&
        // Only use native character insertion for single characters a-z or space for now.
        // Long-press events (hold a + press 4 = ä) to choose a special character otherwise
        // causes duplicate inserts.
        event.data &&
        event.data.length === 1 &&
        /[a-z ]/i.test(event.data) &&
        // Chrome has issues correctly editing the start of nodes: https://bugs.chromium.org/p/chromium/issues/detail?id=1249405
        // When there is an inline element, e.g. a link, and you select
        // right after it (the start of the next node).
        selection.anchor.offset !== 0
      ) {
        native = true;

        // Skip native if there are marks, as
        // `insertText` will insert a node, not just text.
        if (this.editor.marks) {
          native = false;
        }

        // Chrome also has issues correctly editing the end of anchor elements: https://bugs.chromium.org/p/chromium/issues/detail?id=1259100
        // Therefore we don't allow native events to insert text at the end of anchor nodes.
        const { anchor } = selection;

        const [node, offset] = AngularEditor.toDOMPoint(this.editor, anchor);
        const anchorNode = node.parentElement?.closest("a");

        const window = AngularEditor.getWindow(this.editor);

        if (
          native &&
          anchorNode &&
          AngularEditor.hasDOMNode(this.editor, anchorNode)
        ) {
          // Find the last text node inside the anchor.
          const lastText = window?.document
            .createTreeWalker(anchorNode, NodeFilter.SHOW_TEXT)
            .lastChild() as DOMText | null;

          if (lastText === node && lastText.textContent?.length === offset) {
            native = false;
          }
        }

        // Chrome has issues with the presence of tab characters inside elements with whiteSpace = 'pre'
        // causing abnormal insert behavior: https://bugs.chromium.org/p/chromium/issues/detail?id=1219139
        if (
          native &&
          node.parentElement &&
          window?.getComputedStyle(node.parentElement)?.whiteSpace === "pre"
        ) {
          const block = Editor.above(this.editor, {
            at: anchor.path,
            match: (n) => Editor.isBlock(this.editor, n),
          });

          if (block && Node.string(block[0]).includes("\t")) {
            native = false;
          }
        }
      }

      // COMPAT: For the deleting forward/backward input types we don't want
      // to change the selection because it is the range that will be deleted,
      // and those commands determine that for themselves.
      if (!type.startsWith("delete") || type.startsWith("deleteBy")) {
        const [targetRange] = (event as any).getTargetRanges();

        if (targetRange) {
          const range = AngularEditor.toSlateRange(this.editor, targetRange, {
            exactMatch: false,
            suppressThrow: false,
          });

          if (!selection || !Range.equals(selection, range)) {
            native = false;

            const selectionRef =
              !isCompositionChange &&
              this.editor.selection &&
              Editor.rangeRef(this.editor, this.editor.selection);

            Transforms.select(this.editor, range);

            if (selectionRef) {
              EDITOR_TO_USER_SELECTION.set(this.editor, selectionRef);
            }
          }
        }
      }

      // Composition change types occur while a user is composing text and can't be
      // cancelled. Let them through and wait for the composition to end.
      if (isCompositionChange) {
        return;
      }

      if (!native) {
        event.preventDefault();
      }

      // COMPAT: If the selection is expanded, even if the command seems like
      // a delete forward/backward command it should delete the selection.
      if (
        selection &&
        Range.isExpanded(selection) &&
        type.startsWith("delete")
      ) {
        const direction = type.endsWith("Backward") ? "backward" : "forward";
        Editor.deleteFragment(this.editor, { direction });
        return;
      }

      switch (type) {
        case "deleteByComposition":
        case "deleteByCut":
        case "deleteByDrag": {
          Editor.deleteFragment(this.editor);
          break;
        }

        case "deleteContent":
        case "deleteContentForward": {
          Editor.deleteForward(this.editor);
          break;
        }

        case "deleteContentBackward": {
          Editor.deleteBackward(this.editor);
          break;
        }

        case "deleteEntireSoftLine": {
          Editor.deleteBackward(this.editor, { unit: "line" });
          Editor.deleteForward(this.editor, { unit: "line" });
          break;
        }

        case "deleteHardLineBackward": {
          Editor.deleteBackward(this.editor, { unit: "block" });
          break;
        }

        case "deleteSoftLineBackward": {
          Editor.deleteBackward(this.editor, { unit: "line" });
          break;
        }

        case "deleteHardLineForward": {
          Editor.deleteForward(this.editor, { unit: "block" });
          break;
        }

        case "deleteSoftLineForward": {
          Editor.deleteForward(this.editor, { unit: "line" });
          break;
        }

        case "deleteWordBackward": {
          Editor.deleteBackward(this.editor, { unit: "word" });
          break;
        }

        case "deleteWordForward": {
          Editor.deleteForward(this.editor, { unit: "word" });
          break;
        }

        case "insertLineBreak":
          Editor.insertSoftBreak(this.editor);
          break;

        case "insertParagraph": {
          Editor.insertBreak(this.editor);
          break;
        }

        case "insertFromComposition":
        case "insertFromDrop":
        case "insertFromPaste":
        case "insertFromYank":
        case "insertReplacementText":
        case "insertText": {
          const { selection } = this.editor;
          if (selection) {
            if (Range.isExpanded(selection)) {
              Editor.deleteFragment(this.editor);
            }
          }

          if (type === "insertFromComposition") {
            // COMPAT: in Safari, `compositionend` is dispatched after the
            // `beforeinput` for "insertFromComposition". But if we wait for it
            // then we will abort because we're still composing and the selection
            // won't be updated properly.
            // https://www.w3.org/TR/input-events-2/
            if (AngularEditor.isComposing(this.editor)) {
              this.setIsComposing(false);
              IS_COMPOSING.set(this.editor, false);
            }
          }

          // use a weak comparison instead of 'instanceof' to allow
          // programmatic access of paste events coming from external windows
          // like cypress where cy.window does not work realibly
          if (data?.constructor.name === "DataTransfer") {
            AngularEditor.insertData(this.editor, data);
          } else if (typeof data === "string") {
            // Only insertText operations use the native functionality, for now.
            // Potentially expand to single character deletes, as well.
            if (native) {
              this.deferredOperations.current.push(() =>
                Editor.insertText(this.editor, data)
              );
            } else {
              Editor.insertText(this.editor, data);
            }
          }

          break;
        }
      }

      // Restore the actual user section if nothing manually set it.
      const toRestore = EDITOR_TO_USER_SELECTION.get(this.editor)?.unref();
      EDITOR_TO_USER_SELECTION.delete(this.editor);

      if (
        toRestore &&
        (!this.editor.selection ||
          !Range.equals(this.editor.selection, toRestore))
      ) {
        Transforms.select(this.editor, toRestore);
      }
    }
  }

  @HostListener("input")
  public _inputHandler(): void {
    if (this.androidInputManager) {
      this.androidInputManager.handleInput();
      return;
    }

    // Flush native operations, as native events will have propogated
    // and we can correctly compare DOM text values in components
    // to stop rendering, so that browser functions like autocorrect
    // and spellcheck work as expected.
    for (const op of this.deferredOperations.current) {
      op();
    }
    this.deferredOperations.current = [];
  }

  @HostListener("blur", ["$event"])
  public _blurHandler(event: FocusEvent): void {
    if (
      this.readOnly ||
      this.state.isUpdatingSelection ||
      !EditableUtils.hasEditableTarget(this.editor, event.target) ||
      EditableUtils.isEventHandled(event, this.onBlur)
    ) {
      return;
    }

    // COMPAT: If the current `activeElement` is still the previous
    // one, this is due to the window being blurred when the tab
    // itself becomes unfocused, so we want to abort early to allow to
    // editor to stay focused when the tab becomes focused again.
    const root = AngularEditor.findDocumentOrShadowRoot(this.editor);
    if (this.state.latestElement === root.activeElement) {
      return;
    }

    const { relatedTarget } = event;
    const el = AngularEditor.toDOMNode(this.editor, this.editor);

    // COMPAT: The event should be ignored if the focus is returning
    // to the editor from an embedded editable element (eg. an <input>
    // element inside a void node).
    if (relatedTarget === el) {
      return;
    }

    // COMPAT: The event should be ignored if the focus is moving from
    // the editor to inside a void node's spacer element.
    if (
      isDOMElement(relatedTarget) &&
      relatedTarget.hasAttribute("data-slate-spacer")
    ) {
      return;
    }

    // COMPAT: The event should be ignored if the focus is moving to a
    // non- editable section of an element that isn't a void node (eg.
    // a list item of the check list example).
    if (
      relatedTarget != null &&
      isDOMNode(relatedTarget) &&
      AngularEditor.hasDOMNode(this.editor, relatedTarget)
    ) {
      const node = AngularEditor.toSlateNode(this.editor, relatedTarget);

      if (Element.isElement(node) && !this.editor.isVoid(node)) {
        return;
      }
    }

    // COMPAT: Safari doesn't always remove the selection even if the content-
    // editable element no longer has focus. Refer to:
    // https://stackoverflow.com/questions/12353247/force-contenteditable-div-to-stop-accepting-input-after-it-loses-focus-under-web
    if (IS_SAFARI) {
      const domSelection = root.getSelection();
      domSelection?.removeAllRanges();
    }

    IS_FOCUSED.delete(this.editor);
  }

  @HostListener("click", ["$event"])
  public _clickHandler(event: MouseEvent): void {
    if (
      EditableUtils.hasTarget(this.editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onClick) &&
      isDOMNode(event.target)
    ) {
      const node = AngularEditor.toSlateNode(this.editor, event.target);
      const path = AngularEditor.findPath(this.editor, node);

      // At this time, the Slate document may be arbitrarily different,
      // because onClick handlers can change the document before we get here.
      // Therefore we must check that this path actually exists,
      // and that it still refers to the same node.
      if (
        !Editor.hasPath(this.editor, path) ||
        Node.get(this.editor, path) !== node
      ) {
        return;
      }

      if (event.detail === TRIPLE_CLICK && path.length >= 1) {
        let blockPath = path;
        if (!Editor.isBlock(this.editor, node)) {
          const block = Editor.above(this.editor, {
            match: (n) => Editor.isBlock(this.editor, n),
            at: path,
          });

          blockPath = block?.[1] ?? path.slice(0, 1);
        }

        const range = Editor.range(this.editor, blockPath);
        Transforms.select(this.editor, range);
        return;
      }

      if (this.readOnly) {
        return;
      }

      const start = Editor.start(this.editor, path);
      const end = Editor.end(this.editor, path);
      const startVoid = Editor.void(this.editor, { at: start });
      const endVoid = Editor.void(this.editor, { at: end });

      if (startVoid && endVoid && Path.equals(startVoid[1], endVoid[1])) {
        const range = Editor.range(this.editor, start);
        Transforms.select(this.editor, range);
      }
    }
  }

  @HostListener("compositionEnd", ["$event"])
  public _compositionEndHandler(event: CompositionEvent): void {
    if (EditableUtils.hasEditableTarget(this.editor, event.target)) {
      if (AngularEditor.isComposing(this.editor)) {
        this.setIsComposing(false);
        IS_COMPOSING.set(this.editor, false);
      }

      this.androidInputManager?.handleCompositionEnd(event);

      if (
        EditableUtils.isEventHandled(event, this.onCompositionEnd) ||
        IS_ANDROID
      ) {
        return;
      }

      // COMPAT: In Chrome, `beforeinput` events for compositions
      // aren't correct and never fire the "insertFromComposition"
      // type that we need. So instead, insert whenever a composition
      // ends since it will already have been committed to the DOM.
      if (
        !IS_SAFARI &&
        !IS_FIREFOX_LEGACY &&
        !IS_IOS &&
        !IS_QQBROWSER &&
        !IS_WECHATBROWSER &&
        !IS_UC_MOBILE &&
        event.data
      ) {
        const placeholderMarks = EDITOR_TO_PENDING_INSERTION_MARKS.get(
          this.editor
        );
        EDITOR_TO_PENDING_INSERTION_MARKS.delete(this.editor);

        // Ensure we insert text with the marks the user was actually seeing
        if (placeholderMarks !== undefined) {
          EDITOR_TO_USER_MARKS.set(this.editor, this.editor.marks);
          this.editor.marks = placeholderMarks;
        }

        Editor.insertText(this.editor, event.data);

        const userMarks = EDITOR_TO_USER_MARKS.get(this.editor);
        EDITOR_TO_USER_MARKS.delete(this.editor);
        if (userMarks !== undefined) {
          this.editor.marks = userMarks;
        }
      }
    }
  }

  @HostListener("compositionUpdate", ["$event"])
  public _compositionUpdateHandler(event: CompositionEvent): void {
    if (
      EditableUtils.hasEditableTarget(this.editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onCompositionUpdate)
    ) {
      if (!AngularEditor.isComposing(this.editor)) {
        this.setIsComposing(true);
        IS_COMPOSING.set(this.editor, true);
      }
    }
  }

  @HostListener("compositionStart", ["$event"])
  public _compositionStartHandler(event: CompositionEvent): void {
    if (EditableUtils.hasEditableTarget(this.editor, event.target)) {
      this.androidInputManager?.handleCompositionStart(event);

      if (
        EditableUtils.isEventHandled(event, this.onCompositionStart) ||
        IS_ANDROID
      ) {
        return;
      }

      this.setIsComposing(true);

      const { selection } = this.editor;
      if (selection) {
        if (Range.isExpanded(selection)) {
          Editor.deleteFragment(this.editor);
          return;
        }
        const inline = Editor.above(this.editor, {
          match: (n) => Editor.isInline(this.editor, n),
          mode: "highest",
        });
        if (inline) {
          const [, inlinePath] = inline;
          if (Editor.isEnd(this.editor, selection.anchor, inlinePath)) {
            const point = Editor.after(this.editor, inlinePath)!;
            Transforms.setSelection(this.editor, {
              anchor: point,
              focus: point,
            });
          }
        }
      }
    }
  }

  @HostListener("copy", ["$event"])
  public _copyHandler(event: ClipboardEvent): void {
    if (
      EditableUtils.hasEditableTarget(this.editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onCopy)
    ) {
      event.preventDefault();
      AngularEditor.setFragmentData(
        this.editor,
        event.clipboardData as DataTransfer,
        "copy"
      );
    }
  }

  @HostListener("cut", ["$event"])
  public _cutHandler(event: ClipboardEvent): void {
    if (
      !this.readOnly &&
      EditableUtils.hasEditableTarget(this.editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onCut)
    ) {
      event.preventDefault();
      AngularEditor.setFragmentData(
        this.editor,
        event.clipboardData as DataTransfer,
        "cut"
      );
      const { selection } = this.editor;

      if (selection) {
        if (Range.isExpanded(selection)) {
          Editor.deleteFragment(this.editor);
        } else {
          const node = Node.parent(this.editor, selection.anchor.path);
          if (Editor.isVoid(this.editor, node)) {
            Transforms.delete(this.editor);
          }
        }
      }
    }
  }

  @HostListener("dragOver", ["$event"])
  public _dragOverHandler(event: DragEvent): void {
    if (
      EditableUtils.hasTarget(this.editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onDragOver)
    ) {
      // Only when the target is void, call `preventDefault` to signal
      // that drops are allowed. Editable content is droppable by
      // default, and calling `preventDefault` hides the cursor.
      const node = AngularEditor.toSlateNode(this.editor, event.target);

      if (Editor.isVoid(this.editor, node)) {
        event.preventDefault();
      }
    }
  }

  @HostListener("dragStart", ["$event"])
  public _dragStartHandler(event: DragEvent): void {
    if (
      !this.readOnly &&
      EditableUtils.hasTarget(this.editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onDragStart)
    ) {
      const node = AngularEditor.toSlateNode(this.editor, event.target);
      const path = AngularEditor.findPath(this.editor, node);
      const voidMatch =
        Editor.isVoid(this.editor, node) ||
        Editor.void(this.editor, { at: path, voids: true });

      // If starting a drag on a void node, make sure it is selected
      // so that it shows up in the selection's fragment.
      if (voidMatch) {
        const range = Editor.range(this.editor, path);
        Transforms.select(this.editor, range);
      }

      this.state.isDraggingInternally = true;

      AngularEditor.setFragmentData(
        this.editor,
        event.dataTransfer as DataTransfer,
        "drag"
      );
    }

    this.initializeContext();
  }

  @HostListener("drop", ["$event"])
  public _dropHandler(event: DragEvent): void {
    if (
      !this.readOnly &&
      EditableUtils.hasTarget(this.editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onDrop)
    ) {
      event.preventDefault();

      // Keep a reference to the dragged range before updating selection
      const draggedRange = this.editor.selection;

      // Find the range where the drop happened
      const range = AngularEditor.findEventRange(this.editor, event);
      const data = event.dataTransfer as DataTransfer;

      Transforms.select(this.editor, range);

      if (this.state.isDraggingInternally) {
        if (
          draggedRange &&
          !Range.equals(draggedRange, range) &&
          !Editor.void(this.editor, { at: range, voids: true })
        ) {
          Transforms.delete(this.editor, {
            at: draggedRange,
          });
        }
      }

      AngularEditor.insertData(this.editor, data);

      // When dragging from another source into the editor, it's possible
      // that the current editor does not have focus.
      if (!AngularEditor.isFocused(this.editor)) {
        AngularEditor.focus(this.editor);
      }
    }

    this.state.isDraggingInternally = false;
  }

  @HostListener("dragEnd", ["$event"])
  public _dragEndHandler(event: DragEvent): void {
    if (
      !this.readOnly &&
      this.state.isDraggingInternally &&
      this.onDragEnd &&
      EditableUtils.hasTarget(this.editor, event.target)
    ) {
      this.onDragEnd(event);
    }

    // When dropping on a different droppable element than the current editor,
    // `onDrop` is not called. So we need to clean up in `onDragEnd` instead.
    // Note: `onDragEnd` is only called when `onDrop` is not called
    this.state.isDraggingInternally = false;
  }

  @HostListener("focus", ["$event"])
  public _focusHandler(event: FocusEvent): void {
    if (
      !this.readOnly &&
      !this.state.isUpdatingSelection &&
      EditableUtils.hasEditableTarget(this.editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onFocus)
    ) {
      const el = AngularEditor.toDOMNode(this.editor, this.editor);
      const root = AngularEditor.findDocumentOrShadowRoot(this.editor);
      this.state.latestElement = root.activeElement;

      // COMPAT: If the editor has nested editable elements, the focus
      // can go to them. In Firefox, this must be prevented because it
      // results in issues with keyboard navigation. (2017/03/30)
      if (IS_FIREFOX && event.target !== el) {
        el.focus();
        return;
      }

      IS_FOCUSED.set(this.editor, true);
    }
  }

  @HostListener("keydown", ["$event"])
  public _keydownHandler(event: KeyboardEvent): void {
    if (
      !this.readOnly &&
      EditableUtils.hasEditableTarget(this.editor, event.target)
    ) {
      this.androidInputManager?.handleKeyDown(event);

      // COMPAT: The composition end event isn't fired reliably in all browsers,
      // so we sometimes might end up stuck in a composition state even though we
      // aren't composing any more.
      if (
        AngularEditor.isComposing(this.editor) &&
        event.isComposing === false
      ) {
        IS_COMPOSING.set(this.editor, false);
        this.setIsComposing(false);
      }

      if (
        EditableUtils.isEventHandled(event, this.onKeydown) ||
        AngularEditor.isComposing(this.editor)
      ) {
        return;
      }

      const { selection } = this.editor;
      const element = this.editor.children[
        selection !== null ? selection.focus.path[0] : 0
      ];
      const isRTL = getDirection(Node.string(element)) === "rtl";

      // COMPAT: Since we prevent the default behavior on
      // `beforeinput` events, the browser doesn't think there's ever
      // any history stack to undo or redo, so we have to manage these
      // hotkeys ourselves. (2019/11/06)
      if (Hotkeys.isRedo(event)) {
        event.preventDefault();
        const maybeHistoryEditor: any = this.editor;

        if (typeof maybeHistoryEditor.redo === "function") {
          maybeHistoryEditor.redo();
        }

        return;
      }

      if (Hotkeys.isUndo(event)) {
        event.preventDefault();
        const maybeHistoryEditor: any = this.editor;

        if (typeof maybeHistoryEditor.undo === "function") {
          maybeHistoryEditor.undo();
        }

        return;
      }

      // COMPAT: Certain browsers don't handle the selection updates
      // properly. In Chrome, the selection isn't properly extended.
      // And in Firefox, the selection isn't properly collapsed.
      // (2017/10/17)
      if (Hotkeys.isMoveLineBackward(event)) {
        event.preventDefault();
        Transforms.move(this.editor, { unit: "line", reverse: true });
        return;
      }

      if (Hotkeys.isMoveLineForward(event)) {
        event.preventDefault();
        Transforms.move(this.editor, { unit: "line" });
        return;
      }

      if (Hotkeys.isExtendLineBackward(event)) {
        event.preventDefault();
        Transforms.move(this.editor, {
          unit: "line",
          edge: "focus",
          reverse: true,
        });
        return;
      }

      if (Hotkeys.isExtendLineForward(event)) {
        event.preventDefault();
        Transforms.move(this.editor, { unit: "line", edge: "focus" });
        return;
      }

      // COMPAT: If a void node is selected, or a zero-width text node
      // adjacent to an inline is selected, we need to handle these
      // hotkeys manually because browsers won't be able to skip over
      // the void node with the zero-width space not being an empty
      // string.
      if (Hotkeys.isMoveBackward(event)) {
        event.preventDefault();

        if (selection && Range.isCollapsed(selection)) {
          Transforms.move(this.editor, { reverse: !isRTL });
        } else {
          Transforms.collapse(this.editor, { edge: "start" });
        }

        return;
      }

      if (Hotkeys.isMoveForward(event)) {
        event.preventDefault();

        if (selection && Range.isCollapsed(selection)) {
          Transforms.move(this.editor, { reverse: isRTL });
        } else {
          Transforms.collapse(this.editor, { edge: "end" });
        }

        return;
      }

      if (Hotkeys.isMoveWordBackward(event)) {
        event.preventDefault();

        if (selection && Range.isExpanded(selection)) {
          Transforms.collapse(this.editor, { edge: "focus" });
        }

        Transforms.move(this.editor, { unit: "word", reverse: !isRTL });
        return;
      }

      if (Hotkeys.isMoveWordForward(event)) {
        event.preventDefault();

        if (selection && Range.isExpanded(selection)) {
          Transforms.collapse(this.editor, { edge: "focus" });
        }

        Transforms.move(this.editor, { unit: "word", reverse: isRTL });
        return;
      }

      // COMPAT: Certain browsers don't support the `beforeinput` event, so we
      // fall back to guessing at the input intention for hotkeys.
      // COMPAT: In iOS, some of these hotkeys are handled in the
      if (!HAS_BEFORE_INPUT_SUPPORT) {
        // We don't have a core behavior for these, but they change the
        // DOM if we don't prevent them, so we have to.
        if (
          Hotkeys.isBold(event) ||
          Hotkeys.isItalic(event) ||
          Hotkeys.isTransposeCharacter(event)
        ) {
          event.preventDefault();
          return;
        }

        if (Hotkeys.isSoftBreak(event)) {
          event.preventDefault();
          Editor.insertSoftBreak(this.editor);
          return;
        }

        if (Hotkeys.isSplitBlock(event)) {
          event.preventDefault();
          Editor.insertBreak(this.editor);
          return;
        }

        if (Hotkeys.isDeleteBackward(event)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(this.editor, {
              direction: "backward",
            });
          } else {
            Editor.deleteBackward(this.editor);
          }

          return;
        }

        if (Hotkeys.isDeleteForward(event)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(this.editor, {
              direction: "forward",
            });
          } else {
            Editor.deleteForward(this.editor);
          }

          return;
        }

        if (Hotkeys.isDeleteLineBackward(event)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(this.editor, {
              direction: "backward",
            });
          } else {
            Editor.deleteBackward(this.editor, { unit: "line" });
          }

          return;
        }

        if (Hotkeys.isDeleteLineForward(event)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(this.editor, {
              direction: "forward",
            });
          } else {
            Editor.deleteForward(this.editor, { unit: "line" });
          }

          return;
        }

        if (Hotkeys.isDeleteWordBackward(event)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(this.editor, {
              direction: "backward",
            });
          } else {
            Editor.deleteBackward(this.editor, { unit: "word" });
          }

          return;
        }

        if (Hotkeys.isDeleteWordForward(event)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(this.editor, {
              direction: "forward",
            });
          } else {
            Editor.deleteForward(this.editor, { unit: "word" });
          }

          return;
        }
      } else {
        if (IS_CHROME || IS_SAFARI) {
          // COMPAT: Chrome and Safari support `beforeinput` event but do not fire
          // an event when deleting backwards in a selected void inline node
          if (
            selection &&
            (Hotkeys.isDeleteBackward(event) ||
              Hotkeys.isDeleteForward(event)) &&
            Range.isCollapsed(selection)
          ) {
            const currentNode = Node.parent(this.editor, selection.anchor.path);

            if (
              Element.isElement(currentNode) &&
              Editor.isVoid(this.editor, currentNode) &&
              Editor.isInline(this.editor, currentNode)
            ) {
              event.preventDefault();
              Editor.deleteBackward(this.editor, {
                unit: "block",
              });

              return;
            }
          }
        }
      }
    }
  }

  @HostListener("paste", ["$event"])
  public _pasteHandler(event: ClipboardEvent): void {
    if (
      !this.readOnly &&
      EditableUtils.hasEditableTarget(this.editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onPaste)
    ) {
      // COMPAT: Certain browsers don't support the `beforeinput` event, so we
      // fall back to Angular's `onPaste` here instead.
      // COMPAT: Firefox, Chrome and Safari don't emit `beforeinput` events
      // when "paste without formatting" is used, so fallback. (2020/02/20)
      if (!HAS_BEFORE_INPUT_SUPPORT || isPlainTextOnlyPaste(event)) {
        event.preventDefault();
        AngularEditor.insertData(
          this.editor,
          event.clipboardData as DataTransfer
        );
      }
    }
  }

  // #endregion
}

export class EditableUtils {
  /**
   * Check if the target is editable and in the editor.
   */

  static hasEditableTarget = (
    editor: AngularEditor,
    target: EventTarget | null
  ): target is DOMNode => {
    return (
      isDOMNode(target) &&
      AngularEditor.hasDOMNode(editor, target, { editable: true })
    );
  };

  /**
   * Check if the target is in the editor.
   */

  static hasTarget = (
    editor: AngularEditor,
    target: EventTarget | null
  ): target is DOMNode => {
    return isDOMNode(target) && AngularEditor.hasDOMNode(editor, target);
  };

  /**
   * Check if the target is inside void and in an non-readonly editor.
   */

  static isTargetInsideNonReadonlyVoid = (
    editor: AngularEditor,
    target: EventTarget | null
  ): boolean => {
    if (IS_READ_ONLY.get(editor)) return false;

    const slateNode =
      EditableUtils.hasTarget(editor, target) &&
      AngularEditor.toSlateNode(editor, target);
    return Editor.isVoid(editor, slateNode);
  };

  /**
   * A default implement to scroll dom range into view.
   */
  static scrollSelectionIntoView = (
    editor: AngularEditor,
    domRange: DOMRange
  ) => {
    // This was affecting the selection of multiple blocks and dragging behavior,
    // so enabled only if the selection has been collapsed.
    if (
      !editor.selection ||
      (editor.selection && Range.isCollapsed(editor.selection))
    ) {
      const leafEl = domRange.startContainer.parentElement!;
      leafEl.getBoundingClientRect = domRange.getBoundingClientRect.bind(
        domRange
      );
      leafEl.scrollIntoView();
      delete leafEl.getBoundingClientRect;
    }
  };

  /**
   * Check if a DOM event is overrided by a handler.
   */

  static isEventHandled = <E extends Event>(
    event: E,
    handler?: (event: E) => void | boolean
  ) => {
    if (!handler) {
      return false;
    }

    // The custom event handler may return a boolean to specify whether the event
    // shall be treated as being handled or not.
    const shouldTreatEventAsHandled = handler(event);

    if (shouldTreatEventAsHandled != null) {
      return shouldTreatEventAsHandled;
    }

    return event.defaultPrevented;
  };

  /**
   * A default memoized decorate function.
   */

  static decorate: (
    entry: NodeEntry
  ) => { [key in string]: string | number | BasePoint | boolean }[] = () => [];

  static hasStringTarget = (domSelection: DOMSelection) => {
    return (
      (domSelection.anchorNode.parentElement.hasAttribute(
        "data-slate-string"
      ) ||
        domSelection.anchorNode.parentElement.hasAttribute(
          "data-slate-zero-width"
        )) &&
      (domSelection.focusNode.parentElement.hasAttribute("data-slate-string") ||
        domSelection.focusNode.parentElement.hasAttribute(
          "data-slate-zero-width"
        ))
    );
  };
}

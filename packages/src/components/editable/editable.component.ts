import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  forwardRef,
  HostBinding,
  HostListener,
  Injector,
  Input,
  NgZone,
  OnChanges,
  OnInit,
  SimpleChanges,
  ViewChild,
} from "@angular/core";
import { NG_VALUE_ACCESSOR } from "@angular/forms";
import getDirection from "direction";
import {
  BasePoint,
  Editor,
  Element,
  Node,
  NodeEntry,
  Path,
  Range,
  Text,
  Transforms,
} from "slate";
import { AndroidInputManager } from "slate-angular/hooks/android-input-manager/android-input-manager";
import { useAndroidInputManager } from "slate-angular/hooks/android-input-manager/use-android-input-manager";
import { useTrackUserInput } from "slate-angular/hooks/use-track-user-input";
import {
  debounce,
  SlateErrorCode,
  SlatePlaceholder,
  throttle,
  ViewType,
} from "slate-angular/types";
import { check, normalize } from "slate-angular/utils";
import { TRIPLE_CLICK } from "slate-angular/utils/constants";
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
} from "slate-angular/utils/environment";
import {
  SlateChildrenContext,
  SlateViewContext,
} from "slate-angular/view/context";
import { AngularEditor } from "../../plugins/angular-editor";
import { UseRef, useRef } from "../../types/react-workaround";
import {
  DOMElement,
  DOMNode,
  DOMRange,
  DOMText,
  getDefaultView,
  isDOMElement,
  isDOMNode,
  isPlainTextOnlyPaste,
} from "../../utils/dom";
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
  selector: "slate-editable-2",
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
      useExisting: forwardRef(() => Editable2Component),
      multi: true,
    },
  ],
})
export class Editable2Component implements OnInit, OnChanges {
  public viewContext: SlateViewContext;
  public context: SlateChildrenContext;

  @Input()
  public editor: AngularEditor;

  @Input()
  public readOnly: boolean;

  @Input()
  public placeholder: string;

  @Input()
  public renderElement: (element: Element) => ViewType | null;

  @Input()
  public renderLeaf: (text: Text) => ViewType | null;

  @Input()
  public renderText: (text: Text) => ViewType | null;

  @Input()
  public isStrictDecorate: boolean = true;

  @Input()
  public trackBy: (node: Element) => any = () => null;

  @Input()
  public decorate: (entry: NodeEntry) => Range[] = () => [];

  @Input()
  public placeholderDecorate: (editor: Editor) => SlatePlaceholder[];

  // #region input event handler

  @Input()
  public onBeforeInput: (event: InputEvent) => void;

  @Input()
  public onBlur: (event: FocusEvent) => void;

  @Input()
  public onFocus: (event: FocusEvent) => void;

  @Input()
  public onClick: (event: MouseEvent) => void;

  @Input()
  public onCompositionEnd: (event: CompositionEvent) => void;

  @Input()
  public onCompositionUpdate: (event: CompositionEvent) => void;

  @Input()
  public onCompositionStart: (event: CompositionEvent) => void;

  @Input()
  public onCopy: (event: ClipboardEvent) => void;

  @Input()
  public onCut: (event: ClipboardEvent) => void;

  @Input()
  public onPaste: (event: ClipboardEvent) => void;

  @Input()
  public onDragOver: (event: DragEvent) => void;

  @Input()
  public onDragStart: (event: DragEvent) => void;

  @Input()
  public onDrop: (event: DragEvent) => void;

  @Input()
  public onDragEnd: (event: DragEvent) => void;

  @Input()
  public onKeydown: (event: KeyboardEvent) => void;

  // #endregion

  // #region DOM attr

  @Input()
  public spellCheck = false;

  @Input()
  public autoCorrect = false;

  @Input()
  public autoCapitalize = false;

  @HostBinding("attr.data-slate-editor")
  public dataSlateEditor = true;

  @HostBinding("attr.data-slate-node")
  public dataSlateNode = "value";

  @HostBinding("attr.data-gramm")
  public dataGramm = false;

  get hasBeforeInputSupport() {
    return HAS_BEFORE_INPUT_SUPPORT;
  }

  // #endregion

  @ViewChild("templateComponent", { static: true })
  private templateComponent: SlateStringTemplateComponent;


  @ViewChild('templateComponent', { static: true, read: ElementRef })
  private templateElementRef: ElementRef<any>;

  private isComposing = false;

  private deferredOperations = useRef<DeferredOperation[]>([]);

  private readonly state: EditableState = {
    isDraggingInternally: false,
    isUpdatingSelection: false,
    latestElement: null as DOMElement | null,
    hasMarkPlaceholder: false,
  };

  private onUserInput!: () => void;
  private onReRender!: () => void;
  public receivedUserInput!: UseRef<boolean>;

  private androidInputManager!: AndroidInputManager;

  private get ref(): { current: HTMLElement | null } {
    return { current: this.elementRef?.nativeElement };
  }

  private _scheduleOnDOMSelectionChangeTimer: number;

  private readonly onDOMSelectionChange = throttle(() => {
    this.onSelectionChangeHandlerInner();
  }, 100);

  private readonly scheduleOnSelectionChange = debounce(
    this.onDOMSelectionChange.bind(this),
    0
  );

  private readonly scheduleOnDOMSelectionChangeFlush = () => {
    window.clearTimeout(this._scheduleOnDOMSelectionChangeTimer);
  };

  private setIsComposing(isComposing: boolean): void {
    if (this.isComposing !== isComposing) {
      this.isComposing = isComposing;
      this.cdRef.detectChanges();
    }
  }

  private onChange(): void {
    this.onChangeCallback(this.editor.children);
  }

  constructor(
    private readonly elementRef: ElementRef<HTMLElement>,
    private readonly cdRef: ChangeDetectorRef,
    private readonly ngZone: NgZone,
    private readonly injector: Injector
  ) {}

  ngOnInit(): void {
    const editor = this.editor;
    const state = this.state;

    editor.injector = this.injector;
    editor.children = [];
    let window = getDefaultView(this.elementRef.nativeElement);

    EDITOR_TO_WINDOW.set(editor, window);
    EDITOR_TO_ELEMENT.set(editor, this.elementRef.nativeElement);
    NODE_TO_ELEMENT.set(editor, this.elementRef.nativeElement);
    ELEMENT_TO_NODE.set(this.elementRef.nativeElement, editor);
    IS_READ_ONLY.set(editor, this.readOnly);
    EDITOR_TO_ON_CHANGE.set(editor, () => {
      this.ngZone.run(() => {
        this.onChange();
      });
    });

    const { onUserInput, receivedUserInput, onReRender } = useTrackUserInput(
      editor
    );

    this.onUserInput = onUserInput;
    this.receivedUserInput = receivedUserInput;
    this.onReRender = onReRender;

    this.androidInputManager = useAndroidInputManager(editor, {
      node: this.elementRef.nativeElement,
      onDOMSelectionChange: throttle(this.scheduleOnSelectionChange, 100),
      scheduleOnDOMSelectionChange: debounce(this.scheduleOnSelectionChange, 0),
    });

    const decorations = this.decorate([editor, []]);

    if (
      this.placeholder &&
      editor.children.length === 1 &&
      Array.from(Node.texts(editor)).length === 1 &&
      Node.string(editor) === "" &&
      !this.isComposing
    ) {
      const start = Editor.start(editor, []);
      decorations.push({
        [PLACEHOLDER_SYMBOL]: true,
        placeholder: this.placeholder,
        anchor: start,
        focus: start,
      } as any);
    }

    const { marks } = editor;
    state.hasMarkPlaceholder = false;

    if (editor.selection && Range.isCollapsed(editor.selection) && marks) {
      const { anchor } = editor.selection;
      const { text, ...rest } = Node.leaf(editor, anchor.path);

      if (!Text.equals(rest as Text, marks as Text, { loose: true })) {
        state.hasMarkPlaceholder = true;

        const unset = Object.keys(rest)
          .map((mark) => [mark, null])
          .reduce((acc, cur) => {
            return {
              ...acc,
              [cur[0]]: cur[1],
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

    this.initializeViewContext();
    this.initializeContext();

    // remove unused DOM, just keep templateComponent instance
    this.templateElementRef.nativeElement.remove();

    // add browser class
    let browserClass = IS_FIREFOX ? "firefox" : IS_SAFARI ? "safari" : "";
    browserClass && this.elementRef.nativeElement.classList.add(browserClass);

    this.isomorphicLayoutEffect();
  }

  ngOnChanges(simpleChanges: SimpleChanges) {
    setTimeout(() => {
      EDITOR_TO_PENDING_INSERTION_MARKS.set(this.editor, this.editor.marks);
    });

    // The autoFocus TextareaHTMLAttribute doesn't do anything on a div, so it
    // needs to be manually focused.
    if (simpleChanges.autoFocus?.currentValue) {
      this.elementRef.nativeElement.focus();
    }

    this.isomorphicLayoutEffect();

    this.cdRef.detectChanges();
  }

  private onTouchedCallback: () => void = () => {};

  private onChangeCallback: (_: any) => void = () => {};

  registerOnChange(fn: any) {
    this.onChangeCallback = fn;
  }
  registerOnTouched(fn: any) {
    this.onTouchedCallback = fn;
  }

  public writeValue(value: Element[]): void {
    if (value && value.length) {
      if (check(value)) {
        this.editor.children = value;
      } else {
        this.editor.onError({
          code: SlateErrorCode.InvalidValueError,
          name: "initialize invalid data",
          data: value,
        });
        this.editor.children = normalize(value);
      }
      this.initializeContext();
      this.cdRef.markForCheck();
    }
  }

  @HostListener("document:selectionchange", [])
  public onSelectionChangeHandler(): void {
    this.scheduleOnSelectionChange();
  }

  private onSelectionChangeHandlerInner(): void {
    const editor = this.editor;
    const state = this.state;
    const androidInputManager = this.androidInputManager;

    if (
      (IS_ANDROID || !AngularEditor.isComposing(editor)) &&
      (!state.isUpdatingSelection || androidInputManager?.isFlushing()) &&
      !state.isDraggingInternally
    ) {
      const root = AngularEditor.findDocumentOrShadowRoot(editor);
      const { activeElement } = root;
      const el = AngularEditor.toDOMNode(editor, editor);
      const domSelection = root.getSelection();

      if (activeElement === el) {
        state.latestElement = activeElement;
        IS_FOCUSED.set(editor, true);
      } else {
        IS_FOCUSED.delete(editor);
      }

      if (!domSelection) {
        return Transforms.deselect(editor);
      }

      const { anchorNode, focusNode } = domSelection;

      const anchorNodeSelectable =
        EditableUtils.hasEditableTarget(editor, anchorNode) ||
        EditableUtils.isTargetInsideNonReadonlyVoid(editor, anchorNode);

      const focusNodeSelectable =
        EditableUtils.hasEditableTarget(editor, focusNode) ||
        EditableUtils.isTargetInsideNonReadonlyVoid(editor, focusNode);

      if (anchorNodeSelectable && focusNodeSelectable) {
        const range = AngularEditor.toSlateRange(editor, domSelection, {
          exactMatch: false,
          suppressThrow: true,
        });

        if (range) {
          if (
            !AngularEditor.isComposing(editor) &&
            !androidInputManager?.hasPendingDiffs() &&
            !androidInputManager?.isFlushing()
          ) {
            Transforms.select(editor, range);
          } else {
            androidInputManager?.handleUserSelect(range);
          }
        }
      }
    }
  }

  @HostListener("beforeinput", ["$event"])
  public onBeforeInputHandler(event: InputEvent): void {
    const editor = this.editor;

    this.onUserInput();

    if (
      !this.readOnly &&
      EditableUtils.hasEditableTarget(editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onBeforeInput)
    ) {
      // COMPAT: BeforeInput events aren't cancelable on android, so we have to handle them differently using the android input manager.
      if (this.androidInputManager) {
        return this.androidInputManager.handleDOMBeforeInput(event);
      }

      // Some IMEs/Chrome extensions like e.g. Grammarly set the selection immediately before
      // triggering a `beforeinput` expecting the change to be applied to the immediately before
      // set selection.
      this.scheduleOnSelectionChange.flush();
      this.onDOMSelectionChange.flush();

      const { selection } = editor;
      const { inputType: type } = event;
      const data = (event as any).dataTransfer || event.data || undefined;

      // These two types occur while a user is composing text and can't be
      // cancelled. Let them through and wait for the composition to end.
      if (
        type === "insertCompositionText" ||
        type === "deleteCompositionText"
      ) {
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
        if (editor.marks) {
          native = false;
        }

        // Chrome also has issues correctly editing the end of anchor elements: https://bugs.chromium.org/p/chromium/issues/detail?id=1259100
        // Therefore we don't allow native events to insert text at the end of anchor nodes.
        const { anchor } = selection;

        const [node, offset] = AngularEditor.toDOMPoint(editor, anchor);
        const anchorNode = node.parentElement?.closest("a");

        if (anchorNode && AngularEditor.hasDOMNode(editor, anchorNode)) {
          const { document } = AngularEditor.getWindow(editor);

          // Find the last text node inside the anchor.
          const lastText = document
            .createTreeWalker(anchorNode, NodeFilter.SHOW_TEXT)
            .lastChild() as DOMText | null;

          if (lastText === node && lastText.textContent?.length === offset) {
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
          const range = AngularEditor.toSlateRange(editor, targetRange, {
            exactMatch: false,
            suppressThrow: false,
          });

          if (!selection || !Range.equals(selection, range)) {
            native = false;

            const selectionRef =
              editor.selection && Editor.rangeRef(editor, editor.selection);

            Transforms.select(editor, range);

            if (selectionRef) {
              EDITOR_TO_USER_SELECTION.set(editor, selectionRef);
            }
          }
        }
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
        Editor.deleteFragment(editor, { direction });
        return;
      }

      switch (type) {
        case "deleteByComposition":
        case "deleteByCut":
        case "deleteByDrag": {
          Editor.deleteFragment(editor);
          break;
        }

        case "deleteContent":
        case "deleteContentForward": {
          Editor.deleteForward(editor);
          break;
        }

        case "deleteContentBackward": {
          Editor.deleteBackward(editor);
          break;
        }

        case "deleteEntireSoftLine": {
          Editor.deleteBackward(editor, { unit: "line" });
          Editor.deleteForward(editor, { unit: "line" });
          break;
        }

        case "deleteHardLineBackward": {
          Editor.deleteBackward(editor, { unit: "block" });
          break;
        }

        case "deleteSoftLineBackward": {
          Editor.deleteBackward(editor, { unit: "line" });
          break;
        }

        case "deleteHardLineForward": {
          Editor.deleteForward(editor, { unit: "block" });
          break;
        }

        case "deleteSoftLineForward": {
          Editor.deleteForward(editor, { unit: "line" });
          break;
        }

        case "deleteWordBackward": {
          Editor.deleteBackward(editor, { unit: "word" });
          break;
        }

        case "deleteWordForward": {
          Editor.deleteForward(editor, { unit: "word" });
          break;
        }

        case "insertLineBreak":
          Editor.insertSoftBreak(editor);
          break;

        case "insertParagraph": {
          Editor.insertBreak(editor);
          break;
        }

        case "insertFromComposition":
        case "insertFromDrop":
        case "insertFromPaste":
        case "insertFromYank":
        case "insertReplacementText":
        case "insertText": {
          const { selection } = editor;
          if (selection) {
            if (Range.isExpanded(selection)) {
              Editor.deleteFragment(editor);
            }
          }

          if (type === "insertFromComposition") {
            // COMPAT: in Safari, `compositionend` is dispatched after the
            // `beforeinput` for "insertFromComposition". But if we wait for it
            // then we will abort because we're still composing and the selection
            // won't be updated properly.
            // https://www.w3.org/TR/input-events-2/
            if (AngularEditor.isComposing(editor)) {
              this.setIsComposing(false);
              IS_COMPOSING.set(editor, false);
            }
          }

          // use a weak comparison instead of 'instanceof' to allow
          // programmatic access of paste events coming from external windows
          // like cypress where cy.window does not work realibly
          if (data?.constructor.name === "DataTransfer") {
            AngularEditor.insertData(editor, data);
          } else if (typeof data === "string") {
            // Only insertText operations use the native functionality, for now.
            // Potentially expand to single character deletes, as well.
            if (native) {
              this.deferredOperations.current.push(() =>
                Editor.insertText(editor, data)
              );
            } else {
              Editor.insertText(editor, data);
            }
          }

          break;
        }
      }

      // Restore the actual user section if nothing manually set it.
      const toRestore = EDITOR_TO_USER_SELECTION.get(editor)?.unref();
      EDITOR_TO_USER_SELECTION.delete(editor);

      if (
        toRestore &&
        (!editor.selection || !Range.equals(editor.selection, toRestore))
      ) {
        Transforms.select(editor, toRestore);
      }
    }
  }

  @HostListener("input", ["$event"])
  public onInputHandler(event: InputEvent): void {
    const androidInputManager = this.androidInputManager;
    const deferredOperations = this.deferredOperations;

    if (androidInputManager) {
      androidInputManager.handleInput();
      return;
    }

    // Flush native operations, as native events will have propogated
    // and we can correctly compare DOM text values in components
    // to stop rendering, so that browser functions like autocorrect
    // and spellcheck work as expected.
    for (const op of deferredOperations.current) {
      op();
    }
    deferredOperations.current = [];
  }

  @HostListener("blur", ["$event"])
  public onBlurHandler(event: FocusEvent): void {
    const editor = this.editor;
    const state = this.state;

    if (
      this.readOnly ||
      state.isUpdatingSelection ||
      !EditableUtils.hasEditableTarget(editor, event.target) ||
      EditableUtils.isEventHandled(event, this.onBlur)
    ) {
      return;
    }

    // COMPAT: If the current `activeElement` is still the previous
    // one, this is due to the window being blurred when the tab
    // itself becomes unfocused, so we want to abort early to allow to
    // editor to stay focused when the tab becomes focused again.
    const root = AngularEditor.findDocumentOrShadowRoot(editor);
    if (state.latestElement === root.activeElement) {
      return;
    }

    const relatedTarget = event.target;
    const el = AngularEditor.toDOMNode(editor, editor);

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
      AngularEditor.hasDOMNode(editor, relatedTarget)
    ) {
      const node = AngularEditor.toSlateNode(editor, relatedTarget);

      if (Element.isElement(node) && !editor.isVoid(node)) {
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

    IS_FOCUSED.delete(editor);
  }

  @HostListener("focus", ["$event"])
  public onFocusHandler(event: FocusEvent): void {
    const editor = this.editor;
    const state = this.state;

    if (
      !this.readOnly &&
      !state.isUpdatingSelection &&
      EditableUtils.hasEditableTarget(editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onFocus)
    ) {
      const el = AngularEditor.toDOMNode(editor, editor);
      const root = AngularEditor.findDocumentOrShadowRoot(editor);
      state.latestElement = root.activeElement;

      // COMPAT: If the editor has nested editable elements, the focus
      // can go to them. In Firefox, this must be prevented because it
      // results in issues with keyboard navigation. (2017/03/30)
      if (IS_FIREFOX && event.target !== el) {
        el.focus();
        return;
      }

      IS_FOCUSED.set(editor, true);
    }
  }

  @HostListener("click", ["$event"])
  public onClickHandler(event: MouseEvent): void {
    const editor = this.editor;
    if (
      EditableUtils.hasTarget(editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onClick) &&
      isDOMNode(event.target)
    ) {
      const node = AngularEditor.toSlateNode(editor, event.target);
      const path = AngularEditor.findPath(editor, node);

      // At this time, the Slate document may be arbitrarily different,
      // because onClick handlers can change the document before we get here.
      // Therefore we must check that this path actually exists,
      // and that it still refers to the same node.
      if (!Editor.hasPath(editor, path) || Node.get(editor, path) !== node) {
        return;
      }

      if (event.detail === TRIPLE_CLICK && path.length >= 1) {
        let blockPath = path;
        if (!Editor.isBlock(editor, node)) {
          const block = Editor.above(editor, {
            match: (n) => Editor.isBlock(editor, n),
            at: path,
          });

          blockPath = block?.[1] ?? path.slice(0, 1);
        }

        const range = Editor.range(editor, blockPath);
        Transforms.select(editor, range);
        return;
      }

      if (this.readOnly) {
        return;
      }

      const start = Editor.start(editor, path);
      const end = Editor.end(editor, path);
      const startVoid = Editor.void(editor, { at: start });
      const endVoid = Editor.void(editor, { at: end });

      if (startVoid && endVoid && Path.equals(startVoid[1], endVoid[1])) {
        const range = Editor.range(editor, start);
        Transforms.select(editor, range);
      }
    }
  }

  @HostListener("compositionEnd", ["$event"])
  public onCompositionEndHandler(event: CompositionEvent): void {
    const editor = this.editor;
    const androidInputManager = this.androidInputManager;

    if (EditableUtils.hasEditableTarget(editor, event.target)) {
      if (AngularEditor.isComposing(editor)) {
        this.setIsComposing(false);
        IS_COMPOSING.set(editor, false);
      }

      androidInputManager?.handleCompositionEnd(event);

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
        const placeholderMarks = EDITOR_TO_PENDING_INSERTION_MARKS.get(editor);
        EDITOR_TO_PENDING_INSERTION_MARKS.delete(editor);

        // Ensure we insert text with the marks the user was actually seeing
        if (placeholderMarks !== undefined) {
          EDITOR_TO_USER_MARKS.set(editor, editor.marks);
          editor.marks = placeholderMarks;
        }

        Editor.insertText(editor, event.data);

        const userMarks = EDITOR_TO_USER_MARKS.get(editor);
        EDITOR_TO_USER_MARKS.delete(editor);
        if (userMarks !== undefined) {
          editor.marks = userMarks;
        }
      }
    }
  }

  @HostListener("compositionUpdate", ["$event"])
  public onCompositionUpdateHandler(event: CompositionEvent): void {
    const editor = this.editor;
    if (
      EditableUtils.hasEditableTarget(editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onCompositionUpdate)
    ) {
      if (!AngularEditor.isComposing(editor)) {
        this.setIsComposing(true);
        IS_COMPOSING.set(editor, true);
      }
    }
  }

  @HostListener("compositionStart", ["$event"])
  public onCompositionStartHandler(event: CompositionEvent): void {
    const editor = this.editor;
    const androidInputManager = this.androidInputManager;

    if (EditableUtils.hasEditableTarget(editor, event.target)) {
      androidInputManager?.handleCompositionStart(event);

      if (
        EditableUtils.isEventHandled(event, this.onCompositionStart) ||
        IS_ANDROID
      ) {
        return;
      }

      this.setIsComposing(true);

      const { selection } = editor;
      if (selection) {
        if (Range.isExpanded(selection)) {
          Editor.deleteFragment(editor);
          return;
        }
        const inline = Editor.above(editor, {
          match: (n) => Editor.isInline(editor, n),
          mode: "highest",
        });
        if (inline) {
          const [, inlinePath] = inline;
          if (Editor.isEnd(editor, selection.anchor, inlinePath)) {
            const point = Editor.after(editor, inlinePath)!;
            Transforms.setSelection(editor, {
              anchor: point,
              focus: point,
            });
          }
        }
      }
    }
  }

  @HostListener("copy", ["$event"])
  public onCopyHandler(event: ClipboardEvent): void {
    const editor = this.editor;
    if (
      EditableUtils.hasEditableTarget(editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onCopy)
    ) {
      event.preventDefault();
      AngularEditor.setFragmentData(editor, event.clipboardData, "copy");
    }
  }

  @HostListener("cut", ["$event"])
  public onCutHandler(event: ClipboardEvent): void {
    const editor = this.editor;
    if (
      !this.readOnly &&
      EditableUtils.hasEditableTarget(editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onCut)
    ) {
      event.preventDefault();
      AngularEditor.setFragmentData(editor, event.clipboardData, "cut");
      const { selection } = editor;

      if (selection) {
        if (Range.isExpanded(selection)) {
          Editor.deleteFragment(editor);
        } else {
          const node = Node.parent(editor, selection.anchor.path);
          if (Editor.isVoid(editor, node)) {
            Transforms.delete(editor);
          }
        }
      }
    }
  }

  @HostListener("paste", ["$event"])
  public onPasteHandler(event: ClipboardEvent): void {
    const editor = this.editor;
    if (
      !this.readOnly &&
      EditableUtils.hasEditableTarget(editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onPaste)
    ) {
      // COMPAT: Certain browsers don't support the `beforeinput` event, so we
      // fall back to React's `onPaste` here instead.
      // COMPAT: Firefox, Chrome and Safari don't emit `beforeinput` events
      // when "paste without formatting" is used, so fallback. (2020/02/20)
      if (!HAS_BEFORE_INPUT_SUPPORT || isPlainTextOnlyPaste(event)) {
        event.preventDefault();
        AngularEditor.insertData(editor, event.clipboardData);
      }
    }
  }

  @HostListener("dragOver", ["$event"])
  public onDragOverHandler(event: DragEvent): void {
    const editor = this.editor;
    if (
      EditableUtils.hasTarget(editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onDragOver)
    ) {
      // Only when the target is void, call `preventDefault` to signal
      // that drops are allowed. Editable content is droppable by
      // default, and calling `preventDefault` hides the cursor.
      const node = AngularEditor.toSlateNode(editor, event.target);

      if (Editor.isVoid(editor, node)) {
        event.preventDefault();
      }
    }
  }

  @HostListener("dragStart", ["$event"])
  public onDragStartHandler(event: DragEvent): void {
    const editor = this.editor;
    const state = this.state;

    if (
      !this.readOnly &&
      EditableUtils.hasTarget(editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onDragStart)
    ) {
      const node = AngularEditor.toSlateNode(editor, event.target);
      const path = AngularEditor.findPath(editor, node);
      const voidMatch =
        Editor.isVoid(editor, node) ||
        Editor.void(editor, { at: path, voids: true });

      // If starting a drag on a void node, make sure it is selected
      // so that it shows up in the selection's fragment.
      if (voidMatch) {
        const range = Editor.range(editor, path);
        Transforms.select(editor, range);
      }

      state.isDraggingInternally = true;

      AngularEditor.setFragmentData(editor, event.dataTransfer, "drag");
    }
  }

  @HostListener("drop", ["$event"])
  public onDropHandler(event: DragEvent): void {
    const editor = this.editor;
    const state = this.state;

    if (
      !this.readOnly &&
      EditableUtils.hasTarget(editor, event.target) &&
      !EditableUtils.isEventHandled(event, this.onDrop)
    ) {
      event.preventDefault();

      // Keep a reference to the dragged range before updating selection
      const draggedRange = editor.selection;

      // Find the range where the drop happened
      const range = AngularEditor.findEventRange(editor, event);
      const data = event.dataTransfer;

      Transforms.select(editor, range);

      if (state.isDraggingInternally) {
        if (
          draggedRange &&
          !Range.equals(draggedRange, range) &&
          !Editor.void(editor, { at: range, voids: true })
        ) {
          Transforms.delete(editor, {
            at: draggedRange,
          });
        }
      }

      AngularEditor.insertData(editor, data);

      // When dragging from another source into the editor, it's possible
      // that the current editor does not have focus.
      if (!AngularEditor.isFocused(editor)) {
        AngularEditor.focus(editor);
      }
    }

    state.isDraggingInternally = false;
  }

  @HostListener("dragEnd", ["$event"])
  public onDragEndHandler(event: DragEvent): void {
    const editor = this.editor;
    const state = this.state;

    if (
      !this.readOnly &&
      state.isDraggingInternally &&
      this.onDragEnd &&
      EditableUtils.hasTarget(editor, event.target)
    ) {
      this.onDragEnd(event);
    }

    // When dropping on a different droppable element than the current editor,
    // `onDrop` is not called. So we need to clean up in `onDragEnd` instead.
    // Note: `onDragEnd` is only called when `onDrop` is not called
    state.isDraggingInternally = false;
  }

  @HostListener("keydown", ["$event"])
  public onKeyDownHandler(event: KeyboardEvent): void {
    const editor = this.editor;
    if (
      !this.readOnly &&
      EditableUtils.hasEditableTarget(editor, event.target)
    ) {
      const nativeEvent = event;

      // COMPAT: The composition end event isn't fired reliably in all browsers,
      // so we sometimes might end up stuck in a composition state even though we
      // aren't composing any more.
      if (
        AngularEditor.isComposing(editor) &&
        nativeEvent.isComposing === false
      ) {
        IS_COMPOSING.set(editor, false);
        this.setIsComposing(false);
      }

      if (
        EditableUtils.isEventHandled(event, this.onKeydown) ||
        AngularEditor.isComposing(editor)
      ) {
        return;
      }

      const { selection } = editor;
      const element =
        editor.children[selection !== null ? selection.focus.path[0] : 0];
      const isRTL = getDirection(Node.string(element)) === "rtl";

      // COMPAT: Since we prevent the default behavior on
      // `beforeinput` events, the browser doesn't think there's ever
      // any history stack to undo or redo, so we have to manage these
      // hotkeys ourselves. (2019/11/06)
      if (Hotkeys.isRedo(nativeEvent)) {
        event.preventDefault();
        const maybeHistoryEditor: any = editor;

        if (typeof maybeHistoryEditor.redo === "function") {
          maybeHistoryEditor.redo();
        }

        return;
      }

      if (Hotkeys.isUndo(nativeEvent)) {
        event.preventDefault();
        const maybeHistoryEditor: any = editor;

        if (typeof maybeHistoryEditor.undo === "function") {
          maybeHistoryEditor.undo();
        }

        return;
      }

      // COMPAT: Certain browsers don't handle the selection updates
      // properly. In Chrome, the selection isn't properly extended.
      // And in Firefox, the selection isn't properly collapsed.
      // (2017/10/17)
      if (Hotkeys.isMoveLineBackward(nativeEvent)) {
        event.preventDefault();
        Transforms.move(editor, { unit: "line", reverse: true });
        return;
      }

      if (Hotkeys.isMoveLineForward(nativeEvent)) {
        event.preventDefault();
        Transforms.move(editor, { unit: "line" });
        return;
      }

      if (Hotkeys.isExtendLineBackward(nativeEvent)) {
        event.preventDefault();
        Transforms.move(editor, {
          unit: "line",
          edge: "focus",
          reverse: true,
        });
        return;
      }

      if (Hotkeys.isExtendLineForward(nativeEvent)) {
        event.preventDefault();
        Transforms.move(editor, { unit: "line", edge: "focus" });
        return;
      }

      // COMPAT: If a void node is selected, or a zero-width text node
      // adjacent to an inline is selected, we need to handle these
      // hotkeys manually because browsers won't be able to skip over
      // the void node with the zero-width space not being an empty
      // string.
      if (Hotkeys.isMoveBackward(nativeEvent)) {
        event.preventDefault();

        if (selection && Range.isCollapsed(selection)) {
          Transforms.move(editor, { reverse: !isRTL });
        } else {
          Transforms.collapse(editor, { edge: "start" });
        }

        return;
      }

      if (Hotkeys.isMoveForward(nativeEvent)) {
        event.preventDefault();

        if (selection && Range.isCollapsed(selection)) {
          Transforms.move(editor, { reverse: isRTL });
        } else {
          Transforms.collapse(editor, { edge: "end" });
        }

        return;
      }

      if (Hotkeys.isMoveWordBackward(nativeEvent)) {
        event.preventDefault();

        if (selection && Range.isExpanded(selection)) {
          Transforms.collapse(editor, { edge: "focus" });
        }

        Transforms.move(editor, { unit: "word", reverse: !isRTL });
        return;
      }

      if (Hotkeys.isMoveWordForward(nativeEvent)) {
        event.preventDefault();

        if (selection && Range.isExpanded(selection)) {
          Transforms.collapse(editor, { edge: "focus" });
        }

        Transforms.move(editor, { unit: "word", reverse: isRTL });
        return;
      }

      // COMPAT: Certain browsers don't support the `beforeinput` event, so we
      // fall back to guessing at the input intention for hotkeys.
      // COMPAT: In iOS, some of these hotkeys are handled in the
      if (!HAS_BEFORE_INPUT_SUPPORT) {
        // We don't have a core behavior for these, but they change the
        // DOM if we don't prevent them, so we have to.
        if (
          Hotkeys.isBold(nativeEvent) ||
          Hotkeys.isItalic(nativeEvent) ||
          Hotkeys.isTransposeCharacter(nativeEvent)
        ) {
          event.preventDefault();
          return;
        }

        if (Hotkeys.isSoftBreak(nativeEvent)) {
          event.preventDefault();
          Editor.insertSoftBreak(editor);
          return;
        }

        if (Hotkeys.isSplitBlock(nativeEvent)) {
          event.preventDefault();
          Editor.insertBreak(editor);
          return;
        }

        if (Hotkeys.isDeleteBackward(nativeEvent)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: "backward" });
          } else {
            Editor.deleteBackward(editor);
          }

          return;
        }

        if (Hotkeys.isDeleteForward(nativeEvent)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: "forward" });
          } else {
            Editor.deleteForward(editor);
          }

          return;
        }

        if (Hotkeys.isDeleteLineBackward(nativeEvent)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: "backward" });
          } else {
            Editor.deleteBackward(editor, { unit: "line" });
          }

          return;
        }

        if (Hotkeys.isDeleteLineForward(nativeEvent)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: "forward" });
          } else {
            Editor.deleteForward(editor, { unit: "line" });
          }

          return;
        }

        if (Hotkeys.isDeleteWordBackward(nativeEvent)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: "backward" });
          } else {
            Editor.deleteBackward(editor, { unit: "word" });
          }

          return;
        }

        if (Hotkeys.isDeleteWordForward(nativeEvent)) {
          event.preventDefault();

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: "forward" });
          } else {
            Editor.deleteForward(editor, { unit: "word" });
          }

          return;
        }
      } else {
        if (IS_CHROME || IS_SAFARI) {
          // COMPAT: Chrome and Safari support `beforeinput` event but do not fire
          // an event when deleting backwards in a selected void inline node
          if (
            selection &&
            (Hotkeys.isDeleteBackward(nativeEvent) ||
              Hotkeys.isDeleteForward(nativeEvent)) &&
            Range.isCollapsed(selection)
          ) {
            const currentNode = Node.parent(editor, selection.anchor.path);

            if (
              Element.isElement(currentNode) &&
              Editor.isVoid(editor, currentNode) &&
              Editor.isInline(editor, currentNode)
            ) {
              event.preventDefault();
              Editor.deleteBackward(editor, { unit: "block" });

              return;
            }
          }
        }
      }
    }
  }

  private isomorphicLayoutEffect(): void {
    const ref = this.ref;
    const editor = this.editor;
    const androidInputManager = this.androidInputManager;
    const state = this.state;

    // Update element-related weak maps with the DOM element ref.
    let window;
    if (ref.current && (window = getDefaultView(ref.current))) {
      EDITOR_TO_WINDOW.set(editor, window);
      EDITOR_TO_ELEMENT.set(editor, ref.current);
      NODE_TO_ELEMENT.set(editor, ref.current);
      ELEMENT_TO_NODE.set(ref.current, editor);
    } else {
      NODE_TO_ELEMENT.delete(editor);
    }

    // Make sure the DOM selection state is in sync.
    const { selection } = editor;
    const root = AngularEditor.findDocumentOrShadowRoot(editor);
    const domSelection = root.getSelection();

    if (
      !domSelection ||
      !AngularEditor.isFocused(editor) ||
      androidInputManager?.hasPendingAction()
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
      const editorElement = EDITOR_TO_ELEMENT.get(editor)!;
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
        const slateRange = AngularEditor.toSlateRange(editor, domSelection, {
          exactMatch: true,

          // domSelection is not necessarily a valid Slate range
          // (e.g. when clicking on contentEditable:false element)
          suppressThrow: true,
        });

        if (slateRange && Range.equals(slateRange, selection)) {
          if (!state.hasMarkPlaceholder) {
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
      if (selection && !AngularEditor.hasRange(editor, selection)) {
        editor.selection = AngularEditor.toSlateRange(editor, domSelection, {
          exactMatch: false,
          suppressThrow: true,
        });
        return;
      }

      // Otherwise the DOM selection is out of sync, so update it.
      state.isUpdatingSelection = true;

      const newDomRange: DOMRange | null =
        selection && AngularEditor.toDOMRange(editor, selection);

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
        EditableUtils.scrollSelectionIntoView(editor, newDomRange);
      } else {
        domSelection.removeAllRanges();
      }

      return newDomRange;
    };

    const newDomRange = setDomSelection();
    const ensureSelection = androidInputManager?.isFlushing() === "action";

    if (!IS_ANDROID || !ensureSelection) {
      setTimeout(() => {
        // COMPAT: In Firefox, it's not enough to create a range, you also need
        // to focus the contenteditable element too. (2016/11/16)
        if (newDomRange && IS_FIREFOX) {
          const el = AngularEditor.toDOMNode(editor, editor);
          el.focus();
        }

        state.isUpdatingSelection = false;
      });
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const animationFrameId = requestAnimationFrame(() => {
      if (ensureSelection) {
        const ensureDomSelection = (forceChange?: boolean) => {
          try {
            const el = AngularEditor.toDOMNode(editor, editor);
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

        timeoutId = window.setTimeout(() => {
          // COMPAT: While setting the selection in an animation frame visually correctly sets the selection,
          // it doesn't update GBoards spellchecker state. We have to manually trigger a selection change after
          // the animation frame to ensure it displays the correct state.
          ensureDomSelection(true);
          state.isUpdatingSelection = false;
        });
      }
    });

    cancelAnimationFrame(animationFrameId);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  private composePlaceholderDecorate(editor: Editor) {
    if (this.placeholderDecorate) {
      return this.placeholderDecorate(editor) || [];
    }

    if (
      this.placeholder &&
      editor.children.length === 1 &&
      Array.from(Node.texts(editor)).length === 1 &&
      Node.string(editor) === ""
    ) {
      const start = Editor.start(editor, []);
      return [
        {
          placeholder: this.placeholder,
          anchor: start,
          focus: start,
        },
      ];
    } else {
      return [];
    }
  }

  private generateDecorations() {
    const editor = this.editor;
    const state = this.state;

    const decorations = this.decorate([this.editor, []]);
    const placeholderDecorations = this.isComposing
      ? []
      : this.composePlaceholderDecorate(this.editor);
    decorations.push(...placeholderDecorations);

    const { marks } = editor;
    state.hasMarkPlaceholder = false;
    if (editor.selection && Range.isCollapsed(editor.selection) && marks) {
      const { anchor } = editor.selection;
      const { text, ...rest } = Node.leaf(editor, anchor.path);
      if (!Text.equals(rest as Text, marks as Text, { loose: true })) {
        state.hasMarkPlaceholder = true;
        const unset = Object.keys(rest)
          .map((mark) => [mark, null])
          .reduce((acc, cur) => {
            return {
              ...acc,
              [cur[0]]: cur[1],
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

    return decorations;
  }

  private initializeContext() {
    this.context = {
      parent: this.editor,
      selection: this.editor.selection,
      decorations: this.generateDecorations(),
      decorate: this.decorate,
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
}

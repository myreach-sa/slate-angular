import {
  AfterContentInit,
  Component,
  ElementRef,
  Input,
  OnDestroy,
} from "@angular/core";
import { RefObject } from "../../types/react-workaround";
import { AngularEditor } from "../../plugins/angular-editor";
import { SlateChildrenContext, SlateViewContext } from "../../view/context";
import {
  createRestoreDomManager,
  RestoreDOMManager,
} from "./restore-dom-manager";

const MUTATION_OBSERVER_CONFIG: MutationObserverInit = {
  subtree: true,
  childList: true,
  characterData: true,
  characterDataOldValue: true,
};

@Component({
  selector: "restore-dom-component",
  template: `
    <ng-content></ng-content>
  `,
})
export class RestoreDOMComponent implements AfterContentInit, OnDestroy {
  @Input() editor: AngularEditor;
  @Input() receivedUserInput: RefObject<boolean>;

  viewContext: SlateViewContext;
  context: SlateChildrenContext;

  private manager: RestoreDOMManager | null = null;
  private mutationObserver: MutationObserver | null = null;

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  ngAfterContentInit(): void {
    const editor = this.editor;

    this.manager = createRestoreDomManager(editor, this.receivedUserInput);
    this.mutationObserver = new MutationObserver(
      this.manager.registerMutations
    );

    this.observe();
  }

  ngOnDestroy(): void {
    this.mutationObserver?.disconnect();
  }

  observe() {
    if (!this.elementRef.nativeElement) {
      throw new Error("Failed to attach MutationObserver, `node` is undefined");
    }

    this.mutationObserver?.observe(
      this.elementRef.nativeElement,
      MUTATION_OBSERVER_CONFIG
    );
  }
}

import { Component, ElementRef, Input, OnDestroy } from "@angular/core";
import { AngularEditor } from "../../plugins/angular-editor";
import { RefObject } from "../../types/react-workaround";
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
export class RestoreDOMComponent implements OnDestroy {
  @Input()
  public editor: AngularEditor;

  private _receivedUserInput: RefObject<boolean>;

  @Input()
  public set receivedUserInput(receivedUserInput: RefObject<boolean>) {
    if (receivedUserInput) {
      this._receivedUserInput = receivedUserInput;
      this.init();
    }
  }

  public get receivedUserInput(): RefObject<boolean> {
    return this._receivedUserInput;
  }

  @Input()
  public viewContext: SlateViewContext;

  @Input()
  public context: SlateChildrenContext;

  private manager: RestoreDOMManager | null = null;
  private mutationObserver: MutationObserver | null = null;

  private _init = false;

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  public init(): void {
    if (this._init === false) {
      this._init = true;
      const editor = this.editor;

      this.manager = createRestoreDomManager(editor, this.receivedUserInput);
      this.mutationObserver = new MutationObserver(
        this.manager.registerMutations
      );

      this.observe();
    }
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

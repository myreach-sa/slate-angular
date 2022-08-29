import {
  AfterContentChecked,
  ChangeDetectionStrategy,
  Component,
  Directive,
  DoCheck,
  ElementRef,
  Input,
  NgModule,
  OnDestroy,
} from "@angular/core";
import { AngularEditor } from "../../plugins/angular-editor";
import { UseRef } from "../../types";
import { IS_ANDROID } from "../../utils/environment";
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

@Directive({
  selector: "[slateRestoreDom]",
})
export class RestoreDOMDirective
  implements OnDestroy, AfterContentChecked, DoCheck {
  protected readonly isAndroid = IS_ANDROID;

  @Input()
  public editor!: AngularEditor;

  protected _receivedUserInput!: UseRef<boolean>;

  @Input()
  public set receivedUserInput(receivedUserInput: UseRef<boolean>) {
    if (receivedUserInput) {
      this._receivedUserInput = receivedUserInput;
      this.init();
    }
  }

  public get receivedUserInput(): UseRef<boolean> {
    return this._receivedUserInput;
  }

  protected manager: RestoreDOMManager | null = null;
  protected mutationObserver: MutationObserver | null = null;

  protected _init = false;

  constructor(protected readonly elementRef: ElementRef<HTMLElement>) {}

  public init(): void {
    if (!this.isAndroid) {
      this._init = true;
      return;
    }

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

  ngDoCheck(): void {
    const pendingMutations = this.mutationObserver?.takeRecords();
    if (pendingMutations?.length) {
      this.manager?.registerMutations(pendingMutations);
    }

    this.mutationObserver?.disconnect();
    this.manager?.restoreDOM();
  }

  ngAfterContentChecked(): void {
    if (this._init) {
      const pendingMutations = this.mutationObserver?.takeRecords();
      if (pendingMutations?.length) {
        this.manager?.registerMutations(pendingMutations);
      }

      this.mutationObserver?.disconnect();
      this.manager?.restoreDOM();
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

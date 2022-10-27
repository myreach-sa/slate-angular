import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  Renderer2,
} from "@angular/core";
import { BaseLeafComponent, EDITOR_TO_PLACEHOLDER_ELEMENT } from "slate-angular";

export enum MarkTypes {
  bold = "bold",
  italic = "italic",
  underline = "underlined",
  strike = "strike",
  code = "code-line",
}

const VALID_MARKS = Object.values(MarkTypes);

@Component({
  selector: "span[leaf]",
  template: `
    <span slateString [context]="context" [viewContext]="viewContext"
      ><span></span
    ></span>
  `,
  host: {
    "data-slate-leaf": "true",
  },
})
export class DemoLeafMarkComponent extends BaseLeafComponent {
  attributes = [];

  constructor(
    private renderer: Renderer2,
    elementRef: ElementRef,
    cdr: ChangeDetectorRef
  ) {
    super(elementRef, cdr);
  }

  applyTextMark() {
    this.attributes.forEach((attr) => {
      this.renderer.removeAttribute(this.elementRef.nativeElement, attr);
    });
    this.attributes = [];
    for (const key in this.leaf) {

      if (
        Object.prototype.hasOwnProperty.call(this.leaf, key) &&
        key !== "text" &&
        !!this.leaf[key] &&
        VALID_MARKS.includes(key as MarkTypes)
      ) {
        const attr = `slate-${key}`;
        this.renderer.setAttribute(
          this.elementRef.nativeElement,
          attr,
          this.leaf[key]
        );
        this.attributes.push(attr);
      }
    }
  }

  renderPlaceholder() {
    // issue-1: IME input was interrupted
    // issue-2: IME input focus jumping
    // Issue occurs when the span node of the placeholder is before the slateString span node
    if (this.leaf["placeholder"]) {
      if (!this.placeholderElement) {
        this.placeholderElement = document.createElement("span");
        this.placeholderElement.innerText = this.leaf["placeholder"];
        this.placeholderElement.contentEditable = "false";
        this.placeholderElement.setAttribute("data-slate-placeholder", "true");
        this.nativeElement.classList.add("leaf-with-placeholder");
        this.nativeElement.appendChild(this.placeholderElement);


        EDITOR_TO_PLACEHOLDER_ELEMENT.set(this.editor, this.placeholderElement);

      }
    } else {
      this.destroyPlaceholder();
    }
  }

  onContextChange() {
    super.onContextChange();
    this.renderPlaceholder();
    this.applyTextMark();
  }
}

import { ChangeDetectionStrategy, Component } from "@angular/core";
import { Transforms } from "slate";
import { AngularEditor, BaseElementComponent } from "slate-angular";
import { CheckListItemElement } from "../../../../custom-types";

@Component({
  selector: "div[demo-element-check-list]",
  template: `
    <div style="display: flex; flex-direction: row; align-items: center;">
        <span contentEditable="false" style="margin-right: 0.75em;">
            <input
                #checkbox
                type="checkbox"
                [checked]="element.checked"
                (change)="onCheckListChange($event)"
            />
        </span>

        <span
            style="flex: 1;"
            [style.opacity]="element.checked ? '0.666' : '1'"
            [style.textDecoration]="element.checked ? 'line-through' : 'none'"
        >
            <slate-children
                [children]="element.children"
                [context]="childrenContext"
                [viewContext]="viewContext"
            ></slate-children>
        </span>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoElementCheckListComponent extends BaseElementComponent<
  CheckListItemElement
> {
  public onCheckListChange(event: Event): void {
    const path = AngularEditor.findPath(this.editor, this.element);
    const newProperties: Partial<CheckListItemElement> = {
      checked: (event.target as HTMLInputElement).checked,
    };
    Transforms.setNodes(this.editor, newProperties, { at: path });
  }
}

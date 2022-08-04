import { Component, TemplateRef, ViewChild } from "@angular/core";
import {
  createEditor,
  Descendant,
  Element,
  Text,
  Node,
  Transforms,
} from "slate";
import { AngularEditor, withAngular } from "slate-angular";
import { withHistory } from "slate-history";
import { DemoElementCheckListComponent } from "../components/check-list/check-list.component";
import { DemoTextMarkComponent } from "../components/text/text.component";

@Component({
  selector: "demo-check-list",
  templateUrl: "check-list.component.html",
})
export class DemoCheckListComponent {
  value = initialValue;

  editor = withHistory(withAngular(createEditor()));

  renderElement = (element: Element & { type: string }) => {
    if (element.type === 'check-list-item') {
      return DemoElementCheckListComponent;
    }
    return null;
  };

  renderText = (_text: Text) => {
    return DemoTextMarkComponent;
  };

  public onCheckListChange(slateElement: Node, target: HTMLInputElement): void {
    const path = AngularEditor.findPath(this.editor, slateElement);
    const newProperties: Partial<Element> = {
      checked: target.checked,
    };
    Transforms.setNodes(this.editor, newProperties, { at: path });
  }
}

const initialValue: Descendant[] = [
  {
    type: "paragraph",
    children: [
      {
        text:
          "With Slate you can build complex block types that have their own embedded content and behaviors, like rendering checkboxes inside check list items!",
      },
    ],
  },
  {
    type: "check-list-item",
    checked: true,
    children: [{ text: "Slide to the left." }],
  },
  {
    type: "check-list-item",
    checked: true,
    children: [{ text: "Slide to the right." }],
  },
  {
    type: "check-list-item",
    checked: false,
    children: [{ text: "Criss-cross." }],
  },
  {
    type: "check-list-item",
    checked: true,
    children: [{ text: "Criss-cross!" }],
  },
  {
    type: "check-list-item",
    checked: false,
    children: [{ text: "Cha cha real smooth…" }],
  },
  {
    type: "check-list-item",
    checked: false,
    children: [{ text: "Let's go to work!" }],
  },
  {
    type: "paragraph",
    children: [{ text: "Try it out for yourself!" }],
  },
];

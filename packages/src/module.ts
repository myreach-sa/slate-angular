import { NgModule } from "@angular/core";
import { CommonModule } from "@angular/common";
import { SlateDefaultTextComponent } from "./components/text/default-text.component";
import { SlateVoidTextComponent } from "./components/text/void-text.component";
import { SlateElementComponent } from "./components/element/element.component";
import { SlateDefaultElementComponent } from "./components/element/default-element.component";
import { SlateStringComponent } from "./components/string/string.component";
import { SlateStringTemplateComponent } from "./components/string/template.component";
import { SlateDescendantComponent } from "./components/descendant/descendant.component";
import { SlateChildrenComponent } from "./components/children/children.component";
import { SlateBlockCardComponent } from "./components/block-card/block-card.component";
import { SlateLeafComponent } from "./components/leaf/leaf.component";
import { SlateDefaultLeafComponent } from "./components/leaf/default-leaf.component";
import { SlateLeavesComponent } from "./components/leaves/leaves.component";
import { SLATE_DEFAULT_ELEMENT_COMPONENT_TOKEN } from "./components/element/default-element.component.token";
import { RestoreDOMComponent } from "./components/restore-dom/restore-dom.component";
import { EditableComponent } from "./components/editable/editable.component";

@NgModule({
  declarations: [
    EditableComponent,
    SlateDefaultElementComponent,
    SlateElementComponent,
    SlateVoidTextComponent,
    SlateDefaultTextComponent,
    SlateStringComponent,
    SlateStringTemplateComponent,
    SlateDescendantComponent,
    SlateChildrenComponent,
    SlateBlockCardComponent,
    SlateLeafComponent,
    SlateLeavesComponent,
    SlateDefaultLeafComponent,
    RestoreDOMComponent,
  ],
  imports: [CommonModule],
  entryComponents: [
    SlateBlockCardComponent,
    SlateStringComponent,
    SlateDefaultElementComponent,
    SlateDefaultLeafComponent,
    SlateVoidTextComponent,
    SlateDefaultTextComponent,
  ],
  exports: [
    EditableComponent,
    SlateChildrenComponent,
    SlateElementComponent,
    SlateLeavesComponent,
    SlateStringComponent,
    RestoreDOMComponent,
  ],
  providers: [
    {
      provide: SLATE_DEFAULT_ELEMENT_COMPONENT_TOKEN,
      useValue: SlateDefaultElementComponent,
    },
  ],
})
export class SlateModule {}

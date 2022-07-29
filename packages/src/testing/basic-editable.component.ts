import { Component, ViewChild } from "@angular/core";
import { createEditor, Element } from "slate";
import { Editable2Component } from "slate-angular/components/editable/editable.component";
import { withAngular } from "../plugins/with-angular";
import { createDefaultDocument } from "./create-document";

@Component({
    selector: 'basic-editable',
    template: `
        <slate-editable-2 
            [editor]="editor"
            [(ngModel)]="value"
            (ngModelChange)="ngModelChange()"
        ></slate-editable-2>
    `
})
export class BasicEditableComponent {
    editor = withAngular(createEditor());

    value: Element[] = createDefaultDocument() as Element[];

    @ViewChild(Editable2Component, { static: true })
    editableComponent: Editable2Component;

    ngModelChange() {
    }

    constructor() {
    }
}

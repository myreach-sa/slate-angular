import { Component } from "@angular/core";
import { createEditor, Descendant } from "slate";
import { withAngular } from "slate-angular";

@Component({
    selector: 'demo-readonly',
    template: `
    <div class="demo-rich-editor-wrapper">
        <slate-editable-2
            class="demo-slate-angular-editor"
            [readOnly]="true"
            [editor]="editor"
            [(ngModel)]="value"
        ></slate-editable-2>
    </div>
    `
})
export class DemoReadonlyComponent {
    constructor() { }

    value = initialValue;

    editor = withAngular(createEditor());
}

const initialValue: Descendant[] = [
    {
        type: 'paragraph',
        children: [
            {
                text:
                    'This example shows what happens when the Editor is set to readOnly, it is not editable',
            },
        ],
    },
]

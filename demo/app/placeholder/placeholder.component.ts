import { Component } from "@angular/core";
import { createEditor, Descendant, Editor, Node } from "slate";
import { SlatePlaceholder, withAngular } from "slate-angular";

@Component({
    selector: 'demo-placeholder',
    template: `
    <div class="demo-rich-editor-wrapper">
        <slate-editable-2  class="demo-slate-angular-editor" placeholder="hello world" [editor]="editor" [(ngModel)]="value"></slate-editable-2>
    </div>
    <div class="demo-rich-editor-wrapper">
        <slate-editable-2  class="demo-slate-angular-editor" [placeholderDecorate]="placeholderDecorate" [editor]="editorWithCustomDecoration" [(ngModel)]="otherValue"></slate-editable-2>
    </div>
    `
})
export class DemoPlaceholderComponent {
    constructor() { }

    value = initialValue;

    otherValue = [
        {
            type: 'paragraph',
            children: [
                {
                    text: 'Press Enter to make new paragraph and will show placeholder',
                },
            ],
        }
    ];

    placeholderDecorate: (editor: Editor) => SlatePlaceholder[] = (editor) => {
        const cursorAnchor = editor.selection?.anchor
        if(cursorAnchor) {
            const parent = Node.parent(editor,cursorAnchor.path)
            if(parent.children.length === 1 &&
                Array.from(Node.texts(parent)).length === 1 && 
                Node.string(parent) === '' ) {
                const start = Editor.start(editor, cursorAnchor)
                return [{
                    placeholder: 'advance placeholder use with placeholderDecoration',
                    anchor: start,
                    focus: start
                }];
            } else {
                return [];
            }
        }
        return [];
    };

    editor = withAngular(createEditor());

    editorWithCustomDecoration = withAngular(createEditor());
}

const initialValue: Descendant[] = [
    {
        type: 'paragraph',
        children: [
            {
                text: '',
            },
        ],
    },
]

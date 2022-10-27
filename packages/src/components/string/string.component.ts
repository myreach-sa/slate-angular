import {
    Component,
    OnInit,
    Input,
    ChangeDetectionStrategy,
    OnChanges,
    ElementRef,
    ViewContainerRef,
    AfterViewInit
} from '@angular/core';
import { Editor, Path, Node } from 'slate';
import { ViewContainerItem } from '../../view/container-item';
import { SlateLeafContext, SlateStringContext } from '../../view/context';
import { AngularEditor } from '../../plugins/angular-editor';
import { MARK_PLACEHOLDER_SYMBOL } from '../../utils/weak-maps';
import { IS_ANDROID } from '../../utils/environment';

@Component({
    selector: 'span[slateString]',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SlateStringComponent extends ViewContainerItem<SlateStringContext> implements OnInit, OnChanges, AfterViewInit {
    @Input() context: SlateLeafContext;

    constructor(private elementRef: ElementRef<any>, protected viewContainerRef: ViewContainerRef) {
        super(viewContainerRef, null);
     }

    ngOnInit(): void {
        this.createView();
    }

    ngOnChanges() {
        if (!this.initialized) {
            return;
        }
        this.updateView();
    }

    ngAfterViewInit() {
        this.elementRef.nativeElement.remove();
    }

    getViewType() {
        const path = AngularEditor.findPath(this.viewContext.editor, this.context.text);
        const parentPath = Path.parent(path);

        // COMPAT: Render text inside void nodes with a zero-width space.
        // So the node can contain selection but the text is not visible.
        if (this.viewContext.editor.isVoid(this.context.parent)) {
            return this.viewContext.templateComponent.zeroWidthStringTpl;
        }

        // COMPAT: If this is the last text node in an empty block, render a zero-
        // width space that will convert into a line break when copying and pasting
        // to support expected plain text.
        if (
            this.context.leaf.text === '' &&
            this.context.parent.children[this.context.parent.children.length - 1] === this.context.text &&
            !this.viewContext.editor.isInline(this.context.parent) &&
            Editor.string(this.viewContext.editor, parentPath) === ''
        ) {
            return this.viewContext.templateComponent.zeroWidthStringTpl;
        }

        // COMPAT: If the text is empty, it's because it's on the edge of an inline
        // node, so we render a zero-width space so that the selection can be
        // inserted next to it still.
        if (this.context.leaf.text === '') {
            return this.viewContext.templateComponent.zeroWidthStringTpl;
        }

        // COMPAT: Browsers will collapse trailing new lines at the end of blocks,
        // so we need to add an extra trailing new lines to prevent that.
        if (this.context.isLast && this.context.leaf.text.slice(-1) === '\n') {
            return this.viewContext.templateComponent.textStringTpl;
        }

        return this.viewContext.templateComponent.textStringTpl;
    }

    getContext(): SlateStringContext {
        const path = AngularEditor.findPath(
            this.viewContext.editor,
            this.context.text
        );

        const parentPath = Path.parent(path);

        const isMarkPlaceholder = this.context.leaf[MARK_PLACEHOLDER_SYMBOL] === true;
    
        // COMPAT: Render text inside void nodes with a zero-width space.
        // So the node can contain selection but the text is not visible.
        if (this.viewContext.editor.isVoid(this.context.parent)) {
            return { length: Node.string(this.context.parent).length };
        }
    
        // COMPAT: If this is the last text node in an empty block, render a zero-
        // width space that will convert into a line break when copying and pasting
        // to support expected plain text.
        if (
            this.context.leaf.text === "" &&
            this.context.parent.children[this.context.parent.children.length - 1] ===
                this.context.text &&
            !this.viewContext.editor.isInline(this.context.parent) &&
            Editor.string(this.viewContext.editor, parentPath) === ""
        ) {
            return { isLineBreak: true, isMarkPlaceholder }
        }
    
        // COMPAT: If the text is empty, it's because it's on the edge of an inline
        // node, so we render a zero-width space so that the selection can be
        // inserted next to it still.
        if (this.context.leaf.text === "") {
            return { isMarkPlaceholder };
        }
    
        // COMPAT: Browsers will collapse trailing new lines at the end of blocks,
        // so we need to add an extra trailing new lines to prevent that.
        if (this.context.isLast && this.context.leaf.text.slice(-1) === "\n") {
            return { isTrailing: true, text: this.context.leaf.text };
        }
    
        return { text: this.context.leaf.text };
    }

    memoizedContext(prev: SlateStringContext, next: SlateStringContext): boolean {
        return false;
    }
}

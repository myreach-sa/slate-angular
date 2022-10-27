import {
    Component,
    ChangeDetectionStrategy,
    ViewChild,
    TemplateRef
} from '@angular/core';
import { IS_ANDROID } from '../../utils/environment';

@Component({
    selector: 'slate-string-template',
    templateUrl: 'template.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SlateStringTemplateComponent {
    @ViewChild('textStringTpl', { read: TemplateRef, static: true })
    textStringTpl: TemplateRef<any>;

    @ViewChild('zeroWidthStringTpl', { read: TemplateRef, static: true })
    zeroWidthStringTpl: TemplateRef<any>;

    public readonly isAndroid = IS_ANDROID;
}

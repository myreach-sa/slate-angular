import { TemplateRef } from "@angular/core";

export interface ComponentType<T> {
    new(...args: any[]): T;
}

export type ViewType<T = any> = TemplateRef<T> | ComponentType<T>;
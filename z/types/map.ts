import { ZBaseType } from "./base-type";
import { ZDoc } from "./doc";
import { ZItem } from "../structs/item";
import { transact, Transaction } from "z/common/transaction";
import { typeMapSet } from "z/common/type-map";

export class ZMap extends ZBaseType {
    _map: Map<string, ZItem>;
    _prelimContent: Map<string, any> = new Map();

    constructor() {
        super();
        this._map = new Map();
    }

    set(key: string, value: any) {
        if (this.doc !== null) {
            transact(this.doc, (transaction: Transaction) => {
                typeMapSet(transaction, this, key, value);
            });
        } else {
            this._prelimContent.set(key, value);
        }
    }

    get(key: string) {
        return this._map.get(key)?.content.getContent()[0];
    }

    delete(key: string) {
    }

    _integrate(doc: ZDoc, item: ZItem) {
        super._integrate(doc, item);
        (this._prelimContent).forEach((value, key) => {
            this.set(key, value)
        })
        this._prelimContent = null
    }

    entries() {
        return createZMapEntriesIterator(this._map);
    }

    toJSON() {
        const obj = {};
        for (const [key, item] of this.entries()) {
            if (item instanceof ZBaseType) {
                obj[key] = item.toJSON();
            } else {
                obj[key] = item;
            }
        }
        return obj;
    }
}

function* createZMapEntriesIterator(map: Map<string, any>) {
    const iterator = map.entries();
    while (true) {
        const res = iterator.next();
        if (res.done) {
            break;
        }
        const [key, item] = res.value;
        if (!item.deleted) {
            yield [key, item.content.getContent()[0]];
        }
    }
}
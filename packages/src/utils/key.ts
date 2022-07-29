/**
 * An auto-incrementing identifier for keys.
 */

let n = 0;

/**
 * A class that keeps track of a key string. We use a full class here because we
 * want to be able to use them as keys in `WeakMap` objects.
 */

export class Key {
  id: string;

  constructor() {
    console.log(`DEBUG newKey: ${n + 1}`);
    this.id = `${n++}`;
  }
}

export interface RefObject<T> {
  readonly current: T | null;
}

export type UseRef<T> = { current: T };
export const useRef = <T>(value: T): UseRef<T> => ({current: value})

/**
 * A ~40 line observable store. Deliberately not Zustand/Nanostores: the whole
 * point of the core is that it drags in nothing, and every adapter (React's
 * `useSyncExternalStore`, Vue's `shallowRef`, a Svelte rune) speaks exactly
 * this shape already.
 */

export type Listener<TState> = (state: TState, previous: TState) => void
export type Unsubscribe = () => void

export type Store<TState> = {
  getState: () => TState
  /** Returns an unsubscribe function. Listeners fire only when state changes identity. */
  subscribe: (listener: Listener<TState>) => Unsubscribe
  /** Replace state, or derive it from the current one. */
  setState: (next: TState | ((current: TState) => TState)) => void
  /**
   * Run several `setState` calls and notify listeners once, with the state as
   * it was before the batch. Nested batches collapse into the outermost one.
   */
  batch: <TResult>(fn: () => TResult) => TResult
}

export function createStore<TState>(initialState: TState): Store<TState> {
  let state = initialState
  const listeners = new Set<Listener<TState>>()

  let batchDepth = 0
  let batchStartState = state
  let dirty = false

  const flush = (previous: TState) => {
    // Copy first: a listener may unsubscribe itself or another listener.
    for (const listener of [...listeners]) listener(state, previous)
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    setState(next) {
      const previous = state
      const resolved =
        typeof next === "function" ? (next as (current: TState) => TState)(previous) : next
      if (Object.is(resolved, previous)) return
      state = resolved

      if (batchDepth > 0) {
        dirty = true
        return
      }
      flush(previous)
    },

    batch(fn) {
      if (batchDepth === 0) {
        batchStartState = state
        dirty = false
      }
      batchDepth++
      try {
        return fn()
      } finally {
        batchDepth--
        if (batchDepth === 0 && dirty) {
          dirty = false
          flush(batchStartState)
        }
      }
    },
  }
}

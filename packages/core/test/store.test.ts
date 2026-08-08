import { describe, expect, it, vi } from "vitest"
import { createStore } from "../src/store.js"

describe("createStore", () => {
  it("exposes the initial state", () => {
    const store = createStore({ count: 0 })
    expect(store.getState()).toEqual({ count: 0 })
  })

  it("notifies subscribers with the new and previous state", () => {
    const store = createStore({ count: 0 })
    const listener = vi.fn()
    store.subscribe(listener)

    store.setState({ count: 1 })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ count: 1 }, { count: 0 })
  })

  it("accepts an updater function", () => {
    const store = createStore({ count: 1 })
    store.setState((current) => ({ count: current.count + 1 }))
    expect(store.getState().count).toBe(2)
  })

  it("skips notification when the state keeps its identity", () => {
    const state = { count: 0 }
    const store = createStore(state)
    const listener = vi.fn()
    store.subscribe(listener)

    store.setState(state)

    expect(listener).not.toHaveBeenCalled()
  })

  it("stops notifying after unsubscribe", () => {
    const store = createStore({ count: 0 })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    unsubscribe()
    store.setState({ count: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it("survives a listener unsubscribing during notification", () => {
    const store = createStore({ count: 0 })
    const second = vi.fn()
    const unsubscribeSecond = store.subscribe(() => {
      // A React root unmounting mid-notification does exactly this.
      unsubscribeSecond()
    })
    store.subscribe(second)

    expect(() => store.setState({ count: 1 })).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })

  describe("batch", () => {
    it("notifies once with the pre-batch state", () => {
      const store = createStore({ count: 0 })
      const listener = vi.fn()
      store.subscribe(listener)

      store.batch(() => {
        store.setState({ count: 1 })
        store.setState({ count: 2 })
        store.setState({ count: 3 })
      })

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith({ count: 3 }, { count: 0 })
    })

    it("returns the callback result", () => {
      const store = createStore({ count: 0 })
      expect(store.batch(() => "done")).toBe("done")
    })

    it("collapses nested batches into the outermost one", () => {
      const store = createStore({ count: 0 })
      const listener = vi.fn()
      store.subscribe(listener)

      store.batch(() => {
        store.setState({ count: 1 })
        store.batch(() => store.setState({ count: 2 }))
        store.setState({ count: 3 })
      })

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it("still flushes when the callback throws", () => {
      const store = createStore({ count: 0 })
      const listener = vi.fn()
      store.subscribe(listener)

      expect(() =>
        store.batch(() => {
          store.setState({ count: 1 })
          throw new Error("boom")
        }),
      ).toThrow("boom")

      // The write happened, so subscribers must not be left stale.
      expect(listener).toHaveBeenCalledTimes(1)
      expect(store.getState().count).toBe(1)
    })

    it("does not notify when nothing changed inside the batch", () => {
      const store = createStore({ count: 0 })
      const listener = vi.fn()
      store.subscribe(listener)

      store.batch(() => {
        /* no writes */
      })

      expect(listener).not.toHaveBeenCalled()
    })
  })
})

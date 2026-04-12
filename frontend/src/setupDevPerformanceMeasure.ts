/**
 * React 19.2 dev instrumentation calls performance.measure() with component prop
 * diffs. Huge props (e.g. full WO table rows) can make structuredClone fail with
 * DataCloneError / "out of memory" in Chrome. Swallow only that case in dev.
 */
if (import.meta.env.DEV && typeof performance?.measure === 'function') {
  const original = performance.measure.bind(performance) as (
    ...args: Parameters<Performance['measure']>
  ) => ReturnType<Performance['measure']>

  performance.measure = ((...args: Parameters<Performance['measure']>) => {
    try {
      return original(...args)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'DataCloneError') {
        return undefined
      }
      const msg = e instanceof Error ? e.message : String(e)
      if (
        msg.includes('DataCloneError') ||
        msg.includes('cannot be cloned')
      ) {
        return undefined
      }
      throw e
    }
  }) as Performance['measure']
}

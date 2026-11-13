import { useCallback, useEffect, useState, type DependencyList } from 'react';

interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs an async loader when `deps` change and tracks loading / error state.
 * Ignores results from stale calls so fast clicks never show old data.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // The caller owns the dependency list, like useEffect itself.
  const run = useCallback(loader, deps);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(undefined);
    run()
      .then((result) => {
        if (current) setData(result);
      })
      .catch((err: unknown) => {
        if (current) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [run, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

import { createContext, useContext, type ReactNode } from 'react';
import type { DataLayer } from '../data';

/**
 * Makes the active DataLayer available to every component. Roughly what an Angular
 * `providers: [{ provide: DataLayer, useClass: ... }]` does with dependency injection.
 */
const DataContext = createContext<DataLayer | null>(null);

export function DataProvider({ value, children }: { value: DataLayer; children: ReactNode }) {
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataLayer {
  const data = useContext(DataContext);
  if (!data) throw new Error('useData() must be used inside <DataProvider>');
  return data;
}

import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { AuthProvider } from '../context/AuthContext';
import { DataProvider } from '../context/DataContext';
import type { DataLayer } from '../data';

/** Renders the whole app at `path` with the given data layer, like main.tsx does. */
export function renderApp(data: DataLayer, path: string) {
  return render(
    <DataProvider value={data}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </DataProvider>,
  );
}

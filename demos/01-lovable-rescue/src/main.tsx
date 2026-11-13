import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { createDataLayer, type DataLayer } from './data';
import './index.css';

const root = createRoot(document.getElementById('root')!);

let dataLayer: DataLayer;
try {
  dataLayer = createDataLayer();
} catch (err) {
  // Configuration errors (e.g. a service_role key in the browser) stop the app loudly
  // instead of running in an insecure state.
  root.render(
    <div className="mx-auto max-w-xl p-10">
      <h1 className="text-xl font-semibold text-red-700">Configuration error</h1>
      <p className="mt-2 text-stone-700">{err instanceof Error ? err.message : String(err)}</p>
    </div>,
  );
  throw err;
}

root.render(
  <StrictMode>
    <DataProvider value={dataLayer}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </DataProvider>
  </StrictMode>,
);

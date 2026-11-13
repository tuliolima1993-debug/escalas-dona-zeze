import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import { DataProvider } from './data/DataProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <App />
      <Toaster position="top-right" richColors closeButton />
    </DataProvider>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CallGraphApp } from './CallGraphApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CallGraphApp />
  </StrictMode>,
);

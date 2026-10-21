import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { readConfig } from './config.ts';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App configResult={readConfig(import.meta.env)} />
    </StrictMode>,
  );
}

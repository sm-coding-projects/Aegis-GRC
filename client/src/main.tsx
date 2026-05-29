import React from 'react';
import ReactDOM from 'react-dom/client';
import './lib/fonts'; // self-hosted IBM Plex (§7.1) — bundles woff2 into dist
import './index.css';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

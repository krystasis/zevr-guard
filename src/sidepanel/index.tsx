import React from 'react';
import ReactDOM from 'react-dom/client';
import { SidePanel } from './SidePanel';
import { loadLocale } from '../shared/i18n';
import '../styles/tailwind.css';

void (async () => {
  await loadLocale();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <SidePanel />
    </React.StrictMode>,
  );
})();

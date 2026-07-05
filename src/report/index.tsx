import React from 'react';
import ReactDOM from 'react-dom/client';
import { Report } from './Report';
import { loadLocale } from '../shared/i18n';
import '../styles/tailwind.css';

void (async () => {
  await loadLocale();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Report />
    </React.StrictMode>,
  );
})();

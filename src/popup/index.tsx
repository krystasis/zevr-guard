import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from './Popup';
import { loadLocale } from '../shared/i18n';
import '../styles/tailwind.css';

void (async () => {
  await loadLocale();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>,
  );
})();

import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/fraunces/latin-500.css';
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/fraunces/latin-700.css';
import '@fontsource/fraunces/latin-500-italic.css';
import '@fontsource/fraunces/latin-600-italic.css';
import '@fontsource/outfit/latin-300.css';
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-500.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles/index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Eagerly load the faces used above the fold so the folio renders without a
// font swap and headless screenshots never race a lazy font load.
if (typeof document !== 'undefined' && document.fonts?.load) {
  Promise.all([
    document.fonts.load('600 19px "Fraunces"'),
    document.fonts.load('600 italic 19px "Fraunces"'),
    document.fonts.load('400 13px "Outfit"'),
    document.fonts.load('600 13px "Outfit"'),
    document.fonts.load('500 12px "IBM Plex Mono"'),
  ]).catch(() => {});
}

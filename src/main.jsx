import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

const globalStyles = document.createElement('style');
globalStyles.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --font: 'Inter', 'Noto Sans TC', system-ui, -apple-system, sans-serif;
  }

  body {
    font-family: var(--font);
    background: #f7f7fa;
    color: #1a1a2e;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }

  textarea:focus, select:focus, input:focus {
    border-color: #6366f1 !important;
    outline: none;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.12);
  }
`;
document.head.appendChild(globalStyles);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

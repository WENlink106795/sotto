import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { bootTheme } from './lib/theme';
import './styles/global.css';
import './styles/theme.css';
import './styles/components.css';
import './styles/views.css';
import './styles/surfaces.css';

bootTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
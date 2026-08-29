import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Game3D from '../app/game-3d';
import '../app/globals.css';
import './overrides.css';
import './attribution.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Game3D />
  </StrictMode>,
);

const hideBootLoader = () => {
  const loader = document.getElementById('boot-loader');
  if (!loader) return;
  loader.classList.add('boot-loader-hidden');
  window.setTimeout(() => loader.remove(), 320);
};

if (document.readyState === 'complete') window.setTimeout(hideBootLoader, 180);
else window.addEventListener('load', () => window.setTimeout(hideBootLoader, 180), { once: true });

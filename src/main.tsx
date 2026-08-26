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

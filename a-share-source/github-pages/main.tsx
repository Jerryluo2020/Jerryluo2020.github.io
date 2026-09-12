import React from 'react';
import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';
import '../lib/api-client';

// The API is hosted separately because GitHub Pages serves static files only.
// Do not add authentication bypass tokens or secrets here.
window.__ASHARE_API_ORIGIN__ = 'https://top50.luowz2026.chatgpt.site';
createRoot(document.getElementById('root')!).render(<Home />);

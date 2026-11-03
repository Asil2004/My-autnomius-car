import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Shrift loyiha ichidan (internetsiz ham ishlaydi): lotin va lotin-kengaytirilgan (oʻ, gʻ belgilari uchun)
import '@fontsource/onest/latin-400.css'
import '@fontsource/onest/latin-500.css'
import '@fontsource/onest/latin-600.css'
import '@fontsource/onest/latin-ext-400.css'
import '@fontsource/onest/latin-ext-500.css'
import '@fontsource/onest/latin-ext-600.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

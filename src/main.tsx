import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startAutoSync } from './sync'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
startAutoSync()

// Offline: the service worker caches the app so it opens with no signal. Entries are saved on the phone.
if ('serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.MODE !== 'single') {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {})
}

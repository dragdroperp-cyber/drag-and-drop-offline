import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { cleanupWorkers } from './utils/webWorker';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Health check removed - this API is only for testing, not for sellers/staff

// Register service worker for PWA - Enhanced offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Check if we're in production
    const isProduction = process.env.NODE_ENV === 'production';

    // Always try to register in production, check in development
    if (isProduction) {
      registerServiceWorker();
    } else {
      // In development, check if service worker file exists
      fetch('/service-worker.js', { method: 'HEAD' })
        .then(response => {
          if (response.ok && response.headers.get('content-type')?.includes('javascript')) {
            registerServiceWorker();
          } else {

          }
        })
        .catch(() => {

        });
    }
  });

  // Listen for online/offline events
  window.addEventListener('online', () => {

    if (window.showToast) {
      window.showToast('Connection restored. Syncing data...', 'success');
    }
    // Trigger sync when back online
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'TRIGGER_SYNC' });
    }
  });

  window.addEventListener('offline', () => {

    if (window.showToast) {
      window.showToast('You are offline. App continues to work.', 'info');
    }
  });
} else {

}

function registerServiceWorker() {
  navigator.serviceWorker
    .register('/service-worker.js')
    .then((registration) => {

      // Check if user is already authenticated and notify service worker
      const savedAuth = localStorage.getItem('auth');
      if (savedAuth) {
        try {
          const authData = JSON.parse(savedAuth);
          if (authData.isAuthenticated && navigator.serviceWorker.controller) {
            // Wait a bit for service worker to be ready
            setTimeout(() => {
              navigator.serviceWorker.controller.postMessage({
                type: 'AUTHENTICATED',
                user: authData.currentUser
              });

              // Request to cache app resources
              navigator.serviceWorker.controller.postMessage({
                type: 'CACHE_APP_RESOURCES'
              });
            }, 1000);
          }
        } catch (e) {

        }
      }

      // Check for updates periodically
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New service worker available, notify the app
            navigator.serviceWorker.controller.postMessage({
              type: 'UPDATE_AVAILABLE',
              registration: registration
            });
          }
        });
      });
    })
    .catch((error) => {
      // Only log error if it's not a MIME type error (common in development)
      if (!error.message.includes('MIME type') && !error.message.includes('text/html')) {

      } else {

      }
    });

  // Listen for service worker updates
  navigator.serviceWorker.addEventListener('controllerchange', () => {

    // Optionally reload the page when a new service worker takes control
    // window.location.reload();
  });
}

// Log PWA installability status

//('- Display Mode:', window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser');

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  cleanupWorkers();
});

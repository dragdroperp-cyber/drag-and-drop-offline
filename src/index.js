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
    const isLocalhost = Boolean(
      window.location.hostname === 'localhost' ||
      window.location.hostname === '[::1]' ||
      window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
    );

    const isProduction = process.env.NODE_ENV === 'production';

    // Register service worker on all environments including localhost
    registerServiceWorker();
  });

  // Check for waiting service worker on page load (handles missed updates)
  setTimeout(() => {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg && reg.waiting) {
        console.log('[SW] Found waiting service worker on page load, showing update...');
        // Try to send to controller, but also send to active worker as fallback
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'UPDATE_AVAILABLE'
          });
        } else if (reg.active) {
          reg.active.postMessage({
            type: 'UPDATE_AVAILABLE'
          });
        }
      }
    });
  }, 1000); // Check after 1 second for faster detection

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
        console.log('[SW] Update found! New service worker installing...');
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          console.log('[SW] New worker state:', newWorker.state);
          if (newWorker.state === 'installed') {
            console.log('[SW] New service worker installed and ready!');

            // Wait a bit for the service worker to be ready, then check for updates
            setTimeout(() => {
              navigator.serviceWorker.getRegistration().then(reg => {
                if (reg && reg.waiting) {
                  console.log('[SW] Found waiting service worker, notifying app...');
                  // Send message to current controller if it exists, otherwise send to all clients
                  if (navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({
                      type: 'UPDATE_AVAILABLE'
                    });
                  } else {
                    // If no controller, send to all clients
                    reg.active?.postMessage({
                      type: 'UPDATE_AVAILABLE'
                    });
                  }
                }
              });
            }, 1000); // Wait 1 second for service worker to settle
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

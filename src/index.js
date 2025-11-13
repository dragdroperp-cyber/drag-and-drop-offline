import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { checkBackendHealth } from './utils/api';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Check backend connection on app start
checkBackendHealth().then((result) => {
  if (result.available) {
    console.log('✅ Backend connected:', result.data);
  } else {
    console.warn('⚠️ Backend not available:', result.error);
    console.warn('⚠️ App will work in offline mode. Some features may be limited.');
  }
}).catch((error) => {
  console.warn('⚠️ Backend health check failed:', error);
});

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('✅ Service Worker registered successfully:', registration.scope);
        
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
            console.error('Error parsing auth data:', e);
          }
        }
        
        // Check for updates periodically
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available, show update notification
              console.log('New service worker available. Refresh to update.');
            }
          });
        });
      })
      .catch((error) => {
        console.error('❌ Service Worker registration failed:', error);
      });

    // Listen for service worker updates
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('Service worker controller changed. Reloading...');
      // Optionally reload the page when a new service worker takes control
      // window.location.reload();
    });
  });
} else {
  console.warn('⚠️ Service Workers are not supported in this browser.');
}

// Log PWA installability status
console.log('📱 PWA Installability Check:');
console.log('- Service Worker Support:', 'serviceWorker' in navigator);
console.log('- Display Mode:', window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser');


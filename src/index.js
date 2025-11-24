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
            console.log('⚠️ Service Worker not available in development. PWA features will work in production build.');
          }
        })
        .catch(() => {
          console.log('⚠️ Service Worker not available in development. PWA features will work in production build.');
        });
    }
  });
  
  // Listen for online/offline events
  window.addEventListener('online', () => {
    console.log('🌐 Connection restored');
    if (window.showToast) {
      window.showToast('Connection restored. Syncing data...', 'success');
    }
    // Trigger sync when back online
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'TRIGGER_SYNC' });
    }
  });
  
  window.addEventListener('offline', () => {
    console.log('📡 Connection lost - App continues offline');
    if (window.showToast) {
      window.showToast('You are offline. App continues to work.', 'info');
    }
  });
} else {
  console.warn('⚠️ Service Workers are not supported in this browser. PWA features unavailable.');
}

function registerServiceWorker() {
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
      // Only log error if it's not a MIME type error (common in development)
      if (!error.message.includes('MIME type') && !error.message.includes('text/html')) {
        console.error('❌ Service Worker registration failed:', error);
      } else {
        console.log('⚠️ Service Worker not available in development mode. This is normal.');
      }
    });

  // Listen for service worker updates
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('Service worker controller changed. Reloading...');
    // Optionally reload the page when a new service worker takes control
    // window.location.reload();
  });
}

// Log PWA installability status
console.log('📱 PWA Installability Check:');
console.log('- Service Worker Support:', 'serviceWorker' in navigator);
console.log('- Display Mode:', window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser');


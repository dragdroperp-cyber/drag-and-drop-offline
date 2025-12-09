import { useState, useEffect } from 'react';

/**
 * Custom hook to handle PWA update detection and management
 * @returns {{
 *   updateAvailable: boolean,
 *   update: () => Promise<void>,
 *   dismiss: () => void
 * }}
 */
export const usePWAUpdate = () => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState(null);

  useEffect(() => {
    // Only run if service workers are supported
    if (!('serviceWorker' in navigator)) {
      return;
    }

    // Listen for service worker messages
    const handleMessage = (event) => {
      console.log('[PWA Update] Message received:', event.data);
      if (event.data?.type === 'UPDATE_AVAILABLE') {
        console.log('[PWA Update] Update available! Showing popup...');
        setUpdateAvailable(true);
        setRegistration(event.data.registration);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);

    // Check if there's already a waiting service worker
    navigator.serviceWorker.ready.then((reg) => {
      console.log('[PWA Update] Service worker ready. Waiting worker:', !!reg.waiting);
      if (reg.waiting) {
        console.log('[PWA Update] Found waiting service worker! Showing update popup...');
        setUpdateAvailable(true);
        setRegistration(reg);
      }
    });

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, []);

  const update = async () => {
    if (!registration?.waiting) {
      return;
    }

    try {
      // Tell the waiting service worker to skip waiting and take control
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });

      // Listen for the controller change
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Reload the page to get the new service worker
        window.location.reload();
      });

      setUpdateAvailable(false);
    } catch (error) {
      console.error('Failed to update service worker:', error);
    }
  };

  const dismiss = () => {
    setUpdateAvailable(false);
  };

  return {
    updateAvailable,
    update,
    dismiss
  };
};

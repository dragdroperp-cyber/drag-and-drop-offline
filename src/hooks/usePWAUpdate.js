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

    // IMMEDIATE CHECK: Look for waiting service worker right away
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg && reg.waiting) {
        console.log('[PWA Update] IMMEDIATE CHECK: Found waiting service worker! Showing popup instantly...');
        setUpdateAvailable(true);
        setRegistration(reg);
      }
    });

    // Listen for service worker messages
    const handleMessage = (event) => {
      if (event.data?.type === 'UPDATE_AVAILABLE') {
        navigator.serviceWorker.getRegistration().then((reg) => {
          if (reg && reg.waiting) {
            setUpdateAvailable(true);
            setRegistration(reg);
          }
        });
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

    // Also check registration directly (more reliable)
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg && reg.waiting) {
        console.log('[PWA Update] Found waiting service worker via getRegistration! Showing update popup...');
        setUpdateAvailable(true);
        setRegistration(reg);
      }
    });

    // Periodic check every 3 seconds for missed updates (belt and suspenders)
    const checkInterval = setInterval(() => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && reg.waiting) {
          setUpdateAvailable(current => {
            if (!current) {
              console.log('[PWA Update] Periodic check found waiting service worker! Showing update popup...');
              setRegistration(reg);
              return true;
            }
            return current;
          });
        }
      });
    }, 3000);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
      clearInterval(checkInterval);
    };
  }, []);

  const update = async () => {
    try {
      if (registration?.waiting) {
        // Real update available: tell current waiting worker to skip waiting
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });

        // Listen for the controller change (new worker takes over)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        });
      } else {
        // Manual trigger or demo: clear all caches and reload
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.active) {
          reg.active.postMessage({ type: 'CLEAR_CACHE' });
          // Short delay to allow SW to process clearing
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        window.location.reload();
      }

      setUpdateAvailable(false);
    } catch (error) {
      console.error('Failed to update service worker:', error);
      // Fallback reload
      window.location.reload();
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

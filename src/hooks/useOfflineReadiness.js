import { useState, useEffect } from 'react';

/**
 * Hook to check if the PWA is ready for offline use
 * Checks service worker registration, cache status, and essential resources
 */
export const useOfflineReadiness = () => {
    const [isOfflineReady, setIsOfflineReady] = useState(false);
    const [isChecking, setIsChecking] = useState(true);
    const [missingResources, setMissingResources] = useState([]);
    const [cacheProgress, setCacheProgress] = useState(0);

    useEffect(() => {
        checkOfflineReadiness();
    }, []);

    const checkOfflineReadiness = async () => {
        setIsChecking(true);

        try {
            // Check 1: Service Worker Registration
            if (!('serviceWorker' in navigator)) {
                setMissingResources(prev => [...prev, 'Service Worker not supported']);
                setIsOfflineReady(false);
                setIsChecking(false);
                return;
            }

            const registration = await navigator.serviceWorker.getRegistration();
            if (!registration || !registration.active) {
                setMissingResources(prev => [...prev, 'Service Worker not active']);
                setIsOfflineReady(false);
                setIsChecking(false);
                return;
            }

            // Check 2: Cache API availability
            if (!('caches' in window)) {
                setMissingResources(prev => [...prev, 'Cache API not supported']);
                setIsOfflineReady(false);
                setIsChecking(false);
                return;
            }

            // Check 3: Essential resources in cache - ALL PAGES
            // Separate critical resources from optional ones
            const criticalResources = [
                // Core files
                '/',
                '/index.html',
                '/manifest.json',
                '/favicon.ico',
                '/offline.html',

                // All application routes
                '/dashboard',
                '/billing',
                '/products',
                '/customers',
                '/purchase',
                '/financial',
                '/reports',
                '/sales-order-history',
                '/refunds',
                '/upgrade',
                '/plan-history',
                '/settings'
            ];

            // Optional assets (nice to have, but not required for offline functionality)
            const optionalAssets = [
                // Static assets (fonts)
                'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',

                // Essential sounds (if they exist)
                '/assets/beep-401570.mp3',
                '/assets/cash-register-kaching-376867.mp3'
            ];

            const cacheNames = await caches.keys();
            const missing = [];
            const missingOptional = [];
            let cachedCount = 0;

            // Check critical resources
            for (const resource of criticalResources) {
                let found = false;

                for (const cacheName of cacheNames) {
                    const cache = await caches.open(cacheName);
                    const response = await cache.match(resource);

                    if (response) {
                        found = true;
                        cachedCount++;
                        break;
                    }
                }

                if (!found) {
                    missing.push(resource);
                }

                // Update progress
                setCacheProgress(Math.round((cachedCount / criticalResources.length) * 100));
            }

            // Check optional assets (don't block offline readiness)
            for (const resource of optionalAssets) {
                let found = false;

                for (const cacheName of cacheNames) {
                    const cache = await caches.open(cacheName);
                    const response = await cache.match(resource);

                    if (response) {
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    missingOptional.push(resource);
                }
            }

            // Combine missing resources for display, but only critical ones affect readiness
            const allMissing = [...missing, ...missingOptional];
            setMissingResources(allMissing);

            // App is offline-ready if all CRITICAL resources are cached
            // Optional assets (sounds, fonts) don't block offline functionality
            setIsOfflineReady(missing.length === 0);

            if (missingOptional.length > 0) {
                console.log(`[Offline Check] ${missingOptional.length} optional assets not cached (sounds, fonts) - app still works offline`);
            }

        } catch (error) {
            console.error('[Offline Check] Error checking offline readiness:', error);
            setIsOfflineReady(false);
        } finally {
            setIsChecking(false);
        }
    };

    const downloadForOffline = async () => {
        setIsChecking(true);

        try {
            // Listen for cache completion message from service worker
            const messageHandler = (event) => {
                if (event.data && event.data.type === 'CACHE_COMPLETE') {
                    const { cached, total } = event.data;
                    console.log(`[Offline Download] Cached ${cached}/${total} resources`);

                    // Update progress based on actual cached count
                    const progress = Math.round((cached / total) * 100);
                    setCacheProgress(progress);
                }
            };

            navigator.serviceWorker.addEventListener('message', messageHandler);

            // Send message to service worker to cache essential resources
            const registration = await navigator.serviceWorker.getRegistration();

            if (registration && registration.active) {
                registration.active.postMessage({
                    type: 'CACHE_RESOURCES'
                });

                // Wait for caching to complete (with timeout)
                await new Promise((resolve) => {
                    const timeout = setTimeout(resolve, 10000); // 10 second timeout

                    const completeHandler = (event) => {
                        if (event.data && event.data.type === 'CACHE_COMPLETE') {
                            clearTimeout(timeout);
                            navigator.serviceWorker.removeEventListener('message', completeHandler);
                            resolve();
                        }
                    };

                    navigator.serviceWorker.addEventListener('message', completeHandler);
                });

                // Re-check readiness after caching
                await checkOfflineReadiness();

                // Clean up event listener
                navigator.serviceWorker.removeEventListener('message', messageHandler);
            }
        } catch (error) {
            console.error('[Offline Download] Error downloading resources:', error);
        } finally {
            setIsChecking(false);
        }
    };

    return {
        isOfflineReady,
        isChecking,
        missingResources,
        cacheProgress,
        downloadForOffline,
        recheckReadiness: checkOfflineReadiness
    };
};

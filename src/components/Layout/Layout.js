import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import Sidebar from './Sidebar/Sidebar';
import Header from './Header/Header';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { getAllItems, STORES } from '../../utils/indexedDB';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { useLocation } from 'react-router-dom';

const Layout = React.memo(({ children }) => {
  const { state } = useApp();
  const planBootstrapState = state.planBootstrap || {};
  const shouldShowPlanLoader = planBootstrapState.isActive && !planBootstrapState.hasCompleted;
  const [isPlanLoaderVisible, setIsPlanLoaderVisible] = useState(shouldShowPlanLoader);
  // Set sidebar off by default on mobile/tablet (screens < 1280px), on by default on desktop
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // Check if we're on mobile/tablet (screen width < 1280px which is xl breakpoint)
    return typeof window !== 'undefined' ? window.innerWidth >= 1280 : true;
  });
  const [toasts, setToasts] = useState([]);

  // Keyboard shortcut: Shift + S to toggle sidebar
  useKeyboardShortcut('s', false, true, () => {
    setSidebarOpen(prevState => {
      const newState = !prevState;

      // Show toast
      if (window.showToast) {
        window.showToast(newState ? 'Sidebar opened' : 'Sidebar closed', 'info', 1500);
      }

      return newState;
    });
  }, [sidebarOpen]); // Add sidebarOpen as dependency

  // Handle responsive sidebar behavior - close on mobile/tablet, open on desktop
  useEffect(() => {
    const handleResize = () => {
      const isDesktop = window.innerWidth >= 1280; // xl breakpoint
      setSidebarOpen(isDesktop);
    };

    // Add resize listener
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Handle mobile detection for responsive toasts
  useEffect(() => {
    const handleResize = () => {
      setIsMobileView(window.innerWidth < 768); // md breakpoint
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Loading screen state for first-time users
  const [isLoadingAccess, setIsLoadingAccess] = useState(null); // null = checking, true = show loading, false = no loading
  const [dataLoadingStates, setDataLoadingStates] = useState({
    products: false,
    orders: false,
    customers: false,
    statsCalculated: false
  });

  // Debug: Log when isLoadingAccess changes
  useEffect(() => {
    // Removed debug log
  }, [isLoadingAccess]);
  const { prompt, isInstallable, isInstalled, install } = usePWAInstall();
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [hasDismissedInstallPrompt, setHasDismissedInstallPrompt] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return sessionStorage.getItem('pwa-install-dismissed') === 'true';
  });
  const [isMobileView, setIsMobileView] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768; // md breakpoint
  });

  useEffect(() => {
    if (shouldShowPlanLoader) {
      setIsPlanLoaderVisible(true);
      return;
    }
    if (!isPlanLoaderVisible) return;
    const timeout = setTimeout(() => setIsPlanLoaderVisible(false), 400);
    return () => clearTimeout(timeout);
  }, [shouldShowPlanLoader, isPlanLoaderVisible]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem('pwa-install-dismissed', hasDismissedInstallPrompt ? 'true' : 'false');
  }, [hasDismissedInstallPrompt]);

  useEffect(() => {
    if (isInstallable && !isInstalled && !hasDismissedInstallPrompt) {
      const timer = setTimeout(() => setShowInstallPrompt(true), 800);
      return () => clearTimeout(timer);
    }
    setShowInstallPrompt(false);
  }, [isInstallable, isInstalled, hasDismissedInstallPrompt]);

  // Check if IndexedDB has any data (first login detection)
  const checkIndexedDBHasData = async () => {
    try {

      const [products, orders, customers] = await Promise.all([
        getAllItems(STORES.products).catch(() => []),
        getAllItems(STORES.orders).catch(() => []),
        getAllItems(STORES.customers).catch(() => [])
      ]);

      const hasAnyData = (products && products.length > 0) || (orders && orders.length > 0) || (customers && customers.length > 0);

      return hasAnyData;
    } catch (error) {

      return true; // Assume data exists if check fails
    }
  };

  // Handle loading state - check IndexedDB data immediately
  useEffect(() => {
    const checkDataAndSetLoading = async () => {
      // If seller profile is not completed, skip loading screen entirely
      const profileCompleted = state.currentUser?.profileCompleted === true || state.currentUser?.profileCompleted === 'true';
      if (!profileCompleted) {
        setIsLoadingAccess(false);
        return;
      }

      const hasExistingData = await checkIndexedDBHasData();

      if (hasExistingData) {
        // User has data - NO LOADING EVER, not even for a millisecond
        setIsLoadingAccess(false);
      } else {
        // First login - show loading until UI data loads
        setIsLoadingAccess(true);
      }
    };

    checkDataAndSetLoading();
  }, [state.currentUser?.profileCompleted]);

  // Memoize data arrays to prevent unnecessary re-renders
  const productsArray = useMemo(() => state.products || [], [state.products]);
  const ordersArray = useMemo(() => state.orders || [], [state.orders]);
  const customersArray = useMemo(() => state.customers || [], [state.customers]);

  // Check if UI data is loaded and update loading states
  useEffect(() => {
    // Check if data arrays exist AND have actual data (not just empty arrays)
    const hasProducts = productsArray.length > 0;
    const hasOrders = ordersArray.length > 0;
    const hasCustomers = customersArray.length > 0;

    setDataLoadingStates({
      products: hasProducts,
      orders: hasOrders,
      customers: hasCustomers,
      statsCalculated: true // Stats are calculated immediately
    });
  }, [productsArray, ordersArray, customersArray, isLoadingAccess]);

  // Hide loading screen immediately when UI data is loaded OR delta sync succeeds
  useEffect(() => {
    const allDataLoaded = dataLoadingStates.products && dataLoadingStates.orders && dataLoadingStates.customers && dataLoadingStates.statsCalculated;
    const deltaSyncSuccessful = state.dataFreshness === 'fresh'; // Delta sync succeeded
    const hasAnyData = customersArray.length > 0 || productsArray.length > 0 || ordersArray.length > 0; // Check if Redux has any data

    if (isLoadingAccess === true && (allDataLoaded || deltaSyncSuccessful || hasAnyData)) {
      setIsLoadingAccess(false);
    }
  }, [dataLoadingStates, state.dataFreshness, isLoadingAccess, productsArray, ordersArray, customersArray]);

  const showToast = useCallback((message, type = 'info', duration) => {
    // Set default duration based on type
    if (!duration) {
      switch (type) {
        case 'error':
          duration = 6000; // Errors should be visible longer
          break;
        case 'warning':
          duration = 5000;
          break;
        case 'success':
          duration = 3500; // Success messages can be shorter
          break;
        default:
          duration = 4000;
      }
    }

    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast = { id, message, type, duration, createdAt: id };

    // persistent Audio ref used below
    if (type === 'success') {
      try {
        // Create audio object if it doesn't exist or reused existing
        // Switched to 'mixkit-arcade-game-jump-coin-216.wav' as requested
        const audioPath = `${process.env.PUBLIC_URL || ''}/assets/mixkit-arcade-game-jump-coin-216.wav`;
        const audio = new Audio(audioPath);

        // Coin sounds can be sharp, so careful with volume
        audio.volume = 0.6;

        const playPromise = audio.play();

        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.error("Audio play failed:", error);
          });
        }
      } catch (e) {
        console.error("Audio setup error:", e);
      }
    }

    setToasts(prev => {
      // Clear timeouts for ALL existing toasts since we are replacing them
      prev.forEach(t => {
        if (t.timeoutId) clearTimeout(t.timeoutId);
      });

      // Replace everything with just the new toast (Single toast mode)
      return [newToast];
    });

    // Auto-remove after duration - trigger dismissal animation first
    const timeoutId = setTimeout(() => {
      removeToast(id);
    }, duration);

    // Update the toast with its timeout ID for cleanup
    setToasts(prev => prev.map(toast =>
      toast.id === id ? { ...toast, timeoutId } : toast
    ));
  }, []);

  useEffect(() => {
    window.showToast = showToast;
  }, []);

  const removeToast = useCallback((id) => {
    // First trigger dismissal animation
    setToasts(prev => prev.map(toast => {
      if (toast.id === id) {
        return { ...toast, isDismissing: true };
      }
      return toast;
    }));

    // Then remove after animation completes
    setTimeout(() => {
      setToasts(prev => prev.map(toast => {
        if (toast.id === id && toast.timeoutId) {
          clearTimeout(toast.timeoutId);
        }
        return toast;
      }).filter(toast => toast.id !== id));
    }, 300);
  }, []);

  // Enhanced toast with pause-on-hover and mobile-style slide animations
  const ToastItem = React.memo(({ toast, onRemove, isMobile }) => {
    const [isPaused, setIsPaused] = useState(false);
    const [remainingTime, setRemainingTime] = useState(toast.duration);

    // Swipe state
    const [touchStart, setTouchStart] = useState(null);
    const [swipeOffset, setSwipeOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);

    const isDismissing = toast.isDismissing || false;
    const startTimeRef = useRef(Date.now());
    const totalPausedTimeRef = useRef(0);
    const lastPauseStartRef = useRef(null);
    const timerRef = useRef(null);

    // Calculate progress bar width
    const progressWidth = Math.max(0, (remainingTime / toast.duration) * 100);

    useEffect(() => {
      // If paused or dragging, we don't tick.
      if (isPaused || isDragging) {
        if (!lastPauseStartRef.current) {
          lastPauseStartRef.current = Date.now();
        }
        if (timerRef.current) clearTimeout(timerRef.current);
        return;
      }

      // If we were paused, add that duration to totalPausedTime
      if (lastPauseStartRef.current) {
        totalPausedTimeRef.current += (Date.now() - lastPauseStartRef.current);
        lastPauseStartRef.current = null;
      }

      const updateTimer = () => {
        const now = Date.now();
        const activeDuration = now - startTimeRef.current - totalPausedTimeRef.current;
        const remaining = Math.max(0, toast.duration - activeDuration);

        // Avoid unnecessary updates if already 0
        if (remainingTime !== remaining) {
          setRemainingTime(remaining);
        }

        if (remaining <= 0) {
          onRemove(toast.id);
        } else {
          timerRef.current = setTimeout(updateTimer, 50);
        }
      };

      // Start the timer
      timerRef.current = setTimeout(updateTimer, 50);

      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
      };
    }, [isPaused, isDragging, toast.id, toast.duration, onRemove]); // Removed remainingTime from dep to avoid loop, calculated inside

    const handleMouseEnter = useCallback(() => {
      setIsPaused(true);
    }, []);

    const handleMouseLeave = useCallback(() => {
      setIsPaused(false);
    }, []);

    const handleTouchStart = (e) => {
      setTouchStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
      setIsDragging(true);
    };

    const handleTouchMove = (e) => {
      if (!touchStart) return;
      const x = e.touches[0].clientX - touchStart.x;
      // Fix Y to 0 effectively
      setSwipeOffset({ x, y: 0 });
    };

    const handleTouchEnd = () => {
      if (!isDragging) return;

      // Thresholds
      const dismissThreshold = 75; // px

      // Dismiss if swiped Sideways enough
      if (Math.abs(swipeOffset.x) > dismissThreshold) {
        onRemove(toast.id);
        // Keep offset to prevent jump before unmount
      } else {
        setSwipeOffset({ x: 0, y: 0 });
        setIsDragging(false);
      }
      setTouchStart(null);
    };

    const containerStyle = {
      // Only translate X, Y remains 0
      ...(isDragging ? { transform: `translate(${swipeOffset.x}px, 0px)`, transition: 'none' } : {}),
      ...(isMobile ? { touchAction: 'pan-y', userSelect: 'none' } : {}) // Allow vertical scrolling, block horizontal
    };

    return (
      <div
        className={`${isMobile
          ? // Mobile styling: Floating pill, top center, rounded, shadow
          `pointer-events-auto w-full max-w-[360px] mx-auto rounded-2xl border px-4 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl text-sm transform transition-all duration-300 ease-out ${isDismissing ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'
          } ${toast.type === 'success'
            ? 'border-emerald-100/50 bg-white/95 dark:bg-slate-800/95 text-emerald-700 dark:text-emerald-400'
            : toast.type === 'error'
              ? 'border-rose-100/50 bg-white/95 dark:bg-slate-800/95 text-rose-700 dark:text-rose-400'
              : toast.type === 'warning'
                ? 'border-amber-100/50 bg-white/95 dark:bg-slate-800/95 text-amber-700 dark:text-amber-400'
                : 'border-slate-100/50 bg-white/95 dark:bg-slate-800/95 text-slate-700 dark:text-slate-300'
          }`
          : // Desktop styling: Floating card, top right
          `pointer-events-auto flex items-end gap-3 rounded-xl border px-4 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl min-w-[300px] max-w-[400px] mb-3 text-sm transform transition-all duration-300 ease-out hover:scale-[1.02] ${isDismissing ? 'translate-x-full opacity-0' : 'translate-y-0 opacity-100'
          } ${toast.type === 'success'
            ? 'border-emerald-100/50 bg-white/80 dark:bg-slate-800/80 text-emerald-800 dark:text-emerald-300'
            : toast.type === 'error'
              ? 'border-rose-100/50 bg-white/80 dark:bg-slate-800/80 text-rose-800 dark:text-rose-300'
              : toast.type === 'warning'
                ? 'border-amber-100/50 bg-white/80 dark:bg-slate-800/80 text-amber-800 dark:text-amber-300'
                : 'border-slate-100/50 bg-white/80 dark:bg-slate-800/80 text-slate-800 dark:text-slate-300'
          }`
          }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={containerStyle}
      >
        <div className={`flex-1 ${isMobile ? 'flex items-center gap-3' : ''}`}>
          {isMobile ? (
            // Mobile layout: Compact horizontal pill
            <>
              {/* Icon based on type */}
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${toast.type === 'success' ? 'bg-emerald-100 text-emerald-600' :
                toast.type === 'error' ? 'bg-rose-100 text-rose-600' :
                  toast.type === 'warning' ? 'bg-amber-100 text-amber-600' :
                    'bg-slate-100 text-slate-600'
                }`}>
                {toast.type === 'success' ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                ) : toast.type === 'error' ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                ) : toast.type === 'warning' ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight text-gray-900 dark:text-white capitalize truncate">
                  {toast.type || 'Notification'}
                </p>
                <p className="text-sm leading-tight text-gray-600 dark:text-gray-300 truncate mt-0.5">
                  {toast.message}
                </p>
              </div>

              <button
                onClick={() => onRemove(toast.id)}
                className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Dismiss"
              >
                <span className="text-lg leading-none">&times;</span>
              </button>
            </>
          ) : (
            // Desktop layout: Vertical with progress bar
            <>
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${toast.type === 'success' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' :
                  toast.type === 'error' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' :
                    toast.type === 'warning' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' :
                      'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                  }`}>
                  {toast.type === 'success' ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  ) : toast.type === 'error' ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                  ) : toast.type === 'warning' ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  )}
                </div>

                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm capitalize text-gray-900 dark:text-white">{toast.type || 'Notification'}</p>
                    <button
                      onClick={() => onRemove(toast.id)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-lg leading-none -mt-1"
                    >
                      &times;
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 leading-relaxed font-medium">
                    {toast.message}
                  </p>
                </div>
              </div>

              {/* Minimal Progress Line */}
              <div className="absolute bottom-0 left-4 right-4 h-0.5 bg-gray-100 dark:bg-slate-700 overflow-hidden rounded-full opacity-50">
                <div
                  className={`h-full transition-all duration-100 ease-linear ${toast.type === 'success' ? 'bg-emerald-500' :
                    toast.type === 'error' ? 'bg-rose-500' :
                      toast.type === 'warning' ? 'bg-amber-500' :
                        'bg-slate-500'
                    }`}
                  style={{ width: `${progressWidth}%` }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    );
  });

  ToastItem.displayName = 'ToastItem';

  const installState = useMemo(() => ({
    prompt,
    isInstallable,
    isInstalled,
    install
  }), [prompt, isInstallable, isInstalled, install]);

  const handleInstallClick = useCallback(async () => {
    if (!install) {
      setHasDismissedInstallPrompt(true);
      setShowInstallPrompt(false);
      return;
    }

    try {
      await install();
    } finally {
      setHasDismissedInstallPrompt(true);
      setShowInstallPrompt(false);
    }
  }, [install]);

  const location = useLocation();
  const isUpgradePage = location.pathname === '/upgrade';

  return (
    <div className="flex h-screen text-slate-900 dark:text-slate-100 transition-colors duration-300">
      <nav
        className={`hidden xl:flex xl:flex-col xl:sticky xl:top-0 xl:h-screen shadow-[0_28px_90px_-55px_rgba(15,23,42,0.55)] transition-all duration-300 ease-in-out overflow-hidden ${sidebarOpen ? 'xl:w-72 opacity-100' : 'xl:w-0 opacity-0'}`}
      >
        <Sidebar />
      </nav>

      <div className={`fixed inset-0 z-[150] xl:hidden transition-all duration-300 ${sidebarOpen ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`} style={{ height: '100vh', overflow: 'hidden' }}>
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-slate-900/70 backdrop-blur-sm transition-opacity duration-300 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setSidebarOpen(false)}
        />
        {/* Sidebar Panel */}
        <div className={`relative w-full max-w-xs h-full flex flex-col shadow-[0_28px_80px_-50px_rgba(15,23,42,0.55)] bg-white dark:bg-slate-800 transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`} style={{ height: '100vh' }}>
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <Header onMenuClick={useCallback(() => setSidebarOpen(prev => !prev), [])} installState={installState} />

        {state.systemStatus === 'offline' && (
          <div className="bg-amber-100 border-b border-amber-200 text-amber-700 text-sm px-4 py-2 text-center flex items-center justify-center gap-2">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true"></span>
            <span>You're offline. Changes will sync automatically when you reconnect.</span>
          </div>
        )}

        <main className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth no-scrollbar">
          <div className={isUpgradePage ? '' : "p-3 pt-3 sm:p-5 sm:pt-4 xl:p-7 xl:pt-5 2xl:p-10 2xl:pt-6"}>
            {children}
          </div>
        </main>
      </div>

      {/* Access Loading Screen - First Login */}
      {isLoadingAccess === true && (
        <div className="fixed inset-0 z-50 bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
          <div className="text-center">
            {/* Simple animated logo */}
            <div className="mb-8">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-white rounded-full shadow-lg mb-6">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <h1 className="text-2xl font-bold text-gray-800 mb-2">Drag & Drop</h1>
              <div className="w-16 h-0.5 bg-blue-500 rounded-full mx-auto"></div>
            </div>

            {/* Clean loading message */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-700 mb-3">
                Setting up your workspace
              </h2>
              <p className="text-gray-600">
                Loading your business data...
              </p>
            </div>

            {/* Simple bouncing dots */}
            <div className="flex justify-center space-x-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce"></div>
              <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce delay-100"></div>
              <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce delay-200"></div>
            </div>
          </div>
        </div>
      )}

      {isPlanLoaderVisible && (
        <div
          className={`fixed inset-0 z-[70] flex flex-col items-center justify-center transition-opacity duration-500 ease-out ${shouldShowPlanLoader ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
        >
          <div className="absolute inset-0 bg-slate-900/65 backdrop-blur-xl" aria-hidden="true"></div>
          <div className="relative flex flex-col items-center justify-center gap-6 rounded-3xl border border-white/10 bg-white/10 px-10 py-12 shadow-[0_35px_90px_-25px_rgba(15,23,42,0.65)] backdrop-blur-2xl">
            <div className="relative flex h-20 w-20 items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-white/10 blur-xl"></div>
              <div className="h-16 w-16 animate-spin rounded-full border-[3px] border-white/25 border-t-white"></div>
            </div>
            <div className="space-y-2 text-center text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/60">Please wait</p>
              <h2 className="text-2xl font-semibold">We are preparing your dashboard...</h2>
              <p className="text-sm text-white/70 max-w-sm">
                Fetching the latest plan details and unlocking your workspace.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Toast Container - Mobile: Top Floating, Desktop: Top Right */}
      <div className={`fixed z-[9999] pointer-events-none transition-all duration-300 ${isMobileView
        ? 'top-4 left-4 right-4 flex flex-col items-center gap-2'
        : 'top-6 right-6 flex flex-col items-end gap-3 min-w-[320px]'
        }`}>
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onRemove={removeToast}
            isMobile={isMobileView}
          />
        ))}
      </div>

      {showInstallPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white/90 border border-slate-200 shadow-[0_28px_70px_-38px_rgba(15,23,42,0.55)] p-6 space-y-4 backdrop-blur-lg">
            <div className="space-y-1 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Install App</p>
              <h2 className="text-xl font-semibold text-slate-900">Drag &amp; Drop on your device</h2>
              <p className="text-sm text-slate-500">
                Install the PWA for instant access, faster launches, and full offline support.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={() => {
                  setHasDismissedInstallPrompt(true);
                  setShowInstallPrompt(false);
                }}
                className="px-4 py-2 rounded-full border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 transition"
              >
                Maybe later
              </button>
              <button
                type="button"
                onClick={handleInstallClick}
                className="px-4 py-2 rounded-full bg-[linear-gradient(135deg,#2F3C7E,#18224f)] text-white text-sm font-semibold hover:bg-[linear-gradient(135deg,#243168,#111c44)] transition"
              >
                Install now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

Layout.displayName = 'Layout';

export default Layout;

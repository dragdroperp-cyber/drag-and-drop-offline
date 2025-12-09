import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import Sidebar from './Sidebar/Sidebar';
import Header from './Header/Header';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { getAllItems, STORES } from '../../utils/indexedDB';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';

const Layout = ({ children }) => {
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

  const showToast = (message, type = 'info', duration) => {
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

    const id = Date.now();
    const newToast = { id, message, type, duration, createdAt: id };

    setToasts(prev => {
      // Remove exact duplicates (same message and type) and clean up their timeouts
      const withoutExactDuplicate = prev.filter(toast => {
        if (toast.message === message && toast.type === type) {
          // Clear any existing timeout for the duplicate
          if (toast.timeoutId) {
            clearTimeout(toast.timeoutId);
          }
          return false;
        }
        return true;
      });

      // Maximum 2 toasts: if we already have 2, remove the oldest (first) one
      let limitedToasts = withoutExactDuplicate;
      if (limitedToasts.length >= 2) {
        // Remove the oldest toast (first in array)
        const oldestToast = limitedToasts[0];
        if (oldestToast.timeoutId) {
          clearTimeout(oldestToast.timeoutId);
        }
        limitedToasts = limitedToasts.slice(1); // Keep only the most recent one
      }

      return [...limitedToasts, newToast];
    });

    // Auto-remove after duration - trigger dismissal animation first
    const timeoutId = setTimeout(() => {
      removeToast(id);
    }, duration);

    // Update the toast with its timeout ID for cleanup
    setToasts(prev => prev.map(toast =>
      toast.id === id ? { ...toast, timeoutId } : toast
    ));
  };

  useEffect(() => {
    window.showToast = showToast;
  }, []);

  const removeToast = (id) => {
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
  };

  // Enhanced toast with pause-on-hover and mobile-style slide animations
  const ToastItem = ({ toast, onRemove, isMobile }) => {
    const [isPaused, setIsPaused] = useState(false);
    const [remainingTime, setRemainingTime] = useState(toast.duration);
    const isDismissing = toast.isDismissing || false;
    const startTimeRef = useRef(Date.now());
    const pausedTimeRef = useRef(0);
    const timerRef = useRef(null);

    // Calculate progress bar width
    const progressWidth = Math.max(0, (remainingTime / toast.duration) * 100);

    useEffect(() => {
      const updateTimer = () => {
        if (isPaused) return;

        const elapsed = Date.now() - startTimeRef.current - pausedTimeRef.current;
        const remaining = Math.max(0, toast.duration - elapsed);

        setRemainingTime(remaining);

        if (remaining <= 0) {
          // The parent component will handle the dismissal animation
          onRemove(toast.id);
        } else {
          // Schedule next update
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
    }, [isPaused, toast.id, toast.duration, onRemove]);

    const handleMouseEnter = () => {
      setIsPaused(true);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };

    const handleMouseLeave = () => {
      setIsPaused(false);
      // Update paused time and restart timer
      pausedTimeRef.current += Date.now() - startTimeRef.current - pausedTimeRef.current;
      startTimeRef.current = Date.now();

      // Restart the timer
      const updateTimer = () => {
        const elapsed = Date.now() - startTimeRef.current - pausedTimeRef.current;
        const remaining = Math.max(0, toast.duration - elapsed);

        setRemainingTime(remaining);

        if (remaining <= 0) {
          onRemove(toast.id);
        } else {
          timerRef.current = setTimeout(updateTimer, 50);
        }
      };

      timerRef.current = setTimeout(updateTimer, 50);
    };

    return (
      <div
        className={`${isMobile
          ? // Mobile styling: full width, top positioned, sharp corners with slide-out animation only
          `w-full rounded-none border-x-0 border-t px-4 py-3 text-sm transform transition-all duration-300 ease-out ${
            isDismissing ? 'translate-x-full opacity-0' : 'translate-y-0 opacity-100'
          } ${
            toast.type === 'success'
              ? 'border-emerald-200 bg-white text-emerald-700'
              : toast.type === 'error'
              ? 'border-rose-200 bg-white text-rose-700'
              : toast.type === 'warning'
              ? 'border-amber-200 bg-white text-amber-700'
              : 'border-sky-200 bg-white text-sky-700'
          }`
          : // Desktop styling: top right, sharp corners with slide-out animation only
          `flex items-end gap-3 rounded-none border px-4 py-3 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.5)] backdrop-blur-md min-w-[280px] max-w-[420px] mb-2 text-sm transform transition-all duration-300 ease-out hover:scale-[1.02] ${
            isDismissing ? 'translate-x-full opacity-0' : 'translate-y-0 opacity-100'
          } ${
            toast.type === 'success'
              ? 'border-emerald-200 bg-white/95 text-emerald-700'
              : toast.type === 'error'
              ? 'border-rose-200 bg-white/95 text-rose-700'
              : toast.type === 'warning'
              ? 'border-amber-200 bg-white/95 text-amber-700'
              : 'border-sky-200 bg-white/95 text-sky-700'
          }`
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className={`flex-1 ${isMobile ? 'flex items-center justify-between' : ''}`}>
          {isMobile ? (
            // Mobile layout: horizontal with centered content
            <>
              <div className="flex items-center gap-3">
                <p className="font-semibold capitalize text-sm opacity-75">{toast.type || 'info'}</p>
                <p className="leading-relaxed whitespace-pre-wrap break-words text-slate-700 font-medium">{toast.message}</p>
              </div>
              <button
                onClick={() => onRemove(toast.id)}
                className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors text-xl leading-none ml-2"
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </>
          ) : (
            // Desktop layout: vertical with progress bar
            <>
              <div className="flex items-center justify-between">
                <p className="font-semibold capitalize text-xs opacity-75">{toast.type || 'info'}</p>
                <button
                  onClick={() => onRemove(toast.id)}
                  className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none"
                  aria-label="Dismiss notification"
                >
                  ×
                </button>
              </div>
              <p className="mt-1 leading-relaxed whitespace-pre-wrap break-words text-slate-700 font-medium">{toast.message}</p>

              {/* Progress bar - only on desktop */}
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-200 rounded-b-none overflow-hidden">
                <div
                  className={`h-full transition-all duration-100 ease-linear ${
                    toast.type === 'success'
                      ? 'bg-emerald-500'
                      : toast.type === 'error'
                      ? 'bg-rose-500'
                      : toast.type === 'warning'
                      ? 'bg-amber-500'
                      : 'bg-sky-500'
                  }`}
                  style={{ width: `${progressWidth}%` }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  const installState = {
    prompt,
    isInstallable,
    isInstalled,
    install
  };

  const handleInstallClick = async () => {
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
  };

  return (
    <div className="flex h-screen text-slate-900">
      <nav
        className={`w-72 xl:flex xl:flex-col xl:sticky xl:top-0 xl:h-screen shadow-[0_28px_90px_-55px_rgba(15,23,42,0.55)] ${sidebarOpen ? 'xl:flex' : 'xl:hidden'}`}
        style={{ display: sidebarOpen ? 'flex' : 'none' }}
      >
        <Sidebar />
      </nav>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 xl:hidden" style={{ height: '100vh', overflow: 'hidden' }}>
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="relative w-full max-w-xs h-full flex flex-col shadow-[0_28px_80px_-50px_rgba(15,23,42,0.55)] bg-white" style={{ height: '100vh' }}>
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <Header onMenuClick={() => setSidebarOpen(prev => !prev)} installState={installState} />

        {state.systemStatus === 'offline' && (
          <div className="bg-amber-100 border-b border-amber-200 text-amber-700 text-sm px-4 py-2 text-center flex items-center justify-center gap-2">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true"></span>
            <span>You're offline. Changes will sync automatically when you reconnect.</span>
          </div>
        )}

        <main className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth no-scrollbar">
          <div className="p-3 pt-3 sm:p-5 sm:pt-4 xl:p-7 xl:pt-5 2xl:p-10 2xl:pt-6">
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
          className={`fixed inset-0 z-[70] flex flex-col items-center justify-center transition-opacity duration-500 ease-out ${
            shouldShowPlanLoader ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
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

      {/* Enhanced Toast Container - Mobile: Top Full Width, Desktop: Top Right */}
      <div className={`fixed z-50 ${isMobileView ? 'top-0 left-0 right-0' : 'top-4 right-4 flex flex-col max-w-sm'}`}>
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
};

export default Layout;

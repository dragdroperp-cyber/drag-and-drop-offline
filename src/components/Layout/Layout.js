import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import Sidebar from './Sidebar/Sidebar';
import Header from './Header/Header';
import MobileNavigation from './MobileNavigation/MobileNavigation';
import { usePWAInstall } from '../../hooks/usePWAInstall';

const Layout = ({ children }) => {
  const { state } = useApp();
  const planBootstrapState = state.planBootstrap || {};
  const shouldShowPlanLoader = planBootstrapState.isActive && !planBootstrapState.hasCompleted;
  const [isPlanLoaderVisible, setIsPlanLoaderVisible] = useState(shouldShowPlanLoader);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const { prompt, isInstallable, isInstalled, install } = usePWAInstall();
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [hasDismissedInstallPrompt, setHasDismissedInstallPrompt] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return sessionStorage.getItem('pwa-install-dismissed') === 'true';
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

  const showToast = (message, type = 'info', duration = 4000) => {
    const id = Date.now();
    setToasts(prev => {
      const withoutDuplicate = prev.filter(
        toast => !(toast.message === message && toast.type === type)
      );
      return [...withoutDuplicate, { id, message, type, duration }];
    });

    setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, duration);
  };

  useEffect(() => {
    window.showToast = showToast;
  }, []);

  const removeToast = (id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
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
      <nav className="hidden w-72 lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen shadow-[0_28px_90px_-55px_rgba(15,23,42,0.55)]">
        <Sidebar />
      </nav>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="relative flex w-full max-w-xs flex-1 flex-col shadow-[0_28px_80px_-50px_rgba(15,23,42,0.55)]">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <Header onMenuClick={() => setSidebarOpen(true)} installState={installState} />

        {state.systemStatus === 'offline' && (
          <div className="bg-amber-100 border-b border-amber-200 text-amber-700 text-sm px-4 py-2 text-center flex items-center justify-center gap-2">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true"></span>
            <span>You're offline. Changes will sync automatically when you reconnect.</span>
          </div>
        )}

        <main className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth no-scrollbar">
          <div className="p-3 sm:p-5 lg:p-7 xl:p-10">
            {children}
          </div>
        </main>
      </div>

      <MobileNavigation />

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

      <div className="fixed top-24 right-4 z-50 flex flex-col-reverse">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.5)] backdrop-blur-md min-w-[280px] max-w-[420px] mb-3 text-sm ${
              toast.type === 'success'
                ? 'border-emerald-200 bg-white/85 text-emerald-700'
                : toast.type === 'error'
                ? 'border-rose-200 bg-white/85 text-rose-700'
                : toast.type === 'warning'
                ? 'border-amber-200 bg-white/85 text-amber-700'
                : 'border-sky-200 bg-white/85 text-sky-700'
            }`}
          >
            <div className="flex-1">
              <p className="font-semibold capitalize">{toast.type || 'info'}</p>
              <p className="mt-1 leading-relaxed whitespace-pre-wrap break-words text-slate-600">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
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

import React, { useState, useCallback, useMemo } from 'react';
import { useApp } from '../../../context/AppContext';
import { Menu, Bell, Clock, Download, RefreshCw } from 'lucide-react';
import NotificationsModal from '../NotificationsModal/NotificationsModal';
import SyncStatus from '../SyncStatus/SyncStatus';
import { getTranslation } from '../../../utils/translations';

const Header = React.memo(({ onMenuClick, installState = {} }) => {
  const { state, refreshData } = useApp();
  const [showNotifications, setShowNotifications] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { isInstallable, isInstalled, install } = installState;

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshData();
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, refreshData]);

  const getViewTitle = useCallback((view) => getTranslation(view, state.currentLanguage), [state.currentLanguage]);

  // Memoize computed values to prevent recalculation on every render
  const { lowStockCount, expiringCount, totalAlerts } = useMemo(() => {
    const lowStock = state.products.filter(p => (p.quantity || p.stock || 0) <= state.lowStockThreshold).length;
    const expiring = state.products.filter(p => {
      if (!p.expiryDate) return false;
      const expiryDate = new Date(p.expiryDate);
      const now = new Date();
      const diffTime = expiryDate - now;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= state.expiryDaysThreshold;
    }).length;
    return {
      lowStockCount: lowStock,
      expiringCount: expiring,
      totalAlerts: lowStock + expiring
    };
  }, [state.products, state.lowStockThreshold, state.expiryDaysThreshold]);

  const handleNotificationsOpen = useCallback(() => setShowNotifications(true), []);
  const handleNotificationsClose = useCallback(() => setShowNotifications(false), []);

  const viewTitle = useMemo(() => getViewTitle(state.currentView), [getViewTitle, state.currentView]);
  const userInitial = useMemo(() => state.currentUser?.username?.charAt(0).toUpperCase() || 'U', [state.currentUser?.username]);
  const placeholderUrl = useMemo(() => `https://placehold.co/80x80/1b1b1b/ffffff?text=${userInitial}`, [userInitial]);

  const handleImageError = useCallback((e) => {
    e.currentTarget.src = placeholderUrl;
  }, [placeholderUrl]);

  return (
    <header className="relative overflow-hidden border-b border-slate-800 bg-slate-950/95 px-2.5 py-2 text-white sm:px-4 sm:py-2.5 lg:px-6 lg:py-3.5">
      <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-transparent to-white/5 opacity-40 pointer-events-none" />

      <div className="relative flex flex-row items-center justify-between gap-2 sm:gap-2.5 lg:gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={onMenuClick}
            className="xl:hidden inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-white transition hover:bg-white/20 active:scale-95"
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.2em] text-white/70 sm:text-[9px] sm:px-2 sm:tracking-[0.28em]">
              {viewTitle}
            </div>
            <h1 className="mt-1 text-base font-semibold leading-tight sm:text-lg sm:mt-1.5 lg:text-[24px] lg:tracking-tight">
              {viewTitle}
            </h1>
            <div className="mt-1 hidden items-center gap-1.5 text-xs text-white/70 sm:flex">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="font-mono text-xs font-semibold tracking-wide text-white/90 sm:text-sm">
                {state.currentTime}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 lg:gap-3">
          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-white transition hover:bg-white/20 active:scale-95 sm:h-9 sm:w-9 sm:rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Refresh data"
            title="Refresh Data"
          >
            <RefreshCw className={`h-4 w-4 sm:h-5 sm:w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          {/* Sync Status Indicator */}
          <SyncStatus />

          {isInstallable && !isInstalled && (
            <button
              onClick={install}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-[10px] font-semibold text-white transition hover:bg-white/20 active:scale-95 sm:text-xs sm:rounded-full sm:px-4"
              title="Install App"
            >
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Install App</span>
            </button>
          )}

          <button
            onClick={handleNotificationsOpen}
            className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-white transition hover:bg-white/20 active:scale-95 sm:h-9 sm:w-9 sm:rounded-full"
            aria-label="View notifications"
          >
            <Bell className="h-4 w-4 sm:h-5 sm:w-5" />
            {totalAlerts > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[8px] font-semibold text-white shadow-lg sm:h-4 sm:min-w-[18px] sm:text-[9px]">
                {totalAlerts}
              </span>
            )}
          </button>

          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-left sm:flex sm:gap-2.5 sm:px-3 sm:py-1.5">
            <div className="leading-tight text-white/80">
              <p className="text-[8px] font-semibold uppercase tracking-[0.2em] sm:text-[9px] sm:tracking-[0.26em]">User</p>
              <p className="text-xs font-semibold text-white leading-tight sm:text-sm">
                {state.currentUser?.username || 'User'}
              </p>
            </div>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/30 bg-white/10 sm:h-8 sm:w-8">
              <img
                className="h-full w-full object-cover"
                src={state.currentUser?.photoURL || placeholderUrl}
                alt="User avatar"
                onError={handleImageError}
              />
            </div>
          </div>
        </div>
      </div>

      {showNotifications && (
        <NotificationsModal onClose={handleNotificationsClose} />
      )}
    </header>
  );
});

Header.displayName = 'Header';

export default Header;


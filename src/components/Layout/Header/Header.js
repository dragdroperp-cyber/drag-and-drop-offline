import React, { useState, useCallback, useMemo } from 'react';
import { useApp, ActionTypes } from '../../../context/AppContext';
import { Menu, Bell, Clock, Download, RefreshCw } from 'lucide-react';
import NotificationsModal from '../NotificationsModal/NotificationsModal';
import SyncStatus from '../SyncStatus/SyncStatus';
import RefreshProgressModal from '../RefreshProgressModal/RefreshProgressModal';
import { getTranslation } from '../../../utils/translations';
import { registerRefreshProgressCallback } from '../../../utils/dataFetcher';
import { calculateProductAlerts } from '../../../utils/productUtils';

const Header = React.memo(({ onMenuClick, installState = {} }) => {
  const { state, dispatch, manualRefresh } = useApp();
  const [showNotifications, setShowNotifications] = useState(false);
  const isRefreshing = state.isManualRefreshing;
  const refreshError = state.manualRefreshError;
  const { isInstallable, isInstalled, install } = installState;

  const [syncDetailsOpen, setSyncDetailsOpen] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState(0);
  const [refreshMessage, setRefreshMessage] = useState('');

  // Subscribe to refresh progress
  React.useEffect(() => {
    return registerRefreshProgressCallback(({ progress, message }) => {
      setRefreshProgress(progress);
      setRefreshMessage(message);
    });
  }, []);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setRefreshProgress(0);
    setRefreshMessage('Starting refresh...');
    try {
      const result = await manualRefresh();
      // Ensure we hit 100% at end if successful
      if (result && result.success) {
        setRefreshProgress(100);
        setRefreshMessage('Complete');
      } else {
        setRefreshMessage('Failed');
      }
    } catch (error) {
      console.error("Refresh caught error", error);
      setRefreshMessage('Failed');
    }
  }, [isRefreshing, manualRefresh]);

  const handleRefreshClose = useCallback(() => {
    dispatch({ type: ActionTypes.SET_MANUAL_REFRESHING, payload: false });
    dispatch({ type: ActionTypes.SET_MANUAL_REFRESH_ERROR, payload: null });
    setRefreshProgress(0);
  }, [dispatch]);

  // ... (rest of code)

  // In JSX:
  // Remove isOpen={syncDetailsOpen} from SyncStatus? No, SyncStatus is still there for the icon.
  // But I don't need to control it from Refresh anymore.
  // So I can remove syncDetailsOpen state if it's only for refresh.
  // But wait, I added controlled props to SyncStatus in previous turn.
  // I should keep SyncStatus as is but just don't open it.

  // Add RefreshProgressModal
  /*
  <RefreshProgressModal 
    isOpen={isRefreshing} 
    progress={refreshProgress} 
    message={refreshMessage}
    onClose={handleRefreshClose}
  />
  */

  const getViewTitle = useCallback((view) => getTranslation(view, state.currentLanguage), [state.currentLanguage]);

  // Memoize computed values to prevent recalculation on every render
  const { totalAlerts } = useMemo(() => {
    return calculateProductAlerts(state.products, state.lowStockThreshold, state.expiryDaysThreshold);
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
            <h1 className="mt-1 text-base font-semibold leading-tight capitalize sm:text-lg sm:mt-1.5 lg:text-[24px] lg:tracking-tight">
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
            aria-label={getTranslation('refreshData', state.currentLanguage)}
            title={getTranslation('refreshData', state.currentLanguage)}
          >
            <RefreshCw className={`h-4 w-4 sm:h-5 sm:w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          {/* Sync Status Indicator */}
          <SyncStatus isOpen={syncDetailsOpen} onToggle={setSyncDetailsOpen} />

          <RefreshProgressModal
            isOpen={isRefreshing || refreshProgress === 100 || !!refreshError}
            progress={refreshProgress}
            message={refreshMessage}
            error={refreshError}
            onClose={handleRefreshClose}
          />

          {isInstallable && !isInstalled && (
            <button
              onClick={install}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-[10px] font-semibold text-white transition hover:bg-white/20 active:scale-95 sm:text-xs sm:rounded-full sm:px-4"
              title={getTranslation('installApp', state.currentLanguage)}
            >
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">{getTranslation('installApp', state.currentLanguage)}</span>
            </button>
          )}

          <button
            onClick={handleNotificationsOpen}
            className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-white transition hover:bg-white/20 active:scale-95 sm:h-9 sm:w-9 sm:rounded-full"
            aria-label={getTranslation('viewNotifications', state.currentLanguage)}
          >
            <Bell className="h-4 w-4 sm:h-5 sm:w-5" />
            {totalAlerts > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[8px] font-semibold text-white shadow-lg sm:h-4 sm:min-w-[18px] sm:text-[9px]">
                {totalAlerts}
              </span>
            )}
          </button>


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


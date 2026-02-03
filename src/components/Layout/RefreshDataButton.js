/**
 * Refresh All Data Button Component
 * Triggers a full sync and resets all metadata timestamps
 */

import React, { useState } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { performFullSync } from '../../services/syncManager';
import { useApp } from '../../context/AppContext';

const RefreshDataButton = () => {
  const { state, dispatch, manualRefresh } = useApp();
  const [localStatus, setLocalStatus] = useState(null); // 'success' | 'error' | null
  const isRefreshing = state.isManualRefreshing;

  const handleRefreshAll = async () => {
    if (isRefreshing) return;

    if (!navigator.onLine) {
      if (window.showToast) {
        window.showToast('Cannot refresh data while offline', 'warning');
      }
      return;
    }

    setLocalStatus(null);

    try {
      // Use the centralized manualRefresh from AppContext
      // This function handles: pushing local changes, fetching all data from /data/all,
      // updating all state slices, and most importantly, syncing planDetails and planUsageSummary.
      const result = await manualRefresh();

      if (result.success) {
        setLocalStatus('success');
        // Status resets after 3 seconds for UI feedback
        setTimeout(() => {
          setLocalStatus(null);
        }, 3000);
      } else {
        setLocalStatus('error');
        setTimeout(() => {
          setLocalStatus(null);
        }, 3000);
      }
    } catch (error) {
      console.error('Refresh button error:', error);
      setLocalStatus('error');
      setTimeout(() => {
        setLocalStatus(null);
      }, 3000);
    }
  };

  const getIcon = () => {
    if (isRefreshing) {
      return <Loader2 className="h-4 w-4 animate-spin" />;
    }
    if (localStatus === 'success') {
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    }
    if (localStatus === 'error') {
      return <AlertCircle className="h-4 w-4 text-red-600" />;
    }
    return <RefreshCw className="h-4 w-4" />;
  };

  const getButtonClass = () => {
    const base = "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors";
    if (isRefreshing) {
      return `${base} bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 cursor-wait`;
    }
    if (localStatus === 'success') {
      return `${base} bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30`;
    }
    if (localStatus === 'error') {
      return `${base} bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30`;
    }
    return `${base} bg-blue-50 dark:bg-white/10 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-white/20`;
  };

  return (
    <button
      onClick={handleRefreshAll}
      disabled={isRefreshing || !navigator.onLine}
      className={getButtonClass()}
      title={!navigator.onLine ? 'Refresh requires internet connection' : 'Refresh all data from server'}
    >
      {getIcon()}
      <span className="hidden sm:inline">
        {isRefreshing ? 'Refreshing...' : localStatus === 'success' ? 'Refreshed' : localStatus === 'error' ? 'Failed' : 'Refresh All Data'}
      </span>
      <span className="sm:hidden">
        {isRefreshing ? '...' : 'Refresh'}
      </span>
    </button>
  );
};

export default RefreshDataButton;

/**
 * Refresh All Data Button Component
 * Triggers a full sync and resets all metadata timestamps
 */

import React, { useState } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { performFullSync } from '../../services/syncManager';
import { useApp } from '../../context/AppContext';

const RefreshDataButton = () => {
  const { state, dispatch } = useApp();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState(null); // 'success' | 'error' | null

  const handleRefreshAll = async () => {
    if (isRefreshing) return;
    
    if (!navigator.onLine) {
      if (window.showToast) {
        window.showToast('Cannot refresh data while offline', 'warning');
      }
      return;
    }

    setIsRefreshing(true);
    setRefreshStatus(null);

    try {
      const result = await performFullSync();
      
      if (result.success) {
        setRefreshStatus('success');
        if (window.showToast) {
          const summary = result.summary || {};
          window.showToast(
            `Data refreshed successfully! ${summary.successful || 0} collections synced.`,
            'success'
          );
        }
        
        // Reload all data from IndexedDB to update state
        const { getAllItems, STORES } = await import('../../utils/indexedDB');
        const [
          customers,
          products,
          orders,
          transactions,
          purchaseOrders,
          categories,
          refunds
        ] = await Promise.all([
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.products).catch(() => []),
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => []),
          getAllItems(STORES.categories).catch(() => []),
          getAllItems(STORES.refunds).catch(() => [])
        ]);

        // Update state with refreshed data (exclude soft-deleted)
        dispatch({ type: 'SET_CUSTOMERS', payload: customers.filter(i => i.isDeleted !== true) });
        dispatch({ type: 'SET_PRODUCTS', payload: products.filter(i => i.isDeleted !== true) });
        dispatch({ type: 'SET_ORDERS', payload: orders.filter(i => i.isDeleted !== true) });
        dispatch({ type: 'SET_TRANSACTIONS', payload: transactions.filter(i => i.isDeleted !== true) });
        dispatch({ type: 'SET_PURCHASE_ORDERS', payload: purchaseOrders.filter(i => i.isDeleted !== true) });
        dispatch({ type: 'SET_CATEGORIES', payload: categories.filter(i => i.isDeleted !== true) });

        // Reset status after 3 seconds
        setTimeout(() => {
          setRefreshStatus(null);
        }, 3000);
      } else {
        setRefreshStatus('error');
        if (window.showToast) {
          window.showToast(`Refresh failed: ${result.error || 'Unknown error'}`, 'error');
        }
        setTimeout(() => {
          setRefreshStatus(null);
        }, 3000);
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
      setRefreshStatus('error');
      if (window.showToast) {
        window.showToast(`Refresh failed: ${error.message}`, 'error');
      }
      setTimeout(() => {
        setRefreshStatus(null);
      }, 3000);
    } finally {
      setIsRefreshing(false);
    }
  };

  const getIcon = () => {
    if (isRefreshing) {
      return <Loader2 className="h-4 w-4 animate-spin" />;
    }
    if (refreshStatus === 'success') {
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    }
    if (refreshStatus === 'error') {
      return <AlertCircle className="h-4 w-4 text-red-600" />;
    }
    return <RefreshCw className="h-4 w-4" />;
  };

  const getButtonClass = () => {
    const base = "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors";
    if (isRefreshing) {
      return `${base} bg-gray-100 text-gray-600 cursor-wait`;
    }
    if (refreshStatus === 'success') {
      return `${base} bg-green-50 text-green-700 hover:bg-green-100`;
    }
    if (refreshStatus === 'error') {
      return `${base} bg-red-50 text-red-700 hover:bg-red-100`;
    }
    return `${base} bg-blue-50 text-blue-700 hover:bg-blue-100`;
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
        {isRefreshing ? 'Refreshing...' : refreshStatus === 'success' ? 'Refreshed' : refreshStatus === 'error' ? 'Failed' : 'Refresh All Data'}
      </span>
      <span className="sm:hidden">
        {isRefreshing ? '...' : 'Refresh'}
      </span>
    </button>
  );
};

export default RefreshDataButton;


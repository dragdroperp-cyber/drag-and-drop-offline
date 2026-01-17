import React, { useState } from 'react';
import { performFullSync, resetAllSyncTimestamps } from '../services/syncManager';
import { useApp, ActionTypes } from '../context/AppContext';
import { isProfileComplete } from '../utils/profileUtils';

const RefreshDataButton = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { state, dispatch } = useApp();

  const handleRefreshAllData = async () => {
    if (isRefreshing) return;

    // ONLY REFRESH IF PROFILE IS COMPLETED
    if (!isProfileComplete(state.currentUser)) {
      if (window.showToast) {
        window.showToast('Please complete your profile to enable data synchronization.', 'warning');
      }
      return;
    }

    try {
      setIsRefreshing(true);
      // Show loading state
      if (window.showToast) {
        window.showToast('Refreshing all data...', 'info');
      }
      // Reset sync metadata to force full sync
      await resetAllSyncTimestamps();
      // Perform full sync
      const syncResult = await performFullSync();
      if (syncResult.success) {
        // Reload all data from IndexedDB to update UI
        const { getAllItems, STORES } = await import('../utils/indexedDB');
        const [
          customers,
          products,
          orders,
          transactions,
          purchaseOrders,
          categories,
          activities,
          planOrders,
          dProducts
        ] = await Promise.all([
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.products).catch(() => []),
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => []),
          getAllItems(STORES.categories).catch(() => []),
          getAllItems(STORES.activities).catch(() => []),
          getAllItems(STORES.planOrders).catch(() => []),
          getAllItems(STORES.dProducts).catch(() => [])
        ]);
        // Update UI state with refreshed data
        dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: customers.filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PRODUCTS, payload: products.filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_D_PRODUCTS, payload: dProducts.filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_ORDERS, payload: orders.filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: transactions.filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: purchaseOrders.filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_CATEGORIES, payload: categories.filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: planOrders.filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_ACTIVITIES, payload: activities });
        if (window.showToast) {
          window.showToast(`Data refreshed successfully! Synced ${syncResult.summary.successful} collections.`, 'success');
        }
      } else {
        throw new Error('Full sync failed');
      }
    } catch (error) {
      if (window.showToast) {
        window.showToast('Failed to refresh data. Please try again.', 'error');
      }
    } finally {
      setIsRefreshing(false);
    }
  };
  return (
    <button
      onClick={handleRefreshAllData}
      disabled={isRefreshing}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${isRefreshing
        ? 'bg-gray-400 cursor-not-allowed text-gray-200'
        : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      title="Refresh all data from server (resets sync timestamps)"
    >
      {isRefreshing ? (
        <>
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
          Refreshing...
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh All Data
        </>
      )}
    </button>
  );
};
export default RefreshDataButton;

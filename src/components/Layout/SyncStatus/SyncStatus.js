import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../../../context/AppContext';
import { Cloud, CloudOff, CheckCircle2, Loader2, Info, X } from 'lucide-react';
import syncService from '../../../services/syncService';
import { getAllItems, STORES } from '../../../utils/indexedDB';

const SyncStatus = () => {
  const { state } = useApp();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [forceUpdate, setForceUpdate] = useState(0);
  const [indexedDBData, setIndexedDBData] = useState({
    products: [],
    customers: [],
    orders: [],
    transactions: [],
    purchaseOrders: [],
    categories: [],
    refunds: []
  });
  const syncListenerRef = useRef(null);
  const [showDetails, setShowDetails] = useState(false);
  const detailsRef = useRef(null);

  // Update online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load data from IndexedDB to include deleted items
  useEffect(() => {
    const loadIndexedDBData = async () => {
      try {
        const [products, customers, orders, transactions, purchaseOrders, categories, refunds] = await Promise.all([
          getAllItems(STORES.products).catch(() => []),
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => []),
          getAllItems(STORES.categories).catch(() => []),
          getAllItems(STORES.refunds).catch(() => [])
        ]);

        setIndexedDBData({
          products: products || [],
          customers: customers || [],
          orders: orders || [],
          transactions: transactions || [],
          purchaseOrders: purchaseOrders || [],
          categories: categories || [],
          refunds: refunds || []
        });
      } catch (error) {
        console.error('Error loading IndexedDB data for sync status:', error);
      }
    };

    loadIndexedDBData();
  }, [forceUpdate]); // Reload when forceUpdate changes

  // Force re-render periodically to catch sync updates
  useEffect(() => {
    // Check sync status every 1 second to update in real-time
    const interval = setInterval(() => {
      setForceUpdate(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Also listen to storage events (when IndexedDB updates from other tabs/windows)
  useEffect(() => {
    const handleStorageChange = () => {
      setForceUpdate(prev => prev + 1);
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Calculate sync status for all stores
  // Use IndexedDB data to include deleted items that need sync
  const syncStatus = useMemo(() => {
    // Use IndexedDB data (includes deleted items) merged with state data
    // This ensures we count deleted items that need sync
    const products = Array.isArray(indexedDBData.products) && indexedDBData.products.length > 0 
      ? indexedDBData.products 
      : (Array.isArray(state.products) ? [...state.products] : []);
    const customers = Array.isArray(indexedDBData.customers) && indexedDBData.customers.length > 0 
      ? indexedDBData.customers 
      : (Array.isArray(state.customers) ? [...state.customers] : []);
    const orders = Array.isArray(indexedDBData.orders) && indexedDBData.orders.length > 0 
      ? indexedDBData.orders 
      : (Array.isArray(state.orders) ? [...state.orders] : []);
    const transactions = Array.isArray(indexedDBData.transactions) && indexedDBData.transactions.length > 0 
      ? indexedDBData.transactions 
      : (Array.isArray(state.transactions) ? [...state.transactions] : []);
    const purchaseOrders = Array.isArray(indexedDBData.purchaseOrders) && indexedDBData.purchaseOrders.length > 0 
      ? indexedDBData.purchaseOrders 
      : (Array.isArray(state.purchaseOrders) ? [...state.purchaseOrders] : []);
    const categories = Array.isArray(indexedDBData.categories) && indexedDBData.categories.length > 0 
      ? indexedDBData.categories 
      : (Array.isArray(state.categories) ? [...state.categories] : []);
    const refunds = Array.isArray(indexedDBData.refunds) && indexedDBData.refunds.length > 0 
      ? indexedDBData.refunds 
      : [];

    const stores = {
      products,
      customers,
      orders,
      transactions,
      purchaseOrders,
      categories,
      refunds
    };

    let totalItems = 0;
    let syncedItems = 0;
    let unsyncedItems = 0;
    const unsyncedByStore = {
      products: { count: 0, items: [], reasons: { new: 0, update: 0, deletion: 0 }, errors: [] },
      customers: { count: 0, items: [], reasons: { new: 0, update: 0, deletion: 0 }, errors: [] },
      orders: { count: 0, items: [], reasons: { new: 0, update: 0, deletion: 0 }, errors: [] },
      transactions: { count: 0, items: [], reasons: { new: 0, update: 0, deletion: 0 }, errors: [] },
      purchaseOrders: { count: 0, items: [], reasons: { new: 0, update: 0, deletion: 0 }, errors: [] },
      categories: { count: 0, items: [], reasons: { new: 0, update: 0, deletion: 0 }, errors: [] },
      refunds: { count: 0, items: [], reasons: { new: 0, update: 0, deletion: 0 }, errors: [] }
    };

    // Process each store
    Object.entries(stores).forEach(([storeName, items]) => {
      if (!Array.isArray(items)) return;

      items.forEach(item => {
        // Count all items (including deleted ones that need sync)
        totalItems++;
        
        // Check if item needs sync
        // Item needs sync if isSynced is not true (false, null, or undefined)
        // This includes:
        // - New items that haven't been synced yet
        // - Updated items that haven't been synced yet  
        // - Deleted items whose deletion hasn't been synced yet
        const needsSync = item.isSynced !== true;

        if (needsSync) {
          unsyncedItems++;
          // Track unsynced items by store
          if (unsyncedByStore[storeName]) {
            unsyncedByStore[storeName].count++;
            
            // Check if item has sync error
            const hasSyncError = item.syncError && typeof item.syncError === 'string';
            
            // Determine reason why item is not synced
            let reason = 'update';
            if (item.isDeleted) {
              reason = 'deletion';
            } else if (!item._id) {
              reason = 'new';
            }
            
            // Track reasons
            if (unsyncedByStore[storeName].reasons[reason] !== undefined) {
              unsyncedByStore[storeName].reasons[reason]++;
            }
            
            // Track sync errors
            if (hasSyncError) {
              // For refunds, use orderId or refund ID as the name
              const itemName = storeName === 'refunds' 
                ? (item.orderId ? `Order ${item.orderId}` : item.id || 'Unknown')
                : (item.name || item.supplierName || item.id || 'Unknown');
              const errorInfo = {
                name: itemName,
                error: item.syncError,
                attempts: item.syncAttempts || 1,
                lastAttempt: item.lastSyncAttempt || null
              };
              // Limit to first 3 errors for display
              if (unsyncedByStore[storeName].errors.length < 3) {
                unsyncedByStore[storeName].errors.push(errorInfo);
              }
            }
            
            // Store item info (limit to first 5 for display)
            if (unsyncedByStore[storeName].items.length < 5) {
              // For refunds, use orderId or refund ID as the name
              const itemName = storeName === 'refunds' 
                ? (item.orderId ? `Order ${item.orderId}` : item.id || 'Unknown')
                : (item.name || item.supplierName || item.id || 'Unknown');
              unsyncedByStore[storeName].items.push({ 
                name: itemName, 
                type: reason,
                reason: reason === 'new' ? 'New item' : reason === 'deletion' ? 'Pending deletion' : 'Pending update',
                hasError: hasSyncError,
                error: hasSyncError ? item.syncError : null
              });
            }
          }
        } else {
          syncedItems++;
        }
      });
    });

    // Calculate percentage
    const percentage = totalItems > 0 
      ? Math.round((syncedItems / totalItems) * 100) 
      : 100;

    return {
      totalItems,
      syncedItems,
      unsyncedItems,
      percentage,
      isFullySynced: unsyncedItems === 0 && totalItems > 0,
      unsyncedByStore
    };
  }, [
    state.products,
    state.customers,
    state.orders,
    state.transactions,
    state.purchaseOrders,
    state.categories,
    indexedDBData.products,
    indexedDBData.customers,
    indexedDBData.orders,
    indexedDBData.transactions,
    indexedDBData.purchaseOrders,
    indexedDBData.categories,
    indexedDBData.refunds,
    forceUpdate // Force recalculation when forceUpdate changes
  ]);

  const { percentage, unsyncedItems, isFullySynced, unsyncedByStore } = syncStatus;

  // Refs and state for popover positioning (must be before early return)
  const buttonRef = useRef(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, right: 0 });

  // Close details popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (detailsRef.current && !detailsRef.current.contains(event.target)) {
        setShowDetails(false);
      }
    };

    if (showDetails) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDetails]);

  // Calculate popover position when opening
  useEffect(() => {
    if (showDetails && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopoverPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right
      });
    }
  }, [showDetails]);

  // Determine sync reason
  const getSyncReason = () => {
    if (!isOnline) {
      return {
        reason: 'Offline',
        message: 'You are currently offline. Data will sync automatically when you reconnect to the internet.',
        details: []
      };
    }

    if (isFullySynced) {
      return {
        reason: 'All synced',
        message: 'All data is successfully synced to the database.',
        details: []
      };
    }

    // Build detailed breakdown
    const details = [];
    const storeLabels = {
      products: 'Products',
      customers: 'Customers',
      orders: 'Orders',
      transactions: 'Transactions',
      purchaseOrders: 'Purchase Orders',
      categories: 'Categories',
      refunds: 'Refunds'
    };

    Object.entries(unsyncedByStore).forEach(([storeName, data]) => {
      if (data.count > 0) {
        const label = storeLabels[storeName] || storeName;
        const itemText = data.count === 1 ? 'item' : 'items';
        
        // Build reason breakdown
        const reasonParts = [];
        if (data.reasons.new > 0) {
          reasonParts.push(`${data.reasons.new} new`);
        }
        if (data.reasons.update > 0) {
          reasonParts.push(`${data.reasons.update} update${data.reasons.update > 1 ? 's' : ''}`);
        }
        if (data.reasons.deletion > 0) {
          reasonParts.push(`${data.reasons.deletion} deletion${data.reasons.deletion > 1 ? 's' : ''}`);
        }
        
        // Count items with errors
        const errorCount = data.errors.length;
        const hasErrors = errorCount > 0;
        
        details.push({
          store: label,
          count: data.count,
          items: data.items,
          reasons: data.reasons,
          reasonBreakdown: reasonParts.join(', '),
          errors: data.errors,
          errorCount: errorCount,
          hasErrors: hasErrors,
          message: `${data.count} ${itemText} pending sync${hasErrors ? ` (${errorCount} with errors)` : ''} (${reasonParts.join(', ')})`
        });
      }
    });

    // Determine primary reason
    let reason = 'Pending sync';
    let message = `${unsyncedItems} item(s) are waiting to sync to the database.`;

    // Check if sync service is currently syncing
    if (syncService.isSyncing) {
      reason = 'Syncing in progress';
      message = 'Data is currently being synced to the database. Please wait...';
    } else if (unsyncedItems > 0) {
      reason = 'Pending sync';
      message = `${unsyncedItems} item(s) are waiting to sync. Sync happens automatically every 30 seconds.`;
    }

    return { reason, message, details };
  };

  const syncReason = getSyncReason();

  // Don't show if no items exist
  if (syncStatus.totalItems === 0) {
    return null;
  }

  // Determine status color and icon (matching Header's dark theme)
  const getStatusStyle = () => {
    if (!isOnline) {
      return {
        bg: 'bg-white/5',
        text: 'text-white/60',
        border: 'border-white/10',
        icon: CloudOff,
        iconColor: 'text-white/50'
      };
    }
    
    if (isFullySynced) {
      return {
        bg: 'bg-emerald-500/20',
        text: 'text-emerald-300',
        border: 'border-emerald-400/30',
        icon: CheckCircle2,
        iconColor: 'text-emerald-400'
      };
    }
    
    if (percentage >= 80) {
      return {
        bg: 'bg-blue-500/20',
        text: 'text-blue-300',
        border: 'border-blue-400/30',
        icon: Cloud,
        iconColor: 'text-blue-400'
      };
    }
    
    if (percentage >= 50) {
      return {
        bg: 'bg-yellow-500/20',
        text: 'text-yellow-300',
        border: 'border-yellow-400/30',
        icon: Loader2,
        iconColor: 'text-yellow-400 animate-spin'
      };
    }
    
    return {
      bg: 'bg-orange-500/20',
      text: 'text-orange-300',
      border: 'border-orange-400/30',
      icon: Loader2,
      iconColor: 'text-orange-400 animate-spin'
    };
  };

  const statusStyle = getStatusStyle();
  const Icon = statusStyle.icon;

  return (
    <>
      <div className="relative" ref={detailsRef}>
        <div 
          ref={buttonRef}
          className={`inline-flex items-center gap-1.5 rounded-lg border ${statusStyle.border} ${statusStyle.bg} px-2.5 py-1.5 transition-all duration-300 cursor-pointer hover:opacity-80`}
          onClick={() => setShowDetails(!showDetails)}
          title="Click to see sync details"
        >
          <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${statusStyle.iconColor}`} />
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-semibold sm:text-xs ${statusStyle.text}`}>
              {percentage}%
            </span>
            {!isFullySynced && isOnline && (
              <span className={`text-[9px] ${statusStyle.text} opacity-75 hidden sm:inline`}>
                {unsyncedItems}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Sync Details Popover - Fixed positioning to appear above all content */}
      {showDetails && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-[99] bg-transparent"
            onClick={() => setShowDetails(false)}
          />
          <div 
            className="fixed w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-gray-200 z-[100] p-4"
            style={{
              top: `${popoverPosition.top}px`,
              right: `${popoverPosition.right}px`
            }}
          >
          <div className="flex items-start justify-between mb-3">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Sync Status</h4>
              <p className="text-xs text-gray-500 mt-0.5">{syncReason.reason}</p>
            </div>
            <button
              onClick={() => setShowDetails(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-700">Overall Progress</span>
              <span className="text-xs font-semibold text-gray-900">{percentage}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  isFullySynced ? 'bg-green-500' : percentage >= 80 ? 'bg-blue-500' : percentage >= 50 ? 'bg-yellow-500' : 'bg-orange-500'
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1 text-xs text-gray-600">
              <span>{syncStatus.syncedItems} synced</span>
              <span>{unsyncedItems} pending</span>
            </div>
          </div>

          <div className="mb-3">
            <p className="text-xs text-gray-700 mb-2">{syncReason.message}</p>
          </div>

          {syncReason.details.length > 0 && (
            <div className="border-t border-gray-200 pt-3">
              <p className="text-xs font-semibold text-gray-700 mb-2">Pending by Type:</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {syncReason.details.map((detail, idx) => (
                  <div key={idx} className="flex flex-col gap-1 text-xs">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-700">{detail.store}:</span>
                        <span className="text-gray-600 ml-1">{detail.count} {detail.count === 1 ? 'item' : 'items'}</span>
                      </div>
                    </div>
                    {/* Reason breakdown */}
                    <div className="ml-2 text-[10px] text-gray-500">
                      <span className="font-medium">Reasons:</span> {detail.reasonBreakdown}
                    </div>
                    {/* Sync Errors */}
                    {detail.hasErrors && (
                      <div className="ml-2 mt-1 space-y-1">
                        <div className="text-[10px] font-medium text-red-600">
                          ⚠️ Sync Errors ({detail.errorCount}):
                        </div>
                        {detail.errors.map((errorItem, errorIdx) => (
                          <div key={errorIdx} className="ml-2 text-[9px] text-red-500 bg-red-50 rounded px-1.5 py-1 border border-red-200">
                            <div className="font-medium text-red-700">{errorItem.name}</div>
                            <div className="text-red-600 mt-0.5 truncate" title={errorItem.error}>
                              {errorItem.error}
                            </div>
                            {errorItem.attempts > 1 && (
                              <div className="text-[8px] text-red-400 mt-0.5">
                                Attempt {errorItem.attempts}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Sample items */}
                    {detail.items.length > 0 && (
                      <div className="mt-0.5 ml-2 space-y-0.5">
                        {detail.items.slice(0, 3).map((item, itemIdx) => (
                          <div key={itemIdx} className={`text-[10px] truncate flex items-center gap-1 ${item.hasError ? 'text-red-600' : 'text-gray-500'}`}>
                            <span>•</span>
                            <span className="flex-1 truncate">{item.name}</span>
                            <span className={`text-[9px] ${item.hasError ? 'text-red-500' : 'text-gray-400'}`}>
                              ({item.hasError ? 'Error' : item.reason})
                            </span>
                          </div>
                        ))}
                        {detail.count > 3 && (
                          <div className="text-[10px] text-gray-400">
                            ... and {detail.count - 3} more
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isOnline && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="flex items-start gap-2 text-xs text-amber-600">
                <CloudOff className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Offline Mode</p>
                  <p className="text-gray-600 mt-0.5">Data will sync automatically when you reconnect.</p>
                </div>
              </div>
            </div>
          )}

          {isOnline && !isFullySynced && !syncService.isSyncing && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="flex items-start gap-2 text-xs text-blue-600">
                <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Auto-sync Active</p>
                  <p className="text-gray-600 mt-0.5">Data syncs automatically every 30 seconds.</p>
                </div>
              </div>
            </div>
          )}
        </div>
        </>
      )}
    </>
  );
};

export default SyncStatus;


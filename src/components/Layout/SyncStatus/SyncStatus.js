import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useApp, registerSyncStatusCallback, unregisterSyncStatusCallback, isCurrentPlanExpired } from '../../../context/AppContext';
import { Cloud, CloudOff, CheckCircle2, Loader2, Info, X, Database, Package, Users, ShoppingCart, Receipt, CreditCard, Truck, IndianRupee, RotateCcw, AlertTriangle } from 'lucide-react';
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
    productBatches: [],
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
        const [products, customers, orders, transactions, purchaseOrders, productBatches, categories, refunds] = await Promise.all([
          getAllItems(STORES.products).catch(() => []),
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => []),
          getAllItems(STORES.productBatches).catch(() => []),
          getAllItems(STORES.categories).catch(() => []),
          getAllItems(STORES.refunds).catch(() => [])
        ]);

        setIndexedDBData({
          products: products || [],
          customers: customers || [],
          orders: orders || [],
          transactions: transactions || [],
          purchaseOrders: purchaseOrders || [],
          productBatches: productBatches || [],
          categories: categories || [],
          refunds: refunds || []
        });
      } catch (error) {

      }
    };

    loadIndexedDBData();
  }, [forceUpdate]); // Reload when forceUpdate changes

  // Force re-render periodically to catch sync updates (reduced frequency to prevent excessive IndexedDB checks)
  useEffect(() => {
    // Check sync status every 60 seconds instead of every second to reduce IndexedDB load
    const interval = setInterval(() => {
      setForceUpdate(prev => prev + 1);
    }, 60000); // 60 seconds instead of 1 second

    return () => clearInterval(interval);
  }, []);

  // Callback to trigger sync status update instantly
  const triggerSyncUpdate = useCallback(() => {
    setForceUpdate(prev => prev + 1);
  }, []);

  // Register callback for instant sync status updates when data changes
  useEffect(() => {
    const unregister = registerSyncStatusCallback(triggerSyncUpdate);
    return unregister;
  }, [triggerSyncUpdate]);

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
    const productBatches = Array.isArray(indexedDBData.productBatches) && indexedDBData.productBatches.length > 0
      ? indexedDBData.productBatches
      : [];

    const stores = {
      products,
      customers,
      orders,
      transactions,
      purchaseOrders,
      productBatches,
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
      productBatches: { count: 0, items: [], reasons: { new: 0, update: 0, deletion: 0 }, errors: [] },
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
      if (detailsRef.current && typeof detailsRef.current.contains === 'function' && event.target && !detailsRef.current.contains(event.target)) {
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
          message: `${data.count} ${itemText} left to sync${hasErrors ? ` (${errorCount} with errors)` : ''} - ${reasonParts.join(', ')}`
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

  // Calculate individual sync percentages for each data type
  const getDataTypeSyncStatus = () => {
    const dataTypes = {
      products: {
        icon: Package,
        label: 'Products',
        color: 'text-blue-600 dark:text-blue-400',
        bgColor: 'bg-blue-50 dark:bg-blue-900/20',
        borderColor: 'border-blue-200 dark:border-blue-800/30'
      },
      customers: {
        icon: Users,
        label: 'Customers',
        color: 'text-green-600 dark:text-green-400',
        bgColor: 'bg-green-50 dark:bg-green-900/20',
        borderColor: 'border-green-200 dark:border-green-800/30'
      },
      orders: {
        icon: ShoppingCart,
        label: 'Orders',
        color: 'text-purple-600 dark:text-purple-400',
        bgColor: 'bg-purple-50 dark:bg-purple-900/20',
        borderColor: 'border-purple-200 dark:border-purple-800/30'
      },
      transactions: {
        icon: IndianRupee,
        label: 'Transactions',
        color: 'text-emerald-600 dark:text-emerald-400',
        bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
        borderColor: 'border-emerald-200 dark:border-emerald-800/30'
      },
      purchaseOrders: {
        icon: Truck,
        label: 'Purchase Orders',
        color: 'text-orange-600 dark:text-orange-400',
        bgColor: 'bg-orange-50 dark:bg-orange-900/20',
        borderColor: 'border-orange-200 dark:border-orange-800/30'
      },
      categories: {
        icon: Database,
        label: 'Categories',
        color: 'text-indigo-600 dark:text-indigo-400',
        bgColor: 'bg-indigo-50 dark:bg-indigo-900/20',
        borderColor: 'border-indigo-200 dark:border-indigo-800/30'
      },
      productBatches: {
        icon: Package,
        label: 'Product Batches',
        color: 'text-cyan-600 dark:text-cyan-400',
        bgColor: 'bg-cyan-50 dark:bg-cyan-900/20',
        borderColor: 'border-cyan-200 dark:border-cyan-800/30'
      },
      refunds: {
        icon: RotateCcw,
        label: 'Refunds',
        color: 'text-red-600 dark:text-red-400',
        bgColor: 'bg-red-50 dark:bg-red-900/20',
        borderColor: 'border-red-200 dark:border-red-800/30'
      }
    };

    return Object.entries(dataTypes).map(([key, config]) => {
      const data = unsyncedByStore[key] || { count: 0 };
      // Use the actual store data length for total items
      const storeData = Array.isArray(indexedDBData[key]) ? indexedDBData[key] : [];
      const totalForType = storeData.length;
      const syncedForType = totalForType - data.count;
      const percentageForType = totalForType > 0 ? Math.round((syncedForType / totalForType) * 100) : 100;

      return {
        key,
        ...config,
        totalItems: totalForType,
        syncedItems: syncedForType,
        unsyncedItems: data.count,
        percentage: percentageForType,
        reasons: data.reasons || { new: 0, update: 0, deletion: 0 },
        errors: data.errors || []
      };
    });
  };

  const dataTypeStatuses = getDataTypeSyncStatus();

  return (
    <>
      <div className="relative flex items-center gap-2" ref={detailsRef}>
        {/* Sync Status Indicator */}
        <div
          ref={buttonRef}
          className={`inline-flex items-center gap-1.5 rounded-lg border ${statusStyle.border} ${statusStyle.bg} px-2.5 py-1.5 transition-all duration-300 cursor-pointer hover:opacity-80`}
          onClick={() => setShowDetails(!showDetails)}
          title="Click to see detailed sync status"
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

      {/* Detailed Sync Status Modal - Centered on screen like OrderHistoryModal */}
      {showDetails && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-[1050] p-0 sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-none sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-w-4xl sm:max-h-[90vh] flex flex-col overflow-hidden transition-colors duration-200">
            {/* Fixed Header */}
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800/50">
                  <Database className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">Sync Status Details</h2>
                  <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Data synchronization status by type</p>
                </div>
              </div>
              <button
                onClick={() => setShowDetails(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
                aria-label="Close sync details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Fixed Security Message - Always visible */}
            {(() => {
              const planExpired = isCurrentPlanExpired(state.currentPlanDetails, Date.now());
              const syncIncomplete = percentage < 100;

              if (syncIncomplete) {
                const message = planExpired
                  ? "Your data is not safe - Upgrade your plan to make your data safe and secure"
                  : "Your data is not fully synced - Complete sync to secure your data";

                return (
                  <div className="px-4 sm:px-6 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800/50 flex-shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/50">
                        <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-red-800 dark:text-red-200">Your data is not safe</p>
                        <p className="text-xs text-red-600 dark:text-red-300">{message}</p>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div className="px-4 sm:px-6 py-3 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800/50 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/50">
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-green-800 dark:text-green-200">Your data is now safe and secure</p>
                      <p className="text-xs text-green-600 dark:text-green-300">All synced data is securely stored in the cloud</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Scrollable Content - Everything below security message */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {/* Overall Progress - Now scrollable on mobile */}
              <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{syncStatus.totalItems}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">Total Items</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">{syncStatus.syncedItems}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">Synced</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{unsyncedItems}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">Left to Sync</div>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Overall Progress</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                    <div
                      className={`h-3 rounded-full transition-all duration-300 ${isFullySynced ? 'bg-green-500' : percentage >= 80 ? 'bg-blue-500' : percentage >= 50 ? 'bg-yellow-500' : 'bg-orange-500'
                        }`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Data Type Cards */}
              <div className="px-4 sm:px-6 pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {dataTypeStatuses.map((dataType) => {
                    const IconComponent = dataType.icon;
                    const isFullySyncedType = dataType.unsyncedItems === 0;
                    const hasErrors = dataType.errors.length > 0;

                    return (
                      <div
                        key={dataType.key}
                        className={`rounded-xl border ${dataType.borderColor} ${dataType.bgColor} p-4 transition-all hover:shadow-md`}
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <IconComponent className={`h-5 w-5 ${dataType.color}`} />
                            <span className="font-semibold text-gray-900 dark:text-gray-100">{dataType.label}</span>
                          </div>
                          <span className={`text-sm font-bold ${dataType.color}`}>
                            {dataType.percentage}%
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="mb-3">
                          <div className="w-full bg-white/50 dark:bg-black/20 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all duration-300 ${isFullySyncedType ? 'bg-green-500' : dataType.percentage >= 80 ? 'bg-blue-500' : dataType.percentage >= 50 ? 'bg-yellow-500' : 'bg-orange-500'
                                }`}
                              style={{ width: `${dataType.percentage}%` }}
                            />
                          </div>
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="text-center">
                            <div className="font-semibold text-gray-900 dark:text-gray-100">{dataType.syncedItems}</div>
                            <div className="text-gray-500 dark:text-gray-400">Synced</div>
                          </div>
                          <div className="text-center">
                            <div className={`font-semibold ${dataType.unsyncedItems > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-gray-100'}`}>
                              {dataType.unsyncedItems}
                            </div>
                            <div className="text-gray-500 dark:text-gray-400">Pending</div>
                          </div>
                        </div>

                        {/* Status */}
                        <div className="mt-3 pt-3 border-t border-white/50 dark:border-white/10">
                          {isFullySyncedType ? (
                            <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-300">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Fully synced</span>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="text-xs text-gray-700 dark:text-gray-300">
                                {dataType.unsyncedItems} item{dataType.unsyncedItems !== 1 ? 's' : ''} left to sync
                              </div>
                              {dataType.reasons.new > 0 && (
                                <div className="text-[10px] text-blue-600 dark:text-blue-400">
                                  • {dataType.reasons.new} new
                                </div>
                              )}
                              {dataType.reasons.update > 0 && (
                                <div className="text-[10px] text-orange-600 dark:text-orange-400">
                                  • {dataType.reasons.update} update{dataType.reasons.update > 1 ? 's' : ''}
                                </div>
                              )}
                              {dataType.reasons.deletion > 0 && (
                                <div className="text-[10px] text-red-600 dark:text-red-400">
                                  • {dataType.reasons.deletion} deletion{dataType.reasons.deletion > 1 ? 's' : ''}
                                </div>
                              )}
                            </div>
                          )}

                          {hasErrors && (
                            <div className="mt-2 pt-2 border-t border-white/50 dark:border-white/10">
                              <div className="text-[10px] font-medium text-red-600 dark:text-red-400 mb-1">
                                ⚠️ {dataType.errors.length} sync error{dataType.errors.length > 1 ? 's' : ''}
                              </div>
                              {dataType.errors.slice(0, 2).map((error, idx) => (
                                <div key={idx} className="text-[9px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded px-1.5 py-1 mb-1">
                                  <div className="font-medium truncate">{error.name}</div>
                                  <div className="truncate" title={error.error}>{error.error}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Additional Info */}
              <div className="px-4 sm:px-6 pb-4 space-y-3">
                {!isOnline && (
                  <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg">
                    <CloudOff className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-amber-800 dark:text-amber-200">Offline Mode</p>
                      <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">Data will sync automatically when you reconnect to the internet.</p>
                    </div>
                  </div>
                )}

                {isOnline && !isFullySynced && !syncService.isSyncing && (
                  <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-lg">
                    <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-blue-800 dark:text-blue-200">Auto-sync Active</p>
                      <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">Data syncs automatically every 30 seconds.</p>
                    </div>
                  </div>
                )}

                {isOnline && syncService.isSyncing && (
                  <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-lg">
                    <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5 animate-spin" />
                    <div>
                      <p className="font-semibold text-blue-800 dark:text-blue-200">Syncing in Progress</p>
                      <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">Please wait while data is being synchronized...</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SyncStatus;

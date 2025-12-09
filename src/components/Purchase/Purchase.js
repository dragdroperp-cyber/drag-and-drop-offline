import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Plus,
  Search,
  Package,
  Truck,
  Calendar,
  Trash2,
  Edit,
  CheckCircle,
  Clock,
  AlertCircle,
  ShoppingCart,
  TrendingUp,
  Eye,
  X
} from 'lucide-react';
import AddPurchaseOrderModal from './AddPurchaseOrderModal';

const Purchase = () => {
  const { state, dispatch } = useApp();
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, orderId: null, orderInfo: null });
  const [viewOrderDetails, setViewOrderDetails] = useState(null);

  const itemsPerPage = 10;

  // Filter purchase orders - exclude deleted items
  const filteredOrders = state.purchaseOrders.filter(order => {
    // Exclude deleted items from UI (they're kept in IndexedDB for sync)
    if (order.isDeleted === true) return false;

    const matchesSearch = order.supplierName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         order.id.includes(searchTerm);
    const matchesStatus = filterStatus === 'all' || order.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedOrders = filteredOrders.slice(startIndex, startIndex + itemsPerPage);

  // Calculate stats - exclude deleted items
  const activeOrders = state.purchaseOrders.filter(order => order.isDeleted !== true);
  const completedOrdersOnly = activeOrders.filter(order => order.status === 'completed');
  const totalOrders = completedOrdersOnly.length; // Only count completed orders
  const pendingOrders = activeOrders.filter(order => order.status === 'pending').length;
  const completedOrders = completedOrdersOnly.length;
  const totalValue = completedOrdersOnly.reduce((sum, order) => sum + (Number(order.total) || 0), 0); // Only sum completed orders

  // Debug function to check IndexedDB, MongoDB vs State
  const debugPurchaseOrders = async () => {
    try {
      const { getAllItems, STORES } = await import('../../utils/indexedDB');
      const indexedDBOrders = await getAllItems(STORES.purchaseOrders);

      // Try to get MongoDB count if online
      let mongoDBCount = null;
      if (navigator.onLine) {
        try {
          const response = await fetch('/api/vendor-orders', {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth') ? JSON.parse(localStorage.getItem('auth')).token : ''}`
            }
          });
          if (response.ok) {
            const data = await response.json();
            mongoDBCount = data.length || 0;
          }
        } catch (mongoError) {

        }
      }

      console.log('🔍 Purchase Orders Comparison:', {
        ui_displayed: filteredOrders.length,
        state_total: state.purchaseOrders.length,
        state_active: activeOrders.length,
        indexedDB_total: indexedDBOrders.length,
        indexedDB_active: indexedDBOrders.filter(order => order.isDeleted !== true).length,
        mongoDB_total: mongoDBCount,
        discrepancy_analysis: {
          state_vs_indexeddb: state.purchaseOrders.length - indexedDBOrders.length,
          ui_vs_indexeddb: filteredOrders.length - indexedDBOrders.filter(order => order.isDeleted !== true).length,
          ui_vs_mongodb: mongoDBCount !== null ? filteredOrders.length - mongoDBCount : 'N/A'
        }
      });

      // Detailed order comparison
      const stateOrders = state.purchaseOrders.map(order => ({
        id: order.id,
        supplierName: order.supplierName,
        status: order.status,
        isDeleted: order.isDeleted,
        isSynced: order.isSynced
      }));

      const indexedDBOrders_clean = indexedDBOrders.map(order => ({
        id: order.id,
        supplierName: order.supplierName,
        status: order.status,
        isDeleted: order.isDeleted,
        isSynced: order.isSynced
      }));

      // Find orders in state but not in IndexedDB
      const stateIds = new Set(state.purchaseOrders.map(o => o.id));
      const indexedDBIds = new Set(indexedDBOrders.map(o => o.id));
      const onlyInState = state.purchaseOrders.filter(o => !indexedDBIds.has(o.id));
      const onlyInIndexedDB = indexedDBOrders.filter(o => !stateIds.has(o.id));

      if (onlyInState.length > 0 || onlyInIndexedDB.length > 0) {
        console.log('⚠️ Discrepancy Found:', {
          onlyInState: onlyInState.map(o => ({ id: o.id, supplierName: o.supplierName, status: o.status })),
          onlyInIndexedDB: onlyInIndexedDB.map(o => ({ id: o.id, supplierName: o.supplierName, status: o.status }))
        });
      } else {

      }

    } catch (error) {

    }
  };

  // Call debug function on component mount and when purchase orders change
  React.useEffect(() => {
    debugPurchaseOrders();
  }, [state.purchaseOrders, activeOrders.length, filteredOrders.length]);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-600" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'cancelled':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusBadge = (status) => {
    const baseClasses = "px-3 py-1 rounded-full text-xs font-semibold";
    switch (status) {
      case 'pending':
        return `${baseClasses} bg-yellow-100 text-yellow-800`;
      case 'completed':
        return `${baseClasses} bg-green-100 text-green-800`;
      case 'cancelled':
        return `${baseClasses} bg-red-100 text-red-800`;
      default:
        return `${baseClasses} bg-gray-100 text-gray-800`;
    }
  };

  // Create batches for confirmed purchase orders
  const createBatchesForPurchaseOrder = async (order) => {
    try {
      const { addItem, updateItem, STORES } = await import('../../utils/indexedDB');
      const { addToSyncQueue } = await import('../../utils/dataFetcher');

      // Handle both local orders (batches) and synced orders (items)
      const dataToProcess = order.batches || order.items || [];
      const isSyncedOrder = !order.batches && !!order.items;

      for (const itemData of dataToProcess) {
        console.log('🔍 Looking for product:', {
          itemProductId: itemData.productId,
          itemProductName: itemData.productName,
          isSyncedOrder,
          availableProductIds: state.products.map(p => p.id || p._id),
          availableProductNames: state.products.map(p => p.name)
        });

        // Find the product - try multiple matching strategies
        let product = null;

        // First try exact ID match
        product = state.products.find(p =>
          p.id === itemData.productId ||
          p._id === itemData.productId
        );

        // If not found, try name match
        if (!product) {
          product = state.products.find(p => p.name === itemData.productName);
        }

        // If still not found, try partial name match (case insensitive)
        if (!product) {
          product = state.products.find(p =>
            p.name && itemData.productName &&
            p.name.toLowerCase().trim() === itemData.productName.toLowerCase().trim()
          );
        }

        if (!product) {
          console.error('❌ Product not found for item:', {
            itemProductId: itemData.productId,
            itemProductName: itemData.productName,
            isSyncedOrder,
            availableProducts: state.products.map(p => ({ id: p.id, _id: p._id, name: p.name })).slice(0, 5) // Show first 5 products
          });
          continue;
        }

        // Create new batch object - handle both local (batches) and synced (items) formats
        const newBatch = {
          id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          _id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          productId: product.id || product._id,
          batchNumber: isSyncedOrder ? `Batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}` : itemData.batchNumber,
          quantity: itemData.quantity,
          costPrice: isSyncedOrder ? itemData.price : itemData.costPrice,
          sellingUnitPrice: isSyncedOrder ? itemData.price * 1.2 : itemData.sellingUnitPrice, // Estimate selling price for synced orders
          expiry: isSyncedOrder ? null : itemData.expiry,
          mfg: isSyncedOrder ? null : itemData.mfg,
          purchaseOrderId: order.id,
          createdAt: new Date().toISOString(),
          isSynced: false,
          lastModified: new Date().toISOString()
        };

        // Save batch to IndexedDB (addItem will check for duplicates by batchNumber)
        const savedBatchId = await addItem(STORES.productBatches, newBatch);

        // If addItem returned an existing ID (duplicate found), skip updating product stock
        if (savedBatchId !== newBatch.id && savedBatchId !== newBatch._id) {

          continue; // Skip to next batch
        }

        // Update product with new batch - merge with existing batches
        const existingBatches = product.batches || [];
        const updatedBatches = [...existingBatches, newBatch];

        const updatedProduct = {
          ...product,
          batches: updatedBatches,
          // Update total quantity
          quantity: (product.quantity || 0) + itemData.quantity,
          stock: (product.stock || 0) + itemData.quantity,
          // Mark as not synced since we added a batch
          isSynced: false,
          lastModified: new Date().toISOString()
        };

        // Save updated product to IndexedDB
        await updateItem(STORES.products, updatedProduct);

        // Update UI state
        dispatch({ type: 'UPDATE_PRODUCT', payload: updatedProduct });

        // Add batch creation to sync queue
        await addToSyncQueue('batch_create_from_po', {
          batchId: newBatch.id,
          productId: product.id,
          batchData: newBatch,
          purchaseOrderId: order.id,
          timestamp: new Date().toISOString()
        });

      }

      // Add activity log for batch creation
      dispatch({
        type: 'ADD_ACTIVITY',
        payload: {
          id: Date.now().toString(),
          message: `Batches created for confirmed purchase order ${order.id}`,
          timestamp: new Date().toISOString(),
          type: 'batches_created_from_po'
        }
      });

      // Trigger background sync if online
      const { isOnline, backgroundSyncWithBackend } = await import('../../utils/dataFetcher');
      if (isOnline()) {

        backgroundSyncWithBackend(dispatch, {}).catch(syncError => {

        });
      } else {

      }

    } catch (error) {

      if (window.showToast) {
        window.showToast('Error creating batches for purchase order', 'error');
      }
    }
  };

  const handleStatusChange = async (orderId, newStatus) => {

    const order = state.purchaseOrders.find(o =>
      String(o.id) === String(orderId) ||
      (o._id && String(o._id) === String(orderId))
    );

    if (!order) {

      if (window.showToast) {
        window.showToast('Purchase order not found', 'error');
      }
      return;
    }

    // Check if this is a newly created order (created within last 2 seconds)
    // If so, wait a bit to ensure IndexedDB save is complete
    const orderCreatedAt = order.createdAt ? new Date(order.createdAt).getTime() : 0;
    const now = Date.now();
    const timeSinceCreation = now - orderCreatedAt;

    if (timeSinceCreation < 2000 && !order.isSynced) {

      // Wait a bit longer to ensure IndexedDB save is complete
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Ensure we pass the complete order with all fields preserved
    const updatedOrder = { 
      ...order, 
      status: newStatus,
      // Ensure ID fields are preserved
      id: order.id,
      _id: order._id,
      // Preserve timestamps
      createdAt: order.createdAt,
      date: order.date || order.createdAt
    };

    dispatch({ type: 'UPDATE_PURCHASE_ORDER', payload: updatedOrder });

    dispatch({ type: 'ADD_ACTIVITY', payload: {
      id: Date.now().toString(),
      message: `Purchase order ${orderId} status changed to ${newStatus}`,
      timestamp: new Date().toISOString(),
      type: 'po_status_changed'
    }});

    // Create batches if order is confirmed/completed and batches don't already exist
    console.log('🔄 Status change debug:', {
      orderId,
      oldStatus: order.status,
      newStatus,
      hasBatches: !!(order.batches && order.batches.length > 0),
      batchesCount: order.batches?.length || 0,
      batches: order.batches
    });

    // Check if batches already exist for this order (they might have been created during order creation)
    const batchesAlreadyExist = state.products.some(product =>
      product.batches?.some(batch => batch.purchaseOrderId === orderId)
    );

    if ((newStatus === 'confirmed' || newStatus === 'completed') && ((order.batches && order.batches.length > 0) || (order.items && order.items.length > 0)) && !batchesAlreadyExist) {

      try {
        await createBatchesForPurchaseOrder(order);

      } catch (error) {

        if (window.showToast) {
          window.showToast('Error creating batches for purchase order', 'error');
        }
      }
    } else {
      //('⚠️ Skipping batch creation - status:', newStatus, 'hasBatches:', !!(order.batches && order.batches.length > 0), 'hasItems:', !!(order.items && order.items.length > 0));
    }

    if (window.showToast) {
      window.showToast(`Purchase order status changed to ${newStatus}`, 'success');
    }
  };

  const handleDeleteOrder = (orderId) => {
    const order = state.purchaseOrders.find(o => o.id === orderId);
    const orderInfo = order ? {
      id: orderId,
      supplierName: order.supplierName || 'Unknown Supplier',
      total: order.total || 0,
      date: order.orderDate || order.createdAt || ''
    } : { id: orderId, supplierName: 'Unknown Supplier', total: 0, date: '' };

    setDeleteConfirm({ show: true, orderId, orderInfo });
  };

  const confirmDeleteOrder = () => {
    if (deleteConfirm.orderId) {
      dispatch({ type: 'DELETE_PURCHASE_ORDER', payload: deleteConfirm.orderId });

      dispatch({ type: 'ADD_ACTIVITY', payload: {
        id: Date.now().toString(),
        message: `Purchase order ${deleteConfirm.orderId} deleted`,
        timestamp: new Date().toISOString(),
        type: 'po_deleted'
      }});

      if (window.showToast) {
        window.showToast(`Purchase order "${deleteConfirm.orderInfo.supplierName}" has been deleted successfully`, 'success', 4000);
      }

      setDeleteConfirm({ show: false, orderId: null, orderInfo: null });
    }
  };

  return (
    <div className="space-y-6 fade-in-up">
      {/* Professional Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-600 mt-1">Manage supplier orders with batch-wise procurement</p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary inline-flex items-center justify-center text-sm px-4 py-2 touch-manipulation"
        >
          <ShoppingCart className="h-4 w-4 mr-2" />
          <span>New Purchase Order</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Truck className="h-5 w-5 text-blue-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-600 mb-1">Fulfilled Orders</p>
              <p className="text-2xl font-bold text-gray-900">{totalOrders}</p>
              <button
                onClick={debugPurchaseOrders}
                className="mt-1 text-xs text-blue-600 hover:text-blue-800 underline mr-2"
              >
                Debug Counts
              </button>
              <button
                onClick={async () => {
                  try {
                    const { cleanupDuplicatePurchaseOrders } = await import('../../utils/indexedDB');
                    const result = await cleanupDuplicatePurchaseOrders();
                    alert(`Cleanup completed: removed ${result.removed} duplicates, kept ${result.kept} orders`);
                    window.location.reload(); // Refresh to show cleaned data
                  } catch (error) {

                    alert('Cleanup failed - check console for details');
                  }
                }}
                className="mt-1 text-xs text-red-600 hover:text-red-800 underline"
              >
                Clean Duplicates
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-yellow-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Clock className="h-5 w-5 text-yellow-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-600 mb-1">Pending</p>
              <p className="text-2xl font-bold text-gray-900">{pendingOrders}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-600 mb-1">Completed</p>
              <p className="text-2xl font-bold text-gray-900">{completedOrders}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Package className="h-5 w-5 text-purple-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-600 mb-1">Total Value</p>
              <p className="text-xl font-bold text-gray-900">₹{totalValue.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex-1 lg:max-w-md">
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="purchase-search">
              Search Purchase Orders
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                id="purchase-search"
                type="text"
                placeholder="Search by supplier name or order ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="lg:w-auto lg:min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="purchase-status-filter">
              Filter by Status
            </label>
            <select
              id="purchase-status-filter"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full py-2 text-sm border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending Orders</option>
              <option value="completed">Completed Orders</option>
              <option value="cancelled">Cancelled Orders</option>
            </select>
          </div>
        </div>
      </div>

      {/* Purchase Orders Table - Desktop View */}
      <div className="card hidden lg:block">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3 text-center">Product & Batches</th>
                <th className="px-4 py-3 text-right">Total Value</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {paginatedOrders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-50">
                  <td className="px-4 py-4 align-top">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                        <Truck className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 truncate" title={order.supplierName || 'Unknown Supplier'}>{order.supplierName || 'Unknown Supplier'}</p>
                        <p className="text-xs text-slate-500 truncate">PO Value • ₹{Number(order.totalValue || order.total || 0).toFixed(2)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center align-top">
                    <div className="flex flex-col items-center gap-1">
                      {order.batches && order.batches.length > 0 ? (
                        <>
                          <div className="text-xs text-slate-600 mb-1">
                            {order.batches.length} product{order.batches.length === 1 ? '' : 's'}
                          </div>
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-700">
                            {order.batches.length} {order.batches.length === 1 ? 'batch' : 'batches'}
                          </span>
                          <span className="text-xs text-slate-500">
                            {order.totalQuantity || 0} pcs total
                          </span>
                        </>
                      ) : order.items && order.items.length > 0 ? (
                        <>
                          <div className="text-xs text-slate-600 mb-1">
                            {order.items.length} product{order.items.length === 1 ? '' : 's'}
                          </div>
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                            {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                          </span>
                          <span className="text-xs text-slate-500">
                            {order.items.reduce((sum, item) => sum + (item.quantity || 0), 0)} pcs total
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-500">No items</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right font-semibold text-slate-900 align-top whitespace-nowrap">
                    ₹{Number(order.total || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className={`${getStatusBadge(order.status)} inline-flex items-center gap-1`}>
                      {getStatusIcon(order.status)}
                      <span className="capitalize">{order.status}</span>
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right text-slate-600 align-top whitespace-nowrap">
                    {order.date ? new Date(order.date).toLocaleDateString() : 'N/A'}
                  </td>
                  <td className="px-4 py-4 text-right align-top">
                    <div className="inline-flex items-center gap-2">
                      {order.status === 'pending' && (
                        <button
                          onClick={() => handleStatusChange(order.id, 'completed')}
                          className="rounded-md border border-green-100 bg-green-50 p-2 text-green-600 transition hover:bg-green-100 hover:text-green-700"
                          title="Mark as completed"
                        >
                          <CheckCircle className="h-4 w-4" />
                        </button>
                      )}

                      <button
                        onClick={() => setViewOrderDetails(order)}
                        className="rounded-md border border-blue-100 bg-blue-50 p-2 text-blue-600 transition hover:bg-blue-100 hover:text-blue-700"
                        title="View order details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>

                      {(order.status !== 'completed' && order.status !== 'cancelled') && (
                        <button
                          onClick={() => handleStatusChange(order.id, 'cancelled')}
                          className="rounded-md border border-red-100 bg-red-50 p-2 text-red-600 transition hover:bg-red-100 hover:text-red-700"
                          title="Cancel order"
                        >
                          <AlertCircle className="h-4 w-4" />
                        </button>
                      )}

                      <button
                        onClick={() => handleDeleteOrder(order.id)}
                        className="rounded-md p-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
                        title="Delete order"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Purchase Orders Cards - Mobile/Tablet View */}
      <div className="lg:hidden space-y-4">
        {paginatedOrders.length > 0 ? (
          paginatedOrders.map((order) => (
            <div key={order.id} className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
              {/* Header with supplier info */}
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Truck className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 mb-1">
                    {order.supplierName || 'Unknown Supplier'}
                  </h3>
                  <p className="text-sm text-gray-600">#{order.id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewOrderDetails(order)}
                    className="w-8 h-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-colors touch-manipulation"
                    title="View order details"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  {order.status === 'pending' && (
                    <button
                      onClick={() => handleStatusChange(order.id, 'completed')}
                      className="w-8 h-8 rounded-md bg-green-50 text-green-600 hover:bg-green-100 flex items-center justify-center transition-colors touch-manipulation"
                      title="Mark as completed"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteOrder(order.id)}
                    className="w-8 h-8 rounded-md text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors touch-manipulation"
                    title="Delete order"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Order details */}
              <div className="mb-3">
                {order.batches && order.batches.length > 0 ? (
                  <>
                    <div className="mb-2">
                      <div className="text-xs text-gray-600 mb-2">
                        {order.batches.length} product{order.batches.length === 1 ? '' : 's'} in order
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Total Quantity</p>
                          <p className="text-lg font-bold text-gray-900">{order.totalQuantity || 0} pcs</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Total Cost</p>
                          <p className="text-lg font-bold text-red-600">₹{Number(order.totalCostValue || 0).toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-700">
                        {order.batches.length} {order.batches.length === 1 ? 'batch' : 'batches'}
                      </span>
                    </div>
                  </>
                ) : order.items && order.items.length > 0 ? (
                  <>
                    <div className="mb-2">
                      <div className="text-xs text-gray-600 mb-2">
                        {order.items.length} product{order.items.length === 1 ? '' : 's'} in order
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Total Quantity</p>
                          <p className="text-lg font-bold text-gray-900">
                            {order.items.reduce((sum, item) => sum + (item.quantity || 0), 0)} {order.items[0]?.unit || 'pcs'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Total Cost</p>
                          <p className="text-lg font-bold text-red-600">₹{Number(order.total || 0).toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                        {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4 text-gray-500">
                    <Package className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">No items in this order</p>
                  </div>
                )}
              </div>

              {/* Status and date */}
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${getStatusBadge(order.status)}`}>
                  {getStatusIcon(order.status)}
                  <span className="capitalize">{order.status}</span>
                </span>
                <p className="text-sm text-gray-600">
                  {order.date ? new Date(order.date).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
            <div className="w-16 h-16 bg-blue-50 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Truck className="h-8 w-8 text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Purchase Orders Yet</h3>
            <p className="text-gray-600 mb-6">Start managing your supplier orders by creating your first purchase order</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="btn-primary inline-flex items-center gap-2 px-4 py-2"
            >
              <Plus className="h-4 w-4" />
              Create Purchase Order
            </button>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4">
          <div className="text-sm text-gray-600">
            Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
            <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredOrders.length)}</span> of{' '}
            <span className="font-semibold">{filteredOrders.length}</span> orders
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
            >
              Previous
            </button>

            <div className="flex items-center gap-1 px-2">
              <span className="text-sm font-medium text-gray-900">{currentPage}</span>
              <span className="text-sm text-gray-500">of {totalPages}</span>
            </div>

            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Add Purchase Order Modal */}
      {showAddModal && (
        <AddPurchaseOrderModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSave={(orderData) => {
            // The modal already handles storing to IndexedDB and dispatching to Redux
            // Just log the activity and close the modal
            dispatch({ type: 'ADD_ACTIVITY', payload: {
              id: Date.now().toString(),
              message: `New purchase order ${orderData.id} created`,
              timestamp: new Date().toISOString(),
              type: 'po_created'
            }});
            setShowAddModal(false);
          }}
        />
      )}

      {/* Professional Delete Confirmation Modal */}
      {deleteConfirm.show && (
        <div className="fixed inset-0 z-[1001] flex items-center justify-center p-4" style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center mb-4">
              <div className="p-3 rounded-xl mr-4" style={{ background: 'rgba(251, 113, 133, 0.16)' }}>
                <AlertCircle className="h-6 w-6" style={{ color: '#BE123C' }} />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Delete Purchase Order?</h3>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                  This action cannot be undone
                </p>
              </div>
            </div>
            <div className="mb-6 p-4 rounded-xl" style={{ background: 'var(--surface-alt)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Are you sure you want to delete purchase order from <span className="font-bold">"{deleteConfirm.orderInfo?.supplierName}"</span>?
              </p>
              {deleteConfirm.orderInfo?.total > 0 && (
                <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                  Order Total: <span className="font-semibold">₹{deleteConfirm.orderInfo.total.toFixed(2)}</span>
                </p>
              )}
              <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                This purchase order will be permanently removed. All associated data will be lost.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm({ show: false, orderId: null, orderInfo: null })}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteOrder}
                className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{ 
                  background: 'linear-gradient(135deg, #BE123C, #991F3D)',
                  boxShadow: '0 4px 14px 0 rgba(190, 18, 60, 0.25)'
                }}
              >
                Delete Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Details Modal */}
      {viewOrderDetails && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
              <h3 className="text-xl font-semibold text-gray-900">
                Purchase Order Details
              </h3>
              <button
                onClick={() => setViewOrderDetails(null)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Order Information</h4>
                  <div className="space-y-2 text-sm">
                    <p><span className="font-medium">Order ID:</span> {viewOrderDetails.id || 'N/A'}</p>
                    <p><span className="font-medium">Supplier:</span> {viewOrderDetails.supplierName || 'Unknown Supplier'}</p>
                    <p><span className="font-medium">Date:</span> {viewOrderDetails.orderDate || viewOrderDetails.createdAt || viewOrderDetails.date ?
                      new Date(viewOrderDetails.orderDate || viewOrderDetails.createdAt || viewOrderDetails.date).toLocaleDateString() : 'N/A'}</p>
                    <p><span className="font-medium">Status:</span>
                      <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(viewOrderDetails.status || 'pending')}`}>
                        {viewOrderDetails.status || 'pending'}
                      </span>
                    </p>
                    <p><span className="font-medium">Created:</span> {viewOrderDetails.createdAt ? new Date(viewOrderDetails.createdAt).toLocaleString() : 'N/A'}</p>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Order Summary</h4>
                  <div className="space-y-2 text-sm">
                    <p><span className="font-medium">Total Quantity:</span> {
                      // Handle both local (batches) and synced (items) data formats
                      viewOrderDetails.totalQuantity ||
                      (viewOrderDetails.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0)) ||
                      (viewOrderDetails.items?.reduce((sum, item) => sum + (item.quantity || 0), 0)) ||
                      0
                    } {
                      viewOrderDetails.productUnit || viewOrderDetails.unit ||
                      (viewOrderDetails.items?.[0]?.unit) ||
                      'pcs'
                    }</p>
                    <p><span className="font-medium">Total Value:</span> ₹{Number(
                      viewOrderDetails.totalValue ||
                      viewOrderDetails.total ||
                      0
                    ).toFixed(2)}</p>
                    {viewOrderDetails.notes && (
                      <p><span className="font-medium">Notes:</span> {viewOrderDetails.notes}</p>
                    )}
                    {(!viewOrderDetails.batches?.length && !viewOrderDetails.items?.length) && (
                      <p className="text-orange-600"><span className="font-medium">⚠️ No items found</span></p>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-gray-900 mb-4">
                  {viewOrderDetails.batches ? 'Batch Details' : 'Item Details'}
                </h4>
                <div className="space-y-3">
                  {((viewOrderDetails.batches && viewOrderDetails.batches.length > 0) ||
                    (viewOrderDetails.items && viewOrderDetails.items.length > 0)) ? (
                    (viewOrderDetails.batches || viewOrderDetails.items || []).map((item, index) => {
                      // Handle both batch format (local) and item format (synced from backend)
                      const isBatchFormat = viewOrderDetails.batches;
                      const quantity = item.quantity || 0;
                      const unit = item.unit || viewOrderDetails.productUnit || viewOrderDetails.unit || 'pcs';
                      const productName = item.productName || item.name || `Item ${index + 1}`;

                      return (
                        <div key={item.id || item.batchId || item.batchNumber || item.productId || index} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <h5 className="font-medium text-gray-900">
                              {isBatchFormat ? (item.batchNumber || item.name || `Batch ${index + 1}`) : productName}
                            </h5>
                            <span className="text-sm text-gray-600">
                              {quantity} {unit}
                            </span>
                          </div>

                          {isBatchFormat ? (
                            // Batch format (local purchase orders)
                            <>
                              <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                                <div>Cost Price: ₹{Number(item.costPrice || 0).toFixed(2)}</div>
                                <div>Selling Price: ₹{Number(item.sellingUnitPrice || item.sellingPrice || 0).toFixed(2)}</div>
                              </div>
                              {(item.mfg || item.expiry || item.manufactureDate || item.expiryDate) && (
                                <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 mt-2">
                                  <div>MFG: {item.mfg || item.manufactureDate ? new Date(item.mfg || item.manufactureDate).toLocaleDateString() : 'N/A'}</div>
                                  <div>Expiry: {item.expiry || item.expiryDate ? new Date(item.expiry || item.expiryDate).toLocaleDateString() : 'N/A'}</div>
                                </div>
                              )}
                              <div className="mt-2 text-sm font-medium text-gray-900">
                                Profit: ₹{((quantity) * ((item.sellingUnitPrice || item.sellingPrice || 0) - (item.costPrice || 0))).toFixed(2)}
                              </div>
                            </>
                          ) : (
                            // Item format (synced from backend)
                            <>
                              <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                                <div>Unit Price: ₹{Number(item.price || 0).toFixed(2)}</div>
                                <div>Subtotal: ₹{Number(item.subtotal || (item.price * quantity) || 0).toFixed(2)}</div>
                              </div>
                              {item.isCustomProduct && (
                                <div className="text-sm text-blue-600 mt-2">
                                  ⭐ Custom Product
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <div className="text-4xl mb-2">📦</div>
                      <p>No {viewOrderDetails.batches ? 'batch' : 'item'} details available for this purchase order.</p>
                      <p className="text-sm mt-1">Items may not have been added yet or data is missing.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Purchase;

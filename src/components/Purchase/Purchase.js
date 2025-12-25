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

    dispatch({
      type: 'ADD_ACTIVITY', payload: {
        id: Date.now().toString(),
        message: `Purchase order ${orderId} status changed to ${newStatus}`,
        timestamp: new Date().toISOString(),
        type: 'po_status_changed'
      }
    });

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

      dispatch({
        type: 'ADD_ACTIVITY', payload: {
          id: Date.now().toString(),
          message: `Purchase order ${deleteConfirm.orderId} deleted`,
          timestamp: new Date().toISOString(),
          type: 'po_deleted'
        }
      });

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
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Purchase Orders</h1>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">Manage supplier orders with batch-wise procurement</p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary inline-flex items-center justify-center text-sm px-4 py-2 touch-manipulation shadow-lg shadow-indigo-500/20"
        >
          <ShoppingCart className="h-4 w-4 mr-2" />
          <span>New Purchase Order</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Truck className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">Fulfilled</p>
              <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white truncate" title={totalOrders}>{totalOrders}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-yellow-50 dark:bg-yellow-900/30 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Clock className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">Pending</p>
              <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white truncate" title={pendingOrders}>{pendingOrders}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-50 dark:bg-green-900/30 rounded-2xl flex items-center justify-center flex-shrink-0">
              <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">Completed</p>
              <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white truncate" title={completedOrders}>{completedOrders}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-50 dark:bg-purple-900/30 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Package className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">Total Value</p>
              <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white truncate" title={`₹${totalValue.toFixed(2)}`}>
                ₹{totalValue.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex-1 lg:max-w-md">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2" htmlFor="purchase-search">
              Search Purchase Orders
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
              <input
                id="purchase-search"
                type="text"
                placeholder="Search by supplier name or order ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 bg-white dark:bg-slate-700/50 text-gray-900 dark:text-white placeholder:text-gray-400"
              />
            </div>
          </div>

          <div className="lg:w-auto lg:min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2" htmlFor="purchase-status-filter">
              Filter by Status
            </label>
            <select
              id="purchase-status-filter"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
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
      <div className="card hidden lg:block overflow-hidden dark:bg-slate-800 dark:border-slate-700">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-700/50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3 text-center">Product & Batches</th>
                <th className="px-4 py-3 text-right">Total Value</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
              {paginatedOrders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <td className="px-4 py-4 align-top">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400">
                        <Truck className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 dark:text-white truncate" title={order.supplierName || 'Unknown Supplier'}>{order.supplierName || 'Unknown Supplier'}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">PO Value • ₹{Number(order.totalValue || order.total || 0).toFixed(2)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center align-top">
                    <div className="flex flex-col items-center gap-1">
                      {order.batches && order.batches.length > 0 ? (
                        <>
                          <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">
                            {order.batches.length} product{order.batches.length === 1 ? '' : 's'}
                          </div>
                          <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/40 px-2 py-1 text-xs font-semibold text-green-700 dark:text-green-300">
                            {order.batches.length} {order.batches.length === 1 ? 'batch' : 'batches'}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-500">
                            {order.totalQuantity || 0} pcs total
                          </span>
                        </>
                      ) : order.items && order.items.length > 0 ? (
                        <>
                          <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">
                            {order.items.length} product{order.items.length === 1 ? '' : 's'}
                          </div>
                          <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/40 px-2 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                            {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-500">
                            {order.items.reduce((sum, item) => sum + (item.quantity || 0), 0)} pcs total
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-500">No items</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right font-semibold text-slate-900 dark:text-white align-top whitespace-nowrap">
                    ₹{Number(order.total || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className={`${getStatusBadge(order.status)} inline-flex items-center gap-1`}>
                      {getStatusIcon(order.status)}
                      <span className="capitalize">{order.status}</span>
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right text-slate-600 dark:text-slate-400 align-top whitespace-nowrap">
                    {order.date ? new Date(order.date).toLocaleDateString() : 'N/A'}
                  </td>
                  <td className="px-4 py-4 text-right align-top">
                    <div className="inline-flex items-center gap-2">
                      {order.status === 'pending' && (
                        <button
                          onClick={() => handleStatusChange(order.id, 'completed')}
                          className="rounded-md border border-green-100 dark:border-green-900/50 bg-green-50 dark:bg-green-900/20 p-2 text-green-600 dark:text-green-400 transition hover:bg-green-100 dark:hover:bg-green-900/40 hover:text-green-700 dark:hover:text-green-300"
                          title="Mark as completed"
                        >
                          <CheckCircle className="h-4 w-4" />
                        </button>
                      )}

                      <button
                        onClick={() => setViewOrderDetails(order)}
                        className="rounded-md border border-blue-100 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 p-2 text-blue-600 dark:text-blue-400 transition hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:text-blue-700 dark:hover:text-blue-300"
                        title="View order details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>

                      {(order.status !== 'completed' && order.status !== 'cancelled') && (
                        <button
                          onClick={() => handleStatusChange(order.id, 'cancelled')}
                          className="rounded-md border border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-2 text-red-600 dark:text-red-400 transition hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-700 dark:hover:text-red-300"
                          title="Cancel order"
                        >
                          <AlertCircle className="h-4 w-4" />
                        </button>
                      )}

                      <button
                        onClick={() => handleDeleteOrder(order.id)}
                        className="rounded-md p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-300 transition-colors"
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
            <div key={order.id} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
              {/* Header with supplier info */}
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Truck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                    {order.supplierName || 'Unknown Supplier'}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-slate-400">#{order.id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewOrderDetails(order)}
                    className="w-8 h-8 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 flex items-center justify-center transition-colors touch-manipulation"
                    title="View order details"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  {order.status === 'pending' && (
                    <button
                      onClick={() => handleStatusChange(order.id, 'completed')}
                      className="w-8 h-8 rounded-md bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 flex items-center justify-center transition-colors touch-manipulation"
                      title="Mark as completed"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteOrder(order.id)}
                    className="w-8 h-8 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center justify-center transition-colors touch-manipulation"
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
                      <div className="text-xs text-gray-600 dark:text-slate-400 mb-2">
                        {order.batches.length} product{order.batches.length === 1 ? '' : 's'} in order
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Total Quantity</p>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{order.totalQuantity || 0} pcs</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Total Cost</p>
                          <p className="text-lg font-bold text-red-600 dark:text-red-400">₹{Number(order.totalCostValue || 0).toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/40 px-2 py-1 text-xs font-semibold text-green-700 dark:text-green-300">
                        {order.batches.length} {order.batches.length === 1 ? 'batch' : 'batches'}
                      </span>
                    </div>
                  </>
                ) : order.items && order.items.length > 0 ? (
                  <>
                    <div className="mb-2">
                      <div className="text-xs text-gray-600 dark:text-slate-400 mb-2">
                        {order.items.length} product{order.items.length === 1 ? '' : 's'} in order
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Total Quantity</p>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">
                            {order.items.reduce((sum, item) => sum + (item.quantity || 0), 0)} {order.items[0]?.unit || 'pcs'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Total Cost</p>
                          <p className="text-lg font-bold text-red-600 dark:text-red-400">₹{Number(order.total || 0).toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/40 px-2 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                        {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4 text-gray-500 dark:text-slate-500">
                    <Package className="h-8 w-8 mx-auto mb-2 text-gray-300 dark:text-slate-700" />
                    <p className="text-sm">No items in this order</p>
                  </div>
                )}
              </div>

              {/* Status and date */}
              <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-slate-700">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${getStatusBadge(order.status)}`}>
                  {getStatusIcon(order.status)}
                  <span className="capitalize">{order.status}</span>
                </span>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  {order.date ? new Date(order.date).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-8 text-center shadow-lg">
            <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Truck className="h-8 w-8 text-blue-400 dark:text-blue-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Purchase Orders Yet</h3>
            <p className="text-gray-600 dark:text-slate-400 mb-6 font-medium">Start managing your supplier orders by creating your first purchase order</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-xl shadow-lg shadow-indigo-500/20 active:scale-95 transition-all"
            >
              <Plus className="h-5 w-5" />
              <span className="font-bold">Create Purchase Order</span>
            </button>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4">
          <div className="text-sm text-gray-600 dark:text-slate-400">
            Showing <span className="font-semibold text-gray-900 dark:text-white">{startIndex + 1}</span> to{' '}
            <span className="font-semibold text-gray-900 dark:text-white">{Math.min(startIndex + itemsPerPage, filteredOrders.length)}</span> of{' '}
            <span className="font-semibold text-gray-900 dark:text-white">{filteredOrders.length}</span> orders
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all touch-manipulation shadow-sm"
            >
              Previous
            </button>

            <div className="flex items-center gap-1 px-2">
              <span className="text-sm font-bold text-gray-900 dark:text-white">{currentPage}</span>
              <span className="text-sm text-gray-500 dark:text-slate-400">of {totalPages}</span>
            </div>

            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all touch-manipulation shadow-sm"
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
            dispatch({
              type: 'ADD_ACTIVITY', payload: {
                id: Date.now().toString(),
                message: `New purchase order ${orderData.id} created`,
                timestamp: new Date().toISOString(),
                type: 'po_created'
              }
            });
            setShowAddModal(false);
          }}
        />
      )}

      {/* Professional Delete Confirmation Modal */}
      {deleteConfirm.show && (
        <div className="fixed inset-0 z-[1001] flex items-center justify-center p-4" style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border dark:border-slate-700" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center mb-4">
              <div className="p-3 rounded-xl mr-4" style={{ background: 'rgba(251, 113, 133, 0.16)' }}>
                <AlertCircle className="h-6 w-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Delete Purchase Order?</h3>
                <p className="text-sm mt-1 text-gray-500 dark:text-slate-400">
                  This action cannot be undone
                </p>
              </div>
            </div>
            <div className="mb-6 p-4 rounded-xl bg-gray-50 dark:bg-slate-700/50">
              <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
                Are you sure you want to delete purchase order from <span className="font-bold text-gray-900 dark:text-white">"{deleteConfirm.orderInfo?.supplierName}"</span>?
              </p>
              {deleteConfirm.orderInfo?.total > 0 && (
                <p className="text-xs mt-2 text-gray-500 dark:text-slate-400">
                  Order Total: <span className="font-semibold text-gray-900 dark:text-white">₹{deleteConfirm.orderInfo.total.toFixed(2)}</span>
                </p>
              )}
              <p className="text-xs mt-2 text-gray-400 dark:text-slate-500 italic">
                This purchase order will be permanently removed. All associated data will be lost.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm({ show: false, orderId: null, orderInfo: null })}
                className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteOrder}
                className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-red-500/20"
                style={{
                  background: 'linear-gradient(135deg, #BE123C, #991F3D)'
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border dark:border-slate-700">
            <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                Purchase Order Details
              </h3>
              <button
                onClick={() => setViewOrderDetails(null)}
                className="p-2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-gray-50 dark:bg-slate-700/30 p-4 rounded-xl border dark:border-slate-700">
                  <h4 className="font-bold text-gray-900 dark:text-white mb-3">Order Information</h4>
                  <div className="space-y-3 text-sm">
                    <p className="flex justify-between border-b dark:border-slate-700 pb-2"><span className="text-gray-500 dark:text-slate-400">Order ID:</span> <span className="font-mono font-semibold dark:text-white">{viewOrderDetails.id || 'N/A'}</span></p>
                    <p className="flex justify-between border-b dark:border-slate-700 pb-2"><span className="text-gray-500 dark:text-slate-400">Supplier:</span> <span className="font-semibold dark:text-white">{viewOrderDetails.supplierName || 'Unknown Supplier'}</span></p>
                    <p className="flex justify-between border-b dark:border-slate-700 pb-2"><span className="text-gray-500 dark:text-slate-400">Date:</span> <span className="font-semibold dark:text-white">{viewOrderDetails.orderDate || viewOrderDetails.createdAt || viewOrderDetails.date ?
                      new Date(viewOrderDetails.orderDate || viewOrderDetails.createdAt || viewOrderDetails.date).toLocaleDateString() : 'N/A'}</span></p>
                    <p className="flex justify-between items-center"><span className="text-gray-500 dark:text-slate-400">Status:</span>
                      <span className={`${getStatusBadge(viewOrderDetails.status || 'pending')} flex items-center gap-1`}>
                        {getStatusIcon(viewOrderDetails.status || 'pending')}
                        <span className="capitalize">{viewOrderDetails.status || 'pending'}</span>
                      </span>
                    </p>
                    <p className="flex justify-between items-center"><span className="text-gray-500 dark:text-slate-400">Created:</span> <span className="dark:text-slate-300 font-medium">{viewOrderDetails.createdAt ? new Date(viewOrderDetails.createdAt).toLocaleString() : 'N/A'}</span></p>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-slate-700/30 p-4 rounded-xl border dark:border-slate-700">
                  <h4 className="font-bold text-gray-900 dark:text-white mb-3">Order Summary</h4>
                  <div className="space-y-3 text-sm">
                    <p className="flex justify-between border-b dark:border-slate-700 pb-2"><span className="text-gray-500 dark:text-slate-400">Total Quantity:</span> <span className="font-bold text-indigo-600 dark:text-indigo-400">{
                      // Handle both local (batches) and synced (items) data formats
                      viewOrderDetails.totalQuantity ||
                      (viewOrderDetails.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0)) ||
                      (viewOrderDetails.items?.reduce((sum, item) => sum + (item.quantity || 0), 0)) ||
                      0
                    } {
                        viewOrderDetails.productUnit || viewOrderDetails.unit ||
                        (viewOrderDetails.items?.[0]?.unit) ||
                        'pcs'
                      }</span></p>
                    <p className="flex justify-between border-b dark:border-slate-700 pb-2"><span className="text-gray-500 dark:text-slate-400">Total Value:</span> <span className="font-bold text-indigo-600 dark:text-indigo-400">₹{Number(
                      viewOrderDetails.totalValue ||
                      viewOrderDetails.total ||
                      0
                    ).toFixed(2)}</span></p>
                    {viewOrderDetails.notes && (
                      <p className="flex flex-col gap-1"><span className="text-gray-500 dark:text-slate-400">Notes:</span> <span className="dark:text-white italic">{viewOrderDetails.notes}</span></p>
                    )}
                    {(!viewOrderDetails.batches?.length && !viewOrderDetails.items?.length) && (
                      <p className="text-orange-600 dark:text-orange-400 flex items-center gap-2 font-medium">
                        <AlertCircle className="h-4 w-4" />
                        No items found
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                  <Package className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
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
                        <div key={item.id || item.batchId || item.batchNumber || item.productId || index} className="border border-gray-200 dark:border-slate-700 rounded-xl p-4 bg-white dark:bg-slate-800 hover:shadow-md transition-shadow">
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="font-bold text-gray-900 dark:text-white">
                              {isBatchFormat ? (item.batchNumber || item.name || `Batch ${index + 1}`) : productName}
                            </h5>
                            <span className="bg-indigo-50 dark:bg-indigo-900/40 px-3 py-1 rounded-full text-sm font-bold text-indigo-600 dark:text-indigo-400">
                              {quantity} {unit}
                            </span>
                          </div>

                          {isBatchFormat ? (
                            // Batch format (local purchase orders)
                            <>
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div className="text-gray-500 dark:text-slate-400">Cost Price: <span className="font-semibold text-gray-900 dark:text-white">₹{Number(item.costPrice || 0).toFixed(2)}</span></div>
                                <div className="text-gray-500 dark:text-slate-400 text-right">Selling Price: <span className="font-semibold text-gray-900 dark:text-white">₹{Number(item.sellingUnitPrice || item.sellingPrice || 0).toFixed(2)}</span></div>
                              </div>
                              {(item.mfg || item.expiry || item.manufactureDate || item.expiryDate) && (
                                <div className="grid grid-cols-2 gap-4 text-xs text-gray-500 dark:text-slate-500 mt-2 pt-2 border-t dark:border-slate-700">
                                  <div>MFG: {item.mfg || item.manufactureDate ? new Date(item.mfg || item.manufactureDate).toLocaleDateString() : 'N/A'}</div>
                                  <div className="text-right">Expiry: {item.expiry || item.expiryDate ? new Date(item.expiry || item.expiryDate).toLocaleDateString() : 'N/A'}</div>
                                </div>
                              )}
                              <div className="mt-3 text-sm font-bold text-green-600 dark:text-green-400 flex justify-end">
                                Estimated Profit: ₹{((quantity) * ((item.sellingUnitPrice || item.sellingPrice || 0) - (item.costPrice || 0))).toFixed(2)}
                              </div>
                            </>
                          ) : (
                            // Item format (synced from backend)
                            <>
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div className="text-gray-500 dark:text-slate-400">Unit Price: <span className="font-semibold text-gray-900 dark:text-white">₹{Number(item.price || 0).toFixed(2)}</span></div>
                                <div className="text-gray-500 dark:text-slate-400 text-right">Subtotal: <span className="font-bold text-indigo-600 dark:text-indigo-400">₹{Number(item.subtotal || (item.price * quantity) || 0).toFixed(2)}</span></div>
                              </div>
                              {item.isCustomProduct && (
                                <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 mt-2 bg-blue-50 dark:bg-blue-900/30 w-fit px-2 py-1 rounded">
                                  <span>⭐</span>
                                  <span className="font-semibold">Custom Product</span>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-12 bg-gray-50 dark:bg-slate-700/20 rounded-2xl border-2 border-dashed dark:border-slate-700">
                      <Package className="h-12 w-12 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
                      <p className="text-gray-700 dark:text-slate-300 font-medium">No {viewOrderDetails.batches ? 'batch' : 'item'} details available</p>
                      <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Items may not have been added yet or data is missing.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t dark:border-slate-700 p-4 flex justify-end">
              <button
                onClick={() => setViewOrderDetails(null)}
                className="px-6 py-2.5 rounded-xl font-bold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 transition-all active:scale-95"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Purchase;

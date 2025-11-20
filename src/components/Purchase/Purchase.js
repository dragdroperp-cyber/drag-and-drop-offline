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
  AlertCircle
} from 'lucide-react';

const Purchase = () => {
  const { state, dispatch } = useApp();
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, orderId: null, orderInfo: null });

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
  const totalOrders = activeOrders.length;
  const pendingOrders = activeOrders.filter(order => order.status === 'pending').length;
  const completedOrders = activeOrders.filter(order => order.status === 'completed').length;
  const totalValue = activeOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);

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

  const handleStatusChange = async (orderId, newStatus) => {
    const order = state.purchaseOrders.find(o => 
      String(o.id) === String(orderId) || 
      (o._id && String(o._id) === String(orderId))
    );
    
    if (!order) {
      console.error('Purchase order not found:', orderId);
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
      console.log('⏳ [handleStatusChange] Newly created PO detected, waiting for IndexedDB save...', {
        orderId,
        timeSinceCreation: `${timeSinceCreation}ms`
      });
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

    console.log('🔄 [handleStatusChange] Updating purchase order:', {
      orderId,
      oldStatus: order.status,
      newStatus,
      orderIdType: typeof order.id,
      order_idType: typeof order._id,
      isSynced: order.isSynced,
      timeSinceCreation: timeSinceCreation < 2000 ? `${timeSinceCreation}ms` : 'N/A'
    });

    dispatch({ type: 'UPDATE_PURCHASE_ORDER', payload: updatedOrder });
    
    dispatch({ type: 'ADD_ACTIVITY', payload: {
      id: Date.now().toString(),
      message: `Purchase order ${orderId} status changed to ${newStatus}`,
      timestamp: new Date().toISOString(),
      type: 'po_status_changed'
    }});

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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 fade-in-up">
      {/* Professional Header */}
      <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>Purchase Orders</h2>
          <p className="mt-1 sm:mt-2 text-sm sm:text-base font-medium" style={{ color: 'var(--text-secondary)' }}>Manage supplier orders and inventory</p>
        </div>
        
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary flex items-center justify-center mt-3 sm:mt-0 text-sm sm:text-base px-4 py-2 touch-manipulation"
        >
          <Plus className="h-4 w-4 mr-2" />
          <span className="hidden sm:inline">New Purchase Order</span>
          <span className="sm:hidden">New Order</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        <div className="stat-card h-full p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="p-2 sm:p-3 bg-blue-100 rounded-xl shrink-0">
              <Truck className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
            </div>
            <div className="ml-2 sm:ml-4 flex-1 min-w-0">
              <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">Total Orders</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight truncate">{totalOrders}</p>
            </div>
          </div>
        </div>

        <div className="stat-card h-full p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="p-2 sm:p-3 bg-yellow-100 rounded-xl shrink-0">
              <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-600" />
            </div>
            <div className="ml-2 sm:ml-4 flex-1 min-w-0">
              <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">Pending</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight truncate">{pendingOrders}</p>
            </div>
          </div>
        </div>

        <div className="stat-card h-full p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="p-2 sm:p-3 bg-green-100 rounded-xl shrink-0">
              <CheckCircle className="h-5 w-5 sm:h-6 sm:w-6 text-green-600" />
            </div>
            <div className="ml-2 sm:ml-4 flex-1 min-w-0">
              <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">Completed</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight truncate">{completedOrders}</p>
            </div>
          </div>
        </div>

        <div className="stat-card h-full p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="p-2 sm:p-3 bg-purple-100 rounded-xl shrink-0">
              <Package className="h-5 w-5 sm:h-6 sm:w-6 text-purple-600" />
            </div>
            <div className="ml-2 sm:ml-4 flex-1 min-w-0">
              <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">Total Value</p>
              <p className="text-lg sm:text-2xl font-bold text-gray-900 leading-tight truncate">₹{totalValue.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="card p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="w-full lg:max-w-lg">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2" htmlFor="purchase-search">
              Search purchase orders
            </label>
            <input
              id="purchase-search"
              type="text"
              placeholder="Type supplier name or order ID"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field w-full text-sm sm:text-base"
            />
          </div>
          
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center lg:w-auto">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 sm:hidden" htmlFor="purchase-status-filter">
              Filter by status
            </label>
            <select
              id="purchase-status-filter"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="input-field w-full sm:w-48 text-sm sm:text-base"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
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
                <th className="px-4 py-3">Order ID</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3 text-center">Items</th>
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
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-900">#{order.id}</span>
                      <span className="text-xs text-slate-500">Created {order.createdAt ? new Date(order.createdAt).toLocaleString() : 'N/A'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                        <Truck className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 truncate" title={order.supplierName || 'Unknown Supplier'}>{order.supplierName || 'Unknown Supplier'}</p>
                        <p className="text-xs text-slate-500 truncate">PO Value • ₹{Number(order.total || 0).toFixed(2)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center align-top">
                    <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                      {order.items?.length || 0} {order.items?.length === 1 ? 'item' : 'items'}
                    </span>
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
                        onClick={() => handleStatusChange(order.id, 'cancelled')}
                        className="rounded-md border border-red-100 bg-red-50 p-2 text-red-600 transition hover:bg-red-100 hover:text-red-700"
                        title="Cancel order"
                      >
                        <AlertCircle className="h-4 w-4" />
                      </button>
                      
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
      <div className="lg:hidden space-y-3">
        {paginatedOrders.length > 0 ? (
          paginatedOrders.map((order) => (
            <div key={order.id} className="card p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 shrink-0">
                      <Truck className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-gray-900 truncate">
                        {order.supplierName || 'Unknown Supplier'}
                      </h3>
                      <p className="text-xs text-gray-500 truncate">#{order.id}</p>
                    </div>
                  </div>
                </div>
                <div className="ml-3 flex items-center gap-2 flex-shrink-0">
                  {order.status === 'pending' && (
                    <button
                      onClick={() => handleStatusChange(order.id, 'completed')}
                      className="p-2.5 rounded-lg border border-green-100 bg-green-50 text-green-600 active:bg-green-100 transition-colors touch-manipulation"
                      title="Mark as completed"
                    >
                      <CheckCircle className="h-5 w-5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteOrder(order.id)}
                    className="p-2.5 rounded-lg text-red-600 active:bg-red-50 transition-colors touch-manipulation"
                    title="Delete order"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Total Value</p>
                  <p className="text-lg font-bold text-gray-900">₹{Number(order.total || 0).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Items</p>
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    {order.items?.length || 0} {order.items?.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                <span className={`${getStatusBadge(order.status)} inline-flex items-center gap-1`}>
                  {getStatusIcon(order.status)}
                  <span className="capitalize">{order.status}</span>
                </span>
                <p className="text-xs text-gray-500">
                  {order.date ? new Date(order.date).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="card p-12 text-center">
            <Truck className="h-16 w-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Purchase Orders</h3>
            <p className="text-gray-600 mb-6">Get started by creating your first purchase order</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="btn-primary"
            >
              Create Purchase Order
            </button>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <>
          {/* Desktop Pagination */}
          <div className="hidden lg:flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 mt-4 sm:mt-6 px-3 sm:px-4 py-3 sm:py-4 bg-gray-50 rounded-xl border border-gray-200">
            <div className="text-xs sm:text-sm text-gray-700 text-center sm:text-left">
              Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
              <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredOrders.length)}</span> of{' '}
              <span className="font-semibold">{filteredOrders.length}</span> results
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 text-xs sm:text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg active:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              >
                Previous
              </button>
              <span className="px-2 sm:px-3 py-2 text-xs sm:text-sm font-medium text-gray-700">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 text-xs sm:text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg active:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              >
                Next
              </button>
            </div>
          </div>

          {/* Mobile Pagination */}
          <div className="lg:hidden flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 px-3 sm:px-4 py-3 sm:py-4 bg-gray-50 rounded-xl border border-gray-200">
            <div className="text-xs sm:text-sm text-gray-700 text-center sm:text-left">
              Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
              <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredOrders.length)}</span> of{' '}
              <span className="font-semibold">{filteredOrders.length}</span> results
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 text-xs sm:text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg active:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              >
                Previous
              </button>
              <span className="px-2 sm:px-3 py-2 text-xs sm:text-sm font-medium text-gray-700">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 text-xs sm:text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg active:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Add Purchase Order Modal */}
      {showAddModal && (
        <AddPurchaseOrderModal
          onClose={() => setShowAddModal(false)}
          onSave={(orderData) => {
            const newOrder = {
              id: `PO-${Date.now()}`,
              ...orderData,
              status: 'pending',
              date: new Date().toISOString(),
              createdAt: new Date().toISOString(), // Ensure createdAt is set
              // Ensure items have proper structure for backend
              items: orderData.items.map(item => ({
                productId: item.productId || null,
                productName: item.productName || '',
                quantity: parseInt(item.quantity) || 0,
                price: parseFloat(item.price) || 0,
                unit: item.unit || 'pcs',
                subtotal: parseFloat(item.subtotal) || (parseFloat(item.price) || 0) * (parseInt(item.quantity) || 0),
                isCustomProduct: item.isCustomProduct || false
              }))
            };
            dispatch({ type: 'ADD_PURCHASE_ORDER', payload: newOrder });
            dispatch({ type: 'ADD_ACTIVITY', payload: {
              id: Date.now().toString(),
              message: `New purchase order ${newOrder.id} created`,
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
    </div>
  );
};

// Add Purchase Order Modal Component
const AddPurchaseOrderModal = ({ onClose, onSave }) => {
  const { state } = useApp();
  const [formData, setFormData] = useState({
    supplierName: '',
    items: [],
    notes: ''
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [showProductSearch, setShowProductSearch] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { 
        productId: '', 
        productName: '', 
        quantity: '', 
        price: '', 
        unit: 'pcs',
        isCustomProduct: false 
      }]
    }));
  };

  const updateItem = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => 
        i === index ? { ...item, [field]: value } : item
      )
    }));
  };

  const removeItem = (index) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const addProductToOrder = (product) => {
    const existingItemIndex = formData.items.findIndex(item => item.productId === product.id);
    
    if (existingItemIndex >= 0) {
      // Update existing item
      updateItem(existingItemIndex, 'quantity', (parseInt(formData.items[existingItemIndex].quantity) || 0) + 1);
    } else {
      // Add new item - use costPrice or unitPrice for purchase orders
      const purchasePrice = product.costPrice || product.unitPrice || product.price || '';
      setFormData(prev => ({
        ...prev,
        items: [...prev.items, { 
          productId: product.id, 
          productName: product.name,
          quantity: '1', 
          price: purchasePrice, // Use cost price for purchase orders
          unit: product.unit || product.quantityUnit || 'pcs',
          isCustomProduct: false
        }]
      }));
    }
    setShowProductSearch(false);
    setSearchTerm('');
  };

  const toggleCustomProduct = (index) => {
    const item = formData.items[index];
    if (item.isCustomProduct) {
      // Switch to existing product
      updateItem(index, 'isCustomProduct', false);
      updateItem(index, 'productName', '');
    } else {
      // Switch to custom product
      updateItem(index, 'isCustomProduct', true);
      updateItem(index, 'productId', '');
    }
  };

  const filteredProducts = state.products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.category?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validation according to backend VendorOrder model requirements
    const errors = [];
    
    // Backend requires supplierName
    if (!formData.supplierName || !formData.supplierName.trim()) {
      errors.push('Supplier name is required');
    }

    // Backend requires at least one item
    if (!formData.items || formData.items.length === 0) {
      errors.push('Purchase order must have at least one item');
    } else {
      // Validate each item according to backend requirements
      formData.items.forEach((item, index) => {
        // Backend requires productName
        if (!item.productName || !item.productName.trim()) {
          errors.push(`Item ${index + 1}: Product name is required`);
        }
        
        // Backend requires quantity (min: 1)
        const quantity = parseInt(item.quantity) || 0;
        if (!quantity || quantity < 1) {
          errors.push(`Item ${index + 1}: Quantity must be at least 1`);
        }
        
        // Backend requires price (min: 0)
        const price = parseFloat(item.price) || 0;
        if (price < 0) {
          errors.push(`Item ${index + 1}: Price must be 0 or greater`);
        }
        
        // Backend requires unit
        if (!item.unit || !item.unit.trim()) {
          errors.push(`Item ${index + 1}: Unit is required`);
        }
        
        // Validate unit enum (backend: pcs, kg, g, mg, l, ml, box, packet, bottle, dozen)
        const validUnits = ['pcs', 'kg', 'g', 'mg', 'l', 'ml', 'box', 'packet', 'bottle', 'dozen'];
        if (item.unit && !validUnits.includes(item.unit)) {
          errors.push(`Item ${index + 1}: Unit must be one of: ${validUnits.join(', ')}`);
        }
      });
    }

    if (errors.length > 0) {
      const errorMessage = errors.join('\n');
      if (window.showToast) {
        window.showToast(errorMessage, 'error');
      } else {
        alert(errorMessage);
      }
      return;
    }

    // Calculate total and subtotals according to backend requirements
    const itemsWithSubtotals = formData.items.map(item => ({
      ...item,
      quantity: parseInt(item.quantity) || 0,
      price: parseFloat(item.price) || 0,
      subtotal: (parseFloat(item.price) || 0) * (parseInt(item.quantity) || 0)
    }));
    
    const total = itemsWithSubtotals.reduce((sum, item) => sum + item.subtotal, 0);
    
    // Backend requires total (min: 0)
    if (total < 0) {
      if (window.showToast) {
        window.showToast('Total must be 0 or greater', 'error');
      } else {
        alert('Total must be 0 or greater');
      }
      return;
    }
    
    onSave({
      ...formData,
      items: itemsWithSubtotals,
      total
    });
  };

  return (
    <div className="professional-modal">
      <div className="professional-modal-content max-h-[95vh] sm:max-h-[90vh]">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center min-w-0 flex-1">
            <div className="p-2 rounded-xl mr-2 sm:mr-3 shrink-0" style={{ background: 'rgba(47, 60, 126, 0.12)' }}>
              <Truck className="h-5 w-5 sm:h-6 sm:w-6" style={{ color: '#2F3C7E' }} />
            </div>
            <h2 className="text-lg sm:text-xl font-semibold truncate" style={{ color: 'var(--text-primary)' }}>New Purchase Order</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors active:bg-gray-100 touch-manipulation shrink-0 ml-2"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: 'calc(95vh - 80px)' }}>
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-6" style={{ position: 'relative' }}>
          <div>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
              Supplier Name * <span className="text-red-500">(Required)</span>
            </label>
            <input
              type="text"
              name="supplierName"
              value={formData.supplierName}
              onChange={handleChange}
              className="input-field w-full text-sm sm:text-base"
              placeholder="Enter supplier name"
              required
            />
          </div>

          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <label className="block text-xs sm:text-sm font-medium text-gray-700">
                Items ({formData.items.length})
              </label>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setShowProductSearch(true)}
                  className="btn-secondary text-xs sm:text-sm px-3 py-2 touch-manipulation flex items-center justify-center"
                >
                  <Search className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Search Products</span>
                  <span className="sm:hidden">Search</span>
                </button>
                <button
                  type="button"
                  onClick={addItem}
                  className="btn-secondary text-xs sm:text-sm px-3 py-2 touch-manipulation flex items-center justify-center"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Add Manually</span>
                  <span className="sm:hidden">Add</span>
                </button>
              </div>
            </div>

            {/* Product Search Modal */}
            {showProductSearch && (
              <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
                <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-2xl max-h-[90vh] sm:max-h-96 overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between mb-4 flex-shrink-0">
                    <h3 className="text-base sm:text-lg font-semibold">Search Products</h3>
                    <button
                      onClick={() => {
                        setShowProductSearch(false);
                        setSearchTerm('');
                      }}
                      className="text-gray-500 active:text-gray-700 p-2 touch-manipulation"
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                  
                  <div className="mb-4 flex-shrink-0">
                    <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2" htmlFor="product-search-input">
                      Search products
                    </label>
                    <input
                      id="product-search-input"
                      type="text"
                      placeholder="Search products by name or category..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="input-field w-full text-sm sm:text-base"
                      autoFocus
                    />
                  </div>
                  
                  <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                    {filteredProducts.map(product => (
                      <div
                        key={product.id}
                        onClick={() => addProductToOrder(product)}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg active:bg-blue-50 cursor-pointer transition-colors touch-manipulation"
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <p className="font-medium text-gray-900 text-sm sm:text-base truncate">{product.name}</p>
                          <p className="text-xs sm:text-sm text-gray-600 truncate">
                            {product.category} • Qty: {product.quantity || product.stock || 0} {product.quantityUnit || product.unit || 'pcs'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-semibold text-blue-600 text-sm sm:text-base">₹{(Number(product.price) || 0).toFixed(2)}</p>
                          <button
                            type="button"
                            className="text-xs text-blue-600 active:text-blue-800"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))}
                    
                    {filteredProducts.length === 0 && searchTerm && (
                      <div className="text-center py-8 text-gray-500 text-sm">
                        No products found matching "{searchTerm}"
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Items List */}
            <div className="space-y-3">
              {formData.items.map((item, index) => {
                const product = state.products.find(p => p.id === item.productId);
                return (
                  <div key={index} className="p-4 rounded-xl border" style={{ 
                    background: 'var(--surface-alt)',
                    borderColor: 'var(--border-subtle)'
                  }}>
                    <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-12 lg:items-end">
                      {/* Product Selection - Takes more space */}
                      <div className="lg:col-span-4">
                        <div className="flex items-center space-x-2 mb-2">
                          <label className="block text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Product</label>
                          <button
                            type="button"
                            onClick={() => toggleCustomProduct(index)}
                            className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors touch-manipulation ${
                              item.isCustomProduct 
                                ? 'bg-blue-100 text-blue-700' 
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {item.isCustomProduct ? 'Custom' : 'Existing'}
                          </button>
                        </div>
                        
                        {item.isCustomProduct ? (
                          <input
                            type="text"
                            value={item.productName}
                            onChange={(e) => updateItem(index, 'productName', e.target.value)}
                            className="input-field w-full"
                            placeholder="Enter product name"
                            required
                          />
                        ) : (
                          <div style={{ position: 'relative', zIndex: 1000 - index }}>
                            <select
                              value={item.productId}
                              onChange={(e) => {
                                const selectedProduct = state.products.find(p => p.id === e.target.value);
                                updateItem(index, 'productId', e.target.value);
                                if (selectedProduct) {
                                  const purchasePrice = selectedProduct.costPrice || selectedProduct.unitPrice || selectedProduct.price || '';
                                  updateItem(index, 'price', purchasePrice);
                                  updateItem(index, 'unit', selectedProduct.unit || selectedProduct.quantityUnit || 'pcs');
                                  updateItem(index, 'productName', selectedProduct.name);
                                }
                              }}
                              className="input-field w-full"
                              required
                              style={{ position: 'relative', zIndex: 1000 - index }}
                            >
                              <option value="">Select Product</option>
                              {state.products.map(product => {
                                const purchasePrice = product.costPrice || product.unitPrice || product.price || 0;
                                return (
                                  <option key={product.id} value={product.id}>
                                    {product.name} (₹{purchasePrice.toFixed(2)}/{product.unit || product.quantityUnit || 'pcs'})
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        )}
                        
                        {product && !item.isCustomProduct && (
                          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                            Stock: {product.quantity || product.stock || 0} {product.quantityUnit || product.unit || 'pcs'}
                          </p>
                        )}
                      </div>
                      
                      {/* Quantity */}
                      <div className="lg:col-span-2">
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                          Quantity *
                        </label>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                          className="input-field w-full"
                          placeholder="Qty"
                          min="1"
                          required
                        />
                      </div>
                      
                      {/* Unit */}
                      <div className="lg:col-span-2" style={{ position: 'relative', zIndex: 1000 - index }}>
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Unit *</label>
                        <select
                          value={item.unit}
                          onChange={(e) => updateItem(index, 'unit', e.target.value)}
                          className="input-field w-full"
                          required
                          style={{ position: 'relative', zIndex: 1000 - index }}
                        >
                          <option value="">Select</option>
                          <option value="pcs">Pieces</option>
                          <option value="kg">Kilogram</option>
                          <option value="g">Gram</option>
                          <option value="mg">Milligram</option>
                          <option value="l">Liter</option>
                          <option value="ml">Milliliter</option>
                          <option value="box">Box</option>
                          <option value="packet">Packet</option>
                          <option value="bottle">Bottle</option>
                          <option value="dozen">Dozen</option>
                        </select>
                      </div>
                      
                      {/* Unit Price */}
                      <div className="lg:col-span-2">
                        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                          Price (₹) *
                        </label>
                        <input
                          type="number"
                          value={item.price}
                          onChange={(e) => updateItem(index, 'price', e.target.value)}
                          className="input-field w-full"
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          required
                        />
                      </div>
                      
                      {/* Total & Remove */}
                      <div className="lg:col-span-2 flex items-end gap-2">
                        <div className="flex-1">
                          <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total</p>
                          <p className="font-bold text-lg" style={{ color: '#047857' }}>
                            ₹{((parseFloat(item.price) || 0) * (parseInt(item.quantity) || 0)).toFixed(2)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="p-2 rounded-lg transition-colors hover:bg-red-50 mb-1"
                          style={{ color: '#BE123C' }}
                          title="Remove item"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {formData.items.length === 0 && (
                <div className="text-center py-12 rounded-xl border-2 border-dashed" style={{ 
                  background: 'var(--surface-alt)',
                  borderColor: 'var(--border-subtle)'
                }}>
                  <div className="inline-flex p-4 rounded-full mb-4" style={{ background: 'var(--surface-alt)' }}>
                    <Package className="h-12 w-12" style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
                  </div>
                  <p className="font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>No items added yet</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                    Click "Search Products" or "Add Manually" to get started
                  </p>
                </div>
              )}
            </div>

            {/* Order Summary */}
            {formData.items.length > 0 && (
              <div className="mt-6 p-5 rounded-xl border-2" style={{ 
                background: 'rgba(47, 60, 126, 0.08)',
                borderColor: 'rgba(47, 60, 126, 0.2)'
              }}>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-lg" style={{ color: '#2F3C7E' }}>Order Total:</span>
                  <span className="text-3xl font-bold" style={{ color: '#2F3C7E' }}>
                    ₹{formData.items.reduce((sum, item) => sum + (parseFloat(item.price) || 0) * (parseInt(item.quantity) || 0), 0).toFixed(2)}
                  </span>
                </div>
                <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                  {formData.items.length} item{formData.items.length !== 1 ? 's' : ''} • 
                  Total Quantity: {formData.items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0)} units
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              className="input-field"
              rows={3}
              placeholder="Additional notes..."
            />
          </div>

          <div className="flex flex-col sm:flex-row justify-end gap-2 sm:space-x-3 pt-4 sm:pt-6 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary w-full sm:w-auto text-sm sm:text-base px-4 py-2 touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary w-full sm:w-auto text-sm sm:text-base px-4 py-2 touch-manipulation"
            >
              Create Purchase Order
            </button>
          </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Purchase;

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  RotateCcw, 
  Search, 
  X, 
  CheckCircle, 
  AlertCircle,
  Calendar,
  Filter,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';
import { apiRequest, getSellerIdFromAuth } from '../../utils/api';
import { sanitizeMobileNumber } from '../../utils/validation';
import { addItem, getAllItems, STORES } from '../../utils/indexedDB';
import syncService from '../../services/syncService';

const formatCurrency = (value) => {
  const amount = Number(value || 0) || 0;
  return `₹${amount.toFixed(2)}`;
};

const formatDateTime = (value) => {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const options = {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    };
    return new Intl.DateTimeFormat('en-IN', options).format(date);
  } catch (error) {
    return value;
  }
};

const formatDate = (value) => {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(date);
  } catch (error) {
    return value;
  }
};

const Refunds = () => {
  const { state, dispatch } = useApp();
  const sellerId = getSellerIdFromAuth();
  
  // Tab state
  const [activeTab, setActiveTab] = useState('search'); // 'search' or 'list'
  
  // Search section state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState('mobile'); // 'mobile', 'orderId', 'product'
  const [eligibleOrders, setEligibleOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [refundWindowHours, setRefundWindowHours] = useState(168); // Default 7 days
  const [isSearching, setIsSearching] = useState(false);
  
  // Refund form state
  const [refundItems, setRefundItems] = useState([]);
  const [refundReason, setRefundReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successData, setSuccessData] = useState(null);
  
  // All refunds list state
  const [allRefunds, setAllRefunds] = useState([]);
  const [refundFilters, setRefundFilters] = useState({
    from: '',
    to: '',
    customerMobile: '',
    orderId: ''
  });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Fetch seller settings to get refund window
  useEffect(() => {
    const fetchSellerSettings = async () => {
      try {
        const response = await apiRequest('/auth/seller/profile');
        if (response.success && response.data?.seller) {
          setRefundWindowHours(response.data.seller.refundWindowHours || 168);
        }
      } catch (error) {
        console.error('Error fetching seller settings:', error);
      }
    };
    fetchSellerSettings();
  }, []);

  // Search for eligible orders
  // SECURITY: All orders are filtered by sellerId to ensure sellers can only view their own orders
  const searchOrders = async () => {
    if (!searchTerm.trim()) {
      setEligibleOrders([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      // Get all orders from state
      const allOrders = state.orders || [];
      if (!allOrders || allOrders.length === 0) {
        setEligibleOrders([]);
        setIsSearching(false);
        if (window.showToast) {
          window.showToast('No orders found. Please sync your data first.', 'info');
        }
        return;
      }

      const now = Date.now();
      const refundWindowMs = refundWindowHours * 60 * 60 * 1000;
      const searchLower = searchTerm.toLowerCase().trim();

      let filtered = allOrders.filter(order => {
        // CRITICAL: Ensure order belongs to current seller
        const orderSellerId = order.sellerId || order.sellerId?.toString();
        const currentSellerId = sellerId?.toString();
        if (orderSellerId && currentSellerId && orderSellerId !== currentSellerId) {
          console.warn(`Order ${order.id || order._id} belongs to different seller, skipping`);
          return false; // Skip orders that don't belong to current seller
        }
        
        // Check refund window eligibility
        const orderDate = new Date(order.createdAt || order.date || 0).getTime();
        if (isNaN(orderDate)) {
          return false; // Skip orders with invalid dates
        }
        const orderAge = now - orderDate;
        if (orderAge > refundWindowMs) {
          return false;
        }

        // Search by type
        if (searchType === 'mobile') {
          const orderMobile = sanitizeMobileNumber(order.customerMobile || '');
          const searchMobile = sanitizeMobileNumber(searchTerm);
          if (!searchMobile || searchMobile.length < 3) {
            return false; // Require at least 3 digits for mobile search
          }
          return orderMobile.includes(searchMobile) || searchMobile.includes(orderMobile);
        } else if (searchType === 'orderId') {
          const orderId = order.id || order._id;
          if (!orderId) return false;
          const orderIdStr = orderId.toString().toLowerCase();
          return orderIdStr.includes(searchLower) || orderIdStr.endsWith(searchLower);
        } else if (searchType === 'product') {
          // Search in order items
          if (!order.items || !Array.isArray(order.items) || order.items.length === 0) {
            return false;
          }
          return order.items.some(item => {
            const itemName = (item.name || '').toLowerCase();
            const barcode = (item.barcode || '').toLowerCase();
            return itemName.includes(searchLower) || barcode.includes(searchLower);
          });
        }
        return false;
      });

      // Fetch refund data for each order to calculate refund status
      const ordersWithRefundStatus = await Promise.all(
        filtered.map(async (order) => {
          try {
            const orderId = order._id || order.id;
            if (!orderId) {
              return null; // Skip orders without ID
            }

            // Double-check sellerId match before making API call
            const orderSellerId = (order.sellerId || '').toString();
            const currentSellerId = (sellerId || '').toString();
            if (orderSellerId && currentSellerId && orderSellerId !== currentSellerId) {
              console.warn(`Skipping order ${orderId} - sellerId mismatch`);
              return null; // Skip orders that don't belong to current seller
            }

            const refundResponse = await apiRequest(`/refunds/order/${orderId}`);
            
            // Handle API response structure - apiRequest wraps response in { success: true, data: backendResponse }
            let refundedQuantities = {};
            if (refundResponse.success && refundResponse.data) {
              const backendData = refundResponse.data;
              // Backend returns { success: true, data: { refunds: [...], refundedQuantities: {...} } }
              if (backendData.success && backendData.data && backendData.data.refundedQuantities) {
                refundedQuantities = backendData.data.refundedQuantities;
              } else if (backendData.data && backendData.data.refundedQuantities) {
                refundedQuantities = backendData.data.refundedQuantities;
              } else if (backendData.refundedQuantities) {
                refundedQuantities = backendData.refundedQuantities;
              }
            }
            
            // Calculate refund status
            let refundStatus = 'NOT_REFUNDED';
            let totalRefundedQty = 0;
            let totalOrderedQty = 0;
            
            if (order.items && Array.isArray(order.items) && order.items.length > 0) {
              order.items.forEach(item => {
                // Try multiple ways to get productId
                const productId = (item.productId?._id || item.productId || item._id || '').toString();
                const orderedQty = Number(item.quantity || 0);
                
                // Try to match refunded quantity by productId
                let refundedQty = 0;
                if (productId && refundedQuantities) {
                  // Try exact match first
                  refundedQty = refundedQuantities[productId] || 0;
                  
                  // If no exact match, try matching by string comparison
                  if (refundedQty === 0 && Object.keys(refundedQuantities).length > 0) {
                    const matchingKey = Object.keys(refundedQuantities).find(key => 
                      key.toString() === productId || 
                      key.toString().includes(productId) ||
                      productId.includes(key.toString())
                    );
                    if (matchingKey) {
                      refundedQty = refundedQuantities[matchingKey] || 0;
                    }
                  }
                }
                
                totalOrderedQty += orderedQty;
                totalRefundedQty += refundedQty;
              });
            }

            if (totalRefundedQty === 0) {
              refundStatus = 'NOT_REFUNDED';
            } else if (totalRefundedQty >= totalOrderedQty) {
              refundStatus = 'REFUNDED';
            } else {
              refundStatus = 'PARTIALLY_REFUNDED';
            }

            return {
              ...order,
              refundStatus,
              refundedQuantities
            };
          } catch (error) {
            console.error(`Error fetching refunds for order ${order._id || order.id}:`, error);
            // Only return order if it belongs to current seller
            const orderSellerId = (order.sellerId || '').toString();
            const currentSellerId = (sellerId || '').toString();
            if (orderSellerId && currentSellerId && orderSellerId !== currentSellerId) {
              return null; // Don't return orders from other sellers
            }
            return { ...order, refundStatus: 'NOT_REFUNDED', refundedQuantities: {} };
          }
        })
      );

      // Filter out null values (orders that don't belong to current seller)
      const validOrders = ordersWithRefundStatus.filter(order => order !== null);
      setEligibleOrders(validOrders);
    } catch (error) {
      console.error('Error searching orders:', error);
      setEligibleOrders([]);
      if (window.showToast) {
        window.showToast('Error searching orders: ' + (error.message || 'Unknown error'), 'error');
      }
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (searchTerm.trim()) {
      const timeoutId = setTimeout(() => {
        searchOrders();
      }, 500); // Increased debounce time for better performance
      return () => clearTimeout(timeoutId);
    } else {
      setEligibleOrders([]);
      setIsSearching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, searchType, refundWindowHours]);

  // Load refund items when order is selected
  useEffect(() => {
    if (selectedOrder) {
      loadRefundItems();
    }
  }, [selectedOrder]);

  const loadRefundItems = async () => {
    if (!selectedOrder) return;

    try {
      // CRITICAL: Verify order belongs to current seller
      const orderSellerId = (selectedOrder.sellerId || '').toString();
      const currentSellerId = (sellerId || '').toString();
      if (orderSellerId && currentSellerId && orderSellerId !== currentSellerId) {
        console.error('Cannot load refund items - order does not belong to current seller');
        if (window.showToast) {
          window.showToast('Access denied: Order does not belong to your account', 'error');
        }
        setSelectedOrder(null);
        return;
      }

      const orderId = selectedOrder._id || selectedOrder.id;
      const orderIdStr = orderId?.toString();
      
      // STEP 1: Load refunds from IndexedDB FIRST (works offline)
      const indexedDBRefunds = await getAllItems(STORES.refunds).catch(() => []);
      
      // Filter refunds for this order
      const orderRefunds = indexedDBRefunds.filter(refund => {
        const refundOrderId = (refund.orderId || '').toString();
        return refundOrderId === orderIdStr;
      });
      
      // Calculate refunded quantities from IndexedDB refunds
      const refundedQuantities = {};
      orderRefunds.forEach(refund => {
        if (refund.items && Array.isArray(refund.items)) {
          refund.items.forEach(item => {
            const productId = (item.productId || '').toString();
            if (productId) {
              refundedQuantities[productId] = (refundedQuantities[productId] || 0) + (item.qty || 0);
            }
          });
        }
      });
      
      // STEP 2: Try to fetch from MongoDB if online (will update refundedQuantities)
      if (syncService.isOnline()) {
        try {
          const refundResponse = await apiRequest(`/refunds/order/${orderId}`);
          if (refundResponse.success) {
            const backendData = refundResponse.data;
            const backendRefundedQuantities = backendData.success 
              ? (backendData.data?.refundedQuantities || {})
              : (backendData.refundedQuantities || {});
            
            // Merge backend data (takes precedence)
            Object.assign(refundedQuantities, backendRefundedQuantities);
          }
        } catch (error) {
          console.error('Error loading refunds from backend (using IndexedDB):', error);
          // Use IndexedDB data
        }
      }

      const items = (selectedOrder.items || []).map(item => {
        const productId = (item.productId || item._id || '').toString();
        const orderedQty = Number(item.quantity || 0);
        const refundedQty = refundedQuantities[productId] || 0;
        const availableQty = orderedQty - refundedQty;
        const rate = Number(item.sellingPrice || item.price || 0);

        return {
          productId,
          name: item.name || 'Unknown',
          orderedQty,
          refundedQty,
          availableQty,
          rate,
          refundQty: 0,
          unit: item.unit || 'pcs'
        };
      });

      setRefundItems(items);
    } catch (error) {
      console.error('Error loading refund items:', error);
      if (window.showToast) {
        window.showToast('Error loading order items', 'error');
      }
    }
  };

  // Calculate total refund amount
  const totalRefundAmount = useMemo(() => {
    return refundItems.reduce((sum, item) => {
      return sum + (item.refundQty * item.rate);
    }, 0);
  }, [refundItems]);

  // Handle refund quantity change
  const handleRefundQtyChange = (productId, value) => {
    const qty = Math.max(0, Number(value) || 0);
    setRefundItems(prev => prev.map(item => {
      if (item.productId === productId) {
        const refundQty = Math.min(qty, item.availableQty);
        return { ...item, refundQty };
      }
      return item;
    }));
  };

  // Process refund - OFFLINE-FIRST APPROACH
  const handleProcessRefund = async () => {
    if (!selectedOrder) return;

    // CRITICAL: Verify order belongs to current seller before processing refund
    const orderSellerId = (selectedOrder.sellerId || '').toString();
    const currentSellerId = (sellerId || '').toString();
    if (orderSellerId && currentSellerId && orderSellerId !== currentSellerId) {
      console.error('Cannot process refund - order does not belong to current seller');
      if (window.showToast) {
        window.showToast('Access denied: Order does not belong to your account', 'error');
      }
      setSelectedOrder(null);
      return;
    }

    // Validate
    const itemsToRefund = refundItems.filter(item => item.refundQty > 0);
    if (itemsToRefund.length === 0) {
      if (window.showToast) {
        window.showToast('Please select items to refund', 'warning');
      }
      return;
    }

    // Validate quantities
    for (const item of itemsToRefund) {
      if (item.refundQty > item.availableQty) {
        if (window.showToast) {
          window.showToast(`Cannot refund ${item.refundQty} units of ${item.name}. Only ${item.availableQty} available.`, 'error');
        }
        return;
      }
    }

    setIsProcessing(true);

    try {
      const orderId = selectedOrder._id || selectedOrder.id;
      const orderIdStr = orderId?.toString();
      
      // Calculate refund items and total
      const refundItemsData = itemsToRefund.map(item => ({
        productId: item.productId,
        name: item.name,
        qty: item.refundQty,
        rate: item.rate,
        lineTotal: item.refundQty * item.rate,
        unit: item.unit || 'pcs'
      }));
      
      const totalRefundAmount = refundItemsData.reduce((sum, item) => sum + item.lineTotal, 0);
      
      // Create refund object matching MongoDB Refund schema
      const refundId = `refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const refund = {
        id: refundId,
        orderId: orderIdStr,
        customerId: selectedOrder.customerId || null,
        sellerId: sellerId || state.currentUser?.sellerId || state.currentUser?._id,
        items: refundItemsData,
        totalRefundAmount,
        reason: refundReason.trim() || '',
        refundedByUser: state.currentUser?.name || state.currentUser?.email || 'System',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isSynced: false // Will be synced to MongoDB when online
      };

      // STEP 1: Save to IndexedDB FIRST (offline-first)
      await addItem(STORES.refunds, refund);
      console.log('✅ Refund saved to IndexedDB:', refundId);

      // STEP 2: Update product stock locally (increase stock for refunded items)
      // This will be synced to MongoDB when online
      for (const item of itemsToRefund) {
        const product = state.products.find(p => {
          const pId = (p._id || p.id || '').toString();
          const itemProductId = (item.productId || '').toString();
          return pId === itemProductId;
        });
        
        if (product) {
          // Update product stock locally
          const updatedProduct = {
            ...product,
            stock: (product.stock || product.quantity || 0) + item.refundQty,
            quantity: (product.stock || product.quantity || 0) + item.refundQty,
            isSynced: false, // Mark as unsynced so stock update syncs
            isUpdate: true,
            updatedAt: new Date().toISOString()
          };
          
          // Update in IndexedDB
          const { updateItem } = await import('../../utils/indexedDB');
          await updateItem(STORES.products, updatedProduct);
          
          // Update in state
          if (dispatch) {
            dispatch({ type: 'UPDATE_PRODUCT', payload: updatedProduct });
          }
        }
      }

      // STEP 3: Try to sync to MongoDB if online
      if (syncService.isOnline()) {
        try {
          // Import getStoreFunctions helper
          const { getStoreFunctions } = await import('../../context/AppContext');
          
          // Sync refunds and products together
          await syncService.syncAll(getStoreFunctions);
          console.log('✅ Refund synced to MongoDB');
        } catch (syncError) {
          console.error('⚠️ Error syncing refund to MongoDB (will retry later):', syncError);
          // Don't fail the refund - it's saved locally and will sync later
        }
      } else {
        console.log('⚠️ Offline - refund will sync when connection is restored');
      }

      // STEP 4: Update UI
      setSuccessData({
        refundId: refundId,
        orderId: orderIdStr,
        totalRefundAmount,
        itemsCount: refundItemsData.length,
        createdAt: refund.createdAt
      });
      setShowSuccessModal(true);
      
      // Reset form
      setSelectedOrder(null);
      setRefundItems([]);
      setRefundReason('');
      setSearchTerm('');
      setEligibleOrders([]);
      
      // Reload refunds list if on list tab
      if (activeTab === 'list') {
        await loadAllRefunds();
      }

      if (window.showToast) {
        const message = syncService.isOnline() 
          ? 'Refund processed successfully' 
          : 'Refund saved offline. It will sync when you reconnect.';
        window.showToast(message, 'success');
      }
    } catch (error) {
      console.error('Error processing refund:', error);
      if (window.showToast) {
        window.showToast('Error processing refund: ' + (error.message || 'Unknown error'), 'error');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Load all refunds - OFFLINE-FIRST APPROACH
  const loadAllRefunds = async () => {
    try {
      // STEP 1: Load from IndexedDB FIRST (works offline)
      const indexedDBRefunds = await getAllItems(STORES.refunds).catch(() => []);
      
      // Filter refunds by sellerId
      const sellerRefunds = indexedDBRefunds.filter(refund => {
        const refundSellerId = (refund.sellerId || '').toString();
        const currentSellerId = (sellerId || '').toString();
        return !refundSellerId || !currentSellerId || refundSellerId === currentSellerId;
      });
      
      // Apply filters
      let filteredRefunds = sellerRefunds.filter(refund => {
        // Date filters
        if (refundFilters.from) {
          const refundDate = new Date(refund.createdAt || refund.refundDate);
          const fromDate = new Date(refundFilters.from);
          if (refundDate < fromDate) return false;
        }
        if (refundFilters.to) {
          const refundDate = new Date(refund.createdAt || refund.refundDate);
          const toDate = new Date(refundFilters.to);
          toDate.setHours(23, 59, 59, 999); // End of day
          if (refundDate > toDate) return false;
        }
        
        // Order ID filter
        if (refundFilters.orderId) {
          const refundOrderId = (refund.orderId || '').toString();
          const filterOrderId = refundFilters.orderId.trim();
          if (!refundOrderId.includes(filterOrderId)) return false;
        }
        
        // Customer mobile filter (need to check order)
        if (refundFilters.customerMobile) {
          const order = state.orders.find(o => {
            const oId = (o._id || o.id || '').toString();
            const rOrderId = (refund.orderId || '').toString();
            return oId === rOrderId;
          });
          if (order) {
            const orderMobile = sanitizeMobileNumber(order.customerMobile || '');
            const filterMobile = sanitizeMobileNumber(refundFilters.customerMobile);
            if (!orderMobile.includes(filterMobile) && !filterMobile.includes(orderMobile)) {
              return false;
            }
          } else {
            return false; // Order not found, skip
          }
        }
        
        return true;
      });
      
      // Format refunds for display
      const formattedRefunds = filteredRefunds.map(refund => ({
        id: refund.id || refund._id,
        refundId: refund.id || refund._id,
        orderId: refund.orderId,
        customerId: refund.customerId,
        totalRefundAmount: refund.totalRefundAmount,
        refundDate: refund.createdAt || refund.refundDate,
        refundedBy: refund.refundedByUser || '-',
        itemsCount: refund.items?.length || 0,
        reason: refund.reason || '',
        // Get customer info from order
        customerName: (() => {
          const order = state.orders.find(o => {
            const oId = (o._id || o.id || '').toString();
            const rOrderId = (refund.orderId || '').toString();
            return oId === rOrderId;
          });
          return order?.customerName || '-';
        })(),
        customerMobile: (() => {
          const order = state.orders.find(o => {
            const oId = (o._id || o.id || '').toString();
            const rOrderId = (refund.orderId || '').toString();
            return oId === rOrderId;
          });
          return order?.customerMobile || '-';
        })()
      }));
      
      // STEP 2: Try to fetch from MongoDB if online (will replace IndexedDB data)
      if (syncService.isOnline()) {
        try {
          const params = new URLSearchParams();
          if (refundFilters.from) params.append('from', refundFilters.from);
          if (refundFilters.to) params.append('to', refundFilters.to);
          if (refundFilters.customerMobile) params.append('customerMobile', refundFilters.customerMobile);
          if (refundFilters.orderId) params.append('orderId', refundFilters.orderId);

          const response = await apiRequest(`/refunds?${params.toString()}`);
          if (response.success) {
            const backendResponse = response.data;
            const refundsList = backendResponse.success 
              ? (backendResponse.data?.data || backendResponse.data || [])
              : (backendResponse.data || []);
            
            if (Array.isArray(refundsList) && refundsList.length > 0) {
              // Update IndexedDB with backend data
              const { syncToIndexedDB } = await import('../../utils/dataFetcher');
              await syncToIndexedDB(STORES.refunds, refundsList);
              
              // Use backend data
              setAllRefunds(refundsList);
              return;
            }
          }
        } catch (error) {
          console.error('Error loading refunds from backend (using IndexedDB):', error);
          // Fall through to use IndexedDB data
        }
      }
      
      // Use IndexedDB data (either offline or as fallback)
      setAllRefunds(formattedRefunds);
    } catch (error) {
      console.error('Error loading refunds:', error);
      setAllRefunds([]);
    }
  };

  useEffect(() => {
    if (activeTab === 'list') {
      loadAllRefunds();
    }
  }, [activeTab, refundFilters]);

  // Pagination for refunds list
  const totalPages = Math.ceil(allRefunds.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedRefunds = allRefunds.slice(startIndex, startIndex + itemsPerPage);

  const getRefundStatusBadge = (status) => {
    const badges = {
      'REFUNDED': 'bg-green-100 text-green-800 border-green-200',
      'PARTIALLY_REFUNDED': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'NOT_REFUNDED': 'bg-gray-100 text-gray-800 border-gray-200'
    };
    return badges[status] || badges['NOT_REFUNDED'];
  };

  const getRefundStatusText = (status) => {
    const texts = {
      'REFUNDED': 'REFUNDED',
      'PARTIALLY_REFUNDED': 'PARTIALLY REFUNDED',
      'NOT_REFUNDED': 'NOT REFUNDED'
    };
    return texts[status] || 'NOT REFUNDED';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <RotateCcw className="h-8 w-8 text-indigo-600" />
            Refunds
          </h1>
          <p className="text-sm text-gray-600 mt-1">Process refunds and manage return requests</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('search')}
          className={`px-4 py-2 font-medium text-sm transition-colors ${
            activeTab === 'search'
              ? 'border-b-2 border-indigo-600 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Search Orders
        </button>
        <button
          onClick={() => setActiveTab('list')}
          className={`px-4 py-2 font-medium text-sm transition-colors ${
            activeTab === 'list'
              ? 'border-b-2 border-indigo-600 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          All Refunds
        </button>
      </div>

      {/* Search Orders Tab */}
      {activeTab === 'search' && (
        <div className="space-y-6">
          {/* Search Section */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Search Orders for Refund</h2>
            
            <div className="space-y-4">
              {/* Search Type Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Search By</label>
                <div className="flex gap-2">
                  {[
                    { value: 'mobile', label: 'Customer Mobile' },
                    { value: 'orderId', label: 'Order ID' },
                    { value: 'product', label: 'Product Name/Barcode' }
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setSearchType(option.value);
                        setSearchTerm('');
                        setEligibleOrders([]);
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        searchType === option.value
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={`Enter ${searchType === 'mobile' ? 'mobile number' : searchType === 'orderId' ? 'order ID' : 'product name or barcode'}`}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-gray-900 placeholder:text-gray-400"
                />
              </div>

              {/* Refund Window Info */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-800">
                  <AlertCircle className="h-4 w-4 inline mr-1" />
                  Only orders within {refundWindowHours} hours ({Math.round(refundWindowHours / 24)} days) are eligible for refund
                </p>
              </div>
            </div>
          </div>

          {/* Eligible Orders List */}
          {isSearching && (
            <div className="card">
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
                  <p className="text-sm text-gray-600">Searching orders...</p>
                </div>
              </div>
            </div>
          )}
          {!isSearching && eligibleOrders.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Eligible Orders ({eligibleOrders.length})</h3>
              <div className="space-y-3">
                {eligibleOrders.map((order) => {
                  const hasRefund = order.refundStatus !== 'NOT_REFUNDED';
                  const isSelected = selectedOrder?.id === order.id || selectedOrder?._id === order._id;
                  
                  return (
                    <div
                      key={order.id || order._id}
                      className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                        hasRefund
                          ? 'border-red-500 bg-red-50'
                          : isSelected
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedOrder(order)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <p className={`font-semibold ${hasRefund ? 'text-red-900' : 'text-gray-900'}`}>
                              Order ID: {(order.id || order._id || '').toString().slice(-8)}
                            </p>
                            {hasRefund ? (
                              <span className="px-3 py-1.5 rounded-full text-xs font-bold border-2 border-red-600 bg-red-100 text-red-800">
                                ALREADY REFUNDED
                              </span>
                            ) : (
                              <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getRefundStatusBadge(order.refundStatus)}`}>
                                {getRefundStatusText(order.refundStatus)}
                              </span>
                            )}
                          </div>
                          <p className={`text-sm ${hasRefund ? 'text-red-700' : 'text-gray-600'}`}>
                            {order.customerName || 'Walk-in Customer'} • {order.customerMobile || '-'}
                          </p>
                          <p className={`text-xs mt-1 ${hasRefund ? 'text-red-600' : 'text-gray-500'}`}>
                            {formatDateTime(order.createdAt || order.date)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`text-lg font-bold ${hasRefund ? 'text-red-900' : 'text-gray-900'}`}>
                            {formatCurrency(order.totalAmount || order.total)}
                          </p>
                          <p className={`text-xs uppercase ${hasRefund ? 'text-red-600' : 'text-gray-500'}`}>
                            {order.paymentMethod || 'cash'}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {!isSearching && searchTerm.trim() && eligibleOrders.length === 0 && (
            <div className="card">
              <div className="text-center py-8">
                <p className="text-gray-600">No eligible orders found matching your search criteria.</p>
                <p className="text-sm text-gray-500 mt-2">Try a different search term or check the refund window settings.</p>
              </div>
            </div>
          )}

          {/* Refund Modal Popup */}
          {selectedOrder && (
            <div 
              className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setSelectedOrder(null);
                  setRefundItems([]);
                  setRefundReason('');
                }
              }}
            >
              <div className="bg-white rounded-2xl shadow-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
                  <h3 className="text-xl font-semibold text-gray-900">Refund Items</h3>
                  <button
                    onClick={() => {
                      setSelectedOrder(null);
                      setRefundItems([]);
                      setRefundReason('');
                    }}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="p-6">
                  {/* Order Info */}
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-600">Order ID</p>
                        <p className="font-semibold text-gray-900">{(selectedOrder.id || selectedOrder._id || '').toString().slice(-8)}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Customer</p>
                        <p className="font-semibold text-gray-900">{selectedOrder.customerName || 'Walk-in Customer'}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Date</p>
                        <p className="font-semibold text-gray-900">{formatDateTime(selectedOrder.createdAt || selectedOrder.date)}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Total Amount</p>
                        <p className="font-semibold text-gray-900">{formatCurrency(selectedOrder.totalAmount || selectedOrder.total)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Refund Items Table */}
                  {refundItems.length > 0 && (
                    <div className="mb-4">
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Product</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700">Ordered Qty</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700">Refunded Qty</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700">Available</th>
                              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700">Rate</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700">Refund Qty</th>
                              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700">Line Total</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {refundItems.map((item, index) => (
                              <tr 
                                key={item.productId} 
                                className={item.refundedQty > 0 ? 'bg-yellow-50' : ''}
                              >
                                <td className="px-4 py-3 text-sm text-gray-900">{item.name}</td>
                                <td className="px-4 py-3 text-sm text-gray-700 text-center">
                                  {item.orderedQty} {item.unit}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700 text-center">
                                  {item.refundedQty} {item.unit}
                                </td>
                                <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-center">
                                  {item.availableQty} {item.unit}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700 text-right">
                                  {formatCurrency(item.rate)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <input
                                    type="number"
                                    min="0"
                                    max={item.availableQty}
                                    value={item.refundQty || ''}
                                    onChange={(e) => handleRefundQtyChange(item.productId, e.target.value)}
                                    disabled={item.availableQty === 0}
                                    className={`w-20 px-2 py-1 text-sm border rounded-lg text-center ${
                                      item.availableQty === 0
                                        ? 'bg-gray-100 cursor-not-allowed'
                                        : 'border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'
                                    }`}
                                  />
                                </td>
                                <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                                  {formatCurrency(item.refundQty * item.rate)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Total and Reason */}
                      <div className="mt-6 space-y-4">
                        <div className="flex justify-end">
                          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                            <p className="text-sm text-indigo-700 mb-1">Total Refund Amount</p>
                            <p className="text-2xl font-bold text-indigo-900">{formatCurrency(totalRefundAmount)}</p>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Refund Reason (Optional)
                          </label>
                          <textarea
                            value={refundReason}
                            onChange={(e) => setRefundReason(e.target.value)}
                            placeholder="Enter reason for refund..."
                            rows={3}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-gray-900 placeholder:text-gray-400"
                          />
                        </div>

                        <div className="flex justify-end gap-3">
                          <button
                            onClick={() => {
                              setSelectedOrder(null);
                              setRefundItems([]);
                              setRefundReason('');
                            }}
                            className="px-6 py-3 rounded-xl font-semibold transition-all bg-gray-200 text-gray-700 hover:bg-gray-300"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleProcessRefund}
                            disabled={isProcessing || totalRefundAmount === 0}
                            className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                              isProcessing || totalRefundAmount === 0
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg hover:shadow-xl'
                            }`}
                          >
                            {isProcessing ? 'Processing...' : 'Process Refund'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {refundItems.length === 0 && (
                    <div className="text-center py-8">
                      <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
                      <p className="text-sm text-gray-600">Loading refund items...</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* All Refunds Tab */}
      {activeTab === 'list' && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
                <input
                  type="date"
                  value={refundFilters.from}
                  onChange={(e) => setRefundFilters(prev => ({ ...prev, from: e.target.value }))}
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">To Date</label>
                <input
                  type="date"
                  value={refundFilters.to}
                  onChange={(e) => setRefundFilters(prev => ({ ...prev, to: e.target.value }))}
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Customer Mobile</label>
                <input
                  type="text"
                  value={refundFilters.customerMobile}
                  onChange={(e) => setRefundFilters(prev => ({ ...prev, customerMobile: e.target.value }))}
                  placeholder="Search by mobile"
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Order ID</label>
                <input
                  type="text"
                  value={refundFilters.orderId}
                  onChange={(e) => setRefundFilters(prev => ({ ...prev, orderId: e.target.value }))}
                  placeholder="Search by order ID"
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Refunds Table */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">All Refunds ({allRefunds.length})</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Refund ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Order ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Customer</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700">Amount</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700">Items</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Refunded By</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedRefunds.length > 0 ? (
                    paginatedRefunds.map((refund) => (
                      <tr key={refund.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {(refund.refundId || refund.id || '').toString().slice(-8)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {(refund.orderId || '').toString().slice(-8)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {refund.customerName || '-'}
                          {refund.customerMobile && (
                            <span className="text-gray-500 ml-1">• {refund.customerMobile}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                          {formatCurrency(refund.totalRefundAmount)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-center">
                          {refund.itemsCount || 0}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {formatDateTime(refund.refundDate || refund.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {refund.refundedBy || '-'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" className="px-4 py-12 text-center">
                        <RotateCcw className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-600">No refunds found</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
                <div className="text-sm text-gray-700">
                  Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                  <span className="font-semibold">{Math.min(startIndex + itemsPerPage, allRefunds.length)}</span> of{' '}
                  <span className="font-semibold">{allRefunds.length}</span> refunds
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-2 text-sm font-medium rounded-lg ${
                        currentPage === page
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && successData && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="text-center">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Refund Processed Successfully</h3>
              <div className="space-y-2 mb-6">
                <p className="text-sm text-gray-600">
                  <span className="font-semibold">Refund ID:</span> {(successData.refundId || '').toString().slice(-8)}
                </p>
                <p className="text-lg font-semibold text-gray-900">
                  Total Amount: {formatCurrency(successData.totalRefundAmount)}
                </p>
                <p className="text-sm text-gray-600">
                  Items Refunded: {successData.itemsCount || 0}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  setSuccessData(null);
                }}
                className="w-full px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
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

export default Refunds;


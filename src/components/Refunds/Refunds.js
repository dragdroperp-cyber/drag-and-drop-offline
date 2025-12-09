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
  const [searchType, setSearchType] = useState('mobile'); // 'mobile', 'customerName', 'product'
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
          // Exact match: only return orders with exactly this mobile number
          return orderMobile === searchMobile;
        } else if (searchType === 'customerName') {
          const customerName = (order.customerName || '').toLowerCase().trim();
          if (!customerName) return false;
          return customerName.includes(searchLower);
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

        // Calculate price per unit
        // sellingPrice might be total line price, so calculate per unit
        let rate = 0;
        if (item.unitSellingPrice !== undefined && item.unitSellingPrice !== null) {
          // Use unitSellingPrice if available (price per unit)
          rate = Number(item.unitSellingPrice || 0);
        } else if (orderedQty > 0) {
          // Calculate price per unit: total price / quantity
          const totalPrice = Number(item.sellingPrice || item.price || item.totalSellingPrice || 0);
          rate = totalPrice / orderedQty;
        } else {
          // Fallback to sellingPrice or price if quantity is 0
          rate = Number(item.sellingPrice || item.price || 0);
        }

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
        stockAdjusted: true, // Flag indicating stock has been adjusted locally by frontend
        isSynced: false // Will be synced to MongoDB when online
      };

      // STEP 1: Save to IndexedDB FIRST (offline-first)
      await addItem(STORES.refunds, refund);

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

      // STEP 3: Update UI IMMEDIATELY (show success)
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
        loadAllRefunds(); // Don't await - let it run in background
      }

      // Show success message immediately
      if (window.showToast) {
        window.showToast('Refund processed successfully', 'success');
      }

      // STEP 4: Sync to MongoDB in BACKGROUND (non-blocking)
      // Use setTimeout to ensure UI updates first, then sync happens in background
      setTimeout(async () => {
        if (syncService.isOnline()) {
          try {
            // Import getStoreFunctions helper
            const { getStoreFunctions } = await import('../../context/AppContext');

            // Sync refunds and products together in background
            syncService.syncAll(getStoreFunctions).then(() => {
              //('✅ Refund synced to MongoDB (background)');
            }).catch((syncError) => {
              console.error('⚠️ Error syncing refund to MongoDB (will retry later):', syncError);
              // Don't fail the refund - it's saved locally and will sync later
            });
          } catch (error) {

          }
        } else {

        }
      }, 100); // Small delay to ensure UI updates complete first
    } catch (error) {

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
    <div className="space-y-4 sm:space-y-6 px-2 sm:px-0 pb-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#2f3c7e] to-[#18224f] rounded-2xl p-4 sm:p-6 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 backdrop-blur-sm p-3 rounded-xl">
              <RotateCcw className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white flex items-center gap-2">
                Refunds
              </h1>
              <p className="text-xs sm:text-sm text-blue-100 mt-1">Process refunds and manage return requests</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b-2 border-gray-200 bg-white rounded-t-xl overflow-hidden shadow-sm">
        <button
          onClick={() => setActiveTab('search')}
          className={`flex-1 px-3 sm:px-4 py-3 font-semibold text-xs sm:text-sm transition-all relative ${
            activeTab === 'search'
              ? 'text-[#2f3c7e] bg-blue-50'
              : 'text-gray-600 hover:text-[#2f3c7e] hover:bg-gray-50'
          }`}
        >
          {activeTab === 'search' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#2f3c7e] to-[#18224f]"></div>
          )}
          <span className="hidden sm:inline">Search Orders</span>
          <span className="sm:hidden">Search</span>
        </button>
        <button
          onClick={() => setActiveTab('list')}
          className={`flex-1 px-3 sm:px-4 py-3 font-semibold text-xs sm:text-sm transition-all relative ${
            activeTab === 'list'
              ? 'text-[#2f3c7e] bg-blue-50'
              : 'text-gray-600 hover:text-[#2f3c7e] hover:bg-gray-50'
          }`}
        >
          {activeTab === 'list' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#2f3c7e] to-[#18224f]"></div>
          )}
          All Refunds
        </button>
      </div>

      {/* Search Orders Tab */}
      {activeTab === 'search' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Search Section */}
          <div className="bg-white rounded-xl shadow-md p-4 sm:p-6 border border-gray-100">
            <h2 className="text-base sm:text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Search className="h-5 w-5 text-indigo-600" />
              Search Orders for Refund
            </h2>

            <div className="space-y-4">
              {/* Search Type Selector */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">Search By</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'mobile', label: 'Mobile', fullLabel: 'Customer Mobile' },
                    { value: 'customerName', label: 'Name', fullLabel: 'Customer Name' },
                    { value: 'product', label: 'Product', fullLabel: 'Product Name/Barcode' }
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setSearchType(option.value);
                        setSearchTerm('');
                        setEligibleOrders([]);
                      }}
                      className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                        searchType === option.value
                          ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow-md'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <span className="hidden sm:inline">{option.fullLabel}</span>
                      <span className="sm:hidden">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={`Enter ${searchType === 'mobile' ? 'mobile number' : searchType === 'customerName' ? 'customer name' : 'product name or barcode'}`}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all text-sm sm:text-base text-gray-900 placeholder:text-gray-400"
                />
              </div>

              {/* Refund Window Info */}
              <div className="bg-gradient-to-r from-blue-50 to-slate-50 border-2 border-blue-200 rounded-xl p-3 sm:p-4">
                <p className="text-xs sm:text-sm text-slate-700 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-slate-600 flex-shrink-0 mt-0.5" />
                  <span>Only orders within <span className="font-bold">{refundWindowHours} hours</span> ({Math.round(refundWindowHours / 24)} days) are eligible for refund</span>
                </p>
              </div>
            </div>
          </div>

          {/* Eligible Orders List */}
          {isSearching && (
            <div className="bg-white rounded-xl shadow-md p-6 sm:p-8 border border-gray-100">
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
                  <p className="text-sm text-gray-600 font-medium">Searching orders...</p>
                </div>
              </div>
            </div>
          )}
          {!isSearching && eligibleOrders.length > 0 && (
            <div className="bg-white rounded-xl shadow-md p-4 sm:p-6 border border-gray-100">
              <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-[#2f3c7e]" />
                Eligible Orders <span className="text-indigo-600">({eligibleOrders.length})</span>
              </h3>
              <div className="space-y-3">
                {eligibleOrders.map((order) => {
                  const hasRefund = order.refundStatus !== 'NOT_REFUNDED';
                  const isSelected = selectedOrder?.id === order.id || selectedOrder?._id === order._id;

                  return (
                    <div
                      key={order.id || order._id}
                      className={`border-2 rounded-xl p-3 sm:p-4 cursor-pointer transition-all ${
                        hasRefund
                          ? 'border-red-400 bg-gradient-to-r from-red-50 to-red-100/50'
                          :                         isSelected
                          ? 'border-blue-500 bg-gradient-to-r from-blue-50 to-slate-50 shadow-md'
                          : 'border-gray-200 hover:border-blue-300 hover:bg-gradient-to-r hover:from-gray-50 hover:to-blue-50/30'
                      }`}
                      onClick={() => setSelectedOrder(order)}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <p className={`font-bold text-sm sm:text-base ${hasRefund ? 'text-red-900' : 'text-gray-900'}`}>
                              Order: <span className="font-mono">{(order.id || order._id || '').toString().slice(-8)}</span>
                            </p>
                            {hasRefund ? (
                              <span className="px-2 py-1 rounded-lg text-xs font-bold border-2 border-red-600 bg-red-100 text-red-800">
                                REFUNDED
                              </span>
                            ) : (
                              <span className={`px-2 py-1 rounded-lg text-xs font-semibold border ${getRefundStatusBadge(order.refundStatus)}`}>
                                {getRefundStatusText(order.refundStatus)}
                              </span>
                            )}
                          </div>
                          <p className={`text-xs sm:text-sm ${hasRefund ? 'text-red-700' : 'text-gray-600'} mb-1`}>
                            <span className="font-medium">{order.customerName || 'Walk-in Customer'}</span>
                            {order.customerMobile && <span className="text-gray-500"> • {order.customerMobile}</span>}
                          </p>
                          <p className={`text-xs ${hasRefund ? 'text-red-600' : 'text-gray-500'}`}>
                            {formatDateTime(order.createdAt || order.date)}
                          </p>
                        </div>
                        <div className="text-left sm:text-right flex-shrink-0">
                          <p className={`text-lg sm:text-xl font-bold ${hasRefund ? 'text-red-900' : 'text-gray-900'}`}>
                            {formatCurrency(order.totalAmount || order.total)}
                          </p>
                          <p className={`text-xs uppercase font-medium ${hasRefund ? 'text-red-600' : 'text-[#2f3c7e]'}`}>
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
            <div className="bg-white rounded-xl shadow-md p-6 sm:p-8 border border-gray-100">
              <div className="text-center py-8">
                <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-700 font-medium">No eligible orders found</p>
                <p className="text-xs sm:text-sm text-gray-500 mt-2">Try a different search term or check the refund window settings.</p>
              </div>
            </div>
          )}

          {/* Refund Modal Popup */}
          {selectedOrder && (
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setSelectedOrder(null);
                  setRefundItems([]);
                  setRefundReason('');
                }
              }}
            >
              <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#2f3c7e] to-[#18224f] px-4 sm:px-6 py-4 flex items-center justify-between">
                  <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                    <RotateCcw className="h-5 w-5 sm:h-6 sm:w-6" />
                    Refund Items
                  </h3>
                  <button
                    onClick={() => {
                      setSelectedOrder(null);
                      setRefundItems([]);
                      setRefundReason('');
                    }}
                    className="p-2 text-white/90 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5 sm:h-6 sm:w-6" />
                  </button>
                </div>

                <div className="overflow-y-auto flex-1 p-4 sm:p-6">
                  {/* Order Info */}
                  <div className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-xl p-4 mb-4 border border-gray-200">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                      <div>
                        <p className="text-xs text-gray-600 font-medium mb-1">Order ID</p>
                        <p className="font-bold text-gray-900 font-mono">{(selectedOrder.id || selectedOrder._id || '').toString().slice(-8)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 font-medium mb-1">Customer</p>
                        <p className="font-bold text-gray-900">{selectedOrder.customerName || 'Walk-in Customer'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 font-medium mb-1">Date</p>
                        <p className="font-semibold text-gray-900 text-xs sm:text-sm">{formatDateTime(selectedOrder.createdAt || selectedOrder.date)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 font-medium mb-1">Total Amount</p>
                        <p className="font-bold text-indigo-600 text-lg">{formatCurrency(selectedOrder.totalAmount || selectedOrder.total)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Refund Items - Mobile Card View / Desktop Table View */}
                  {refundItems.length > 0 && (
                    <div className="mb-4">
                      {/* Desktop Table View */}
                      <div className="hidden sm:block overflow-x-auto -mx-4 sm:mx-0">
                        <div className="inline-block min-w-full align-middle">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gradient-to-r from-blue-50 to-slate-50">
                              <tr>
                              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700">Product</th>
                              <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-700">Ordered</th>
                              <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-700">Refunded</th>
                              <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-700">Available</th>
                              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-700">Rate</th>
                              <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-700">Refund Qty</th>
                              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-700">Total</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {refundItems.map((item, index) => (
                                <tr 
                                  key={item.productId} 
                                  className={item.refundedQty > 0 ? 'bg-yellow-50/50' : 'hover:bg-gray-50'}
                                >
                                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.name}</td>
                                  <td className="px-4 py-3 text-sm text-gray-700 text-center">
                                    {item.orderedQty} <span className="text-gray-500 text-xs">{item.unit}</span>
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-700 text-center">
                                    {item.refundedQty} <span className="text-gray-500 text-xs">{item.unit}</span>
                                  </td>
                                  <td className="px-4 py-3 text-sm font-bold text-blue-600 text-center">
                                    {item.availableQty} <span className="text-gray-500 text-xs font-normal">{item.unit}</span>
                                  </td>
                                  <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
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
                                      className={`w-20 px-2 py-1.5 text-sm border-2 rounded-lg text-center font-semibold ${
                                        item.availableQty === 0
                                          ? 'bg-gray-100 cursor-not-allowed text-gray-400'
                                          : 'border-blue-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 text-gray-900'
                                      }`}
                                    />
                                  </td>
                                  <td className="px-4 py-3 text-sm font-bold text-blue-600 text-right">
                                    {formatCurrency(item.refundQty * item.rate)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Mobile Card View */}
                      <div className="sm:hidden space-y-3">
                        {refundItems.map((item) => (
                          <div
                            key={item.productId}
                            className={`bg-white border-2 rounded-xl p-4 ${
                              item.refundedQty > 0 ? 'border-yellow-300 bg-yellow-50/30' : 'border-gray-200'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-3">
                              <h4 className="font-bold text-gray-900 text-sm flex-1">{item.name}</h4>
                              <span className="text-xs font-semibold text-[#2f3c7e] bg-blue-50 px-2 py-1 rounded">
                                {formatCurrency(item.rate)}/{item.unit}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                              <div>
                                <p className="text-gray-500">Ordered</p>
                                <p className="font-semibold text-gray-900">{item.orderedQty} {item.unit}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">Refunded</p>
                                <p className="font-semibold text-gray-900">{item.refundedQty} {item.unit}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">Available</p>
                                <p className="font-bold text-indigo-600">{item.availableQty} {item.unit}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">Line Total</p>
                                <p className="font-bold text-indigo-600">{formatCurrency(item.refundQty * item.rate)}</p>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Refund Quantity</label>
                              <input
                                type="number"
                                min="0"
                                max={item.availableQty}
                                value={item.refundQty || ''}
                                onChange={(e) => handleRefundQtyChange(item.productId, e.target.value)}
                                disabled={item.availableQty === 0}
                                className={`w-full px-3 py-2 text-sm border-2 rounded-lg text-center font-semibold ${
                                  item.availableQty === 0
                                    ? 'bg-gray-100 cursor-not-allowed text-gray-400'
                                    : 'border-blue-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 text-gray-900'
                                }`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Total and Reason */}
                      <div className="mt-4 sm:mt-6 space-y-4">
                        <div className="flex justify-end">
                          <div className="bg-gradient-to-r from-[#2f3c7e] to-[#18224f] rounded-xl p-4 sm:p-6 shadow-lg w-full sm:w-auto">
                            <p className="text-xs sm:text-sm text-blue-100 mb-1 font-medium">Total Refund Amount</p>
                            <p className="text-2xl sm:text-3xl font-bold text-white">{formatCurrency(totalRefundAmount)}</p>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                            Refund Reason <span className="text-gray-400 font-normal">(Optional)</span>
                          </label>
                          <textarea
                            value={refundReason}
                            onChange={(e) => setRefundReason(e.target.value)}
                            placeholder="Enter reason for refund..."
                            rows={3}
                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all text-sm sm:text-base text-gray-900 placeholder:text-gray-400"
                          />
                        </div>

                        <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
                          <button
                            onClick={() => {
                              setSelectedOrder(null);
                              setRefundItems([]);
                              setRefundReason('');
                            }}
                            className="w-full sm:w-auto px-6 py-3 rounded-xl font-bold transition-all bg-gray-200 text-gray-700 hover:bg-gray-300 active:scale-95"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleProcessRefund}
                            disabled={isProcessing || totalRefundAmount === 0}
                            className={`w-full sm:w-auto px-6 py-3 rounded-xl font-bold transition-all ${
                              isProcessing || totalRefundAmount === 0
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow-lg hover:shadow-xl active:scale-95'
                            }`}
                          >
                            {isProcessing ? (
                              <span className="flex items-center justify-center gap-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Processing...
                              </span>
                            ) : (
                              'Process Refund'
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {refundItems.length === 0 && (
                    <div className="text-center py-12">
                      <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-3"></div>
                      <p className="text-sm text-gray-600 font-medium">Loading refund items...</p>
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
        <div className="space-y-4 sm:space-y-6">
          {/* Filters */}
          <div className="bg-white rounded-xl shadow-md p-4 sm:p-6 border border-gray-100">
            <h2 className="text-base sm:text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Filter className="h-5 w-5 text-indigo-600" />
              Filters
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">From Date</label>
                <input
                  type="date"
                  value={refundFilters.from}
                  onChange={(e) => setRefundFilters(prev => ({ ...prev, from: e.target.value }))}
                  className="w-full px-3 sm:px-4 py-2 text-sm rounded-lg border-2 border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">To Date</label>
                <input
                  type="date"
                  value={refundFilters.to}
                  onChange={(e) => setRefundFilters(prev => ({ ...prev, to: e.target.value }))}
                  className="w-full px-3 sm:px-4 py-2 text-sm rounded-lg border-2 border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">Customer Mobile</label>
                <input
                  type="text"
                  value={refundFilters.customerMobile}
                  onChange={(e) => setRefundFilters(prev => ({ ...prev, customerMobile: e.target.value }))}
                  placeholder="Search by mobile"
                  className="w-full px-3 sm:px-4 py-2 text-sm rounded-lg border-2 border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">Order ID</label>
                <input
                  type="text"
                  value={refundFilters.orderId}
                  onChange={(e) => setRefundFilters(prev => ({ ...prev, orderId: e.target.value }))}
                  placeholder="Search by order ID"
                  className="w-full px-3 sm:px-4 py-2 text-sm rounded-lg border-2 border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Refunds Table */}
          <div className="bg-white rounded-xl shadow-md border border-gray-100 overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-slate-50">
              <h2 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-[#2f3c7e]" />
                All Refunds <span className="text-indigo-600">({allRefunds.length})</span>
              </h2>
            </div>

            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gradient-to-r from-blue-50 to-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700">Refund ID</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700">Order ID</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700">Customer</th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-700">Amount</th>
                    <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-700">Items</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700">Refunded By</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedRefunds.length > 0 ? (
                    paginatedRefunds.map((refund) => (
                      <tr key={refund.id} className="hover:bg-indigo-50/30 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 font-mono">
                          {(refund.refundId || refund.id || '').toString().slice(-8)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                          {(refund.orderId || '').toString().slice(-8)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          <div className="font-medium">{refund.customerName || '-'}</div>
                          {refund.customerMobile && (
                            <div className="text-xs text-gray-500">{refund.customerMobile}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-blue-600 text-right">
                          {formatCurrency(refund.totalRefundAmount)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-center">
                          <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-lg font-semibold text-xs">
                            {refund.itemsCount || 0}
                          </span>
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
                        <p className="text-gray-600 font-medium">No refunds found</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="sm:hidden divide-y divide-gray-200">
              {paginatedRefunds.length > 0 ? (
                paginatedRefunds.map((refund) => (
                  <div key={refund.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                            {(refund.refundId || refund.id || '').toString().slice(-8)}
                          </span>
                          <span className="text-xs text-gray-500">Order: {(refund.orderId || '').toString().slice(-8)}</span>
                        </div>
                        <p className="text-sm font-semibold text-gray-900">{refund.customerName || '-'}</p>
                        {refund.customerMobile && (
                          <p className="text-xs text-gray-500">{refund.customerMobile}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-blue-600">{formatCurrency(refund.totalRefundAmount)}</p>
                        <p className="text-xs text-gray-500">{refund.itemsCount || 0} items</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-600 mt-2 pt-2 border-t border-gray-100">
                      <span>{formatDate(refund.refundDate || refund.createdAt)}</span>
                      <span className="font-medium">{refund.refundedBy || '-'}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-12 text-center">
                  <RotateCcw className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 font-medium">No refunds found</p>
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 sm:px-6 py-4 border-t border-gray-200 bg-gray-50">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="text-xs sm:text-sm text-gray-700 font-medium">
                    Showing <span className="font-bold text-indigo-600">{startIndex + 1}</span> to{' '}
                    <span className="font-bold text-indigo-600">{Math.min(startIndex + itemsPerPage, allRefunds.length)}</span> of{' '}
                    <span className="font-bold text-indigo-600">{allRefunds.length}</span> refunds
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className="p-2 text-gray-500 bg-white border-2 border-gray-300 rounded-lg hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="p-2 text-gray-500 bg-white border-2 border-gray-300 rounded-lg hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <div className="flex gap-1">
                      {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                        let page;
                        if (totalPages <= 5) {
                          page = i + 1;
                        } else if (currentPage <= 3) {
                          page = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          page = totalPages - 4 + i;
                        } else {
                          page = currentPage - 2 + i;
                        }
                        return (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${
                              currentPage === page
                                ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md'
                                : 'bg-white text-gray-700 border-2 border-gray-300 hover:bg-indigo-50 hover:border-indigo-300'
                            }`}
                          >
                            {page}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => setCurrentPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="p-2 text-gray-500 bg-white border-2 border-gray-300 rounded-lg hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="p-2 text-gray-500 bg-white border-2 border-gray-300 rounded-lg hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && successData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 p-6 text-center">
              <CheckCircle className="h-16 w-16 text-white mx-auto mb-3" />
              <h3 className="text-xl sm:text-2xl font-bold text-white">Refund Processed Successfully</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 font-medium">Refund ID</span>
                  <span className="text-sm font-mono font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">
                    {(successData.refundId || '').toString().slice(-8)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 font-medium">Total Amount</span>
                  <span className="text-xl font-bold text-indigo-600">
                    {formatCurrency(successData.totalRefundAmount)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 font-medium">Items Refunded</span>
                  <span className="text-sm font-bold text-gray-900 bg-indigo-100 text-indigo-800 px-3 py-1 rounded-lg">
                    {successData.itemsCount || 0}
                  </span>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  setSuccessData(null);
                }}
                className="w-full px-6 py-3 bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white rounded-xl font-bold hover:shadow-lg active:scale-95 transition-all"
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

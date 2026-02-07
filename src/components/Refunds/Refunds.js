import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useApp, ActionTypes, associateBatchesWithProducts, isPlanExpired, triggerSyncStatusUpdate } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';
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
  ChevronsRight,
  ChevronDown,
  Phone,
  Hash,
  CalendarRange,
  Banknote,
  Wallet,
  ArrowRight,
  Users,
  UserPlus,
  Plus
} from 'lucide-react';
import { apiRequest, getSellerIdFromAuth } from '../../utils/api';
import { sanitizeMobileNumber } from '../../utils/validation';
import { addItem, getAllItems, STORES } from '../../utils/indexedDB';
import syncService from '../../services/syncService';

import { formatCurrency, formatCurrencyCompact, formatCurrencySmart } from '../../utils/orderUtils';
import { updateInventoryAfterRefund } from '../../utils/dataFetcher';

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
  const [activeTab, setActiveTab] = useState('list'); // 'search' or 'list'

  // Search section state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState('mobile'); // 'mobile', 'customerName', 'product'
  const [eligibleOrders, setEligibleOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isSearching, setIsSearching] = useState(false);

  // Refund form state
  const [refundItems, setRefundItems] = useState([]);
  const [refundReason, setRefundReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successData, setSuccessData] = useState(null);

  // Refund cash input modal state
  const [showRefundAmountModal, setShowRefundAmountModal] = useState(false);
  const [cashRefundAmount, setCashRefundAmount] = useState(0);

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

  // Add Customer sub-flow state
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({ name: '', mobile: '' });
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [customerModalTab, setCustomerModalTab] = useState('search'); // 'search' or 'create'
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');

  const selectedCustomer = useMemo(() => {
    if (!selectedOrder || !selectedOrder.customerId) return null;
    return (state.customers || []).find(c => (c.id || c._id || '').toString() === (selectedOrder.customerId || '').toString());
  }, [selectedOrder, state.customers]);

  const filteredExistingCustomers = useMemo(() => {
    if (!customerSearchTerm.trim()) return [];
    const search = customerSearchTerm.toLowerCase().trim();
    return (state.customers || [])
      .filter(c =>
        (c.name || '').toLowerCase().includes(search) ||
        (c.mobileNumber || '').includes(search)
      )
      .slice(0, 5);
  }, [customerSearchTerm, state.customers]);

  const handleSelectExistingCustomer = async (customer) => {
    try {
      const customerId = customer.id || customer._id;

      const updatedOrder = {
        ...selectedOrder,
        customerId: customerId,
        customerName: customer.name,
        customerMobile: customer.mobileNumber,
        isSynced: false
      };

      setSelectedOrder(updatedOrder);
      dispatch({ type: ActionTypes.UPDATE_ORDER, payload: updatedOrder });
      await addItem(STORES.orders, updatedOrder);

      if (window.showToast) window.showToast(`Linked to ${customer.name}`, 'success');
      setShowAddCustomerModal(false);
      setCustomerSearchTerm('');
    } catch (error) {
      console.error('Error linking customer:', error);
      if (window.showToast) window.showToast('Failed to link customer', 'error');
    }
  };
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
      const searchLower = searchTerm.toLowerCase().trim();

      const filtered = allOrders.filter(order => {
        // CRITICAL: Ensure order belongs to current seller
        const orderSellerId = order.sellerId || order.sellerId?.toString();
        const currentSellerId = sellerId?.toString();
        if (orderSellerId && currentSellerId && orderSellerId !== currentSellerId) {
          return false; // Skip orders that don't belong to current seller
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
        } else if (searchType === 'invoice') {
          const invoiceNum = (order.invoiceNumber || '').toLowerCase();
          return invoiceNum.includes(searchLower);
        }
        return false;
      });

      // Calculate refund status locally from state.refunds (OFFLINE-FIRST)
      const ordersWithRefundStatus = filtered.map(order => {
        const orderId = (order._id || order.id || '').toString();
        if (!orderId) return null;

        // Find all refunds for this order from global state
        const orderRefunds = (state.refunds || []).filter(r => {
          const rOrderId = (r.orderId || '').toString();
          return rOrderId === orderId;
        });

        // Calculate refunded quantities per product
        const refundedQuantities = {};
        let totalRefundedQty = 0;
        let totalOrderedQty = 0;

        orderRefunds.forEach(refund => {
          if (refund.items && Array.isArray(refund.items)) {
            refund.items.forEach(item => {
              const productId = (item.productId?._id || item.productId || item.id || '').toString();
              if (productId) {
                refundedQuantities[productId] = (refundedQuantities[productId] || 0) + (Number(item.qty) || 0);
              }
            });
          }
        });

        if (order.items && Array.isArray(order.items)) {
          order.items.forEach(item => {
            const productId = (item.productId?._id || item.productId || item._id || '').toString();
            const orderedQty = Number(item.quantity || 0);
            totalOrderedQty += orderedQty;

            // Try multiple ways to match productId in refundedQuantities
            let refundedForThisItem = refundedQuantities[productId] || 0;
            if (refundedForThisItem === 0) {
              // Fallback match
              const key = Object.keys(refundedQuantities).find(k => k === productId || k.includes(productId) || productId.includes(k));
              if (key) refundedForThisItem = refundedQuantities[key];
            }

            totalRefundedQty += refundedForThisItem;
          });
        }

        let refundStatus = 'NOT_REFUNDED';
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
      });

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
  }, [searchTerm, searchType]);

  // Load refund items when order is selected
  const selectedOrderId = selectedOrder?._id || selectedOrder?.id;
  useEffect(() => {
    if (selectedOrderId) {
      loadRefundItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId]);

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

      // STEP 1 & 2: Load refunds from state/IndexedDB (OFFLINE-FIRST)
      // We prioritize state.refunds as it's kept in sync, but fall back to IndexedDB if needed
      const allRefundsToSearch = (state.refunds && state.refunds.length > 0)
        ? state.refunds
        : await getAllItems(STORES.refunds).catch(() => []);

      // Filter refunds for this order
      const orderRefunds = allRefundsToSearch.filter(refund => {
        const refundOrderId = (refund.orderId || '').toString();
        return refundOrderId === orderIdStr;
      });

      // Calculate refunded quantities from found refunds
      const refundedQuantities = {};
      orderRefunds.forEach(refund => {
        if (refund.items && Array.isArray(refund.items)) {
          refund.items.forEach(item => {
            const productId = (item.productId?._id || item.productId || item.id || '').toString();
            if (productId) {
              refundedQuantities[productId] = (refundedQuantities[productId] || 0) + (Number(item.qty) || 0);
            }
          });
        }
      });

      // Load all product batches to find matches
      const allBatches = await getAllItems(STORES.productBatches).catch(() => []);

      const items = (selectedOrder.items || []).map(item => {
        const productId = (item.productId || item._id || '').toString();
        const orderedQty = Number(item.quantity || 0);
        // Calculate refunded amount from ALL sources (local DB + backend) to be safe
        // We re-calculate from the fetched indexedDB refunds to ensure we have the absolute latest
        const localRefundedQty = orderRefunds.reduce((total, refund) => {
          if (!refund.items || !Array.isArray(refund.items)) return total;
          const item = refund.items.find(i => (i.productId || '').toString() === productId);
          return total + (Number(item?.qty) || 0);
        }, 0);

        // Use the greater of local calculation or what was passed in (which might be from backend)
        // This ensures if backend has more info we use it, but if we just saved locally, we use that
        const refundedQty = Math.max(localRefundedQty, refundedQuantities[productId] || 0);
        const availableQty = orderedQty - refundedQty;

        // Find batches for this product
        const productBatches = allBatches.filter(b => (b.productId || '').toString() === productId);

        // Calculate price per unit
        let rate = 0;
        if (item.unitSellingPrice !== undefined && item.unitSellingPrice !== null) {
          rate = Number(item.unitSellingPrice || 0);
        } else if (orderedQty > 0) {
          const totalPrice = Number(item.sellingPrice || item.price || item.totalSellingPrice || item.amount || 0);
          rate = totalPrice / orderedQty;
        } else {
          rate = Number(item.sellingPrice || item.price || item.amount || 0);
        }

        // Apply order-level discount to the rate (Pro-rated)
        const orderSubtotal = Number(selectedOrder.subtotal || selectedOrder.subTotal || 0);
        let orderDiscountVal = Number(selectedOrder.discountAmount || 0);

        // Fallback: If discountAmount is missing, calculate from percentage
        if (orderDiscountVal === 0 && orderSubtotal > 0) {
          if (selectedOrder.discountPercent !== undefined && selectedOrder.discountPercent !== null) {
            orderDiscountVal = (orderSubtotal * Number(selectedOrder.discountPercent)) / 100;
          } else if (selectedOrder.discount !== undefined && selectedOrder.discount !== null) {
            // 'discount' could be amount or percent. If it looks like a percent logic matches Billing.js state
            orderDiscountVal = (orderSubtotal * Number(selectedOrder.discount)) / 100;
          }
        }

        if (orderSubtotal > 0 && orderDiscountVal > 0) {
          const discountRatio = Math.min(1, orderDiscountVal / orderSubtotal);
          rate = rate * (1 - discountRatio);

          // Handle precision issues
          if (rate < 0.01) rate = 0;
        }

        return {
          productId,
          name: item.name || 'Unknown',
          orderedQty,
          refundedQty,
          availableQty,
          rate,
          refundQty: 0,
          unit: item.unit || 'pcs',
          batches: productBatches,
          selectedBatchId: productBatches.length === 1 ? (productBatches[0]._id || productBatches[0].id) : '',
          isDProduct: item.isDProduct === true || String(item.isDProduct) === 'true'
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

  // Handle batch selection change
  const handleBatchChange = (productId, batchId) => {
    setRefundItems(prev => prev.map(item => {
      if (item.productId === productId) {
        return { ...item, selectedBatchId: batchId };
      }
      return item;
    }));
  };

  // Process refund - OFFLINE-FIRST APPROACH
  const handleProcessRefund = async () => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to process refunds.', 'warning', 8000);
      }
      return;
    }
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

    // Validate items
    const itemsToRefund = refundItems.filter(item => item.refundQty > 0);
    if (itemsToRefund.length === 0) {
      if (window.showToast) {
        window.showToast('Please select items to refund', 'warning');
      }
      return;
    }

    // Validate batch selection (must select a batch) - SKIP for Direct Products
    for (const item of itemsToRefund) {
      if (item.isDProduct) continue; // Direct products don't have batches

      if (!item.batches || item.batches.length === 0) {
        if (window.showToast) {
          window.showToast(`Refund not allowed: No inventory batches found for ${item.name}`, 'error');
        }
        return;
      }
      if (!item.selectedBatchId) {
        if (window.showToast) {
          window.showToast(`Please select a batch for ${item.name}`, 'warning');
        }
        return;
      }
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

    // If validations pass, show the amount modal
    setCashRefundAmount(totalRefundAmount);
    setShowRefundAmountModal(true);
  };

  const handleCreateCustomer = async () => {
    if (!newCustomerData.name || !newCustomerData.mobile) {
      if (window.showToast) window.showToast('Please enter both name and mobile', 'warning');
      return;
    }

    setIsCreatingCustomer(true);
    try {
      const customerId = `cust_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const customer = {
        id: customerId,
        _id: customerId,
        name: newCustomerData.name.trim(),
        mobileNumber: sanitizeMobileNumber(newCustomerData.mobile),
        dueAmount: 0,
        balanceDue: 0,
        sellerId: sellerId || state.currentUser?.sellerId,
        createdAt: new Date().toISOString(),
        isSynced: false
      };

      // 1. Save to DB
      await addItem(STORES.customers, customer);

      // 2. Update Global State
      dispatch({ type: ActionTypes.ADD_CUSTOMER, payload: customer });

      // 3. Link to current order session (Local component state)
      const updatedOrder = {
        ...selectedOrder,
        customerId: customerId,
        customerName: customer.name,
        customerMobile: customer.mobileNumber,
        isSynced: false // CRITICAL: Mark as unsynced so changes are pushed to backend
      };

      setSelectedOrder(updatedOrder);

      // 4. Update order in Global State so it reflects across the app (Dashboard, Reports etc)
      dispatch({ type: ActionTypes.UPDATE_ORDER, payload: updatedOrder });

      // 5. Update order in local DB so it remains linked permanently
      await addItem(STORES.orders, updatedOrder);

      if (window.showToast) window.showToast('Customer registered and linked to order', 'success');
      setShowAddCustomerModal(false);
    } catch (error) {
      console.error('Error creating customer:', error);
      if (window.showToast) window.showToast('Failed to register customer', 'error');
    } finally {
      setIsCreatingCustomer(false);
    }
  };

  const confirmRefund = async () => {
    setIsProcessing(true);
    setShowRefundAmountModal(false);

    try {
      const orderId = selectedOrder._id || selectedOrder.id;
      const orderIdStr = orderId?.toString();
      const itemsToRefund = refundItems.filter(item => item.refundQty > 0);

      // Calculate refund items and total
      const refundItemsData = itemsToRefund.map(item => ({
        productId: item.productId || `dp_${item.name?.replace(/\s+/g, '_')}_${Date.now()}`, // Ensure productId is set
        name: item.name,
        qty: item.refundQty,
        rate: item.rate,
        lineTotal: item.refundQty * item.rate,
        unit: item.unit || 'pcs',
        batchId: item.isDProduct ? null : item.selectedBatchId,
        isDProduct: item.isDProduct
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
        cashRefunded: Number(cashRefundAmount) || 0,
        reason: refundReason.trim() || '',
        refundedByUser: state.currentUser?.name || state.currentUser?.email || 'System',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stockAdjusted: true,
        isSynced: false
      };

      // STEP 1: Update customer accounting if applicable
      // Ensure precise calculation by forcing numeric types and handling potential floating point issues
      const safeTotal = Number(totalRefundAmount) || 0;
      const safeCash = Number(cashRefundAmount) || 0;
      const rawCredit = safeTotal - safeCash;

      // Variables to store customer balance snapshot for the success modal
      let prevDue = 0;
      let postDue = 0;
      const isRegisteredCustomer = !!selectedOrder.customerId;

      // Fix potential floating point precision errors (e.g. 10.99 - 0 = 10.9900000001)
      const creditAmount = Math.max(0, Math.round(rawCredit * 100) / 100);

      // Only proceed if there is a positive credit amount to apply
      if (creditAmount > 0) {
        if (selectedOrder.customerId) {
          const customer = (state.customers || []).find(c => (c.id || c._id || '').toString() === (selectedOrder.customerId || '').toString());

          if (customer) {
            const currentDue = Number(customer.dueAmount || customer.balanceDue || 0);
            const newDueAmount = Number((currentDue - creditAmount).toFixed(2)); // Ensure 2 decimal precision

            prevDue = currentDue;
            postDue = newDueAmount;

            // 1. Create customer transaction (Credit)
            const txId = `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const newTransaction = {
              id: txId,
              customerId: customer.id || customer._id,
              sellerId: sellerId || state.currentUser?.sellerId,
              amount: creditAmount,
              type: 'refund',
              previousBalance: currentDue,
              currentBalance: newDueAmount,
              description: `Credit for product refund (Order: ${orderIdStr})`, // orderIdStr is defined in outer scope
              date: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              isSynced: false
            };

            dispatch({
              type: ActionTypes.ADD_CUSTOMER_TRANSACTION,
              payload: newTransaction
            });

            // 2. Update customer due amount
            const updatedCustomer = {
              ...customer,
              dueAmount: newDueAmount,
              balanceDue: newDueAmount,
              updatedAt: new Date().toISOString(),
              isSynced: false
            };

            dispatch({
              type: ActionTypes.UPDATE_CUSTOMER,
              payload: updatedCustomer
            });
          } else {
            console.warn('Refund Logic: Selected order has customerId but customer not found in state', selectedOrder.customerId);
            // Proceed without customer update to allow refund to complete
          }
        }
      }

      // STEP 2: Save Refund to IndexedDB
      await addItem(STORES.refunds, refund);

      // STEP 3: Update product stock and batches locally
      const inventoryResult = await updateInventoryAfterRefund(refund);

      if (inventoryResult.success && dispatch) {
        if (inventoryResult.updatedBatches?.length > 0) {
          dispatch({
            type: ActionTypes.SET_PRODUCT_BATCHES,
            payload: inventoryResult.updatedBatches,
            merge: true
          });
        }

        if (inventoryResult.updatedProducts?.length > 0) {
          const existingProductsMap = new Map();
          state.products.forEach(p => {
            const id = (p.id || p._id || '').toString();
            if (id) existingProductsMap.set(id, p);
          });

          inventoryResult.updatedProducts.forEach(p => {
            const id = (p.id || p._id || '').toString();
            if (id) existingProductsMap.set(id, p);
          });

          const mergedProducts = Array.from(existingProductsMap.values());
          const existingBatchesMap = new Map();
          state.productBatches.forEach(b => {
            const id = (b.id || b._id || '').toString();
            if (id) existingBatchesMap.set(id, b);
          });

          inventoryResult.updatedBatches.forEach(b => {
            const id = (b.id || b._id || '').toString();
            if (id) existingBatchesMap.set(id, b);
          });

          const mergedBatches = Array.from(existingBatchesMap.values());
          const finalProducts = associateBatchesWithProducts(mergedProducts, mergedBatches);

          dispatch({
            type: ActionTypes.SET_PRODUCTS,
            payload: finalProducts
          });
        }
      }

      // STEP 3.5: Update Global State immediately so Dashboard shows it
      if (dispatch) {
        dispatch({
          type: ActionTypes.ADD_REFUND,
          payload: refund
        });
      }

      // STEP 4: Update UI IMMEDIATELY
      setSuccessData({
        refundId: refundId,
        orderId: orderIdStr,
        totalRefundAmount,
        cashRefunded: Number(cashRefundAmount) || 0,
        creditAmount: Math.max(0, totalRefundAmount - Number(cashRefundAmount || 0)),
        itemsCount: refundItemsData.length,
        createdAt: refund.createdAt,
        customerName: selectedOrder.customerName || 'Walk-in Customer',
        customerMobile: selectedOrder.customerMobile || '',
        previousDue: prevDue,
        currentDue: postDue,
        isRegistered: isRegisteredCustomer
      });
      setShowSuccessModal(true);

      // Reset form
      setSelectedOrder(null);
      setRefundItems([]);
      setRefundReason('');
      setSearchTerm('');
      setEligibleOrders([]);

      if (activeTab === 'list') {
        loadAllRefunds();
      }

      if (window.showToast) {
        window.showToast('Refund processed successfully', 'success');
      }

      triggerSyncStatusUpdate();
      syncService.scheduleSync();
    } catch (error) {
      if (window.showToast) {
        window.showToast('Error processing refund: ' + (error.message || 'Unknown error'), 'error');
      }
    } finally {
      setIsProcessing(false);
    }
  };


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
      'REFUNDED': getTranslation('refundedStatus', state.currentLanguage),
      'PARTIALLY_REFUNDED': getTranslation('partiallyRefunded', state.currentLanguage),
      'NOT_REFUNDED': getTranslation('notRefunded', state.currentLanguage)
    };
    return texts[status] || getTranslation('notRefunded', state.currentLanguage);
  };

  // Load all refunds - OFFLINE-FIRST APPROACH
  const loadAllRefunds = async () => {
    try {
      // STEP 1 & 2: Use state/IndexedDB (OFFLINE-FIRST)
      let sourceRefunds = (state.refunds && state.refunds.length > 0)
        ? state.refunds
        : await getAllItems(STORES.refunds).catch(() => []);

      // Filter refunds by sellerId
      const sellerRefunds = sourceRefunds.filter(refund => {
        const refundSellerId = (refund.sellerId || '').toString();
        const currentSellerId = (sellerId || '').toString();
        return !refundSellerId || !currentSellerId || refundSellerId === currentSellerId;
      });

      // Apply filters
      let filteredRefunds = sellerRefunds.filter(refund => {
        // Date filters
        const refundDate = new Date(refund.createdAt || refund.refundDate);
        refundDate.setHours(0, 0, 0, 0); // Normalize refund date to start of day for comparison

        if (refundFilters.from) {
          const fromDate = new Date(refundFilters.from);
          fromDate.setHours(0, 0, 0, 0);
          if (refundDate < fromDate) return false;
        }
        if (refundFilters.to) {
          const toDate = new Date(refundFilters.to);
          toDate.setHours(0, 0, 0, 0);
          if (refundDate > toDate) return false;
        }

        // Invoice Number filter
        if (refundFilters.orderId) {
          const filterVal = refundFilters.orderId.trim().toLowerCase();
          const order = state.orders.find(o => (o._id || o.id || '').toString() === (refund.orderId || '').toString());
          const invoiceNum = (order?.invoiceNumber || '').toLowerCase();
          if (!invoiceNum.includes(filterVal)) return false;
        }

        // Customer mobile filter (need to check order)
        if (refundFilters.customerMobile) {
          const filterMobile = sanitizeMobileNumber(refundFilters.customerMobile);

          const order = state.orders.find(o => {
            const oId = (o._id || o.id || '').toString();
            const rOrderId = (refund.orderId || '').toString();
            return oId === rOrderId;
          });

          if (order) {
            const orderMobile = sanitizeMobileNumber(order.customerMobile || '');
            // Check if order mobile contains filter mobile
            if (!orderMobile.includes(filterMobile)) {
              return false;
            }
          } else {
            // If filtering by mobile but can't find order to check mobile, exclude it
            return false;
          }
        }

        return true;
      });

      // Helper to format and sort refunds
      const formatRefunds = (list) => {
        return list.map(refund => {
          const order = state.orders.find(o => {
            const oId = (o._id || o.id || '').toString();
            const rOrderId = (refund.orderId || '').toString();
            return oId === rOrderId;
          });

          return {
            id: refund.id || refund._id,
            refundId: refund.id || refund._id,
            orderId: refund.orderId,
            invoiceNumber: order?.invoiceNumber || '-',
            customerId: refund.customerId,
            totalRefundAmount: refund.totalRefundAmount,
            refundDate: refund.createdAt || refund.refundDate,
            refundedBy: refund.refundedByUser || '-',
            itemsCount: refund.items?.length || 0,
            reason: refund.reason || '',
            customerName: order?.customerName || '-',
            customerMobile: order?.customerMobile || '-'
          };
        }).sort((a, b) => {
          // Sort descending (newest first)
          const dateA = new Date(a.refundDate || 0);
          const dateB = new Date(b.refundDate || 0);
          return dateB - dateA;
        });
      };

      const formattedRefunds = formatRefunds(filteredRefunds);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, refundFilters, state.orders, state.refunds]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-900 dark:from-slate-800 dark:to-slate-900 rounded-2xl p-4 sm:p-6 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 backdrop-blur-sm p-3 rounded-xl">
              <RotateCcw className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
                {getTranslation('refundsTitle', state.currentLanguage)}
              </h1>
              <p className="text-xs sm:text-sm text-blue-100 dark:text-slate-300 mt-1">{getTranslation('refundsSubtitle', state.currentLanguage)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b-2 border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-t-xl overflow-hidden shadow-sm">
        <button
          onClick={() => setActiveTab('search')}
          className={`flex-1 px-3 sm:px-4 py-3 font-semibold text-xs sm:text-sm transition-all relative ${activeTab === 'search'
            ? 'text-slate-900 dark:text-blue-400 bg-blue-50 dark:bg-slate-700/50'
            : 'text-gray-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-slate-700'
            }`}
        >
          {activeTab === 'search' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-slate-900 to-slate-900 dark:from-blue-500 dark:to-indigo-500"></div>
          )}
          <span className="hidden sm:inline">{getTranslation('searchOrdersTab', state.currentLanguage)}</span>
          <span className="sm:hidden">{getTranslation('searchOrdersTab', state.currentLanguage)}</span>
        </button>
        <button
          onClick={() => setActiveTab('list')}
          className={`flex-1 px-3 sm:px-4 py-3 font-semibold text-xs sm:text-sm transition-all relative ${activeTab === 'list'
            ? 'text-slate-900 dark:text-blue-400 bg-blue-50 dark:bg-slate-700/50'
            : 'text-gray-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-slate-700'
            }`}
        >
          {activeTab === 'list' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-slate-900 to-slate-900 dark:from-blue-500 dark:to-indigo-500"></div>
          )}
          {getTranslation('allRefundsTab', state.currentLanguage)}
        </button>
      </div>

      {/* Search Orders Tab */}
      {activeTab === 'search' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Search Section */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 sm:p-6 border border-gray-100 dark:border-slate-700">
            <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Search className="h-5 w-5 text-slate-900 dark:text-slate-100" />
              {getTranslation('searchOrdersForRefund', state.currentLanguage)}
            </h2>

            <div className="space-y-4">
              {/* Search Type Selector */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">{getTranslation('searchBy', state.currentLanguage)}</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'mobile', label: getTranslation('mobile', state.currentLanguage), fullLabel: getTranslation('customerMobile', state.currentLanguage) || 'Customer Mobile' },
                    { value: 'invoice', label: getTranslation('invoice', state.currentLanguage) || 'Invoice', fullLabel: getTranslation('invoiceNumber', state.currentLanguage) || 'Invoice Number' },
                    { value: 'customerName', label: getTranslation('name', state.currentLanguage) || 'Name', fullLabel: getTranslation('customerName', state.currentLanguage) || 'Customer Name' },
                    { value: 'product', label: getTranslation('product', state.currentLanguage) || 'Product', fullLabel: getTranslation('productNameBarcode', state.currentLanguage) }
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setSearchType(option.value);
                        setSearchTerm('');
                        setEligibleOrders([]);
                      }}
                      className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${searchType === option.value
                        ? 'bg-gradient-to-r from-slate-900 to-slate-900 dark:from-white dark:to-white text-white dark:text-slate-900 shadow-md'
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
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
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-500 dark:text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={`Enter ${searchType === 'mobile' ? 'mobile number' : searchType === 'invoice' ? 'invoice number' : searchType === 'customerName' ? 'customer name' : 'product name or barcode'}`}
                  className="w-full pl-10 pr-10 py-3 rounded-xl border-2 border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-slate-900/30 focus:border-blue-500 dark:focus:border-blue-400 transition-all text-sm sm:text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>


            </div>
          </div>

          {/* Eligible Orders List */}
          {isSearching && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6 sm:p-8 border border-gray-100 dark:border-slate-700">
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400 mb-2"></div>
                  <p className="text-sm text-gray-600 dark:text-slate-400 font-medium">Searching orders...</p>
                </div>
              </div>
            </div>
          )}
          {!isSearching && eligibleOrders.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 sm:p-6 border border-gray-100 dark:border-slate-700">
              <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-slate-900 dark:text-slate-100" />
                {getTranslation('eligibleOrders', state.currentLanguage)} <span className="text-slate-900 dark:text-slate-100">({eligibleOrders.length})</span>
              </h3>
              <div className="space-y-3">
                {eligibleOrders.map((order) => {
                  const hasRefund = order.refundStatus !== 'NOT_REFUNDED';
                  const isSelected = selectedOrder?.id === order.id || selectedOrder?._id === order._id;

                  return (
                    <div
                      key={order.id || order._id}
                      className={`border-2 rounded-xl p-3 sm:p-4 cursor-pointer transition-all ${hasRefund
                        ? 'border-red-400 dark:border-red-900/50 bg-gradient-to-r from-red-50 to-red-100/50 dark:from-red-900/20 dark:to-red-800/10'
                        : isSelected
                          ? 'border-blue-500 dark:border-blue-400 bg-gradient-to-r from-blue-50 to-slate-50 dark:from-slate-700 dark:to-slate-800 shadow-md'
                          : 'border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-500/50 hover:bg-gray-50 dark:hover:bg-slate-700/50'
                        }`}
                      onClick={() => setSelectedOrder(order)}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <p className={`font-bold text-sm sm:text-base ${hasRefund ? 'text-red-900 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                              {getTranslation('orders', state.currentLanguage)}: <span className="font-mono">{(order.id || order._id || '').toString().slice(-8)}</span>
                            </p>
                            {hasRefund ? (
                              <span className="px-2 py-1 rounded-lg text-xs font-bold border-2 border-red-600 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">
                                {getTranslation('refundedStatus', state.currentLanguage)}
                              </span>
                            ) : (
                              <span className={`px-2 py-1 rounded-lg text-xs font-semibold border ${getRefundStatusBadge(order.refundStatus)}`}>
                                {getRefundStatusText(order.refundStatus)}
                              </span>
                            )}
                          </div>
                          <p className={`text-xs sm:text-sm ${hasRefund ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-slate-400'} mb-1`}>
                            <span className="font-medium">{order.customerName || 'Walk-in Customer'}</span>
                            {order.customerMobile && <span className="text-gray-500 dark:text-slate-500"> • {order.customerMobile}</span>}
                          </p>
                          <p className={`text-xs ${hasRefund ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-slate-500'}`}>
                            {formatDateTime(order.createdAt || order.date)}
                          </p>
                        </div>
                        <div className="text-left sm:text-right flex-shrink-0">
                          <p className={`text-lg sm:text-xl font-bold ${hasRefund ? 'text-rose-900 dark:text-rose-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {formatCurrency(order.totalAmount || order.total)}
                          </p>
                          <p className={`text-xs uppercase font-medium ${hasRefund ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-blue-400'}`}>
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
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6 sm:p-8 border border-gray-100 dark:border-slate-700">
              <div className="text-center py-8">
                <AlertCircle className="h-12 w-12 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
                <p className="text-gray-700 dark:text-slate-300 font-medium">{getTranslation('noOrdersFound', state.currentLanguage)}</p>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400 mt-2">Try a different search term or check the refund window settings.</p>
              </div>
            </div>
          )}

          {/* Refund Modal Popup */}
          {showRefundAmountModal && createPortal(
            <div className="fixed inset-0 z-[2000000] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-300">
              <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-8 duration-300 border border-slate-200 dark:border-slate-800 flex flex-col">
                {/* Header */}
                <div className="bg-slate-900 p-4 text-white flex justify-between items-center flex-shrink-0">
                  <div>
                    <h3 className="text-xl font-bold tracking-tight">Refund Payment</h3>
                    <p className="text-slate-400 text-xs mt-1 uppercase font-black tracking-widest">Action Required</p>
                  </div>
                  <button
                    onClick={() => setShowRefundAmountModal(false)}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh] scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                  {/* Customer Details */}
                  {selectedOrder && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Customer</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[200px]">{selectedOrder.customerName || 'Walk-in'}</span>
                      </div>
                      {selectedOrder.customerMobile && (
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Contact</span>
                          <span className="text-xs font-bold text-slate-900 dark:text-white font-mono">{selectedOrder.customerMobile}</span>
                        </div>
                      )}
                      {selectedCustomer && (
                        <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-2 mt-1">
                          <span className="text-[10px] font-black text-rose-500 uppercase tracking-wider">Current Due</span>
                          <span className="text-xs font-black text-rose-600 dark:text-rose-400">
                            {formatCurrencySmart(selectedCustomer.dueAmount ?? selectedCustomer.balanceDue ?? 0, state.currencyFormat)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Summary */}
                  <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
                        <Banknote className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Total Refund</span>
                    </div>
                    <span className="text-xl font-black text-slate-900 dark:text-white">{formatCurrency(totalRefundAmount)}</span>
                  </div>

                  {/* Input */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
                      <Wallet className="w-3 h-3" />
                      Cash Refund Amount
                    </label>
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">₹</div>
                      <input
                        type="text"
                        autoFocus
                        value={cashRefundAmount}
                        onChange={(e) => {
                          const val = e.target.value;
                          // Only allow numbers and one decimal point
                          if (val === '' || /^\d*\.?\d*$/.test(val)) {
                            const numVal = Number(val);
                            if (numVal <= totalRefundAmount) {
                              setCashRefundAmount(val);
                            }
                          }
                        }}
                        onFocus={(e) => e.target.select()}
                        className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl text-2xl font-black text-slate-900 dark:text-white focus:outline-none focus:border-slate-900 dark:focus:border-white transition-all"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-bold px-1">
                      <span className="text-slate-500">Maximum possible</span>
                      <button
                        onClick={() => setCashRefundAmount(totalRefundAmount)}
                        className="text-slate-900 dark:text-white underline underline-offset-2"
                      >
                        Set Full
                      </button>
                    </div>
                  </div>

                  {/* Credit Preview or Walk-in Warning */}
                  {totalRefundAmount > Number(cashRefundAmount) ? (
                    !selectedOrder.customerId ? (
                      <div className="p-4 rounded-xl border-2 border-rose-200 dark:border-rose-900/30 bg-rose-50/50 dark:bg-rose-900/10 space-y-3">
                        <div className="flex items-start gap-3">
                          <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5" />
                          <div>
                            <p className="text-sm font-bold text-rose-900 dark:text-rose-400">Register Customer Required</p>
                            <p className="text-xs text-rose-700 dark:text-rose-300">
                              Ledger adjustments (store credit) are not available for Walk-in customers. Please issue full cash refund or register this customer first.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setNewCustomerData({
                              name: selectedOrder.customerName || '',
                              mobile: selectedOrder.customerMobile || ''
                            });
                            setShowAddCustomerModal(true);
                          }}
                          className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-black uppercase tracking-wider transition-all"
                        >
                          Register Customer Now
                        </button>
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <p className="text-xs font-black text-slate-500 uppercase tracking-wider">Adjustment</p>
                            <p className="text-sm font-bold text-slate-900 dark:text-white">To Customer Ledger</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xl font-black text-green-600 dark:text-green-400">
                              +{formatCurrency(Math.max(0, totalRefundAmount - cashRefundAmount))}
                            </p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase">Customer Credit</p>
                          </div>
                        </div>
                      </div>
                    )
                  ) : null}

                  {/* Action */}
                  <button
                    onClick={confirmRefund}
                    disabled={totalRefundAmount > Number(cashRefundAmount) && !selectedOrder.customerId}
                    className={`w-full py-3 rounded-xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 transition-all ${totalRefundAmount > Number(cashRefundAmount) && !selectedOrder.customerId
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-50'
                      : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:shadow-xl hover:-translate-y-0.5 active:scale-95'
                      }`}
                  >
                    Confirm Refund
                    <ArrowRight className="w-5 h-5" />
                  </button>

                  <p className="text-[10px] text-center font-bold text-slate-400 px-4">
                    Confirming will process the inventory refund and update the customer ledger automatically.
                  </p>
                </div>
              </div>
            </div>,
            document.body
          )}

          {selectedOrder && createPortal(
            <div
              className="fixed inset-0 bg-white dark:bg-slate-800 flex flex-col z-[1000000] overflow-hidden m-0 p-0 top-0 left-0"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-slate-900 to-slate-900 dark:from-slate-800 dark:to-slate-900 px-4 sm:px-6 py-3 flex items-center justify-between border-b border-white/10 dark:border-slate-700 flex-shrink-0">
                <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                  <RotateCcw className="h-5 w-5 sm:h-6 sm:w-6" />
                  {getTranslation('refundItemsTitle', state.currentLanguage)}
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
                <div className="bg-gradient-to-r from-gray-50 to-slate-50 dark:from-slate-700/50 dark:to-slate-800/50 rounded-xl p-4 mb-4 border border-gray-200 dark:border-slate-700">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                    <div>
                      <p className="text-xs text-gray-600 dark:text-slate-400 font-medium mb-1">{getTranslation('orderId', state.currentLanguage) || 'Order ID'}</p>
                      <p className="font-bold text-gray-900 dark:text-white font-mono">{(selectedOrder.id || selectedOrder._id || '').toString().slice(-8)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 dark:text-slate-400 font-medium mb-1">{getTranslation('customer', state.currentLanguage) || 'Customer'}</p>
                      <p className="font-bold text-gray-900 dark:text-white">{selectedOrder.customerName || getTranslation('walkInCustomer', state.currentLanguage)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 dark:text-slate-400 font-medium mb-1">{getTranslation('date', state.currentLanguage)}</p>
                      <p className="font-semibold text-gray-900 dark:text-white text-xs sm:text-sm">{formatDateTime(selectedOrder.createdAt || selectedOrder.date)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 dark:text-slate-400 font-medium mb-1">{getTranslation('totalAmount', state.currentLanguage)}</p>
                      <p className="font-bold text-slate-900 dark:text-slate-100 text-lg" title={formatCurrency(selectedOrder.totalAmount || selectedOrder.total)}>
                        {formatCurrencySmart(selectedOrder.totalAmount || selectedOrder.total, state.currencyFormat)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Refund Items - Mobile Card View / Desktop Table View */}
                {refundItems.length > 0 && (
                  <div className="mb-4">
                    {/* Desktop Table View */}
                    <div className="hidden sm:block overflow-x-auto -mx-4 sm:mx-0">
                      <div className="inline-block min-w-full align-middle">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                          <thead className="bg-gradient-to-r from-blue-50 to-slate-50 dark:from-slate-700/50 dark:to-slate-800/50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('productHeaderCap', state.currentLanguage)}</th>
                              <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('orderedHeaderCap', state.currentLanguage)}</th>
                              <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('refundedHeaderCap', state.currentLanguage)}</th>
                              <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('availableHeaderCap', state.currentLanguage)}</th>
                              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('batchHeaderCap', state.currentLanguage)}</th>
                              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('rateHeaderCap', state.currentLanguage)}</th>
                              <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('refundQtyHeaderCap', state.currentLanguage)}</th>
                              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('totalHeaderCap', state.currentLanguage)}</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                            {refundItems.map((item, index) => (
                              <tr
                                key={item.productId}
                                className={item.refundedQty > 0 ? 'bg-yellow-50/50 dark:bg-yellow-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'}
                              >
                                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{item.name}</td>
                                <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 text-center">
                                  {item.orderedQty} <span className="text-gray-500 dark:text-slate-500 text-xs">{item.unit}</span>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 text-center">
                                  {item.availableQty === item.orderedQty ? 0 : item.orderedQty - item.availableQty} <span className="text-gray-500 dark:text-slate-500 text-xs">{item.unit}</span>
                                </td>
                                <td className="px-4 py-3 text-sm font-bold text-blue-600 dark:text-blue-400 text-center">
                                  {item.availableQty} <span className="text-gray-500 dark:text-slate-500 font-normal">{item.unit}</span>
                                </td>
                                <td className="px-4 py-3">
                                  {item.batches && item.batches.length > 0 ? (
                                    item.batches.length > 1 ? (
                                      <div className="relative w-full min-w-[120px]">
                                        <select
                                          value={item.selectedBatchId}
                                          onChange={(e) => handleBatchChange(item.productId, e.target.value)}
                                          className="w-full pl-3 pr-8 py-1.5 text-xs font-semibold rounded-xl border-2 border-indigo-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:border-indigo-500 focus:outline-none appearance-none cursor-pointer"
                                        >
                                          <option value="">{getTranslation('selectBatchPlaceholder', state.currentLanguage)}</option>
                                          {item.batches.map(batch => (
                                            <option key={batch._id || batch.id} value={batch._id || batch.id}>
                                              {batch.batchNumber || 'No #'} ({batch.quantity || 0}) {batch.expiry ? `- Exp: ${formatDate(batch.expiry)}` : ''}
                                            </option>
                                          ))}
                                        </select>
                                        <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none">
                                          <ChevronDown className="h-4 w-4 text-gray-400" />
                                        </div>
                                      </div>
                                    ) : (
                                      <span className="text-xs font-bold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded">
                                        {item.batches[0].batchNumber || 'Batch #1'}
                                      </span>
                                    )
                                  ) : (
                                    <span className="text-xs text-gray-400 dark:text-slate-500 italic">No batches</span>
                                  )
                                  }
                                  {item.isDProduct && (
                                    <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                                      DIRECT
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-right" title={formatCurrency(item.rate)}>
                                  {formatCurrencySmart(item.rate, state.currencyFormat)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={item.refundQty || ''}
                                    onChange={(e) => {
                                      const value = e.target.value.replace(/[^0-9.]/g, '');
                                      handleRefundQtyChange(item.productId, value);
                                    }}
                                    disabled={item.availableQty === 0 || (!item.isDProduct && !(item.batches && item.batches.length > 0))}
                                    className={`w-20 px-2 py-1.5 text-sm border-2 rounded-lg text-center font-semibold ${item.availableQty === 0 || (!item.isDProduct && !(item.batches && item.batches.length > 0))
                                      ? 'bg-gray-100 dark:bg-slate-700 cursor-not-allowed text-gray-400 dark:text-slate-500 border-gray-200 dark:border-slate-600'
                                      : 'border-blue-300 dark:border-blue-500/50 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-slate-900/30 text-gray-900 dark:text-white bg-white dark:bg-slate-700'
                                      }`}
                                  />
                                </td>
                                <td className="px-4 py-3 text-sm font-bold text-blue-600 dark:text-blue-400 text-right whitespace-nowrap overflow-x-auto scrollbar-hide max-w-[120px]" title={formatCurrency(item.refundQty * item.rate)}>
                                  {formatCurrencySmart(item.refundQty * item.rate, state.currencyFormat)}
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
                          className={`bg-white dark:bg-slate-800 border-2 rounded-xl p-4 ${item.refundedQty > 0 ? 'border-yellow-300 dark:border-yellow-600 bg-yellow-50/30 dark:bg-yellow-900/20' : 'border-gray-200 dark:border-slate-700'
                            }`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <h4 className="font-bold text-gray-900 dark:text-white text-sm flex-1">{item.name}</h4>
                            <span className="text-xs font-semibold text-slate-900 dark:text-blue-400 bg-blue-50 dark:bg-slate-700/50 px-2 py-1 rounded" title={formatCurrency(item.rate)}>
                              {formatCurrencySmart(item.rate, state.currencyFormat)}/{item.unit}
                            </span>
                          </div>
                          {item.isDProduct && (
                            <div className="mb-2">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                                DIRECT PRODUCT
                              </span>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                            <div>
                              <p className="text-gray-500 dark:text-slate-400">{getTranslation('orderedLabel', state.currentLanguage)}</p>
                              <p className="font-semibold text-gray-900 dark:text-white">{item.orderedQty} {item.unit}</p>
                            </div>
                            <div>
                              <p className="text-gray-500 dark:text-slate-400">{getTranslation('refundedLabel', state.currentLanguage)}</p>
                              <p className="font-semibold text-gray-900 dark:text-white">{item.availableQty === item.orderedQty ? 0 : item.orderedQty - item.availableQty} {item.unit}</p>
                            </div>
                            <div>
                              <p className="text-gray-500 dark:text-slate-400">{getTranslation('availableLabel', state.currentLanguage)}</p>
                              <p className="font-bold text-slate-900 dark:text-slate-100">{item.availableQty} {item.unit}</p>
                            </div>
                            <div>
                              <p className="text-gray-500 dark:text-slate-400">{getTranslation('lineTotalLabel', state.currentLanguage)}</p>
                              <p className="font-bold text-slate-900 dark:text-slate-100" title={formatCurrency(item.refundQty * item.rate)}>{formatCurrencySmart(item.refundQty * item.rate, state.currencyFormat)}</p>
                            </div>
                          </div>

                          <div className="space-y-3">
                            {!item.isDProduct && item.batches && item.batches.length > 0 && (
                              <div>
                                <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">{getTranslation('targetBatchLabel', state.currentLanguage)}</label>
                                {item.batches.length > 1 ? (
                                  <div className="relative">
                                    <select
                                      value={item.selectedBatchId}
                                      onChange={(e) => handleBatchChange(item.productId, e.target.value)}
                                      className="w-full pl-3 pr-10 py-2 text-sm border-2 rounded-xl font-semibold border-indigo-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white appearance-none cursor-pointer"
                                    >
                                      <option value="">Select Batch</option>
                                      {item.batches.map(batch => (
                                        <option key={batch._id || batch.id} value={batch._id || batch.id}>
                                          {batch.batchNumber || 'Batch'} ({batch.quantity || 0})
                                        </option>
                                      ))}
                                    </select>
                                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                      <ChevronDown className="h-5 w-5 text-gray-400" />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="px-3 py-2 text-sm bg-gray-50 dark:bg-slate-700/50 border-2 border-gray-100 dark:border-slate-600 rounded-lg text-gray-700 dark:text-slate-300 font-bold">
                                    {item.batches[0].batchNumber || 'Batch #1'}
                                  </div>
                                )}
                              </div>
                            )}

                            <div>
                              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">{getTranslation('refundQuantityLabel', state.currentLanguage)}</label>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={item.refundQty || ''}
                                onChange={(e) => {
                                  const value = e.target.value.replace(/[^0-9.]/g, '');
                                  handleRefundQtyChange(item.productId, value);
                                }}
                                disabled={item.availableQty === 0 || (!item.isDProduct && !(item.batches && item.batches.length > 0))}
                                className={`w-full px-3 py-2 text-sm border-2 rounded-lg text-center font-semibold ${item.availableQty === 0 || (!item.isDProduct && !(item.batches && item.batches.length > 0))
                                  ? 'bg-gray-100 dark:bg-slate-700 cursor-not-allowed text-gray-400 dark:text-slate-500 border-gray-200 dark:border-slate-600'
                                  : 'border-blue-300 dark:border-blue-500/50 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-slate-900/30 text-gray-900 dark:text-white bg-white dark:bg-slate-700'
                                  }`}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Total and Reason */}
                    <div className="mt-4 sm:mt-6 space-y-4">
                      <div className="flex justify-end">
                        <div className="bg-gradient-to-r from-slate-900 to-slate-900 dark:from-slate-800 dark:to-slate-900 rounded-xl p-4 sm:p-6 shadow-lg w-full sm:w-auto">
                          <p className="text-xs sm:text-sm text-blue-100 dark:text-slate-300 mb-1 font-medium">{getTranslation('totalRefundAmountLabel', state.currentLanguage)}</p>
                          <p className="text-2xl sm:text-3xl font-bold text-rose-400 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(totalRefundAmount)}>
                            {formatCurrencySmart(totalRefundAmount, state.currencyFormat)}
                          </p>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                          {getTranslation('refundReasonOptional', state.currentLanguage)}
                        </label>
                        <textarea
                          value={refundReason}
                          onChange={(e) => setRefundReason(e.target.value)}
                          placeholder="Enter reason for refund..."
                          rows={3}
                          className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-slate-900/30 focus:border-blue-500 dark:focus:border-blue-400 transition-all text-sm sm:text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500"
                        />
                      </div>

                      <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
                        <button
                          onClick={() => {
                            setSelectedOrder(null);
                            setRefundItems([]);
                            setRefundReason('');
                          }}
                          className="w-full sm:w-auto px-6 py-3 rounded-xl font-bold transition-all bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-600 active:scale-95"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleProcessRefund}
                          disabled={isProcessing || totalRefundAmount === 0 || isPlanExpired(state)}
                          className={`w-full sm:w-auto px-6 py-3 rounded-xl font-bold transition-all ${isProcessing || totalRefundAmount === 0 || isPlanExpired(state)
                            ? 'bg-gray-300 dark:bg-slate-700 text-gray-500 dark:text-slate-500 cursor-not-allowed'
                            : 'bg-gradient-to-r from-slate-900 to-slate-900 dark:from-slate-800 dark:to-slate-900 text-white shadow-lg hover:shadow-xl active:scale-95'
                            }`}
                        >
                          {isProcessing ? (
                            <span className="flex items-center justify-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                              Processing...
                            </span>
                          ) : (
                            isPlanExpired(state) ? 'Plan Expired' : getTranslation('processRefund', state.currentLanguage)
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {refundItems.length === 0 && (
                  <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400 mb-3"></div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 font-medium">{getTranslation('loadingRefundItems', state.currentLanguage)}</p>
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {/* All Refunds Tab */}
      {activeTab === 'list' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Filters */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 sm:p-6 border border-gray-100 dark:border-slate-700">
            <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Filter className="h-5 w-5 text-slate-900 dark:text-slate-100" />
              {getTranslation('filtersTitle', state.currentLanguage)}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">{getTranslation('fromDate', state.currentLanguage)}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Calendar className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="date"
                    value={refundFilters.from}
                    onChange={(e) => setRefundFilters(prev => ({ ...prev, from: e.target.value }))}
                    className="w-full pl-10 pr-3 sm:px-10 py-2 text-sm rounded-xl border-2 border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-slate-900/30 focus:border-indigo-500 dark:focus:border-indigo-400 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">{getTranslation('toDate', state.currentLanguage)}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <CalendarRange className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="date"
                    value={refundFilters.to}
                    onChange={(e) => setRefundFilters(prev => ({ ...prev, to: e.target.value }))}
                    className="w-full pl-10 pr-3 sm:px-10 py-2 text-sm rounded-xl border-2 border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-slate-900/30 focus:border-indigo-500 dark:focus:border-indigo-400 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">{getTranslation('customerMobile', state.currentLanguage) || 'Customer Mobile'}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Phone className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={refundFilters.customerMobile}
                    onChange={(e) => setRefundFilters(prev => ({ ...prev, customerMobile: e.target.value }))}
                    placeholder={getTranslation('enterMobileNumber', state.currentLanguage) || "Search by mobile"}
                    className="w-full pl-10 pr-3 sm:pl-10 py-2 text-sm rounded-xl border-2 border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-slate-900/30 focus:border-indigo-500 dark:focus:border-indigo-400 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">{getTranslation('invoiceNumber', state.currentLanguage) || 'Invoice Number'}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Hash className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={refundFilters.orderId}
                    onChange={(e) => setRefundFilters(prev => ({ ...prev, orderId: e.target.value }))}
                    placeholder={getTranslation('enterInvoiceNumber', state.currentLanguage) || "Search by invoice number"}
                    className="w-full pl-10 pr-3 sm:pl-10 py-2 text-sm rounded-xl border-2 border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-slate-900/30 focus:border-indigo-500 dark:focus:border-indigo-400 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Refunds Table */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-gray-100 dark:border-slate-700 overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-slate-700 bg-gradient-to-r from-blue-50 to-slate-50 dark:from-slate-700/50 dark:to-slate-800/50">
              <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-slate-900 dark:text-slate-100" />
                {getTranslation('allRefundsTab', state.currentLanguage)} <span className="text-slate-900 dark:text-slate-100">({allRefunds.length})</span>
              </h2>
            </div>

            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gradient-to-r from-blue-50 to-slate-50 dark:from-slate-700/50 dark:to-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('refundId', state.currentLanguage)}</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('invoiceNumber', state.currentLanguage) || 'Invoice #'}</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('customer', state.currentLanguage) || 'Customer'}</th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('amount', state.currentLanguage) || 'Amount'}</th>
                    <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('items', state.currentLanguage) || 'Items'}</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">{getTranslation('date', state.currentLanguage)}</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                  {paginatedRefunds.length > 0 ? (
                    paginatedRefunds.map((refund) => (
                      <tr key={refund.id} className="hover:bg-indigo-50/30 dark:hover:bg-slate-700/50 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white font-mono">
                          {(refund.refundId || refund.id || '').toString().slice(-8)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 font-bold">
                          {refund.invoiceNumber}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          <div className="font-medium text-gray-900 dark:text-white">{refund.customerName || '-'}</div>
                          {refund.customerMobile && (
                            <div className="text-xs text-gray-500 dark:text-slate-500">{refund.customerMobile}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-rose-600 text-right" title={formatCurrency(refund.totalRefundAmount)}>
                          {formatCurrencySmart(refund.totalRefundAmount, state.currencyFormat)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 text-center">
                          <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-lg font-semibold text-xs">
                            {refund.itemsCount || 0}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          {formatDateTime(refund.refundDate || refund.createdAt)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="px-4 py-12 text-center">
                        <RotateCcw className="h-12 w-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                        <p className="text-gray-600 dark:text-slate-400 font-medium">{getTranslation('noRefundsFound', state.currentLanguage)}</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="sm:hidden divide-y divide-gray-200 dark:divide-slate-700">
              {paginatedRefunds.length > 0 ? (
                paginatedRefunds.map((refund) => (
                  <div key={refund.id} className="p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold text-gray-400 mb-0.5 tracking-wider">Refund ID</span>
                            <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded">
                              {(refund.refundId || refund.id || '').toString().slice(-8)}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold text-gray-400 mb-0.5 tracking-wider">Invoice #</span>
                            <span className="text-xs font-bold text-gray-600 dark:text-slate-400 bg-gray-50 dark:bg-slate-700 px-2 py-1 rounded">
                              {refund.invoiceNumber}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{refund.customerName || '-'}</p>
                        {refund.customerMobile && (
                          <p className="text-xs text-gray-500 dark:text-slate-500">{refund.customerMobile}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-rose-600" title={formatCurrency(refund.totalRefundAmount)}>{formatCurrencySmart(refund.totalRefundAmount, state.currencyFormat)}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-500">{refund.itemsCount || 0} items</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-600 dark:text-slate-400 mt-2 pt-2 border-t border-gray-100 dark:border-slate-700">
                      <span>{formatDate(refund.refundDate || refund.createdAt)}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{refund.refundedBy || '-'}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-12 text-center">
                  <RotateCcw className="h-12 w-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                  <p className="text-gray-600 dark:text-slate-400 font-medium">{getTranslation('noRefundsFound', state.currentLanguage)}</p>
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 sm:px-6 py-4 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="text-xs sm:text-sm text-gray-700 dark:text-slate-300 font-medium">
                    {getTranslation('showingRecords', state.currentLanguage)
                      .replace('{start}', startIndex + 1)
                      .replace('{end}', Math.min(startIndex + itemsPerPage, allRefunds.length))
                      .replace('{total}', allRefunds.length)}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border-2 border-gray-300 dark:border-slate-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-slate-600 hover:border-indigo-300 dark:hover:border-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border-2 border-gray-300 dark:border-slate-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-slate-600 hover:border-indigo-300 dark:hover:border-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                            className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${currentPage === page
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
      {showSuccessModal && successData && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[1000001] p-4">
          <div className="bg-white dark:bg-black rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border dark:border-white/10 animate-slideUp flex flex-col">
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 p-6 text-center flex-shrink-0">
              <CheckCircle className="h-16 w-16 text-white mx-auto mb-3" />
              <h3 className="text-xl sm:text-2xl font-bold text-white">{getTranslation('refundProcessedSuccess', state.currentLanguage)}</h3>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto max-h-[45vh] scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
              <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 dark:text-slate-400 font-medium">{getTranslation('refundId', state.currentLanguage)}</span>
                  <span className="text-sm font-mono font-bold text-blue-600 bg-blue-50 dark:bg-slate-700 dark:text-blue-400 px-3 py-1 rounded-lg">
                    {(successData.refundId || '').toString().slice(-8)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 dark:text-slate-400 font-medium">Refund Amount</span>
                  <span className="text-xl font-black text-slate-900 dark:text-slate-100">
                    {formatCurrency(successData.totalRefundAmount)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-t border-slate-200 dark:border-slate-800 mt-2">
                  <span className="text-xs text-gray-500 font-medium">Cash Refunded</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {formatCurrency(successData.cashRefunded)}
                  </span>
                </div>
                {successData.creditAmount > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500 font-medium">Credit Added</span>
                    <span className="text-sm font-bold text-green-600">
                      +{formatCurrency(successData.creditAmount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 border-t border-slate-200 dark:border-slate-800 mt-2">
                  <span className="text-sm text-gray-600 dark:text-slate-400 font-medium">Customer</span>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{successData.customerName}</p>
                    {successData.customerMobile && (
                      <p className="text-[10px] text-slate-500 font-mono italic">{successData.customerMobile}</p>
                    )}
                  </div>
                </div>

                {successData.isRegistered && (
                  <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-3 space-y-2 border border-slate-100 dark:border-slate-800">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-500 font-medium tracking-tight uppercase">Previous Due</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        {formatCurrency(successData.previousDue)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center bg-emerald-50/50 dark:bg-emerald-900/10 p-2 rounded-lg -mx-1">
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-black uppercase tracking-wider">New Balance</span>
                      <span className="text-sm font-black text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(successData.currentDue)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t border-slate-200 dark:border-slate-800">
                  <span className="text-sm text-gray-600 dark:text-slate-400 font-medium">{getTranslation('itemsRefunded', state.currentLanguage)}</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 px-3 py-1 rounded-lg">
                    {successData.itemsCount || 0}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-6 pt-0 flex-shrink-0">
              <button
                onClick={() => {
                  setSuccessData(null);
                  setShowSuccessModal(false);
                }}
                className="w-full px-6 py-3 bg-gradient-to-r from-slate-900 to-slate-900 text-white rounded-xl font-bold hover:shadow-lg active:scale-95 transition-all text-sm uppercase tracking-widest"
              >
                {getTranslation('close', state.currentLanguage)}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add Customer Modal */}
      {showAddCustomerModal && createPortal(
        <div className="fixed inset-0 z-[2000001] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-all">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center flex-shrink-0">
              <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Register Customer</h3>
              <button
                onClick={() => {
                  setShowAddCustomerModal(false);
                  setCustomerSearchTerm('');
                }}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-white/5">
              <button
                onClick={() => setCustomerModalTab('search')}
                className={`flex-1 py-4 text-[10px] font-black uppercase tracking-widest transition-all ${customerModalTab === 'search'
                  ? 'text-slate-900 dark:text-white bg-white dark:bg-slate-900 border-b-2 border-slate-900 dark:border-white'
                  : 'text-slate-400 hover:text-slate-600'
                  }`}
              >
                Find Existing
              </button>
              <button
                onClick={() => setCustomerModalTab('create')}
                className={`flex-1 py-4 text-[10px] font-black uppercase tracking-widest transition-all ${customerModalTab === 'create'
                  ? 'text-slate-900 dark:text-white bg-white dark:bg-slate-900 border-b-2 border-slate-900 dark:border-white'
                  : 'text-slate-400 hover:text-slate-600'
                  }`}
              >
                Register New
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto max-h-[50vh] scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
              {customerModalTab === 'search' ? (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search by name or mobile..."
                      value={customerSearchTerm}
                      onChange={(e) => setCustomerSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:border-slate-900 dark:focus:border-white transition-all font-bold"
                    />
                  </div>

                  <div className="space-y-2">
                    {filteredExistingCustomers.length > 0 ? (
                      filteredExistingCustomers.map(customer => (
                        <button
                          key={customer.id || customer._id}
                          onClick={() => handleSelectExistingCustomer(customer)}
                          className="w-full p-4 flex items-center justify-between bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-slate-900 dark:hover:border-white transition-all group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                              <Users className="w-5 h-5 text-slate-500" />
                            </div>
                            <div className="text-left">
                              <p className="font-bold text-slate-900 dark:text-white">{customer.name}</p>
                              <p className="text-xs text-slate-500 font-mono">{customer.mobileNumber}</p>
                            </div>
                          </div>
                          <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors" />
                        </button>
                      ))
                    ) : customerSearchTerm.trim() !== '' ? (
                      <div className="text-center py-8">
                        <Users className="w-12 h-12 text-slate-200 dark:text-slate-700 mx-auto mb-2" />
                        <p className="text-sm font-bold text-slate-400">No matching customers found</p>
                        <button
                          onClick={() => {
                            setNewCustomerData({
                              name: customerSearchTerm,
                              mobile: /^\d+$/.test(customerSearchTerm) ? customerSearchTerm : ''
                            });
                            setCustomerModalTab('create');
                          }}
                          className="mt-4 text-xs font-black text-slate-900 dark:text-white underline underline-offset-4 uppercase tracking-widest"
                        >
                          Register as new customer
                        </button>
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <Search className="w-12 h-12 text-slate-200 dark:text-slate-700 mx-auto mb-2" />
                        <p className="text-sm font-bold text-slate-400 italic">Type to search existing customers</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Full Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Rahul Sharma"
                      value={newCustomerData.name}
                      onChange={e => setNewCustomerData(p => ({ ...p, name: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:border-slate-900 dark:focus:border-white transition-all font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Mobile Number</label>
                    <input
                      type="tel"
                      placeholder="10 digit number"
                      maxLength={10}
                      value={newCustomerData.mobile}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        setNewCustomerData(p => ({ ...p, mobile: val }));
                      }}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:border-slate-900 dark:focus:border-white transition-all font-bold font-mono"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={handleCreateCustomer}
                      disabled={isCreatingCustomer || !newCustomerData.name || !newCustomerData.mobile}
                      className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-4 rounded-xl font-black uppercase tracking-widest text-sm hover:shadow-xl hover:-translate-y-0.5 active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      {isCreatingCustomer ? <span className="animate-pulse">Registering...</span> : (
                        <>
                          <UserPlus className="w-5 h-5" />
                          Save & Link to Order
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Refunds;

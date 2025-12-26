import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { useToast } from '../../hooks/useToast';
import { apiRequest } from '../../utils/api';
import { PageSkeleton, SkeletonStats } from '../UI/SkeletonLoader';
import {
  Users,
  Package,
  Receipt,
  TrendingUp,
  AlertTriangle,
  Clock,
  Wallet,
  ShoppingCart,
  Truck,
  BarChart3,
  Calendar,
  CreditCard,
  Activity,
  Zap,
  Target,
  Award,
  X,
  ArrowRight,
  Download,
  CheckCircle,
  ShieldCheck,
  BarChart2,
  LayoutGrid,
  Share2,
  TrendingDown,
  AlertCircle,
  ChevronRight
} from 'lucide-react';
import { sanitizeMobileNumber } from '../../utils/validation';
import { getPlanLimits, isModuleUnlocked, getUpgradeMessage } from '../../utils/planUtils';
import { getSellerIdFromAuth } from '../../utils/api';
import { getAllItems, addItem, STORES } from '../../utils/indexedDB';
import { getPathForView } from '../../utils/navigation';
import SellerRegistrationModal from './SellerRegistrationModal';

// Staff data loading helper
const loadStaffData = async (dispatch, permissions) => {
  try {
    // Load products data immediately for staff
    const products = await STORES.products.getAll();

    if (products && products.length > 0) {
      dispatch({
        type: ActionTypes.SET_PRODUCTS,
        payload: products.filter(p => !p.isDeleted)
      });
    }

    // Load orders data if staff has permission
    if (permissions?.orders?.read !== false) {
      const orders = await STORES.orders.getAll();

      if (orders && orders.length > 0) {
        dispatch({
          type: ActionTypes.SET_ORDERS,
          payload: orders.filter(o => !o.isDeleted)
        });
      }
    }

    // Load customers data if staff has permission
    if (permissions?.customers?.read !== false) {
      const customers = await STORES.customers.getAll();

      if (customers && customers.length > 0) {
        dispatch({
          type: ActionTypes.SET_CUSTOMERS,
          payload: customers.filter(c => !c.isDeleted)
        });
      }
    }

  } catch (error) {

  }
};

const parseExpiryDate = (rawValue) => {
  if (!rawValue) {
    return null;
  }
  const parsedDate = new Date(rawValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const calculateExpiryCountdown = (expiryDate) => {
  if (!expiryDate) {
    return null;
  }
  const diff = expiryDate.getTime() - Date.now();
  if (diff <= 0) {
    return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const totalSeconds = Math.floor(diff / 1000);
  return {
    expired: false,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
};

const formatCountdownValue = (value) => String(value ?? 0).padStart(2, '0');

const STAT_THEMES = {
  primary: { background: 'rgba(47, 60, 126, 0.12)', color: '#2F3C7E', border: 'rgba(47, 60, 126, 0.28)' },
  teal: { background: 'rgba(45, 212, 191, 0.14)', color: '#0F766E', border: 'rgba(15, 118, 110, 0.24)' },
  amber: { background: 'rgba(244, 162, 89, 0.16)', color: '#C2410C', border: 'rgba(194, 65, 12, 0.24)' },
  rose: { background: 'rgba(251, 113, 133, 0.16)', color: '#BE123C', border: 'rgba(190, 18, 60, 0.24)' },
  sky: { background: 'rgba(56, 189, 248, 0.18)', color: '#0369A1', border: 'rgba(3, 105, 161, 0.24)' },
  emerald: { background: 'rgba(74, 222, 128, 0.14)', color: '#047857', border: 'rgba(4, 120, 87, 0.22)' },
  purple: { background: 'rgba(196, 181, 253, 0.2)', color: '#6D28D9', border: 'rgba(109, 40, 217, 0.24)' },
  slate: { background: 'rgba(148, 163, 184, 0.16)', color: '#1E293B', border: 'rgba(30, 41, 59, 0.2)' }
};

const getStatTheme = (key) => STAT_THEMES[key] || STAT_THEMES.slate;

const Dashboard = () => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState('today');
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const expenses = state.expenses || []; // Use global expenses state
  const [isLoading, setIsLoading] = useState(() => {
    // Avoid loading flicker if data is already in state
    const hasData = state.products?.length > 0 || state.customers?.length > 0 || state.orders?.length > 0;
    return !hasData && state.dataFreshness === 'loading';
  });

  // Manage loading state
  useEffect(() => {
    // Set loading to false after data is available or after a timeout
    const hasData = state.products && state.customers && state.orders && state.transactions;
    if (hasData) {
      setIsLoading(false);
    } else {
      // Fallback timeout to prevent infinite loading
      const timer = setTimeout(() => setIsLoading(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [state.products, state.customers, state.orders, state.transactions]);

  // Show registration modal if profile is not completed
  // Check if profile is completed - either explicitly marked or has required fields filled
  const hasProfileCompletedFlag = !!(state.currentUser?.profileCompleted === true || state.currentUser?.profileCompleted === 'true');
  const hasRequiredProfileFields = !!(state.currentUser?.shopName && state.currentUser?.businessType && state.currentUser?.shopAddress);

  // More comprehensive check - also consider phone number and other fields
  const hasExtendedProfileFields = !!(
    state.currentUser?.phoneNumber ||
    state.currentUser?.city ||
    state.currentUser?.state ||
    state.currentUser?.pincode ||
    state.currentUser?.upiId
  );

  const isProfileCompleted = hasProfileCompletedFlag || hasRequiredProfileFields || hasExtendedProfileFields;

  // Automatically update profileCompleted flag if user has filled profile but flag is not set
  useEffect(() => {
    const updateProfileCompletedFlag = async () => {
      // Check if user should have their profile marked as completed
      const shouldBeCompleted = hasRequiredProfileFields || hasExtendedProfileFields;
      const isCurrentlyCompleted = state.currentUser?.profileCompleted === true;

      if (!isCurrentlyCompleted && shouldBeCompleted) {
        try {

          const response = await apiRequest('/auth/seller/profile', {
            method: 'PUT',
            body: {
              // Send current profile data to ensure profileCompleted gets set
              shopName: state.currentUser?.shopName || '',
              businessType: state.currentUser?.businessType || '',
              shopAddress: state.currentUser?.shopAddress || '',
              phoneNumber: state.currentUser?.phoneNumber || '',
              city: state.currentUser?.city || '',
              state: state.currentUser?.state || '',
              pincode: state.currentUser?.pincode || '',
              upiId: state.currentUser?.upiId || '',
              gstNumber: state.currentUser?.gstNumber || '',
              gender: state.currentUser?.gender || ''
            }
          });

          if (response.success) {

            // The response should include the updated seller data with profileCompleted: true
            if (response.data?.seller) {
              dispatch({
                type: ActionTypes.UPDATE_USER,
                payload: {
                  ...state.currentUser,
                  ...response.data.seller,
                  profileCompleted: true
                }
              });
            }
          } else {

          }
        } catch (error) {

        }
      }
    };

    // Run when user data changes or when profile completion status changes
    if (state.currentUser) {
      updateProfileCompletedFlag();
    }
  }, [state.currentUser?._id, hasRequiredProfileFields, hasExtendedProfileFields]); // Changed dependencies to be more specific

  // Show registration modal if profile is NOT completed
  const showRegistrationModal = !isProfileCompleted;

  // Additional safeguard: never show modal if profileCompleted flag is explicitly true
  const forceHideModal = state.currentUser?.profileCompleted === true || state.currentUser?.profileCompleted === 'true';
  const finalShowRegistrationModal = showRegistrationModal && !forceHideModal;

  // Debug logging for profile completion status (commented out to prevent spam)
  // //('🔍 Dashboard profile completion check:', {
  //   isStaffUser,
  //   profileCompleted: state.currentUser?.profileCompleted,
  //   hasProfileCompletedFlag,
  //   hasRequiredProfileFields,
  //   hasExtendedProfileFields,
  //   isProfileCompleted,
  //   showRegistrationModal,
  //   finalShowRegistrationModal,
  //   forceHideModal,
  //   requiredFields: {
  //     shopName: state.currentUser?.shopName,
  //     businessType: state.currentUser?.businessType,
  //     shopAddress: state.currentUser?.shopAddress
  //   },
  //   extendedFields: {
  //     phoneNumber: state.currentUser?.phoneNumber,
  //     city: state.currentUser?.city,
  //     state: state.currentUser?.state,
  //     pincode: state.currentUser?.pincode,
  //     upiId: state.currentUser?.upiId
  //   }
  // });

  // If profile should be completed but modal is showing, force refresh user data
  useEffect(() => {
    const checkAndFixProfileCompletion = async () => {
      if (state.currentUser && finalShowRegistrationModal) {

        // First, check if the profile is actually completed on the server
        try {
          const response = await apiRequest('/auth/seller');
          if (response.success && response.data?.seller) {
            const serverProfileCompleted = response.data.seller.profileCompleted === true;

            if (serverProfileCompleted) {

              dispatch({
                type: ActionTypes.UPDATE_USER,
                payload: {
                  ...state.currentUser,
                  ...response.data.seller,
                  profileCompleted: true
                }
              });
              return;
            }
          }
        } catch (error) {

        }

        // If server doesn't say it's completed, check if we should mark it as completed
        const shouldBeCompleted = hasRequiredProfileFields || hasExtendedProfileFields;
        if (shouldBeCompleted) {

          // The auto-update useEffect should handle this
        } else {

        }
      }
    };

    checkAndFixProfileCompletion();
  }, [state.currentUser?._id, finalShowRegistrationModal, hasRequiredProfileFields, hasExtendedProfileFields]);

  const subscriptionExpiryRaw =
    state.subscription?.expiresAt ||
    state.currentPlanDetails?.expiresAt ||
    state.currentPlanDetails?.expiryDate ||
    null;

  const subscriptionExpiryDate = useMemo(
    () => parseExpiryDate(subscriptionExpiryRaw),
    [subscriptionExpiryRaw]
  );

  const [expiryCountdown, setExpiryCountdown] = useState(() =>
    calculateExpiryCountdown(subscriptionExpiryDate)
  );

  const daysRemaining = subscriptionExpiryDate
    ? Math.max(
      0,
      Math.ceil(
        (subscriptionExpiryDate.getTime() - Date.now()) /
        (1000 * 60 * 60 * 24)
      )
    )
    : 0;

  const planNameLabel =
    state.currentPlanDetails?.planName ||
    state.subscription?.planName ||
    (state.currentPlan
      ? state.currentPlan.charAt(0).toUpperCase() + state.currentPlan.slice(1)
      : null);

  const formattedExpiryDate = subscriptionExpiryDate
    ? subscriptionExpiryDate.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : null;

  const planExpiryStatusText = formattedExpiryDate
    ? (planNameLabel
      ? `${planNameLabel} ${daysRemaining === 0 ? 'expired on' : 'expires on'} ${formattedExpiryDate}`
      : `Plan ${daysRemaining === 0 ? 'expired on' : 'expires on'} ${formattedExpiryDate}`)
    : (planNameLabel
      ? `${planNameLabel} expiry date not available`
      : 'Plan expiry date not available');

  useEffect(() => {
    let isActive = true;

    const refreshOrdersFromIndexedDB = async () => {
      try {
        const indexedDBOrders = await getAllItems(STORES.orders).catch(() => []);
        if (!isActive) return;

        const normalizedOrders = (indexedDBOrders || []).filter(order => order && order.isDeleted !== true);
        const currentOrders = (state.orders || []).filter(order => order && order.isDeleted !== true);

        const currentIds = new Map(
          currentOrders.map(order => {
            const key = (order.id || order._id || order.createdAt || '').toString();
            return [key, order];
          })
        );

        let hasChanges = normalizedOrders.length !== currentOrders.length;

        if (!hasChanges) {
          for (const incoming of normalizedOrders) {
            const key = (incoming.id || incoming._id || incoming.createdAt || '').toString();
            const existing = currentIds.get(key);
            if (!existing) {
              hasChanges = true;
              break;
            }

            const trackedFields = ['totalAmount', 'subtotal', 'discountPercent', 'taxPercent', 'updatedAt', 'isSynced'];
            const mismatch = trackedFields.some(field => {
              const incomingValue = incoming[field] ?? null;
              const existingValue = existing[field] ?? null;
              return JSON.stringify(incomingValue) !== JSON.stringify(existingValue);
            });

            if (mismatch) {
              hasChanges = true;
              break;
            }
          }
        }

        if (hasChanges) {
          dispatch({
            type: ActionTypes.SET_ORDERS,
            payload: normalizedOrders
          });
        }
      } catch (error) {

      }
    };

    refreshOrdersFromIndexedDB();

    const handleTabFocus = () => {
      refreshOrdersFromIndexedDB();
    };

    window.addEventListener('focus', handleTabFocus);

    return () => {
      isActive = false;
      window.removeEventListener('focus', handleTabFocus);
    };
  }, [dispatch, state.orders, state.currentUser?.sellerId]);

  // Format large numbers to be more compact
  // Format number with max 2 decimal places, respects user's currency format preference
  const formatNumber = (value) => {
    const amount = Number(value || 0) || 0;
    const useCompact = state.currencyFormat === 'compact';

    if (useCompact && Math.abs(amount) >= 1000) {
      // Use compact K/M format
      const formatted = new Intl.NumberFormat('en-US', {
        notation: 'compact',
        compactDisplay: 'short',
        maximumFractionDigits: 1
      }).format(amount);
      return `₹${formatted} `;
    }
    // Use full format
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2
    }).format(amount);
  };

  const showToast = useCallback((message, type = 'info', duration = 4000) => {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(message, type, duration);
    }
  }, []);

  const buildWhatsAppInvoiceMessage = useCallback((order, sellerState, sanitizedCustomerMobile) => {
    if (!order) return '';

    const withNull = (value) =>
      value === null || value === undefined || value === '' ? 'null' : value;

    const storeName = withNull(
      sellerState.storeName || sellerState.currentUser?.shopName || sellerState.currentUser?.username
    );
    const storeAddress = withNull(sellerState.currentUser?.shopAddress);
    const storePhoneRaw =
      sellerState.currentUser?.phoneNumber ||
      sellerState.currentUser?.mobileNumber ||
      sellerState.currentUser?.phone ||
      sellerState.currentUser?.contact ||
      '';
    const storePhoneSanitized = sanitizeMobileNumber(storePhoneRaw);
    const storePhoneDisplay = storePhoneSanitized
      ? `+ 91 ${storePhoneSanitized} `
      : withNull(storePhoneRaw);

    const invoiceDateObj = new Date(order.date || order.createdAt || order.updatedAt || Date.now());
    const invoiceDate = Number.isNaN(invoiceDateObj.getTime())
      ? 'null'
      : invoiceDateObj.toLocaleDateString('en-IN');

    const customerName = withNull(order.customerName || order.customer || 'Customer');
    const customerPhoneDisplay = sanitizedCustomerMobile
      ? `+ 91 ${sanitizedCustomerMobile} `
      : 'null';

    const subtotalRaw = Number(order.subtotal ?? order.subTotal ?? order.total ?? 0);
    const discountRaw = Number(order.discountAmount ?? order.discount ?? 0);
    const taxAmountRaw = Number(order.taxAmount ?? order.tax ?? 0);
    const totalRaw = Number(order.total ?? order.totalAmount ?? order.amount ?? subtotalRaw);

    const taxPercentSource = order.taxPercent ?? order.taxRate;
    const taxPercentRaw =
      taxPercentSource !== undefined && taxPercentSource !== null
        ? Number(taxPercentSource)
        : subtotalRaw > 0
          ? (taxAmountRaw / subtotalRaw) * 100
          : null;

    const subtotalDisplay = Number.isFinite(subtotalRaw)
      ? `₹${subtotalRaw.toFixed(2)} `
      : '₹null';
    const discountDisplay = Number.isFinite(discountRaw)
      ? `₹${discountRaw.toFixed(2)} `
      : '₹null';
    const taxAmountDisplay = Number.isFinite(taxAmountRaw)
      ? `₹${taxAmountRaw.toFixed(2)} `
      : '₹null';
    const taxPercentDisplay = Number.isFinite(taxPercentRaw)
      ? `${(taxPercentRaw % 1 === 0 ? taxPercentRaw.toFixed(0) : taxPercentRaw.toFixed(2))}% `
      : 'null';
    const totalDisplay = Number.isFinite(totalRaw)
      ? `₹${totalRaw.toFixed(2)} `
      : '₹null';

    const quantityWidth = 8;
    const rateWidth = 8;
    const amountWidth = 10;
    const headerLine = `${'Item'.padEnd(12, ' ')}${'Qty'.padStart(
      quantityWidth,
      ' '
    )
      }   ${'Rate'.padStart(rateWidth, ' ')}   ${'Amount'.padStart(amountWidth, ' ')} `;

    const items = (order.items || []).map((item, index) => {
      const qty = Number(
        item.quantity ?? item.originalQuantity?.quantity ?? item.qty ?? 0
      );
      const unit = item.unit || item.originalQuantity?.unit || '';
      const lineRate = Number(
        item.unitSellingPrice ??
        item.sellingPrice ??
        item.price ??
        (qty > 0
          ? (item.totalSellingPrice ?? item.total ?? item.amount ?? 0) / qty
          : 0)
      );
      const lineTotal = Number(
        item.totalSellingPrice ?? item.total ?? item.amount ?? lineRate * qty
      );
      const name = (item.name || item.productName || `Item ${index + 1} `).slice(0, 12).padEnd(12, ' ');
      const qtyCol = (Number.isFinite(qty) ? qty.toString() : 'null').padStart(quantityWidth, ' ');
      const rateCol = (Number.isFinite(lineRate) ? lineRate.toFixed(2) : 'null').padStart(
        rateWidth,
        ' '
      );
      const totalCol = (Number.isFinite(lineTotal) ? lineTotal.toFixed(2) : 'null').padStart(
        amountWidth,
        ' '
      );
      return `${name}${qtyCol}   ${rateCol}   ${totalCol}${unit ? ` ${unit}` : ''} `;
    });

    const itemsSection = items.length
      ? items.join('\n')
      : `${'null'.padEnd(12, ' ')}${'null'.padStart(quantityWidth, ' ')}   ${'null'.padStart(
        rateWidth,
        ' '
      )
      }   ${'null'.padStart(amountWidth, ' ')} `;

    const paymentModeLabel = withNull(getPaymentMethodLabel(order.paymentMethod));

    const divider = '--------------------------------';

    const lines = [
      '             INVOICE',
      '',
      divider,
      `Shop Name: ${storeName} `,
      `Address: ${storeAddress} `,
      `Phone: ${storePhoneDisplay} `,
      `Date: ${invoiceDate} `,
      divider,
      `Customer Name: ${customerName} `,
      `Customer Phone: ${customerPhoneDisplay} `,
      divider,
      headerLine,
      itemsSection,
      divider,
      `Subtotal: ${subtotalDisplay} `,
      `Discount: ${discountDisplay} `,
      `Tax(${taxPercentDisplay})     : ${taxAmountDisplay} `,
      divider,
      `Grand Total: ${totalDisplay} `,
      `Payment Mode: ${paymentModeLabel} `,
      'Thank you for shopping with us!',
      divider,
      '       Powered by Drag & Drop',
      divider
    ];

    return lines.join('\n');
  }, []);

  const findCustomerMobileForOrder = (order, customers) => {
    if (!order) return null;

    const sanitize = (value) => sanitizeMobileNumber(value) || null;

    // Check direct fields on order
    const directMobile =
      sanitize(order.customerMobile) ||
      sanitize(order.customerPhone) ||
      sanitize(order.phoneNumber);
    if (directMobile) return directMobile;

    // Try matching by customerId
    if (order.customerId && Array.isArray(customers)) {
      const matched = customers.find(
        (customer) =>
          customer.id === order.customerId ||
          customer._id === order.customerId ||
          customer.customerId === order.customerId
      );
      if (matched) {
        const matchedMobile =
          sanitize(matched.mobileNumber) ||
          sanitize(matched.phone) ||
          sanitize(matched.contactNumber);
        if (matchedMobile) return matchedMobile;
      }
    }

    // Try matching by customer name
    if (order.customerName && Array.isArray(customers)) {
      const normalizedOrderName = order.customerName.trim().toLowerCase();
      const matchedByName = customers.find((customer) =>
        (customer.name || '').trim().toLowerCase() === normalizedOrderName
      );
      if (matchedByName) {
        const matchedMobile =
          sanitize(matchedByName.mobileNumber) ||
          sanitize(matchedByName.phone) ||
          sanitize(matchedByName.contactNumber);
        if (matchedMobile) return matchedMobile;
      }
    }

    return null;
  };

  const handleShareTransaction = useCallback(
    (order) => {
      if (!order) return;

      const customerMobile =
        sanitizeMobileNumber(order.customerMobile || order.customerPhone || order.phoneNumber || '') ||
        findCustomerMobileForOrder(order, state.customers) ||
        sanitizeMobileNumber(state.currentUser?.phoneNumber || state.currentUser?.mobileNumber || '');

      if (!customerMobile) {
        showToast('No customer mobile number found for this invoice.', 'warning');
        return;
      }

      const message = buildWhatsAppInvoiceMessage(order, state, customerMobile);
      if (!message) {
        showToast('Unable to prepare invoice details for sharing.', 'error');
        return;
      }

      const targetNumber = customerMobile.length === 10 ? `91${customerMobile} ` : customerMobile;
      const waUrl = `https://wa.me/${targetNumber}?text=${encodeURIComponent(message)}`;
      window.open(waUrl, '_blank');
    },
    [buildWhatsAppInvoiceMessage, showToast, state]
  );

  const formatCurrencyFull = (value) => {
    const amount = Number(value || 0) || 0;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
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

  const getPaymentMethodBadgeClass = (method) => {
    const m = (method || '').toLowerCase();
    if (m === 'cash') return 'bg-green-50 text-green-700';
    if (m === 'card' || m === 'upi' || m === 'online') return 'bg-blue-50 text-blue-700';
    if (m === 'due' || m === 'credit') return 'bg-red-50 text-red-700';
    if (m === 'split') return 'bg-purple-50 text-purple-700';
    return 'bg-gray-50 text-gray-700';
  };

  const getPaymentMethodLabel = (method = 'cash') => {
    switch ((method || '').toLowerCase()) {
      case 'upi':
      case 'online':
        return 'Online Payment';
      case 'due':
      case 'credit':
        return 'Due (Credit)';
      case 'cash':
      default:
        return 'Cash';
    }
  };

  const getDaysRemainingColor = (days) => {
    if (days > 10) return 'text-green-700 bg-green-50 border-green-200';
    if (days > 3) return 'text-orange-700 bg-orange-50 border-orange-200';
    if (days > 0) return 'text-red-600 bg-red-50 border-red-200';
    return 'text-red-700 bg-red-100 border-red-300';
  };

  const getDaysRemainingMessage = (days) => {
    if (days === 0) return 'Subscription Expired';
    if (days <= 3) return `${days} Day${days === 1 ? '' : 's'} Left - Recharge Now!`;
    if (days <= 10) return `${days} Days Left - Recharge Soon!`;
    return `${days} Days Remaining`;
  };

  useEffect(() => {
    if (!subscriptionExpiryDate) {
      setExpiryCountdown(null);
      return;
    }

    const updateCountdown = () => {
      setExpiryCountdown(calculateExpiryCountdown(subscriptionExpiryDate));
    };

    updateCountdown();
    const intervalId = setInterval(updateCountdown, 1000);

    return () => clearInterval(intervalId);
  }, [subscriptionExpiryDate]);

  // Helper function to get transaction/order date
  const getTransactionDate = (transaction) => {
    return transaction.date || transaction.createdAt || new Date().toISOString();
  };

  // Helper function to get order date
  const getOrderDate = (order) => {
    return order.createdAt || order.date || new Date().toISOString();
  };

  // Helper function to get purchase order date
  const getPurchaseOrderDate = (order) => {
    return order.date || order.createdAt || new Date().toISOString();
  };

  // Calculate date range based on timeRange selector
  const getDateRange = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let startDate = new Date(today);

    switch (timeRange) {
      case 'today':
        startDate.setHours(0, 0, 0, 0);
        break;
      case '7d':
        startDate.setDate(today.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(today.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(today.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(today.getFullYear() - 1);
        break;
      case 'all':
        startDate = new Date(0);
        break;
      default:
        startDate.setDate(today.getDate() - 30);
    }

    const endDate = new Date(today);
    endDate.setHours(23, 59, 59, 999);

    return { startDate, endDate };
  };

  const { startDate, endDate } = getDateRange();

  // Get sellerId to filter orders for this seller only
  const sellerId = getSellerIdFromAuth();

  // Filter orders by sellerId (sales/billing records)
  const belongsToSeller = (record, targetSellerId) => {
    if (!targetSellerId || !record) return true;

    const candidateIds = [
      record.sellerId,
      record.sellerID,
      record.seller_id,
      record._sellerId,
      record.seller?.id,
      record.seller?._id,
      record.seller?.sellerId,
      record.createdBy?.sellerId,
      record.createdBy?.sellerID,
      record.createdBy?._id,
    ]
      .filter(Boolean)
      .map((value) => value?.toString?.().trim?.())
      .filter(Boolean);

    if (candidateIds.length === 0) {
      return true;
    }

    return candidateIds.includes(targetSellerId.toString());
  };

  const sellerOrders = sellerId ? state.orders.filter(order => belongsToSeller(order, sellerId)) : state.orders;

  // Filter orders by date range
  const filteredOrders = sellerOrders.filter(order => {
    const orderDate = new Date(getOrderDate(order));
    return orderDate >= startDate && orderDate <= endDate;
  });

  // Filter purchase orders by date range and sellerId
  const sellerPurchaseOrders = sellerId
    ? state.purchaseOrders.filter(order => {
      const matches = belongsToSeller(order, sellerId) && !order.isDeleted && order.status === 'completed';
      if (matches) //('📊 DASHBOARD: Including completed PO:', order.id, 'status:', order.status);
        return matches;
    })
    : state.purchaseOrders.filter(order => {
      const matches = !order.isDeleted && order.status === 'completed';
      if (matches) //('📊 DASHBOARD: Including completed PO:', order.id, 'status:', order.status);
        return matches;
    });
  const filteredPurchaseOrders = sellerPurchaseOrders.filter(order => {
    const orderDate = new Date(getPurchaseOrderDate(order));
    return orderDate >= startDate && orderDate <= endDate;
  });

  // Calculate comprehensive dashboard stats
  const totalCustomers = state.customers.length;
  const totalProducts = state.products.length;
  const totalOrders = sellerOrders.length;
  const totalPurchaseOrders = sellerPurchaseOrders.length;

  // Calculate total balance due (using dueAmount field from database)
  const totalBalanceDue = state.customers.reduce((sum, customer) => {
    return sum + (customer.dueAmount || customer.balanceDue || 0);
  }, 0);

  // Calculate total sales from orders (all time) - use totalAmount from Order model
  const totalSales = sellerOrders.reduce((sum, order) => {
    return sum + (order.totalAmount || 0);
  }, 0);

  // Calculate sales for selected time range from orders
  const rangeSales = filteredOrders.reduce((sum, order) => {
    return sum + (order.totalAmount || 0);
  }, 0);

  // Calculate total purchase value (all time) - filtered by sellerId
  const totalPurchaseValue = sellerPurchaseOrders.reduce((sum, order) => {
    return sum + (order.total || 0);
  }, 0);

  // Calculate purchase value for selected time range
  const rangePurchaseValue = filteredPurchaseOrders.reduce((sum, order) => {
    return sum + (order.total || 0);
  }, 0);

  // Calculate profit from orders: profit = sum((sellingPrice - costPrice) * quantity) for each item
  // Profit = Total Sales Revenue (from orders) - Total Purchase Costs (from purchase orders)
  const calculateProfitFromOrderItems = (orders) => {
    const toNumber = (value) => (typeof value === 'number' ? value : parseFloat(value)) || 0;

    return orders.reduce((totalProfit, order) => {
      if (!order.items || !Array.isArray(order.items)) return totalProfit;

      const orderProfit = order.items.reduce((orderItemProfit, item) => {
        const sellingPrice = toNumber(item.totalSellingPrice ?? item.sellingPrice);
        const costPrice = toNumber(item.totalCostPrice ?? item.costPrice);
        const itemProfit = sellingPrice - costPrice;
        return orderItemProfit + itemProfit;
      }, 0);

      return totalProfit + orderProfit;
    }, 0);
  };

  // Calculate profit for a specific date range
  const calculateProfitForRange = (orders, purchaseOrders, startDate, endDate) => {
    const filteredOrders = orders.filter(order => {
      const orderDate = new Date(getOrderDate(order));
      return orderDate >= startDate && orderDate <= endDate;
    });

    const filteredPurchaseOrders = purchaseOrders.filter(order => {
      const orderDate = new Date(getPurchaseOrderDate(order));
      return orderDate >= startDate && orderDate <= endDate;
    });

    // Use order items profit calculation (more accurate)
    return calculateProfitFromOrderItems(filteredOrders) - filteredPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0);
  };

  // Calculate low stock products
  const lowStockProducts = state.products.filter(product =>
    (product.quantity || product.stock || 0) <= state.lowStockThreshold
  );

  // Calculate expiring products
  const expiringProducts = state.products.filter(product => {
    if (!product.expiryDate) return false;
    const expiryDate = new Date(product.expiryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = expiryDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= state.expiryDaysThreshold && diffDays >= 0;
  });

  // Calculate pending payments (using dueAmount field from database)
  const pendingPayments = state.customers.filter(customer =>
    (customer.dueAmount || customer.balanceDue || 0) > 0
  ).length;

  // Calculate total profit (all time) using orders and purchase orders
  const totalPettyExpenses = (Array.isArray(expenses) ? expenses : []).reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
  const totalProfit = calculateProfitFromOrderItems(sellerOrders) - sellerPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0) - totalPettyExpenses;
  const profitMargin = totalSales > 0 ? ((totalProfit / totalSales) * 100) : 0;

  // Calculate today's sales and profit
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const todayOrders = sellerOrders.filter(order => {
    const orderDate = new Date(getOrderDate(order));
    return orderDate >= todayStart && orderDate < todayEnd;
  });

  const todayPurchaseOrders = sellerPurchaseOrders.filter(order => {
    const orderDate = new Date(getPurchaseOrderDate(order));
    return orderDate >= todayStart && orderDate < todayEnd;
  });

  const todaySales = todayOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

  // Calculate today's petty expenses
  const todayExpenses = (Array.isArray(expenses) ? expenses : []).filter(exp => {
    const expDate = new Date(exp.date || exp.createdAt);
    return expDate >= todayStart && expDate < todayEnd;
  }).reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);

  const todayProfit = calculateProfitFromOrderItems(todayOrders) - todayPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0) - todayExpenses;

  // Helper function to get date range for period (uses timeRange state)
  const getPeriodDateRange = (period = timeRange) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let startDate = new Date(today);

    switch (period) {
      case 'today':
        return { startDate: todayStart, endDate: todayEnd };
      case '7d':
        startDate.setDate(today.getDate() - 7);
        return { startDate, endDate: todayEnd };
      case '30d':
        startDate.setDate(today.getDate() - 30);
        return { startDate, endDate: todayEnd };
      case '90d':
        startDate.setDate(today.getDate() - 90);
        return { startDate, endDate: todayEnd };
      case '1y':
      case 'all':
        return { startDate: new Date(0), endDate: todayEnd };
      default:
        return { startDate: todayStart, endDate: todayEnd };
    }
  };

  // Calculate sales for current timeRange
  const getSalesForPeriod = () => {
    const { startDate, endDate } = getPeriodDateRange();
    const periodOrders = sellerOrders.filter(order => {
      const orderDate = new Date(getOrderDate(order));
      return orderDate >= startDate && orderDate < endDate;
    });
    return periodOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
  };

  // Calculate net profit for current timeRange
  // Calculate net profit for current timeRange
  const getNetProfitForPeriod = () => {
    const { startDate, endDate } = getPeriodDateRange();

    // Filter Orders
    const periodOrders = sellerOrders.filter(order => {
      const orderDate = new Date(getOrderDate(order));
      return orderDate >= startDate && orderDate < endDate;
    });

    // Filter Purchase Orders
    const periodPurchaseOrders = sellerPurchaseOrders.filter(order => {
      const orderDate = new Date(getPurchaseOrderDate(order));
      return orderDate >= startDate && orderDate < endDate;
    });

    // Filter Petty Expenses
    const periodExpenses = (Array.isArray(expenses) ? expenses : []).filter(exp => {
      const expDate = new Date(exp.date || exp.createdAt);
      return expDate >= startDate && expDate < endDate;
    });

    const salesProfit = calculateProfitFromOrderItems(periodOrders);
    const purchaseCost = periodPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0);
    const pettyExpensesCost = periodExpenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);

    return salesProfit - purchaseCost - pettyExpensesCost;
  };

  // Calculate purchase orders count and value for current timeRange
  const getPurchaseOrdersForPeriod = () => {
    const { startDate, endDate } = getPeriodDateRange();
    const periodPurchaseOrders = sellerPurchaseOrders.filter(order => {
      const orderDate = new Date(getPurchaseOrderDate(order));
      return orderDate >= startDate && orderDate < endDate;
    });
    return {
      count: periodPurchaseOrders.length,
      value: periodPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0)
    };
  };

  // Calculate sales profit (without purchase orders) for current timeRange
  const getSalesProfitForPeriod = () => {
    const { startDate, endDate } = getPeriodDateRange();
    const periodOrders = sellerOrders.filter(order => {
      const orderDate = new Date(getOrderDate(order));
      return orderDate >= startDate && orderDate < endDate;
    });
    return calculateProfitFromOrderItems(periodOrders);
  };

  // Calculate average transactions per day for current timeRange
  const getAverageTransactionsPerDay = () => {
    const { startDate, endDate } = getPeriodDateRange();
    const diffTime = Math.abs(endDate - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    const periodOrders = sellerOrders.filter(order => {
      const orderDate = new Date(getOrderDate(order));
      return orderDate >= startDate && orderDate < endDate;
    });
    return (periodOrders.length / diffDays).toFixed(1);
  };

  // Calculate profit margin for current timeRange (using net profit)
  const getProfitMarginForPeriod = () => {
    const sales = getSalesForPeriod();
    const netProfit = getNetProfitForPeriod();
    return sales > 0 ? ((netProfit / sales) * 100) : 0;
  };

  // Calculate sales profit margin for current timeRange (using sales profit)
  const getSalesProfitMarginForPeriod = () => {
    const sales = getSalesForPeriod();
    const salesProfit = getSalesProfitForPeriod();
    return sales > 0 ? ((salesProfit / sales) * 100) : 0;
  };

  // Calculate monthly sales and profit
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  monthEnd.setHours(0, 0, 0, 0);

  const monthlyOrders = sellerOrders.filter(order => {
    const orderDate = new Date(getOrderDate(order));
    return orderDate >= monthStart && orderDate < monthEnd;
  });

  const monthlyPurchaseOrders = sellerPurchaseOrders.filter(order => {
    const orderDate = new Date(getPurchaseOrderDate(order));
    return orderDate >= monthStart && orderDate < monthEnd;
  });

  const monthlySales = monthlyOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
  const monthlyProfit = calculateProfitFromOrderItems(monthlyOrders) - monthlyPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0);

  // Calculate range profit for selected time period
  const rangeProfit = calculateProfitForRange(
    sellerOrders,
    sellerPurchaseOrders,
    startDate,
    endDate
  );

  // ========== INVENTORY INSIGHTS CALCULATIONS ==========

  // Helper function to get product sales count for a specific set of orders
  const getProductSalesCount = (productId, productName, ordersToUse = sellerOrders) => {
    let count = 0;
    ordersToUse.forEach(order => {
      if (order.items && Array.isArray(order.items)) {
        order.items.forEach(item => {
          if ((item.productId === productId || item.name === productName) && item.quantity) {
            count += Number(item.quantity || 0);
          }
        });
      }
    });
    return count;
  };

  // Fast-moving items (sold in selected period)
  const fastMovingProducts = state.products
    .map(product => {
      const salesCount = getProductSalesCount(product.id, product.name, filteredOrders);
      if (salesCount > 0) {
        return { ...product, salesCount };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.salesCount - a.salesCount)
    .slice(0, 10);

  // Slow-moving items (sold before but NOT in selected period)
  const slowMovingProducts = state.products
    .filter(product => {
      const hasSaleInPeriod = filteredOrders.some(order =>
        order.items?.some(item =>
          (item.productId === product.id || item.name === product.name)
        )
      );

      const hasOldSale = sellerOrders.some(order => {
        const orderDate = new Date(getOrderDate(order));
        return orderDate < startDate && order.items?.some(item =>
          (item.productId === product.id || item.name === product.name)
        );
      });

      return !hasSaleInPeriod && hasOldSale;
    })
    .slice(0, 10);

  // Dead stock (no sales in selected period and potentially never sold if 'all' is selected)
  const deadStock = state.products.filter(product => {
    const hasSaleInPeriod = filteredOrders.some(order =>
      order.items?.some(item =>
        (item.productId === product.id || item.name === product.name)
      )
    );

    // For 'all time', dead stock means never sold. 
    // For specific periods, it means no sales in that period AND potentially no sales at all.
    const hasAnySaleEver = sellerOrders.some(order =>
      order.items?.some(item =>
        (item.productId === product.id || item.name === product.name)
      )
    );

    return !hasSaleInPeriod && !hasAnySaleEver;
  });

  // Recent transactions (orders) from IndexedDB (sorted by date, most recent first)
  // Orders are sales/billing records - use state.orders instead of state.transactions
  // Filter by sellerId
  const recentTransactions = [...(sellerOrders || [])]
    .sort((a, b) => {
      const dateA = new Date(getOrderDate(a));
      const dateB = new Date(getOrderDate(b));
      return dateB - dateA;
    })
    .slice(0, 5)
    .map(order => {
      const customer = order.customerId
        ? state.customers.find(c => c.id === order.customerId || c._id === order.customerId)
        : null;
      return {
        id: order.id || order._id,
        customerName: customer?.name || order.customerName || 'Walk-in Customer',
        customerMobile: customer?.mobileNumber || customer?.phone || order.customerMobile || '',
        total: order.totalAmount || order.total || 0,
        totalAmount: order.totalAmount || order.total || 0,
        paymentMethod: order.paymentMethod || 'cash',
        splitPaymentDetails: order.splitPaymentDetails,
        date: order.createdAt || order.date || new Date().toISOString(),
        createdAt: order.createdAt || order.date || new Date().toISOString(),
        subtotal: order.subtotal || 0,
        discountPercent: order.discountPercent || 0,
        taxPercent: order.taxPercent || 0,
        items: order.items || [],
        note: order.notes || '',
        orderId: order.id || order._id,
        rawOrder: order
      };
    });

  // Recent activities from IndexedDB (sorted by date, most recent first)
  // Show activities when there are no transactions
  const recentActivities = [...(state.activities || [])]
    .sort((a, b) => {
      const dateA = new Date(a.timestamp || a.createdAt || 0);
      const dateB = new Date(b.timestamp || b.createdAt || 0);
      return dateB - dateA;
    })
    .slice(0, 5);

  // Get period label
  const getPeriodLabel = (period) => {
    const options = [
      { value: 'today', label: 'Today' },
      { value: '7d', label: 'Last 7 Days' },
      { value: '30d', label: 'Last 30 Days' },
      { value: '90d', label: 'Last 90 Days' },
      { value: '1y', label: 'All Time' }
    ];
    const option = options.find(opt => opt.value === period);
    return option ? option.label : 'Today';
  };

  // Comprehensive stats array (all controlled by single timeRange)
  const purchaseOrdersData = getPurchaseOrdersForPeriod();
  const stats = [
    {
      name: 'Total Customers',
      value: totalCustomers,
      icon: Users,
      description: 'Active customers',
      theme: 'primary'
    },
    {
      name: 'Total Products',
      value: totalProducts,
      icon: Package,
      description: 'Items in inventory',
      theme: 'teal'
    },
    {
      name: 'Sales',
      value: formatNumber(getSalesForPeriod()),
      icon: Wallet,
      description: `Sales - ${getPeriodLabel(timeRange)}`,
      theme: 'amber'
    },
    {
      name: 'Net Profit',
      value: formatNumber(getNetProfitForPeriod()),
      icon: TrendingUp,
      description: `Net Profit - ${getPeriodLabel(timeRange)}`,
      theme: 'emerald'
    },
    {
      name: 'Balance Due',
      value: formatNumber(totalBalanceDue),
      icon: CreditCard,
      description: 'Outstanding payments',
      theme: 'rose'
    },
    {
      name: 'Purchase Orders',
      value: `${purchaseOrdersData.count}`,
      icon: Truck,
      description: `${getPeriodLabel(timeRange)}`,
      theme: 'slate',
      secondaryValue: formatNumber(purchaseOrdersData.value)
    },
    {
      name: 'Sales Profit',
      value: formatNumber(getSalesProfitForPeriod()),
      icon: TrendingUp,
      description: `Sales Profit - ${getPeriodLabel(timeRange)}`,
      theme: 'purple'
    },
    {
      name: 'Sales Profit Margin',
      value: `${getSalesProfitMarginForPeriod().toFixed(1)}%`,
      icon: TrendingUp,
      description: `Sales Profit Margin - ${getPeriodLabel(timeRange)}`,
      theme: 'teal'
    }
  ];

  const goToView = useCallback((view) => {
    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
    navigate(getPathForView(view));
  }, [dispatch, navigate]);

  const quickActions = [
    {
      key: 'billing',
      label: 'New Bill',
      description: 'Generate an invoice instantly',
      icon: ShoppingCart,
      gradient: 'linear-gradient(135deg, rgba(47,60,126,0.92), rgba(31,40,88,0.94))',
      onClick: () => goToView('billing')
    },
    {
      key: 'products',
      label: 'Add Product',
      description: 'Expand your catalog',
      icon: Package,
      gradient: 'linear-gradient(135deg, rgba(99,102,241,0.88), rgba(76,29,149,0.92))',
      onClick: () => goToView('products')
    },
    {
      key: 'customers',
      label: 'Add Customer',
      description: 'Capture buyer details',
      icon: Users,
      gradient: 'linear-gradient(135deg, rgba(16,185,129,0.88), rgba(4,120,87,0.92))',
      onClick: () => goToView('customers')
    },
    {
      key: 'purchase',
      label: 'Purchase Order',
      description: 'Replenish inventory fast',
      icon: Truck,
      gradient: 'linear-gradient(135deg, rgba(244,162,89,0.9), rgba(217,119,6,0.92))',
      onClick: () => {
        if (!isModuleUnlocked('purchase', state.currentPlan, state.currentPlanDetails)) {
          if (window.showToast) window.showToast(getUpgradeMessage('purchase', state.currentPlan), 'warning');
        } else {
          goToView('purchase');
        }
      }
    }
  ];

  const timeRangeOptions = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: '1y', label: 'All Time' }
  ];

  return (
    <PageSkeleton
      loading={isLoading}
      skeleton={
        <div className="space-y-6">
          {/* Header skeleton */}
          <div className="h-8 bg-gray-200 rounded w-1/3 animate-pulse"></div>

          {/* Stats skeleton */}
          <SkeletonStats count={4} />

          {/* Charts skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <div className="h-6 bg-gray-200 rounded w-1/4 mb-4 animate-pulse"></div>
              <div className="h-64 bg-gray-100 rounded animate-pulse"></div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <div className="h-6 bg-gray-200 rounded w-1/4 mb-4 animate-pulse"></div>
              <div className="h-64 bg-gray-100 rounded animate-pulse"></div>
            </div>
          </div>

          {/* Recent activity skeleton */}
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <div className="h-6 bg-gray-200 rounded w-1/4 mb-4 animate-pulse"></div>
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center space-x-3">
                  <div className="h-8 w-8 bg-gray-200 rounded-full animate-pulse"></div>
                  <div className="flex-1 space-y-1">
                    <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2 animate-pulse"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      }
    >
      <div className="space-y-4 sm:space-y-3 lg:space-y-4 fade-in-up">
        {/* Welcome Section with Floating Boxes - Hidden on Mobile */}
        <div className="hidden lg:block" />

        {/* Subscription Status Alert */}
        {subscriptionExpiryDate && (
          <div className={`rounded-xl border-2 p-4 ${getDaysRemainingColor(daysRemaining)} ${daysRemaining > 3 ? 'hidden sm:block' : ''}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start space-x-3">
                <Clock className="h-6 w-6" />
                <div>
                  <p className="font-semibold text-lg">
                    {getDaysRemainingMessage(daysRemaining)}
                  </p>
                  <p className="text-sm opacity-80">
                    {planExpiryStatusText}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 lg:justify-end">
                {expiryCountdown ? (
                  expiryCountdown.expired ? (
                    <div className="text-sm font-semibold">
                      Plan expired
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 sm:gap-3">
                      {[
                        { label: 'Days', value: expiryCountdown.days },
                        { label: 'Hours', value: expiryCountdown.hours },
                        { label: 'Minutes', value: expiryCountdown.minutes },
                        { label: 'Seconds', value: expiryCountdown.seconds },
                      ].map((segment) => (
                        <div
                          key={segment.label}
                          className="bg-white/80 text-gray-900 rounded-lg px-3 py-2 min-w-[64px] text-center shadow-sm"
                        >
                          <div className="text-xl font-bold leading-none">
                            {formatCountdownValue(segment.value)}
                          </div>
                          <div className="text-xs uppercase tracking-wide text-gray-600">
                            {segment.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="text-sm font-semibold">
                    No active plan
                  </div>
                )}
                {daysRemaining <= 3 && (
                  <button
                    onClick={() => goToView('upgrade')}
                    className="px-4 py-2 bg-[#1b1b1b] text-white rounded-lg hover:bg-[#252525] transition-colors"
                  >
                    Recharge Now
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Time Range Selector */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Business Overview</h1>
          <div className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 p-1 shadow-sm backdrop-blur-sm">
            {timeRangeOptions.map((option) => {
              const isActive = timeRange === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTimeRange(option.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm ${isActive
                    ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow'
                    : 'text-slate-600 dark:text-slate-300 hover:text-[#2f3c7e] dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-700'
                    }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stats Grid with Animations */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {stats.map((stat, index) => {
            const Icon = stat.icon;
            const theme = getStatTheme(stat.theme);
            return (
              <div
                key={stat.name}
                className="stat-card animate-float-up group transition-all duration-300 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md"
                style={{ animationDelay: `${index * 0.1}s`, animationFillMode: 'both' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="rounded-xl border p-2.5 transition group-hover:shadow-md"
                      style={{
                        backgroundColor: theme.background,
                        color: theme.color,
                        borderColor: theme.border
                      }}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">{stat.name}</p>
                      <p className={`text-2xl font-semibold whitespace-nowrap overflow-x-auto scrollbar-hide ${stat.name === 'Sales' || stat.name === 'Sales Profit' || stat.name === 'Sales Profit Margin' ? 'text-emerald-600' :
                          stat.name === 'Net Profit' ? (parseFloat(stat.value.replace(/[^0-9.-]/g, '')) >= 0 ? 'text-emerald-600' : 'text-rose-600') :
                            stat.name === 'Balance Due' && parseFloat(stat.value.replace(/[^0-9.-]/g, '')) > 0 ? 'text-rose-600' :
                              'text-slate-900 dark:text-white'
                        }`} title={stat.value}>
                        {stat.value}
                      </p>
                      {stat.secondaryValue && (
                        <p className={`text-sm font-medium mt-1 ${stat.name === 'Purchase Orders' ? 'text-rose-600' : 'text-slate-600 dark:text-slate-400'
                          }`}>
                          Value: {stat.secondaryValue}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-gray-500 dark:text-slate-500 mt-2">{stat.description}</p>
              </div>
            );
          })}
        </div>

        {/* Important Alerts - Full Width */}
        <div className="w-full">
          {/* Alerts */}
          <div className="card">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-yellow-600" />
              Important Alerts
            </h3>
            <div className="space-y-4">
              {lowStockProducts.length > 0 && (
                <div
                  onClick={() => {
                    setSelectedAlert({ type: 'lowStock', data: lowStockProducts });
                    setShowAlertModal(true);
                  }}
                  className="flex items-center p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl border-l-4 border-yellow-400 dark:border-yellow-500 cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-all hover:shadow-sm"
                >
                  <AlertTriangle className="h-6 w-6 text-yellow-600 dark:text-yellow-500 mr-4 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-yellow-800 dark:text-yellow-200">
                      {lowStockProducts.length} products low in stock
                    </p>
                    <p className="text-sm text-yellow-600 dark:text-yellow-300">
                      {lowStockProducts.slice(0, 3).map(product => product.name).join(', ')}
                      {lowStockProducts.length > 3 && ` and ${lowStockProducts.length - 3} more`}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-yellow-400 ml-auto" />
                </div>
              )}

              {expiringProducts.length > 0 && (
                <div
                  onClick={() => {
                    setSelectedAlert({ type: 'expiring', data: expiringProducts });
                    setShowAlertModal(true);
                  }}
                  className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border-l-4 border-red-400 dark:border-red-500 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30 transition-all hover:shadow-sm"
                >
                  <Clock className="h-6 w-6 text-red-600 dark:text-red-500 mr-4 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-red-800 dark:text-red-200">
                      {expiringProducts.length} products expiring soon
                    </p>
                    <p className="text-sm text-red-600 dark:text-red-300">
                      {expiringProducts.slice(0, 3).map(product => product.name).join(', ')}
                      {expiringProducts.length > 3 && ` and ${expiringProducts.length - 3} more`}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-red-200 ml-auto" />
                </div>
              )}

              {pendingPayments > 0 && (
                <div
                  onClick={() => {
                    const customersWithDue = state.customers.filter(c => (c.dueAmount || c.balanceDue || 0) > 0);
                    setSelectedAlert({ type: 'pendingPayments', data: customersWithDue });
                    setShowAlertModal(true);
                  }}
                  className="flex items-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border-l-4 border-blue-400 dark:border-blue-500 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-all hover:shadow-sm"
                >
                  <CreditCard className="h-6 w-6 text-blue-600 dark:text-blue-500 mr-4 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-blue-800 dark:text-blue-200">
                      {pendingPayments} customers have pending payments
                    </p>
                    <p className="text-sm text-blue-600 dark:text-blue-300">
                      Total outstanding: {formatNumber(totalBalanceDue)}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-blue-200 ml-auto" />
                </div>
              )}

              {lowStockProducts.length === 0 && expiringProducts.length === 0 && pendingPayments === 0 && (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Award className="h-8 w-8 text-green-600 dark:text-green-400" />
                  </div>
                  <p className="text-green-600 dark:text-green-400 font-semibold">All good! No alerts at this time</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Inventory Insights Section */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center">
              <Package className="h-5 w-5 mr-2 text-purple-600 dark:text-purple-400" />
              Inventory Insights
            </h3>
            <span className="text-xs font-medium px-2 py-1 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded-lg">
              {getPeriodLabel(timeRange)}
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Low Stock Items */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
              <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2 text-yellow-600" />
                Low Stock Items
              </h4>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {lowStockProducts.length > 0 ? (
                  lowStockProducts.slice(0, 10).map((product, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 dark:text-white">{product.name}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">Stock: {product.quantity || product.stock || 0} {product.unit || 'units'}</p>
                      </div>
                      <p className="text-xs font-semibold text-yellow-600 dark:text-yellow-400">Low Stock</p>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 dark:text-slate-400 text-center py-4">No low stock items</p>
                )}
              </div>
            </div>

            {/* Fast-moving Items */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
              <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <TrendingUp className="h-5 w-5 mr-2 text-green-600" />
                Fast-moving Items
              </h4>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {fastMovingProducts.length > 0 ? (
                  fastMovingProducts.map((product, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 dark:text-white">{product.name}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">Sold: {product.salesCount || 0} {product.unit || 'units'} ({getPeriodLabel(timeRange)})</p>
                      </div>
                      <p className="text-xs font-semibold text-green-600 dark:text-green-400">Fast Moving</p>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 dark:text-slate-400 text-center py-4">No fast moving items</p>
                )}
              </div>
            </div>

            {/* Slow-moving Items */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
              <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <TrendingDown className="h-5 w-5 mr-2 text-orange-600" />
                Slow-moving Items
              </h4>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {slowMovingProducts.length > 0 ? (
                  slowMovingProducts.map((product, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 dark:text-white">{product.name}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">Stock: {product.quantity || product.stock || 0} {product.unit || 'units'}</p>
                      </div>
                      <p className="text-xs font-semibold text-orange-600 dark:text-orange-400">Slow Moving</p>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 dark:text-slate-400 text-center py-4">No slow moving items</p>
                )}
              </div>
            </div>

            {/* Dead Stock */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
              <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <AlertCircle className="h-5 w-5 mr-2 text-red-600" />
                Dead Stock (Not Sold for 30+ Days)
              </h4>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {deadStock.length > 0 ? (
                  deadStock.slice(0, 10).map((product, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 dark:text-white">{product.name}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">Stock: {product.quantity || product.stock || 0} {product.unit || 'units'}</p>
                      </div>
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400">Dead Stock</p>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 dark:text-slate-400 text-center py-4">No dead stock</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {showTransactionModal && selectedTransaction && (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 px-4 overflow-y-auto py-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col my-auto border border-gray-200 dark:border-slate-700">
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-700 px-6 py-4 flex-shrink-0">
                <div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">Transaction Details</p>
                  <h4 className="text-xl font-semibold text-gray-900 dark:text-white">
                    {selectedTransaction.customerName || 'Walk-in Customer'}
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {new Date(selectedTransaction.date).toLocaleString('en-IN')} • {getPaymentMethodLabel(selectedTransaction.paymentMethod)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleShareTransaction(selectedTransaction)}
                    className="inline-flex items-center gap-2 rounded-full border border-primary-100 dark:border-primary-900 bg-primary-50 dark:bg-primary-900/30 px-3 py-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 transition hover:bg-primary-100 dark:hover:bg-primary-900/50"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Share
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowTransactionModal(false);
                      setSelectedTransaction(null);
                    }}
                    className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                    aria-label="Close transaction details"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 space-y-6 overflow-y-auto flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Date</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {formatDateTime(selectedTransaction.createdAt || selectedTransaction.date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Customer Name</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {selectedTransaction.customerName || 'Walk-in Customer'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Customer Mobile</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {selectedTransaction.customerMobile || '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Payment Method</p>
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getPaymentMethodBadgeClass(selectedTransaction.paymentMethod)}`}>
                      {selectedTransaction.paymentMethod || 'N/A'}
                    </span>
                  </div>
                  {(() => {
                    const paymentMethod = (selectedTransaction.paymentMethod || '').toString().toLowerCase().trim();
                    if (paymentMethod === 'split') {
                      const paymentDetails = selectedTransaction.splitPaymentDetails || {};
                      const cashAmount = Number(paymentDetails.cashAmount) || 0;
                      const onlineAmount = Number(paymentDetails.onlineAmount) || 0;
                      const dueAmount = Number(paymentDetails.dueAmount) || 0;

                      return (
                        <div className="sm:col-span-2">
                          <p className="text-sm text-gray-600 dark:text-slate-400 mb-2">Split Payment Breakdown</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                              <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">Cash</p>
                              <p className="text-lg font-bold text-green-900 dark:text-green-100">{formatCurrencyFull(cashAmount)}</p>
                            </div>
                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                              <p className="text-xs text-blue-700 dark:text-blue-400 font-medium mb-1">Online</p>
                              <p className="text-lg font-bold text-blue-900 dark:text-blue-100">{formatCurrencyFull(onlineAmount)}</p>
                            </div>
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                              <p className="text-xs text-red-700 dark:text-red-400 font-medium mb-1">Due</p>
                              <p className="text-lg font-bold text-red-900 dark:text-red-100">{formatCurrencyFull(dueAmount)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <div className="sm:col-span-2">
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Total Amount</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {formatCurrencyFull(selectedTransaction.totalAmount || selectedTransaction.total)}
                    </p>
                  </div>
                </div>

                {selectedTransaction.items && selectedTransaction.items.length > 0 && (
                  <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-sm">
                      <thead className="bg-gray-100 dark:bg-slate-700/50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                            Item
                          </th>
                          <th className="px-4 py-2 text-center text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                            Qty
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                            Rate
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                        {selectedTransaction.items.map((item, idx) => {

                          const qty = Number(item.quantity ?? item.originalQuantity?.quantity ?? 0);
                          const unit = item.unit || item.originalQuantity?.unit || '';

                          // ✅ Correct per-unit rate logic
                          const totalValue = Number(item.totalSellingPrice ?? item.total ?? item.sellingPrice ?? 0);

                          const rate = qty > 0
                            ? totalValue / qty
                            : Number(item.unitSellingPrice ?? item.sellingPrice ?? item.price ?? 0);

                          // ✅ Total always correct
                          const total = qty > 0
                            ? rate * qty
                            : totalValue;

                          return (
                            <tr key={`${item.productId || item.name || idx}-${idx}`}>
                              <td className="px-4 py-2 text-gray-800 dark:text-white">
                                <span className="truncate block max-w-[200px]" title={item.name || '—'}>{item.name || '—'}</span>
                              </td>
                              <td className="px-4 py-2 text-center text-gray-600 dark:text-slate-400">{qty} {unit}</td>
                              <td className="px-4 py-2 text-right text-gray-600 dark:text-slate-400">{formatCurrencyFull(rate)}</td>
                              <td className="px-4 py-2 text-right font-medium text-gray-700 dark:text-slate-300">{formatCurrencyFull(total)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {selectedTransaction.note && (
                  <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 rounded-xl p-3 text-sm text-primary-700 dark:text-primary-300">
                    <p className="text-xs uppercase tracking-wide text-primary-600 dark:text-primary-400 mb-1">Note</p>
                    {selectedTransaction.note}
                  </div>
                )}
              </div>

              <div className="flex justify-end border-t border-gray-200 dark:border-slate-700 px-6 py-4 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowTransactionModal(false);
                    setSelectedTransaction(null);
                  }}
                  className="btn-secondary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* New ERP Features Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Quick Actions */}
          <div className="card">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center">
              <Zap className="h-5 w-5 mr-2 text-[var(--brand-primary)]" />
              Quick Actions
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.key}
                    type="button"
                    onClick={action.onClick}
                    className="group relative overflow-hidden rounded-2xl border border-white/25 bg-white/10 px-5 py-5 text-left text-white shadow-[0_24px_70px_-40px_rgba(15,23,42,0.6)] transition-transform duration-200 hover:-translate-y-1 hover:shadow-[0_32px_80px_-42px_rgba(15,23,42,0.65)] focus:outline-none"
                    style={{ background: action.gradient }}
                  >
                    <div className="flex h-full flex-col justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-base font-semibold tracking-tight">{action.label}</p>
                        <p className="text-xs text-white/75">{action.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="card">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center">
                <Activity className="h-5 w-5 mr-2 text-black dark:text-white" />
                Performance Metrics
              </h3>
              <span className="text-xs font-medium px-2 py-1 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded-lg">
                {getPeriodLabel(timeRange)}
              </span>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-700/50 rounded-xl">
                <div className="flex items-center">
                  <Target className="h-5 w-5 text-black dark:text-white mr-3" />
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">Sales Efficiency</p>
                    <p className="text-xs text-gray-600 dark:text-slate-400">Transactions per day</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-black dark:text-white">
                    {filteredOrders.length || 0}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-slate-400 font-medium">
                    Avg: {getAverageTransactionsPerDay()}/day
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-700/50 rounded-xl">
                <div className="flex items-center">
                  <BarChart3 className="h-5 w-5 text-black dark:text-white mr-3" />
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">Inventory Value</p>
                    <p className="text-xs text-gray-600 dark:text-slate-400">Total stock value</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-black dark:text-white">
                    {formatNumber(state.products.reduce((sum, p) => {
                      const quantity = p.quantity || p.stock || 0;
                      const costPrice = p.costPrice || p.unitPrice || 0;
                      return sum + (quantity * costPrice);
                    }, 0))}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-700/50 rounded-xl">
                <div className="flex items-center">
                  <TrendingUp className="h-5 w-5 text-black dark:text-white mr-3" />
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">Avg Transaction</p>
                    <p className="text-xs text-gray-600 dark:text-slate-400">Per transaction</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-black dark:text-white whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatNumber(rangeSales > 0 && filteredOrders.length > 0 ? (rangeSales / filteredOrders.length) : 0)}>
                    {formatNumber(rangeSales > 0 && filteredOrders.length > 0 ? (rangeSales / filteredOrders.length) : 0)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Alert Detail Modal */}
        {showAlertModal && selectedAlert && (
          <div
            className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm"
            onClick={() => {
              setShowAlertModal(false);
              setSelectedAlert(null);
            }}
          >
            <div
              className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-full overflow-hidden flex flex-col animate-float-up border border-gray-100 dark:border-slate-700"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 px-6 py-4 bg-gray-50/50 dark:bg-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl scale-110 ${selectedAlert.type === 'lowStock' ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400' :
                    selectedAlert.type === 'expiring' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                      'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                    }`}>
                    {selectedAlert.type === 'lowStock' ? <AlertTriangle className="h-5 w-5" /> :
                      selectedAlert.type === 'expiring' ? <Clock className="h-5 w-5" /> :
                        <CreditCard className="h-5 w-5" />}
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">
                      {selectedAlert.type === 'lowStock' ? 'Low Stock Inventory' :
                        selectedAlert.type === 'expiring' ? 'Expiring Products' :
                          'Pending Payments'}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">
                      Showing {selectedAlert.data.length} {selectedAlert.type === 'pendingPayments' ? 'customers' : 'items'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowAlertModal(false);
                    setSelectedAlert(null);
                  }}
                  className="p-2 hover:bg-gray-200/50 dark:hover:bg-slate-600/50 rounded-full transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 active:scale-90"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-slate-600">
                <div className="grid gap-3">
                  {selectedAlert.data.map((item, idx) => (
                    <div
                      key={item._id || item.id || idx}
                      className="group flex items-center justify-between p-4 bg-white dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 rounded-2xl hover:border-blue-100 dark:hover:border-blue-700 hover:bg-blue-50/40 dark:hover:bg-slate-700 transition-all duration-200 hover:shadow-sm"
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-11 w-11 rounded-xl bg-gray-50 dark:bg-slate-700 flex items-center justify-center text-gray-400 dark:text-slate-400 group-hover:bg-white dark:group-hover:bg-slate-600 group-hover:scale-110 group-hover:shadow-md transition-all duration-300">
                          {selectedAlert.type === 'pendingPayments' ? <Users className="h-6 w-6" /> : <Package className="h-6 w-6" />}
                        </div>
                        <div>
                          <p className="font-bold text-gray-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
                            {item.name || item.shopName || item.customerName || 'Unknown'}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-slate-400 font-medium tracking-tight">
                            {selectedAlert.type === 'pendingPayments'
                              ? `📞 ${item.mobileNumber || item.phone || 'N/A'}`
                              : `📁 ${item.category || 'General'}`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-xl font-black ${selectedAlert.type === 'lowStock' ? 'text-yellow-600 dark:text-yellow-400' :
                          selectedAlert.type === 'expiring' ? 'text-red-500 dark:text-red-400' :
                            'text-blue-600 dark:text-blue-400'
                          }`}>
                          {selectedAlert.type === 'pendingPayments'
                            ? formatNumber(item.dueAmount || item.balanceDue || 0)
                            : `${item.quantity || item.stock || 0} ${item.unit || 'units'}`}
                        </p>
                        <p className="text-[10px] uppercase font-bold tracking-widest text-gray-400 dark:text-slate-500 flex items-center justify-end gap-1">
                          {selectedAlert.type === 'lowStock' ? 'Current Stock' :
                            selectedAlert.type === 'expiring' ? (
                              <>
                                <Clock className="h-3 w-3" />
                                Exp: {new Date(item.expiryDate).toLocaleDateString()}
                              </>
                            ) :
                              'Balance Due'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 border-t border-gray-100 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-700/50 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowAlertModal(false);
                    setSelectedAlert(null);
                  }}
                  className="px-8 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300 font-bold rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 hover:border-gray-300 dark:hover:border-slate-500 transition-all shadow-sm active:scale-95 text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Seller Registration Modal - Shows when profile is not completed */}
        <SellerRegistrationModal
          isOpen={finalShowRegistrationModal}
          onClose={() => {
            // Modal closes automatically when profileCompleted becomes true
            // This callback is only used if user manually closes (when allowed)
          }}
        />
      </div>
    </PageSkeleton>
  );
};

export default Dashboard;

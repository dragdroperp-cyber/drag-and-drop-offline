import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes, isPlanExpired } from '../../context/AppContext';
import { isProfileComplete } from '../../utils/profileUtils';
import { useToast } from '../../hooks/useToast';
import { apiRequest } from '../../utils/api';
import { usePWAUpdate } from '../../hooks/usePWAUpdate';
import { PageSkeleton, SkeletonStats, SkeletonCard } from '../UI/SkeletonLoader';
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
  ChevronRight,
  CalendarRange,
  XCircle,
  Smartphone,
  Plus,
  Lock,
  Percent,
  PlayCircle,
  Wifi,
  Gift,
  Loader2
} from 'lucide-react';
import { getTranslation } from '../../utils/translations';
import { sanitizeMobileNumber } from '../../utils/validation';
import { formatDate } from '../../utils/dateUtils';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { getPlanLimits, isModuleUnlocked, getUpgradeMessage } from '../../utils/planUtils';
import { getSellerIdFromAuth } from '../../utils/api';
import { getAllItems, addItem, STORES } from '../../utils/indexedDB';
import { getPathForView } from '../../utils/navigation';
import { APP_VERSION } from '../../utils/version';
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
  const { updateAvailable, update } = usePWAUpdate();
  const [isUpdating, setIsUpdating] = useState(false);
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState('today');
  const [saleMode, setSaleMode] = useState('normal'); // 'normal' | 'direct'
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [expandedAlertItem, setExpandedAlertItem] = useState(null);

  const [showAlertModal, setShowAlertModal] = useState(false);
  const [isClosingAlertModal, setIsClosingAlertModal] = useState(false);

  const handleCloseAlertModal = () => {
    setIsClosingAlertModal(true);
    setTimeout(() => {
      setShowAlertModal(false);
      setSelectedAlert(null);
      setIsClosingAlertModal(false);
    }, 400);
  };
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showTransactionModal, setShowTransactionModal] = useState(false);

  const [showCustomDateModal, setShowCustomDateModal] = useState(false);
  const [customDateRange, setCustomDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [tempCustomRange, setTempCustomRange] = useState({ ...customDateRange });
  const [currentSlide, setCurrentSlide] = useState(0);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  // Minimum swipe distance (in px)
  const minSwipeDistance = 50;

  const onTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => setTouchEnd(e.targetTouches[0].clientX);

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      setCurrentSlide(prev => (prev + 1) % CAROUSEL_SLIDES.length);
    } else if (isRightSwipe) {
      setCurrentSlide(prev => (prev - 1 + CAROUSEL_SLIDES.length) % CAROUSEL_SLIDES.length);
    }
  };

  const expenses = state.expenses || []; // Use global expenses state
  const [isLoading, setIsLoading] = useState(!state.initialLoadDone);

  // Manage loading state
  useEffect(() => {
    // Wait until initial load from IDB is done or data is fresh from backend
    if (state.initialLoadDone || state.dataFreshness === 'fresh') {
      const timer = setTimeout(() => setIsLoading(false), 200);
      return () => clearTimeout(timer);
    } else if (!state.initialLoadDone) {
      setIsLoading(true);
    }
  }, [state.initialLoadDone, state.dataFreshness]);

  // Show registration modal if profile is not completed
  // Check if profile is completed - either explicitly marked or has required fields filled
  const hasRequiredProfileFields = !!(state.currentUser?.shopName && state.currentUser?.businessType && state.currentUser?.shopAddress);
  const hasExtendedProfileFields = !!(
    state.currentUser?.phoneNumber ||
    state.currentUser?.city ||
    state.currentUser?.state ||
    state.currentUser?.pincode ||
    state.currentUser?.upiId
  );
  const isProfileCompleted = isProfileComplete(state.currentUser);

  // Automatically update profileCompleted flag if user has filled profile but flag is not set
  useEffect(() => {
    const updateProfileCompletedFlag = async () => {
      // Check if user should have their profile marked as completed
      const shouldBeCompleted = isProfileCompleted;
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
      ? `${planNameLabel} ${daysRemaining === 0 ? getTranslation('planExpiredOn', state.currentLanguage) : getTranslation('planExpiresOn', state.currentLanguage)} ${formattedExpiryDate}`
      : `${getTranslation('planLabel', state.currentLanguage)} ${daysRemaining === 0 ? getTranslation('planExpiredOn', state.currentLanguage) : getTranslation('planExpiresOn', state.currentLanguage)} ${formattedExpiryDate}`)
    : (planNameLabel
      ? `${planNameLabel} ${getTranslation('expiryDateNotAvailable', state.currentLanguage)}`
      : `${getTranslation('planLabel', state.currentLanguage)} ${getTranslation('expiryDateNotAvailable', state.currentLanguage)}`);

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

    const refreshRefundsFromIndexedDB = async () => {
      try {
        const indexedDBRefunds = await getAllItems(STORES.refunds).catch(() => []);
        if (!isActive) return;

        const currentRefunds = state.refunds || [];
        if (indexedDBRefunds.length !== currentRefunds.length) {
          dispatch({
            type: ActionTypes.SET_REFUNDS,
            payload: indexedDBRefunds
          });
        }
      } catch (error) {
        // Silently fail
      }
    };

    refreshOrdersFromIndexedDB();
    refreshRefundsFromIndexedDB();

    const handleTabFocus = () => {
      refreshOrdersFromIndexedDB();
      refreshRefundsFromIndexedDB();
    };

    window.addEventListener('focus', handleTabFocus);

    return () => {
      isActive = false;
      window.removeEventListener('focus', handleTabFocus);
    };
  }, [dispatch, state.orders, state.refunds, state.currentUser?.sellerId]);

  // Format number with max 2 decimal places, respects user's currency format preference
  const formatNumber = (value) => {
    return formatCurrencySmart(value, state.currencyFormat);
  };

  const showToast = useCallback((message, type = 'info', duration = 4000) => {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(message, type, duration);
    }
  }, []);

  const goToView = useCallback((view) => {
    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
    navigate(getPathForView(view));
  }, [dispatch, navigate]);

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
      : formatDate(invoiceDateObj);

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

    const subtotalDisplay = formatCurrencySmart(subtotalRaw, state.currencyFormat);
    const discountDisplay = formatCurrencySmart(discountRaw, state.currencyFormat);
    const taxAmountDisplay = formatCurrencySmart(taxAmountRaw, state.currencyFormat);
    const taxPercentDisplay = Number.isFinite(taxPercentRaw)
      ? `${(taxPercentRaw % 1 === 0 ? taxPercentRaw.toFixed(0) : taxPercentRaw.toFixed(2))}% `
      : 'null';
    const totalDisplay = formatCurrencySmart(totalRaw, state.currencyFormat);

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
      const totalCol = formatCurrencySmart(lineTotal, state.currencyFormat).padStart(
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
    if (days === 0) return getTranslation('subscriptionExpired', state.currentLanguage);
    if (days <= 3) return `${days} ${days === 1 ? getTranslation('dayLeft', state.currentLanguage) : getTranslation('daysLeft', state.currentLanguage)} - ${getTranslation('rechargeNow', state.currentLanguage)}!`;
    if (days <= 10) return `${days} ${getTranslation('daysLeft', state.currentLanguage)} - ${getTranslation('rechargeSoon', state.currentLanguage)}`;
    return `${days} ${getTranslation('daysRemaining', state.currentLanguage)}`;
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

  // Carousel Data
  const CAROUSEL_SLIDES = useMemo(() => {
    const slides = [];

    // Slide 1: Subscription Status
    if (subscriptionExpiryDate || isPlanExpired(state)) {
      slides.push({
        type: 'subscription',
        title: getDaysRemainingMessage(daysRemaining),
        subtitle: planExpiryStatusText,
        icon: Clock,
        color: getDaysRemainingColor(daysRemaining),
        isSubscription: true
      });
    }

    // Slide 2: YouTube Tutorial
    slides.push({
      type: 'youtube',
      title: 'Master Your Business',
      subtitle: 'Watch our YouTube tutorials to learn expert tips and tricks!',
      icon: PlayCircle,
      color: 'text-indigo-700 bg-indigo-50 border-indigo-200',
      action: () => {
        dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: 'tutorials' });
        navigate('/tutorials');
      },
      actionLabel: 'Watch Tutorials',
      buttonIcon: PlayCircle
    });


    // Slide 3: Offline/Online capability
    slides.push({
      type: 'sync',
      title: 'Works Offline & Online',
      subtitle: 'Keep billing even without internet. Data syncs automatically when you\'re back online!',
      icon: Wifi,
      color: 'text-amber-700 bg-amber-50 border-amber-200',
      action: () => showToast('Your data is always safe and synced!', 'success'),
      actionLabel: 'Learn More',
      buttonIcon: Wifi
    });

    // Slide 4: Discounted Plans
    slides.push({
      type: 'discount',
      title: 'Mega Savings on Plans',
      subtitle: 'Don\'t miss out! Grab yearly plans at unbeatable discounted rates.',
      icon: Gift,
      color: 'text-rose-700 bg-rose-50 border-rose-200',
      action: () => goToView('upgrade'),
      actionLabel: 'View Offers',
      buttonIcon: Percent
    });

    // Slide 5: Share App
    slides.push({
      type: 'share',
      title: 'Share the Experience',
      subtitle: 'Refer a friend and help them grow their business too!',
      icon: Share2,
      color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      action: () => {
        if (navigator.share) {
          navigator.share({
            title: 'Drag & Drop Billing',
            text: 'Check out this amazing billing app!',
            url: window.location.origin
          });
        } else {
          showToast('Sharing not supported on this browser', 'info');
        }
      },
      actionLabel: 'Share Now',
      buttonIcon: Share2
    });

    return slides;
  }, [subscriptionExpiryDate, state, daysRemaining, planExpiryStatusText, goToView]);

  useEffect(() => {
    if (CAROUSEL_SLIDES.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentSlide(prev => (prev + 1) % CAROUSEL_SLIDES.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [CAROUSEL_SLIDES.length]);

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
      case 'custom': {
        const s = new Date(customDateRange.start);
        s.setHours(0, 0, 0, 0);
        startDate = s;
        break;
      }
      default:
        startDate.setDate(today.getDate() - 30);
    }

    let endDate = new Date(today);
    if (timeRange === 'custom') {
      const e = new Date(customDateRange.end);
      e.setHours(23, 59, 59, 999);
      endDate = e;
    } else {
      endDate.setHours(23, 59, 59, 999);
    }

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

  const rawSellerOrders = sellerId ? state.orders.filter(order => belongsToSeller(order, sellerId)) : state.orders;

  // Filter orders based on Sale Mode (Normal vs Direct)
  // Filter orders based on Sale Mode (Normal vs Direct)
  const sellerOrders = useMemo(() => {
    // Pre-process refunds for efficient lookup
    const refundsByOrder = new Map();
    const rawRefunds = state.refunds || [];
    const sellerRefunds = sellerId ? rawRefunds.filter(r => belongsToSeller(r, sellerId)) : rawRefunds;

    if (sellerRefunds && Array.isArray(sellerRefunds)) {
      sellerRefunds.forEach(refund => {
        const orderId = (refund.orderId || refund.order_id || '').toString();
        if (!orderId) return;

        if (!refundsByOrder.has(orderId)) {
          refundsByOrder.set(orderId, []);
        }
        refundsByOrder.get(orderId).push(refund);
      });
    }

    return rawSellerOrders.filter(order => {
      if (order.isDeleted) return false;

      // Match Reports logic: for online orders, only count if 'Delivered' (ignore Pending, Cancelled, etc.)
      if (order.orderSource === 'online' && order.orderStatus !== 'Delivered') {
        return false;
      }
      return true;
    }).map(order => {
      // Check if order has items
      if (!order.items || !Array.isArray(order.items)) return null;

      // Filter items based on mode
      const filteredItems = order.items.filter(item => {
        const isArrDProduct = item.isDProduct === true || String(item.isDProduct) === 'true';
        if (saleMode === 'normal') {
          return !isArrDProduct; // Exclude D-Products in Normal Mode
        } else {
          return isArrDProduct; // Include ONLY D-Products in Direct Mode
        }
      });

      // If no items left after filter, exclude this order
      if (filteredItems.length === 0) return null;

      // Recalculate totals for the filtered items
      const totalItemsSum = order.items.reduce((sum, item) => {
        // Line total: prefer pre-calculated totals, fallback to unit price * quantity
        let itemTotal = 0;
        if (item.totalSellingPrice !== undefined && item.totalSellingPrice !== null) {
          itemTotal = Number(item.totalSellingPrice);
        } else if (item.total !== undefined && item.total !== null) {
          itemTotal = Number(item.total);
        } else if (item.amount !== undefined && item.amount !== null) {
          itemTotal = Number(item.amount);
        } else {
          itemTotal = Number(item.sellingPrice || 0) * Number(item.quantity || 1);
        }
        return sum + (itemTotal || 0);
      }, 0);

      const filteredItemsSum = filteredItems.reduce((sum, item) => {
        let itemTotal = 0;
        if (item.totalSellingPrice !== undefined && item.totalSellingPrice !== null) {
          itemTotal = Number(item.totalSellingPrice);
        } else if (item.total !== undefined && item.total !== null) {
          itemTotal = Number(item.total);
        } else if (item.amount !== undefined && item.amount !== null) {
          itemTotal = Number(item.amount);
        } else {
          itemTotal = Number(item.sellingPrice || 0) * Number(item.quantity || 1);
        }
        return sum + (itemTotal || 0);
      }, 0);

      // Consistent logic with Reports/SalesOrderHistory for delivery charge and discount
      const originalGrandTotal = Number(order.totalAmount || order.total || 0);
      const discount = Number(order.discount || order.discountAmount || 0);

      // Infer delivery charge if missing
      let deliveryCharge = Number(order.deliveryCharge || 0);
      if (!deliveryCharge && originalGrandTotal > (totalItemsSum - discount + 1)) {
        deliveryCharge = originalGrandTotal - (totalItemsSum - discount);
      }

      const netProductSales = originalGrandTotal - deliveryCharge;
      const proportionalFactor = totalItemsSum > 0 ? (filteredItemsSum / totalItemsSum) : 0;
      let finalCalculatedTotal = proportionalFactor * originalGrandTotal;
      const allocatedDiscount = discount * proportionalFactor;

      // --- REFUND DEDUCTION LOGIC REMOVED ---
      // Refunds are now handled as separate events in the profit calculation
      // to ensure time-based accuracy (viewing reports by Refund Date).
      // We no longer deduct refunds from the Order's totalAmount here.
      // -----------------------------
      // -----------------------------

      // Pre-calculate proportional lump sum refund to avoid full deduction error on partial views
      // Pre-calculate proportional lump sum refund logic removed as it's no longer used for deduction
      // and finding orderRefunds here is computationally expensive if not already done.


      // Return a new order object with filtered items and recalculated totals
      return {
        ...order,
        items: filteredItems,
        totalAmount: finalCalculatedTotal, // This is now GROSS Sales (filtered by mode)
        total: finalCalculatedTotal,
        deliveryCharge: (proportionalFactor * deliveryCharge),
        allocatedDiscount: allocatedDiscount,
        proportionalFactor: proportionalFactor
      };
    }).filter(Boolean); // Remove nulls
  }, [rawSellerOrders, saleMode, state.refunds, sellerId]);

  // Filter orders by date range
  const filteredOrders = sellerOrders.filter(order => {
    const orderDate = new Date(getOrderDate(order));
    return orderDate >= startDate && orderDate < endDate;
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
    return orderDate >= startDate && orderDate < endDate;
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
  // Calculate profit from orders: profit = sum((sellingPrice - costPrice) * quantity) for each item
  // Profit = Total Sales Revenue (from orders) - Total Purchase Costs (from purchase orders)
  // Helper: Calculate Refund Impact (Revenue and Cost) for a specific period
  const calculateRefundImpact = (startDate, endDate) => {
    const toNumber = (value) => (typeof value === 'number' ? value : parseFloat(value)) || 0;

    const periodRefunds = (state.refunds || []).filter(refund => {
      // Filter by Seller
      if (sellerId) {
        const rSellerId = (refund.sellerId || '').toString();
        if (rSellerId && rSellerId !== sellerId.toString()) return false;
      }

      // Determine explicit refund date or fallback to order date
      let rDate = refund.createdAt || refund.date ? new Date(refund.createdAt || refund.date) : null;

      if (!rDate) {
        const orderId = (refund.orderId || refund.order_id || '').toString();
        const originalOrder = (state.orders || []).find(o => (o._id || o.id || '').toString() === orderId);
        if (originalOrder) {
          rDate = new Date(originalOrder.createdAt || originalOrder.date || 0);
        } else {
          rDate = new Date(0);
        }
      }
      return rDate >= startDate && rDate <= endDate;
    });

    let totalRefundRevenue = 0;
    let totalRefundCost = 0;

    periodRefunds.forEach(refund => {
      const orderId = (refund.orderId || refund.orderId || '').toString();
      // Find original order to get proportional factor or item costs
      const originalOrder = sellerOrders.find(o => (o._id || o.id || '').toString() === orderId);

      // If order is not in sellerOrders (e.g. filtered out by status), we might need to look in state.orders?
      // But sellerOrders contains all valid orders for the seller.
      // If originalOrder is found, we use its proportionalFactor (which handles Sale Mode)
      // If not found, we might treat it as full/raw refund? 
      // For consistency with "Sales", we should strictly use `sellerOrders` context.

      const propFactor = originalOrder ? (originalOrder.proportionalFactor ?? 1) : 0;

      // 1. Revenue Impact
      // Use refund's explicit total OR sum of items
      const refundAmt = Number(refund.totalRefundAmount || refund.amount || 0);
      totalRefundRevenue += (refundAmt * propFactor);

      // 2. Cost Impact (Cost Reversal)
      if (originalOrder && Array.isArray(refund.items) && refund.items.length > 0) {
        refund.items.forEach(ri => {
          // Only count costs for Normal vs Direct filtered items
          const riPid = (ri.productId || ri.product_id || ri._id || ri.id || '').toString();
          // Find matching item in originalOrder.items (which is already filtered by Mode!)
          // Or originalOrder.items might be the filtered list?
          // Yes, sellerOrders maps to filtered items.

          const matchedItem = (originalOrder.items || []).find(item => {
            const iPid = (item.productId || item.product_id || item._id || item.id || '').toString();
            const namesMatch = item.name && ri.name && item.name.trim().toLowerCase() === ri.name.trim().toLowerCase();
            // We rely on ID matching mostly
            return riPid === iPid || (namesMatch);
          });

          if (matchedItem) {
            const qty = Number(ri.qty || 0);
            const originalQty = Number(matchedItem.quantity || 1);
            const unitCost = toNumber(matchedItem.totalCostPrice ?? matchedItem.costPrice) / (originalQty || 1);
            totalRefundCost += (qty * unitCost);
          }
        });
      } else if (originalOrder) {
        // Lump sum refund cost impact? Hard to guess.
        // Assume 0 cost reversal to be conservative (Profit drops by full refund amount)
      }
    });

    return { revenue: totalRefundRevenue, cost: totalRefundCost };
  };

  // Calculate GROSS profit from orders (Revenue - Cost)
  // Does NOT subtract refunds.
  const calculateGrossMarginFromOrders = (orders) => {
    const toNumber = (value) => (typeof value === 'number' ? value : parseFloat(value)) || 0;

    return orders.reduce((totalGrossProfit, order) => {
      const netRevenue = toNumber(order.totalAmount || 0); // This is now Gross

      const items = Array.isArray(order.items) ? order.items : [];
      const grossCost = items.reduce((sum, item) => {
        return sum + toNumber(item.totalCostPrice ?? item.costPrice ?? 0);
      }, 0);

      return totalGrossProfit + (netRevenue - grossCost);
    }, 0);
  };

  // Calculate profit for a specific date range
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

    const grossMargin = calculateGrossMarginFromOrders(filteredOrders);
    const refundImpact = calculateRefundImpact(startDate, endDate);

    // Use order items profit calculation (more accurate)
    const expenseCost = saleMode === 'direct' ? 0 : filteredPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0);
    return grossMargin - (refundImpact.revenue - refundImpact.cost) - expenseCost;
  };

  // Calculate low stock products
  const lowStockProducts = state.products.filter(product => {
    const threshold = (product.lowStockLevel !== undefined && product.lowStockLevel !== null) ? Number(product.lowStockLevel) : (state.lowStockThreshold || 10);
    return (product.quantity || product.stock || 0) <= threshold;
  });

  // Calculate expiring products
  const expiringProducts = state.products.filter(product => {
    // Determine threshold: use product specific if available, else global
    const thresholdDays = (product.expiryThreshold !== undefined && product.expiryThreshold !== null) ? Number(product.expiryThreshold) : (state.expiryDaysThreshold || 30);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check batches first
    if (product.batches && product.batches.length > 0) {
      return product.batches.some(b => {
        const qty = Number(b.quantity) || 0;
        if (qty <= 0 || !b.expiry) return false;
        const expiryDate = new Date(b.expiry);
        expiryDate.setHours(0, 0, 0, 0);
        const diffTime = expiryDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Include if expired or expiring within threshold
        return diffDays <= thresholdDays;
      });
    }

    // Fallback to product level expiry
    if (!product.expiryDate) return false;
    const expiryDate = new Date(product.expiryDate);
    const diffTime = expiryDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Include if expired or expiring within threshold. 
    // Previously it filtered diffDays >= 0, but expired products should also be alerted.
    return diffDays <= thresholdDays;
  });

  // Calculate pending payments (using dueAmount field from database)
  const pendingPayments = state.customers.filter(customer =>
    (customer.dueAmount || customer.balanceDue || 0) > 0
  ).length;

  // Calculate total profit (all time) using orders and purchase orders
  // Calculate total profit (all time)
  const totalPettyExpenses = (Array.isArray(expenses) ? expenses : []).reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);

  const allTimeRefundImpact = calculateRefundImpact(new Date(0), new Date());

  // In Direct Sale mode, we only check the profit from the items themselves (Revenue - Cost), ignoring general store expenses/POs
  const totalProfit = calculateGrossMarginFromOrders(sellerOrders) -
    (allTimeRefundImpact.revenue - allTimeRefundImpact.cost) -
    (saleMode === 'direct' ? 0 : sellerPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0)) -
    (saleMode === 'direct' ? 0 : totalPettyExpenses);

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

  const todayGrossMargin = calculateGrossMarginFromOrders(todayOrders);
  const todayRefundImpact = calculateRefundImpact(todayStart, todayEnd);

  const todayProfit = todayGrossMargin -
    (todayRefundImpact.revenue - todayRefundImpact.cost) -
    (saleMode === 'direct' ? 0 : todayPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0)) -
    (saleMode === 'direct' ? 0 : todayExpenses);

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
      case 'custom': {
        const startDate = new Date(customDateRange.start);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(customDateRange.end);
        endDate.setHours(23, 59, 59, 999);
        return { startDate, endDate };
      }
      case '1y':
      case 'all':
        return { startDate: new Date(0), endDate: todayEnd };
      default:
        return { startDate: todayStart, endDate: todayEnd };
    }
  };

  // Calculate sales for current timeRange (Net Sales = Sales - Refund Revenue)
  const getSalesForPeriod = () => {
    const { startDate, endDate } = getPeriodDateRange();
    const periodOrders = sellerOrders.filter(order => {
      const orderDate = new Date(getOrderDate(order));
      return orderDate >= startDate && orderDate < endDate;
    });
    const grossSales = periodOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const refundImpact = calculateRefundImpact(startDate, endDate);
    return grossSales - refundImpact.revenue;
  };

  // Calculate net profit for current timeRange
  const getNetProfitForPeriod = () => {
    const { startDate, endDate } = getPeriodDateRange();

    // Filter Orders
    const periodOrders = sellerOrders.filter(order => {
      const orderDate = new Date(getOrderDate(order));
      return orderDate >= startDate && orderDate < endDate;
    });

    const grossMargin = calculateGrossMarginFromOrders(periodOrders);

    // Calculate Refund Impact for this period
    const refundImpact = calculateRefundImpact(startDate, endDate);
    // Net Profit = (GrossMargin) - (RefundRevenue - RefundCost)
    const netProfitAfterRefunds = grossMargin - (refundImpact.revenue - refundImpact.cost);

    // In Direct Sale mode, Net Profit = Sales Profit (adjusted for refunds)
    if (saleMode === 'direct') {
      return netProfitAfterRefunds;
    }

    // Filter Petty Expenses
    const periodExpenses = (Array.isArray(expenses) ? expenses : []).filter(exp => {
      const expDate = new Date(exp.date || exp.createdAt);
      return expDate >= startDate && expDate < endDate;
    });

    const pettyExpensesCost = periodExpenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);

    return netProfitAfterRefunds - pettyExpensesCost;
  };

  // Calculate purchase orders count and value for current timeRange
  const getPurchaseOrdersForPeriod = () => {
    // In Direct Sale mode, Purchase Orders are not relevant
    if (saleMode === 'direct') {
      return { count: 0, value: 0 };
    }

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

  // Calculate sales profit (Net Gross Profit)
  const getSalesProfitForPeriod = () => {
    const { startDate, endDate } = getPeriodDateRange();
    const periodOrders = sellerOrders.filter(order => {
      const orderDate = new Date(getOrderDate(order));
      return orderDate >= startDate && orderDate < endDate;
    });
    // Gross Margin from orders (Revenue - COGS)
    const grossMargin = calculateGrossMarginFromOrders(periodOrders);

    // Subtract Refund Impact (Revenue - Cost)
    const refundImpact = calculateRefundImpact(startDate, endDate);

    // Net Gross Profit = Gross Margin - (Refund Rev - Refund Cost)
    return grossMargin - (refundImpact.revenue - refundImpact.cost);
  };

  const getSalesProfitMarginForPeriod = () => {
    const grossProfit = getSalesProfitForPeriod();
    const sales = getSalesForPeriod();
    return sales > 0 ? (grossProfit / sales) * 100 : 0;
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

  const monthlySales = monthlyOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0) - calculateRefundImpact(monthStart, monthEnd).revenue;
  // Monthly Profit = Gross Profit (Net of refunds)
  const monthlyRefundImpact = calculateRefundImpact(monthStart, monthEnd);
  const monthlyProfit = calculateGrossMarginFromOrders(monthlyOrders) - (monthlyRefundImpact.revenue - monthlyRefundImpact.cost);

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
    (ordersToUse || []).forEach(order => {
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
      { value: 'today', label: getTranslation('today', state.currentLanguage) },
      { value: '7d', label: getTranslation('last7Days', state.currentLanguage) },
      { value: '30d', label: getTranslation('last30Days', state.currentLanguage) },
      { value: 'custom', label: getTranslation('custom', state.currentLanguage) },
      { value: '1y', label: getTranslation('allTime', state.currentLanguage) }
    ];
    const option = options.find(opt => opt.value === period);
    if (period === 'custom') {
      return `${formatDate(customDateRange.start)} - ${formatDate(customDateRange.end)}`;
    }
    return option ? option.label : 'Today';
  };


  // Calculate total refunds for the selected period (collective across all modes)
  const totalRefundsForPeriod = useMemo(() => {
    const { startDate, endDate } = getPeriodDateRange();
    // Filter refunds by date range and seller only, ignoring sale mode
    const periodRefunds = (state.refunds || []).filter(refund => {
      if (sellerId) {
        const rSellerId = (refund.sellerId || '').toString();
        if (rSellerId && rSellerId !== sellerId.toString()) return false;
      }

      let rDate = refund.createdAt || refund.date ? new Date(refund.createdAt || refund.date) : null;
      if (!rDate) {
        const orderId = (refund.orderId || refund.order_id || '').toString();
        const originalOrder = (state.orders || []).find(o => (o._id || o.id || '').toString() === orderId);
        if (originalOrder) {
          rDate = new Date(originalOrder.createdAt || originalOrder.date || 0);
        } else {
          rDate = new Date(0);
        }
      }
      return rDate >= startDate && rDate <= endDate;
    });

    return periodRefunds.reduce((sum, refund) => sum + Number(refund.totalRefundAmount || refund.amount || 0), 0);
  }, [state.refunds, state.orders, sellerId, timeRange, customDateRange]);

  // Comprehensive stats array (all controlled by single timeRange)
  const purchaseOrdersData = getPurchaseOrdersForPeriod();
  const stats = [
    {
      name: getTranslation('totalCustomers', state.currentLanguage),
      value: totalCustomers,
      icon: Users,
      description: getTranslation('activeCustomers', state.currentLanguage),
      theme: 'primary',
      onClick: () => goToView('customers')
    },
    {
      name: getTranslation('totalProducts', state.currentLanguage),
      value: totalProducts,
      icon: Package,
      description: getTranslation('itemsInInventory', state.currentLanguage),
      theme: 'teal',
      onClick: () => goToView('products')
    },
    {
      name: getTranslation('sales', state.currentLanguage),
      value: formatNumber(getSalesForPeriod()),
      icon: Wallet,
      description: `${getTranslation('sales', state.currentLanguage)} - ${getPeriodLabel(timeRange)}`,
      theme: 'emerald', // Sales = Income = Green
      onClick: () => goToView('salesOrderHistory')
    },
    {
      name: 'Refunds',
      value: formatNumber(totalRefundsForPeriod),
      icon: XCircle,
      description: `Total Refunds - ${getPeriodLabel(timeRange)}`,
      theme: 'rose',
      onClick: () => goToView('refunds')
    },
    {
      name: getTranslation('netProfit', state.currentLanguage),
      value: formatNumber(getNetProfitForPeriod()),
      icon: TrendingUp,
      description: `${getTranslation('netProfit', state.currentLanguage)} - ${getPeriodLabel(timeRange)}`,
      theme: getNetProfitForPeriod() >= 0 ? 'emerald' : 'rose', // Dynamic Green/Red
      onClick: () => goToView('financial')
    },
    {
      name: getTranslation('balanceDue', state.currentLanguage),
      value: formatNumber(totalBalanceDue),
      icon: CreditCard,
      description: getTranslation('outstandingPayments', state.currentLanguage),
      theme: 'rose', // Due = Debt/Risk = Red
      onClick: () => goToView('customers')
    },
    {
      name: getTranslation('purchaseOrders', state.currentLanguage),
      value: `${purchaseOrdersData.count}`, // Count is neutral
      icon: Truck,
      description: `${getPeriodLabel(timeRange)}`,
      theme: 'slate', // Count is neutral (White/Slate)
      secondaryValue: formatNumber(purchaseOrdersData.value), // Value is Expense (Red) - handled in render
      onClick: () => goToView('purchase')
    },
    {
      name: getTranslation('grossProfit', state.currentLanguage) || 'Gross Profit',
      value: formatNumber(getSalesProfitForPeriod()),
      icon: TrendingUp,
      description: `${getTranslation('grossProfit', state.currentLanguage) || 'Gross Profit'} - ${getPeriodLabel(timeRange)}`,
      theme: getSalesProfitForPeriod() >= 0 ? 'emerald' : 'rose', // Dynamic Green/Red
      onClick: () => goToView('financial')
    },
    {
      name: getTranslation('grossProfitMargin', state.currentLanguage) || 'Gross Profit Margin',
      value: `${getSalesProfitMarginForPeriod().toFixed(1)}%`,
      icon: TrendingUp,
      description: `${getTranslation('grossProfitMargin', state.currentLanguage) || 'Gross Profit Margin'} - ${getPeriodLabel(timeRange)}`,
      theme: getSalesProfitMarginForPeriod() >= 0 ? 'emerald' : 'rose', // Dynamic Green/Red
      onClick: () => goToView('financial')
    }
  ];



  const quickActions = [
    {
      key: 'billing',
      label: getTranslation('newBill', state.currentLanguage),
      description: getTranslation('generateInvoiceInstantly', state.currentLanguage),
      icon: ShoppingCart,
      gradient: 'linear-gradient(135deg, rgba(47,60,126,0.92), rgba(31,40,88,0.94))',
      onClick: () => goToView('billing')
    },
    {
      key: 'products',
      label: getTranslation('addProduct', state.currentLanguage),
      description: getTranslation('expandYourCatalog', state.currentLanguage),
      icon: Package,
      gradient: 'linear-gradient(135deg, rgba(99,102,241,0.88), rgba(76,29,149,0.92))',
      onClick: () => goToView('products')
    },
    {
      key: 'customers',
      label: getTranslation('addCustomer', state.currentLanguage),
      description: getTranslation('captureBuyerDetails', state.currentLanguage),
      icon: Users,
      gradient: 'linear-gradient(135deg, rgba(16,185,129,0.88), rgba(4,120,87,0.92))',
      onClick: () => goToView('customers')
    },
    {
      key: 'purchase',
      label: getTranslation('purchaseOrder', state.currentLanguage),
      description: getTranslation('replenishInventoryFast', state.currentLanguage),
      icon: Truck,
      gradient: 'linear-gradient(135deg, rgba(244,162,89,0.9), rgba(217,119,6,0.92))',
      onClick: () => goToView('purchase')
    }
  ];

  const timeRangeOptions = [
    { value: 'today', label: getTranslation('today', state.currentLanguage) },
    { value: '7d', label: getTranslation('last7Days', state.currentLanguage) },
    { value: '30d', label: getTranslation('last30Days', state.currentLanguage) },
    { value: 'custom', label: getTranslation('custom', state.currentLanguage) }
  ];

  return (
    <div className={`space-y-6 pb-6 animate-in fade-in duration-500 ${(!isProfileCompleted && !forceHideModal) ? 'blur-sm pointer-events-none select-none overflow-hidden h-screen' : ''}`}>
      {/* Welcome Section with Floating Boxes - Hidden on Mobile */}
      <div className="hidden lg:block" />

      {/* Animated Carousel Banner */}
      {CAROUSEL_SLIDES.length > 0 && (
        <>
          <div
            className="relative group overflow-hidden touch-pan-y"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <div
              className="flex transition-transform duration-700 ease-in-out cursor-grab active:cursor-grabbing"
              style={{ transform: `translateX(-${currentSlide * 100}%)` }}
            >
              {CAROUSEL_SLIDES.map((slide, idx) => (
                <div key={idx} className="w-full flex-shrink-0">
                  <div
                    className={`rounded-xl border-2 p-4 sm:p-5 min-h-[120px] sm:min-h-[100px] h-full flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all cursor-pointer hover:shadow-md ${slide.color}`}
                    onClick={() => {
                      if (slide.isSubscription) goToView('upgrade');
                      else if (slide.action) slide.action();
                    }}
                  >
                    <div className="flex items-start sm:items-center space-x-3 sm:space-x-4 flex-1">
                      <div className="p-2 bg-white/50 rounded-lg hidden sm:block">
                        <slide.icon className="h-6 w-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-lg sm:text-xl lg:text-2xl leading-tight">
                          {slide.title}
                        </p>
                        <p className="text-sm sm:text-base opacity-90 mt-1">
                          {slide.subtitle}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 sm:gap-4 lg:ml-4">
                      {slide.isSubscription && (expiryCountdown || daysRemaining === 0) && (
                        <div className="flex items-center gap-2">
                          {[
                            { label: 'Days', value: expiryCountdown?.days || 0 },
                            { label: 'Hrs', value: expiryCountdown?.hours || 0 },
                            { label: 'Min', value: expiryCountdown?.minutes || 0 },
                            { label: 'Sec', value: expiryCountdown?.seconds || 0 },
                          ].map((segment) => (
                            <div key={segment.label} className="bg-white/95 text-gray-900 rounded-lg px-2 py-1.5 min-w-[50px] text-center shadow-md">
                              <div className="text-base font-bold leading-none">{formatCountdownValue(segment.value)}</div>
                              <div className="text-[9px] uppercase font-bold text-gray-500 mt-1">{segment.label}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {slide.isSubscription ? (
                        daysRemaining <= 3 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              goToView('upgrade');
                            }}
                            className="w-full sm:w-auto px-6 py-2.5 bg-[#1b1b1b] text-white rounded-xl hover:bg-[#252525] transition-all text-sm font-bold whitespace-nowrap shadow-xl flex items-center justify-center gap-2"
                          >
                            <CreditCard className="h-5 w-5" />
                            {getTranslation('rechargeNow', state.currentLanguage)}
                          </button>
                        )
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            slide.action();
                          }}
                          className="w-full sm:w-auto px-6 py-2.5 bg-white text-gray-900 rounded-xl hover:bg-gray-100 transition-all text-sm font-bold whitespace-nowrap shadow-lg flex items-center justify-center gap-2"
                        >
                          {slide.buttonIcon ? <slide.buttonIcon className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" />}
                          {slide.actionLabel}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Carousel Indicators (Dots) - Moved outside */}
          {CAROUSEL_SLIDES.length > 1 && (
            <div className="flex justify-center gap-2 mt-3 mb-1">
              {CAROUSEL_SLIDES.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentSlide(idx)}
                  className={`h-2 rounded-full transition-all duration-300 ${currentSlide === idx
                    ? 'w-6 bg-slate-800 dark:bg-white'
                    : 'w-2 bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 dark:hover:bg-slate-500'
                    }`}
                  aria-label={`Go to slide ${idx + 1}`}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* NEW: Dedicated Update Application Banner (Moved here) */}
      {updateAvailable && (
        <div className="relative group overflow-hidden rounded-2xl border border-blue-200 dark:border-blue-900/50 bg-gradient-to-r from-blue-50/80 via-white/80 to-indigo-50/80 dark:from-blue-950/20 dark:via-slate-900/40 dark:to-indigo-950/20 p-4 sm:p-5 shadow-sm backdrop-blur-md animate-in slide-in-from-top duration-500">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full animate-pulse"></div>
                <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg">
                  <Zap className="h-6 w-6 fill-current" />
                </div>
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                  Software Update Available
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Version {APP_VERSION} is ready. Upgrade now to get the latest features and security patches.
                </p>
              </div>
            </div>

            <button
              onClick={async () => {
                setIsUpdating(true);
                // Artificial delay to show animation (optional but good for UX)
                await new Promise(resolve => setTimeout(resolve, 800));
                await update();
              }}
              disabled={isUpdating}
              className={`group relative flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white transition-all hover:bg-slate-800 active:scale-95 dark:bg-blue-600 dark:hover:bg-blue-500 shadow-xl ${isUpdating ? 'opacity-90 cursor-wait' : ''}`}
            >
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20 scale-x-0 transition-transform group-hover:scale-x-100"></div>
              {isUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  <span>Update</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Controls Section: Sale Mode & Time Range */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{getTranslation('businessOverview', state.currentLanguage)}</h1>

        <div className="flex flex-col sm:flex-row gap-3">
          {/* Sale Mode Toggle */}
          <div className="flex flex-wrap items-center justify-center gap-1 w-full sm:w-auto sm:inline-flex rounded-xl sm:rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 p-1 shadow-sm backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setSaleMode('normal')}
              className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm whitespace-nowrap ${saleMode === 'normal'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
            >
              Normal Sale
            </button>
            <button
              type="button"
              onClick={() => setSaleMode('direct')}
              className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm whitespace-nowrap ${saleMode === 'direct'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
            >
              Direct Sale
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1 w-full sm:w-auto sm:inline-flex rounded-xl sm:rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 p-1 shadow-sm backdrop-blur-sm">
            {timeRangeOptions.map((option) => {
              const isActive = timeRange === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    if (option.value === 'custom') {
                      setTempCustomRange({ ...customDateRange });
                      setShowCustomDateModal(true);
                    } else {
                      setTimeRange(option.value);
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm ${isActive
                    ? 'bg-gradient-to-r from-slate-900 to-slate-900 text-white shadow'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-700'
                    }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
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
              onClick={stat.onClick}
              className={`stat-card animate-float-up group transition-all duration-300 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md ${stat.onClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50' : ''}`}
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
                    {/* Color Logic: Emerald=Green, Rose=Red, Others=Default(White/Black) */}
                    <p className={`text-2xl font-semibold whitespace-nowrap overflow-x-auto scrollbar-hide ${stat.theme === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' :
                      stat.theme === 'rose' ? 'text-rose-600 dark:text-rose-400' :
                        'text-slate-900 dark:text-white'
                      }`} title={typeof stat.value === 'string' || typeof stat.value === 'number' ? stat.value : ''}>
                      {stat.value}
                    </p>
                    {stat.secondaryValue && (
                      <p className={`text-sm font-medium mt-1 ${stat.name === 'Purchase Orders' ? 'text-rose-600' : 'text-slate-600 dark:text-slate-400'
                        }`}>
                        {getTranslation('valueLabel', state.currentLanguage)}: {stat.secondaryValue}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-2 text-xs text-gray-500 dark:text-slate-500">
                {stat.description}
              </div>

              {stat.onClick && (
                <div className="flex justify-end mt-4">
                  <div className="flex items-center text-xs font-semibold text-blue-600 dark:text-blue-400 group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                    <span className="mr-1">{getTranslation('viewDetails', state.currentLanguage)}</span>
                    <ArrowRight className="h-3 w-3" />
                  </div>
                </div>
              )}
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
            {getTranslation('importantAlerts', state.currentLanguage)}
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
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-yellow-800 dark:text-yellow-200">
                    {lowStockProducts.length} {getTranslation('productsLowInStock', state.currentLanguage)}
                  </p>
                  <p className="text-sm text-yellow-600 dark:text-yellow-300 truncate">
                    {lowStockProducts.slice(0, 3).map(product => product.name).join(', ')}
                    {lowStockProducts.length > 3 && ` ${getTranslation('andXMore', state.currentLanguage).replace('{count}', lowStockProducts.length - 3)}`}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-yellow-400 ml-auto flex-shrink-0" />
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
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-red-800 dark:text-red-200">
                    {expiringProducts.length} {getTranslation('productsExpiringSoon', state.currentLanguage)}
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-300 truncate">
                    {expiringProducts.slice(0, 3).map(product => product.name).join(', ')}
                    {expiringProducts.length > 3 && ` ${getTranslation('andXMore', state.currentLanguage).replace('{count}', expiringProducts.length - 3)}`}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-red-200 ml-auto flex-shrink-0" />
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
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-blue-800 dark:text-blue-200">
                    {pendingPayments} {getTranslation('customersHavePendingPayments', state.currentLanguage)}
                  </p>
                  <p className="text-sm text-blue-600 dark:text-blue-300 truncate">
                    {getTranslation('totalOutstanding', state.currentLanguage)}: {formatNumber(totalBalanceDue)}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-blue-200 ml-auto flex-shrink-0" />
              </div>
            )}

            {lowStockProducts.length === 0 && expiringProducts.length === 0 && pendingPayments === 0 && (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Award className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <p className="text-green-600 dark:text-green-400 font-semibold">{getTranslation('allGoodNoAlerts', state.currentLanguage)}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inventory Insights Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center">
            <Package className="h-5 w-5 mr-2 text-slate-900 dark:text-slate-100" />
            {getTranslation('inventoryInsights', state.currentLanguage)}
          </h3>
          <span className="text-xs font-medium px-2 py-1 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded-lg">
            {getPeriodLabel(timeRange)}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-6">
          {/* Low Stock Items */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-yellow-600" />
              {getTranslation('lowStockItems', state.currentLanguage)}
            </h4>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {lowStockProducts.length > 0 ? (
                lowStockProducts.slice(0, 10).map((product, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">{product.name}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('stock', state.currentLanguage)}: {product.quantity || product.stock || 0} {product.unit || getTranslation('units', state.currentLanguage)}</p>
                    </div>
                    <p className="text-xs font-semibold text-yellow-600 dark:text-yellow-400">{getTranslation('lowStock', state.currentLanguage)}</p>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 dark:text-slate-400 text-center py-4">{getTranslation('noLowStockItems', state.currentLanguage)}</p>
              )}
            </div>
          </div>

          {/* Fast-moving Items */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
              <TrendingUp className="h-5 w-5 mr-2 text-green-600" />
              {getTranslation('fastMovingItems', state.currentLanguage)}
            </h4>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {fastMovingProducts.length > 0 ? (
                fastMovingProducts.map((product, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">{product.name}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('sold', state.currentLanguage)}: {product.salesCount || 0} {product.unit || getTranslation('units', state.currentLanguage)} ({getPeriodLabel(timeRange)})</p>
                    </div>
                    <p className="text-xs font-semibold text-green-600 dark:text-green-400">{getTranslation('fastMoving', state.currentLanguage)}</p>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 dark:text-slate-400 text-center py-4">{getTranslation('noFastMovingItems', state.currentLanguage)}</p>
              )}
            </div>
          </div>

          {/* Slow-moving Items */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
              <TrendingDown className="h-5 w-5 mr-2 text-orange-600" />
              {getTranslation('slowMovingItems', state.currentLanguage)}
            </h4>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {slowMovingProducts.length > 0 ? (
                slowMovingProducts.map((product, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">{product.name}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('stock', state.currentLanguage)}: {product.quantity || product.stock || 0} {product.unit || getTranslation('units', state.currentLanguage)}</p>
                    </div>
                    <p className="text-xs font-semibold text-orange-600 dark:text-orange-400">{getTranslation('slowMoving', state.currentLanguage)}</p>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 dark:text-slate-400 text-center py-4">{getTranslation('noSlowMovingItems', state.currentLanguage)}</p>
              )}
            </div>
          </div>

          {/* Dead Stock */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
              <AlertCircle className="h-5 w-5 mr-2 text-red-600" />
              {getTranslation('deadStock', state.currentLanguage)} {getTranslation('deadStockSubtitle', state.currentLanguage)}
            </h4>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {deadStock.length > 0 ? (
                deadStock.slice(0, 10).map((product, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">{product.name}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('stock', state.currentLanguage)}: {product.quantity || product.stock || 0} {product.unit || getTranslation('units', state.currentLanguage)}</p>
                    </div>
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">{getTranslation('deadStock', state.currentLanguage)}</p>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 dark:text-slate-400 text-center py-4">{getTranslation('noDeadStock', state.currentLanguage)}</p>
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
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">{getTranslation('transactionDetails', state.currentLanguage)}</p>
                <h4 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {selectedTransaction.customerName || getTranslation('walkInCustomer', state.currentLanguage)}
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
                  {getTranslation('share', state.currentLanguage)}
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
                  <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('date', state.currentLanguage)}</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatDateTime(selectedTransaction.createdAt || selectedTransaction.date)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('customerNameLabel', state.currentLanguage)}</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {selectedTransaction.customerName || getTranslation('walkInCustomer', state.currentLanguage)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('customerMobile', state.currentLanguage)}</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {selectedTransaction.customerMobile || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('paymentMethod', state.currentLanguage)}</p>
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
                        <p className="text-sm text-gray-600 dark:text-slate-400 mb-2">{getTranslation('splitPaymentBreakdown', state.currentLanguage)}</p>
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
                  <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('totalAmount', state.currentLanguage)}</p>
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
                          {getTranslation('itemHeader', state.currentLanguage)}
                        </th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                          {getTranslation('qtyHeader', state.currentLanguage)}
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                          {getTranslation('rateHeader', state.currentLanguage)}
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                          {getTranslation('totalHeader', state.currentLanguage)}
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
                  <p className="text-xs uppercase tracking-wide text-primary-600 dark:text-primary-400 mb-1">{getTranslation('note', state.currentLanguage)}</p>
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
                {getTranslation('close', state.currentLanguage)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New ERP Features Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center">
            <Zap className="h-5 w-5 mr-2 text-[var(--brand-primary)]" />
            {getTranslation('quickActions', state.currentLanguage)}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {quickActions.map((action) => {
              const Icon = action.icon;
              const isPlanRestricted = isPlanExpired(state);

              return (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => {
                    if (isPlanRestricted) {
                      if (window.showToast) {
                        window.showToast(`Access Restricted: A base subscription plan is required to use ${action.label}.`, 'warning');
                      }
                      return;
                    }
                    action.onClick();
                  }}
                  className={`group relative overflow-hidden rounded-2xl border border-white/20 p-5 text-left text-white shadow-lg transition-all duration-300 focus:outline-none ${isPlanRestricted ? 'opacity-60 cursor-not-allowed grayscale-[0.5]' : 'hover:-translate-y-1 hover:shadow-xl'
                    }`}
                  style={{ background: action.gradient }}
                  disabled={isPlanRestricted}
                >
                  {/* Decorative Background Icon */}
                  <div className="absolute -right-4 -bottom-4 opacity-10 rotate-12 transition-transform duration-500 group-hover:rotate-0 group-hover:scale-110 pointer-events-none">
                    <Icon className="h-28 w-28" />
                  </div>

                  <div className="relative z-10 flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-md shadow-inner text-white shrink-0 group-hover:scale-105 transition-transform duration-300">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-bold text-lg leading-tight truncate pr-2">{action.label}</h4>
                        {isPlanRestricted && <Lock className="h-3.5 w-3.5 text-white/70" />}
                      </div>
                      <p className="text-sm text-white/80 font-medium leading-relaxed line-clamp-2">
                        {action.description}
                      </p>
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
              {getTranslation('performanceMetrics', state.currentLanguage)}
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
                  <p className="font-semibold text-gray-900 dark:text-white">{getTranslation('salesEfficiency', state.currentLanguage)}</p>
                  <p className="text-xs text-gray-600 dark:text-slate-400">{getTranslation('transactionsPerDay', state.currentLanguage)}</p>
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
                  <p className="font-semibold text-gray-900 dark:text-white">{getTranslation('inventoryValue', state.currentLanguage)}</p>
                  <p className="text-xs text-gray-600 dark:text-slate-400">{getTranslation('totalStockValue', state.currentLanguage)}</p>
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
          className={`fixed inset-0 z-[1300] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isClosingAlertModal ? 'opacity-0' : 'animate-fadeIn'}`}
          onClick={handleCloseAlertModal}
        >
          <style>{`
                @keyframes slideUp {
                    from { transform: translateY(100%); }
                    to { transform: translateY(0); }
                }
                @keyframes slideDown {
                    from { transform: translateY(0); }
                    to { transform: translateY(100%); }
                }
            `}</style>
          <div
            key={isClosingAlertModal ? 'closing' : 'opening'}
            style={{ animation: `${isClosingAlertModal ? 'slideDown' : 'slideUp'} 0.4s ease-out forwards` }}
            className="bg-white dark:bg-slate-800 w-full h-[95vh] sm:h-auto sm:max-h-[90vh] sm:max-w-2xl rounded-none sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-gray-100 dark:border-slate-700 relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 px-4 py-4 sm:px-6 bg-gray-50/50 dark:bg-slate-700/50 gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={`p-2 rounded-xl scale-110 ${selectedAlert.type === 'lowStock' ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400' :
                  selectedAlert.type === 'expiring' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                    'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                  }`}>
                  {selectedAlert.type === 'lowStock' ? <AlertTriangle className="h-5 w-5" /> :
                    selectedAlert.type === 'expiring' ? <Clock className="h-5 w-5" /> :
                      <CreditCard className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-xl font-bold text-gray-900 dark:text-white leading-tight truncate">
                    {selectedAlert.type === 'lowStock' ? 'Low Stock Inventory' :
                      selectedAlert.type === 'expiring' ? 'Expiring Products' :
                        'Pending Payments'}
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-slate-400 font-medium truncate">
                    Showing {selectedAlert.data.length} {selectedAlert.type === 'pendingPayments' ? 'customers' : 'items'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseAlertModal}
                className="p-2 hover:bg-gray-200/50 dark:hover:bg-slate-600/50 rounded-full transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 active:scale-90"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 overflow-x-hidden w-full max-w-full scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-slate-600">
              <div className="flex flex-col gap-3">
                {selectedAlert.data.map((item, idx) => {
                  const isExpanded = expandedAlertItem === (item._id || item.id || idx);
                  return (
                    <div
                      key={item._id || item.id || idx}
                      className={`group p-3 sm:p-4 bg-white dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 rounded-2xl transition-all duration-200 hover:shadow-sm w-full overflow-hidden ${isExpanded ? 'ring-2 ring-indigo-500 dark:ring-indigo-400 bg-indigo-50/10' : 'hover:border-blue-100 dark:hover:border-blue-700 hover:bg-blue-50/40 dark:hover:bg-slate-700'}`}
                      onClick={() => {
                        if (selectedAlert.type === 'pendingPayments' || selectedAlert.type === 'lowStock') {
                          setExpandedAlertItem(isExpanded ? null : (item._id || item.id || idx));
                        }
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="h-12 w-12 rounded-2xl bg-gray-50 dark:bg-slate-700/50 border border-gray-100 dark:border-slate-600 flex-shrink-0 flex items-center justify-center text-gray-400 dark:text-slate-400">
                            {selectedAlert.type === 'pendingPayments' ? <Users className="h-6 w-6" /> : <Package className="h-6 w-6" />}
                          </div>
                          <div className="min-w-0 flex-1 pr-3">
                            <h5 className="font-bold text-gray-900 dark:text-white text-[15px] leading-tight break-words">
                              {item.name || item.shopName || item.customerName || 'Unknown'}
                            </h5>
                            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 flex items-center gap-1.5 font-medium truncate">
                              {selectedAlert.type === 'pendingPayments'
                                ? <><Smartphone className="h-3 w-3 text-blue-500" /> {item.mobileNumber || item.phone || 'N/A'}</>
                                : <><span className="text-yellow-500 text-[10px]">📁</span> {item.category || 'General'}</>}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={`text-xl font-bold ${selectedAlert.type === 'lowStock' ? 'text-yellow-600 dark:text-yellow-400' :
                            selectedAlert.type === 'expiring' ? 'text-red-500 dark:text-red-400' :
                              'text-blue-600 dark:text-blue-400'
                            }`}>
                            {selectedAlert.type === 'pendingPayments'
                              ? formatNumber(item.dueAmount || item.balanceDue || 0)
                              : `${item.quantity || item.stock || 0}`} <span className="text-sm font-semibold opacity-75">{selectedAlert.type !== 'pendingPayments' && (item.unit || 'units')}</span>
                          </p>
                          <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider flex items-center justify-end gap-1 mt-0.5">
                            {selectedAlert.type === 'lowStock' ? 'Current Stock' :
                              selectedAlert.type === 'expiring' ? `Exp: ${formatDate(item.expiryDate)}` :
                                'Balance Due'} <ChevronRight className="h-3 w-3" />
                          </div>
                        </div>
                      </div>

                      {/* Expanded Actions for Pending Payments */}
                      {
                        isExpanded && selectedAlert.type === 'pendingPayments' && (
                          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700 grid grid-cols-2 gap-3 animate-slide-down">
                            <a
                              href={`https://wa.me/91${(item.mobileNumber || item.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(
                                `Hello ${item.name || 'Customer'}, a gentle reminder from ${state.storeName || state.currentUser?.shopName || 'our shop'} that a payment of Rs. ${(item.dueAmount || item.balanceDue || 0).toFixed(2)} is pending. Please pay at your earliest convenience. Thank you, ${state.storeName || state.currentUser?.shopName || 'our shop'}`
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#25D366] text-white font-bold hover:bg-[#128C7E] transition-colors shadow-sm active:scale-95"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Share2 className="h-4 w-4" />
                              WhatsApp
                            </a>
                            <a
                              href={`tel:${item.mobileNumber || item.phone}`}
                              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500 text-white font-bold hover:bg-slate-900 transition-colors shadow-sm active:scale-95"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Smartphone className="h-4 w-4" />
                              Call
                            </a>
                          </div>
                        )
                      }

                      {/* Expanded Actions for Low Stock */}
                      {
                        isExpanded && selectedAlert.type === 'lowStock' && (
                          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700 animate-slide-down">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate('/products', { state: { openAddBatch: true, product: item } });
                              }}
                              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-colors shadow-sm active:scale-95"
                            >
                              <Plus className="h-4 w-4" />
                              Add Batch
                            </button>
                          </div>
                        )
                      }
                    </div>
                  );
                })}
              </div>
            </div>


          </div>
        </div>
      )
      }

      {/* Seller Registration Modal - Shows when profile is not completed */}
      <SellerRegistrationModal
        isOpen={finalShowRegistrationModal}
        onClose={() => {
          // Modal closes automatically when profileCompleted becomes true
          // This callback is only used if user manually closes (when allowed)
        }}
      />

      {/* Custom Date Modal */}
      {
        showCustomDateModal && (
          <div className="fixed inset-0 z-[1400] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-slideUp">
              <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                  <CalendarRange className="h-5 w-5 text-slate-900 dark:text-white" />
                  Custom Range
                </h3>
                <button
                  onClick={() => setShowCustomDateModal(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Start Date</label>
                  <input
                    type="date"
                    value={tempCustomRange.start}
                    onChange={e => setTempCustomRange({ ...tempCustomRange, start: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">End Date</label>
                  <input
                    type="date"
                    value={tempCustomRange.end}
                    onChange={e => setTempCustomRange({ ...tempCustomRange, end: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setCustomDateRange(tempCustomRange);
                      setTimeRange('custom');
                      setShowCustomDateModal(false);
                    }}
                    className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 font-bold rounded-xl transition-all shadow-lg"
                  >
                    Apply Range
                  </button>

                </div>
              </div>
            </div>
          </div>
        )
      }
    </div>
  );
};

export default Dashboard;

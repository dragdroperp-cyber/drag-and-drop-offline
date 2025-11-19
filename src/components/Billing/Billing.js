import React, { useState, useEffect, useRef } from 'react';
import { useApp, ActionTypes } from '../../context/AppContext';
import { 
  Plus, 
  ShoppingCart, 
  Receipt, 
  User, 
  Package,
  Trash2,
  Download,
  Calculator,
  QrCode,
  Share2,
  Mic,
  MicOff,
  X,
  Check
} from 'lucide-react';
import jsPDF from 'jspdf';
import { calculatePriceWithUnitConversion, checkStockAvailability, convertToBaseUnit, convertFromBaseUnit, getBaseUnit, isCountBasedUnit, isDecimalAllowedUnit, formatQuantityWithUnit } from '../../utils/unitConversion';
import QuantityModal from './QuantityModal';
import UPIPaymentModal from './UPIPaymentModal';
import SplitPaymentModal from './SplitPaymentModal';
import PaymentAndCustomerModal from './PaymentAndCustomerModal';
import { getTranslation } from '../../utils/translations';
import { getSellerIdFromAuth } from '../../utils/api';
import { getPlanLimits, canAddOrder, canAddCustomer, PLAN_FEATURES } from '../../utils/planUtils';
import { sanitizeMobileNumber, isValidMobileNumber } from '../../utils/validation';
import BarcodeScanner from '../BarcodeScanner/BarcodeScanner';
import syncService from '../../services/syncService';

// Helper function to get store functions (same as in AppContext)
const getStoreFunctions = (storeName) => {
  const { getAllItems, updateItem, deleteItem } = require('../../utils/indexedDB');
  const { STORES } = require('../../utils/indexedDB');
  
  const storeMap = {
    products: { 
      getAllItems: () => getAllItems(STORES.products), 
      updateItem: (item) => updateItem(STORES.products, item),
      deleteItem: (id) => deleteItem(STORES.products, id)
    },
    customers: { 
      getAllItems: () => getAllItems(STORES.customers), 
      updateItem: (item) => updateItem(STORES.customers, item),
      deleteItem: (id) => deleteItem(STORES.customers, id)
    },
    orders: { 
      getAllItems: () => getAllItems(STORES.orders), 
      updateItem: (item) => updateItem(STORES.orders, item)
    },
    transactions: { 
      getAllItems: () => getAllItems(STORES.transactions), 
      updateItem: (item) => updateItem(STORES.transactions, item)
    },
    purchaseOrders: { 
      getAllItems: () => getAllItems(STORES.purchaseOrders), 
      updateItem: (item) => updateItem(STORES.purchaseOrders, item),
      deleteItem: (id) => deleteItem(STORES.purchaseOrders, id)
    },
    categories: { 
      getAllItems: () => getAllItems(STORES.categories), 
      updateItem: (item) => updateItem(STORES.categories, item),
      deleteItem: (id) => deleteItem(STORES.categories, id)
    }
  };
  
  return storeMap[storeName] || null;
};

const Billing = () => {
  const { state, dispatch } = useApp();
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customCustomerName, setCustomCustomerName] = useState('');
  const [customCustomerMobile, setCustomCustomerMobile] = useState('');
  const [billingMobile, setBillingMobile] = useState('');
  const [sendWhatsAppInvoice, setSendWhatsAppInvoice] = useState(false);
  const [isBillingMobileValid, setIsBillingMobileValid] = useState(true);
  const [useCustomName, setUseCustomName] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [billItems, setBillItems] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const barcodeInputRef = useRef(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const barcodeScanTimeoutRef = useRef(null);
  const scannerInputBufferRef = useRef('');
  const scannerInputTimerRef = useRef(null);
  const lastKeyTimeRef = useRef(0);
  const beepAudioRef = useRef(null);
  const cashRegisterAudioRef = useRef(null);
  const [showQRCode, setShowQRCode] = useState(false);
  const [qrCodeData, setQrCodeData] = useState(null);
  const [showUPIPayment, setShowUPIPayment] = useState(false);
  const [showSplitPayment, setShowSplitPayment] = useState(false);
  const [showPaymentAndCustomerModal, setShowPaymentAndCustomerModal] = useState(false);
  const [splitPaymentDetails, setSplitPaymentDetails] = useState(null);
  const [currentBill, setCurrentBill] = useState(null);
  const [pendingOrder, setPendingOrder] = useState(null);
  const isGeneratingBill = useRef(false);
  const finalizingOrders = useRef(new Set()); // Track orders currently being finalized
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [foundCustomers, setFoundCustomers] = useState([]);
  const sellerUpiId = (state.currentUser?.upiId || state.upiId || '').trim();
  const [upiIdDraft, setUpiIdDraft] = useState(sellerUpiId);
  const [isSavingUpi, setIsSavingUpi] = useState(false);
  const draftRestoredRef = useRef(false);
  const draftSyncEnabledRef = useRef(false);
  const lastDraftSnapshotRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const recognitionRef = useRef(null);
  const processedProductsRef = useRef(new Set());
  const shouldKeepListeningRef = useRef(false);
  const [showVoiceInstructions, setShowVoiceInstructions] = useState(false);
  const [dontShowAgainChecked, setDontShowAgainChecked] = useState(false);
  const billItemsRef = useRef(billItems);
  const accumulatedTranscriptRef = useRef('');
  const processTimeoutRef = useRef(null);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceModalTranscript, setVoiceModalTranscript] = useState('');
  const [removedItems, setRemovedItems] = useState(new Set());
  
  // Keep ref updated with current billItems
  useEffect(() => {
    billItemsRef.current = billItems;
  }, [billItems]);

  // Start voice recognition when modal opens
  useEffect(() => {
    if (showVoiceModal) {
      // Reset transcript and removed items
      accumulatedTranscriptRef.current = '';
      setVoiceModalTranscript('');
      setVoiceTranscript('');
      setRemovedItems(new Set());
      
      // Start voice recognition
      setTimeout(() => {
        actuallyStartVoiceRecognition();
      }, 100);
    } else {
      // Stop voice recognition when modal closes
      if (isListening) {
        stopVoiceRecognition();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVoiceModal]);

  const { maxOrders, maxCustomers } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
  const activeOrders = state.orders.filter(order => !order.isDeleted);
  const activeCustomers = state.customers.filter(customer => !customer.isDeleted);
  
  // CRITICAL: Prioritize currentPlan over currentPlanDetails.planName to avoid stale plan names
  // If currentPlan matches a known plan (basic, standard, premium), use that
  // Only use currentPlanDetails.planName if currentPlan doesn't match known plans
  const getPlanNameLabel = () => {
    if (state.currentPlan && PLAN_FEATURES[state.currentPlan]) {
      // Use currentPlan if it matches a known plan
      return `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}`;
    }
    // Fallback to currentPlanDetails.planName or currentPlan
    return state.currentPlanDetails?.planName
      || (state.currentPlan ? `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}` : 'Current');
  };
  const planNameLabel = getPlanNameLabel();
  
  // CRITICAL: Always use activeOrders.length (excludes deleted orders) for limit checking
  // Don't use currentPlanDetails.totalOrders as it may include deleted orders from backend
  const activeOrdersCount = activeOrders.length;
  const orderLimitReached = !canAddOrder(activeOrdersCount, state.currentPlan, state.currentPlanDetails);
  
  // Debug logging when limit is reached
  if (orderLimitReached) {
    console.log('[ORDER LIMIT REACHED CHECK]', {
      activeOrdersCount,
      maxOrders,
      currentPlan: state.currentPlan,
      totalOrdersFromDetails: state.currentPlanDetails?.totalOrders,
      allOrdersCount: state.orders.length,
      deletedOrdersCount: state.orders.filter(o => o.isDeleted).length,
      canAddResult: canAddOrder(activeOrdersCount, state.currentPlan, state.currentPlanDetails)
    });
  }
  
  const customerLimitReached = !canAddCustomer(activeCustomers.length, state.currentPlan, state.currentPlanDetails);
  const orderLimitLabel = maxOrders === Infinity ? 'Unlimited' : maxOrders;
  const customerLimitLabel = maxCustomers === Infinity ? 'Unlimited' : maxCustomers;
  // Use activeOrders.length instead of currentPlanDetails.totalOrders to exclude deleted orders
  const ordersUsed = activeOrdersCount;
  const customersUsed = activeCustomers.length;

  const showToast = (message, type = 'info', duration = 4000) => {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(message, type, duration);
    }
  };

  const validateQuantityForUnit = (rawQuantity, unit) => {
    const quantity = Number(rawQuantity);
    const normalizedUnit = unit?.toLowerCase?.() ?? 'pcs';

    if (!Number.isFinite(quantity)) {
      return { valid: false, message: 'Please enter a valid quantity.' };
    }

    if (quantity <= 0) {
      return { valid: false, message: 'Quantity must be greater than zero.' };
    }

    if (isCountBasedUnit(normalizedUnit)) {
      if (!Number.isInteger(quantity)) {
        return { valid: false, message: 'Quantity must be a whole number for pieces, packets and boxes.' };
      }
      return { valid: true, quantity };
    }

    if (isDecimalAllowedUnit(normalizedUnit)) {
      return { valid: true, quantity: parseFloat(quantity.toFixed(3)) };
    }

    return { valid: true, quantity: parseFloat(quantity.toFixed(3)) };
  };

  const openWhatsAppInvoice = (bill, mobile) => {
    const sanitized = sanitizeMobileNumber(mobile);
    if (!sanitized) {
      showToast('Mobile number is missing. Please add it before sending via WhatsApp.', 'warning');
      return;
    }

    if (!isValidMobileNumber(sanitized)) {
      showToast('Mobile number is incorrect. Please enter a valid 10-digit number starting with 6-9.', 'error');
      return;
    }

    const withCountryCode = `91${sanitized}`;

    const itemsSection = (bill.items || []).map((item, index) => {
      const unit = item.unit || item.quantityUnit || '';
      const lineTotal = getItemTotalAmount(item).toFixed(2);
      return `${index + 1}. ${item.name} • ${item.quantity} ${unit} x ₹${item.price.toFixed(2)} = ₹${lineTotal}`;
    }).join('\n');

    const discountAmount = ((bill.subtotal || 0) * (bill.discountPercent || 0)) / 100;
    const taxableBase = (bill.subtotal || 0) - discountAmount;
    const taxAmount = (taxableBase * (bill.taxPercent || 0)) / 100;

    const lines = [
      '✨ *Drag & Drop Billing* ✨',
      '',
      `🧾 *Invoice*: ${bill.id}`,
      `👤 *Customer*: ${bill.customerName}`,
      `💳 *Payment*: ${getPaymentMethodLabel(bill.paymentMethod || 'cash')}`,
      '',
      '*Items*',
      itemsSection || '—',
      '',
      `Subtotal: ₹${(bill.subtotal || 0).toFixed(2)}`,
      `Discount (${(bill.discountPercent || 0)}%): ₹${discountAmount.toFixed(2)}`,
      `Tax (${(bill.taxPercent || 0)}%): ₹${taxAmount.toFixed(2)}`,
      `*Total*: ₹${(bill.total || 0).toFixed(2)}`,
      '',
      `📅 ${new Date(bill.date || bill.createdAt || Date.now()).toLocaleString()}`,
      '',
      '🚀 Powered by *Drag & Drop*'
    ];
    const message = encodeURIComponent(lines.join('\n'));
    const url = `https://wa.me/${withCountryCode}?text=${message}`;
    window.open(url, '_blank');
  };

  const handleBillingMobileChange = (value) => {
    const sanitized = sanitizeMobileNumber(value);
    setBillingMobile(sanitized);

    if (sanitized.length === 0) {
      setIsBillingMobileValid(true);
      setShowCustomerModal(false);
      setFoundCustomers([]);
    } else {
      const isValid = isValidMobileNumber(sanitized);
      setIsBillingMobileValid(isValid);
      if (!isValid && sanitized.length === 10) {
        showToast(
          state.currentLanguage === 'hi'
            ? 'कृपया सही मोबाइल नंबर दर्ज करें (10 अंक, 6-9 से शुरू)।'
            : 'Please enter a valid 10-digit mobile number starting with 6-9.',
          'error'
        );
      }
      
      // Check if 10 digits and search for existing customers
      if (sanitized.length === 10 && isValidMobileNumber(sanitized)) {
        const matchingCustomers = activeCustomers.filter(customer => {
          const customerMobile = sanitizeMobileNumber(
            customer.mobileNumber || customer.phone || customer.phoneNumber || ''
          );
          return customerMobile === sanitized && customerMobile.length === 10;
        });
        
        if (matchingCustomers.length > 0) {
          setFoundCustomers(matchingCustomers);
          setShowCustomerModal(true);
        } else {
          setShowCustomerModal(false);
          setFoundCustomers([]);
        }
      } else {
        setShowCustomerModal(false);
        setFoundCustomers([]);
      }
    }

    if (useCustomName) {
      setCustomCustomerMobile(sanitized);
    } else if (selectedCustomer) {
      const customer = state.customers.find(
        (c) => c.id === selectedCustomer || c.name === selectedCustomer
      );

      if (customer) {
        const existingMobile =
          sanitizeMobileNumber(customer.mobileNumber || customer.phone || '');

        if (
          sanitized.length === 10 &&
          isValidMobileNumber(sanitized) &&
          sanitized !== existingMobile
        ) {
          dispatch({
            type: ActionTypes.UPDATE_CUSTOMER,
            payload: {
              ...customer,
              mobileNumber: sanitized,
              phone: sanitized,
              updatedAt: new Date().toISOString(),
            },
          });
        }
      }
    }
  };

  // Select existing customer from modal
  const selectExistingCustomer = (customer) => {
    if (customer) {
      setCustomCustomerName(customer.name);
      const mobile = sanitizeMobileNumber(customer.mobileNumber || customer.phone || customer.phoneNumber || '');
      setCustomCustomerMobile(mobile);
      setBillingMobile(mobile);
      setIsBillingMobileValid(true);
      setUseCustomName(true);
      setShowCustomerModal(false);
      setFoundCustomers([]);
    }
  };

  // Continue as new customer
  const continueAsNewCustomer = () => {
    setShowCustomerModal(false);
    setFoundCustomers([]);
  };

  useEffect(() => {
    if (draftRestoredRef.current) {
      return;
    }

    const draft = state.billingDraft;

    if (draft) {
      if (Array.isArray(draft.billItems)) {
        setBillItems(draft.billItems);
      }
      setSelectedCustomer(draft.selectedCustomer || '');
      setUseCustomName(Boolean(draft.useCustomName));
      setCustomCustomerName(draft.customCustomerName || '');
      const restoredCustomMobile = sanitizeMobileNumber(draft.customCustomerMobile || '');
      setCustomCustomerMobile(restoredCustomMobile);

      const normalizedBillingMobile = sanitizeMobileNumber(draft.billingMobile || '');
      setBillingMobile(normalizedBillingMobile);
      setIsBillingMobileValid(
        normalizedBillingMobile ? isValidMobileNumber(normalizedBillingMobile) : true
      );

      setSendWhatsAppInvoice(Boolean(draft.sendWhatsAppInvoice));
      const restoredDiscount = typeof draft.discount === 'number' ? draft.discount : Number(draft.discount || 0);
      const restoredTax = typeof draft.tax === 'number' ? draft.tax : Number(draft.tax || 0);
      setDiscount(restoredDiscount);
      setTax(restoredTax);
      setPaymentMethod(draft.paymentMethod || 'cash');

      const snapshot = {
        billItems: Array.isArray(draft.billItems) ? draft.billItems : [],
        selectedCustomer: draft.selectedCustomer || '',
        useCustomName: Boolean(draft.useCustomName),
        customCustomerName: draft.customCustomerName || '',
        customCustomerMobile: restoredCustomMobile,
        billingMobile: normalizedBillingMobile,
        sendWhatsAppInvoice: Boolean(draft.sendWhatsAppInvoice),
        discount: restoredDiscount,
        tax: restoredTax,
        paymentMethod: draft.paymentMethod || 'cash',
      };
      lastDraftSnapshotRef.current = JSON.stringify(snapshot);
    } else {
      lastDraftSnapshotRef.current = null;
    }

    draftRestoredRef.current = true;
    draftSyncEnabledRef.current = true;
  }, [state.billingDraft]);

  useEffect(() => {
    if (!draftRestoredRef.current || !draftSyncEnabledRef.current) {
      return;
    }

    const normalizedBillingMobile = sanitizeMobileNumber(billingMobile || '');
    const draftPayload = {
      billItems,
      selectedCustomer,
      useCustomName,
      customCustomerName,
      customCustomerMobile,
      billingMobile: normalizedBillingMobile,
      sendWhatsAppInvoice,
      discount: typeof discount === 'number' ? discount : Number(discount || 0),
      tax: typeof tax === 'number' ? tax : Number(tax || 0),
      paymentMethod,
    };

    const hasContent =
      (Array.isArray(billItems) && billItems.length > 0) ||
      Boolean((useCustomName ? customCustomerName : selectedCustomer)) ||
      Boolean(customCustomerMobile) ||
      Boolean(normalizedBillingMobile) ||
      (typeof discount === 'number' ? discount : Number(discount || 0)) !== 0 ||
      (typeof tax === 'number' ? tax : Number(tax || 0)) !== 0 ||
      paymentMethod !== 'cash' ||
      sendWhatsAppInvoice;

    const serialized = hasContent ? JSON.stringify(draftPayload) : null;

    if (serialized === lastDraftSnapshotRef.current) {
      return;
    }

    lastDraftSnapshotRef.current = serialized;
    dispatch({
      type: ActionTypes.SET_BILLING_DRAFT,
      payload: hasContent ? draftPayload : null,
    });
  }, [
    billItems,
    selectedCustomer,
    useCustomName,
    customCustomerName,
    customCustomerMobile,
    billingMobile,
    sendWhatsAppInvoice,
    discount,
    tax,
    paymentMethod,
    dispatch,
  ]);

  const scheduleBarcodeScan = (code) => {
    if (!code) return;
    if (barcodeScanTimeoutRef.current) {
      clearTimeout(barcodeScanTimeoutRef.current);
    }
    barcodeScanTimeoutRef.current = setTimeout(() => {
      handleBarcodeScan(code);
    }, 300); // Increased from 100ms to 300ms to ensure complete barcode capture
  };

  const showOrderLimitWarning = () => {
    // Debug info
    console.log('[ORDER LIMIT WARNING]', {
      activeOrdersCount: activeOrders.length,
      maxOrders: maxOrders,
      currentPlan: state.currentPlan,
      totalOrdersFromDetails: state.currentPlanDetails?.totalOrders,
      ordersInState: state.orders.length,
      deletedOrders: state.orders.filter(o => o.isDeleted).length
    });
    
    const message = `You've reached the order limit (${orderLimitLabel}) for the ${planNameLabel} plan. Upgrade your plan to create more orders instantly.`;
    showToast(message, 'warning');
  };

  const ensureOrderCapacity = () => {
    if (orderLimitReached) {
      showOrderLimitWarning();
      return false;
    }
    return true;
  };

  const showCustomerLimitWarning = () => {
    const message = `You've reached the customer limit (${customerLimitLabel}) for the ${planNameLabel} plan. Upgrade to store more customers.`;
    showToast(message, 'warning');
  };

  useEffect(() => {
    setUpiIdDraft(sellerUpiId);
  }, [sellerUpiId]);

  const handleSaveUpiId = () => {
    const trimmed = (upiIdDraft || '').trim();
    if (!trimmed) {
      showToast('Please enter your UPI ID.', 'error');
      return;
    }
    const upiRegex = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{3,}[a-zA-Z0-9]{0,}$/;
    if (!upiRegex.test(trimmed)) {
      showToast('Please enter a valid UPI ID (e.g., myshop@bank).', 'error');
      return;
    }
    setIsSavingUpi(true);
    dispatch({ type: ActionTypes.SET_UPI_ID, payload: trimmed });
    setIsSavingUpi(false);
    showToast('UPI ID saved for future online payments.', 'success');
  };

  // Create beep sound using Web Audio API (more reliable than MP3 file)
  useEffect(() => {
    const createBeepSound = () => {
      try {
        // Try to load the MP3 file first
        const audioPath = '/assets/beep-401570.mp3';
        const audio = new Audio(audioPath);
        audio.volume = 1.0; // 100% volume
        audio.preload = 'auto';
        
        audio.addEventListener('loadeddata', () => {
          console.log('✅ MP3 beep sound loaded successfully');
          beepAudioRef.current = audio;
        });
        
        audio.addEventListener('error', (e) => {
          console.warn('MP3 file failed, will use Web Audio API beep instead');
          // Fallback: Create beep using Web Audio API
          beepAudioRef.current = null; // Mark as null so we use Web Audio API
        });
        
        audio.load();
      } catch (error) {
        console.error('Error creating beep sound:', error);
      }
    };
    
    createBeepSound();
  }, []);

  // Preload cash register sound for bill generation
  useEffect(() => {
    const loadCashRegisterSound = async () => {
      try {
        const audioPath = '/assets/cash-register-kaching-376867.mp3';
        
        // Try to load the audio file using fetch first to ensure it's accessible
        try {
          const response = await fetch(audioPath);
          if (!response.ok) {
            console.warn('Cash register sound file not accessible:', audioPath);
            return;
          }
          
          // Create audio from blob URL for better compatibility
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          
          const audio = new Audio(blobUrl);
          audio.volume = 1.0; // 100% volume
          audio.preload = 'auto';
          
          audio.addEventListener('loadeddata', () => {
            console.log('✅ Cash register sound loaded successfully');
            cashRegisterAudioRef.current = audio;
          });
          
          audio.addEventListener('error', (e) => {
            console.warn('Cash register sound failed to load:', audio.error);
            if (audio.error) {
              console.warn('Audio error code:', audio.error.code, 'Message:', audio.error.message);
            }
            cashRegisterAudioRef.current = null;
            URL.revokeObjectURL(blobUrl);
          });
          
          audio.load();
        } catch (fetchError) {
          console.warn('Could not load cash register sound via fetch, trying direct path:', fetchError);
          // Fallback to direct path
          const audio = new Audio(audioPath);
          audio.volume = 1.0;
          audio.preload = 'auto';
          
          audio.addEventListener('loadeddata', () => {
            console.log('✅ Cash register sound loaded successfully (direct path)');
            cashRegisterAudioRef.current = audio;
          });
          
          audio.addEventListener('error', (e) => {
            console.warn('Cash register sound failed to load:', audio.error);
            cashRegisterAudioRef.current = null;
          });
          
          audio.load();
        }
      } catch (error) {
        console.error('Error loading cash register sound:', error);
      }
    };
    
    loadCashRegisterSound();
  }, []);

  useEffect(() => () => {
    if (barcodeScanTimeoutRef.current) {
      clearTimeout(barcodeScanTimeoutRef.current);
    }
    if (scannerInputTimerRef.current) {
      clearTimeout(scannerInputTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (useCustomName) {
      setBillingMobile(customCustomerMobile);
      setIsBillingMobileValid(
        customCustomerMobile ? isValidMobileNumber(customCustomerMobile) : true
      );
    } else if (selectedCustomer) {
      const selected = state.customers.find(c => c.id === selectedCustomer || c.name === selectedCustomer);
      const mobile = selected?.mobileNumber || selected?.phone || '';
      const sanitized = sanitizeMobileNumber(mobile);
      const normalized = sanitized.length > 10 ? sanitized.slice(-10) : sanitized;
      setBillingMobile(normalized);
      setIsBillingMobileValid(
        normalized ? isValidMobileNumber(normalized) : true
      );
    } else {
      setBillingMobile('');
      setIsBillingMobileValid(true);
    }
  }, [useCustomName, customCustomerMobile, selectedCustomer, state.customers]);

  // Get customers from state
  const allCustomers = state.customers;

  // Filter products based on search
  const filteredProducts = state.products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.category?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate totals
  const subtotal = billItems.reduce((sum, item) => sum + getItemTotalAmount(item), 0);
  const discountAmount = (subtotal * discount) / 100;
  const taxAmount = ((subtotal - discountAmount) * tax) / 100;
  const total = subtotal - discountAmount + taxAmount;

  const handleBarcodeScan = (barcode) => {
    console.log('Barcode scan handler called with:', barcode);
    console.log('All products:', state.products.map(p => ({ name: p.name, barcode: p.barcode })));
    
    const product = state.products.find(p => p.barcode === barcode);
    console.log('Found product:', product);
    
    if (product) {
      // Play beep sound when product is found
      const playBeepSound = () => {
        try {
          // Try to play the preloaded MP3 audio first
          if (beepAudioRef.current && beepAudioRef.current.readyState >= 2) {
            beepAudioRef.current.currentTime = 0;
            const playPromise = beepAudioRef.current.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => {
                  console.log('✅ Beep sound played successfully');
                })
                .catch(error => {
                  console.warn('MP3 playback failed, using Web Audio API:', error);
                  playWebAudioBeep();
                });
            }
          } else {
            // Fallback to Web Audio API beep
            playWebAudioBeep();
          }
        } catch (error) {
          console.error('Error playing beep sound:', error);
          playWebAudioBeep();
        }
      };
      
      // Create beep using Web Audio API (fallback)
      const playWebAudioBeep = () => {
        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          
          oscillator.frequency.value = 800; // Beep frequency (Hz)
          oscillator.type = 'sine';
          
          gainNode.gain.setValueAtTime(1.0, audioContext.currentTime); // 100% volume
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
          
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.1);
          
          console.log('✅ Web Audio API beep played');
        } catch (error) {
          console.error('Error creating Web Audio beep:', error);
        }
      };
      
      // Play sound
      playBeepSound();
      
      handleAddProduct(product); // Open quantity modal
    } else {
      const message = state.currentLanguage === 'hi' 
        ? `${getTranslation('productNotFound', state.currentLanguage)}: ${barcode}. ${getTranslation('pleaseAddProductFirst', state.currentLanguage)}.`
        : `${getTranslation('productNotFound', state.currentLanguage)}: ${barcode}. ${getTranslation('pleaseAddProductFirst', state.currentLanguage)}.`;
      showToast(message, 'error');
    }
    setBarcodeInput('');
  };

  // Auto-detect scanner input when billing page is open
  useEffect(() => {
    const handleScannerInput = (e) => {
      // Ignore if user is typing in an input field (except barcode input)
      const target = e.target;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const isBarcodeInput = target === barcodeInputRef.current;
      
      // If typing in other input fields, ignore
      if (isInputField && !isBarcodeInput) {
        return;
      }
      
      // Check if it's a printable character
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now();
        const timeSinceLastKey = now - lastKeyTimeRef.current;
        
        // If keys are coming very fast (< 100ms apart), it's likely a scanner (increased threshold)
        if (timeSinceLastKey < 100 || scannerInputBufferRef.current.length === 0) {
          scannerInputBufferRef.current += e.key;
          lastKeyTimeRef.current = now;
          
          // Clear existing timer
          if (scannerInputTimerRef.current) {
            clearTimeout(scannerInputTimerRef.current);
          }
          
          // Set timer to process scanner input after a delay (increased to capture complete barcode)
          scannerInputTimerRef.current = setTimeout(() => {
            const scannedCode = scannerInputBufferRef.current.trim();
            if (scannedCode.length > 0) {
              // Focus on barcode input
              if (barcodeInputRef.current) {
                barcodeInputRef.current.focus();
              }
              // Set the barcode input value
              setBarcodeInput(scannedCode);
              // Search for product
              handleBarcodeScan(scannedCode);
              // Clear buffer
              scannerInputBufferRef.current = '';
            }
          }, 300); // Increased from 100ms to 300ms to ensure complete barcode capture
        } else {
          // Reset if typing is slow (manual typing)
          scannerInputBufferRef.current = '';
        }
      } else if (e.key === 'Enter' && scannerInputBufferRef.current.length > 0) {
        // Enter key pressed with buffer - process scanner input
        e.preventDefault();
        const scannedCode = scannerInputBufferRef.current.trim();
        if (scannedCode.length > 0) {
          if (barcodeInputRef.current) {
            barcodeInputRef.current.focus();
          }
          setBarcodeInput(scannedCode);
          handleBarcodeScan(scannedCode);
          scannerInputBufferRef.current = '';
        }
      }
    };
    
    // Add event listener
    window.addEventListener('keydown', handleScannerInput);
    
    return () => {
      window.removeEventListener('keydown', handleScannerInput);
      if (scannerInputTimerRef.current) {
        clearTimeout(scannerInputTimerRef.current);
      }
    };
  }, [state.products]);

  const handleAddProduct = (product) => {
    setSelectedProduct(product);
    setShowQuantityModal(true);
  };

  // Replace quantity instead of merging (for editing existing cart items)
  const handleReplaceQuantity = (product, quantity, unit, fixedAmount = null) => {
    const validation = validateQuantityForUnit(quantity, unit);
    if (!validation.valid) {
      showToast(validation.message, 'warning');
      return false;
    }

    const sanitizedQuantity = validation.quantity;

    // Use functional update to replace quantity
    const resultRef = { stockError: null };
    
    setBillItems(prev => {
      // Check if product already exists in bill
      const existingItemIndex = prev.findIndex(item => item.id === product.id);
      
      if (existingItemIndex >= 0) {
        // Product exists - replace quantity instead of merging
        const existingItem = prev[existingItemIndex];
        const existingUnit = existingItem.unit || existingItem.quantityUnit || 'pcs';
        
        // Check if units are compatible - if not, convert to existing unit
        const baseUnit1 = getBaseUnit(existingUnit);
        const baseUnit2 = getBaseUnit(unit);
        
        let finalQuantity = sanitizedQuantity;
        let finalUnit = unit;
        
        // If units are compatible, convert to existing unit for consistency
        if (baseUnit1 === baseUnit2) {
          const quantityInBase = convertToBaseUnit(sanitizedQuantity, unit);
          finalQuantity = convertFromBaseUnit(quantityInBase, existingUnit);
          finalUnit = existingUnit;
        } else {
          // Units not compatible - use the new unit
          finalUnit = unit;
          finalQuantity = sanitizedQuantity;
        }
        
        // Check stock availability with new quantity
        const stockCheck = checkStockAvailability(product, finalQuantity, finalUnit);
        
        if (!stockCheck.available) {
          resultRef.stockError = stockCheck.error || (state.currentLanguage === 'hi'
            ? `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`
            : `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`);
          return prev;
        }
        
        // Replace existing item with new quantity
        const updatedItem = buildBillItem(product, finalQuantity, finalUnit, stockCheck.baseUnit, fixedAmount);
        return prev.map((item, idx) => idx === existingItemIndex ? updatedItem : item);
      }
      
      // Product doesn't exist - add new item (shouldn't happen when editing, but handle it)
      const stockCheck = checkStockAvailability(product, sanitizedQuantity, unit);
      
      if (!stockCheck.available) {
        resultRef.stockError = stockCheck.error || (state.currentLanguage === 'hi'
          ? `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`
          : `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`);
        return prev;
      }

      const newItem = buildBillItem(product, sanitizedQuantity, unit, stockCheck.baseUnit);
      return [...prev, newItem];
    });
    
    // Show error if stock check failed
    if (resultRef.stockError) {
      showToast(resultRef.stockError, resultRef.stockError.includes('error') ? 'error' : 'warning');
      return false;
    }
    
    return true;
  };

  const handleAddWithQuantity = (product, quantity, unit, fixedAmount = null) => {
    const validation = validateQuantityForUnit(quantity, unit);
    if (!validation.valid) {
      showToast(validation.message, 'warning');
      return false;
    }

    const sanitizedQuantity = validation.quantity;

    // Use functional update to atomically check and update - prevents race conditions
    const resultRef = { merged: false, stockError: null };
    
    setBillItems(prev => {
      // Check if product already exists in bill (by product ID, regardless of unit)
      const existingItemIndex = prev.findIndex(item => item.id === product.id);
      
      if (existingItemIndex >= 0) {
        // Product exists - merge quantities
        resultRef.merged = true;
        const existingItem = prev[existingItemIndex];
        const existingUnit = existingItem.unit || existingItem.quantityUnit || 'pcs';
        
        // Always merge to existing item's unit
        // Check if units are compatible
        const baseUnit1 = getBaseUnit(existingUnit);
        const baseUnit2 = getBaseUnit(unit);
        
        let finalQuantity;
        
        // Special case: If product is in pcs and user says piece/pcs/pieces/peace, add that many pieces
        const isCountUnit = ['pcs', 'piece', 'pieces', 'peace'].includes(unit.toLowerCase());
        const isExistingCountUnit = ['pcs', 'piece', 'pieces', 'peace'].includes(existingUnit.toLowerCase());
        
        if (isCountUnit && isExistingCountUnit) {
          // Both are count units - just add quantities directly
          finalQuantity = existingItem.quantity + sanitizedQuantity;
        } else if (baseUnit1 === baseUnit2) {
          // Units are compatible - convert and merge
          const existingInBase = convertToBaseUnit(existingItem.quantity, existingUnit);
          const newInBase = convertToBaseUnit(sanitizedQuantity, unit);
          const totalInBase = existingInBase + newInBase;
          
          // Convert total back to existing item's unit
          finalQuantity = convertFromBaseUnit(totalInBase, existingUnit);
        } else {
          // Units are NOT compatible - special handling
          const isExistingWeightOrVolume = ['kg', 'g', 'gm', 'ml', 'l', 'liter', 'liters'].includes(existingUnit.toLowerCase());
          
          if (isCountUnit && isExistingWeightOrVolume) {
            // Existing item is weight/volume, new quantity is "piece" - treat as quantity in existing unit
            finalQuantity = existingItem.quantity + sanitizedQuantity;
          } else {
            // Try to convert both to base units and merge anyway
            const existingInBase = convertToBaseUnit(existingItem.quantity, existingUnit);
            const newInBase = convertToBaseUnit(sanitizedQuantity, unit);
            const totalInBase = existingInBase + newInBase;
            finalQuantity = convertFromBaseUnit(totalInBase, existingUnit);
          }
        }
        
        // Check stock availability with merged quantity (using existing unit)
        const stockCheck = checkStockAvailability(product, finalQuantity, existingUnit);
        
        if (!stockCheck.available) {
          // Store error for display after state update
          resultRef.stockError = stockCheck.error || (state.currentLanguage === 'hi'
            ? `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`
            : `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`);
          // Return previous state unchanged - stock check failed
          return prev;
        }
        
        // Update existing item with merged quantity
        const updatedItem = buildBillItem(product, finalQuantity, existingUnit, stockCheck.baseUnit);
        return prev.map((item, idx) => idx === existingItemIndex ? updatedItem : item);
      }
      
      // Product doesn't exist - check stock and add new item
      const stockCheck = checkStockAvailability(product, sanitizedQuantity, unit);
      
      if (!stockCheck.available) {
        // Store error for display after state update
        resultRef.stockError = stockCheck.error || (state.currentLanguage === 'hi'
          ? `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`
          : `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`);
        // Return previous state unchanged - stock check failed
        return prev;
      }

      // Add new item
      const newItem = buildBillItem(product, sanitizedQuantity, unit, stockCheck.baseUnit, fixedAmount);
      return [...prev, newItem];
    });
    
    // Show error if stock check failed
    if (resultRef.stockError) {
      showToast(resultRef.stockError, resultRef.stockError.includes('error') ? 'error' : 'warning');
      return false;
    }
    
    return true;
  };

  // Find best matching product from spoken name
  const findMatchingProduct = (spokenName) => {
    if (!spokenName || spokenName.trim() === '') return null;
    
    const searchTerm = spokenName.toLowerCase().trim();
    
    // Try exact match first
    let product = state.products.find(p => 
      p.name.toLowerCase() === searchTerm
    );
    
    if (product) return product;
    
    // Try contains match
    product = state.products.find(p => 
      p.name.toLowerCase().includes(searchTerm) || 
      searchTerm.includes(p.name.toLowerCase())
    );
    
    if (product) return product;
    
    // Try word-by-word match
    const searchWords = searchTerm.split(/\s+/);
    product = state.products.find(p => {
      const productWords = p.name.toLowerCase().split(/\s+/);
      return searchWords.some(word => 
        productWords.some(pWord => pWord.includes(word) || word.includes(pWord))
      );
    });
    
    return product || null;
  };

  // Process voice input and add products instantly
  // Parse quantity and unit from text
  const parseQuantityAndUnit = (text) => {
    // Patterns: "500g", "1 kg", "1.5kg", "500 grams", "1 kilogram", "kilo", "killo", "5 peace" (mic hears peace instead of piece)
    const patterns = [
      // Decimal numbers with units
      /(\d+\.?\d*)\s*(kg|kilogram|kilograms|kilo|killo|g|gram|grams|gm|ml|milliliter|milliliters|l|liter|liters|litre|litres|pcs|piece|pieces|peace|packet|packets|box|boxes|bottle|bottles)/gi,
      // Whole numbers with units
      /(\d+)\s*(kg|kilogram|kilograms|kilo|killo|g|gram|grams|gm|ml|milliliter|milliliters|l|liter|liters|litre|litres|pcs|piece|pieces|peace|packet|packets|box|boxes|bottle|bottles)/gi
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const fullMatch = match[0];
        const numberMatch = fullMatch.match(/(\d+\.?\d*)/);
        const unitMatch = fullMatch.match(/(kg|kilogram|kilograms|kilo|killo|g|gram|grams|gm|ml|milliliter|milliliters|l|liter|liters|litre|litres|pcs|piece|pieces|peace|packet|packets|box|boxes|bottle|bottles)/i);
        
        if (numberMatch && unitMatch) {
          const quantity = parseFloat(numberMatch[1]);
          let unit = unitMatch[1].toLowerCase();
          
          // Normalize unit names
          if (unit === 'kilo' || unit === 'killo' || unit === 'kilogram' || unit === 'kilograms') {
            unit = 'kg';
          } else if (unit === 'gram' || unit === 'grams' || unit === 'gm') {
            unit = 'g';
          } else if (unit === 'liter' || unit === 'liters' || unit === 'litre' || unit === 'litres') {
            unit = 'l';
          } else if (unit === 'milliliter' || unit === 'milliliters') {
            unit = 'ml';
          } else if (unit === 'piece' || unit === 'pieces' || unit === 'peace') {
            unit = 'pcs';
          }
          
          return { quantity, unit, matchedText: fullMatch };
        }
      }
    }
    
    return null;
  };

  // Extract product name by removing quantity/unit patterns
  const extractProductName = (text) => {
    let cleaned = text
      .replace(/\d+\.?\d*\s*(kg|kilogram|kilograms|kilo|killo|g|gram|grams|gm|ml|milliliter|milliliters|l|liter|liters|litre|litres|pcs|piece|pieces|peace|packet|packets|box|boxes|bottle|bottles)/gi, '')
      .trim();
    
    // Remove common filler words
    cleaned = cleaned.replace(/\b(the|a|an|is|are|and|or|but|in|on|at|to|for|of|with|add|give|take)\b/gi, '').trim();
    
    return cleaned;
  };

  // Function to speak all items in cart with natural Indian conversational style
  const speakAllItems = () => {
    // Get current billItems from ref to avoid closure issues
    const itemsToSpeak = billItemsRef.current || billItems;
    
    console.log('Speaking items, count:', itemsToSpeak.length, itemsToSpeak);
    
    if (!itemsToSpeak || itemsToSpeak.length === 0) {
      const utterance = new SpeechSynthesisUtterance('Cart is empty, sir');
      utterance.lang = 'en-IN'; // English-Indian for clearer pronunciation
      utterance.rate = 0.75; // Slower for clarity
      utterance.pitch = 1.1; // Slightly higher pitch for female voice
      utterance.volume = 1.0;
      
      // Try to select female Indian voice
      const selectVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        
        // Helper function to check if voice is female
        const isFemaleVoice = (voice) => {
          const name = voice.name.toLowerCase();
          return name.includes('female') || 
                 name.includes('woman') || 
                 name.includes('zira') || 
                 name.includes('priya') ||
                 name.includes('neha') ||
                 name.includes('kavya');
        };
        
        const indianVoice = 
          voices.find(voice => 
            (voice.lang === 'en-IN' || voice.lang.startsWith('en-IN')) &&
            isFemaleVoice(voice)
          ) || voices.find(voice => 
            voice.lang.includes('IN') && isFemaleVoice(voice)
          ) || voices.find(voice => 
            voice.lang === 'en-IN' || voice.lang.startsWith('en-IN')
          ) || voices.find(voice => 
            voice.name.toLowerCase().includes('indian')
          );
        
        if (indianVoice) {
          utterance.voice = indianVoice;
        }
        window.speechSynthesis.speak(utterance);
      };
      
      if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = selectVoice;
      } else {
        selectVoice();
      }
      return;
    }

    // Build the speech text in natural Indian conversational style
    // Format: "kaju ke 5 piece he, badam 10 kilo he"
    const itemsList = itemsToSpeak.map((item, index) => {
      const productName = item.name || item.productName || 'item';
      const quantity = item.quantity || 0;
      let unit = (item.unit || item.quantityUnit || 'pcs').toLowerCase();
      
      // Convert units to Indian pronunciation style
      let unitText = '';
      if (unit === 'kg' || unit === 'kilogram' || unit === 'kilograms') {
        unitText = 'kilo'; // Always "kilo" in Indian style
      } else if (unit === 'g' || unit === 'gram' || unit === 'grams' || unit === 'gm') {
        unitText = 'gram'; // Always "gram" in Indian style
      } else if (unit === 'l' || unit === 'liter' || unit === 'liters' || unit === 'litre' || unit === 'litres') {
        unitText = 'liter'; // Always "liter" in Indian style
      } else if (unit === 'ml' || unit === 'milliliter' || unit === 'milliliters') {
        unitText = 'milliliter'; // Always "milliliter" in Indian style
      } else if (unit === 'pcs' || unit === 'piece' || unit === 'pieces' || unit === 'peace') {
        // Use plural "piece" for count > 1, singular "piece" for 1
        unitText = quantity === 1 || quantity === 1.0 ? 'piece' : 'piece';
      } else if (unit === 'packet' || unit === 'packets') {
        unitText = quantity === 1 || quantity === 1.0 ? 'packet' : 'packet';
      } else if (unit === 'box' || unit === 'boxes') {
        unitText = quantity === 1 || quantity === 1.0 ? 'box' : 'box';
      } else if (unit === 'bottle' || unit === 'bottles') {
        unitText = quantity === 1 || quantity === 1.0 ? 'bottle' : 'bottle';
      } else {
        unitText = unit;
      }
      
      // Natural Indian conversational style: "product ke quantity unit he"
      // Example: "kaju ke 5 piece he", "badam 10 kilo he"
      return `${productName} ke ${quantity} ${unitText} he`;
    });

    // Join items naturally
    let fullText = '';
    if (itemsList.length === 1) {
      fullText = itemsList[0];
    } else if (itemsList.length === 2) {
      fullText = `${itemsList[0]} aur ${itemsList[1]}`;
    } else {
      // For multiple items: "item1, item2, aur item3"
      const lastItem = itemsList.pop();
      fullText = `${itemsList.join(', ')}, aur ${lastItem}`;
    }

    // Add a natural ending
    fullText = `Sir, ${fullText}`;
    
    // Use Web Speech API with Indian voice settings for clarity
    const utterance = new SpeechSynthesisUtterance(fullText);
    utterance.lang = 'en-IN'; // English-Indian for clearer pronunciation
    utterance.rate = 0.75; // Slower for better clarity and understanding
    utterance.pitch = 1.1; // Slightly higher pitch for female voice
    utterance.volume = 1.0;
    
    // Try to select female Indian English voice for better clarity
    const selectIndianVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      
      // Helper function to check if voice is female
      const isFemaleVoice = (voice) => {
        const name = voice.name.toLowerCase();
        return name.includes('female') || 
               name.includes('woman') || 
               name.includes('zira') || 
               name.includes('priya') ||
               name.includes('neha') ||
               name.includes('kavya') ||
               name.includes('female') ||
               (voice.name.includes('Female') && !name.includes('male'));
      };
      
      // Priority order: Female Indian English voices (prefer neural), then any female Indian voice
      const indianVoice = 
        // 1. Female Indian English Neural voices (clearest)
        voices.find(voice => 
          (voice.lang === 'en-IN' || voice.lang.startsWith('en-IN')) &&
          isFemaleVoice(voice) &&
          (voice.name.toLowerCase().includes('neural') || voice.name.toLowerCase().includes('indian'))
        ) ||
        // 2. Female Indian English voices
        voices.find(voice => 
          (voice.lang === 'en-IN' || voice.lang.startsWith('en-IN')) &&
          isFemaleVoice(voice)
        ) ||
        // 3. Any female voice with Indian locale
        voices.find(voice => 
          voice.lang.includes('IN') &&
          isFemaleVoice(voice)
        ) ||
        // 4. Female neural voices (usually clearer)
        voices.find(voice => 
          isFemaleVoice(voice) &&
          voice.name.toLowerCase().includes('neural')
        ) ||
        // 5. Fallback: Any Indian English voice
        voices.find(voice => 
          voice.lang === 'en-IN' || voice.lang.startsWith('en-IN')
        ) ||
        // 6. Last resort: Any Indian voice
        voices.find(voice => 
          voice.lang.includes('IN')
        );
      
      if (indianVoice) {
        utterance.voice = indianVoice;
        console.log('Selected voice:', indianVoice.name, indianVoice.lang, 'Female:', isFemaleVoice(indianVoice));
      }
    };
    
    // Ensure voices are loaded before selecting
    const speakWithVoice = () => {
      selectIndianVoice();
      window.speechSynthesis.speak(utterance);
    };
    
    // Load voices if not already loaded
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = speakWithVoice;
    } else {
      speakWithVoice();
    }
  };

  // Format transcript as a list of products with quantities
  const formatTranscriptAsList = (text) => {
    if (!text || text.trim() === '') return [];
    
    let normalizedText = text.toLowerCase().trim();
    
    // STEP 1: Handle mixed units like "1 kilo 200 gram" → "1.2kg" (same as processVoiceInput)
    // Pattern for weight: "number kg/kilo number g/gram"
    const mixedWeightPattern = /(\d+\.?\d*)\s*(kg|kilogram|kilograms|kilo|killo)\s+(\d+\.?\d*)\s*(g|gram|grams|gm)\b/gi;
    const weightReplacements = [];
    let weightMatch;
    
    while ((weightMatch = mixedWeightPattern.exec(normalizedText)) !== null) {
      const qty1 = parseFloat(weightMatch[1]);
      const qty2 = parseFloat(weightMatch[3]);
      
      const qty1InGrams = convertToBaseUnit(qty1, 'kg');
      const qty2InGrams = convertToBaseUnit(qty2, 'g');
      const totalInGrams = qty1InGrams + qty2InGrams;
      const totalInKg = convertFromBaseUnit(totalInGrams, 'kg');
      
      weightReplacements.push({
        original: weightMatch[0],
        replacement: `${totalInKg}kg`,
        index: weightMatch.index,
        length: weightMatch[0].length
      });
    }
    
    // Pattern for volume: "number l/liter number ml"
    const mixedVolumePattern = /(\d+\.?\d*)\s*(l|liter|liters|litre|litres)\s+(\d+\.?\d*)\s*(ml|milliliter|milliliters)\b/gi;
    const volumeReplacements = [];
    let volumeMatch;
    
    while ((volumeMatch = mixedVolumePattern.exec(normalizedText)) !== null) {
      const qty1 = parseFloat(volumeMatch[1]);
      const qty2 = parseFloat(volumeMatch[3]);
      
      const qty1InMl = convertToBaseUnit(qty1, 'l');
      const qty2InMl = convertToBaseUnit(qty2, 'ml');
      const totalInMl = qty1InMl + qty2InMl;
      const totalInL = convertFromBaseUnit(totalInMl, 'l');
      
      volumeReplacements.push({
        original: volumeMatch[0],
        replacement: `${totalInL}l`,
        index: volumeMatch.index,
        length: volumeMatch[0].length
      });
    }
    
    // Apply replacements in reverse order
    const allReplacements = [...weightReplacements, ...volumeReplacements]
      .sort((a, b) => b.index - a.index);
    
    allReplacements.forEach(replacement => {
      normalizedText = normalizedText.substring(0, replacement.index) + 
                     replacement.replacement + 
                     normalizedText.substring(replacement.index + replacement.length);
    });
    
    const items = [];
    
    // STEP 2: Extract amount patterns (rupees, rs, amount) BEFORE quantity-unit patterns
    // Support various spellings: rupey, rupee, rupees, ruppes, ruppey, rs, rs., ₹, amount
    // Support both formats: "20 rupees" and "₹20" or "rupees 20"
    const amountMatches = [];
    
    // Pattern 1: Number followed by rupee word/symbol (e.g., "20 rupees", "20 ₹")
    const amountPattern1 = /(\d+\.?\d*)\s*(rupey|rupee|rupees|ruppes|ruppey|rs\.|rs|₹|amount)/gi;
    let amountMatch;
    
    while ((amountMatch = amountPattern1.exec(normalizedText)) !== null) {
      const amount = parseFloat(amountMatch[1]);
      amountMatches.push({
        amount,
        index: amountMatch.index,
        length: amountMatch[0].length,
        matchedText: amountMatch[0]
      });
    }
    
    // Pattern 2: ₹ symbol followed by number (e.g., "₹20")
    const amountPattern2 = /₹\s*(\d+\.?\d*)/gi;
    amountPattern1.lastIndex = 0; // Reset regex state
    
    while ((amountMatch = amountPattern2.exec(normalizedText)) !== null) {
      const amount = parseFloat(amountMatch[1]);
      // Check if this amount was already captured by pattern 1
      const alreadyFound = amountMatches.some(m => 
        Math.abs(m.index - amountMatch.index) < 5 && Math.abs(m.amount - amount) < 0.01
      );
      if (!alreadyFound) {
        amountMatches.push({
          amount,
          index: amountMatch.index,
          length: amountMatch[0].length,
          matchedText: amountMatch[0]
        });
      }
    }
    
    // Pattern 3: Rupee word followed by number (e.g., "rupees 20")
    const amountPattern3 = /(rupey|rupee|rupees|ruppes|ruppey|rs\.|rs|amount)\s*(\d+\.?\d*)/gi;
    amountPattern2.lastIndex = 0; // Reset regex state
    
    while ((amountMatch = amountPattern3.exec(normalizedText)) !== null) {
      const amount = parseFloat(amountMatch[2]);
      // Check if this amount was already captured
      const alreadyFound = amountMatches.some(m => 
        Math.abs(m.index - amountMatch.index) < 5 && Math.abs(m.amount - amount) < 0.01
      );
      if (!alreadyFound) {
        amountMatches.push({
          amount,
          index: amountMatch.index,
          length: amountMatch[0].length,
          matchedText: amountMatch[0]
        });
      }
    }
    
    // Sort by index to maintain order
    amountMatches.sort((a, b) => a.index - b.index);
    
    // STEP 3: Extract quantity-unit patterns
    const qtyUnitPattern = /(\d+\.?\d*)\s*(kg|kilogram|kilograms|kilo|killo|g|gram|grams|gm|ml|milliliter|milliliters|l|liter|liters|litre|litres|pcs|piece|pieces|peace|packet|packets|box|boxes|bottle|bottles)/gi;
    const matches = [];
    let match;
    
    while ((match = qtyUnitPattern.exec(normalizedText)) !== null) {
      const quantity = parseFloat(match[1]);
      let unit = match[2].toLowerCase();
      
      // Normalize unit names
      if (unit === 'kilo' || unit === 'killo' || unit === 'kilogram' || unit === 'kilograms') {
        unit = 'kg';
      } else if (unit === 'gram' || unit === 'grams' || unit === 'gm') {
        unit = 'g';
      } else if (unit === 'liter' || unit === 'liters' || unit === 'litre' || unit === 'litres') {
        unit = 'l';
      } else if (unit === 'milliliter' || unit === 'milliliters') {
        unit = 'ml';
      } else if (unit === 'piece' || unit === 'pieces' || unit === 'peace') {
        unit = 'pcs';
      }
      
      matches.push({
        quantity,
        unit,
        index: match.index,
        length: match[0].length,
        matchedText: match[0]
      });
    }
    
    // STEP 4: Process amount patterns (process all, even if quantity-unit patterns also exist)
    if (amountMatches.length > 0) {
      amountMatches.forEach((amountMatch, idx) => {
        // Check if this amount pattern overlaps with any quantity-unit pattern
        // If it does, skip it (quantity-unit takes precedence)
        const amountStart = amountMatch.index;
        const amountEnd = amountMatch.index + amountMatch.length;
        const overlapsWithQtyUnit = matches.some(qtyUnit => {
          const qtyStart = qtyUnit.index;
          const qtyEnd = qtyUnit.index + qtyUnit.length;
          // Check if they overlap (within 10 characters)
          return Math.abs(amountStart - qtyStart) < 10 || 
                 (amountStart >= qtyStart && amountStart <= qtyEnd) ||
                 (amountEnd >= qtyStart && amountEnd <= qtyEnd);
        });
        
        // Skip if this amount pattern overlaps with a quantity-unit pattern
        if (overlapsWithQtyUnit) {
          return;
        }
        
        // Extract text around this amount pattern
        // Look backwards from the amount pattern to find the product name (max 5 words back)
        // This ensures we only get the product name immediately before this amount, not previous products
        
        const amtStart = amountMatch.index;
        
        // Find the start by looking backwards from the amount pattern
        // Look for the end of previous patterns (amount or quantity-unit) within reasonable distance
        let segmentStart = 0;
        
        // Check for previous amount patterns
        if (idx > 0) {
          const prevAmountEnd = amountMatches[idx - 1].index + amountMatches[idx - 1].length;
          segmentStart = prevAmountEnd;
        }
        
        // Check for previous quantity-unit patterns before this amount
        const prevQtyUnit = matches.find(qty => {
          const qtyEnd = qty.index + qty.length;
          return qtyEnd < amtStart && (amtStart - qtyEnd) < 100; // Within 100 chars
        });
        if (prevQtyUnit) {
          const prevQtyEnd = prevQtyUnit.index + prevQtyUnit.length;
          segmentStart = Math.max(segmentStart, prevQtyEnd);
        }
        
        // Extract segment: from segmentStart to amtStart (only text immediately before this amount)
        let segment = normalizedText.substring(segmentStart, amtStart).trim();
        
        // Limit to last 5 words to avoid picking up previous products
        const words = segment.split(/\s+/);
        if (words.length > 5) {
          segment = words.slice(-5).join(' ');
        }
        
        // Remove the amount pattern to get product name (though it shouldn't be in segment since we stop at amtStart)
        let productNameText = segment.replace(amountMatch.matchedText, '').trim();
        productNameText = productNameText.replace(/\b(rupey|rupee|rupees|ruppes|ruppey|rs\.|rs|amount|₹)\b/gi, '').trim();
        const cleanedName = productNameText.replace(/\b(the|a|an|is|are|and|or|but|in|on|at|to|for|of|with|add|give|take)\b/gi, '').trim();
        
        if (cleanedName) {
          // Try to find product to get price and calculate quantity
          const product = findMatchingProduct(cleanedName);
          if (product) {
            const productUnit = product.unit || product.quantityUnit || 'pcs';
            const isDivisibleUnit = ['kg', 'g', 'gm', 'l', 'liter', 'liters', 'ml', 'milliliter', 'milliliters'].includes(productUnit.toLowerCase());
            
            if (isDivisibleUnit) {
              const pricePerUnit = product.sellingPrice || product.sellingUnitPrice || product.costPrice || product.unitPrice || 0;
              if (pricePerUnit > 0) {
                const calculatedQuantity = amountMatch.amount / pricePerUnit;
                items.push({
                  id: `amt-${idx}-${items.length}`, // Unique ID for removal
                  product: product.name, // Show corrected product name from database
                  spokenName: cleanedName, // Keep original spoken name for reference
                  quantity: calculatedQuantity,
                  unit: productUnit,
                  amount: amountMatch.amount,
                  isAmountBased: true,
                  matched: true
                });
              } else {
                items.push({
                  id: `amt-${idx}-${items.length}`, // Unique ID for removal
                  product: product.name, // Show corrected product name
                  spokenName: cleanedName,
                  quantity: 0,
                  unit: productUnit,
                  amount: amountMatch.amount,
                  isAmountBased: true,
                  matched: false,
                  error: 'Price not set'
                });
              }
            } else {
              // Product is in pcs - show amount only, no quantity calculation
              items.push({
                id: `amt-${idx}-${items.length}`, // Unique ID for removal
                product: product.name, // Show corrected product name
                spokenName: cleanedName,
                quantity: 0,
                unit: productUnit,
                amount: amountMatch.amount,
                isAmountBased: false,
                matched: true,
                error: 'Cannot calculate quantity from amount for pieces'
              });
            }
          } else {
            // Product not found - show spoken name
            items.push({
              id: `amt-${idx}-${items.length}`, // Unique ID for removal
              product: cleanedName,
              quantity: 0,
              unit: 'pcs',
              amount: amountMatch.amount,
              isAmountBased: false,
              matched: false
            });
          }
        }
      });
    }
    
    // STEP 5: Process quantity-unit patterns (process all, even if amount patterns also exist)
    if (matches.length > 0) {
      // Process each quantity-unit match
      matches.forEach((qtyUnit, idx) => {
        // Extract text around this quantity-unit pattern
        // Look backwards from the quantity-unit pattern to find the product name (max 5 words back)
        // This ensures we only get the product name immediately before this quantity-unit, not previous products
        
        const qtyStart = qtyUnit.index;
        
        // Find the start by looking backwards from the quantity-unit pattern
        // Look for the end of previous patterns (amount or quantity-unit) within reasonable distance
        let segmentStart = 0;
        
        // Check for previous quantity-unit patterns
        if (idx > 0) {
          const prevQtyEnd = matches[idx - 1].index + matches[idx - 1].length;
          segmentStart = prevQtyEnd;
        }
        
        // Check for previous amount patterns before this quantity-unit
        const prevAmount = amountMatches.find(amt => {
          const amtEnd = amt.index + amt.length;
          return amtEnd < qtyStart && (qtyStart - amtEnd) < 100; // Within 100 chars
        });
        if (prevAmount) {
          const prevAmountEnd = prevAmount.index + prevAmount.length;
          segmentStart = Math.max(segmentStart, prevAmountEnd);
        }
        
        // Extract segment: from segmentStart to qtyStart (only text immediately before this quantity-unit)
        let segment = normalizedText.substring(segmentStart, qtyStart).trim();
        
        // Limit to last 5 words to avoid picking up previous products
        const words = segment.split(/\s+/);
        if (words.length > 5) {
          segment = words.slice(-5).join(' ');
        }
        
        // Remove the quantity-unit pattern to get product name
        const productName = segment.replace(qtyUnit.matchedText, '').trim();
        const cleanedName = productName.replace(/\b(the|a|an|is|are|and|or|but|in|on|at|to|for|of|with|add|give|take)\b/gi, '').trim();
        
        if (cleanedName) {
          const product = findMatchingProduct(cleanedName);
          items.push({
            id: `qty-${idx}-${items.length}`, // Unique ID for removal
            product: product ? product.name : cleanedName, // Show corrected product name if found
            spokenName: cleanedName, // Keep original spoken name for reference
            quantity: qtyUnit.quantity,
            unit: qtyUnit.unit,
            matched: product ? true : false
          });
        }
      });
    } else {
      // No quantities found - try to extract product names
      const segments = normalizedText
        .split(/[,;]| and | then | also | plus /i)
        .map(s => s.trim())
        .filter(s => s.length > 0);
      
      if (segments.length === 0) {
        segments.push(normalizedText);
      }
      
      segments.forEach(segment => {
        const cleaned = segment.replace(/\b(the|a|an|is|are|and|or|but|in|on|at|to|for|of|with|add|give|take)\b/gi, '').trim();
        if (cleaned) {
          const product = findMatchingProduct(cleaned);
          items.push({
            id: `seg-${items.length}`, // Unique ID for removal
            product: product ? product.name : cleaned, // Show corrected product name if found
            spokenName: cleaned, // Keep original spoken name for reference
            quantity: 1,
            unit: 'pcs',
            matched: product ? true : false
          });
        }
      });
    }
    
    return items;
  };

  const processVoiceInput = (text, showToasts = true) => {
    if (!text || text.trim() === '') return;
    
    let normalizedText = text.toLowerCase().trim();
    
    // Check for recheck or check commands (more specific to avoid false matches)
    const isRecheckCommand = normalizedText.includes('recheck') || 
                             normalizedText.includes('re check') ||
                             normalizedText.includes('re-check');
    
    const isCheckCommand = normalizedText === 'check' ||
                           normalizedText.startsWith('check ') ||
                           normalizedText.includes('check bill') ||
                           normalizedText.includes('check items') ||
                           normalizedText.includes('check cart') ||
                           normalizedText.includes('check the') ||
                           normalizedText.includes('check all');
    
    if (isRecheckCommand || isCheckCommand) {
      // Stop voice recognition
      stopVoiceRecognition();
      
      // Speak all items
      setTimeout(() => {
        speakAllItems();
      }, 500); // Small delay to ensure recognition stops first
      
      showToast('Reading all items in cart...', 'info', 2000);
      return;
    }
    
    // Map to store products with their quantities (for merging)
    const productMap = new Map();
    
    // STEP 1: Handle mixed units like "1 kilo 200 gram" → "1.2kg" or "2 liter 500 ml" → "2.5l"
    // This combines compatible units (kg+g, l+ml) into a single quantity-unit pair
    let processedText = normalizedText;
    
    // Pattern for weight: "number kg/kilo number g/gram"
    const mixedWeightPattern = /(\d+\.?\d*)\s*(kg|kilogram|kilograms|kilo|killo)\s+(\d+\.?\d*)\s*(g|gram|grams|gm)\b/gi;
    const weightReplacements = [];
    let weightMatch;
    
    // Find all weight mixed unit patterns
    while ((weightMatch = mixedWeightPattern.exec(normalizedText)) !== null) {
      const qty1 = parseFloat(weightMatch[1]); // e.g., 1
      const qty2 = parseFloat(weightMatch[3]); // e.g., 200
      
      // Convert both to base unit (grams) and add
      const qty1InGrams = convertToBaseUnit(qty1, 'kg'); // 1kg = 1000g
      const qty2InGrams = convertToBaseUnit(qty2, 'g'); // 200g = 200g
      const totalInGrams = qty1InGrams + qty2InGrams; // 1200g
      
      // Convert back to kg for display
      const totalInKg = convertFromBaseUnit(totalInGrams, 'kg'); // 1200g = 1.2kg
      
      weightReplacements.push({
        original: weightMatch[0],
        replacement: `${totalInKg}kg`,
        index: weightMatch.index,
        length: weightMatch[0].length
      });
    }
    
    // Pattern for volume: "number l/liter number ml"
    const mixedVolumePattern = /(\d+\.?\d*)\s*(l|liter|liters|litre|litres)\s+(\d+\.?\d*)\s*(ml|milliliter|milliliters)\b/gi;
    const volumeReplacements = [];
    let volumeMatch;
    
    // Find all volume mixed unit patterns
    while ((volumeMatch = mixedVolumePattern.exec(normalizedText)) !== null) {
      const qty1 = parseFloat(volumeMatch[1]); // e.g., 2
      const qty2 = parseFloat(volumeMatch[3]); // e.g., 500
      
      // Convert both to base unit (ml) and add
      const qty1InMl = convertToBaseUnit(qty1, 'l'); // 2l = 2000ml
      const qty2InMl = convertToBaseUnit(qty2, 'ml'); // 500ml = 500ml
      const totalInMl = qty1InMl + qty2InMl; // 2500ml
      
      // Convert back to l for display
      const totalInL = convertFromBaseUnit(totalInMl, 'l'); // 2500ml = 2.5l
      
      volumeReplacements.push({
        original: volumeMatch[0],
        replacement: `${totalInL}l`,
        index: volumeMatch.index,
        length: volumeMatch[0].length
      });
    }
    
    // Combine all replacements and sort by index (descending) to apply from end to start
    const allReplacements = [...weightReplacements, ...volumeReplacements]
      .sort((a, b) => b.index - a.index);
    
    // Apply replacements in reverse order to preserve string indices
    allReplacements.forEach(replacement => {
      processedText = processedText.substring(0, replacement.index) + 
                     replacement.replacement + 
                     processedText.substring(replacement.index + replacement.length);
    });
    
    // Use processed text for further parsing
    normalizedText = processedText;
    
    // STEP 2: Extract amount patterns (rupees, rs, amount) BEFORE quantity-unit patterns
    // Support various spellings: rupey, rupee, rupees, ruppes, ruppey, rs, rs., ₹, amount
    // Support both formats: "20 rupees" and "₹20" or "rupees 20"
    const amountMatches = [];
    
    // Pattern 1: Number followed by rupee word/symbol (e.g., "20 rupees", "20 ₹")
    const amountPattern1 = /(\d+\.?\d*)\s*(rupey|rupee|rupees|ruppes|ruppey|rs\.|rs|₹|amount)/gi;
    let amountMatch;
    
    while ((amountMatch = amountPattern1.exec(normalizedText)) !== null) {
      const amount = parseFloat(amountMatch[1]);
      amountMatches.push({
        amount,
        index: amountMatch.index,
        length: amountMatch[0].length,
        matchedText: amountMatch[0]
      });
    }
    
    // Pattern 2: ₹ symbol followed by number (e.g., "₹20")
    const amountPattern2 = /₹\s*(\d+\.?\d*)/gi;
    amountPattern1.lastIndex = 0; // Reset regex state
    
    while ((amountMatch = amountPattern2.exec(normalizedText)) !== null) {
      const amount = parseFloat(amountMatch[1]);
      // Check if this amount was already captured by pattern 1
      const alreadyFound = amountMatches.some(m => 
        Math.abs(m.index - amountMatch.index) < 5 && Math.abs(m.amount - amount) < 0.01
      );
      if (!alreadyFound) {
        amountMatches.push({
          amount,
          index: amountMatch.index,
          length: amountMatch[0].length,
          matchedText: amountMatch[0]
        });
      }
    }
    
    // Pattern 3: Rupee word followed by number (e.g., "rupees 20")
    const amountPattern3 = /(rupey|rupee|rupees|ruppes|ruppey|rs\.|rs|amount)\s*(\d+\.?\d*)/gi;
    amountPattern2.lastIndex = 0; // Reset regex state
    
    while ((amountMatch = amountPattern3.exec(normalizedText)) !== null) {
      const amount = parseFloat(amountMatch[2]);
      // Check if this amount was already captured
      const alreadyFound = amountMatches.some(m => 
        Math.abs(m.index - amountMatch.index) < 5 && Math.abs(m.amount - amount) < 0.01
      );
      if (!alreadyFound) {
        amountMatches.push({
          amount,
          index: amountMatch.index,
          length: amountMatch[0].length,
          matchedText: amountMatch[0]
        });
      }
    }
    
    // Sort by index to maintain order
    amountMatches.sort((a, b) => a.index - b.index);
    
    // STEP 3: Extract all quantity-unit patterns and their positions
    const qtyUnitMatches = [];
    const qtyUnitPattern = /(\d+\.?\d*)\s*(kg|kilogram|kilograms|kilo|killo|g|gram|grams|gm|ml|milliliter|milliliters|l|liter|liters|litre|litres|pcs|piece|pieces|peace|packet|packets|box|boxes|bottle|bottles)/gi;
    let match;
    
    while ((match = qtyUnitPattern.exec(normalizedText)) !== null) {
      const quantity = parseFloat(match[1]);
      let unit = match[2].toLowerCase();
      
      // Normalize unit names
      if (unit === 'kilo' || unit === 'killo' || unit === 'kilogram' || unit === 'kilograms') {
        unit = 'kg';
      } else if (unit === 'gram' || unit === 'grams' || unit === 'gm') {
        unit = 'g';
      } else if (unit === 'liter' || unit === 'liters' || unit === 'litre' || unit === 'litres') {
        unit = 'l';
      } else if (unit === 'milliliter' || unit === 'milliliters') {
        unit = 'ml';
      } else if (unit === 'piece' || unit === 'pieces' || unit === 'peace') {
        unit = 'pcs';
      }
      
      qtyUnitMatches.push({
        quantity,
        unit,
        index: match.index,
        length: match[0].length,
        matchedText: match[0]
      });
    }
    
    // STEP 4: Process amount patterns (process all, even if quantity-unit patterns also exist)
    // If amount is found, calculate quantity from product price (only for divisible units)
    if (amountMatches.length > 0) {
      amountMatches.forEach((amountMatch, idx) => {
        // Check if this amount pattern overlaps with any quantity-unit pattern
        // If it does, skip it (quantity-unit takes precedence)
        const amountStart = amountMatch.index;
        const amountEnd = amountMatch.index + amountMatch.length;
        const overlapsWithQtyUnit = qtyUnitMatches.some(qtyUnit => {
          const qtyStart = qtyUnit.index;
          const qtyEnd = qtyUnit.index + qtyUnit.length;
          // Check if they overlap (within 10 characters)
          return Math.abs(amountStart - qtyStart) < 10 || 
                 (amountStart >= qtyStart && amountStart <= qtyEnd) ||
                 (amountEnd >= qtyStart && amountEnd <= qtyEnd);
        });
        
        // Skip if this amount pattern overlaps with a quantity-unit pattern
        if (overlapsWithQtyUnit) {
          return;
        }
        
        // Extract text around this amount pattern
        // Look backwards from the amount pattern to find the product name (max 5 words back)
        // This ensures we only get the product name immediately before this amount, not previous products
        
        const amtStart = amountMatch.index;
        
        // Find the start by looking backwards from the amount pattern
        // Look for the end of previous patterns (amount or quantity-unit) within reasonable distance
        let segmentStart = 0;
        
        // Check for previous amount patterns
        if (idx > 0) {
          const prevAmountEnd = amountMatches[idx - 1].index + amountMatches[idx - 1].length;
          segmentStart = prevAmountEnd;
        }
        
        // Check for previous quantity-unit patterns before this amount
        const prevQtyUnit = qtyUnitMatches.find(qty => {
          const qtyEnd = qty.index + qty.length;
          return qtyEnd < amtStart && (amtStart - qtyEnd) < 100; // Within 100 chars
        });
        if (prevQtyUnit) {
          const prevQtyEnd = prevQtyUnit.index + prevQtyUnit.length;
          segmentStart = Math.max(segmentStart, prevQtyEnd);
        }
        
        // Extract segment: from segmentStart to amtStart (only text immediately before this amount)
        let segment = normalizedText.substring(segmentStart, amtStart).trim();
        
        // Limit to last 5 words to avoid picking up previous products
        const words = segment.split(/\s+/);
        if (words.length > 5) {
          segment = words.slice(-5).join(' ');
        }
        
        // Remove the amount pattern to get product name (though it shouldn't be in segment since we stop at amtStart)
        let productNameText = segment.replace(amountMatch.matchedText, '').trim();
        productNameText = productNameText.replace(/\b(rupey|rupee|rupees|ruppes|ruppey|rs\.|rs|amount|₹)\b/gi, '').trim();
        
        const productName = extractProductName(productNameText || segment);
        
        if (productName && productName.length > 0) {
          const product = findMatchingProduct(productName);
          if (product) {
            const productKey = product.id || product.name.toLowerCase();
            const productUnit = product.unit || product.quantityUnit || 'pcs';
            
            // Only calculate quantity from amount for divisible units (kg, g, l, ml) - NOT pcs
            const isDivisibleUnit = ['kg', 'g', 'gm', 'l', 'liter', 'liters', 'ml', 'milliliter', 'milliliters'].includes(productUnit.toLowerCase());
            
            if (isDivisibleUnit) {
              // Get product price per unit
              const pricePerUnit = product.sellingPrice || product.sellingUnitPrice || product.costPrice || product.unitPrice || 0;
              
              if (pricePerUnit > 0) {
                // Calculate quantity = amount / price per unit
                const calculatedQuantity = amountMatch.amount / pricePerUnit;
                
                // Store with amount info for display
                productMap.set(productKey, {
                  product,
                  quantity: calculatedQuantity,
                  unit: productUnit,
                  amount: amountMatch.amount, // Store amount for display
                  isAmountBased: true // Flag to indicate this was calculated from amount
                });
              } else {
                // Product has no price - show toast and don't add
                if (showToasts) {
                  showToast(`${productName} - Product price not set. Cannot calculate quantity from amount.`, 'warning', 3000);
                }
              }
            } else {
              // Product is in pcs - don't calculate from amount, show toast
              if (showToasts) {
                showToast(`${productName} - Cannot calculate quantity from amount for pieces. Please specify quantity.`, 'warning', 3000);
              }
            }
          } else {
            // Product not found - show toast alert
            if (showToasts) {
              showToast(`${productName} - This product not found`, 'error', 3000);
            }
          }
        }
      });
    }
    
    // STEP 5: Process quantity-unit patterns (if found)
    // If we found quantity-unit patterns, process them
    if (qtyUnitMatches.length > 0) {
      qtyUnitMatches.forEach((qtyUnit, idx) => {
        // Extract text around this quantity-unit pattern
        // Look backwards from the quantity-unit pattern to find the product name (max 5 words back)
        // This ensures we only get the product name immediately before this quantity-unit, not previous products
        
        const qtyStart = qtyUnit.index;
        
        // Find the start by looking backwards from the quantity-unit pattern
        // Look for the end of previous patterns (amount or quantity-unit) within reasonable distance
        let segmentStart = 0;
        
        // Check for previous quantity-unit patterns
        if (idx > 0) {
          const prevQtyEnd = qtyUnitMatches[idx - 1].index + qtyUnitMatches[idx - 1].length;
          segmentStart = prevQtyEnd;
        }
        
        // Check for previous amount patterns before this quantity-unit
        const prevAmount = amountMatches.find(amt => {
          const amtEnd = amt.index + amt.length;
          return amtEnd < qtyStart && (qtyStart - amtEnd) < 100; // Within 100 chars
        });
        if (prevAmount) {
          const prevAmountEnd = prevAmount.index + prevAmount.length;
          segmentStart = Math.max(segmentStart, prevAmountEnd);
        }
        
        // Extract segment: from segmentStart to qtyStart (only text immediately before this quantity-unit)
        let segment = normalizedText.substring(segmentStart, qtyStart).trim();
        
        // Limit to last 5 words to avoid picking up previous products
        const words = segment.split(/\s+/);
        if (words.length > 5) {
          segment = words.slice(-5).join(' ');
        }
        
        // Remove the quantity-unit pattern to get product name
        // Try multiple approaches to ensure we extract the product name correctly
        let productNameText = segment;
        
        // Approach 1: Remove the exact matched text (case-insensitive)
        const exactMatchRegex = new RegExp(qtyUnit.matchedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (exactMatchRegex.test(segment)) {
          productNameText = segment.replace(exactMatchRegex, '').trim();
        }
        
        // Approach 2: If still no change, try removing any quantity-unit pattern
        if (productNameText === segment || productNameText === '') {
          productNameText = segment.replace(/\d+\.?\d*\s*(kg|kilogram|kilograms|kilo|killo|g|gram|grams|gm|ml|milliliter|milliliters|l|liter|liters|litre|litres|pcs|piece|pieces|peace|packet|packets|box|boxes|bottle|bottles)/gi, '').trim();
        }
        
        // Approach 3: Use extractProductName which handles this more robustly
        const productName = extractProductName(productNameText || segment);
        
        console.log(`🔍 [processVoiceInput] Product extraction:`, {
          segment,
          productNameText,
          productName,
          qtyUnit: qtyUnit.matchedText,
          quantity: qtyUnit.quantity,
          unit: qtyUnit.unit
        });
        
        if (productName && productName.length > 0) {
          const product = findMatchingProduct(productName);
          console.log(`🔍 [processVoiceInput] Product match result:`, {
            searchedName: productName,
            found: product ? product.name : null
          });
          if (product) {
            const productKey = product.id || product.name.toLowerCase();
            const productUnit = product.unit || product.quantityUnit || 'pcs';
            
            // Always use product's unit for consistency
            let finalUnit = productUnit;
            let finalQuantity = qtyUnit.quantity;
            
            // Special case: If product is in pcs and user says piece/pcs/pieces/peace, add that many pieces directly
            const isCountUnit = ['pcs', 'piece', 'pieces', 'peace'].includes(qtyUnit.unit.toLowerCase());
            const isProductCountUnit = ['pcs', 'piece', 'pieces', 'peace'].includes(productUnit.toLowerCase());
            
            if (isCountUnit && isProductCountUnit) {
              // Both are count units - use quantity directly as pieces
              finalQuantity = qtyUnit.quantity;
              finalUnit = productUnit;
            } else {
              // Check if units are compatible (same base unit category)
              const baseUnit1 = getBaseUnit(qtyUnit.unit);
              const baseUnit2 = getBaseUnit(productUnit);
              
              if (baseUnit1 === baseUnit2) {
                // Units are compatible (both weight, both volume, or both count)
                // Convert to product's unit
                const quantityInBase = convertToBaseUnit(qtyUnit.quantity, qtyUnit.unit);
                finalQuantity = convertFromBaseUnit(quantityInBase, productUnit);
                finalUnit = productUnit;
              } else {
                // Units are NOT compatible (e.g., product is kg but seller said "piece")
                // Special handling: if product is weight/volume and seller said "piece/pcs/pieces/peace"
                const isProductWeightOrVolume = ['kg', 'g', 'gm', 'ml', 'l', 'liter', 'liters'].includes(productUnit.toLowerCase());
                
                if (isCountUnit && isProductWeightOrVolume) {
                  // Product is weight/volume, seller said "piece" - treat as quantity in product's unit
                  // e.g., "sugar 5 piece" where sugar is in kg -> add 5kg
                  finalQuantity = qtyUnit.quantity;
                  finalUnit = productUnit;
                } else if (!isCountUnit && isProductCountUnit) {
                  // Product is count-based (pcs), seller said weight/volume
                  // Use the weight/volume quantity as pieces (e.g., "sugar 1kg" where sugar is in pcs -> add 1 piece)
                  finalQuantity = qtyUnit.quantity;
                  finalUnit = productUnit;
                } else {
                  // Incompatible units, use spoken unit but try to convert
                  // This shouldn't happen often, but handle gracefully
                  finalUnit = qtyUnit.unit;
                  finalQuantity = qtyUnit.quantity;
                }
              }
            }
            
            // Merge with existing entry if same product
            if (productMap.has(productKey)) {
              const existing = productMap.get(productKey);
              // Both should be in product's unit now, so just add
              const totalQuantity = existing.quantity + finalQuantity;
              productMap.set(productKey, {
                product,
                quantity: totalQuantity,
                unit: productUnit
              });
            } else {
              productMap.set(productKey, {
                product,
                quantity: finalQuantity,
                unit: finalUnit
              });
            }
          } else {
            // Product not found - show toast alert
            if (showToasts) {
              showToast(`${productName} - This product not found`, 'error', 3000);
            }
          }
        }
      });
    } else {
      // No quantity found - when seller says only product name, add with default quantity 1
      // Split by common separators to handle multiple products
      let segments = normalizedText
        .split(/[,;]| and | then | also | plus /i)
        .map(s => s.trim())
        .filter(s => s.length > 0);
      
      if (segments.length === 0) {
        segments.push(normalizedText);
      }
      
      // If only one segment and no separators found, be conservative on mobile
      // Only try word-by-word matching if the segment is long (likely multiple products)
      // Otherwise, treat as a single product to avoid false positives
      if (segments.length === 1 && !normalizedText.match(/[,;]| and | then | also | plus /i)) {
        const words = segments[0].split(/\s+/).filter(w => w.length > 0);
        
        // Only try word-by-word matching if:
        // 1. There are 3+ words (likely multiple products)
        // 2. OR the segment is very long (20+ chars)
        // This prevents single product names from being split incorrectly
        const shouldTryWordMatching = words.length >= 3 || segments[0].length >= 20;
        
        if (shouldTryWordMatching) {
          // Try to match each word or combination of consecutive words as product names
          const matchedProducts = new Set();
          const wordsToCheck = [];
          
          // Prioritize multi-word combinations first (more likely to be product names)
          // Add combinations of 2-3 consecutive words (for products like "basmati rice", "red chilli powder")
          for (let i = 0; i < words.length; i++) {
            if (i + 1 < words.length) {
              wordsToCheck.push(`${words[i]} ${words[i + 1]}`);
            }
            if (i + 2 < words.length) {
              wordsToCheck.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
            }
          }
          
          // Then add single words (less reliable, check last)
          words.forEach(word => {
            // Skip very short words (likely articles/prepositions)
            if (word.length > 2) {
              wordsToCheck.push(word);
            }
          });
          
          // Try to match each word/combination against products
          wordsToCheck.forEach(wordOrPhrase => {
            const cleaned = extractProductName(wordOrPhrase);
            if (cleaned && cleaned.length > 2) { // Skip very short matches
              const product = findMatchingProduct(cleaned);
              if (product && !matchedProducts.has(product.id)) {
                matchedProducts.add(product.id);
                const productKey = product.id || product.name.toLowerCase();
                
                if (!productMap.has(productKey)) {
                  const unit = product.unit || product.quantityUnit || 'pcs';
                  productMap.set(productKey, {
                    product,
                    quantity: 1,
                    unit
                  });
                }
              }
            }
          });
          
          // If no products matched by word matching, fall back to treating whole segment as one product
          if (matchedProducts.size === 0) {
            const productName = extractProductName(segments[0]);
            if (productName) {
              const product = findMatchingProduct(productName);
              if (product) {
                const productKey = product.id || product.name.toLowerCase();
                
                if (!productMap.has(productKey)) {
                  const unit = product.unit || product.quantityUnit || 'pcs';
                  productMap.set(productKey, {
                    product,
                    quantity: 1,
                    unit
                  });
                }
              } else if (showToasts) {
                // Product not found - show toast alert
                showToast(`${productName} - This product not found`, 'error', 3000);
              }
            }
          }
        } else {
          // Short segment - treat as single product (more reliable on mobile)
          const productName = extractProductName(segments[0]);
          if (productName) {
            const product = findMatchingProduct(productName);
            if (product) {
              const productKey = product.id || product.name.toLowerCase();
              
              if (!productMap.has(productKey)) {
                const unit = product.unit || product.quantityUnit || 'pcs';
                productMap.set(productKey, {
                  product,
                  quantity: 1,
                  unit
                });
              }
            } else if (showToasts) {
              // Product not found - show toast alert
              showToast(`${productName} - This product not found`, 'error', 3000);
            }
          }
        }
      } else {
        // Multiple segments found (separated by commas, "and", etc.)
      segments.forEach(segment => {
        const productName = extractProductName(segment);
          
        if (productName) {
          const product = findMatchingProduct(productName);
          if (product) {
            const productKey = product.id || product.name.toLowerCase();
            
            if (!productMap.has(productKey)) {
              const unit = product.unit || product.quantityUnit || 'pcs';
                // When seller says only product name (no quantity), add with default quantity 1
                // This adds directly to bill without opening quantity modal
              productMap.set(productKey, {
                product,
                quantity: 1,
                unit
              });
            }
          } else if (showToasts) {
            // Product not found - show toast alert
            showToast(`${productName} - This product not found`, 'error', 3000);
          }
        }
      });
      }
    }
    
    // Process all found products
    // If product exists in cart, replace quantity; otherwise add new product
    if (productMap.size === 0) {
      console.log('⚠️ [processVoiceInput] No products found in productMap. Original text:', text);
      console.log('⚠️ [processVoiceInput] Processed text:', normalizedText);
      console.log('⚠️ [processVoiceInput] Quantity matches found:', qtyUnitMatches.length);
      if (showToasts) {
        showToast('No products detected. Please try again.', 'warning');
      }
      return;
    }
    
    console.log(`✅ [processVoiceInput] Found ${productMap.size} product(s) to add:`, Array.from(productMap.values()).map(({ product, quantity, unit }) => `${product.name} ${quantity}${unit}`));
    
    productMap.forEach(({ product, quantity, unit, amount, isAmountBased }) => {
      // Check if product already exists in cart
        const existingItemIndex = billItems.findIndex(item => item.id === product.id);
      
        // For amount-based items, pass the exact amount to ensure billing shows exactly that amount
        const fixedAmount = isAmountBased && amount ? amount : null;
      
        if (existingItemIndex >= 0) {
        // Product exists - replace quantity instead of adding to existing quantity
        const replaced = handleReplaceQuantity(product, quantity, unit, fixedAmount);
        if (replaced && showToasts) {
          // Get the updated quantity after unit conversion (if any)
          // Use setTimeout to get updated state, or show the intended quantity
          setTimeout(() => {
            const updatedItem = billItems.find(item => item.id === product.id);
            if (updatedItem) {
              const displayQuantity = updatedItem.quantity;
              const displayUnit = updatedItem.unit || updatedItem.quantityUnit || unit;
              // Show amount with quantity in brackets if it was amount-based
              const toastMessage = isAmountBased && amount 
                ? `Updated: ${product.name} ₹${amount} (${formatQuantityWithUnit(displayQuantity, displayUnit)})`
                : `Updated: ${product.name} ${formatQuantityWithUnit(displayQuantity, displayUnit)}`;
              showToast(toastMessage, 'success', 2000);
        } else {
              const toastMessage = isAmountBased && amount 
                ? `Updated: ${product.name} ₹${amount} (${formatQuantityWithUnit(quantity, unit)})`
                : `Updated: ${product.name} ${formatQuantityWithUnit(quantity, unit)}`;
              showToast(toastMessage, 'success', 2000);
            }
          }, 100);
        } else if (!replaced) {
          console.error('❌ [processVoiceInput] Failed to replace quantity for product:', product.name);
        }
      } else {
        // Product doesn't exist - add new product
        // For amount-based items, pass the exact amount to ensure billing shows exactly that amount
        const fixedAmount = isAmountBased && amount ? amount : null;
        const added = handleAddWithQuantity(product, quantity, unit, fixedAmount);
        if (added && showToasts) {
          // Show amount with quantity in brackets if it was amount-based
          const toastMessage = isAmountBased && amount 
            ? `Added: ${product.name} ₹${amount} (${formatQuantityWithUnit(quantity, unit)})`
            : `Added: ${product.name} ${formatQuantityWithUnit(quantity, unit)}`;
          showToast(toastMessage, 'success', 2000);
        } else if (!added) {
          console.error('❌ [processVoiceInput] Failed to add product:', product.name, 'quantity:', quantity, 'unit:', unit);
        }
      }
    });
    
    // Clear processed products after a delay to allow re-adding
    setTimeout(() => {
      processedProductsRef.current.clear();
    }, 3000);
  };

  // Actually start voice recognition (internal function)
  const actuallyStartVoiceRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('Speech recognition not supported in your browser', 'error');
      return;
    }

    // Prevent multiple recognition instances
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      } catch (e) {
        // Ignore
      }
    }

    // Small delay to ensure previous recognition is fully stopped (especially on mobile)
    setTimeout(() => {
      if (!showVoiceModal) {
        // If modal closed while waiting, don't start recognition
        return;
      }

      shouldKeepListeningRef.current = true;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
      setIsListening(true);
      // Only clear transcript if modal is NOT open (for inline voice input)
      // When modal is open, preserve accumulated transcript so products don't disappear
      if (!showVoiceModal) {
        setVoiceTranscript('');
        accumulatedTranscriptRef.current = '';
        processedProductsRef.current.clear();
      }
      // Clear any pending processing timeout
      if (processTimeoutRef.current) {
        clearTimeout(processTimeoutRef.current);
        processTimeoutRef.current = null;
      }
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';
      
      // Process all results from the event
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }

      // Accumulate final transcripts (complete sentences)
      // CRITICAL: When modal is open, always append to existing accumulated transcript
      // This ensures previous products don't disappear when seller takes a break
      if (finalTranscript) {
        if (showVoiceModal) {
          // Append to existing accumulated transcript (preserve all previous products)
          accumulatedTranscriptRef.current = (accumulatedTranscriptRef.current || '') + finalTranscript;
        } else {
          // For inline voice input, replace accumulated transcript
          accumulatedTranscriptRef.current = finalTranscript;
        }
      }

      // Update live transcript display (show accumulated + interim)
      // Always use the full accumulated transcript + current interim
      const displayTranscript = ((accumulatedTranscriptRef.current || '') + interimTranscript).trim();
      setVoiceTranscript(displayTranscript);
      
      // Update modal transcript if modal is open - always use full accumulated transcript
      if (showVoiceModal) {
        // Always show the full accumulated transcript + current interim
        // This ensures all previous products remain visible
        setVoiceModalTranscript(displayTranscript);
      }

      // Only auto-process if voice modal is NOT open (for inline voice input)
      if (!showVoiceModal) {
        // Clear any existing timeout
        if (processTimeoutRef.current) {
          clearTimeout(processTimeoutRef.current);
        }

        // Wait for pause before processing the whole sentence
        // Use longer timeout on mobile to prevent premature processing
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const pauseTimeout = isMobile ? 2500 : 1500; // Longer pause on mobile (2.5s vs 1.5s)
        
        processTimeoutRef.current = setTimeout(() => {
          if (accumulatedTranscriptRef.current.trim()) {
            // Process the accumulated sentence all at once
            processVoiceInput(accumulatedTranscriptRef.current.trim());
            
            // Clear accumulated transcript after processing
            accumulatedTranscriptRef.current = '';
            
            // Clear display transcript after a delay
            setTimeout(() => {
              setVoiceTranscript('');
            }, 1000);
          }
        }, pauseTimeout);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') {
        // Auto-restart if no speech detected, but only if modal is open and we're still supposed to listen
        // On mobile, be more conservative - don't auto-restart immediately
        if (showVoiceModal && shouldKeepListeningRef.current) {
          setTimeout(() => {
            if (shouldKeepListeningRef.current && showVoiceModal && recognitionRef.current === recognition) {
              try {
                recognition.start();
              } catch (e) {
                // Ignore - recognition might already be starting
              }
            }
          }, 1000); // Longer delay on mobile to prevent continuous restarts
        } else if (!showVoiceModal) {
          // For inline voice input, don't auto-restart on no-speech
          setIsListening(false);
          shouldKeepListeningRef.current = false;
        }
      } else {
        setIsListening(false);
        shouldKeepListeningRef.current = false;
        if (event.error !== 'aborted') {
          showToast('Speech recognition error. Please try again.', 'error');
        }
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      
      // Only process accumulated transcript if modal is NOT open (for inline voice input)
      // When modal is open, wait for user to click Confirm button
      if (!showVoiceModal) {
        // Process any accumulated transcript when recognition ends
        if (processTimeoutRef.current) {
          clearTimeout(processTimeoutRef.current);
          processTimeoutRef.current = null;
        }
        
        // Process accumulated transcript immediately if any
        if (accumulatedTranscriptRef.current.trim()) {
          processVoiceInput(accumulatedTranscriptRef.current.trim());
          accumulatedTranscriptRef.current = '';
          setTimeout(() => {
            setVoiceTranscript('');
          }, 1000);
        }
      }
      
      // Auto-restart ONLY if modal is open and we're still supposed to be listening
      // On mobile, add a longer delay to prevent continuous restarts
      if (shouldKeepListeningRef.current && showVoiceModal) {
        const restartDelay = 300; // Slightly longer delay to prevent rapid restarts on mobile
        setTimeout(() => {
          // Double-check conditions before restarting
          if (shouldKeepListeningRef.current && showVoiceModal && recognitionRef.current === recognition) {
            try {
              recognition.start();
            } catch (e) {
              // Ignore - recognition might already be starting or stopped
              console.log('Recognition restart skipped:', e.message);
            }
          }
        }, restartDelay);
      }
    };

      recognitionRef.current = recognition;

      try {
        recognition.start();
      } catch (e) {
        console.error('Failed to start recognition:', e);
        recognitionRef.current = null;
        setIsListening(false);
        shouldKeepListeningRef.current = false;
        if (e.message && !e.message.includes('already started')) {
          showToast('Failed to start listening. Please try again.', 'error');
        }
      }
    }, 200); // Small delay to ensure clean start, especially on mobile
  };

  // Start voice recognition (checks for instructions first)
  const startVoiceRecognition = () => {
    // Check if user has dismissed the instructions
    const dontShowAgain = localStorage.getItem('voiceInstructionsDismissed') === 'true';
    
    // Show instructions if not dismissed
    if (!dontShowAgain) {
      setDontShowAgainChecked(false); // Reset checkbox state
      setShowVoiceInstructions(true);
      return; // Don't start recognition yet, wait for user to click OK
    }

    // Start voice recognition directly
    actuallyStartVoiceRecognition();
  };

  // Handle voice instructions modal OK button
  const handleVoiceInstructionsOK = (dontShowAgain) => {
    setShowVoiceInstructions(false);
    
    // Save preference if user checked "don't show again"
    if (dontShowAgain) {
      localStorage.setItem('voiceInstructionsDismissed', 'true');
    }
    
    // Start voice recognition
    actuallyStartVoiceRecognition();
  };

  // Stop voice recognition
  const stopVoiceRecognition = () => {
    shouldKeepListeningRef.current = false;
    
    // Clear any pending processing timeout
    if (processTimeoutRef.current) {
      clearTimeout(processTimeoutRef.current);
      processTimeoutRef.current = null;
    }
    
    // Only process accumulated transcript if modal is NOT open
    // When modal is open, don't process - wait for Confirm button
    if (!showVoiceModal && accumulatedTranscriptRef.current.trim()) {
      processVoiceInput(accumulatedTranscriptRef.current.trim());
      accumulatedTranscriptRef.current = '';
    }
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setVoiceTranscript('');
    processedProductsRef.current.clear();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopVoiceRecognition();
    };
  }, []);

  const updateQuantity = (productId, quantity) => {
    const itemIndex = billItems.findIndex(item => item.id === productId);
    if (itemIndex === -1) {
      return;
    }

    const existingItem = billItems[itemIndex];
    const validation = validateQuantityForUnit(quantity, existingItem.unit);
    if (!validation.valid) {
      showToast(validation.message, 'warning');
      return;
    }

    const sanitizedQuantity = validation.quantity;

    if (sanitizedQuantity <= 0) {
      setBillItems(prev => prev.filter(item => item.id !== productId));
      return;
    }

    const product = state.products.find(p => p.id === productId);
    if (!product) {
      return;
    }

    const stockCheck = checkStockAvailability(product, sanitizedQuantity, existingItem.unit);
    if (!stockCheck.available) {
      if (stockCheck.error) {
        showToast(stockCheck.error, 'error');
        return;
      }

      const message = state.currentLanguage === 'hi'
        ? `⚠️ ${getTranslation('lowStock', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}. ${getTranslation('youCannotAddMore', state.currentLanguage)}.`
        : `⚠️ ${getTranslation('lowStock', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}. ${getTranslation('youCannotAddMore', state.currentLanguage)}.`;
      showToast(message, 'warning');
      return;
    }

    const rebuiltItem = buildBillItem(product, sanitizedQuantity, existingItem.unit, stockCheck.baseUnit);

    setBillItems(prev => prev.map((entry, idx) =>
      idx === itemIndex ? rebuiltItem : entry
    ));
  };

  const removeFromBill = (productId) => {
    setBillItems(prev => prev.filter(item => item.id !== productId));
  };

  const resetBillingForm = () => {
    draftSyncEnabledRef.current = false;
    setBillItems([]);
    setSelectedCustomer('');
    setCustomCustomerName('');
    setCustomCustomerMobile('');
    setUseCustomName(false);
    setDiscount(0);
    setTax(0);
    setPaymentMethod('cash');
    setBillingMobile('');
    setSendWhatsAppInvoice(false);
    setBarcodeInput('');
    setQrCodeData(null);
    setShowQRCode(false);
    setShowCameraScanner(false);
    setShowSplitPayment(false);
    setSplitPaymentDetails(null);
    setCurrentBill(null);
    setIsBillingMobileValid(true);
    dispatch({ type: ActionTypes.SET_BILLING_DRAFT, payload: null });
    lastDraftSnapshotRef.current = null;
    setTimeout(() => {
      draftSyncEnabledRef.current = true;
    }, 0);
  };

  const finalizeOrder = ({
    order,
    bill,
    billItemsSnapshot,
    matchedDueCustomer,
    isDueLikePayment,
    customerName,
    sanitizedMobile,
    useCustomNameFlag,
    sendWhatsAppInvoiceFlag,
    effectiveMobile
  }) => {
    const orderId = order.id;
    
    // Check if this order is currently being finalized (prevent concurrent finalization)
    if (finalizingOrders.current.has(orderId)) {
      console.warn('⚠️ Order is already being finalized, skipping duplicate call:', orderId);
      isGeneratingBill.current = false;
      return false;
    }
    
    // Mark order as being finalized
    finalizingOrders.current.add(orderId);
    
    if (!ensureOrderCapacity()) {
      finalizingOrders.current.delete(orderId);
      isGeneratingBill.current = false;
      return false;
    }

    // Log that we're starting finalization
    console.log('🔧 [FINALIZE] Starting finalization for order:', orderId);
    console.log('🔧 [FINALIZE] Split payment type:', order.splitPaymentDetails?.type);
    console.log('🔧 [FINALIZE] Order stockDeducted flag:', order.stockDeducted);
    
    // Check if order already exists to prevent duplicate finalization
    const existingOrder = state.orders.find(o => o.id === orderId);
    if (existingOrder) {
      console.warn('⚠️ Order already exists, skipping duplicate finalization:', orderId);
      console.warn('⚠️ Existing order stockDeducted:', existingOrder.stockDeducted);
      finalizingOrders.current.delete(orderId);
      isGeneratingBill.current = false;
      return false;
    }

    // Check if stock was already deducted for this order (prevent duplicate deduction on refresh)
    if (order.stockDeducted === true) {
      console.warn('⚠️ Stock already deducted for this order, skipping stock deduction:', orderId);
      // Still add the order to state, but skip stock deduction
      dispatch({ type: ActionTypes.ADD_ORDER, payload: order });
      finalizingOrders.current.delete(orderId);
      isGeneratingBill.current = false;
      return true;
    }

    console.log('🔧 Finalizing order:', orderId);
    
    // Check plan limit BEFORE finalizing order
    const activeOrders = state.orders.filter(order => !order.isDeleted);
    const totalOrders = activeOrders.length;
    const { maxOrders } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
    const canAdd = canAddOrder(totalOrders, state.currentPlan, state.currentPlanDetails);
    
    if (!canAdd) {
      const orderLimitLabel = maxOrders === Infinity ? 'Unlimited' : maxOrders;
      const planNameLabel = state.currentPlanDetails?.planName
        || (state.currentPlan ? `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}` : 'Current');
      const limitMessage = `Your limit is full! You've reached the order limit (${orderLimitLabel}) for the ${planNameLabel} plan. Upgrade your plan to create more orders.`;
      
      console.error('Order limit reached during finalization:', limitMessage);
      if (window.showToast) {
        window.showToast(limitMessage, 'error', 5000);
      }
      finalizingOrders.current.delete(orderId);
      isGeneratingBill.current = false;
      return false;
    }
    
    // CRITICAL: Double-check that order doesn't exist BEFORE doing anything
    // This prevents duplicate stock deduction on page refresh
    const orderExistsCheck = state.orders.find(o => o.id === orderId);
    if (orderExistsCheck) {
      console.error('❌ CRITICAL: Order already exists in state, aborting finalization!', orderId);
      console.error('❌ Existing order stockDeducted:', orderExistsCheck.stockDeducted);
      finalizingOrders.current.delete(orderId);
      isGeneratingBill.current = false;
      return false;
    }
    
    // Update product quantities FIRST (before adding order to state)
    console.log('🔧 Starting stock deduction for order:', order.id);
    console.log('🔧 Order does NOT exist in state, proceeding with stock deduction');
    billItemsSnapshot.forEach((item, index) => {
      const candidateIds = [
        item.productId,
        item.product?.id,
        item.product?.productId,
        item.id,
        item._id
      ].filter(Boolean);

      const product = state.products.find(p => {
        const productIdentifiers = [p.id, p._id].filter(Boolean);
        return productIdentifiers.some(identifier => candidateIds.includes(identifier));
      });

      if (!product) {
        console.warn('⚠️ Unable to match billed item to a product for stock deduction:', item);
        return;
      }

      const productUnit = product.unit || product.quantityUnit || 'pcs';
      const currentQuantity = Number(product.quantity ?? product.stock ?? 0) || 0;
      const currentQuantityInBaseUnit = convertToBaseUnit(currentQuantity, productUnit);

      const billedUnit = item.unit || item.quantityUnit || productUnit;
      const billedQuantity = Number(item.quantity ?? 0);
      if (billedQuantity <= 0) {
        return;
      }

      const billedQuantityInBaseUnit = Number.isFinite(Number(item.quantityInBaseUnit))
        ? Number(item.quantityInBaseUnit)
        : convertToBaseUnit(billedQuantity, billedUnit);

      console.log(`🔧 Stock deduction [${index + 1}/${billItemsSnapshot.length}]:`, {
        productName: product.name,
        productId: product.id,
        currentStock: currentQuantity,
        billedQuantity: billedQuantity,
        billedUnit: billedUnit,
        billedQuantityInBaseUnit: billedQuantityInBaseUnit
      });

      const updatedQuantityInBaseUnit = Math.max(
        0,
        currentQuantityInBaseUnit - billedQuantityInBaseUnit
      );
      const updatedQuantityInProductUnit = convertFromBaseUnit(
        updatedQuantityInBaseUnit,
        productUnit
      );
      const roundedUpdatedQuantity =
        Math.round((Number.isFinite(updatedQuantityInProductUnit) ? updatedQuantityInProductUnit : 0) * 1000) /
        1000;

      console.log(`🔧 Stock updated for ${product.name}:`, {
        before: currentQuantity,
        after: roundedUpdatedQuantity,
        deducted: currentQuantity - roundedUpdatedQuantity
      });

      const updatedProduct = {
        ...product,
        quantity: roundedUpdatedQuantity,
        stock: roundedUpdatedQuantity
      };

      // CRITICAL: Ensure product is marked as unsynced when updated from order
      // suppressProductSync prevents immediate sync trigger, but product still needs to sync later
      const productToUpdate = {
        ...updatedProduct,
        isSynced: false, // Always mark as unsynced - hasn't synced to MongoDB yet
        syncedAt: undefined // Ensure syncedAt is not set
      };
      
      dispatch({
        type: ActionTypes.UPDATE_PRODUCT,
        payload: productToUpdate,
        meta: { suppressProductSync: true }
      });
    });
    console.log('🔧 Completed stock deduction for order:', order.id);
    
    // NOW add order to state AFTER stock deduction is complete
    // Mark order as having stock deducted
    const orderWithStockFlag = {
      ...order,
      stockDeducted: true
    };
    
    console.log('🔧 Adding order to state after stock deduction:', orderId);
    dispatch({ type: ActionTypes.ADD_ORDER, payload: orderWithStockFlag });
    
    // CRITICAL: Explicitly sync products to MongoDB after order creation
    // Products were updated with suppressProductSync: true, so we need to sync them now
    // Use setTimeout to ensure state updates are complete before syncing
    setTimeout(() => {
      if (syncService.isOnline()) {
        console.log('🔧 Triggering product sync to MongoDB after order creation...');
        // syncService.syncAll requires getStoreFunctions parameter
        syncService.syncAll(getStoreFunctions).catch(err => {
          console.error('❌ Error syncing products after order creation:', err);
        });
      } else {
        console.log('⚠️ Offline - products will sync when connection is restored');
      }
    }, 100); // Small delay to ensure state updates are complete

    // Handle customer creation/update AFTER order is successfully created
    // This ensures customers are only created if the order creation succeeds
    const isSplitPayment = bill.paymentMethod === 'split' && bill.splitPaymentDetails;
    const splitDueAmount = isSplitPayment ? (bill.splitPaymentDetails.dueAmount || 0) : 0;
    const hasDueAmount = isDueLikePayment || (isSplitPayment && splitDueAmount > 0);
    
    // Handle customer creation/update for all orders (not just due payments)
    // This ensures customers are created/updated after order creation
    if (customerName && customerName.trim() !== '' && customerName.trim().toLowerCase() !== 'walk-in customer') {
      const customerMobileNumber = sanitizedMobile;
      
      // Check if customer already exists (by order.customerId or by matching name + mobile)
      let customer = null;
      
      // First, check if order has a customerId (existing customer was matched)
      if (order.customerId) {
        customer = allCustomers.find(c => c.id === order.customerId);
      }
      
      // If not found by customerId, try to match by BOTH name AND mobile number
      if (!customer && customerName && customerMobileNumber) {
        const normalizedCustomerName = customerName.trim().toLowerCase();
        
        customer = allCustomers.find(c => {
          const existingName = (c.name || '').trim().toLowerCase();
          const existingMobile = sanitizeMobileNumber(c.mobileNumber || c.phone || '');
          
          // BOTH name AND mobile must match
          const nameMatches = existingName === normalizedCustomerName;
          const mobileMatches = existingMobile && customerMobileNumber && existingMobile === customerMobileNumber;
          
          return nameMatches && mobileMatches;
        });
      }
      
      // Also check matchedDueCustomer if it exists
      if (!customer && matchedDueCustomer) {
        customer = matchedDueCustomer;
      }

      if (customer) {
        // Update existing customer
        if (hasDueAmount) {
          // Add due amount for due payments
          const dueAmountToAdd = isSplitPayment ? splitDueAmount : bill.total;
          const updatedCustomer = {
            ...customer,
            balanceDue: (customer.balanceDue || customer.dueAmount || 0) + dueAmountToAdd,
            dueAmount: (customer.dueAmount || customer.balanceDue || 0) + dueAmountToAdd
          };
          dispatch({ type: ActionTypes.UPDATE_CUSTOMER, payload: updatedCustomer });
        } else {
          // Just update customer info if needed (for non-due payments)
          // This ensures customer data is synced even for cash/online payments
          const updatedCustomer = {
            ...customer,
            name: customerName.trim(),
            mobileNumber: customerMobileNumber || customer.mobileNumber || '',
            phone: customerMobileNumber || customer.phone || ''
          };
          // Only update if something changed
          if (updatedCustomer.name !== customer.name || 
              updatedCustomer.mobileNumber !== (customer.mobileNumber || customer.phone)) {
            dispatch({ type: ActionTypes.UPDATE_CUSTOMER, payload: updatedCustomer });
          }
        }
      } else {
        // Create new customer AFTER order is created
        if (customerLimitReached) {
          showCustomerLimitWarning();
          isGeneratingBill.current = false;
          return false;
        }

        const newCustomer = {
          id: Date.now().toString(),
          name: customerName.trim(),
          mobileNumber: customerMobileNumber || '',
          phone: customerMobileNumber || '',
          email: '',
          address: '',
          balanceDue: hasDueAmount ? (isSplitPayment ? splitDueAmount : bill.total) : 0,
          dueAmount: hasDueAmount ? (isSplitPayment ? splitDueAmount : bill.total) : 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'billing_auto'
        };
        dispatch({ type: ActionTypes.ADD_CUSTOMER, payload: newCustomer });
      }
    }

    dispatch({
      type: 'ADD_ACTIVITY',
      payload: {
        id: Date.now().toString(),
        message: `Order created for ${customerName} - ₹${bill.total.toFixed(2)} (${bill.paymentMethod})`,
        timestamp: new Date().toISOString(),
        type: 'order_created'
      }
    });

    // Play cash register sound when order is created
    const playCashRegisterSound = async () => {
      const audioPath = '/assets/cash-register-kaching-376867.mp3';
      
      // Try to play MP3 file with better loading
      const tryPlayMP3 = async () => {
        return new Promise(async (resolve, reject) => {
          try {
            // Try using fetch to load as blob for better compatibility
            let audio;
            let blobUrl = null;
            
            try {
              const response = await fetch(audioPath);
              if (response.ok) {
                const blob = await response.blob();
                blobUrl = URL.createObjectURL(blob);
                audio = new Audio(blobUrl);
              } else {
                // Fallback to direct path
                audio = new Audio(audioPath);
              }
            } catch (fetchError) {
              // Fallback to direct path
              audio = new Audio(audioPath);
            }
            
            audio.volume = 1.0;
            audio.currentTime = 0;
            
            const handleCanPlay = () => {
              const playPromise = audio.play();
              if (playPromise !== undefined) {
                playPromise
                  .then(() => {
                    console.log('✅ Cash register sound played successfully');
                    resolve();
                  })
                  .catch(reject);
              } else {
                resolve();
              }
            };
            
            const handleError = (e) => {
              if (blobUrl) {
                URL.revokeObjectURL(blobUrl);
              }
              reject(audio.error || new Error('MP3 playback failed'));
            };
            
            if (audio.readyState >= 2) {
              handleCanPlay();
            } else {
              audio.addEventListener('canplaythrough', handleCanPlay, { once: true });
              audio.addEventListener('error', handleError, { once: true });
              audio.load();
            }
          } catch (error) {
            reject(error);
          }
        });
      };
      
      // Try MP3 first - no fallback, we want the original sound quality
      tryPlayMP3()
        .catch((error) => {
          console.error('❌ MP3 playback failed:', error);
          // Only use fallback if absolutely necessary
          console.warn('Using Web Audio API fallback (lower quality)');
          try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const createBeep = (frequency, startTime, duration) => {
              const oscillator = audioContext.createOscillator();
              const gainNode = audioContext.createGain();
              oscillator.connect(gainNode);
              gainNode.connect(audioContext.destination);
              oscillator.frequency.value = frequency;
              oscillator.type = 'sine';
              gainNode.gain.setValueAtTime(0.5, startTime);
              gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
              oscillator.start(startTime);
              oscillator.stop(startTime + duration);
            };
            const now = audioContext.currentTime;
            createBeep(800, now, 0.05);
            createBeep(1000, now + 0.05, 0.05);
            createBeep(1200, now + 0.1, 0.1);
          } catch (e) {
            console.error('❌ Fallback also failed:', e);
          }
        });
    };
    
    // Play sound
    playCashRegisterSound();

    if (sendWhatsAppInvoiceFlag) {
      openWhatsAppInvoice(bill, sanitizedMobile || effectiveMobile);
    }

    resetBillingForm();
    setPendingOrder(null);
    setShowUPIPayment(false);
    isGeneratingBill.current = false;
    
    // Remove order from finalizing set after a delay to allow state updates
    setTimeout(() => {
      finalizingOrders.current.delete(orderId);
      console.log('🔧 Removed order from finalizing set:', orderId);
    }, 1000);
    
    return true;
  };

  const customerNameProvided = useCustomName
    ? (customCustomerName || '').trim()
    : (state.customers.find(c => c.id === selectedCustomer)?.name || selectedCustomer || '').toString().trim();

  const handleGenerateBillClick = () => {
    if (billItems.length === 0) {
      showToast(getTranslation('pleaseAddItems', state.currentLanguage), 'warning');
      return;
    }
    setShowPaymentAndCustomerModal(true);
  };

  const handlePaymentAndCustomerSubmit = (data) => {
    // Update state with modal data
    setUseCustomName(data.useCustomName);
    setCustomCustomerName(data.customCustomerName);
    setSelectedCustomer(data.selectedCustomer);
    setBillingMobile(data.billingMobile);
    setPaymentMethod(data.paymentMethod);
    setSendWhatsAppInvoice(data.sendWhatsAppInvoice);
    setSplitPaymentDetails(data.splitPaymentDetails);
    setShowPaymentAndCustomerModal(false);
    
    // Now proceed with bill generation - pass modal data directly to avoid async state issues
    generateBill(data);
  };

  const generateBill = (modalData = null) => {
    // Prevent multiple simultaneous calls
    if (isGeneratingBill.current) {
      showToast(
        state.currentLanguage === 'hi'
          ? 'बिल जनरेशन पहले से चल रहा है, कृपया प्रतीक्षा करें...'
          : 'Bill generation already in progress, please wait...',
        'warning'
      );
      return;
    }

    console.log('🔧 Generate Bill clicked');
    console.log('🔧 Bill items:', billItems);
    console.log('🔧 Selected customer:', selectedCustomer);
    console.log('🔧 Use custom name:', useCustomName);
    console.log('🔧 Custom customer name:', customCustomerName);
    
    if (billItems.length === 0) {
      showToast(getTranslation('pleaseAddItems', state.currentLanguage), 'warning');
      return;
    }

    if (pendingOrder) {
        showToast(
          state.currentLanguage === 'hi'
            ? 'कृपया नया बिल बनाने से पहले लंबित ऑनलाइन भुगतान (UPI) पूरा करें।'
            : 'Please complete the pending online payment before creating a new bill.',
          'warning'
        );
      return;
    }

    // Set flag to prevent duplicate calls
    isGeneratingBill.current = true;

    if (billingMobile && !isBillingMobileValid) {
      showToast(
        state.currentLanguage === 'hi'
          ? 'कृपया सही मोबाइल नंबर दर्ज करें (10 अंक, 6-9 से शुरू)।'
          : 'Please enter a valid 10-digit mobile number starting with 6-9.',
        'error'
      );
      isGeneratingBill.current = false;
      return;
    }

    if (
      customerNameProvided &&
      (!billingMobile || !isValidMobileNumber(sanitizeMobileNumber(billingMobile)))
    ) {
      showToast(
        state.currentLanguage === 'hi'
          ? 'ग्राहक नाम के लिए वैध मोबाइल नंबर दर्ज करें (10 अंक, 6-9 से शुरू)।'
          : 'Please enter a valid 10-digit mobile number starting with 6-9 for the customer.',
        'error'
      );
      isGeneratingBill.current = false;
      return;
    }

    // Final stock validation before generating bill with proper unit conversion
    for (const billItem of billItems) {
      const product = state.products.find(p => p.id === billItem.id);
      if (product) {
        const stockCheck = checkStockAvailability(product, billItem.quantity, billItem.unit);
        if (!stockCheck.available) {
          if (stockCheck.error) {
            showToast(stockCheck.error, 'error');
            isGeneratingBill.current = false;
            return;
          }
          
          const message = state.currentLanguage === 'hi'
            ? `⚠️ ${getTranslation('stockError', state.currentLanguage)}! ${getTranslation('product', state.currentLanguage)}: ${product.name} (${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}, ${getTranslation('requested', state.currentLanguage)}: ${stockCheck.requestedDisplay}). ${getTranslation('cannotGenerateBill', state.currentLanguage)}.`
            : `⚠️ ${getTranslation('stockError', state.currentLanguage)}! ${getTranslation('product', state.currentLanguage)}: ${product.name} (${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}, ${getTranslation('requested', state.currentLanguage)}: ${stockCheck.requestedDisplay}). ${getTranslation('cannotGenerateBill', state.currentLanguage)}.`;
          showToast(message, 'error');
          isGeneratingBill.current = false;
          return;
        }
      }
    }

    // For cash payments, customer name is optional (use "Walk-in Customer" if not provided)
    // For split payments and other payment methods, customer name is required
    // Use modalData if provided (to avoid async state issues), otherwise use state
    const effectiveUseCustomName = modalData ? modalData.useCustomName : useCustomName;
    const effectiveCustomCustomerName = modalData ? modalData.customCustomerName : customCustomerName;
    const effectiveSelectedCustomer = modalData ? modalData.selectedCustomer : selectedCustomer;
    const effectivePaymentMethod = modalData ? modalData.paymentMethod : paymentMethod;
    const effectiveSplitPaymentDetails = modalData ? modalData.splitPaymentDetails : splitPaymentDetails;
    const effectiveBillingMobile = modalData ? modalData.billingMobile : billingMobile;
    
    // Validate customer name - prioritize customCustomerName if it exists
    let customerName = '';
    if (effectiveCustomCustomerName && effectiveCustomCustomerName.trim()) {
      // Prioritize customCustomerName if it exists (even if useCustomName is false, it might have been set when selecting existing customer)
      customerName = effectiveCustomCustomerName.trim();
    } else if (effectiveUseCustomName) {
      customerName = (effectiveCustomCustomerName || '').trim();
    } else {
      // Try to find customer by name or ID
      const foundCustomer = state.customers.find(c => c.name === effectiveSelectedCustomer || c.id === effectiveSelectedCustomer);
      customerName = foundCustomer ? foundCustomer.name.trim() : (effectiveSelectedCustomer || '').trim();
    }
    
    // Check if split payment requires name and mobile
    const isSplitPayment = effectivePaymentMethod === 'split' && effectiveSplitPaymentDetails;
    
    // Only require customer name for non-cash payment methods (including split payments)
    if ((effectivePaymentMethod !== 'cash' && effectivePaymentMethod !== 'upi') || isSplitPayment) {
      if (!customerName || customerName === '' || customerName === 'Walk-in Customer') {
        const message = isSplitPayment 
          ? (state.currentLanguage === 'hi' 
              ? 'स्प्लिट भुगतान के लिए ग्राहक का नाम आवश्यक है। कृपया ग्राहक का नाम दर्ज करें।'
              : 'Customer name is required for split payment. Please enter customer name.')
          : getTranslation('pleaseEnterCustomerName', state.currentLanguage);
        showToast(message, 'warning');
        isGeneratingBill.current = false;
        return;
      }
    } else {
      // For cash payments (non-split), use default if no customer name provided
      if (!customerName || customerName.trim() === '') {
        customerName = 'Walk-in Customer';
      }
    }

    const effectiveSendWhatsAppInvoice = modalData ? modalData.sendWhatsAppInvoice : sendWhatsAppInvoice;
    
    const effectiveMobile = effectiveBillingMobile.trim();
    const sanitizedMobile = sanitizeMobileNumber(effectiveMobile);
    
    // Validate mobile number for split payments
    if (isSplitPayment) {
      if (!sanitizedMobile) {
        showToast(
          state.currentLanguage === 'hi'
            ? 'स्प्लिट भुगतान के लिए ग्राहक का मोबाइल नंबर आवश्यक है। कृपया मोबाइल नंबर दर्ज करें।'
            : 'Mobile number is required for split payment. Please enter mobile number.',
          'error'
        );
        isGeneratingBill.current = false;
        return;
      }

      const mobileRegex = /^[6-9]\d{9}$/; // Indian mobile number format
      if (!mobileRegex.test(sanitizedMobile)) {
        showToast(
          state.currentLanguage === 'hi'
            ? 'कृपया एक वैध मोबाइल नंबर दर्ज करें (10 अंक, 6-9 से शुरू)।'
            : 'Please enter a valid mobile number (10 digits, starting with 6-9).',
          'error'
        );
        isGeneratingBill.current = false;
        return;
      }
    }

    if (effectiveSendWhatsAppInvoice) {
      if (!sanitizedMobile) {
        showToast('Please enter a mobile number before sending via WhatsApp.', 'warning');
        isGeneratingBill.current = false;
        return;
      }

      const mobileRegex = /^[6-9]\d{9}$/;
      if (!mobileRegex.test(sanitizedMobile)) {
        showToast('Enter a valid 10-digit mobile number starting with 6-9 for WhatsApp invoices.', 'error');
        isGeneratingBill.current = false;
        return;
      }
    }

    // Validate customer name and mobile number for due payment method or split payment with due
    const isSplitWithDue = effectivePaymentMethod === 'split' && effectiveSplitPaymentDetails && effectiveSplitPaymentDetails.dueAmount > 0;
    if (effectivePaymentMethod === 'due' || effectivePaymentMethod === 'credit' || isSplitWithDue) {
      if (!sanitizedMobile) {
        showToast(
          state.currentLanguage === 'hi'
            ? 'ड्यू भुगतान के लिए ग्राहक का मोबाइल नंबर आवश्यक है। कृपया मोबाइल नंबर दर्ज करें।'
            : 'Mobile number is required for due payment. Please enter mobile number.',
          'error'
        );
        isGeneratingBill.current = false;
        return;
      }

      const mobileRegex = /^[6-9]\d{9}$/; // Indian mobile number format
      if (!mobileRegex.test(sanitizedMobile)) {
        showToast(
          state.currentLanguage === 'hi'
            ? 'कृपया एक वैध मोबाइल नंबर दर्ज करें (10 अंक, 6-9 से शुरू)।'
            : 'Please enter a valid mobile number (10 digits, starting with 6-9).',
          'error'
        );
        isGeneratingBill.current = false;
        return;
      }
    }
    
    const isDueLikePayment = effectivePaymentMethod === 'due' || effectivePaymentMethod === 'credit' || isSplitWithDue;
    let matchedDueCustomer = null;
    // Match existing customer for due payments by BOTH name AND mobile number
    // Only match if BOTH match - if only one matches, create new customer
    if ((effectivePaymentMethod === 'due' || effectivePaymentMethod === 'credit' || isSplitWithDue) && customerName && sanitizedMobile) {
      const normalizedCustomerName = customerName.trim().toLowerCase();
      
      matchedDueCustomer = activeCustomers.find(c => {
        const existingName = (c.name || '').trim().toLowerCase();
        const existingMobile = sanitizeMobileNumber(c.mobileNumber || c.phone || '');
        
        // BOTH name AND mobile must match
        const nameMatches = existingName === normalizedCustomerName;
        const mobileMatches = existingMobile && sanitizedMobile && existingMobile === sanitizedMobile;
        
        return nameMatches && mobileMatches;
      });
      
      if (!matchedDueCustomer && customerLimitReached) {
        showCustomerLimitWarning();
        isGeneratingBill.current = false;
        return;
      }
    }

    // Get sellerId from authentication
    const sellerId = getSellerIdFromAuth();
    if (!sellerId) {
      showToast(
        state.currentLanguage === 'hi'
          ? 'विक्रेता प्रमाणीकरण त्रुटि। कृपया पुनः प्रवेश करें।'
          : 'Seller authentication error. Please login again.',
        'error'
      );
      isGeneratingBill.current = false;
      return;
    }

    // Find customer ID if customer exists (DO NOT CREATE NEW CUSTOMERS HERE - only after order creation)
    // Match by BOTH name AND mobile number - both must match to use existing customer
    let customerId = null;
    if (!useCustomName && selectedCustomer) {
      // Only match existing customer if seller explicitly selected one (not creating new)
      const selectedCustomerObj = state.customers.find(c => c.id === selectedCustomer || c.name === selectedCustomer);
      if (selectedCustomerObj) {
        customerId = selectedCustomerObj.id; // Use frontend ID, will be mapped to MongoDB _id in sync
      }
    }
    
    // Match existing customer by BOTH name AND mobile number
    // Only match if BOTH match - if only one matches, customer will be created after order creation
    if (!customerId && sanitizedMobile && customerName && customerName.trim() !== '' && customerName.trim().toLowerCase() !== 'walk-in customer') {
      const normalizedCustomerName = customerName.trim().toLowerCase();
      
      const existingCustomer = state.customers.find(c => {
        const existingName = (c.name || '').trim().toLowerCase();
        const existingMobile = sanitizeMobileNumber(c.mobileNumber || c.phone || '');
        
        // BOTH name AND mobile must match
        const nameMatches = existingName === normalizedCustomerName;
        const mobileMatches = existingMobile && sanitizedMobile && existingMobile === sanitizedMobile;
        
        return nameMatches && mobileMatches;
      });
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
      }
    }

    // NOTE: Customer creation is now handled AFTER order creation in finalizeOrder function
    // This ensures customers are only created if the order is successfully created

    // Map billItems to Order items format (MongoDB Order schema)
    const orderItems = billItems.map(billItem => {
      const product = state.products.find(p => p.id === billItem.id);
      const productUnit =
        product?.quantityUnit ||
        product?.unit ||
        billItem.productUnit ||
        billItem.quantityUnit ||
        billItem.unit ||
        'pcs';

      // Truncate to 2 decimal places (no rounding)
      const totalSellingPrice =
        billItem.totalSellingPrice ??
        Math.floor(((billItem.price || 0) * (billItem.quantity || 0)) * 100) / 100;
      const totalCostPrice =
        billItem.totalCostPrice ??
        (product ? getItemTotalCost(billItem, product) : Math.floor(((product?.costPrice || product?.unitPrice || 0) * (billItem.quantity || 0)) * 100) / 100);
      const parsedTotalSelling = typeof totalSellingPrice === 'number'
        ? totalSellingPrice
        : parseFloat(totalSellingPrice) || 0;
      const parsedTotalCost = typeof totalCostPrice === 'number'
        ? totalCostPrice
        : parseFloat(totalCostPrice) || 0;

      const quantityInBaseUnit = Number.isFinite(Number(billItem.quantityInBaseUnit))
        ? Number(billItem.quantityInBaseUnit)
        : convertToBaseUnit(
            typeof billItem.quantity === 'number'
              ? billItem.quantity
              : parseFloat(billItem.quantity) || 0,
            billItem.unit || billItem.quantityUnit || productUnit
          );
      const productUnitInBaseUnit = convertToBaseUnit(1, productUnit) || 1;
      const quantityInProductUnits = quantityInBaseUnit / productUnitInBaseUnit;
      const roundedQuantity =
        Math.round((Number.isFinite(quantityInProductUnits) ? quantityInProductUnits : 0) * 1000) /
        1000;

      // Truncate to 2 decimal places (no rounding)
      const unitSellingPrice =
        roundedQuantity !== 0 ? Math.floor((parsedTotalSelling / roundedQuantity) * 100) / 100 : 0;
      const unitCostPrice =
        roundedQuantity !== 0 ? Math.floor((parsedTotalCost / roundedQuantity) * 100) / 100 : 0;
      const roundedTotalSelling = Math.floor(parsedTotalSelling * 100) / 100;
      const roundedTotalCost = Math.floor(parsedTotalCost * 100) / 100;

      return {
        productId: product?._id || billItem.productId || null,
        name: billItem.name || product?.name || '',
        sellingPrice: roundedTotalSelling,
        costPrice: roundedTotalCost,
        quantity: roundedQuantity,
        unit: productUnit,
        totalSellingPrice: roundedTotalSelling,
        totalCostPrice: roundedTotalCost,
        unitSellingPrice,
        unitCostPrice,
        originalQuantity: {
          quantity: Number.isFinite(Number(billItem.quantity))
            ? Number(billItem.quantity)
            : parseFloat(billItem.quantity) || 0,
          unit: billItem.unit || billItem.quantityUnit || productUnit
        }
      };
    });

    // Truncate total to 2 decimal places (no rounding) to avoid floating point precision issues
    const normalizedTotal = Math.floor(total * 100) / 100;
    
    if (!ensureOrderCapacity()) {
      return;
    }

    // Handle split payment (isSplitPayment already declared earlier in generateBill function)
    // effectivePaymentMethod already declared above - use it
    let splitDetails = null;
    
    if (isSplitPayment && effectiveSplitPaymentDetails) {
      // Determine split type based on which amounts are present
      let splitType = effectiveSplitPaymentDetails.splitType || effectiveSplitPaymentDetails.type;
      if (!splitType) {
        // Auto-detect split type based on amounts
        const cash = effectiveSplitPaymentDetails.cashAmount || 0;
        const online = effectiveSplitPaymentDetails.onlineAmount || 0;
        const due = effectiveSplitPaymentDetails.dueAmount || 0;
        
        if (cash > 0 && online > 0) {
          splitType = 'cash_online';
        } else if (online > 0 && due > 0) {
          splitType = 'online_due';
        } else if (cash > 0 && due > 0) {
          splitType = 'cash_due';
        }
      }
      
      splitDetails = {
        type: splitType,
        cashAmount: effectiveSplitPaymentDetails.cashAmount || 0,
        onlineAmount: effectiveSplitPaymentDetails.onlineAmount || 0,
        dueAmount: effectiveSplitPaymentDetails.dueAmount || 0
      };
      
      console.log('🔧 Created splitDetails:', splitDetails);
    }

    // Create Order object matching MongoDB Order schema
    const order = {
      id: Date.now().toString(),
      sellerId: sellerId,
      customerId: customerId,
      customerName: customerName,
      customerMobile: sanitizedMobile || effectiveMobile || '',
      paymentMethod: effectivePaymentMethod,
      splitPaymentDetails: splitDetails,
      items: orderItems,
      totalAmount: normalizedTotal,
      subtotal: subtotal,
      discountPercent: discount,
      taxPercent: tax,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSynced: false,
      stockDeducted: false // Flag to track if stock has been deducted for this order
    };

    console.log('🎯 Preparing Order (MongoDB schema):', order);

    const billItemsSnapshot = billItems.map(item => ({
      ...item,
      total: item.total ?? (item.price || 0) * (item.quantity || 0)
    }));

    // Create bill object for UI compatibility (used in online payment modal, PDF, QR code, etc.)
    const bill = {
      id: order.id,
      customerId: order.customerId,
      customerName: customerName,
      items: billItemsSnapshot,
      subtotal: subtotal,
      discountPercent: discount,
      taxPercent: tax,
      total: order.totalAmount,
      paymentMethod: order.paymentMethod,
      splitPaymentDetails: splitDetails,
      customerMobile: sanitizedMobile || effectiveMobile,
      date: order.createdAt,
      status: (effectivePaymentMethod === 'upi' || (isSplitPayment && splitDetails && splitDetails.onlineAmount > 0)) ? 'pending' : 'completed',
      storeName: state.storeName || 'Grocery Store',
      upiId: sellerUpiId // Always include seller UPI ID in bill object
    };
    
    console.log('🔧 Bill object created with seller UPI ID:', sellerUpiId);

    const finalizePayload = {
      order,
      bill,
      billItemsSnapshot,
      matchedDueCustomer,
      isDueLikePayment,
      customerName,
      sanitizedMobile,
      useCustomNameFlag: effectiveUseCustomName,
      sendWhatsAppInvoiceFlag: effectiveSendWhatsAppInvoice,
      effectiveMobile
    };

    // Handle split payment with online component
    if (isSplitPayment && splitDetails && splitDetails.onlineAmount > 0) {
      console.log('🔧 Split payment with online amount detected:', splitDetails);
      if (!sellerUpiId) {
        showToast('Please add your business UPI ID in Settings before accepting online payments.', 'error');
        isGeneratingBill.current = false;
        return;
      }

      if (pendingOrder) {
        showToast('Please complete the pending online payment before creating a new bill.', 'warning');
        isGeneratingBill.current = false;
        return;
      }

      const billForModal = { ...bill, upiId: sellerUpiId, splitPaymentDetails: splitDetails };
      console.log('🔧 Setting pending order for split payment with online:', {
        order: order,
        splitDetails: splitDetails,
        bill: billForModal,
        sellerUpiId: sellerUpiId
      });
      console.log('🔧 Seller UPI ID being used for QR generation:', sellerUpiId);
      setPendingOrder({
        ...finalizePayload,
        bill: billForModal
      });
      setCurrentBill(billForModal);
      setShowUPIPayment(true);
      isGeneratingBill.current = false;
      return;
    }
    
    // Handle split payment without online component (cash_due) - finalize immediately
    if (isSplitPayment && splitDetails && (!splitDetails.onlineAmount || splitDetails.onlineAmount === 0)) {
      console.log('🔧 Split payment without online amount - finalizing immediately:', splitDetails);
      const success = finalizeOrder(finalizePayload);
      
      if (success) {
        const successMessage = `${getTranslation('billGeneratedSuccessfully', state.currentLanguage)}! ${getTranslation('customers', state.currentLanguage)}: ${bill.customerName}, ${getTranslation('total', state.currentLanguage)}: ₹${bill.total.toFixed(2)}`;
        showToast(successMessage, 'success');
      }
      return;
    }

    if (effectivePaymentMethod === 'upi') {
      if (!sellerUpiId) {
      showToast('Please add your business UPI ID in Settings before accepting online payments.', 'error');
        isGeneratingBill.current = false;
        return;
      }

      if (pendingOrder) {
      showToast('Please complete the pending online payment before creating a new bill.', 'warning');
        isGeneratingBill.current = false;
        return;
      }

      const billForModal = { ...bill, upiId: sellerUpiId };
      console.log('🔧 Setting pending order for UPI payment with seller UPI ID:', sellerUpiId);
      setPendingOrder({
        ...finalizePayload,
        bill: billForModal
      });
      setCurrentBill(billForModal);
      setShowUPIPayment(true);
      isGeneratingBill.current = false;
      return;
    }

    const success = finalizeOrder(finalizePayload);
    
    if (success) {
      // Sound is played in finalizeOrder function when order is created
      const successMessage = `${getTranslation('billGeneratedSuccessfully', state.currentLanguage)}! ${getTranslation('customers', state.currentLanguage)}: ${bill.customerName}, ${getTranslation('total', state.currentLanguage)}: ₹${bill.total.toFixed(2)}`;
      showToast(successMessage, 'success');
    }
  };

  const handleSplitPaymentSubmit = (splitDetails) => {
    setSplitPaymentDetails(splitDetails);
    setShowSplitPayment(false);
    setPaymentMethod('split');
    // Continue with bill generation
    generateBill();
  };

  const handlePaymentReceived = (paymentSummary) => {
    if (!pendingOrder) {
      showToast('No pending online payment to confirm.', 'warning');
      setShowUPIPayment(false);
      setCurrentBill(null);
      return;
    }

    // Check if order was already finalized (prevent duplicate finalization)
    const orderId = pendingOrder.order?.id;
    const existingOrder = orderId ? state.orders.find(o => o.id === orderId) : null;
    if (existingOrder) {
      // Check if stock was already deducted
      if (existingOrder.stockDeducted === true) {
        console.warn('⚠️ Order already finalized with stock deducted, skipping duplicate finalization:', orderId);
        showToast('Order already processed.', 'warning');
        setPendingOrder(null);
        setShowUPIPayment(false);
        setCurrentBill(null);
        isGeneratingBill.current = false;
        return;
      }
    }

    console.log('🔧 Payment received, finalizing order:', {
      pendingOrder: pendingOrder,
      order: pendingOrder.order,
      splitPaymentDetails: pendingOrder.order?.splitPaymentDetails,
      orderId: orderId,
      stockDeducted: pendingOrder.order?.stockDeducted
    });

    // Ensure order has stockDeducted flag set to false before finalizing
    const orderToFinalize = {
      ...pendingOrder,
      order: {
        ...pendingOrder.order,
        stockDeducted: false // Reset flag to allow stock deduction
      }
    };

    const success = finalizeOrder(orderToFinalize);
    
    if (!success) {
      console.error('❌ Failed to finalize order after payment received');
      showToast('Failed to create order. Please try again.', 'error');
      return;
    }

    if (success) {
      // Play cash register sound when UPI payment is received and bill is finalized
      const playCashRegisterSound = async () => {
        const audioPath = '/assets/cash-register-kaching-376867.mp3';
        
        // Try to play MP3 file with better loading
        const tryPlayMP3 = async () => {
          return new Promise(async (resolve, reject) => {
            try {
              // Try using fetch to load as blob for better compatibility
              let audio;
              let blobUrl = null;
              
              try {
                const response = await fetch(audioPath);
                if (response.ok) {
                  const blob = await response.blob();
                  blobUrl = URL.createObjectURL(blob);
                  audio = new Audio(blobUrl);
                } else {
                  // Fallback to direct path
                  audio = new Audio(audioPath);
                }
              } catch (fetchError) {
                // Fallback to direct path
                audio = new Audio(audioPath);
              }
              
              audio.volume = 1.0;
              audio.currentTime = 0;
              
              const handleCanPlay = () => {
                const playPromise = audio.play();
                if (playPromise !== undefined) {
                  playPromise
                    .then(() => {
                      console.log('✅ Cash register sound played successfully');
                      resolve();
                    })
                    .catch(reject);
                } else {
                  resolve();
                }
              };
              
              const handleError = (e) => {
                if (blobUrl) {
                  URL.revokeObjectURL(blobUrl);
                }
                reject(audio.error || new Error('MP3 playback failed'));
              };
              
              if (audio.readyState >= 2) {
                handleCanPlay();
              } else {
                audio.addEventListener('canplaythrough', handleCanPlay, { once: true });
                audio.addEventListener('error', handleError, { once: true });
                audio.load();
              }
            } catch (error) {
              reject(error);
            }
          });
        };
        
        // Try MP3 first - preserve original sound quality
        tryPlayMP3()
          .catch((error) => {
            console.error('❌ MP3 playback failed:', error);
            // Only use fallback if absolutely necessary
            console.warn('Using Web Audio API fallback (lower quality)');
            try {
              const audioContext = new (window.AudioContext || window.webkitAudioContext)();
              const createBeep = (frequency, startTime, duration) => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                oscillator.frequency.value = frequency;
                oscillator.type = 'sine';
                gainNode.gain.setValueAtTime(0.5, startTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
                oscillator.start(startTime);
                oscillator.stop(startTime + duration);
              };
              const now = audioContext.currentTime;
              createBeep(800, now, 0.05);
              createBeep(1000, now + 0.05, 0.05);
              createBeep(1200, now + 0.1, 0.1);
            } catch (e) {
              console.error('❌ Fallback also failed:', e);
            }
          });
      };
      
      playCashRegisterSound();
      
      dispatch({
        type: 'ADD_ACTIVITY',
        payload: {
          id: Date.now().toString(),
          message: `Online payment (UPI) received for Bill #${pendingOrder.bill.id} - ₹${pendingOrder.bill.total.toFixed(2)}${paymentSummary?.transactionId ? ` (Txn: ${paymentSummary.transactionId})` : ''}`,
          timestamp: new Date().toISOString(),
          type: 'payment_received'
        }
      });
      showToast(`Payment of ₹${pendingOrder.bill.total.toFixed(2)} received successfully!`, 'success');
      setShowUPIPayment(false);
      setCurrentBill(null);
      setPendingOrder(null);
    }
  };

  const handleCancelUPIPayment = () => {
    setShowUPIPayment(false);
    setCurrentBill(null);
    setPendingOrder(null);
    isGeneratingBill.current = false;
  };

  const generateQRCode = (bill) => {
    try {
      // Create bill data for QR code
      const discountAmount = ((bill.subtotal || 0) * (bill.discountPercent || 0)) / 100;
      const taxableBase = (bill.subtotal || 0) - discountAmount;
      const taxAmount = (taxableBase * (bill.taxPercent || 0)) / 100;

      const billData = {
        billId: bill.id,
        customerName: bill.customerName,
        items: bill.items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          price: item.price,
          total: item.total
        })),
        subtotal: bill.subtotal,
        discountPercent: bill.discountPercent,
        discountAmount,
        taxPercent: bill.taxPercent,
        taxAmount,
        total: bill.total,
        paymentMethod: bill.paymentMethod,
        date: bill.date,
        storeName: state.storeName || 'Grocery Store'
      };

      setQrCodeData(billData);
      setShowQRCode(true);
    } catch (error) {
      console.error('Error generating QR code:', error);
      showToast('Error generating QR code', 'error');
    }
  };

  const generateAndDownloadPDF = (bill) => {
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      pdf.setFont('helvetica');
      
      // Header
      pdf.setFontSize(20);
      pdf.setTextColor(16, 185, 129);
      pdf.text('Grocery Store Invoice', 105, 15, { align: 'center' });
      
      // Customer & Invoice Details
      pdf.setFontSize(10);
      pdf.setTextColor(0, 0, 0);
      pdf.text(`Customer Name: ${bill.customerName}`, 20, 25);
      pdf.text(`Date: ${new Date(bill.date).toLocaleDateString()}`, 20, 30);
      pdf.text(`Invoice #: ${bill.id}`, 20, 35);
      if (state.gstNumber) {
        pdf.text(`GST #: ${state.gstNumber}`, 105, 25, { align: 'right' });
      }
      
      // Table Header
      pdf.setFillColor(243, 244, 246);
      pdf.rect(20, 42, 170, 8, 'F');
      pdf.setFontSize(10);
      pdf.setTextColor(0, 0, 0);
      pdf.text('Product Name', 22, 48);
      pdf.text('Qty', 110, 48);
      pdf.text('Price', 135, 48);
      pdf.text('Total', 170, 48);
      
      // Table Rows
      let yPosition = 54;
      bill.items.forEach(item => {
        pdf.setFontSize(9);
        // Product Name (wrapped if too long)
        const productName = item.name.length > 25 ? item.name.substring(0, 25) + '...' : item.name;
        pdf.text(productName, 22, yPosition);
        
        // Quantity with unit
        const qty = item.displayQuantity || `${item.quantity} ${item.unit || item.quantityUnit || 'pcs'}`;
        pdf.text(qty, 110, yPosition);
        
        // Price per unit
        pdf.text(`INR ${item.price.toFixed(2)}`, 135, yPosition);
        
        // Total
        pdf.text(`INR ${getItemTotalAmount(item).toFixed(2)}`, 170, yPosition);
        
        yPosition += 7;
      });
      
      // Totals Section
      yPosition += 5;
      pdf.setLineWidth(0.5);
      pdf.line(20, yPosition, 190, yPosition);
      yPosition += 5;
      
      pdf.setFontSize(10);
      pdf.text(`Subtotal:`, 120, yPosition);
      pdf.text(`INR ${bill.subtotal.toFixed(2)}`, 170, yPosition, { align: 'right' });
      
      const discountAmount = ((bill.subtotal || 0) * (bill.discountPercent || 0)) / 100;
      const taxableBase = (bill.subtotal || 0) - discountAmount;
      const taxAmount = (taxableBase * (bill.taxPercent || 0)) / 100;

      if (discountAmount > 0) {
        yPosition += 5;
        pdf.text(`Discount (${bill.discountPercent || 0}%):`, 120, yPosition);
        pdf.text(`INR -${discountAmount.toFixed(2)}`, 170, yPosition, { align: 'right' });
      }
      
      if (taxAmount > 0) {
        yPosition += 5;
        pdf.text(`Tax (${bill.taxPercent || 0}%):`, 120, yPosition);
        pdf.text(`INR ${taxAmount.toFixed(2)}`, 170, yPosition, { align: 'right' });
      }
      
      yPosition += 5;
      pdf.line(20, yPosition, 190, yPosition);
      yPosition += 5;
      
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`Total Amount:`, 120, yPosition);
      pdf.text(`INR ${bill.total.toFixed(2)}`, 170, yPosition, { align: 'right' });
      
      // Payment Method
      yPosition += 10;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text(`Payment Method: ${getPaymentMethodLabel(bill.paymentMethod)}`, 20, yPosition);
      
      // Thank you message
      yPosition += 8;
      pdf.setFontSize(10);
      pdf.text('Thank you for your business!', 105, yPosition, { align: 'center' });
      
      // Download
      pdf.save(`invoice_${bill.customerName.replace(/\s+/g, '_')}_${bill.id}.pdf`);
      
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF. Please try again.');
    }
  };

  const makePayment = () => {
    console.log('🚀🚀🚀 makePayment FUNCTION CALLED 🚀🚀🚀');
    console.log('makePayment called at:', new Date().toISOString());
    console.trace('makePayment call stack');
    console.log('Bill items length:', billItems.length);
    
    if (billItems.length === 0) {
      console.log('❌ No bill items, returning early');
      return;
    }
    
    console.log('=== MAKE PAYMENT DEBUG ===');
    console.log('Bill Items:', billItems);
    console.log('All Products:', state.products);
    console.log('Payment Method:', paymentMethod);
    console.log('Selected Customer:', selectedCustomer);
    console.log('Total:', total);
    console.log('========================');
    
      // Validate customer name and mobile number for due payment method only
    if (paymentMethod === 'due' || paymentMethod === 'credit') {
      // Validate customer name - prioritize customCustomerName if it exists
      let customerName = '';
      if (customCustomerName && customCustomerName.trim()) {
        customerName = customCustomerName.trim();
      } else if (useCustomName) {
        customerName = (customCustomerName || '').trim();
      } else {
        // Try to find customer by name or ID
        const foundCustomer = state.customers.find(c => c.name === selectedCustomer || c.id === selectedCustomer);
        customerName = foundCustomer ? foundCustomer.name.trim() : (selectedCustomer || '').trim();
      }
      
      // Customer name is required for due/credit payments
      if (!customerName || customerName === '') {
        showToast(
          state.currentLanguage === 'hi'
            ? 'कृपया क्रेता का नाम दर्ज करें।'
            : 'Please enter customer name.',
          'error'
        );
        return;
      }

      let customerMobile = '';
      
      if (useCustomName) {
        // For custom name, use the mobile number from input field
        customerMobile = customCustomerMobile || '';
        
        // If mobile not provided in input, check if customer exists
        if (!customerMobile || customerMobile.trim() === '') {
          const existingCustomer = allCustomers.find(c => c.name.toLowerCase() === customCustomerName.toLowerCase());
          if (existingCustomer) {
            customerMobile = existingCustomer.mobileNumber || existingCustomer.phone || ''; // Backward compatibility
          }
        }
      } else {
        // For selected customer, get the customer object
        const selectedCustomerObj = state.customers.find(c => c.id === selectedCustomer);
        if (!selectedCustomerObj) {
          showToast(
            state.currentLanguage === 'hi'
              ? 'कृपया एक वैध ग्राहक चुनें।'
              : 'Please select a valid customer.',
            'error'
          );
          return;
        }
        customerMobile = selectedCustomerObj.mobileNumber || selectedCustomerObj.phone || ''; // Backward compatibility
      }

      // Check if mobile number is provided
      if (!customerMobile || customerMobile.trim() === '') {
        showToast(
          state.currentLanguage === 'hi'
            ? 'ड्यू भुगतान के लिए ग्राहक का मोबाइल नंबर आवश्यक है। कृपया मोबाइल नंबर दर्ज करें।'
            : 'Mobile number is required for due payment. Please enter mobile number.',
          'error'
        );
        return;
      }

      // Validate mobile number format (basic validation)
      const mobileRegex = /^[6-9]\d{9}$/; // Indian mobile number format
      const cleanedMobile = customerMobile.replace(/\D/g, '');
      if (!mobileRegex.test(cleanedMobile)) {
        showToast(
          state.currentLanguage === 'hi'
            ? 'कृपया एक वैध मोबाइल नंबर दर्ज करें (10 अंक, 6-9 से शुरू)।'
            : 'Please enter a valid mobile number (10 digits, starting with 6-9).',
          'error'
        );
        return;
      }
    }
    
    console.log('✅ Validation passed, proceeding to create order...');
    
    try {
      console.log('📦 Starting product quantity reduction...');
      // Reduce quantity for each item when bill is created
      billItems.forEach((billItem, index) => {
        const product = state.products.find(p => p.id === billItem.productId || p.id === billItem.id);
        if (product) {
          console.log(`=== QUANTITY REDUCTION DEBUG [Item ${index + 1}] ===`);
          console.log('Product ID:', product.id, 'Name:', product.name);
          const currentQuantity = product.quantity !== undefined ? product.quantity : (product.stock !== undefined ? product.stock : 0);
          console.log('Current Quantity:', currentQuantity, 'Unit:', product.unit || product.quantityUnit || 'pcs');
          console.log('Billing Quantity:', billItem.quantity, 'Unit:', billItem.unit || product.unit || product.quantityUnit || 'pcs');
          
          // Simple quantity reduction - if units match, subtract directly
          let newQuantity = currentQuantity;
          const productUnit = product.unit || product.quantityUnit || 'pcs';
          const billingUnit = billItem.unit || productUnit;
          
          if (billingUnit === productUnit || !billItem.unit) {
            // Same units, direct subtraction
            newQuantity = currentQuantity - billItem.quantity;
            console.log('Direct subtraction:', currentQuantity, '-', billItem.quantity, '=', newQuantity);
          } else {
            // Different units, use conversion
            const billingQuantityInBaseUnit = convertToBaseUnit(billItem.quantity, billingUnit);
            const currentQuantityInBaseUnit = convertToBaseUnit(currentQuantity, productUnit);
            const newQuantityInBaseUnit = currentQuantityInBaseUnit - billingQuantityInBaseUnit;
            newQuantity = convertFromBaseUnit(newQuantityInBaseUnit, productUnit);
            console.log('Unit conversion - New quantity:', newQuantity);
          }
          
          const finalQuantity = Math.max(0, newQuantity);
          console.log('Final Quantity:', finalQuantity);
          console.log('========================');
          
          // Update product quantity - update both quantity and stock for MongoDB compatibility
          // CRITICAL: Always set isSynced: false when updating from order creation
          // The product hasn't synced to MongoDB yet, so it must remain unsynced
          const updatedProduct = {
            ...product,
            id: product.id, // Ensure ID is preserved
            quantity: finalQuantity,
            stock: finalQuantity, // MongoDB uses 'stock' field
            isSynced: false, // CRITICAL: Mark as unsynced - product hasn't synced to MongoDB yet
            syncedAt: undefined // Ensure syncedAt is not set (would make it look like synced)
          };
          
          console.log('Dispatching UPDATE_PRODUCT for:', updatedProduct.name, 'New quantity:', updatedProduct.quantity, 'isSynced:', updatedProduct.isSynced);
          dispatch({
            type: ActionTypes.UPDATE_PRODUCT,
            payload: updatedProduct
          });
        } else {
          console.error('Product not found for bill item:', billItem);
          console.error('Searched products:', state.products.map(p => ({ id: p.id, name: p.name })));
        }
      });
      
      console.log('📝 Starting order creation process...');
      
      // Create Order record (Order model is for sales/billing records, not Transaction)
      // Order model: sellerId (required), customerId, paymentMethod, items[], totalAmount
      
      // Extract sellerId from authenticated seller (using same method as apiRequest)
      console.log('🔍 Extracting sellerId from auth...');
      const sellerId = getSellerIdFromAuth();
      console.log('Extracted sellerId:', sellerId);
      console.log('Auth state:', localStorage.getItem('auth'));
      console.log('Current user:', state.currentUser);
      
      if (!sellerId) {
        console.error('❌ Cannot create order: sellerId is missing');
        console.error('Auth state:', localStorage.getItem('auth'));
        console.error('Current user:', state.currentUser);
        showToast('Error: User not authenticated. Please login again.', 'error');
        return;
      }
      
      console.log('✅ SellerId extracted successfully:', sellerId);
      
      // Validate billItems before creating order
      if (!billItems || billItems.length === 0) {
        console.error('Cannot create order: billItems is empty');
        showToast('Error: No items in the bill. Please add items before confirming.', 'error');
        return;
      }
      
      const orderItems = billItems.map((item, index) => {
        // Get product to include costPrice
        const product = state.products.find(p => p.id === item.productId || p.id === item.id);
        const costPrice = product?.costPrice ?? product?.unitPrice ?? 0;
        
        console.log(`Order Item ${index + 1}:`, {
          productId: item.productId || item.id,
          productName: item.name,
          product: product ? { id: product.id, name: product.name, costPrice: product.costPrice, unitPrice: product.unitPrice } : 'NOT FOUND',
          costPrice: costPrice,
          sellingPrice: item.price,
          quantity: item.quantity,
          unit: item.unit
        });
        
        // Order model items: name, sellingPrice, costPrice, quantity, unit (all required)
        const orderItem = {
          name: item.name || '',
          sellingPrice: Number(item.price) || 0,
          costPrice: Number(costPrice) || 0, // Ensure it's a number, default to 0
          quantity: Number(item.quantity) || 0,
          unit: item.unit || 'pcs'
        };
        
        // Validate item structure
        if (!orderItem.name || orderItem.name.trim() === '') {
          console.error(`❌ Order Item ${index + 1} validation failed: Name is empty`);
        }
        if (orderItem.sellingPrice === undefined || orderItem.sellingPrice === null || typeof orderItem.sellingPrice !== 'number' || orderItem.sellingPrice < 0) {
          console.error(`❌ Order Item ${index + 1} validation failed: sellingPrice is invalid:`, orderItem.sellingPrice, typeof orderItem.sellingPrice);
        }
        if (orderItem.costPrice === undefined || orderItem.costPrice === null || typeof orderItem.costPrice !== 'number') {
          console.error(`❌ Order Item ${index + 1} validation failed: costPrice is invalid:`, orderItem.costPrice, typeof orderItem.costPrice);
        }
        if (orderItem.quantity === undefined || orderItem.quantity === null || typeof orderItem.quantity !== 'number' || orderItem.quantity < 1) {
          console.error(`❌ Order Item ${index + 1} validation failed: quantity is invalid:`, orderItem.quantity, typeof orderItem.quantity);
        }
        if (!orderItem.unit || typeof orderItem.unit !== 'string') {
          console.error(`❌ Order Item ${index + 1} validation failed: unit is invalid:`, orderItem.unit, typeof orderItem.unit);
        }
        
        console.log(`✅ Order Item ${index + 1} structure:`, orderItem);
        
        return orderItem;
      });
      
      // Validate items array
      if (orderItems.length === 0) {
        console.error('Cannot create order: orderItems array is empty after mapping');
        showToast('Error: Could not process order items. Please try again.', 'error');
        return;
      }
      
      const order = {
        id: Date.now().toString(),
        sellerId: sellerId, // Required field for MongoDB
        customerId: selectedCustomer || null, // Can be null for walk-in customers
        paymentMethod: paymentMethod === 'due' ? 'due' : (paymentMethod || 'cash'), // Order model uses 'due' not 'credit'
        items: orderItems,
        totalAmount: Number(total) || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      // Validate order before dispatching
      console.log('Creating order:', JSON.stringify(order, null, 2));
      console.log('Order items count:', order.items.length);
      console.log('Order totalAmount:', order.totalAmount);
      console.log('Order sellerId:', order.sellerId);
      
      if (!order.sellerId) {
        console.error('Order validation failed: sellerId is missing');
        showToast('Error: User not authenticated. Please login again.', 'error');
        return;
      }
      
      if (!order.items || order.items.length === 0) {
        console.error('Order validation failed: items array is empty');
        showToast('Error: No items in order. Please add items before confirming.', 'error');
        return;
      }
      
      if (!order.totalAmount || order.totalAmount <= 0) {
        console.error('Order validation failed: totalAmount is invalid:', order.totalAmount);
        showToast('Error: Invalid order total. Please try again.', 'error');
        return;
      }
      
      // Check plan limit BEFORE creating order
      const activeOrders = state.orders.filter(order => !order.isDeleted);
      const totalOrders = activeOrders.length;
      const { maxOrders } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
      const canAdd = canAddOrder(totalOrders, state.currentPlan, state.currentPlanDetails);
      
      if (!canAdd) {
        const orderLimitLabel = maxOrders === Infinity ? 'Unlimited' : maxOrders;
        const planNameLabel = state.currentPlanDetails?.planName
          || (state.currentPlan ? `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}` : 'Current');
        const limitMessage = `Your limit is full! You've reached the order limit (${orderLimitLabel}) for the ${planNameLabel} plan. Upgrade your plan to create more orders.`;
        
        console.error('Order limit reached:', limitMessage);
        showToast(limitMessage, 'error', 5000);
        return;
      }
      
      // Validate order items structure before dispatch
      console.log('=== VALIDATING ORDER ITEMS ===');
      order.items.forEach((item, index) => {
        console.log(`Item ${index + 1}:`, {
          name: item.name,
          nameType: typeof item.name,
          sellingPrice: item.sellingPrice,
          sellingPriceType: typeof item.sellingPrice,
          costPrice: item.costPrice,
          costPriceType: typeof item.costPrice,
          quantity: item.quantity,
          quantityType: typeof item.quantity,
          unit: item.unit,
          unitType: typeof item.unit
        });
        
        // Check for validation issues
        if (!item.name || item.name.trim() === '') {
          console.error(`❌ Item ${index + 1} validation: Name is empty or invalid`);
        }
        if (typeof item.sellingPrice !== 'number' || item.sellingPrice < 0) {
          console.error(`❌ Item ${index + 1} validation: sellingPrice is invalid:`, item.sellingPrice);
        }
        if (typeof item.costPrice !== 'number' || item.costPrice < 0) {
          console.error(`❌ Item ${index + 1} validation: costPrice is invalid:`, item.costPrice);
        }
        if (typeof item.quantity !== 'number' || item.quantity <= 0) {
          console.error(`❌ Item ${index + 1} validation: quantity is invalid:`, item.quantity);
        }
        if (!item.unit || typeof item.unit !== 'string') {
          console.error(`❌ Item ${index + 1} validation: unit is invalid:`, item.unit);
        }
      });
      
      // Dispatch order - it will be saved to IndexedDB and synced to MongoDB
      console.log('=== FINAL ORDER OBJECT BEFORE DISPATCH ===');
      console.log('Order ID:', order.id, '(type:', typeof order.id, ')');
      console.log('Order sellerId:', order.sellerId, '(type:', typeof order.sellerId, ')');
      console.log('Order paymentMethod:', order.paymentMethod, '(type:', typeof order.paymentMethod, ')');
      console.log('Order items count:', order.items.length);
      console.log('Order items:', order.items);
      console.log('Order totalAmount:', order.totalAmount, '(type:', typeof order.totalAmount, ')');
      console.log('Full order:', JSON.stringify(order, null, 2));
      console.log('==========================================');
      console.log('🚀 Dispatching ADD_ORDER action...');
      
      // Dispatch order - it will be saved to IndexedDB and synced to MongoDB
      console.log('🚀 About to dispatch ADD_ORDER action...');
      console.log('Order payload:', order);
      console.log('Dispatch function:', dispatch);
      console.log('Dispatch type:', typeof dispatch);
      
      try {
        // Use ActionTypes constant to ensure correct action type
        const action = { type: ActionTypes.ADD_ORDER, payload: order };
        console.log('Dispatching action:', action);
        console.log('Action type:', ActionTypes.ADD_ORDER);
        dispatch(action);
        console.log('✅ ADD_ORDER action dispatched successfully');
      } catch (error) {
        console.error('❌ Error dispatching ADD_ORDER:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        showToast('Error creating order. Please try again.', 'error');
        return; // Exit early if dispatch fails
      }
      
      // Update customer balance if payment method is 'due' (using dueAmount field)
      if (paymentMethod === 'due') {
        const customer = state.customers.find(c => c.id === selectedCustomer);
        if (customer) {
          const currentBalance = customer.dueAmount || customer.balanceDue || 0;
          const newBalance = currentBalance + total;
          dispatch({
            type: ActionTypes.UPDATE_CUSTOMER,
            payload: {
              ...customer,
              dueAmount: newBalance, // Use dueAmount field for database
              balanceDue: newBalance // Keep for backward compatibility
            }
          });
        }
      }
      
      // Clear the bill
      setBillItems([]);
      setDiscount(0);
      setTax(0);
      setSelectedCustomer('');
      setCustomCustomerName('');
      setCustomCustomerMobile('');
      setUseCustomName(false);
      
      // Force UI refresh by dispatching a dummy action to trigger re-render
      dispatch({ type: ActionTypes.FORCE_REFRESH });
      
      // Show success message
      showToast(`Order created successfully for ₹${Number(total || 0).toFixed(2)}.`, 'success');
    } catch (error) {
      console.error('Error processing payment:', error);
      if (window.showToast) {
        window.showToast('Error processing payment. Please try again.', 'error');
      }
    }
  };

  const shareBillToWhatsApp = () => {
    if (billItems.length === 0) return;
    
    try {
      // Generate PDF first
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      pdf.setFont('helvetica', 'normal');

      // Title
      pdf.setFontSize(18);
      pdf.text('TAX INVOICE', pageWidth / 2, 15, { align: 'center' });

      // Store & GST
      pdf.setFontSize(11);
      const storeName = state.username || 'Grocery Store';
      const gstNo = state.gstNumber || 'N/A';
      pdf.text(storeName, 14, 26);
      pdf.text(`GST: ${gstNo}`, 14, 32);

      // Invoice meta & customer
      const billId = `BILL-${Date.now().toString().slice(-6)}`;
      const customerName = useCustomName ? customCustomerName : (state.customers.find(c => c.id === selectedCustomer)?.name || 'Walk-in Customer');
      pdf.text(`Invoice: ${billId}`, pageWidth - 14, 26, { align: 'right' });
      pdf.text(`Date: ${new Date().toLocaleDateString()}`, pageWidth - 14, 32, { align: 'right' });
      pdf.text(`Customer: ${customerName}`, 14, 42);
      pdf.text(`Payment: ${getPaymentMethodLabel(paymentMethod)}`, 14, 48);

      // Table header
      const headerY = 58;
      pdf.setFillColor(234, 238, 243);
      pdf.setDrawColor(220);
      pdf.rect(10, headerY - 6, pageWidth - 20, 8, 'F');
      pdf.setFontSize(10);
      pdf.setTextColor(30);
      pdf.text('Item', 14, headerY);
      pdf.text('Qty', 100, headerY);
      pdf.text('Rate (Rs)', 130, headerY, { align: 'right' });
      pdf.text('Amount (Rs)', pageWidth - 14, headerY, { align: 'right' });

      // Rows
      let y = headerY + 6;
      pdf.setTextColor(50);
      pdf.setFontSize(9);
      billItems.forEach(item => {
        if (y > pageHeight - 40) {
          pdf.addPage();
          // redraw header
          pdf.setFillColor(234, 238, 243);
          pdf.setDrawColor(220);
          pdf.rect(10, 10, pageWidth - 20, 8, 'F');
          pdf.setFontSize(10);
          pdf.setTextColor(30);
          pdf.text('Item', 14, 16);
          pdf.text('Qty', 100, 16);
          pdf.text('Rate (Rs)', 130, 16, { align: 'right' });
          pdf.text('Amount (Rs)', pageWidth - 14, 16, { align: 'right' });
          y = 24;
          pdf.setTextColor(50);
          pdf.setFontSize(9);
        }
        const amount = getItemTotalAmount(item).toFixed(2);
        pdf.text(item.name.substring(0, 30), 14, y);
        pdf.text(`${item.quantity} ${item.unit || ''}`, 100, y);
        pdf.text(`${item.price.toFixed(2)}`, 130, y, { align: 'right' });
        pdf.text(`${amount}`, pageWidth - 14, y, { align: 'right' });
        y += 5;
      });

      // Totals box
      y += 4;
      pdf.setDrawColor(220);
      pdf.rect(pageWidth - 80, y, 70, 28);
      pdf.setFontSize(10);
      pdf.text(`Subtotal: Rs ${subtotal.toFixed(2)}`, pageWidth - 76, y + 8);
      pdf.text(`Discount: Rs ${discountAmount.toFixed(2)}`, pageWidth - 76, y + 14);
      pdf.text(`Tax: Rs ${taxAmount.toFixed(2)}`, pageWidth - 76, y + 20);
      pdf.setFontSize(12);
      pdf.text(`TOTAL: Rs ${total.toFixed(2)}`, pageWidth - 76, y + 26);

      // Footer
      pdf.setFontSize(9);
      pdf.setTextColor(120);
      pdf.text('Thank you for your business!', pageWidth / 2, pageHeight - 10, { align: 'center' });

      // Generate PDF blob for sharing
      const pdfBlob = pdf.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      
      // Create a temporary link to download the PDF
      const a = document.createElement('a');
      a.href = pdfUrl;
      a.download = `invoice-${customerName.replace(/\s+/g, '-')}-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Open WhatsApp Web with file sharing
      const whatsappMessage = `Invoice from ${storeName}\nCustomer: ${customerName}\nTotal: Rs ${total.toFixed(2)}\n\nPlease check the downloaded PDF file.`;
      const whatsappUrl = `https://web.whatsapp.com/send?text=${encodeURIComponent(whatsappMessage)}`;
      
      // Open WhatsApp Web
      window.open(whatsappUrl, '_blank');
      
      // Clean up the URL
      setTimeout(() => {
        URL.revokeObjectURL(pdfUrl);
      }, 1000);
      
      if (window.showToast) {
        window.showToast('PDF downloaded! WhatsApp Web opened - attach the PDF file manually.', 'success');
      }
    } catch (error) {
      console.error('Error sharing to WhatsApp:', error);
      if (window.showToast) {
        window.showToast('Error sharing to WhatsApp. Please try again.', 'error');
      }
    }
  };

  const downloadBill = () => {
    if (billItems.length === 0) return;

    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      pdf.setFont('helvetica', 'normal');

      // Title
      pdf.setFontSize(18);
      pdf.text('TAX INVOICE', pageWidth / 2, 15, { align: 'center' });

      // Store & GST
      pdf.setFontSize(11);
      const storeName = state.username || 'Grocery Store';
      const gstNo = state.gstNumber || 'N/A';
      pdf.text(storeName, 14, 26);
      pdf.text(`GST: ${gstNo}`, 14, 32);

      // Invoice meta & customer
      const billId = `BILL-${Date.now().toString().slice(-6)}`;
      const customerName = useCustomName ? customCustomerName : (state.customers.find(c => c.id === selectedCustomer)?.name || 'Walk-in Customer');
      pdf.text(`Invoice: ${billId}`, pageWidth - 14, 26, { align: 'right' });
      pdf.text(`Date: ${new Date().toLocaleDateString()}`, pageWidth - 14, 32, { align: 'right' });
      pdf.text(`Customer: ${customerName}`, 14, 42);
      pdf.text(`Payment: ${getPaymentMethodLabel(paymentMethod)}`, 14, 48);

      // Table header
      const headerY = 58;
      pdf.setFillColor(234, 238, 243);
      pdf.setDrawColor(220);
      pdf.rect(10, headerY - 6, pageWidth - 20, 8, 'F');
      pdf.setFontSize(10);
      pdf.setTextColor(30);
      pdf.text('Item', 14, headerY);
      pdf.text('Qty', 100, headerY);
      pdf.text('Rate (Rs)', 130, headerY, { align: 'right' });
      pdf.text('Amount (Rs)', pageWidth - 14, headerY, { align: 'right' });

      // Rows
      let y = headerY + 6;
      pdf.setTextColor(50);
      pdf.setFontSize(9);
      billItems.forEach(item => {
        if (y > pageHeight - 40) {
          pdf.addPage();
          // redraw header
          pdf.setFillColor(234, 238, 243);
          pdf.setDrawColor(220);
          pdf.rect(10, 10, pageWidth - 20, 8, 'F');
          pdf.setFontSize(10);
          pdf.setTextColor(30);
          pdf.text('Item', 14, 16);
          pdf.text('Qty', 100, 16);
          pdf.text('Rate (Rs)', 130, 16, { align: 'right' });
          pdf.text('Amount (Rs)', pageWidth - 14, 16, { align: 'right' });
          y = 24;
          pdf.setTextColor(50);
          pdf.setFontSize(9);
        }
        const amount = getItemTotalAmount(item).toFixed(2);
        pdf.text(item.name.substring(0, 30), 14, y);
        pdf.text(`${item.quantity} ${item.unit || ''}`, 100, y);
        pdf.text(`${item.price.toFixed(2)}`, 130, y, { align: 'right' });
        pdf.text(`${amount}`, pageWidth - 14, y, { align: 'right' });
        y += 5;
      });

      // Totals box
      y += 4;
      pdf.setDrawColor(220);
      pdf.rect(pageWidth - 80, y, 70, 28);
      pdf.setFontSize(10);
      pdf.text(`Subtotal: Rs ${subtotal.toFixed(2)}`, pageWidth - 76, y + 8);
      pdf.text(`Discount: Rs ${discountAmount.toFixed(2)}`, pageWidth - 76, y + 14);
      pdf.text(`Tax: Rs ${taxAmount.toFixed(2)}`, pageWidth - 76, y + 20);
      pdf.setFontSize(12);
      pdf.text(`TOTAL: Rs ${total.toFixed(2)}`, pageWidth - 76, y + 26);

      // Footer
      pdf.setFontSize(9);
      pdf.setTextColor(120);
      pdf.text('Thank you for your business!', pageWidth / 2, pageHeight - 10, { align: 'center' });

      pdf.save(`invoice-${customerName.replace(/\s+/g, '-')}-${Date.now()}.pdf`);

      if (window.showToast) {
        window.showToast('Bill downloaded successfully!', 'success');
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  };

  // F4 keyboard shortcut to print/download bill
  useEffect(() => {
    const handleKeyPress = (event) => {
      // Check if F4 key is pressed (keyCode 115 or key === 'F4')
      if (event.keyCode === 115 || event.key === 'F4') {
        // Prevent default browser behavior
        event.preventDefault();
        
        // Only download if there are bill items
        if (billItems.length > 0) {
          downloadBill();
        } else {
          showToast('Please add items to the bill first', 'warning');
        }
      }
    };

    // Add event listener
    window.addEventListener('keydown', handleKeyPress);

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [billItems]); // Only depend on billItems - downloadBill will use current values via closure

  // Import formatNumber from utils instead of abbreviating
  const formatNumber = (num) => {
    const numValue = Number(num);
    if (!Number.isFinite(numValue)) {
      return '₹0.00';
    }
    // Truncate to 2 decimal places (no rounding)
    const truncated = Math.floor(numValue * 100) / 100;
    return `₹${truncated.toFixed(2)}`;
  };

  const getPaymentMethodLabel = (method) => {
    if (!method) return 'Cash';
    switch (method) {
      case 'upi':
        return 'Online Payment';
      case 'due':
        return 'Due (Credit)';
      case 'credit':
        return 'Due (Credit)';
      default:
        return method.charAt(0).toUpperCase() + method.slice(1);
    }
  };

  const getDaysRemainingMessage = (days) => {
    if (days === 0) return 'Subscription Expired';
    if (days <= 3) return `${days} Day${days === 1 ? '' : 's'} Left - Recharge Now!`;
    if (days <= 10) return `${days} Days Left - Recharge Soon!`;
    return `${days} Days Remaining`;
  };

  function getItemTotalAmount(item) {
    const baseTotal = item?.totalSellingPrice ?? (item?.price ?? 0) * (item?.quantity ?? 0);
    // Truncate to 2 decimal places (no rounding)
    return Math.floor((Number(baseTotal) || 0) * 100) / 100;
  }

  function getItemTotalCost(item, product) {
    if (item?.totalCostPrice !== undefined && item?.totalCostPrice !== null) {
      // Truncate to 2 decimal places (no rounding)
      return Math.floor((Number(item.totalCostPrice) || 0) * 100) / 100;
    }
    const productUnit = item.productUnit || product?.quantityUnit || product?.unit || 'pcs';
    const costPricePerProductUnit = item.productCostPricePerUnit ?? product?.costPrice ?? product?.unitPrice ?? 0;
    const quantityInProductUnits = item.selectedQuantityInProductUnits ?? (() => {
      const quantityInBaseUnit = convertToBaseUnit(item.quantity, item.unit);
      const productUnitInBaseUnit = convertToBaseUnit(1, productUnit) || 1;
      return quantityInBaseUnit / productUnitInBaseUnit;
    })();
    // Truncate to 2 decimal places (no rounding)
    return Math.floor((costPricePerProductUnit * quantityInProductUnits) * 100) / 100;
  }

  const buildBillItem = (product, quantity, unit, baseUnitHint, fixedAmount = null) => {
    const productUnit = product.quantityUnit || product.unit || 'pcs';
    const baseUnit = baseUnitHint || getBaseUnit(productUnit);
    const quantityInBaseUnit = convertToBaseUnit(quantity, unit);
    const productUnitInBaseUnitRaw = convertToBaseUnit(1, productUnit);
    const productUnitInBaseUnit = productUnitInBaseUnitRaw === 0 ? 1 : productUnitInBaseUnitRaw;
    const quantityInProductUnits = quantityInBaseUnit / productUnitInBaseUnit;

    const sellingPricePerProductUnit = Number(product.sellingPrice || product.costPrice || 0);
    const costPricePerProductUnit = Number(product.costPrice || product.unitPrice || 0);
    
    // If fixedAmount is provided (for amount-based items), use it directly to ensure exact amount
    // Otherwise, calculate from quantity and price
    const totalSellingPrice = fixedAmount !== null 
      ? Math.floor((Number(fixedAmount) || 0) * 100) / 100  // Use exact amount
      : Math.floor((sellingPricePerProductUnit * quantityInProductUnits) * 100) / 100;  // Calculate from quantity
    
    // For cost price, still calculate from quantity (we don't have fixed cost amount)
    const totalCostPrice = Math.floor((costPricePerProductUnit * quantityInProductUnits) * 100) / 100;
    const priceCalculation = calculatePriceWithUnitConversion(
      quantity,
      unit,
      product.sellingPrice || product.costPrice || 0,
      product.quantityUnit || 'pcs'
    );

    return {
      id: product.id,
      productId: product._id || product.id,
      name: product.name,
      // Truncate to 2 decimal places (no rounding)
      price: quantity !== 0 ? Math.floor((totalSellingPrice / quantity) * 100) / 100 : 0,
      quantity,
      unit,
      quantityUnit: product.quantityUnit || 'pcs',
      category: product.category,
      displayQuantity: priceCalculation.displayQuantity,
      maxQuantity: product.quantity || product.stock || 0,
      baseUnit,
      productUnit,
      productSellingPricePerUnit: sellingPricePerProductUnit,
      productCostPricePerUnit: costPricePerProductUnit,
      selectedQuantityInProductUnits: quantityInProductUnits,
      totalSellingPrice,
      totalCostPrice,
      quantityInBaseUnit: quantityInBaseUnit
    };
  };

  return (
    <div className="min-h-screen pb-8">
      {/* Simple Premium Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              {getTranslation('billingSystem', state.currentLanguage)}
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {getTranslation('createAndManageBills', state.currentLanguage)}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={downloadBill}
              className="btn-secondary text-sm px-4 py-2 flex items-center justify-center gap-2"
              disabled={billItems.length === 0}
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Download</span>
            </button>
            {(state.currentPlan === 'standard' || state.currentPlan === 'premium') && (
              <button
                onClick={shareBillToWhatsApp}
                className="btn-primary text-sm px-4 py-2 flex items-center justify-center gap-2"
                disabled={billItems.length === 0}
              >
                <Share2 className="h-4 w-4" />
                <span className="hidden sm:inline">Share</span>
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="px-2.5 py-1 rounded-md font-medium" style={{ 
            background: 'var(--brand-primary-soft)', 
            color: 'var(--brand-primary)'
          }}>
            Orders: {ordersUsed}/{orderLimitLabel}
          </span>
          <span className="px-2.5 py-1 rounded-md font-medium" style={{ 
            background: 'var(--brand-accent-soft)', 
            color: '#C2410C'
          }}>
            Customers: {customersUsed}/{customerLimitLabel}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Customer & Products */}
        <div className="lg:col-span-2 space-y-5">
          {/* Products - Simple & Clean */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Add Products
            </h3>
            
            <div className="space-y-3 mb-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input-field pr-24"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                  <button
                    onClick={() => setShowVoiceModal(true)}
                    className="p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95"
                    style={{ 
                      color: 'var(--brand-primary)',
                      background: 'rgba(47, 60, 126, 0.08)',
                      border: '1px solid rgba(47, 60, 126, 0.15)'
                    }}
                    title="Voice input - Say product names with quantities"
                  >
                    <Mic className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setShowCameraScanner(true)}
                    className="p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95"
                    style={{ 
                      color: 'var(--brand-primary)',
                      background: 'rgba(47, 60, 126, 0.08)',
                      border: '1px solid rgba(47, 60, 126, 0.15)'
                    }}
                    title="Camera Scanner"
                  >
                    <QrCode className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              {isListening && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                    <p className="text-sm text-blue-800 font-semibold">
                      Listening...
                    </p>
                  </div>
                  {voiceTranscript && (
                    <div className="mt-2 p-2 bg-white rounded border border-blue-200">
                      <p className="text-sm text-gray-700">
                        <span className="text-gray-500 italic">You said:</span> {voiceTranscript}
                      </p>
                    </div>
                  )}
                  {!voiceTranscript && (
                    <p className="text-xs text-blue-600 mt-1">
                      Say product names in a sentence (e.g., "Rice Sugar Oil")
                    </p>
                  )}
                </div>
              )}
              
              <div className="relative hidden">
                <input
                  type="text"
                  placeholder="Scan barcode..."
                  value={barcodeInput}
                  ref={barcodeInputRef}
                  onChange={(e) => {
                    const value = e.target.value;
                    setBarcodeInput(value);
                    const trimmed = value.trim();
                    if (trimmed) {
                      scheduleBarcodeScan(trimmed);
                    } else if (barcodeScanTimeoutRef.current) {
                      clearTimeout(barcodeScanTimeoutRef.current);
                    }
                  }}
                  onPaste={(e) => {
                    const pasted = (e.clipboardData?.getData('text') || '').trim();
                    if (pasted) {
                      setBarcodeInput(pasted);
                      scheduleBarcodeScan(pasted);
                    }
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      const barcode = barcodeInput.trim();
                      if (barcode) {
                        handleBarcodeScan(barcode);
                      }
                    }
                  }}
                  className="input-field pr-12"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
              {filteredProducts.map(product => (
                <div
                  key={product.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors border"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate" style={{ color: 'var(--text-primary)' }} title={product.name}>
                      {product.name}
                    </h4>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      ₹{(product.sellingPrice || product.costPrice || 0).toFixed(2)}/{product.quantityUnit || product.unit || 'pcs'} • Stock: {product.quantity || product.stock || 0}
                    </p>
                  </div>
                  <button
                    onClick={() => handleAddProduct(product)}
                    className="btn-primary p-2 ml-2 flex-shrink-0 rounded-lg"
                    style={{ minWidth: '36px', minHeight: '36px' }}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Cart Items - Simple & Clean */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Cart ({billItems.length})
              </h3>
            </div>

            {billItems.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingCart className="h-12 w-12 mx-auto mb-3" style={{ color: 'var(--text-secondary)', opacity: 0.3 }} />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No items yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {billItems.map(item => {
                  // Find the product from state to pass to QuantityModal
                  const product = state.products.find(p => p.id === item.id) || item;
                  
                  // Create a wrapper function that uses replace instead of merge
                  const handleEditQuantity = (prod, qty, unit) => {
                    return handleReplaceQuantity(prod, qty, unit);
                  };
                  
                  return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setSelectedProduct({ 
                        ...product, 
                        _isEdit: true, 
                        _editHandler: handleEditQuantity,
                        _currentQuantity: item.quantity,
                        _currentUnit: item.unit || item.quantityUnit || 'pcs'
                      });
                      setShowQuantityModal(true);
                    }}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md"
                    style={{ 
                      borderColor: 'var(--border-subtle)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--brand-primary)';
                      e.currentTarget.style.backgroundColor = 'rgba(47, 60, 126, 0.02)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-subtle)';
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    {/* Product Info - Full width on mobile, flex-1 on desktop */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium break-words sm:truncate" style={{ color: 'var(--text-primary)' }}>
                          {item.name}
                        </h4>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                          {formatQuantityWithUnit(item.quantity, item.unit || item.quantityUnit || 'pcs')}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5 break-words" style={{ color: 'var(--text-secondary)' }}>
                        ₹{item.price.toFixed(2)}/{item.unit || item.quantityUnit || 'pcs'}
                      </p>
                    </div>
                    
                    {/* Controls and Price - Stack on mobile, row on desktop */}
                    <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 flex-shrink-0">
                      {/* Quantity Controls */}
                      <div 
                        className="flex items-center gap-1.5 sm:gap-2 border rounded-lg px-1.5 sm:px-2 py-1 flex-shrink-0" 
                        style={{ borderColor: 'var(--border-subtle)' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-8 h-8 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center font-semibold transition-all duration-200 active:scale-95 touch-manipulation"
                          style={{ 
                            color: 'var(--text-primary)',
                            background: 'rgba(47, 60, 126, 0.05)',
                            border: '1px solid rgba(47, 60, 126, 0.1)'
                          }}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span className="min-w-[60px] sm:min-w-[50px] text-center text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {formatQuantityWithUnit(item.quantity, item.unit || item.quantityUnit || 'pcs')}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-8 h-8 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center font-semibold transition-all duration-200 active:scale-95 touch-manipulation"
                          style={{ 
                            color: 'var(--text-primary)',
                            background: 'rgba(47, 60, 126, 0.05)',
                            border: '1px solid rgba(47, 60, 126, 0.1)'
                          }}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      
                      {/* Price - Full width on mobile, fixed width on desktop */}
                      <span className="font-bold text-base sm:text-base sm:w-20 sm:text-right flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
                        ₹{getItemTotalAmount(item).toFixed(2)}
                      </span>
                      
                      {/* Delete Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromBill(item.id);
                        }}
                        className="p-2 sm:p-1.5 rounded-lg transition-all duration-200 active:scale-95 touch-manipulation flex-shrink-0"
                        style={{ 
                          color: '#BE123C',
                          background: 'rgba(190, 18, 60, 0.08)',
                          border: '1px solid rgba(190, 18, 60, 0.15)'
                        }}
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Summary - Simple & Premium */}
        <div className="lg:col-span-1">
          <div className="card sticky top-4">
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Summary
            </h3>

            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-secondary)' }}>Subtotal</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatNumber(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-secondary)' }}>Discount</span>
                <span className="font-medium" style={{ color: '#BE123C' }}>-₹{discountAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-secondary)' }}>Tax</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatNumber(taxAmount)}</span>
              </div>
              <div className="h-px my-3" style={{ background: 'var(--border-subtle)' }}></div>
              <div className="flex justify-between text-lg font-bold">
                <span style={{ color: 'var(--text-primary)' }}>Total</span>
                <span style={{ color: 'var(--brand-primary)' }}>{formatNumber(total)}</span>
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Discount (%)
                </label>
                <input
                  type="number"
                  value={discount || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDiscount(value === '' ? 0 : parseFloat(value) || 0);
                  }}
                  className="input-field text-sm"
                  min="0"
                  max="100"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Tax (%)
                </label>
                <input
                  type="number"
                  value={tax || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setTax(value === '' ? 0 : parseFloat(value) || 0);
                  }}
                  className="input-field text-sm"
                  min="0"
                  max="100"
                  placeholder="0"
                />
              </div>

              <button
                onClick={handleGenerateBillClick}
                className="w-full btn-primary mt-4 flex items-center justify-center"
                disabled={isGeneratingBill.current || billItems.length === 0}
              >
                <Receipt className="h-4 w-4 mr-2" />
                Generate Bill
              </button>
            </div>
          </div>
        </div>

        {showQuantityModal && selectedProduct && (
          <QuantityModal
            product={selectedProduct}
            onClose={() => {
              setShowQuantityModal(false);
              setSelectedProduct(null);
            }}
            onAdd={selectedProduct._editHandler || handleAddWithQuantity}
          />
        )}

        {showCameraScanner && (
          <BarcodeScanner
            onScan={(barcode) => {
              setBarcodeInput(barcode);
              handleBarcodeScan(barcode);
              setShowCameraScanner(false);
            }}
            onClose={() => setShowCameraScanner(false)}
          />
        )}

        {/* QR Code Modal */}
        {showQRCode && qrCodeData && (
          <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <QrCode className="h-5 w-5 mr-2 text-primary-600" />
                  Bill QR Code
                </h3>
                <button
                  onClick={() => setShowQRCode(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ×
                </button>
              </div>
              
              <div className="text-center">
                <div className="bg-gray-100 p-4 rounded-lg mb-4">
                  <div className="text-sm text-gray-600 mb-2">Bill ID: {qrCodeData.billId}</div>
                  <div className="text-sm text-gray-600 mb-2">Customer: {qrCodeData.customerName}</div>
                  <div className="text-sm text-gray-600 mb-2">Total: ₹{qrCodeData.total.toFixed(2)}</div>
                  <div className="text-sm text-gray-600 mb-2">Date: {new Date(qrCodeData.date).toLocaleDateString()}</div>
                </div>
                
                {/* Simple QR Code representation */}
                <div className="bg-white border-2 border-gray-300 p-4 rounded-lg mb-4 inline-block">
                  <div className="grid grid-cols-8 gap-1">
                    {Array.from({ length: 64 }, (_, i) => (
                      <div
                        key={i}
                        className={`w-3 h-3 ${Math.random() > 0.5 ? 'bg-black' : 'bg-white'}`}
                      />
                    ))}
                  </div>
                </div>
                
                <div className="text-xs text-gray-500 mb-4">
                  Scan this QR code to view bill details
                </div>
                
                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      generateAndDownloadPDF(qrCodeData);
                      setShowQRCode(false);
                    }}
                    className="flex-1 btn-secondary flex items-center justify-center"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download PDF
                  </button>
                  <button
                    onClick={() => setShowQRCode(false)}
                    className="flex-1 btn-primary"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* UPI Payment Modal - Show for UPI payment method or split payment with online component */}
        {showUPIPayment && currentBill && 
          (currentBill.paymentMethod === 'upi' || 
           (currentBill.paymentMethod === 'split' && currentBill.splitPaymentDetails && currentBill.splitPaymentDetails.onlineAmount > 0)) && (
            <UPIPaymentModal
              bill={currentBill}
              onClose={handleCancelUPIPayment}
              onPaymentReceived={handlePaymentReceived}
              onSaveUPIId={async (upiId) => {
                // Save UPI ID to state
                dispatch({ type: ActionTypes.SET_UPI_ID, payload: upiId });
                // Update current bill with new UPI ID
                setCurrentBill({ ...currentBill, upiId });
                // Update pending order if exists
                if (pendingOrder) {
                  setPendingOrder({
                    ...pendingOrder,
                    bill: { ...pendingOrder.bill, upiId }
                  });
                }
                showToast('UPI ID saved successfully!', 'success');
              }}
            />
          )
        }

        {showPaymentAndCustomerModal && (
          <PaymentAndCustomerModal
            billItems={billItems}
            total={total}
            sellerUpiId={sellerUpiId}
            customers={allCustomers}
            useCustomName={useCustomName}
            customCustomerName={customCustomerName}
            selectedCustomer={selectedCustomer}
            billingMobile={billingMobile}
            paymentMethod={paymentMethod}
            sendWhatsAppInvoice={sendWhatsAppInvoice}
            onClose={() => setShowPaymentAndCustomerModal(false)}
            onSubmit={handlePaymentAndCustomerSubmit}
            onCustomNameChange={setUseCustomName}
            onSelectedCustomerChange={setSelectedCustomer}
            onBillingMobileChange={setBillingMobile}
            onPaymentMethodChange={setPaymentMethod}
            onSendWhatsAppInvoiceChange={setSendWhatsAppInvoice}
          />
        )}

        {/* Customer Found Modal */}
        {showCustomerModal && foundCustomers.length > 0 && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000
            }}
            onClick={continueAsNewCustomer}
          >
            <div
              style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '24px',
                maxWidth: '500px',
                width: '90%',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{
                fontSize: '20px',
                fontWeight: '600',
                marginBottom: '16px',
                color: '#111827'
              }}>
                {foundCustomers.length === 1 ? 'Customer Found' : 'Multiple Customers Found'}
              </h3>
              
              <p style={{
                fontSize: '14px',
                color: '#6b7280',
                marginBottom: '20px'
              }}>
                {foundCustomers.length === 1 
                  ? 'Found 1 customer with this mobile number'
                  : `Found ${foundCustomers.length} customers with this mobile number`}
              </p>

              <div style={{ marginBottom: '24px', maxHeight: '400px', overflowY: 'auto' }}>
                {foundCustomers.map((customer, index) => {
                  const mobile = sanitizeMobileNumber(customer.mobileNumber || customer.phone || customer.phoneNumber || '');
                  const dueAmount = customer.dueAmount || customer.balanceDue || 0;
                  return (
                    <button
                      key={customer.id || customer._id || index}
                      type="button"
                      onClick={() => selectExistingCustomer(customer)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '16px',
                        marginBottom: '12px',
                        backgroundColor: '#f9fafb',
                        border: '2px solid #e5e7eb',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.backgroundColor = '#f3f4f6';
                        e.target.style.borderColor = '#3b82f6';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.backgroundColor = '#f9fafb';
                        e.target.style.borderColor = '#e5e7eb';
                      }}
                    >
                      <div style={{
                        fontWeight: '600',
                        fontSize: '16px',
                        color: '#111827',
                        marginBottom: '8px'
                      }}>
                        {customer.name}
                      </div>
                      <div style={{
                        fontSize: '14px',
                        color: '#6b7280',
                        marginBottom: '4px'
                      }}>
                        📱 Mobile: {mobile}
                      </div>
                      <div style={{
                        fontSize: '14px',
                        color: dueAmount > 0 ? '#ea580c' : '#6b7280',
                        fontWeight: '500'
                      }}>
                        Due Amount: ₹{dueAmount.toFixed(2)}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'center'
              }}>
                <button
                  type="button"
                  onClick={continueAsNewCustomer}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#f3f4f6',
                    color: '#374151',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '14px',
                    transition: 'background-color 0.2s',
                    flex: 1
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#e5e7eb'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = '#f3f4f6'}
                >
                  New Customer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Voice Instructions Modal */}
      {showVoiceInstructions && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col mx-4">
            <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
              <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Mic className="h-6 w-6" style={{ color: 'var(--brand-primary)' }} />
                How to Use Voice Input
              </h2>
            </div>
            
            <div className="overflow-y-auto px-6 flex-1">
              <div className="space-y-4 mb-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-800 mb-3">📢 Speaking Instructions:</h3>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span><strong>Single product:</strong> Say "Sugar 500g" or "Rice 1 kg"</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span><strong>Multiple products:</strong> Say "Kaju 500g Badam 50g Sugar 1kg"</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span><strong>Quantity updates:</strong> Say "Sugar 1 kg" again to merge with existing quantity</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span><strong>Units supported:</strong> kg, g, ml, l, pcs, piece, pieces, peace, packet, box, bottle</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span><strong>For pieces:</strong> Say "Product 5 piece" or "Product 3 pcs"</span>
                  </li>
                </ul>
              </div>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-800 mb-2">💡 Tips:</h3>
                <ul className="space-y-1 text-sm text-gray-700">
                  <li>• Speak clearly and at a normal pace</li>
                  <li>• The system will automatically merge quantities for the same product</li>
                  <li>• Click the mic button again to stop listening</li>
                </ul>
              </div>
              </div>
            </div>

            <div className="flex items-center gap-2 p-6 pt-4 border-t border-gray-200 flex-shrink-0">
              <input
                type="checkbox"
                id="dontShowAgain"
                checked={dontShowAgainChecked}
                onChange={(e) => setDontShowAgainChecked(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <label htmlFor="dontShowAgain" className="text-sm text-gray-700 cursor-pointer">
                Don't show this again
              </label>
            </div>

            <div className="flex justify-end gap-3 p-6 pt-0 flex-shrink-0">
              <button
                onClick={() => handleVoiceInstructionsOK(dontShowAgainChecked)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen Voice Input Modal */}
      {showVoiceModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="w-full h-full flex flex-col items-center justify-center p-3 sm:p-6">
            {/* Close button */}
            <button
              onClick={() => {
                stopVoiceRecognition();
                setShowVoiceModal(false);
                accumulatedTranscriptRef.current = '';
                setVoiceModalTranscript('');
              }}
              className="absolute top-3 right-3 sm:top-4 sm:right-4 p-2.5 sm:p-3 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/25 transition-colors touch-manipulation"
              style={{ color: 'white' }}
              aria-label="Close voice input modal"
            >
              <X className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>

            {/* Mic Icon - Large and centered */}
            <div className="flex flex-col items-center justify-center flex-1 max-w-2xl w-full px-2">
              <div 
                className={`relative mb-4 sm:mb-8 ${isListening ? 'animate-pulse' : ''}`}
              >
                <div 
                  className="w-24 h-24 sm:w-32 sm:h-32 rounded-full flex items-center justify-center shadow-2xl"
                  style={{
                    background: isListening 
                      ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.1))'
                      : 'linear-gradient(135deg, rgba(47, 60, 126, 0.2), rgba(47, 60, 126, 0.1))',
                    border: `3px solid ${isListening ? 'rgba(239, 68, 68, 0.5)' : 'rgba(47, 60, 126, 0.5)'}`
                  }}
                >
                  {isListening ? (
                    <MicOff className="h-12 w-12 sm:h-16 sm:w-16" style={{ color: '#ef4444' }} />
                  ) : (
                    <Mic className="h-12 w-12 sm:h-16 sm:w-16" style={{ color: 'var(--brand-primary)' }} />
                  )}
                </div>
                
                {/* Pulsing rings when listening */}
                {isListening && (
                  <>
                    <div 
                      className="absolute inset-0 rounded-full animate-ping"
                      style={{
                        background: 'rgba(239, 68, 68, 0.3)',
                        animation: 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite'
                      }}
                    />
                    <div 
                      className="absolute inset-0 rounded-full animate-ping"
                      style={{
                        background: 'rgba(239, 68, 68, 0.2)',
                        animation: 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
                        animationDelay: '0.5s'
                      }}
                    />
                  </>
                )}
              </div>

              {/* Status text */}
              <p className="text-white text-lg sm:text-xl font-semibold mb-2 px-2">
                {isListening ? 'Listening...' : 'Starting...'}
              </p>
              <p className="text-white/70 text-xs sm:text-sm mb-6 sm:mb-8 px-2">
                Say product names with quantities (e.g., "sugar 5 kg rice 2 kg")
              </p>

              {/* Transcript display */}
              <div className="w-full max-w-2xl bg-white/10 backdrop-blur-md rounded-2xl p-3 sm:p-6 mb-6 sm:mb-8 min-h-[200px] max-h-[300px] sm:max-h-[400px] overflow-y-auto">
                {voiceModalTranscript ? (
                  <div className="space-y-2 sm:space-y-3">
                    {formatTranscriptAsList(voiceModalTranscript)
                      .filter(item => !removedItems.has(item.id))
                      .map((item, index) => (
                      <div 
                        key={item.id} 
                        className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-white text-base sm:text-lg py-3 sm:py-2 px-3 sm:px-4 rounded-xl sm:rounded-lg bg-white/5 hover:bg-white/10 transition-colors ${!item.matched ? 'opacity-60' : ''}`}
                      >
                        {/* Number and Product Name Row */}
                        <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                          <span className="text-white/60 font-mono text-xs sm:text-sm w-5 sm:w-6 flex-shrink-0">{index + 1}.</span>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium capitalize block break-words">
                              {item.product}
                            </span>
                            {item.spokenName && item.spokenName.toLowerCase() !== item.product.toLowerCase() && (
                              <span className="text-white/50 text-xs sm:text-sm font-normal block mt-0.5">
                                (said: {item.spokenName})
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {/* Quantity/Amount and Remove Button Row */}
                        <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 flex-shrink-0">
                          <span className="text-white/90 sm:text-white/80 font-semibold text-sm sm:text-base whitespace-nowrap">
                            {item.isAmountBased && item.amount ? (
                              <>
                                <span className="text-white font-bold">₹{item.amount}</span>
                                {item.quantity > 0 && item.matched && (
                                  <span className="text-white/60 text-xs sm:text-sm ml-1 sm:ml-2">({item.quantity.toFixed(2)} {item.unit})</span>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="font-bold">{item.quantity}</span>
                                <span className="text-white/70 ml-1">{item.unit}</span>
                              </>
                            )}
                            {!item.matched && <span className="text-yellow-400 text-xs sm:text-sm ml-1 sm:ml-2 block sm:inline">⚠ Not found</span>}
                          </span>
                          <button
                            onClick={() => {
                              setRemovedItems(prev => new Set([...prev, item.id]));
                            }}
                            className="p-2 sm:p-1.5 rounded-lg hover:bg-red-500/20 active:bg-red-500/30 transition-colors flex-shrink-0 touch-manipulation"
                            title="Remove this item"
                            aria-label="Remove this item"
                          >
                            <X className="h-5 w-5 sm:h-4 sm:w-4 text-red-400 hover:text-red-300" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {formatTranscriptAsList(voiceModalTranscript).length === 0 && (
                      <p className="text-white text-sm sm:text-lg leading-relaxed whitespace-pre-wrap px-2">
                        {voiceModalTranscript}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-white/50 text-center italic text-sm sm:text-base px-2">
                    Your voice input will appear here...
                  </p>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 sm:gap-4 w-full max-w-md px-2 sm:px-0">
                <button
                  onClick={() => {
                    stopVoiceRecognition();
                    setShowVoiceModal(false);
                    accumulatedTranscriptRef.current = '';
                    setVoiceModalTranscript('');
                  }}
                  className="flex-1 px-4 sm:px-6 py-3 sm:py-4 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/25 text-white font-semibold text-sm sm:text-base transition-colors border border-white/20 touch-manipulation"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // Get the formatted list and filter out removed items
                    const transcript = accumulatedTranscriptRef.current.trim() || voiceModalTranscript.trim();
                    if (!transcript) {
                      showToast('No products detected. Please speak product names.', 'warning');
                      return;
                    }
                    
                    const allItems = formatTranscriptAsList(transcript);
                    const itemsToAdd = allItems.filter(item => !removedItems.has(item.id) && item.matched);
                    
                    if (itemsToAdd.length === 0) {
                      showToast('No valid products to add. Please check your input.', 'warning');
                      return;
                    }
                    
                    // Process each non-removed item
                    itemsToAdd.forEach(item => {
                      // Find the product by name
                      const product = findMatchingProduct(item.product);
                      if (product && item.matched && item.quantity > 0) {
                        // Use the quantity and unit from the formatted item (already calculated for amount-based items)
                        const quantityToAdd = item.quantity;
                        const unitToAdd = item.unit;
                        
                        // For amount-based items, pass the exact amount to ensure billing shows exactly that amount
                        const fixedAmount = item.isAmountBased && item.amount ? item.amount : null;
                        
                        // Check if product already exists in cart
                        const existingItemIndex = billItems.findIndex(billItem => billItem.id === product.id);
                        
                        if (existingItemIndex >= 0) {
                          // Product exists - replace quantity
                          handleReplaceQuantity(product, quantityToAdd, unitToAdd, fixedAmount);
                        } else {
                          // Product doesn't exist - add new product
                          handleAddWithQuantity(product, quantityToAdd, unitToAdd, fixedAmount);
                        }
                      }
                    });
                    
                    // Show single summary toast
                    showToast(`${itemsToAdd.length} product(s) added to cart!`, 'success');
                    
                    // Close modal
                    stopVoiceRecognition();
                    setShowVoiceModal(false);
                    accumulatedTranscriptRef.current = '';
                    setVoiceModalTranscript('');
                    setRemovedItems(new Set());
                  }}
                  className="flex-1 px-4 sm:px-6 py-3 sm:py-4 rounded-xl font-semibold text-white text-sm sm:text-base transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2 touch-manipulation"
                  style={{
                    background: 'linear-gradient(135deg, var(--brand-primary), #18224f)',
                    boxShadow: '0 4px 14px 0 rgba(47, 60, 126, 0.4)'
                  }}
                >
                  <Check className="h-4 w-4 sm:h-5 sm:w-5" />
                  <span className="hidden sm:inline">Confirm & Add</span>
                  <span className="sm:hidden">Confirm</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Billing;

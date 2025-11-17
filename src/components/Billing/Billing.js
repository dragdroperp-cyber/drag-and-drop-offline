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
  MicOff
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

  const handleAddWithQuantity = (product, quantity, unit) => {
    const validation = validateQuantityForUnit(quantity, unit);
    if (!validation.valid) {
      showToast(validation.message, 'warning');
      return false;
    }

    const sanitizedQuantity = validation.quantity;

    // Check if product already exists in bill with same unit
    const existingItemIndex = billItems.findIndex(item => item.id === product.id && item.unit === unit);
    
    // Calculate total quantity that will be in bill after adding
    let totalQuantityInBill = sanitizedQuantity;
    if (existingItemIndex >= 0) {
      const existingItem = billItems[existingItemIndex];
      totalQuantityInBill = existingItem.quantity + sanitizedQuantity;
    }

    // Check stock availability against TOTAL quantity (existing + new)
    const stockCheck = checkStockAvailability(product, totalQuantityInBill, unit);

    if (!stockCheck.available) {
      if (stockCheck.error) {
        showToast(stockCheck.error, 'error');
        return false;
      }

      // Calculate how much more can be added (accounting for unit conversions)
      const productQuantity = product.quantity || product.stock || 0;
      const productUnit = product.unit || product.quantityUnit || 'pcs';
      const alreadyInBill = existingItemIndex >= 0 ? billItems[existingItemIndex].quantity : 0;
      
      // Convert both to base units for accurate calculation
      const productQuantityInBaseUnit = convertToBaseUnit(productQuantity, productUnit);
      const alreadyInBillInBaseUnit = convertToBaseUnit(alreadyInBill, unit);
      const availableToAddInBaseUnit = Math.max(0, productQuantityInBaseUnit - alreadyInBillInBaseUnit);
      const availableToAdd = convertFromBaseUnit(availableToAddInBaseUnit, unit);
      
      const message = state.currentLanguage === 'hi'
        ? `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}. Already in bill: ${formatQuantityWithUnit(alreadyInBill, unit)}. You can add maximum: ${formatQuantityWithUnit(availableToAdd, unit)}.`
        : `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}. Already in bill: ${formatQuantityWithUnit(alreadyInBill, unit)}. You can add maximum: ${formatQuantityWithUnit(availableToAdd, unit)}.`;
      showToast(message, 'warning');
      return false;
    }

    if (existingItemIndex >= 0) {
      const existingItem = billItems[existingItemIndex];
      const newQuantity = existingItem.quantity + sanitizedQuantity;
      const updatedItem = buildBillItem(product, newQuantity, unit, stockCheck.baseUnit);
      setBillItems(prev => prev.map((item, idx) => idx === existingItemIndex ? updatedItem : item));
    } else {
      const newItem = buildBillItem(product, sanitizedQuantity, unit, stockCheck.baseUnit);
      setBillItems(prev => [...prev, newItem]);
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
  const processVoiceInput = (text) => {
    if (!text || text.trim() === '') return;
    
    // First, try splitting by common separators
    let items = text
      .toLowerCase()
      .split(/[,;]| and | then | also | plus /i)
      .map(item => item.trim())
      .filter(item => item.length > 0);
    
    // If no separators found, try to extract product names from the sentence
    if (items.length === 1) {
      const sentence = items[0];
      // Try to find product names by matching against available products
      const foundProducts = [];
      const usedIndices = new Set();
      
      // Try 2-word combinations first, then single words
      const words = sentence.split(/\s+/);
      
      // Try 2-word combinations
      for (let i = 0; i < words.length - 1; i++) {
        if (usedIndices.has(i) || usedIndices.has(i + 1)) continue;
        const twoWord = `${words[i]} ${words[i + 1]}`;
        const product = findMatchingProduct(twoWord);
        if (product) {
          foundProducts.push(product);
          usedIndices.add(i);
          usedIndices.add(i + 1);
        }
      }
      
      // Try single words for remaining
      for (let i = 0; i < words.length; i++) {
        if (usedIndices.has(i)) continue;
        const word = words[i];
        // Skip common words
        if (['the', 'a', 'an', 'is', 'are', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with'].includes(word)) {
          continue;
        }
        const product = findMatchingProduct(word);
        if (product) {
          foundProducts.push(product);
          usedIndices.add(i);
        }
      }
      
      // Process found products
      foundProducts.forEach(product => {
        const productKey = product.name.toLowerCase();
        if (!processedProductsRef.current.has(productKey)) {
          processedProductsRef.current.add(productKey);
          const unit = product.unit || product.quantityUnit || 'pcs';
          handleAddWithQuantity(product, 1, unit);
          showToast(`Added: ${product.name}`, 'success', 2000);
        }
      });
      
      return;
    }
    
    // Process items from split sentence
    items.forEach(item => {
      // Extract product name (remove numbers and units)
      const productName = item
        .replace(/\d+(\.\d+)?\s*(kg|g|ml|l|packet|pcs|piece|pieces|unit|units|box|boxes|bottle|bottles|pack|packs)/gi, '')
        .trim();
      
      if (!productName) return;
      
      // Check if we already processed this product in this session
      const productKey = productName.toLowerCase();
      if (processedProductsRef.current.has(productKey)) {
        return; // Skip duplicates
      }
      
      const product = findMatchingProduct(productName);
      
      if (product) {
        processedProductsRef.current.add(productKey);
        // Add product with default quantity 1
        const unit = product.unit || product.quantityUnit || 'pcs';
        handleAddWithQuantity(product, 1, unit);
        showToast(`Added: ${product.name}`, 'success', 2000);
      }
    });
  };

  // Start voice recognition
  const startVoiceRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('Speech recognition not supported in your browser', 'error');
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore
      }
    }

    shouldKeepListeningRef.current = true;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceTranscript('');
      processedProductsRef.current.clear();
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }

      // Update live transcript display
      const fullTranscript = finalTranscript || interimTranscript;
      setVoiceTranscript(fullTranscript.trim());

      // Process final transcripts only
      if (finalTranscript) {
        processVoiceInput(finalTranscript);
        // Clear transcript after processing
        setTimeout(() => {
          setVoiceTranscript('');
        }, 1000);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') {
        // Auto-restart if no speech detected
        setTimeout(() => {
          if (shouldKeepListeningRef.current) {
            try {
              recognition.start();
            } catch (e) {
              // Ignore
            }
          }
        }, 500);
      } else {
        setIsListening(false);
        shouldKeepListeningRef.current = false;
        showToast('Speech recognition error. Please try again.', 'error');
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      // Auto-restart if still supposed to be listening
      if (shouldKeepListeningRef.current) {
        setTimeout(() => {
          if (shouldKeepListeningRef.current && recognitionRef.current === recognition) {
            try {
              recognition.start();
            } catch (e) {
              // Ignore
            }
          }
        }, 100);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (e) {
      showToast('Failed to start listening. Please try again.', 'error');
    }
  };

  // Stop voice recognition
  const stopVoiceRecognition = () => {
    shouldKeepListeningRef.current = false;
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

  const buildBillItem = (product, quantity, unit, baseUnitHint) => {
    const productUnit = product.quantityUnit || product.unit || 'pcs';
    const baseUnit = baseUnitHint || getBaseUnit(productUnit);
    const quantityInBaseUnit = convertToBaseUnit(quantity, unit);
    const productUnitInBaseUnitRaw = convertToBaseUnit(1, productUnit);
    const productUnitInBaseUnit = productUnitInBaseUnitRaw === 0 ? 1 : productUnitInBaseUnitRaw;
    const quantityInProductUnits = quantityInBaseUnit / productUnitInBaseUnit;

    const sellingPricePerProductUnit = Number(product.sellingPrice || product.costPrice || 0);
    const costPricePerProductUnit = Number(product.costPrice || product.unitPrice || 0);
    // Truncate to 2 decimal places (no rounding)
    const totalSellingPrice = Math.floor((sellingPricePerProductUnit * quantityInProductUnits) * 100) / 100;
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
                    onClick={isListening ? stopVoiceRecognition : startVoiceRecognition}
                    className={`p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95 ${
                      isListening ? 'animate-pulse' : ''
                    }`}
                    style={{ 
                      color: isListening ? '#ef4444' : 'var(--brand-primary)',
                      background: isListening ? 'rgba(239, 68, 68, 0.1)' : 'rgba(47, 60, 126, 0.08)',
                      border: `1px solid ${isListening ? 'rgba(239, 68, 68, 0.3)' : 'rgba(47, 60, 126, 0.15)'}`
                    }}
                    title={isListening ? 'Stop listening' : 'Voice input - Say product names'}
                  >
                    {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
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
                {billItems.map(item => (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg border"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    {/* Product Info - Full width on mobile, flex-1 on desktop */}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium break-words sm:truncate" style={{ color: 'var(--text-primary)' }}>
                        {item.name}
                      </h4>
                      <p className="text-xs mt-0.5 break-words" style={{ color: 'var(--text-secondary)' }}>
                        ₹{item.price.toFixed(2)}/{item.unit || item.quantityUnit || 'pcs'}
                      </p>
                    </div>
                    
                    {/* Controls and Price - Stack on mobile, row on desktop */}
                    <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 flex-shrink-0">
                      {/* Quantity Controls */}
                      <div className="flex items-center gap-1.5 sm:gap-2 border rounded-lg px-1.5 sm:px-2 py-1 flex-shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
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
                        <span className="w-10 sm:w-8 text-center text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {item.quantity}
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
                        onClick={() => removeFromBill(item.id)}
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
                ))}
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
            onAdd={handleAddWithQuantity}
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
    </div>
  );
};

export default Billing;
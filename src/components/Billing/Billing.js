import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp, ActionTypes, isPlanExpired, triggerSyncStatusUpdate } from '../../context/AppContext';
import QRCode from 'qrcode';
import {
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
  ScanLine,
  Check,
  Wallet,
  Phone,
  Edit,
  Printer,
  Smartphone,
  AlertCircle,
  RefreshCw,
  Usb,
  Plus,
  Minus,
  Zap,
  Maximize2,
  LayoutGrid,
  Square
} from 'lucide-react';
import jsPDF from 'jspdf';
import { nanoid } from 'nanoid';
import { calculatePriceWithUnitConversion, checkStockAvailability, convertToBaseUnit, convertFromBaseUnit, getBaseUnit, isCountBasedUnit, isDecimalAllowedUnit, formatQuantityWithUnit, getTotalStockQuantity } from '../../utils/unitConversion';
import { normalizeProductBatch } from '../../utils/dataFetcher';
import QuantityModal from './QuantityModal';
import UPIPaymentModal from './UPIPaymentModal';
import SplitPaymentModal from './SplitPaymentModal';
import PaymentAndCustomerModal from './PaymentAndCustomerModal';
import SaleModeConfirmModal from './SaleModeConfirmModal';
import { getTranslation } from '../../utils/translations';
import { getSellerIdFromAuth } from '../../utils/api';
import { getPlanLimits, canAddOrder, canAddCustomer, PLAN_FEATURES, getDistributedPlanLimits, isUnlimited } from '../../utils/planUtils';
import { sanitizeMobileNumber, isValidMobileNumber } from '../../utils/validation';
import BarcodeScanner from '../BarcodeScanner/BarcodeScanner';
import syncService from '../../services/syncService';
import { addWatermarkToPDF } from '../../utils/pdfUtils';
import { formatNumberOnly } from '../../utils/numberFormat';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import { generateBillPaymentQR } from '../../utils/upiQRGenerator';
import { sortBatches, getEffectivePrice, getEffectiveWholesaleMOQ, calculateBatchPricing } from '../../utils/productUtils';
import { addItem, getAllItems, STORES } from '../../utils/indexedDB';
import { playWebAudioBeep, getAudioContext, playRegisterFallbackSound } from '../../utils/audioUtils';

// Smart unit selection based on quantity magnitude
// Smart unit selection - DISABLED based on user feedback to keep original unit
const getSmartDisplayUnit = (quantity, currentUnit) => {
  return currentUnit;
};

// Convert quantity to smart display unit
const convertToSmartUnit = (quantity, currentUnit) => {
  const smartUnit = getSmartDisplayUnit(quantity, currentUnit);
  if (smartUnit === currentUnit) {
    return { quantity, unit: currentUnit };
  }

  // Convert to smart unit
  const quantityInSmartUnit = convertFromBaseUnit(convertToBaseUnit(quantity, currentUnit), smartUnit);
  return { quantity: quantityInSmartUnit, unit: smartUnit };
};

// Helper function to get store functions (same as in AppContext)
const getStoreFunctions = (storeName) => {
  const { getAllItems, updateItem, deleteItem, addItem } = require('../../utils/indexedDB');
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
    },
    productBatches: {
      getAllItems: () => getAllItems(STORES.productBatches),
      updateItem: (item) => updateItem(STORES.productBatches, item),
      deleteItem: (id) => deleteItem(STORES.productBatches, id)
    }
  };

  return storeMap[storeName] || null;
};

const Billing = () => {
  const { state, dispatch } = useApp();
  const [selectedCustomer, setSelectedCustomer] = useState('');

  // Load additional data if not already loaded (for slow connections)
  useEffect(() => {
    if (state.dataFreshness === 'partial' && window.loadAdditionalData) {
      window.loadAdditionalData();
    }
  }, [state.dataFreshness]);
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
  /* Scanner defaults to disabled on Billing page per user request */
  const [showInlineScanner, setShowInlineScanner] = useState(false);
  const [saleMode, setSaleMode] = useState(() => localStorage.getItem('billingSaleMode') || 'retail'); // 'retail' or 'wholesale'
  const [showModeChangeConfirm, setShowModeChangeConfirm] = useState(false);

  const [pendingSaleMode, setPendingSaleMode] = useState(null);
  const [productsGridHeight, setProductsGridHeight] = useState('max-h-[500px]');
  const [productsViewMode, setProductsViewMode] = useState(() => localStorage.getItem('productsViewMode') || 'list'); // 'list', 'grid', 'large-grid'

  const [dProductInput, setDProductInput] = useState('');

  const [printSize, setPrintSize] = useState(() => localStorage.getItem('printSize') || 'a4'); // Default print size
  const [isDirectPrint, setIsDirectPrint] = useState(() => {
    const saved = localStorage.getItem('isDirectPrint');
    return saved !== null ? JSON.parse(saved) : true;
  }); // Toggle between direct print and download
  const [availablePrinters, setAvailablePrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState(() => {
    const saved = localStorage.getItem('selectedPrinter');
    return saved ? JSON.parse(saved) : null;
  });
  const printSizeRef = useRef(localStorage.getItem('printSize') || 'a4'); // Ref to track current printSize
  const isDirectPrintRef = useRef(localStorage.getItem('isDirectPrint') !== null ? JSON.parse(localStorage.getItem('isDirectPrint')) : true); // Ref to track current isDirectPrint

  // Persist saleMode to localStorage
  const [sellerSettings, setSellerSettings] = useState(null);

  // Load custom seller settings
  useEffect(() => {
    const loadCustomSettings = async () => {
      try {
        const settingsList = await getAllItems(STORES.settings);
        if (settingsList && settingsList.length > 0) {
          const s = settingsList[0];
          setSellerSettings(s);
          // Sync print format preference
          if (s.billSettings?.billFormat) {
            setPrintSize(s.billSettings.billFormat);
          }
        }
      } catch (err) {
        console.error("Failed to load seller settings in Billing", err);
      }
    };
    loadCustomSettings();
  }, []);

  useEffect(() => {
    localStorage.setItem('billingSaleMode', saleMode);
  }, [saleMode]);

  useEffect(() => {
    localStorage.setItem('productsGridHeight', productsGridHeight);
  }, [productsGridHeight]);

  useEffect(() => {
    localStorage.setItem('productsViewMode', productsViewMode);
  }, [productsViewMode]);

  // Persist printSize to localStorage
  useEffect(() => {
    localStorage.setItem('printSize', printSize);
    printSizeRef.current = printSize; // Update ref as well
  }, [printSize]);

  // Detect USB printers on mount
  useEffect(() => {
    const detectUSBPrinters = async () => {
      if ('usb' in navigator) {
        try {
          const devices = await navigator.usb.getDevices();
          const printers = devices.map(device => ({
            id: device.serialNumber || `${device.vendorId}-${device.productId}`,
            name: device.productName || `Internal Thermal Printer (${device.productId})`,
            type: 'USB',
            device: device
          }));
          setAvailablePrinters(printers);
        } catch (err) {
          console.error('USB detection error:', err);
        }
      }
    };
    detectUSBPrinters();
  }, []);

  // Update ref and localStorage when printSize, isDirectPrint, or selectedPrinter changes
  useEffect(() => {
    printSizeRef.current = printSize;
    isDirectPrintRef.current = isDirectPrint;
    localStorage.setItem('printSize', printSize);
    localStorage.setItem('isDirectPrint', JSON.stringify(isDirectPrint));
    if (selectedPrinter) {
      localStorage.setItem('selectedPrinter', JSON.stringify(selectedPrinter));
    } else {
      localStorage.removeItem('selectedPrinter');
    }
  }, [printSize, isDirectPrint, selectedPrinter]);

  const handleScanPrinters = async () => {
    if (!('usb' in navigator)) {
      showToast(getTranslation('usbPrinterNotSupported', state.currentLanguage), 'warning');
      return;
    }

    try {
      // Request device access - filters for common POS printer classes could be added here
      const device = await navigator.usb.requestDevice({ filters: [] });
      const newPrinter = {
        id: device.serialNumber || `${device.vendorId}-${device.productId}`,
        name: device.productName || `USB Printer (${device.productId})`,
        type: 'USB',
        device: device
      };

      setAvailablePrinters(prev => {
        const exists = prev.find(p => p.id === newPrinter.id);
        if (exists) return prev;
        return [...prev, newPrinter];
      });
      setSelectedPrinter(newPrinter);
      showToast(getTranslation('printerConnected', state.currentLanguage).replace('{name}', newPrinter.name), 'success');
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        console.error('Error connecting printer:', err);
        showToast(getTranslation('failedToConnectPrinter', state.currentLanguage), 'error');
      }
    }
  };


  const barcodeInputRef = useRef(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const barcodeScanTimeoutRef = useRef(null);
  const scannerInputBufferRef = useRef('');
  const scannerInputTimerRef = useRef(null);
  const lastKeyTimeRef = useRef(0);
  const beepAudioRef = useRef(null);
  const cashRegisterAudioRef = useRef(null);

  // Play beep sound for item addition
  const playBeepSound = () => {
    try {
      // Try to play the preloaded MP3 audio first
      if (beepAudioRef.current && beepAudioRef.current.readyState >= 2) {
        beepAudioRef.current.currentTime = 0;
        const playPromise = beepAudioRef.current.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {

            })
            .catch(error => {

              playWebAudioBeep();
            });
        }
      } else {
        // Fallback to Web Audio API beep
        playWebAudioBeep();
      }
    } catch (error) {

      // Final fallback - silent
    }
  };

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

  // Ref to store the most recently created order for bill generation
  const lastCreatedOrder = useRef(null);
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
  const [billSettings, setBillSettings] = useState(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await getAllItems(STORES.settings);
        if (settings && settings.length > 0) {
          // Flatten settings if needed or use as is based on how it's stored
          // Customization.js stores it as a flat object or nested?
          // Looking at BillEditor, it saves { showHeader, termsAndConditions... }
          // Looking at Sync controller, it has billSettings: {...}
          // The local IndexedDB likely follows the Sync controller structure if synced, OR the frontend structure if saved locally.
          // Let's assume the local DB matches what BillEditor saves IF it writes directly, or what Customization writes.
          // Customization writes: { id: 'settings', ...settingsToSave }
          setBillSettings(settings[0]);
        }
      } catch (err) {
        console.error('Error loading settings:', err);
      }
    };
    loadSettings();
  }, []);
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
  const lastVoiceCommandRef = useRef('');
  const lastVoiceTimeRef = useRef(0);
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

  const { maxOrders, maxCustomers } = getDistributedPlanLimits(state.aggregatedUsage, state.currentPlan, state.currentPlanDetails);
  const activeOrders = state.orders.filter(order => !order.isDeleted);
  const activeCustomers = state.customers.filter(customer => !customer.isDeleted);
  const ordersUsed = state.aggregatedUsage?.orders?.used || 0;
  const customersUsed = state.aggregatedUsage?.customers?.used || 0;
  const activeOrdersCount = ordersUsed;

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

  // CRITICAL: Always use aggregated usage for limit checking
  const orderLimitReached = !canAddOrder(activeOrders.length, state.aggregatedUsage, state.currentPlan, state.currentPlanDetails, state.planOrders || state.planUsagePlans || []);

  // Debug logging when limit is reached
  if (orderLimitReached) {
    console.log('[ORDER LIMIT REACHED CHECK]', {
      activeOrdersCount,
      maxOrders,
      currentPlan: state.currentPlan,
      totalOrdersFromDetails: state.currentPlanDetails?.totalOrders,
      allOrdersCount: state.orders.length,
      deletedOrdersCount: state.orders.filter(o => o.isDeleted).length,
      canAddResult: canAddOrder(activeOrdersCount, state.aggregatedUsage, state.currentPlan, state.currentPlanDetails, state.planOrders || state.planUsagePlans || [])
    });
  }

  const customerLimitReached = !canAddCustomer(activeCustomers.length, state.aggregatedUsage, state.currentPlan, state.currentPlanDetails, state.planOrders || state.planUsagePlans || []);
  const orderLimitLabel = isUnlimited(maxOrders) ? 'Unlimited' : maxOrders;
  const customerLimitLabel = isUnlimited(maxCustomers) ? 'Unlimited' : maxCustomers;

  const showToast = (message, type = 'info', duration = 4000) => {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(message, type, duration);
    }
  };

  const validateQuantityForUnit = (rawQuantity, unit) => {
    const quantity = Number(rawQuantity);
    const normalizedUnit = unit?.toLowerCase?.() ?? 'pcs';

    if (!Number.isFinite(quantity)) {
      return { valid: false, message: getTranslation('pleaseEnterValidQuantity', state.currentLanguage) };
    }

    if (quantity <= 0) {
      return { valid: false, message: getTranslation('quantityGreaterZero', state.currentLanguage) };
    }

    if (isCountBasedUnit(normalizedUnit)) {
      if (!Number.isInteger(quantity)) {
        return { valid: false, message: getTranslation('wholeNumberRequired', state.currentLanguage) };
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
      showToast(getTranslation('mobileNumberMissingWhatsApp', state.currentLanguage), 'warning');
      return;
    }

    if (!isValidMobileNumber(sanitized)) {
      showToast(getTranslation('mobileNumberIncorrectWhatsApp', state.currentLanguage), 'error');
      return;
    }

    const withCountryCode = `91${sanitized}`;
    // Check if bill link has a valid invoice number or ID, otherwise fallback carefully
    // Prefer invoiceNumber for cleaner URLs, fallback to _id if invoiceNumber missing (legacy)
    const identifier = bill.invoiceNumber || bill._id || bill.id;
    const billUrl = `${window.location.origin}/view-bill/${identifier}`;

    // Get store name for the message
    const storeName = state.currentUser?.shopName || 'our store';
    const whatsappLink = state.currentUser?.whatsappLink;

    let messageText = `Hi ${bill.customerName || 'Customer'},\nYour bill from ${storeName} is ready. View it here:\n${billUrl}`;

    if (whatsappLink) {
      messageText += `\n\nJoin our WhatsApp group for exciting offers & updates:\n${whatsappLink}`;
    }

    // Just send the link as requested
    const message = encodeURIComponent(messageText);
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
    }, 600); // Increased from 100ms to 600ms to ensure complete barcode capture
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
      showToast(getTranslation('pleaseEnterUpiId', state.currentLanguage), 'error');
      return;
    }
    const upiRegex = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{3,}[a-zA-Z0-9]{0,}$/;
    if (!upiRegex.test(trimmed)) {
      showToast(getTranslation('pleaseEnterValidUpiId', state.currentLanguage), 'error');
      return;
    }
    setIsSavingUpi(true);
    dispatch({ type: ActionTypes.SET_UPI_ID, payload: trimmed });
    setIsSavingUpi(false);
    showToast(getTranslation('upiIdSavedSuccess', state.currentLanguage), 'success');
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

          beepAudioRef.current = audio;
        });

        audio.addEventListener('error', (e) => {

          // Fallback: Create beep using Web Audio API
          beepAudioRef.current = null; // Mark as null so we use Web Audio API
        });

        audio.load();
      } catch (error) {

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

            return;
          }

          // Create audio from blob URL for better compatibility
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);

          const audio = new Audio(blobUrl);
          audio.volume = 1.0; // 100% volume
          audio.preload = 'auto';

          audio.addEventListener('loadeddata', () => {

            cashRegisterAudioRef.current = audio;
          });

          audio.addEventListener('error', (e) => {

            if (audio.error) {

            }
            cashRegisterAudioRef.current = null;
            URL.revokeObjectURL(blobUrl);
          });

          audio.load();
        } catch (fetchError) {

          // Fallback to direct path
          const audio = new Audio(audioPath);
          audio.volume = 1.0;
          audio.preload = 'auto';

          audio.addEventListener('loadeddata', () => {
            console.log('✅ Cash register sound loaded successfully (direct path)');
            cashRegisterAudioRef.current = audio;
          });

          audio.addEventListener('error', (e) => {

            cashRegisterAudioRef.current = null;
          });

          audio.load();
        }
      } catch (error) {

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

  // Filter and sort products based on search and quantity
  const filteredProducts = state.products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.category?.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => {
    const qA = getTotalStockQuantity(a);
    const qB = getTotalStockQuantity(b);

    if (qA > 0 && qB === 0) return -1;
    if (qA === 0 && qB > 0) return 1;

    return (a.name || '').localeCompare(b.name || '');
  });

  // Calculate totals
  const subtotal = billItems.reduce((sum, item) => sum + getItemTotalAmount(item), 0);
  const totalGstAmount = billItems.reduce((sum, item) => sum + (item.gstAmount || 0), 0);
  const discountAmount = (subtotal * discount) / 100;
  const taxAmount = ((subtotal - discountAmount) * tax) / 100;
  const total = subtotal - discountAmount + taxAmount;


  const handleBarcodeScan = (barcode) => {
    const product = state.products.find(p => p.barcode === barcode);

    if (product) {
      // Product found via barcode scan - proceed to add it
      handleAddProduct(product); // Open quantity modal or auto-add
    } else {
      // Try to find a matching D-Product (Direct Product)
      // D-Products are identified if the barcode starts with their pCode
      let dProductMatch = null;
      let extractedPrice = 0;

      if (state.dProducts && state.dProducts.length > 0) {
        // Sort dProducts by pCode length descending to ensure we match the longest code first
        const sortedDProducts = [...state.dProducts].sort((a, b) => (b.pCode || '').length - (a.pCode || '').length);

        for (const dp of sortedDProducts) {
          if (dp.pCode && barcode.toLowerCase().startsWith(dp.pCode.toLowerCase())) {
            const priceStr = barcode.substring(dp.pCode.length);
            const price = parseFloat(priceStr);
            if (!isNaN(price) && price > 0) {
              dProductMatch = dp;
              extractedPrice = price;
              break;
            }
          }
        }
      }

      if (dProductMatch) {
        // Found a D-Product match
        // Create a unique item derived from this D-Product with the specific price
        const dProductItem = {
          ...dProductMatch,
          id: `${dProductMatch.id}_${extractedPrice}`, // Unique ID for this price point
          name: `${dProductMatch.productName} - ₹${extractedPrice}`, // Unique name
          price: extractedPrice,
          sellingPrice: extractedPrice,
          gstPercent: dProductMatch.taxPercentage || 0, // Map taxPercentage to gstPercent
          isDProduct: true,
          quantity: 1,
          unit: dProductMatch.unit || 'PCS'
        };

        // Add to bill directly, bypassing stock check limitations in handleAddProduct
        handleAddWithQuantity(dProductItem, 1, dProductItem.unit);
        showToast(`Added ${dProductItem.productName} for ₹${extractedPrice}`, 'success');
      } else {
        showToast(`Product with barcode ${barcode} not found.`, 'error');
      }
    }
    setBarcodeInput('');
  };

  // Auto-detect scanner input when billing page is open
  useEffect(() => {
    const handleScannerInput = (e) => {
      // Ignore control keys, but Allow Shift (scanners often use shift for uppercase)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const isBarcodeInput = target === barcodeInputRef.current;

      // Handle printable characters (length 1)
      if (e.key.length === 1) {
        const now = Date.now();
        const timeSinceLastKey = now - lastKeyTimeRef.current;

        // Scanners are extremely fast (usually < 50ms per key)
        // If it's the first char or fast enough, buffer it
        if (timeSinceLastKey < 60 || scannerInputBufferRef.current.length === 0) {
          // If we are in an input field and it's fast, we might want to prevent default 
          // to stop the barcode from cluttering the search box. 
          // However, we only do this if we are relatively sure it's a scanner.
          if (isInputField && !isBarcodeInput && scannerInputBufferRef.current.length > 0 && timeSinceLastKey < 60) {
            // Optional: e.preventDefault();
          }

          // Filter for typical barcode characters
          if (/^[a-zA-Z0-9\-_.]$/.test(e.key)) {
            scannerInputBufferRef.current += e.key;
            lastKeyTimeRef.current = now;
          }

          // Clear and set new timer
          if (scannerInputTimerRef.current) clearTimeout(scannerInputTimerRef.current);
          scannerInputTimerRef.current = setTimeout(() => {
            const scannedCode = scannerInputBufferRef.current.trim();
            if (scannedCode.length >= 3) {
              if (barcodeInputRef.current) barcodeInputRef.current.focus();
              setBarcodeInput(scannedCode);
              handleBarcodeScan(scannedCode);
            }
            scannerInputBufferRef.current = '';
          }, 150); // Faster processing for scanners
        } else {
          // Slow typing - reset buffer
          scannerInputBufferRef.current = '';
          lastKeyTimeRef.current = now;
        }
      } else if (e.key === 'Enter' && scannerInputBufferRef.current.length >= 3) {
        // Enter received significantly helps identify end of scan
        const scannedCode = scannerInputBufferRef.current.trim();
        if (barcodeInputRef.current) barcodeInputRef.current.focus();
        setBarcodeInput(scannedCode);
        handleBarcodeScan(scannedCode);
        scannerInputBufferRef.current = '';
        if (isInputField && !isBarcodeInput) {
          e.preventDefault(); // Don't let scanner Enter submit forms
        }
      }
    };

    window.addEventListener('keydown', handleScannerInput);
    return () => {
      window.removeEventListener('keydown', handleScannerInput);
      if (scannerInputTimerRef.current) clearTimeout(scannerInputTimerRef.current);
    };
  }, [state.products]);

  const handleAddProduct = (product) => {
    // Check if product unit is pcs - if so, add directly with quantity 1
    const productUnit = (product.unit || product.quantityUnit || 'pcs').toLowerCase();

    if (productUnit === 'pcs' || productUnit === 'piece' || productUnit === 'pieces') {
      // Check how many of this product are already in cart
      const existingCartItem = billItems.find(item => item.id === product.id);
      const cartQuantity = existingCartItem ? existingCartItem.quantity : 0;

      // Determine quantity to add: MOQ if first time in wholesale, else 1
      let qtyToAdd = 1;
      const effectiveMOQ = getEffectiveWholesaleMOQ(product);
      if (saleMode === 'wholesale' && cartQuantity === 0 && effectiveMOQ > 1) {
        qtyToAdd = effectiveMOQ;
      }

      // Get total available stock
      const totalStock = getTotalStockQuantity(product);

      // Calculate available stock after accounting for cart items
      const availableStock = totalStock - cartQuantity;

      // Check if we can add the required quantity
      if (availableStock < qtyToAdd) {
        // Show stock warning and don't proceed
        const stockCheck = checkStockAvailability(product, qtyToAdd, 'pcs');
        const errorMsg = stockCheck.error || (state.currentLanguage === 'hi'
          ? `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`
          : `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`);
        showToast(errorMsg, 'warning');
        return;
      }

      // Auto-add with determined quantity
      const added = handleAddWithQuantity(product, qtyToAdd, 'pcs');
      if (added) {
        showToast(state.currentLanguage === 'hi'
          ? `${product.name} (${qtyToAdd} pcs) जोड़ा गया`
          : `Added ${product.name} (${qtyToAdd} pcs)`, 'success');
      }

    } else {
      // Show quantity modal for other units
      const existingCartItem = billItems.find(item => item.id === product.id);

      if (existingCartItem) {
        // Product already exists in cart - set up replace handler
        const handleReplaceForExisting = (prod, qty, unit) => {
          return handleReplaceQuantity(prod, qty, unit);
        };

        setSelectedProduct({
          ...product,
          _isEdit: true,
          _editHandler: handleReplaceForExisting,
          _currentQuantity: existingCartItem.quantity,
          _currentUnit: existingCartItem.unit
        });
      } else {
        // Product not in cart - use normal add handler
        setSelectedProduct(product);
      }

      setShowQuantityModal(true);
    }
  };

  // Replace quantity instead of merging (for editing existing cart items)
  const handleReplaceQuantity = (product, quantity, unit, fixedAmount = null, selectedBatchId = null) => {
    const validation = validateQuantityForUnit(quantity, unit);
    if (!validation.valid) {
      showToast(validation.message, 'warning');
      return false;
    }

    const sanitizedQuantity = validation.quantity;

    // Wholesale MOQ check
    if (saleMode === 'wholesale') {
      const productUnit = product.quantityUnit || product.unit || 'pcs';
      const qtyInBase = convertToBaseUnit(sanitizedQuantity, unit);
      const prodUnitInBase = convertToBaseUnit(1, productUnit) || 1;
      const targetQuantityInProductUnits = qtyInBase / prodUnitInBase;

      const moq = getEffectiveWholesaleMOQ(product);

      if (targetQuantityInProductUnits < moq) {
        showToast(
          state.currentLanguage === 'hi'
            ? `थोक बिक्री के लिए कम से कम ${moq} ${getTranslation(productUnit, state.currentLanguage) || productUnit} आवश्यक है।`
            : `Minimum order quantity (MOQ) for wholesale is ${moq} ${productUnit}.`,
          'warning'
        );
        return false;
      }
    }

    // Use functional update to replace quantity
    const resultRef = { stockError: null };

    setBillItems(prev => {
      // Check if product already exists in bill
      const existingItemIndex = prev.findIndex(item => {
        // Strict ID match if product has an ID (prevents name collision for distinct items with same name like D-Products)
        if (product.id) {
          return item.id === product.id;
        }
        // Fallback to name matching only if product has no ID (should be rare)
        return item.name.toLowerCase().trim() === product.name.toLowerCase().trim();
      });

      if (existingItemIndex >= 0) {
        // Product exists - replace quantity instead of merging
        const existingItem = prev[existingItemIndex];

        // SPECIAL HANDLING FOR D-PRODUCTS
        if (existingItem.isDProduct) {
          const currentUnit = existingItem.unit || 'pcs';
          const currentUnitPrice = existingItem.price || 0;

          // Calculate new Unit Price handling unit conversion
          let newUnitPrice = currentUnitPrice;

          // Only convert price if units are different and both are convertible (not pcs)
          if (currentUnit !== unit && unit.toLowerCase() !== 'pcs' && currentUnit.toLowerCase() !== 'pcs') {
            const currentOneInBase = convertToBaseUnit(1, currentUnit);
            const newOneInBase = convertToBaseUnit(1, unit);

            if (currentOneInBase > 0 && newOneInBase > 0) {
              newUnitPrice = currentUnitPrice * (newOneInBase / currentOneInBase);
            }
          }

          const newTotalSellingPrice = newUnitPrice * sanitizedQuantity;
          const newGstAmount = (newTotalSellingPrice * (existingItem.gstPercent || 0)) / 100;

          const updatedDProduct = {
            ...existingItem,
            price: newUnitPrice, // Update unit price
            quantity: sanitizedQuantity,
            unit: unit,
            gstAmount: Math.floor(newGstAmount * 100) / 100,
            total: newTotalSellingPrice + newGstAmount,
            totalSellingPrice: newTotalSellingPrice,
            originalQuantity: {
              ...existingItem.originalQuantity,
              quantity: sanitizedQuantity,
              unit: unit
            }
          };

          return prev.map((item, idx) => idx === existingItemIndex ? updatedDProduct : item);
        }

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
        const stockCheck = checkStockAvailability(product, finalQuantity, finalUnit, selectedBatchId);

        if (!stockCheck.available) {
          resultRef.stockError = stockCheck.error || (state.currentLanguage === 'hi'
            ? `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`
            : `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`);
          return prev;
        }

        // Replace existing item with new quantity
        const updatedItem = buildBillItem(product, finalQuantity, finalUnit, stockCheck.baseUnit, fixedAmount, selectedBatchId);
        return prev.map((item, idx) => idx === existingItemIndex ? updatedItem : item);
      }

      // Product doesn't exist - add new item (shouldn't happen when editing, but handle it)
      const stockCheck = checkStockAvailability(product, sanitizedQuantity, unit, selectedBatchId);

      if (!stockCheck.available) {
        resultRef.stockError = stockCheck.error || (state.currentLanguage === 'hi'
          ? `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`
          : `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`);
        return prev;
      }

      const newItem = buildBillItem(product, sanitizedQuantity, unit, stockCheck.baseUnit, fixedAmount, selectedBatchId);
      return [...prev, newItem];
    });

    // Show error if stock check failed
    if (resultRef.stockError) {
      showToast(resultRef.stockError, resultRef.stockError.includes('error') ? 'error' : 'warning');
      return false;
    }

    return true;
  };

  const handleAddWithQuantity = (product, quantity, unit, fixedAmount = null, selectedBatchId = null) => {
    const validation = validateQuantityForUnit(quantity, unit);
    if (!validation.valid) {
      showToast(validation.message, 'warning');
      return false;
    }

    const sanitizedQuantity = validation.quantity;

    // Wholesale MOQ check
    if (saleMode === 'wholesale') {
      const productUnit = product.quantityUnit || product.unit || 'pcs';
      const qtyInBase = convertToBaseUnit(sanitizedQuantity, unit);
      const prodUnitInBase = convertToBaseUnit(1, productUnit) || 1;
      const addedQuantityInProductUnits = qtyInBase / prodUnitInBase;

      // Find existing quantity in cart
      const existingItem = billItems.find(item =>
        (product.id && item.id === product.id) ||
        (item.name.toLowerCase().trim() === product.name.toLowerCase().trim())
      );
      const existingQty = existingItem ? existingItem.quantity : 0;
      const initialUnit = existingItem ? (existingItem.unit || existingItem.quantityUnit || 'pcs') : productUnit;

      let existingQtyInProductUnits = existingQty;
      if (existingItem && initialUnit !== productUnit) {
        const existingQtyInBase = convertToBaseUnit(existingQty, initialUnit);
        existingQtyInProductUnits = existingQtyInBase / prodUnitInBase;
      }

      const totalQuantityInProductUnits = addedQuantityInProductUnits + existingQtyInProductUnits;
      const moq = getEffectiveWholesaleMOQ(product);

      if (totalQuantityInProductUnits < moq) {
        showToast(
          state.currentLanguage === 'hi'
            ? `थोक बिक्री के लिए कुल मात्रा ${moq} ${getTranslation(productUnit, state.currentLanguage) || productUnit} आवश्यक है। (वर्तमान: ${totalQuantityInProductUnits})`
            : `Total minimum order quantity (MOQ) for wholesale is ${moq} ${productUnit}. (Current: ${totalQuantityInProductUnits})`,
          'warning'
        );
        return false;
      }
    }



    // Use functional update to atomically check and update - prevents race conditions
    const resultRef = { merged: false, stockError: null };

    setBillItems(prev => {
      // Check if product already exists in bill (Robust matching: ID OR Name)
      const existingItemIndex = prev.findIndex(item =>
        (product.id && item.id === product.id) ||
        (item.name.toLowerCase().trim() === product.name.toLowerCase().trim())
      );

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
        // Skip stock check for D-Products
        const stockCheck = product.isDProduct
          ? { available: true, baseUnit: existingUnit, stockDisplay: 'Unlimited' }
          : checkStockAvailability(product, finalQuantity, existingUnit, selectedBatchId);

        if (!stockCheck.available) {
          // Store error for display after state update
          resultRef.stockError = stockCheck.error || (state.currentLanguage === 'hi'
            ? `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`
            : `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`);
          // Return previous state unchanged - stock check failed
          return prev;
        }

        // Update existing item with merged quantity
        let updatedItem;
        if (product.isDProduct) {
          const price = existingItem.price || product.price || 0;
          const totalSellingPrice = price * finalQuantity;
          const gstAmount = (totalSellingPrice * (existingItem.gstPercent || product.gstPercent || 0)) / 100;
          updatedItem = {
            ...existingItem,
            quantity: finalQuantity,
            total: totalSellingPrice + gstAmount,
            totalSellingPrice: totalSellingPrice,
            gstAmount: Math.floor(gstAmount * 100) / 100
          };
        } else {
          updatedItem = buildBillItem(product, finalQuantity, existingUnit, stockCheck.baseUnit, fixedAmount, selectedBatchId);
        }
        return prev.map((item, idx) => idx === existingItemIndex ? updatedItem : item);
      }

      // Product doesn't exist - check stock and add new item
      // Skip stock check for D-Products
      const stockCheck = product.isDProduct
        ? { available: true, baseUnit: unit, stockDisplay: 'Unlimited' }
        : checkStockAvailability(product, sanitizedQuantity, unit, selectedBatchId);

      if (!stockCheck.available) {
        // Store error for display after state update
        resultRef.stockError = stockCheck.error || (state.currentLanguage === 'hi'
          ? `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`
          : `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}.`);
        // Return previous state unchanged - stock check failed
        return prev;
      }

      // Add new item
      let newItem;
      if (product.isDProduct) {
        const price = product.price || 0;
        const totalSellingPrice = price * sanitizedQuantity;
        const gstAmount = (totalSellingPrice * (product.gstPercent || 0)) / 100;
        newItem = {
          ...product,
          quantity: sanitizedQuantity,
          unit: unit,
          total: totalSellingPrice + gstAmount,
          totalSellingPrice: totalSellingPrice,
          gstAmount: Math.floor(gstAmount * 100) / 100,
          originalQuantity: { quantity: sanitizedQuantity, unit: unit }
        };
      } else {
        newItem = buildBillItem(product, sanitizedQuantity, unit, stockCheck.baseUnit, fixedAmount, selectedBatchId);
      }
      return [...prev, newItem];
    });

    // Show error if stock check failed
    if (resultRef.stockError) {
      showToast(resultRef.stockError, resultRef.stockError.includes('error') ? 'error' : 'warning');
      return false;
    }

    // Play beep sound for successful item addition
    playBeepSound();

    return true;
  };

  // Common Hinglish to English product name mapping
  const HINGLISH_MAP = {
    'chini': 'sugar', 'cheeni': 'sugar', 'चीनी': 'sugar',
    'doodh': 'milk', 'dud': 'milk', 'दूध': 'milk',
    'patti': 'tea', 'chai': 'tea', 'चाय': 'tea',
    'namak': 'salt', 'नमक': 'salt',
    'tel': 'oil', 'तेल': 'oil',
    'atta': 'flour', 'आटा': 'flour',
    'chawal': 'rice', 'चावल': 'rice',
    'daal': 'dal', 'dal': 'dal', 'दाल': 'dal',
    'sabun': 'soap', 'साबुन': 'soap',
    'pani': 'water', 'पानी': 'water',
    'anda': 'egg', 'andey': 'eggs', 'अंडा': 'egg',
    'masala': 'spice', 'मसाला': 'spice',
    'mirch': 'chilli', 'mirchi': 'chilli', 'मिर्च': 'chilli',
    'haldi': 'turmeric', 'हल्दी': 'turmeric',
    'jeera': 'cumin', 'जीरा': 'cumin',
    'dhaniya': 'coriander', 'धनिया': 'coriander',
    'lahsun': 'garlic', 'लहसुन': 'garlic',
    'adrak': 'ginger', 'अदरक': 'ginger',
    'pyaj': 'onion', 'pyaaj': 'onion', 'प्याज': 'onion',
    'aloo': 'potato', 'alu': 'potato', 'आलू': 'potato',
    'tamatar': 'tomato', 'टमाटर': 'tomato',
    'refined': 'oil', 'रिफाइंड': 'oil',
    'shakkar': 'sugar', 'शक्कर': 'sugar',
    'besan': 'gram flour', 'बेसन': 'gram flour',
    'maida': 'refined flour', 'मैदा': 'refined flour',
    'suji': 'semolina', 'sooji': 'semolina', 'सूजी': 'semolina',
    'sarson': 'mustard', 'सरसों': 'mustard',
    'makhan': 'butter', 'मक्खन': 'butter',
    'dahi': 'curd', 'दही': 'curd',
    'paneer': 'cottage cheese', 'पनीर': 'paneer',
    'ghee': 'ghee', 'घी': 'ghee',
    'madhu': 'honey', 'शहद': 'honey',
    'ram badam': 'badam', 'rambadam': 'badam'
  };

  const NUMBER_WORDS_MAP = {
    'ek': 1, 'one': 1, 'one.': 1, '1.': 1, 'एक': 1, '१': 1,
    'do': 2, 'two': 2, 'tu': 2, 'दो': 2, '२': 2,
    'teen': 3, 'tin': 3, 'three': 3, 'तीन': 3, '३': 3,
    'char': 4, 'chaar': 4, 'four': 4, 'चार': 4, '४': 4,
    'paanch': 5, 'panch': 5, 'five': 5, 'पांच': 5, '५': 1,
    'che': 6, 'chhe': 6, 'six': 6, 'छह': 6, '६': 6,
    'saat': 7, 'seven': 7, 'सात': 7, '७': 7,
    'aath': 8, 'eight': 8, 'आठ': 8, '८': 8,
    'nau': 9, 'no': 9, 'nine': 9, 'नौ': 9, '९': 9,
    'dus': 10, 'das': 10, 'ten': 10, 'दस': 10, '१०': 10
  };

  // Helper for fuzzy similarity (Levenshtein based)
  const calculateSimilarity = (s1, s2) => {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) return 1.0;

    const editDistance = (a, b) => {
      const costs = [];
      for (let i = 0; i <= a.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= b.length; j++) {
          if (i === 0) costs[j] = j;
          else if (j > 0) {
            let newValue = costs[j - 1];
            if (a.charAt(i - 1) !== b.charAt(j - 1))
              newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
            costs[j - 1] = lastValue;
            lastValue = newValue;
          }
        }
        if (i > 0) costs[b.length] = lastValue;
      }
      return costs[b.length];
    };

    return (longer.length - editDistance(longer, shorter)) / parseFloat(longer.length);
  };

  // Find best matching product from spoken name
  const findMatchingProduct = (spokenName) => {
    if (!spokenName || spokenName.trim() === '') return null;

    let searchTerm = spokenName.toLowerCase().trim();

    // 1. Try Hinglish mapping
    if (HINGLISH_MAP[searchTerm]) {
      const mappedName = HINGLISH_MAP[searchTerm];
      const prod = state.products.find(p => p.name.toLowerCase() === mappedName.toLowerCase());
      if (prod) return prod;
    }

    // 2. Try exact match
    let product = state.products.find(p => p.name.toLowerCase() === searchTerm);
    if (product) return product;

    // 3. Try "starts with" (more strict)
    product = state.products.find(p => {
      const pName = p.name.toLowerCase();
      // Only match if searchTerm starts with pName followed by space (full word)
      // or if they are very close in length
      return searchTerm.startsWith(pName) &&
        (searchTerm.length === pName.length || searchTerm[pName.length] === ' ');
    });
    if (product) return product;

    // 4. Try word-by-word match (prioritize matches with more words)
    const searchWords = searchTerm.split(/\s+/).filter(w => w.length > 2);
    if (searchWords.length > 0) {
      const candidates = state.products.filter(p => {
        const productWords = p.name.toLowerCase().split(/\s+/);
        return searchWords.some(word =>
          productWords.some(pWord => pWord.includes(word) || word.includes(pWord))
        );
      });

      if (candidates.length > 0) {
        // Sort candidates by how many search words they contain
        candidates.sort((a, b) => {
          const countWords = (p) => {
            const pWords = p.name.toLowerCase().split(/\s+/);
            return searchWords.filter(sw => pWords.some(pw => pw.includes(sw))).length;
          };
          return countWords(b) - countWords(a);
        });
        return candidates[0];
      }
    }

    // 5. Advanced Fuzzy Scoring
    let bestMatch = null;
    let highestScore = 0;

    for (const p of state.products) {
      const pName = p.name.toLowerCase();
      // Pass 1: Simple Similarity
      let score = calculateSimilarity(searchTerm, pName);

      // Pass 2: Boost if searchTerm is a significant part of product name
      if (pName.includes(searchTerm) && searchTerm.length > 3) score += 0.2;

      // Pass 3: Penalize if lengths are too different
      const lenDiff = Math.abs(pName.length - searchTerm.length);
      if (lenDiff > 10) score -= 0.3;

      if (score > highestScore) {
        highestScore = score;
        bestMatch = p;
      }
    }

    // Threshold for fuzzy match
    if (highestScore > 0.65) return bestMatch;

    // 6. Phonetic fallbacks
    const fallbacks = [
      { from: 'china', to: 'chini' },
      { from: 'shiny', to: 'chini' },
      { from: 'dude', to: 'doodh' },
      { from: 'oil', to: 'tel' },
      { from: 'salt', to: 'namak' },
      { from: 'sugar', to: 'chini' },
      { from: 'bread', to: 'pav' }
    ];

    for (const fb of fallbacks) {
      if (searchTerm.includes(fb.from)) {
        const altTerm = searchTerm.replace(fb.from, fb.to);
        const altMatch = findMatchingProduct(altTerm);
        if (altMatch) return altMatch;
      }
    }

    return null;
  };

  const checkUnitCompatibility = (spokenUnit, productUnit) => {
    const categories = {
      weight: ['kg', 'g', 'gram', 'grams', 'gm', 'kilo', 'kilogram'],
      volume: ['l', 'ml', 'liter', 'liters', 'litre', 'litres', 'milliliter', 'milliliters'],
      count: ['pcs', 'piece', 'pieces', 'peace', 'packet', 'packets', 'box', 'boxes', 'bottle', 'bottles']
    };

    const getCategory = (u) => {
      const unit = u.toLowerCase();
      if (categories.weight.includes(unit)) return 'weight';
      if (categories.volume.includes(unit)) return 'volume';
      if (categories.count.includes(unit)) return 'count';
      return 'other';
    };

    const spokenCat = getCategory(spokenUnit);
    const productCat = getCategory(productUnit);

    return {
      compatible: spokenCat === productCat || spokenCat === 'other' || productCat === 'other',
      productCategory: productCat
    };
  };

  const getPossibleUnits = (unit) => {
    const u = unit.toLowerCase();
    if (['kg', 'g', 'gram', 'grams', 'gm', 'kilo', 'kilogram'].includes(u)) return ['kg', 'g'];
    if (['l', 'ml', 'liter', 'liters', 'litre', 'litres', 'milliliter', 'milliliters'].includes(u)) return ['l', 'ml'];
    if (['pcs', 'piece', 'pieces', 'peace', 'packet', 'packets', 'box', 'boxes', 'bottle', 'bottles'].includes(u)) return ['pcs', 'packet'];
    return [unit];
  };

  const isUnitDivisible = (unit) => {
    if (!unit) return false;
    const u = unit.toLowerCase().trim();
    // Match any unit starting with kg, gram, kilo, liter, litre, ml, gm, pkt, pouch
    return /^(kg|gram|kilo|liter|litre|ml|gm|pkt|pouch|packet|bottle|can|box)/.test(u) ||
      ['g', 'l', 'packet', 'pouch', 'bottle'].includes(u);
  };

  // Process voice input and add products instantly
  // Parse quantity and unit from text
  const parseQuantityAndUnit = (text) => {
    const lowerText = text.toLowerCase().trim();

    // 1. Handle Hinglish spelled-out numbers at start
    // e.g., "ek kilo sugar", "do kilo chini"
    const words = lowerText.split(/\s+/);
    if (NUMBER_WORDS_MAP[words[0]]) {
      const qty = NUMBER_WORDS_MAP[words[0]];
      let unit = 'pcs';
      let matchedText = words[0];

      // Check if second word is a unit
      if (words.length > 1) {
        const potentialUnit = words[1];
        if (['kg', 'kilo', 'kilogram', 'g', 'gram', 'gm', 'l', 'liter', 'ml', 'pcs', 'piece'].some(u => potentialUnit.includes(u))) {
          unit = potentialUnit.replace(/s$/, ''); // singularize
          if (unit === 'kilo' || unit === 'kilogram') unit = 'kg';
          if (unit === 'gram' || unit === 'gm') unit = 'g';
          if (unit === 'liter') unit = 'l';
          if (unit === 'piece') unit = 'pcs';
          matchedText += ' ' + words[1];
          return { quantity: qty, unit, matchedText };
        }
      }
    }

    // 2. Handle Hinglish measures
    const hinglishMeasures = [
      { regex: /\b(adha|aadha|half)\s+(kilo|kg)\b/i, qty: 0.5, unit: 'kg' },
      { regex: /\b(paa|pau|pav|quarter)\s+(kilo|kg)\b/i, qty: 0.25, unit: 'kg' },
      { regex: /\b(dedh|daidh|deid)\s+(kilo|kg)\b/i, qty: 1.5, unit: 'kg' },
      { regex: /\b(pav|paa|pau)\b/i, qty: 0.25, unit: 'kg' },
      { regex: /\b(aadha|adha|half)\b/i, qty: 0.5, unit: 'pcs' }
    ];

    for (const hm of hinglishMeasures) {
      const match = lowerText.match(hm.regex);
      if (match) {
        return { quantity: hm.qty, unit: hm.unit, matchedText: match[0] };
      }
    }

    // 3. Patterns: "500g", "1 kg", "1.5kg", etc.
    const patterns = [
      /(\d+\.?\d*)\s*(kg|kilogram|kilograms|kilo|killo|g|gram|grams|gm|ml|milliliter|milliliters|l|liter|liters|litre|litres|pcs|piece|pieces|peace|packet|packets|box|boxes|bottle|bottles)/gi,
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
      .replace(/\b(ek|do|teen|char|paanch|chey|saat|aath|nau|dus|one|two|three|four|five|six|seven|eight|nine|ten)\s+(kg|kilo|gram|gm|liter|l|pcs|piece)\b/gi, '')
      .replace(/\b(adha|aadha|half|paa|pau|pav|quarter|dedh|daidh|deid)\s+(kilo|kg|kilo|killo)\b/gi, '')
      .replace(/\b(pav|paa|pau)\b/gi, '')
      .trim();

    // Remove common filler words and Hinglish fillers
    cleaned = cleaned.replace(/\b(the|a|an|is|are|and|or|but|in|on|at|to|for|of|with|add|give|take|aur|bhi|do|de|le|lo|kar|ok|okay|chahiye|likh|daal|dalna|laga|phir|next|ek|do|ram|shyam|haan|ji|jee|acha|accha|um|uh|ki|ka|ke|ko|rupey|rupeye|rupiya|rupiye|rupee|rupees|ruppes|ruppey|rs\.|rs|amount|₹)\b/gi, '').trim();

    return cleaned;
  };

  // Natural voice feedback function
  const speakFeedback = useCallback((text) => {
    if (!window.speechSynthesis) return;

    // Stop listening before speaking to avoid feedback loop
    const wasListening = isListening;
    if (wasListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) { }
      }
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = state.currentLanguage === 'hi' ? 'hi-IN' : 'en-IN';
    utterance.rate = 0.9;
    utterance.pitch = 1.0;

    // Use a female voice if available
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => (v.lang.includes('IN') || v.lang.includes('en')) && (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('google')));
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      // Resume listening if we were listening before
      if (wasListening && shouldKeepListeningRef.current) {
        setTimeout(() => {
          if (recognitionRef.current && showVoiceModal) {
            try {
              recognitionRef.current.start();
            } catch (e) { }
          }
        }, 300);
      }
    };

    window.speechSynthesis.speak(utterance);
  }, [isListening, state.currentLanguage, showVoiceModal]);

  // Function to speak all items in cart with natural Indian conversational style
  const speakAllItems = () => {
    // Get current billItems from ref to avoid closure issues
    const itemsToSpeak = billItemsRef.current || billItems;

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

    // Track matched ranges for shielding
    const shieldedRanges = [];
    const shieldRange = (start, end) => shieldedRanges.push({ start, end });
    const isShielded = (index) => shieldedRanges.some(r => index >= r.start && index <= r.end);

    const items = [];

    // STEP 2: Extract amount patterns (rupees, rs, amount) BEFORE quantity-unit patterns
    // Support various spellings: rupey, rupee, rupees, ruppes, ruppey, rs, rs., ₹, amount
    // Support both formats: "20 rupees" and "₹20" or "rupees 20"
    const amountMatches = [];

    // Pattern 1: Number followed by rupee word/symbol (e.g., "20 rupees", "20 ₹")
    const amountPattern1 = /(\d+\.?\d*)\s*(rupey|rupeye|rupiya|rupiye|rupee|rupees|ruppes|ruppey|rs\.|rs|₹|amount|ki|ka|ke|ko)\b/gi;
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
    const amountPattern3 = /(rupey|rupeye|rupiya|rupiye|rupee|rupees|ruppes|ruppey|rs\.|rs|amount|ki|ka|ke|ko)\s*(\d+\.?\d*)/gi;
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

    // Pattern 4: Number followed by ki/ka/ke (e.g., "20 ki badam")
    const amountPattern4 = /(\d+\.?\d*)\s*(ki|ka|ke|ko)\b/gi;

    while ((amountMatch = amountPattern4.exec(normalizedText)) !== null) {
      const amount = parseFloat(amountMatch[1]);
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
    // STEP 1.5: Handle Hinglish measures in transcript preview
    const hinglishMeasures = [
      { regex: /\b(adha|aadha|half)\s+(kilo|kg)\b/gi, qty: 0.5, unit: 'kg' },
      { regex: /\b(paa|pau|pav|quarter)\s+(kilo|kg)\b/gi, qty: 0.25, unit: 'kg' },
      { regex: /\b(dedh|daidh|deid)\s+(kilo|kg)\b/gi, qty: 1.5, unit: 'kg' },
      { regex: /\b(pav|paa|pau)\b/gi, qty: 0.25, unit: 'kg' },
      { regex: /\b(aadha|adha|half)\b/gi, qty: 0.5, unit: 'pcs' }
    ];

    const matches = [];
    hinglishMeasures.forEach(hm => {
      let m;
      while ((m = hm.regex.exec(normalizedText)) !== null) {
        matches.push({
          quantity: hm.qty,
          unit: hm.unit,
          index: m.index,
          length: m[0].length,
          matchedText: m[0]
        });
      }
    });

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

      matches.push({
        quantity,
        unit,
        index: match.index,
        length: match[0].length,
        matchedText: match[0]
      });
    }

    // Sort matches by index
    matches.sort((a, b) => a.index - b.index);

    // STEP 2: Extract amount patterns (rupees, rs, amount) BEFORE quantity-unit patterns
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
        productNameText = productNameText.replace(/\b(rupey|rupee|rupees|ruppes|ruppey|rs\.|rs|amount|₹|ki|ka|ke|ko)\b/gi, '').trim();
        let cleanedName = productNameText.replace(/\b(the|a|an|is|are|and|or|but|in|on|at|to|for|of|with|add|give|take|aur|bhi|do|de|le|lo|kar|ok|okay)\b/gi, '').trim();

        // If no product found backwards, look forwards (e.g., "20 ki badam")
        if (!cleanedName || cleanedName.length < 2) {
          const amtEnd = amountMatch.index + amountMatch.length;
          let forwardEnd = normalizedText.length;

          // Check for next patterns to limit segment
          const nextAmt = amountMatches[idx + 1];
          if (nextAmt) forwardEnd = Math.min(forwardEnd, nextAmt.index);

          const nextQtyMatch = matches.find(m => m.index >= amtEnd);
          if (nextQtyMatch) forwardEnd = Math.min(forwardEnd, nextQtyMatch.index);

          let forwardSegment = normalizedText.substring(amtEnd, forwardEnd).trim();
          const fWords = forwardSegment.split(/\s+/);
          if (fWords.length > 3) forwardSegment = fWords.slice(0, 3).join(' ');

          cleanedName = forwardSegment.replace(/\b(the|a|an|is|are|and|or|but|in|on|at|to|for|of|with|add|give|take|aur|bhi|do|de|le|lo|kar|ok|okay)\b/gi, '').trim();
        }

        if (cleanedName) {
          // Try to find product to get price and calculate quantity
          const product = findMatchingProduct(cleanedName);
          if (product) {
            const productUnit = product.unit || product.quantityUnit || 'pcs';
            const isDivisibleUnit = isUnitDivisible(productUnit);

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
                  matched: true,
                  unitCompatible: true
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
                  matched: true,
                  unitCompatible: true,
                  error: 'Price not set'
                });
              }
            } else {
              const pricePerUnit = product.sellingPrice || product.sellingUnitPrice || product.costPrice || product.unitPrice || 0;
              if (pricePerUnit > 0) {
                const calculatedQuantity = amountMatch.amount / pricePerUnit;
                items.push({
                  id: `amt-${idx}-${items.length}`,
                  product: product.name,
                  spokenName: cleanedName,
                  quantity: calculatedQuantity,
                  unit: productUnit,
                  amount: amountMatch.amount,
                  isAmountBased: true,
                  matched: true,
                  unitCompatible: true
                });
              } else {
                items.push({
                  id: `amt-${idx}-${items.length}`,
                  product: product.name,
                  spokenName: cleanedName,
                  quantity: 1,
                  unit: productUnit,
                  amount: amountMatch.amount,
                  isAmountBased: true,
                  matched: true,
                  unitCompatible: true,
                  warning: 'Product price not set'
                });
              }
            }

            // Surgical shielding
            let shieldStart = segmentStart;
            let shieldEnd = amountEnd;
            const pNameLower = product.name.toLowerCase();
            const prodPosInWhole = normalizedText.indexOf(pNameLower); // Simplify: first occurrence since segments are small
            if (prodPosInWhole !== -1) {
              shieldStart = Math.min(shieldStart, prodPosInWhole);
              shieldEnd = Math.max(shieldEnd, prodPosInWhole + pNameLower.length);
            }
            shieldRange(shieldStart, shieldEnd);
          } else {
            // Product not found - show spoken name
            items.push({
              id: `amt-${idx}-${items.length}`, // Unique ID for removal
              product: cleanedName,
              quantity: 0,
              unit: 'pcs',
              amount: amountMatch.amount,
              isAmountBased: false,
              matched: false,
              unitCompatible: true
            });
          }
        }
      });
    }

    // STEP 5: Process quantity-unit patterns (process all, even if amount patterns also exist)
    if (matches.length > 0) {
      // Filter out segments that were already processed as amount patterns
      const unshieldedMatches = matches.filter(qtyUnit => {
        const center = qtyUnit.index + (qtyUnit.length / 2);
        return !isShielded(center);
      });

      // Process each unshielded quantity-unit match
      unshieldedMatches.forEach((qtyUnit, idx) => {
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
        const cleanedName = productName.replace(/\b(the|a|an|is|are|and|or|but|in|on|at|to|for|of|with|add|give|take|aur|bhi|do|de|le|lo|kar|ok|okay)\b/gi, '').trim();

        if (cleanedName) {
          const product = findMatchingProduct(cleanedName);
          const productUnit = product ? (product.unit || product.quantityUnit || 'pcs') : 'pcs';
          const compatibility = product ? checkUnitCompatibility(qtyUnit.unit, productUnit) : { compatible: true };

          items.push({
            id: `qty-${idx}-${items.length}`, // Unique ID for removal
            product: product ? product.name : cleanedName, // Show corrected product name if found
            spokenName: cleanedName, // Keep original spoken name for reference
            quantity: qtyUnit.quantity,
            unit: qtyUnit.unit,
            rawMatchedText: qtyUnit.matchedText,
            rawIndex: qtyUnit.index,
            matched: product ? true : false,
            unitCompatible: compatibility.compatible,
            correctUnit: productUnit,
            possibleUnits: product ? getPossibleUnits(productUnit) : [qtyUnit.unit],
            error: !compatibility.compatible ? `Should be in ${productUnit}` : null
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
        const cleaned = segment.replace(/\b(the|a|an|is|are|and|or|but|in|on|at|to|for|of|with|add|give|take|aur|bhi|do|de|le|lo|kar|ok|okay)\b/gi, '').trim();
        if (cleaned) {
          const product = findMatchingProduct(cleaned);
          items.push({
            id: `seg-${items.length}`, // Unique ID for removal
            product: product ? product.name : cleaned, // Show corrected product name if found
            spokenName: cleaned, // Keep original spoken name for reference
            quantity: 1,
            unit: product ? (product.unit || product.quantityUnit || 'pcs') : 'pcs',
            matched: product ? true : false,
            unitCompatible: true
          });
        }
      });
    }

    // Final Step: Merge duplicate products in the list to avoid clutter
    const mergedMap = new Map();
    items.forEach(item => {
      // Use product name as key for merging (matched products will have same name)
      const key = item.matched ? item.product.toLowerCase() : `unmatched-${item.product.toLowerCase()}`;

      if (mergedMap.has(key)) {
        const existing = mergedMap.get(key);
        // Only merge if they are both simple items or both amount-based, and have same unit
        if (existing.unit === item.unit && !existing.error && !item.error) {
          existing.quantity += item.quantity;
          if (item.amount) existing.amount = (existing.amount || 0) + item.amount;
          // Keep the first ID for removal reference
          return;
        }
      }
      mergedMap.set(key, { ...item });
    });

    return Array.from(mergedMap.values());
  };

  const processVoiceInput = (text, showToasts = true) => {
    if (!text || text.trim() === '') return;

    let normalizedText = text.toLowerCase().trim();

    // Deduplication check: Don't process the exact same text within 3 seconds
    if (lastVoiceCommandRef.current === normalizedText && (Date.now() - lastVoiceTimeRef.current < 3000)) {
      console.log("🚫 [processVoiceInput] Ignoring duplicate command:", normalizedText);
      return;
    }
    lastVoiceCommandRef.current = normalizedText;
    lastVoiceTimeRef.current = Date.now();

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

      showToast(getTranslation('readingCartItems', state.currentLanguage), 'info', 2000);
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

    // Track which parts of the text have been matched (for fallback shielding)
    const shieldedRanges = [];
    const shieldRange = (start, end) => shieldedRanges.push({ start, end });
    const isShielded = (index) => shieldedRanges.some(r => index >= r.start && index <= r.end);

    // STEP 2: Extract amount patterns (rupees, rs, amount) BEFORE quantity-unit patterns
    // Support various spellings: rupey, rupee, rupees, ruppes, ruppey, rs, rs., ₹, amount
    // Support both formats: "20 rupees" and "₹20" or "rupees 20"
    const amountMatches = [];

    // Pattern 1: Number followed by rupee word/symbol (e.g., "20 rupees", "20 ₹")
    const amountPattern1 = /(\d+\.?\d*)\s*(rupey|rupeye|rupiya|rupiye|rupee|rupees|ruppes|ruppey|rs\.|rs|₹|amount|ki|ka|ke|ko)\b/gi;
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
    const amountPattern3 = /(rupey|rupeye|rupiya|rupiye|rupee|rupees|ruppes|ruppey|rs\.|rs|amount|ki|ka|ke|ko)\s*(\d+\.?\d*)/gi;
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

    // Pattern 4: Number followed by ki/ka/ke (e.g., "20 ki badam")
    const amountPattern4 = /(\d+\.?\d*)\s*(ki|ka|ke|ko)\b/gi;

    while ((amountMatch = amountPattern4.exec(normalizedText)) !== null) {
      const amount = parseFloat(amountMatch[1]);
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
        productNameText = productNameText.replace(/\b(rupey|rupee|rupees|ruppes|ruppey|rs\.|rs|amount|₹|ki|ka|ke|ko)\b/gi, '').trim();

        let productName = extractProductName(productNameText || segment);

        // If no product found backwards, look forwards (e.g., "20 ki badam")
        if (!productName || productName.length < 2) {
          const amtEnd = amountMatch.index + amountMatch.length;
          let forwardEnd = normalizedText.length;

          const nextAmt = amountMatches[idx + 1];
          if (nextAmt) forwardEnd = Math.min(forwardEnd, nextAmt.index);

          const nextQty = qtyUnitMatches.find(qty => qty.index >= amtEnd);
          if (nextQty) forwardEnd = Math.min(forwardEnd, nextQty.index);

          let forwardSegment = normalizedText.substring(amtEnd, forwardEnd).trim();
          const fWords = forwardSegment.split(/\s+/);
          if (fWords.length > 3) forwardSegment = fWords.slice(0, 3).join(' ');

          productName = extractProductName(forwardSegment);
        }

        // AGGRESSIVE FALLBACK: If still no product found, look through the WHOLE text for any product name
        // that hasn't been matched yet (Best for Hinglish like "sugar ₹20 ki")
        if (!productName || productName.length < 2) {
          const allPotentialProducts = state.products.filter(p =>
            normalizedText.includes(p.name.toLowerCase()) ||
            (p.name.toLowerCase().split(' ').some(word => word.length > 3 && normalizedText.includes(word)))
          );
          if (allPotentialProducts.length > 0) {
            // Pick most likely product (closest to the amount)
            allPotentialProducts.sort((a, b) => {
              const posA = normalizedText.indexOf(a.name.toLowerCase());
              const posB = normalizedText.indexOf(b.name.toLowerCase());
              return Math.abs(posA - amtStart) - Math.abs(posB - amtStart);
            });
            productName = allPotentialProducts[0].name;
          }
        }

        if (productName && productName.length > 0) {
          const product = findMatchingProduct(productName);
          if (product) {
            const productKey = product.id || product.name.toLowerCase();
            const productUnit = product.unit || product.quantityUnit || 'pcs';

            // Amount based check: pieces usually can't be calculated from amount
            const isDivisibleUnit = isUnitDivisible(productUnit);

            if (isDivisibleUnit) {
              const pricePerUnit = product.sellingPrice || product.sellingUnitPrice || product.costPrice || product.unitPrice || 0;

              if (pricePerUnit > 0) {
                const calculatedQuantity = amountMatch.amount / pricePerUnit;
                productMap.set(productKey, {
                  product,
                  quantity: calculatedQuantity,
                  unit: productUnit,
                  amount: amountMatch.amount,
                  isAmountBased: true
                });
              } else {
                // Price not set - add anyway as amount-based to prevent '1 pc' fallback
                productMap.set(productKey, {
                  product,
                  quantity: 0,
                  unit: productUnit,
                  amount: amountMatch.amount,
                  isAmountBased: true,
                  error: 'Price not set'
                });
                if (showToasts) {
                  const msg = `${product.name} price is not set. Please add price to calculate quantity.`;
                  showToast(msg, 'warning');
                  speakFeedback(msg);
                }
              }
            } else {
              const pricePerUnitNonDiv = product.sellingPrice || product.sellingUnitPrice || product.costPrice || product.unitPrice || 0;
              if (pricePerUnitNonDiv > 0) {
                const calculatedQuantity = amountMatch.amount / pricePerUnitNonDiv;
                productMap.set(productKey, {
                  product,
                  quantity: calculatedQuantity,
                  unit: productUnit,
                  amount: amountMatch.amount,
                  isAmountBased: true
                });
              } else {
                productMap.set(productKey, {
                  product,
                  quantity: 1,
                  unit: productUnit,
                  amount: amountMatch.amount,
                  isAmountBased: true,
                  warning: 'Price not set'
                });
                if (showToasts) {
                  const msg = `${product.name} price is not set. Adding 1 unit for ₹${amountMatch.amount}.`;
                  showToast(msg, 'warning');
                  speakFeedback(msg);
                }
              }
            }

            // Determine the full range to shield (from where the product name started to where it ended)
            let shieldStart = segmentStart;
            let shieldEnd = amountMatch.index + amountMatch.length;

            // If forward search was used, extend the shield
            const prodPos = normalizedText.indexOf(product ? product.name.toLowerCase() : productName.toLowerCase());
            if (prodPos !== -1) {
              shieldStart = Math.min(shieldStart, prodPos);
              shieldEnd = Math.max(shieldEnd, prodPos + (product ? product.name.length : productName.length));
            }

            shieldRange(shieldStart, shieldEnd);
          } else {
            if (showToasts) {
              const msg = `Sorry, I couldn't find ${productName} in your list.`;
              showToast(msg, 'error');
              speakFeedback(msg);
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

        if (productName && productName.length > 0) {
          const product = findMatchingProduct(productName);

          if (product) {
            const productKey = product.id || product.name.toLowerCase();
            const productUnit = product.unit || product.quantityUnit || 'pcs';

            // Check unit compatibility
            const compatibility = checkUnitCompatibility(qtyUnit.unit, productUnit);
            if (!compatibility.compatible) {
              if (showToasts) {
                const msg = state.currentLanguage === 'hi'
                  ? `गलत यूनिट! ${product.name} ${productUnit} में बिकता है, आपने ${qtyUnit.unit} कहा।`
                  : `Wrong unit! ${product.name} is sold in ${productUnit}, but you said ${qtyUnit.unit}.`;
                showToast(msg, 'warning');
                speakFeedback(msg);
              }
              return; // Skip adding if unit is totally wrong
            }

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
        .split(/[,;]| and | then | also | plus | aur | phir | next /i)
        .map(s => s.trim())
        .filter(s => {
          if (s.length === 0) return false;
          // Filter out segments that were already processed as amount/quantity
          const segmentIndex = normalizedText.indexOf(s);
          return !isShielded(segmentIndex + (s.length / 2));
        });

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
                const msg = `Sorry, I couldn't find ${productName} in your list.`;
                showToast(msg, 'error');
                speakFeedback(msg);
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

      if (showToasts) {
        showToast('No products detected. Please try again.', 'warning');
      }
      return;
    }

    console.log(`✅ [processVoiceInput] Found ${productMap.size} product(s) to add:`, Array.from(productMap.values()).map(({ product, quantity, unit }) => `${product.name} ${quantity}${unit}`));

    productMap.forEach(({ product, quantity, unit, amount, isAmountBased }) => {
      // Check if product already exists in cart (Robust matching: ID OR Name)
      const existingItemIndex = billItems.findIndex(item =>
        (product.id && item.id === product.id) ||
        (item.name.toLowerCase().trim() === product.name.toLowerCase().trim())
      );

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
      // Use Hindi recognition if app language is Hindi, otherwise use Indian English
      recognition.lang = state.currentLanguage === 'hi' ? 'hi-IN' : 'en-IN';

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
          const result = event.results[i][0];
          const transcript = result.transcript;

          // Only accept transcript if confidence is reasonable
          if (result.confidence < 0.2) continue;

          if (event.results[i].isFinal) {
            // Check for duplicate final transcript within the same segment
            if (!finalTranscript.toLowerCase().includes(transcript.toLowerCase())) {
              finalTranscript += transcript + ' ';
            }
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

              }
            }
          }, restartDelay);
        }
      };

      recognitionRef.current = recognition;

      try {
        recognition.start();
      } catch (e) {

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

    // SPECIAL HANDLING FOR D-PRODUCTS (Direct Products)
    if (existingItem.isDProduct) {
      setBillItems(prev => prev.map((item, idx) => {
        if (idx !== itemIndex) return item;

        // Current unit price (price field usually holds unit price in billing)
        // For D-Products, price is what was entered by user for 1 unit
        const unitPrice = existingItem.price || 0;
        const gstPercent = existingItem.gstPercent || 0;

        const newTotalSellingPrice = unitPrice * sanitizedQuantity;
        const newGstAmount = (newTotalSellingPrice * gstPercent) / 100;

        return {
          ...item,
          quantity: sanitizedQuantity,
          gstAmount: Math.floor(newGstAmount * 100) / 100,
          total: newTotalSellingPrice + newGstAmount,
          totalSellingPrice: newTotalSellingPrice,
          // Update originalQuantity for sync/PDF consistency
          originalQuantity: {
            ...item.originalQuantity,
            quantity: sanitizedQuantity
          }
        };
      }));
      return;
    }

    const product = state.products.find(p => p.id === productId);
    if (!product) {
      return;
    }

    // Check Wholesale MOQ if in wholesale mode
    if (saleMode === 'wholesale') {
      const moq = getEffectiveWholesaleMOQ(product);
      // Determine effective quantity in product units
      const productUnit = product.quantityUnit || product.unit || 'pcs';
      const prodUnitInBase = convertToBaseUnit(1, productUnit) || 1;
      const qtyInBase = convertToBaseUnit(sanitizedQuantity, existingItem.unit);
      const qtyInProductUnits = qtyInBase / prodUnitInBase;

      if (qtyInProductUnits < moq) {
        const msg = state.currentLanguage === 'hi'
          ? `थोक आदेश के लिए न्यूनतम मात्रा ${moq} ${productUnit} है`
          : `Minimum wholesale quantity is ${moq} ${productUnit}`;
        showToast(msg, 'warning');
        return;
      }
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

    // Check if order already exists to prevent duplicate finalization
    const existingOrder = state.orders.find(o => o.id === orderId);
    if (existingOrder) {

      finalizingOrders.current.delete(orderId);
      isGeneratingBill.current = false;
      return false;
    }

    // Check if stock was already deducted for this order (prevent duplicate deduction on refresh)
    if (order.stockDeducted === true) {

      // Still add the order to state, but skip stock deduction
      dispatch({ type: ActionTypes.ADD_ORDER, payload: order });
      finalizingOrders.current.delete(orderId);
      isGeneratingBill.current = false;
      return true;
    }

    // Check plan limit BEFORE finalizing order
    const activeOrders = state.orders.filter(order => !order.isDeleted);
    const totalOrders = activeOrders.length;
    const { maxOrders } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
    const canAdd = canAddOrder(totalOrders, state.aggregatedUsage, state.currentPlan, state.currentPlanDetails);

    if (!canAdd) {
      const orderLimitLabel = maxOrders === Infinity ? 'Unlimited' : maxOrders;
      const planNameLabel = state.currentPlanDetails?.planName
        || (state.currentPlan ? `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}` : 'Current');
      const limitMessage = `Your limit is full! You've reached the order limit (${orderLimitLabel}) for the ${planNameLabel} plan. Upgrade your plan to create more orders.`;

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

      finalizingOrders.current.delete(orderId);
      isGeneratingBill.current = false;
      return false;
    }

    // Handle customer creation/lookup BEFORE saving order to ensure valid customerId
    let finalCustomerId = order.customerId;

    const isSplitPayment = bill.paymentMethod === 'split' && bill.splitPaymentDetails;
    const splitDueAmount = isSplitPayment ? (bill.splitPaymentDetails.dueAmount || 0) : 0;
    const hasDueAmount = isDueLikePayment || (isSplitPayment && splitDueAmount > 0);

    // Handle customer creation/update logic
    if (customerName && customerName.trim() !== '' && customerName.trim().toLowerCase() !== 'walk-in customer') {
      const customerMobileNumber = sanitizedMobile;
      let customer = null;
      const currentCustomers = state.customers;

      // 1. Try to find by ID
      if (finalCustomerId) {
        customer = currentCustomers.find(c => c.id === finalCustomerId);
      }

      // 2. Try to find by Name + Mobile
      if (!customer && customerName && customerMobileNumber) {
        const normalizedCustomerName = customerName.trim().toLowerCase();
        customer = currentCustomers.find(c => {
          const existingName = (c.name || '').trim().toLowerCase();
          const existingMobile = sanitizeMobileNumber(c.mobileNumber || c.phone || '');
          const nameMatches = existingName === normalizedCustomerName;
          const mobileMatches = existingMobile && customerMobileNumber && existingMobile === customerMobileNumber;
          return nameMatches && mobileMatches;
        });
      }

      // 3. Check matchedDueCustomer
      if (!customer && matchedDueCustomer) {
        customer = matchedDueCustomer;
      }

      if (customer) {
        finalCustomerId = customer.id;
        // Update existing customer
        if (hasDueAmount) {
          const rawDueAmount = isSplitPayment ? splitDueAmount : bill.total;
          let creditUsed = 0;
          let netDueToAdd = rawDueAmount;

          // Automatic Credit Offset Logic
          const currentBalance = Number(customer.balanceDue || customer.dueAmount || 0);
          if (currentBalance < 0) {
            const creditAvailable = Math.abs(currentBalance);
            creditUsed = Math.min(creditAvailable, rawDueAmount);

            if (creditUsed > 0) {
              netDueToAdd = rawDueAmount - creditUsed;

              // Record credit usage transaction
              const creditUsageTx = {
                id: `txn-cr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                sellerId: order.sellerId,
                customerId: customer._id || customer.id,
                orderId: order.id,
                type: 'credit_usage',
                amount: creditUsed,
                date: new Date().toISOString(),
                description: `Credit Used for Order #${order.invoiceNumber || ''}`,
                previousBalance: currentBalance,
                currentBalance: currentBalance + creditUsed,
                isSynced: false,
                isDeleted: false,
                createdAt: new Date().toISOString(),
                userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
              };
              dispatch({ type: ActionTypes.ADD_CUSTOMER_TRANSACTION, payload: creditUsageTx });

              // Update order/bill objects to reflect credit usage
              if (order.paymentMethod === 'due' || order.paymentMethod === 'credit') {
                order.paymentMethod = 'split';
                order.splitPaymentDetails = {
                  type: 'credit_due',
                  cashAmount: 0,
                  onlineAmount: 0,
                  dueAmount: netDueToAdd,
                  creditAmount: creditUsed
                };
              } else if (order.paymentMethod === 'split' && order.splitPaymentDetails) {
                order.splitPaymentDetails.dueAmount = netDueToAdd;
                order.splitPaymentDetails.creditAmount = (order.splitPaymentDetails.creditAmount || 0) + creditUsed;
              }

              // Update bill object for components that use it (PDF, etc.)
              if (bill) {
                bill.paymentMethod = order.paymentMethod;
                bill.splitPaymentDetails = order.splitPaymentDetails;
              }

              if (netDueToAdd <= 0) {
                order.allPaymentClear = true;
                if (bill) bill.status = 'completed';
              }

              if (window.showToast) {
                window.showToast(
                  state.currentLanguage === 'hi'
                    ? `ग्राहक क्रेडिट से ₹${creditUsed.toFixed(2)} का उपयोग किया गया। शेष देय: ₹${netDueToAdd.toFixed(2)}`
                    : `Used ₹${creditUsed.toFixed(2)} from customer credit. Remaining due: ₹${netDueToAdd.toFixed(2)}`,
                  'info',
                  6000
                );
              }
            }
          }

          const updatedCustomer = {
            ...customer,
            balanceDue: (parseFloat(customer.balanceDue || customer.dueAmount || 0) + Number(rawDueAmount)),
            dueAmount: (parseFloat(customer.dueAmount || customer.balanceDue || 0) + Number(rawDueAmount))
          };
          // Ensure we don't have NaNs
          if (isNaN(updatedCustomer.balanceDue)) updatedCustomer.balanceDue = Number(rawDueAmount);
          if (isNaN(updatedCustomer.dueAmount)) updatedCustomer.dueAmount = Number(rawDueAmount);

          dispatch({ type: ActionTypes.UPDATE_CUSTOMER, payload: updatedCustomer });

          // Create Customer Transaction for remaining due amount (if any)
          if (netDueToAdd > 0) {
            const transaction = {
              id: `txn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
              sellerId: order.sellerId,
              customerId: customer._id || customer.id,
              orderId: order.id,
              type: 'due',
              amount: netDueToAdd,
              date: new Date().toISOString(),
              description: creditUsed > 0 ? `Order #${order.invoiceNumber || ''} - Remaining Due` : `Order #${order.invoiceNumber || ''} - Due Amount`,
              previousBalance: creditUsed > 0 ? (currentBalance + creditUsed) : currentBalance,
              currentBalance: (creditUsed > 0 ? (currentBalance + creditUsed) : currentBalance) + netDueToAdd,
              isSynced: false,
              isDeleted: false,
              createdAt: new Date().toISOString(),
              userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
            };
            dispatch({ type: ActionTypes.ADD_CUSTOMER_TRANSACTION, payload: transaction });
          }
        } else {
          const updatedCustomer = {
            ...customer,
            name: customerName.trim(),
            mobileNumber: customerMobileNumber || customer.mobileNumber || '',
            phone: customerMobileNumber || customer.phone || ''
          };
          if (updatedCustomer.name !== customer.name ||
            updatedCustomer.mobileNumber !== (customer.mobileNumber || customer.phone)) {
            dispatch({ type: ActionTypes.UPDATE_CUSTOMER, payload: updatedCustomer });
          }
        }
      } else {
        // Check if we should skip creation (cash/upi without mobile)
        const isMobileOptionalMode = (bill.paymentMethod === 'cash' || bill.paymentMethod === 'upi');
        if (isMobileOptionalMode && !customerMobileNumber) {
          // User requested: don't create customer if no mobile in cash/online mode
          finalCustomerId = null;
        } else {
          // Create new customer
          if (customerLimitReached) {
            showCustomerLimitWarning();
            isGeneratingBill.current = false;
            return false;
          }

          const newId = `tr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const newCustomer = {
            id: newId,
            localId: newId,
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
          finalCustomerId = newId;

          // Create Opening Balance Transaction (Always 0 for billing-created customers to mark start of history)
          const openingTransaction = {
            id: `txn-ob-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            sellerId: order.sellerId,
            customerId: newId,
            type: 'opening_balance',
            amount: 0,
            date: new Date().toISOString(),
            description: 'Opening Balance',
            previousBalance: 0,
            currentBalance: 0,
            isSynced: false,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
          };
          dispatch({ type: ActionTypes.ADD_CUSTOMER_TRANSACTION, payload: openingTransaction });

          // Create Customer Transaction for due amount (new customer)
          const newCustomerDue = hasDueAmount ? (isSplitPayment ? splitDueAmount : bill.total) : 0;
          if (newCustomerDue > 0) {
            const transaction = {
              id: `txn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
              sellerId: order.sellerId,
              customerId: newId,
              orderId: order.id,
              type: 'due',
              amount: newCustomerDue,
              date: new Date().toISOString(),
              description: `Order #${order.invoiceNumber || ''} - Due Amount (New Customer)`,
              previousBalance: 0,
              currentBalance: newCustomerDue,
              isSynced: false,
              isDeleted: false,
              createdAt: new Date().toISOString(),
              userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
            };
            dispatch({ type: ActionTypes.ADD_CUSTOMER_TRANSACTION, payload: transaction });
          }
        }
      }
    }

    // Dispatch ADD_ORDER with the resolved customerId
    const orderWithStockFlag = {
      ...order,
      customerId: finalCustomerId, // Ensure we use the resolved ID
      stockDeducted: false,
      dueAdded: hasDueAmount
    };

    dispatch({ type: ActionTypes.ADD_ORDER, payload: orderWithStockFlag });

    // REFRESH UI: Update product quantities in state shortly after order creation
    // Increased delay to 500ms to ensure updateInventoryAfterSale has completed in the background
    setTimeout(async () => {
      try {

        const { getAllItems } = require('../../utils/indexedDB');
        const { STORES } = require('../../utils/indexedDB');
        const [updatedProducts, updatedProductBatches] = await Promise.all([
          getAllItems(STORES.products),
          getAllItems(STORES.productBatches)
        ]);

        const activeProducts = updatedProducts.filter(i => i.isDeleted !== true);
        const activeBatches = updatedProductBatches.filter(i => i.isDeleted !== true);
        const normalizedBatches = activeBatches.map(batch => normalizeProductBatch(batch));

        // Associate batches with products (simplified version)
        const batchMap = {};
        normalizedBatches.forEach(batch => {
          const productId = batch.productId;
          if (!batchMap[productId]) {
            batchMap[productId] = [];
          }
          batchMap[productId].push(batch);
        });

        const productsWithBatches = activeProducts.map(product => {
          const productId = product._id || product.id;
          let productBatches = batchMap[productId] || [];
          return {
            ...product,
            batches: productBatches
          };
        });

        // Update state with refreshed data
        dispatch({ type: ActionTypes.SET_PRODUCTS, payload: productsWithBatches });
        dispatch({ type: ActionTypes.SET_PRODUCT_BATCHES, payload: normalizedBatches });

      } catch (error) {
        console.error('Error refreshing products after order:', error);
      }
    }, 500); // Increased from 200ms to ensure DB writes are done

    // Use debounced sync instead of manual instant sync
    syncService.scheduleSync();

    // Customer creation/update handled above before order dispatch

    dispatch({
      type: 'ADD_ACTIVITY',
      payload: {
        id: `tr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

          // Only use fallback if absolutely necessary
          console.warn('Using Web Audio API fallback (lower quality)');
          playRegisterFallbackSound();
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

    // Store the created order for bill generation
    lastCreatedOrder.current = order;

    // Remove order from finalizing set after a delay to allow state updates
    setTimeout(() => {
      finalizingOrders.current.delete(orderId);

    }, 1000);

    return true;
  };

  const customerNameProvided = useCustomName
    ? (customCustomerName || '').trim()
    : (state.customers.find(c => c.id === selectedCustomer)?.name || selectedCustomer || '').toString().trim();

  const handleQuickPayClick = () => {
    if (billItems.length === 0) {
      showToast(getTranslation('pleaseAddItems', state.currentLanguage), 'warning');
      return;
    }

    // Generate bill directly for walk-in customer with default values
    const quickPayData = {
      useCustomName: true,
      customCustomerName: 'Walk-in Customer',
      selectedCustomer: null,
      billingMobile: '',
      paymentMethod: 'cash',
      sendWhatsAppInvoice: false,
      splitPaymentDetails: null
    };

    generateBill(quickPayData);
  };



  const handleAddDProduct = () => {
    if (!dProductInput.trim()) {
      showToast('Please enter Code and Amount (e.g. SH400)', 'warning');
      return;
    }

    const input = dProductInput.trim();

    // Find the matching D-Product by checking which pCode is at the start of the input
    // Sort by length descending to match the longest prefix first
    const sortedDProducts = [...(state.dProducts || [])]
      .sort((a, b) => (b.pCode || '').length - (a.pCode || '').length);

    let dProduct = null;
    let amountStr = '';

    for (const p of sortedDProducts) {
      const code = (p.pCode || '').trim();
      if (!code) continue;

      if (input.toLowerCase().startsWith(code.toLowerCase())) {
        dProduct = p;
        amountStr = input.substring(code.length);
        break;
      }
    }

    if (!dProduct) {
      // Fallback: If no code matches exactly, try to split at the first digit
      const digitMatch = input.match(/\d/);
      if (digitMatch) {
        const splitIndex = digitMatch.index;
        const potentialCode = input.substring(0, splitIndex).trim();
        const potentialAmount = input.substring(splitIndex).trim();

        const fallbackProduct = state.dProducts?.find(p => p.pCode.toLowerCase() === potentialCode.toLowerCase());
        if (fallbackProduct) {
          dProduct = fallbackProduct;
          amountStr = potentialAmount;
        }
      }
    }

    if (!dProduct) {
      showToast('D-Product not found with this code', 'error');
      return;
    }

    const price = parseFloat(amountStr);
    if (!amountStr || isNaN(price) || price <= 0) {
      showToast(`Please enter a valid amount for ${dProduct.productName}`, 'warning');
      return;
    }

    // Calculate tax
    const gstAmount = (price * (dProduct.taxPercentage || 0)) / 100;

    // Create unique ID to allow multiple of same service
    const uniqueId = `d_${dProduct.id}_${Date.now()}`;

    const newItem = {
      id: uniqueId,
      productId: dProduct.id,
      name: dProduct.productName,
      price: price, // Base price
      quantity: 1,
      unit: dProduct.unit,
      gstPercent: dProduct.taxPercentage || 0,
      gstAmount: gstAmount,
      total: price + gstAmount,
      isDProduct: true,
      // Add standard fields expected by billing logic
      quantityUnit: dProduct.unit,
      totalSellingPrice: price,
      originalQuantity: { quantity: 1, unit: dProduct.unit }
    };

    setBillItems(prev => [newItem, ...prev]);
    setDProductInput('');
    showToast(`${dProduct.productName} added`, 'success');
  };

  const handleGenerateBillClick = () => {
    if (billItems.length === 0) {
      showToast(getTranslation('pleaseAddItems', state.currentLanguage), 'warning');
      return;
    }

    // Check if plan is expired before allowing checkout
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to continue creating orders.', 'warning', 8000);
      }
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

    // Use modalData if provided (to avoid async state issues), otherwise use state
    const effectiveUseCustomName = modalData ? modalData.useCustomName : useCustomName;
    const effectiveCustomCustomerName = modalData ? modalData.customCustomerName : customCustomerName;
    const effectiveSelectedCustomer = modalData ? modalData.selectedCustomer : selectedCustomer;
    const effectivePaymentMethod = modalData ? modalData.paymentMethod : paymentMethod;
    const effectiveSplitPaymentDetails = modalData ? modalData.splitPaymentDetails : splitPaymentDetails;
    const effectiveBillingMobile = modalData ? modalData.billingMobile : billingMobile;
    const effectiveSendWhatsAppInvoice = modalData ? modalData.sendWhatsAppInvoice : sendWhatsAppInvoice;

    // Calculate effective customerNameProvided using local values
    const effectiveCustomerNameProvided = effectiveUseCustomName
      ? (effectiveCustomCustomerName || '').trim() !== ''
      : (state.customers.find(c => c.id === effectiveSelectedCustomer)?.name || effectiveSelectedCustomer || '').toString().trim() !== '';

    if (effectiveBillingMobile && !isBillingMobileValid) {
      showToast(
        state.currentLanguage === 'hi'
          ? 'कृपया सही मोबाइल नंबर दर्ज करें (10 अंक, 6-9 से शुरू)।'
          : 'Please enter a valid 10-digit mobile number starting with 6-9.',
        'error'
      );
      isGeneratingBill.current = false;
      return;
    }

    const isMobileOptional = (effectivePaymentMethod === 'cash' || effectivePaymentMethod === 'upi') && !effectiveSendWhatsAppInvoice;

    if (
      effectiveCustomerNameProvided &&
      !isMobileOptional &&
      (!effectiveBillingMobile || !isValidMobileNumber(sanitizeMobileNumber(effectiveBillingMobile)))
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
      if (billItem.isDProduct) continue; // Skip stock validation for direct products

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

    // Validate customer name - prioritize customCustomerName if it exists
    let customerName = '';

    if (effectiveCustomCustomerName && effectiveCustomCustomerName.trim()) {
      // Prioritize customCustomerName if it exists (even if useCustomName is false, it might have been set when selecting existing customer)
      customerName = effectiveCustomCustomerName.trim();
    } else if (effectiveUseCustomName) {
      customerName = (effectiveCustomCustomerName || '').trim();
    } else {
      // Try to find customer by name or ID - make lookup more robust
      // More robust customer lookup - trim and case-insensitive name matching
      const trimmedSelected = effectiveSelectedCustomer?.trim();
      const foundCustomer = state.customers.find(c => {
        const customerNameTrimmed = c.name?.trim();
        const customerId = c.id;
        return customerId === trimmedSelected ||
          customerNameTrimmed === trimmedSelected ||
          customerNameTrimmed?.toLowerCase() === trimmedSelected?.toLowerCase();
      });

      if (foundCustomer) {
        customerName = foundCustomer.name.trim();
      } else {
        customerName = (effectiveSelectedCustomer || '').trim();
      }
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
        showToast(getTranslation('enterValidMobileWhatsApp', state.currentLanguage), 'error');
        isGeneratingBill.current = false;
        return;
      }
    }

    // Validate customer name and mobile number for due payment method or split payment with due
    const isSplitWithDue = effectivePaymentMethod === 'split' && effectiveSplitPaymentDetails && effectiveSplitPaymentDetails.dueAmount > 0;
    if (effectivePaymentMethod === 'due' || effectivePaymentMethod === 'credit' || isSplitWithDue) {
      if (!sanitizedMobile) {
        showToast(getTranslation('mobileRequiredDue', state.currentLanguage), 'error');
        isGeneratingBill.current = false;
        return;
      }

      const mobileRegex = /^[6-9]\d{9}$/; // Indian mobile number format
      if (!mobileRegex.test(sanitizedMobile)) {
        showToast(getTranslation('enterValidMobile', state.currentLanguage), 'error');
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
      showToast(getTranslation('sellerAuthError', state.currentLanguage), 'error');
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

    // NOTE: Customer creation is now handled BEFORE order creation (for new customers)
    // This ensures order has a valid customerId. finalizeOrder will now UPDATE this customer instead of creating a new one.

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

      const isDProduct = billItem.isDProduct === true;

      return {
        productId: isDProduct ? null : (product?._id || billItem.productId || null),
        dProductId: isDProduct ? (billItem.productId || null) : null,
        isDProduct: isDProduct,
        productLocalId: isDProduct ? (billItem.productId || null) : (billItem.productLocalId || product?.localId || null),
        name: billItem.name || product?.name || '',
        sellingPrice: roundedTotalSelling,
        costPrice: roundedTotalCost,
        quantity: roundedQuantity,
        unit: productUnit,
        totalSellingPrice: roundedTotalSelling,
        totalCostPrice: roundedTotalCost,
        unitSellingPrice,
        unitCostPrice,
        hsnCode: billItem.hsnCode || '',
        gstPercent: billItem.gstPercent || 0,
        gstAmount: Math.floor((billItem.gstAmount || 0) * 100) / 100,
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
    const totalGst = Math.floor(billItems.reduce((sum, item) => sum + (item.gstAmount || 0), 0) * 100) / 100;


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

    }

    // Generate invoice number
    const generatedInvoiceNumber = `INV-${nanoid(8)}`;

    // Create Order object matching MongoDB Order schema
    const order = {
      id: `ord-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
      totalGstAmount: totalGst,
      invoiceNumber: generatedInvoiceNumber, // Include generated invoice number
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSynced: false,
      stockDeducted: false, // Flag to track if stock has been deducted for this order
      allPaymentClear: (effectivePaymentMethod !== 'due' && effectivePaymentMethod !== 'credit' && !isSplitWithDue)
    };

    console.log('🎯 Full Order (MongoDB schema):', order);

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
      totalGstAmount: totalGst,
      total: order.totalAmount,
      paymentMethod: order.paymentMethod,
      splitPaymentDetails: splitDetails,
      customerMobile: sanitizedMobile || effectiveMobile,
      date: order.createdAt,
      status: (effectivePaymentMethod === 'upi' || (isSplitPayment && splitDetails && splitDetails.onlineAmount > 0)) ? 'pending' : 'completed',
      storeName: state.storeName || 'Grocery Store',
      upiId: sellerUpiId, // Always include seller UPI ID in bill object
      invoiceNumber: order.invoiceNumber // Include invoice number for sharing
    };

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

      if (!sellerUpiId) {
        showToast(getTranslation('addBusinessUpi', state.currentLanguage), 'error');
        isGeneratingBill.current = false;
        return;
      }

      if (pendingOrder) {
        showToast(getTranslation('completePendingPayment', state.currentLanguage), 'warning');
        isGeneratingBill.current = false;
        return;
      }

      const billForModal = { ...bill, upiId: sellerUpiId, splitPaymentDetails: splitDetails };

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

      const success = finalizeOrder(finalizePayload);

      if (success) {
        const successMessage = `${getTranslation('billGeneratedSuccessfully', state.currentLanguage)}! ${getTranslation('customers', state.currentLanguage)}: ${bill.customerName}, ${getTranslation('total', state.currentLanguage)}: ₹${bill.total.toFixed(2)}`;
        showToast(successMessage, 'success');

        // Automatically download the bill after successful order generation
        setTimeout(() => {
          downloadBill();
        }, 500); // Small delay to ensure order is fully processed
      }
      return;
    }

    if (effectivePaymentMethod === 'upi') {
      if (!sellerUpiId) {
        showToast(getTranslation('addBusinessUpi', state.currentLanguage), 'error');
        isGeneratingBill.current = false;
        return;
      }

      if (pendingOrder) {
        showToast(getTranslation('completePendingPayment', state.currentLanguage), 'warning');
        isGeneratingBill.current = false;
        return;
      }

      const billForModal = { ...bill, upiId: sellerUpiId };

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

      // Automatically download the bill after successful order generation
      setTimeout(() => {
        downloadBill();
      }, 500); // Small delay to ensure order is fully processed
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
      showToast(getTranslation('noPendingPayment', state.currentLanguage), 'warning');
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

        showToast('Order already processed.', 'warning');
        setPendingOrder(null);
        setShowUPIPayment(false);
        setCurrentBill(null);
        isGeneratingBill.current = false;
        return;
      }
    }

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

            // Only use fallback if absolutely necessary
            console.warn('Using Web Audio API fallback (lower quality)');
            playRegisterFallbackSound();
          });
      };

      playCashRegisterSound();

      dispatch({
        type: 'ADD_ACTIVITY',
        payload: {
          id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          message: `Online payment (UPI) received for Bill #${pendingOrder.bill.id} - ₹${pendingOrder.bill.total.toFixed(2)}${paymentSummary?.transactionId ? ` (Txn: ${paymentSummary.transactionId})` : ''}`,
          timestamp: new Date().toISOString(),
          type: 'payment_received'
        }
      });
      showToast(`Payment of ₹${pendingOrder.bill.total.toFixed(2)} received successfully!`, 'success');

      // Automatically download the bill after successful UPI payment and order finalization
      setTimeout(() => {
        downloadBill();
      }, 500); // Small delay to ensure order is fully processed

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

  const printPDF = (pdf, fileName) => {
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);

    // Cleanup function
    const cleanup = () => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    };

    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow.print();
          // We can't easily detect when printing is done, so we wait a bit before cleanup
          setTimeout(cleanup, 10000);
        } catch (error) {
          console.error('Print failed:', error);
          cleanup();
          // Removed automatic download fallback per user request
          if (window.showToast) {
            window.showToast('Printing failed. Please check your printer connection.', 'error');
          }
        }
      }, 500);
    };
  };

  const handlePDFOutput = async (pdf, fileName) => {
    // Add watermark
    const sellerLogo = state.currentUser?.logoUrl || state.storeLogo || (sellerSettings?.billSettings?.logoUrl);
    await addWatermarkToPDF(pdf, sellerLogo || undefined);

    if (isDirectPrintRef.current) {
      printPDF(pdf, fileName);
    }
    // No automatic download here per user request
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

      showToast('Error generating QR code', 'error');
    }
  };

  const safeDrawText = (doc, text, x, y, options = {}) => {
    if (!text) return;
    let displayText = text.toString();
    const maxWidth = options.maxWidth || 0;

    if (maxWidth > 0) {
      const currentFont = doc.getFont().fontName;
      const currentSize = doc.getFontSize();
      doc.setFont(options.font || 'helvetica', options.fontStyle || 'normal');
      doc.setFontSize(options.fontSize || 10);

      if (doc.getTextWidth(displayText) > maxWidth) {
        while (displayText.length > 0 && doc.getTextWidth(displayText + '...') > maxWidth) {
          displayText = displayText.slice(0, -1);
        }
        displayText += '...';
      }
      doc.setFont(currentFont);
      doc.setFontSize(currentSize);
    }

    const isHindi = /[\u0900-\u097F\u20B9]/.test(displayText);
    if (isHindi) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const fontSize = options.fontSize || 10;
      ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
      const metrics = ctx.measureText(displayText);
      canvas.width = metrics.width * 2;
      canvas.height = fontSize * 2.5;
      ctx.scale(2, 2);
      ctx.fillStyle = options.color || '#000000';
      ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
      ctx.fillText(displayText, 0, fontSize);
      const dataUrl = canvas.toDataURL('image/png');
      const w = metrics.width / 3.78;
      const h = fontSize * 1.5 / 3.78;
      let drawX = x;
      if (options.align === 'right') drawX -= w;
      else if (options.align === 'center') drawX -= w / 2;
      doc.addImage(dataUrl, 'PNG', drawX, y - (fontSize / 2.5), w, h);
    } else {
      doc.text(displayText, x, y, options);
    }
  };

  const generateAndDownloadPDF = async (bill) => {
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Retrieve branding from settings
      const settings = sellerSettings?.billSettings || {};
      const accentHex = settings.colors?.accent || '#2f3c7e';

      const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [
          parseInt(result[1], 16),
          parseInt(result[2], 16),
          parseInt(result[3], 16)
        ] : [47, 60, 126];
      };

      const COLORS = {
        accent: hexToRgb(accentHex),
        text: [30, 41, 59],
        slate400: [148, 163, 184],
        slate50: [248, 250, 252],
        border: [241, 245, 249],
        white: [255, 255, 255]
      };

      const margin = 15;
      let y = 10;


      // 1. Branding Accent
      pdf.setFillColor(...COLORS.accent);
      pdf.rect(0, 0, pageWidth, 2, 'F');
      y += 15;

      // 2. Header
      let logoOffset = 0;
      const logoShow = settings.showLogo !== undefined ? settings.showLogo : (settings.header?.showLogo ?? true);
      if (logoShow) {
        try {
          const publicUrl = process.env.PUBLIC_URL || '';
          const defaultLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
          const sellerLogo = state.currentUser?.logoUrl || state.storeLogo || settings.logoUrl;
          const logoUrl = sellerLogo || defaultLogo;

          const res = await fetch(logoUrl).catch(() => null);
          if (res && res.ok) {
            const blob = await res.blob();
            const base64 = await new Promise(r => {
              const reader = new FileReader();
              reader.onloadend = () => r(reader.result);
              reader.readAsDataURL(blob);
            });
            pdf.addImage(base64, 'PNG', margin, y, 16, 16);
            logoOffset = 20;
          } else if (logoUrl !== defaultLogo) {
            // If seller logo fails, try default logo
            const defaultRes = await fetch(defaultLogo).catch(() => null);
            if (defaultRes && defaultRes.ok) {
              const blob = await defaultRes.blob();
              const base64 = await new Promise(r => {
                const reader = new FileReader();
                reader.onloadend = () => r(reader.result);
                reader.readAsDataURL(blob);
              });
              pdf.addImage(base64, 'PNG', margin, y, 16, 16);
              logoOffset = 20;
            }
          }
        } catch (e) {
          console.error("Logo generation error:", e);
        }
      }

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.setTextColor(...COLORS.accent);
      const storeName = state.storeName || state.currentUser?.shopName || 'Grocery Store';
      safeDrawText(pdf, storeName.toUpperCase(), margin + logoOffset, y + 6, { fontSize: 22, color: `rgb(${COLORS.accent.join(',')})` });

      pdf.setFontSize(8);
      pdf.setTextColor(...COLORS.slate400);
      pdf.text('PREMIUM RETAIL PARTNER', margin + logoOffset, y + 11);

      pdf.setFillColor(...COLORS.slate50);
      pdf.roundedRect(pageWidth - margin - 45, y, 45, 10, 2, 2, 'F');
      pdf.setFontSize(13);
      pdf.setTextColor(...COLORS.text);
      pdf.text('TAX INVOICE', pageWidth - margin - 22.5, y + 6.5, { align: 'center' });

      y += 20;

      const addressShow = settings.showAddress !== undefined ? settings.showAddress : (settings.header?.showAddress ?? true);
      if (addressShow) {
        pdf.setDrawColor(...COLORS.accent);
        pdf.setLineWidth(0.5);
        pdf.line(margin, y, margin, y + 15);
        pdf.setFontSize(9);
        pdf.setTextColor(71, 85, 105);

        const mainAddr = state.currentUser?.shopAddress || state.storeAddress || '123, Central Plaza, Main Market';
        pdf.text(mainAddr, margin + 4, y + 3);

        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(100, 116, 139);
        const addr2 = [
          state.currentUser?.city || state.storeCity,
          state.currentUser?.state || state.storeState,
          state.currentUser?.pincode || state.storePincode
        ].filter(Boolean).join(' - ') || 'Metropolis City - 400001';
        pdf.text(addr2, margin + 4, y + 7);

        pdf.text(`Phone: ${state.currentUser?.phoneNumber || state.storePhone || '+91 98765 43210'}`, margin + 4, y + 11);

        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...COLORS.text);
        pdf.text(`GSTIN: ${state.currentUser?.gstNumber || state.storeGstin || '27ABCDE1234F1Z5'}`, margin + 4, y + 15);
      }

      pdf.setFontSize(9);
      pdf.setTextColor(...COLORS.slate400);
      pdf.text('Invoice No', pageWidth - margin - 35, y + 15, { align: 'right' });
      pdf.text('Date', pageWidth - margin - 35, y + 20, { align: 'right' });
      pdf.text('Payment', pageWidth - margin - 35, y + 25, { align: 'right' });

      pdf.setTextColor(...COLORS.text);
      pdf.text(bill.id || `INV-${Date.now()}`, pageWidth - margin, y + 15, { align: 'right' });
      pdf.text(formatDate(bill.date), pageWidth - margin, y + 20, { align: 'right' });
      pdf.text('PAID', pageWidth - margin, y + 25, { align: 'right' });

      y += 35;

      // 3. Bill To
      pdf.setDrawColor(...COLORS.border);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 6;
      pdf.setFontSize(8);
      pdf.setTextColor(...COLORS.slate400);
      pdf.text('BILL TO', margin, y);
      pdf.text('PLACE OF SUPPLY', pageWidth - margin, y, { align: 'right' });
      y += 5;
      pdf.setFontSize(10);
      pdf.setTextColor(...COLORS.text);
      safeDrawText(pdf, bill.customerName.toUpperCase(), margin, y, { fontSize: 10 });
      pdf.text('LOCAL (WITHIN STATE)', pageWidth - margin, y, { align: 'right' });
      y += 8;
      pdf.line(margin, y, pageWidth - margin, y);
      y += 10;

      // 4. Table
      pdf.setFillColor(...COLORS.accent);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, 10, 2, 2, 'F');
      pdf.setFontSize(9);
      pdf.setTextColor(...COLORS.white);
      pdf.text('#', margin + 4, y + 6.5);
      pdf.text('ITEM DESCRIPTION', margin + 12, y + 6.5);
      pdf.text('QTY', margin + 100, y + 6.5, { align: 'center' });
      pdf.text('RATE', margin + 130, y + 6.5, { align: 'right' });
      pdf.text('GST %', margin + 155, y + 6.5, { align: 'right' });
      pdf.text('AMOUNT', pageWidth - margin - 4, y + 6.5, { align: 'right' });
      y += 10;

      bill.items.forEach((item, idx) => {
        const maxWidth = 75;
        const fontSize = 9;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(fontSize);

        // Check for Hindi to use safeDrawText (truncation fallback for complex scripts)
        // Otherwise use splitTextToSize for wrapping
        const isHindi = /[\u0900-\u097F\u20B9]/.test(item.name);
        let nameLines = [];
        if (!isHindi) {
          nameLines = pdf.splitTextToSize(item.name || '', maxWidth);
        }

        const lineHeight = 4;
        // If Hindi, we currently treat as 1 line (unsafe to wrap blindly without canvas support)
        const nameHeight = isHindi ? lineHeight : (nameLines.length * lineHeight);

        // Base row height 12, add extra height if multiple lines
        const baseRowH = 12;
        const extraH = Math.max(0, nameHeight - lineHeight); // 4 is approx height of 1 line text
        const rowH = baseRowH + extraH;

        if (y + rowH > pageHeight - 60) { pdf.addPage(); y = 20; }
        if (idx % 2 === 1) { pdf.setFillColor(...COLORS.slate50); pdf.rect(margin, y, pageWidth - margin * 2, rowH, 'F'); }

        pdf.setTextColor(...COLORS.slate400);
        pdf.text(String(idx + 1), margin + 4, y + 7.5);

        pdf.setTextColor(...COLORS.text);
        pdf.setFont('helvetica', 'bold');

        if (isHindi) {
          safeDrawText(pdf, item.name, margin + 12, y + 6, { fontSize: 9, maxWidth: 75 });
        } else {
          pdf.text(nameLines, margin + 12, y + 6);
        }

        pdf.setFontSize(7);
        pdf.setTextColor(...COLORS.slate400);
        pdf.setFont('helvetica', 'normal');
        // Position HSN below the name
        const hsnY = y + 6 + nameHeight;
        pdf.text(`HSN: ${item.hsnCode || '1001'} • CGST+SGST`, margin + 12, hsnY);

        pdf.setFontSize(9);
        pdf.setTextColor(...COLORS.text);
        pdf.text(item.displayQuantity || `${item.quantity} ${item.unit || 'pcs'}`, margin + 100, y + 7.5, { align: 'center' });
        pdf.text(item.price.toFixed(2), margin + 130, y + 7.5, { align: 'right' });
        pdf.text(`${item.gstPercent || 0}%`, margin + 155, y + 7.5, { align: 'right' });
        pdf.text(getItemTotalAmount(item).toFixed(2), pageWidth - margin - 4, y + 7.5, { align: 'right' });
        y += rowH;
      });

      // 5. Totals & Footer
      y += 10;
      pdf.setDrawColor(...COLORS.border);
      pdf.setLineWidth(0.5);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 10;

      // Calculate accurate totals
      let totalTaxable = 0;
      let totalGst = 0;
      bill.items.forEach(item => {
        const qty = Number(item.quantity) || 0;
        const rate = Number(item.price) || 0;
        const gst = Number(item.gstPercent) || 0;
        const isInclusive = item.isGstInclusive !== false;

        let taxable, lineGst;
        if (isInclusive) {
          taxable = (rate / (1 + gst / 100)) * qty;
          lineGst = (rate - (rate / (1 + gst / 100))) * qty;
        } else {
          taxable = rate * qty;
          lineGst = taxable * (gst / 100);
        }
        totalTaxable += taxable;
        totalGst += lineGst;
      });
      const grandTotal = totalTaxable + totalGst;

      const footerY = y;

      // Left Side: Terms & QR
      const leftColW = 100;
      if (settings.footer?.showTerms) {
        pdf.setFontSize(8);
        pdf.setTextColor(...COLORS.slate400);
        pdf.setFont('helvetica', 'bold');
        pdf.text('TERMS & CONDITIONS', margin, y);
        y += 4;

        pdf.setFillColor(...COLORS.slate50);
        pdf.setFillColor(...COLORS.slate50);
        pdf.setDrawColor(...COLORS.border);
        const terms = settings.footer?.terms || "1. Goods once sold will not be taken back.\n2. Subject to local jurisdiction.";
        const termsLines = pdf.splitTextToSize(terms, leftColW - 10);
        const termsH = (termsLines.length * 4) + 8;
        pdf.roundedRect(margin, y, leftColW, termsH, 3, 3, 'FD');

        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(7);
        pdf.setTextColor(100, 116, 139);
        pdf.text(termsLines, margin + 5, y + 5);
        y += termsH + 10;
      }

      // QR Code
      const sellerUpiIdValue = billSettings?.upiId || state.currentUser?.upiId || state.upiId;

      try {
        let qrData = '';
        let label = 'SCAN TO VERIFY\nDIGITAL INVOICE';

        if (state.currentUser?.upiId || state.upiId || billSettings?.upiId) {
          // Priority: Payment QR
          const upiId = state.currentUser?.upiId || state.upiId || billSettings?.upiId;
          if (grandTotal > 0 && upiId && upiId.includes('@')) {
            qrData = `upi://pay?pa=${upiId}&am=${grandTotal.toFixed(2)}&cu=INR&tn=Bill%20Payment`;
            label = 'SCAN AND PAY';
          }
        }

        if (!qrData) {
          // Fallback: Verification QR (if no UPI ID)
          qrData = JSON.stringify({
            id: bill.id,
            total: grandTotal.toFixed(2),
            date: bill.date,
            store: state.storeName || 'Grocery Store'
          });
        }

        const qrBase64 = await QRCode.toDataURL(qrData, { margin: 1, width: 100 });
        pdf.addImage(qrBase64, 'PNG', margin, y, 20, 20);
        pdf.setFontSize(7);
        pdf.setTextColor(...COLORS.slate400);
        pdf.setFont('helvetica', 'bold');
        pdf.text(label, margin + 25, y + 8);
      } catch (qrErr) {
        console.error("QR Generation failed", qrErr);
      }

      // Right Side: Totals & Signatory
      y = footerY;
      const rightColX = pageWidth - margin - 60;
      const valX = pageWidth - margin;

      pdf.setFontSize(9);
      pdf.setTextColor(...COLORS.slate400);
      pdf.setFont('helvetica', 'bold');
      pdf.text('SUB TOTAL', rightColX, y);
      pdf.setTextColor(...COLORS.text);
      pdf.text(`Rs. ${totalTaxable.toFixed(2)}`, valX, y, { align: 'right' });

      y += 6;
      pdf.setTextColor(...COLORS.slate400);
      pdf.text('TAX (GST)', rightColX, y);
      pdf.setTextColor(...COLORS.text);
      pdf.text(`Rs. ${totalGst.toFixed(2)}`, valX, y, { align: 'right' });

      y += 10;
      pdf.setDrawColor(30, 41, 59);
      pdf.setLineWidth(0.8);
      pdf.line(rightColX, y - 4, valX, y - 4);

      pdf.setFontSize(13);
      pdf.setTextColor(30, 41, 59); // Dark blue/black for grand total
      pdf.text('GRAND TOTAL', rightColX, y + 4);
      pdf.setTextColor(...COLORS.accent);
      pdf.text(`Rs. ${Math.round(grandTotal).toFixed(2)}`, valX, y + 4, { align: 'right' });

      // Signatory
      y += 30;
      pdf.setDrawColor(...COLORS.border);
      pdf.setLineWidth(0.2);
      pdf.setLineDashPattern([1, 1], 0);
      pdf.line(valX - 50, y, valX, y);
      pdf.setLineDashPattern([], 0);

      pdf.setFontSize(8);
      pdf.setTextColor(...COLORS.text);
      pdf.setFont('helvetica', 'bold');
      pdf.text('AUTHORIZED SIGNATORY', valX - 25, y + 5, { align: 'center' });

      // 6. Powered By Branding
      try {
        const publicUrl = process.env.PUBLIC_URL || '';
        const gsLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
        const gsLogoRes = await fetch(gsLogo).catch(() => null);
        if (gsLogoRes && gsLogoRes.ok) {
          const blob = await gsLogoRes.blob();
          const base64 = await new Promise(r => {
            const reader = new FileReader();
            reader.onloadend = () => r(reader.result);
            reader.readAsDataURL(blob);
          });
          const gsY = pageHeight - 7;
          pdf.setFontSize(6);
          pdf.setTextColor(160, 160, 160);
          pdf.setFont('helvetica', 'normal');
          pdf.text('Powered by ', pageWidth / 2 - 5, gsY, { align: 'right' });
          pdf.addImage(base64, 'PNG', pageWidth / 2 - 4.2, gsY - 2.8, 3.5, 3.5);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Grocery Studio', pageWidth / 2 + 0.5, gsY, { align: 'left' });
        }
      } catch (e) {
        console.error("GS Logo Error:", e);
      }

      // Final Output
      const fileName = `invoice-${bill.id || Date.now()}.pdf`;
      await handlePDFOutput(pdf, fileName);
      showToast('Invoice generated successfully.', 'success');

    } catch (e) {
      console.error(e);
      showToast('Error generating PDF.', 'error');
    }
  };


  const makePayment = () => {
    // Check if plan is expired
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade to continue generating bills.', 'error', 5000);
      }
      return;
    }

    console.log('makePayment called at:', new Date().toISOString());
    console.trace('makePayment call stack');

    if (billItems.length === 0) {

      return;
    }

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

    try {

      // Create Order record (Order model is for sales/billing records, not Transaction)
      // Order model: sellerId (required), customerId, paymentMethod, items[], totalAmount

      // Extract sellerId from authenticated seller (using same method as apiRequest)

      const sellerId = getSellerIdFromAuth();

      console.log('Auth state:', localStorage.getItem('auth'));

      if (!sellerId) {

        console.error('Auth state:', localStorage.getItem('auth'));

        showToast('Error: User not authenticated. Please login again.', 'error');
        return;
      }

      // Validate billItems before creating order
      if (!billItems || billItems.length === 0) {

        showToast('Error: No items in the bill. Please add items before confirming.', 'error');
        return;
      }

      const orderItems = billItems.map((item, index) => {
        // Get product to include costPrice
        const product = state.products.find(p => p.id === item.productId || p.id === item.id);
        const costPrice = product?.costPrice ?? product?.unitPrice ?? 0;

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

        }
        if (orderItem.sellingPrice === undefined || orderItem.sellingPrice === null || typeof orderItem.sellingPrice !== 'number' || orderItem.sellingPrice < 0) {

        }
        if (orderItem.costPrice === undefined || orderItem.costPrice === null || typeof orderItem.costPrice !== 'number') {

        }
        if (orderItem.quantity === undefined || orderItem.quantity === null || typeof orderItem.quantity !== 'number' || orderItem.quantity < 1) {

        }
        if (!orderItem.unit || typeof orderItem.unit !== 'string') {

        }

        return orderItem;
      });

      // Validate items array
      if (orderItems.length === 0) {

        showToast('Error: Could not process order items. Please try again.', 'error');
        return;
      }

      const order = {
        id: `tr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

      if (!order.sellerId) {

        showToast('Error: User not authenticated. Please login again.', 'error');
        return;
      }

      if (!order.items || order.items.length === 0) {

        showToast('Error: No items in order. Please add items before confirming.', 'error');
        return;
      }

      if (!order.totalAmount || order.totalAmount <= 0) {

        showToast('Error: Invalid order total. Please try again.', 'error');
        return;
      }

      // Check plan limit BEFORE creating order
      const activeOrders = state.orders.filter(order => !order.isDeleted);
      const totalOrders = activeOrders.length;
      const { maxOrders } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
      const canAdd = canAddOrder(totalOrders, state.aggregatedUsage, state.currentPlan, state.currentPlanDetails, state.planOrders || state.planUsagePlans || []);

      if (!canAdd) {
        const orderLimitLabel = maxOrders === Infinity ? 'Unlimited' : maxOrders;
        const planNameLabel = state.currentPlanDetails?.planName
          || (state.currentPlan ? `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}` : 'Current');
        const limitMessage = `Your limit is full! You've reached the order limit (${orderLimitLabel}) for the ${planNameLabel} plan. Upgrade your plan to create more orders.`;

        showToast(limitMessage, 'error', 5000);
        return;
      }

      // Validate order items structure before dispatch

      order.items.forEach((item, index) => {

        // Check for validation issues
        if (!item.name || item.name.trim() === '') {

        }
        if (typeof item.sellingPrice !== 'number' || item.sellingPrice < 0) {

        }
        if (typeof item.costPrice !== 'number' || item.costPrice < 0) {

        }
        if (typeof item.quantity !== 'number' || item.quantity <= 0) {

        }
        if (!item.unit || typeof item.unit !== 'string') {

        }
      });

      // Dispatch order - it will be saved to IndexedDB and synced to MongoDB

      console.log('Order ID:', order.id, '(type:', typeof order.id, ')');
      console.log('Order sellerId:', order.sellerId, '(type:', typeof order.sellerId, ')');
      //('Order paymentMethod:', order.paymentMethod, '(type:', typeof order.paymentMethod, ')');

      //('Order totalAmount:', order.totalAmount, '(type:', typeof order.totalAmount, ')');
      //('Full order:', JSON.stringify(order, null, 2));

      // Dispatch order - it will be saved to IndexedDB and synced to MongoDB

      try {
        // Use ActionTypes constant to ensure correct action type
        const action = { type: ActionTypes.ADD_ORDER, payload: order };

        dispatch(action);

      } catch (error) {

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

      if (window.showToast) {
        window.showToast('Error processing payment. Please try again.', 'error');
      }
    }
  };

  // Helper function to format quantity with readable units
  // Helper function to format quantity with readable units
  const formatQuantity = (quantity, unit) => {
    if (!quantity || !unit) return `${quantity || ''} ${unit || ''}`.trim();

    const numQuantity = parseFloat(quantity);
    if (isNaN(numQuantity)) return `${quantity} ${unit}`;

    // Helper to format number (remove decimals if integer)
    const fmt = (n) => Number.isInteger(n) ? n.toString() : n.toFixed(2).replace(/\.?0+$/, '');

    // Convert grams to kg if >= 1000g
    if (unit === 'g' && numQuantity >= 1000) {
      return `${fmt(numQuantity / 1000)} kg`;
    }

    // Convert ml to L if >= 1000ml
    if (unit === 'ml' && numQuantity >= 1000) {
      return `${fmt(numQuantity / 1000)} L`;
    }

    return `${fmt(numQuantity)} ${unit}`;
  };

  // Helper to format currency for PDF printing (replaces ₹ with Rs.)
  const formatCurrencyForPrint = (amount) => {
    return formatCurrency(amount).replace(/₹/g, 'Rs. ');
  };

  const shareBillToWhatsApp = () => {
    if (billItems.length === 0) return;

    // Use current state to create a bill object compatible with generateAndDownloadPDF
    const subtotal = billItems.reduce((acc, item) => acc + getItemTotalAmount(item), 0);
    const taxAmount = (subtotal * (tax || 0)) / 100;
    const discountAmount = (subtotal * (discount || 0)) / 100;
    const finalTotal = subtotal - discountAmount + taxAmount;

    const customerObj = state.customers.find(c => c.id === selectedCustomer);
    const customerName = useCustomName ? customCustomerName : (customerObj?.name || 'Walk-in Customer');
    const customerMobile = useCustomName ? customCustomerMobile : (customerObj?.mobileNumber || customerObj?.phone || '');

    const billObj = {
      id: `INV-${Date.now().toString().slice(-6)}`,
      customerName,
      items: billItems,
      subtotal,
      total: finalTotal,
      discountPercent: discount,
      taxPercent: tax,
      paymentMethod,
      date: new Date()
    };

    // 1. Generate and Download the high-fidelity PDF
    generateAndDownloadPDF(billObj);

    // 2. Open WhatsApp with text summary
    if (customerMobile) {
      openWhatsAppInvoice(billObj, customerMobile);
    } else {
      showToast('No mobile number found to share via WhatsApp', 'warning');
    }
  };


  // Generate thermal receipt format (Sleek Bill Style)
  // Generate thermal receipt bill (Matches "Raintech Software" Style)
  // Generate thermal receipt bill (Matches "Raintech Software" Style)
  const generateThermalBill = async (size, invoiceNumber = null, billData = null) => {
    const width = size === '58mm' ? 58 : 80;
    const margin = 2; // small margin for thermal
    const centerX = width / 2;
    const items = billData?.items || billItems;

    // Custom Accent Color
    const accentHex = billSettings?.billSettings?.accentColor || billSettings?.accentColor || '#0000FF';
    const hexToRgb = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 0, g: 0, b: 255 };
    };
    const rgb = hexToRgb(accentHex);

    const storeName = state.storeName || 'MY STORE';
    const address = state.storeAddress || '';
    const phone = state.storePhone || '';
    const gstin = state.storeGstin || '';
    const billNo = invoiceNumber || `BILL-${Date.now().toString().slice(-4)}`;
    const dateStr = billData?.date ? new Date(billData.date).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');

    const subTotal = items.reduce((acc, i) => acc + getItemTotalAmount(i), 0);
    const discountAmount = billData?.discountAmount || 0;
    const grandTotal = subTotal - discountAmount;
    const sellerUpiIdValue = billData?.upiId || state.currentUser?.upiId || state.upiId;

    // Helper: Draw Content logic to be reused for height calculation and final PDF
    const drawContent = async (pdf) => {
      let y = 5;

      const drawDashedLine = (yPos) => {
        pdf.setLineDash([1, 1], 0);
        pdf.setDrawColor(0);
        pdf.line(margin, yPos, width - margin, yPos);
        pdf.setLineDash([], 0);
      };

      /* ================= HEADER ================= */
      const logoUrl = state.storeLogo || state.currentUser?.logoUrl || billSettings?.logoUrl;

      if (logoUrl) {
        try {
          const loadImage = (src) => new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = reject;
            img.src = src;
          });

          const logoData = await loadImage(logoUrl);
          const logoWidth = size === '58mm' ? 12 : 16;
          const logoHeight = logoWidth;
          pdf.addImage(logoData, 'PNG', centerX - (logoWidth / 2), y, logoWidth, logoHeight);
          y += logoHeight + 2;
        } catch (e) { console.error("Logo load error", e); }
      }

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(0, 0, 0);
      pdf.text("TAX INVOICE", centerX, y, { align: 'center' });
      y += 5;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(size === '58mm' ? 10 : 12);
      pdf.setTextColor(rgb.r, rgb.g, rgb.b);

      const storeNameLines = pdf.splitTextToSize(storeName, width - 4);
      pdf.text(storeNameLines, centerX, y, { align: 'center' });
      y += (storeNameLines.length * 4) + 1;

      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);

      if (address) {
        const addrLines = pdf.splitTextToSize(address, width - 4);
        pdf.text(addrLines, centerX, y, { align: 'center' });
        y += (addrLines.length * 3.5);
      }

      if (phone) {
        pdf.text(`Contact :${phone}`, centerX, y, { align: 'center' });
        y += 3.5;
      }

      if (gstin) {
        pdf.text(`GSTIN : ${gstin}`, centerX, y, { align: 'center' });
        y += 4;
      }

      y += 2;
      const metaY = y;
      pdf.setFontSize(8);
      pdf.setTextColor(150, 0, 0);
      pdf.text("Inv No", margin, metaY);
      const invLabelWidth = pdf.getTextWidth("Inv No ");

      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'bold');
      if (size === '58mm' && billNo.length > 12) {
        pdf.text(billNo, margin, metaY + 3.5);
      } else {
        pdf.text(billNo, margin + invLabelWidth, metaY);
      }

      const dateValWidth = pdf.getTextWidth(dateStr);
      pdf.text(dateStr, width - margin, metaY, { align: 'right' });
      pdf.setTextColor(150, 0, 0);
      const dateLabelWidth = pdf.getTextWidth("Date ");
      pdf.text("Date ", width - margin - dateValWidth - dateLabelWidth, metaY);

      pdf.setTextColor(0, 0, 0);
      y += 5;

      // Add Customer Info for Thermal Bill
      const displayCustomerName = billData?.customerName || 'Walk-in Customer';

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`Customer name: ${displayCustomerName}`, margin, y);
      y += 4;

      if (billData?.customerMobile) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.text(`Mobile no.: ${billData.customerMobile}`, margin, y);
        y += 4;
      }

      drawDashedLine(y);
      y += 3;

      /* ================= TABLE HEADER ================= */
      pdf.setFontSize(size === '58mm' ? 7 : 8);
      pdf.setFont('helvetica', 'bold');

      const cols = size === '58mm' ? [
        { name: "Sl.No.", x: margin, align: 'left' },
        { name: "Item Name", x: margin + 8, align: 'left' },
        { name: "QTY.", x: width - margin - 22, align: 'right' },
        { name: "Price", x: width - margin - 12, align: 'right' },
        { name: "Amount", x: width - margin, align: 'right' }
      ] : [
        { name: "Sl.No.", x: margin, align: 'left' },
        { name: "Item Name", x: margin + 10, align: 'left' },
        { name: "QTY.", x: width - margin - 28, align: 'right' },
        { name: "Price", x: width - margin - 15, align: 'right' },
        { name: "Amount", x: width - margin, align: 'right' }
      ];

      cols.forEach(c => pdf.text(c.name, c.x, y, { align: c.align }));
      y += 2;
      drawDashedLine(y);
      y += 3;

      /* ================= TABLE BODY ================= */
      pdf.setFont('helvetica', 'bold');
      let totalQty = 0;
      items.forEach((item, index) => {
        const qty = Number(item.quantity) || 0;
        const lineAmount = getItemTotalAmount(item);
        const nominalPrice = Number(item.price) || 0;
        totalQty += qty;

        pdf.text(String(index + 1), cols[0].x, y);

        // Name Wrapping Logic
        // Name Wrapping Logic - Adjusted to prevent QTY overlap
        // 58mm: Item(10) -> QTY Ends(34). QTY Start~26. Safe width ~15.
        // 80mm: Item(12) -> QTY Ends(50). QTY Start~40. Safe width ~27.
        const maxWidth = size === '58mm' ? 15 : 27;
        const fontSize = size === '58mm' ? 7 : 8;
        pdf.setFontSize(fontSize);

        const isHindi = /[\u0900-\u097F\u20B9]/.test(item.name);
        let nameLines = [];
        if (!isHindi) {
          nameLines = pdf.splitTextToSize(item.name || '', maxWidth);
        }

        if (isHindi) {
          safeDrawText(pdf, item.name, cols[1].x, y, { fontSize, maxWidth });
        } else {
          pdf.text(nameLines, cols[1].x, y);
        }

        pdf.text(qty.toFixed(2), cols[2].x, y, { align: 'right' });
        pdf.text(nominalPrice.toFixed(2), cols[3].x, y, { align: 'right' });
        pdf.text(lineAmount.toFixed(2), cols[4].x, y, { align: 'right' });

        const height = isHindi ? 3.5 : (Math.max(1, nameLines.length) * 3.5);
        y += height;
      });

      drawDashedLine(y);
      y += 3;

      /* ================= TOTALS LINE ================= */
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`Total Item(s): ${items.length}`, margin, y);
      const qtyText = `Qty.: ${totalQty.toFixed(2)}`;
      const qtyX = size === '58mm' ? (width / 2) + 2 : (width / 2);
      pdf.text(qtyText, qtyX, y, { align: 'center' });
      pdf.text(subTotal.toFixed(2), width - margin, y, { align: 'right' });

      y += 3;
      drawDashedLine(y);
      y += 4;

      /* ================= GST SUMMARY TABLE ================= */
      const gstSummary = {};
      items.forEach(item => {
        const gst = item.gstPercent || 0;
        if (gst >= 0) {
          const itemTotal = getItemTotalAmount(item);
          if (!gstSummary[gst]) gstSummary[gst] = { taxable: 0, tax: 0 };
          const isInclusive = item.isGstInclusive !== false;
          let taxAmt = 0;
          let taxable = 0;
          if (isInclusive) {
            taxable = itemTotal / (1 + gst / 100);
            taxAmt = itemTotal - taxable;
          } else {
            taxable = itemTotal;
            taxAmt = itemTotal * (gst / 100);
          }
          gstSummary[gst].taxable += taxable;
          gstSummary[gst].tax += taxAmt;
        }
      });

      if (Object.keys(gstSummary).length > 0) {
        pdf.setFontSize(size === '58mm' ? 6 : 7);
        pdf.setFont('helvetica', 'normal');
        const gCols = size === '58mm' ? [
          { n: "Tax %", x: margin },
          { n: "Taxable Val", x: margin + 11 },
          { n: "CGST", x: margin + 30 },
          { n: "SGST", x: margin + 38 },
          { n: "GST", x: width - margin - 5, align: 'center' }
        ] : [
          { n: "Tax %", x: margin },
          { n: "Taxable Val", x: margin + 12 },
          { n: "CGST", x: margin + 32 },
          { n: "SGST", x: margin + 46 },
          { n: "GST", x: width - margin - 12, align: 'center' }
        ];

        gCols.forEach(c => pdf.text(c.n, c.x, y, { align: c.align || 'left' }));
        y += 3;
        Object.keys(gstSummary).forEach(rate => {
          const row = gstSummary[rate];
          const halfTax = row.tax / 2;
          pdf.text(Number(rate).toFixed(2), gCols[0].x, y);
          pdf.text(row.taxable.toFixed(2), gCols[1].x + 2, y, { align: 'center' });
          pdf.text(halfTax.toFixed(2), gCols[2].x, y);
          pdf.text(halfTax.toFixed(2), gCols[3].x, y);
          pdf.text(row.tax.toFixed(2), gCols[4].x, y, { align: 'center' });
          y += 3;
        });
        drawDashedLine(y);
        y += 4;
      }

      /* ================= FINAL BIG TOTAL ================= */
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      y += 2;
      pdf.text("Total", margin, y);
      pdf.text(`${Math.round(grandTotal).toFixed(2)}`, width - margin, y, { align: 'right' });
      y += 6;
      drawDashedLine(y);
      y += 4;

      /* ================= FOOTER ================= */
      if (billSettings?.billSettings?.showFooter !== false && billSettings?.showFooter !== false) {
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.text("Terms and Conditions", centerX, y, { align: 'center' });
        y += 4;
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        const termsText = billSettings?.termsAndConditions || billSettings?.billSettings?.termsAndConditions || "";
        if (termsText) {
          const splitTerms = pdf.splitTextToSize(termsText, width - 4);
          splitTerms.forEach(l => {
            pdf.text(l, centerX, y, { align: 'center' });
            y += 3;
          });
        }
        y += 2;
        const footerMsg = billSettings?.footerMessage || billSettings?.billSettings?.footerMessage || "Thank you, visit again";
        const splitFooter = pdf.splitTextToSize(footerMsg, width - 4);
        pdf.setFont('helvetica', 'bold');
        splitFooter.forEach(l => {
          pdf.text(l, centerX, y, { align: 'center' });
          y += 3;
        });
        y += 3;
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'bold');
        pdf.text("Thank You", centerX, y, { align: 'center' });
        y += 4;
      }

      // QR Code
      if (grandTotal > 0 && sellerUpiIdValue && sellerUpiIdValue.includes('@')) {
        try {
          const upiUrl = `upi://pay?pa=${sellerUpiIdValue}&am=${grandTotal.toFixed(2)}&cu=INR&tn=Bill%20Payment`;
          const qrResult = await QRCode.toDataURL(upiUrl, { margin: 1, width: 120 });
          if (qrResult) {
            const qrSize = size === '58mm' ? 25 : 30;
            pdf.addImage(qrResult, 'PNG', centerX - (qrSize / 2), y, qrSize, qrSize);
            y += qrSize + 2;
            pdf.setFontSize(8);
            pdf.text("Scan to Pay", centerX, y + 2, { align: 'center' });
            y += 4;
          }
        } catch (error) {
          console.error("QR Gen Error", error);
        }
      }

      // 6. Powered By Branding
      try {
        const publicUrl = process.env.PUBLIC_URL || '';
        const gsLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
        const gsLogoRes = await fetch(gsLogo).catch(() => null);
        if (gsLogoRes && gsLogoRes.ok) {
          const blob = await gsLogoRes.blob();
          const base64 = await new Promise(r => {
            const reader = new FileReader();
            reader.onloadend = () => r(reader.result);
            reader.readAsDataURL(blob);
          });
          y += 2;
          pdf.setFontSize(6);
          pdf.setTextColor(160, 160, 160);
          pdf.setFont('helvetica', 'normal');
          pdf.text('Powered by ', centerX - 5, y + 3, { align: 'right' });
          pdf.addImage(base64, 'PNG', centerX - 4.2, y + 0.2, 3.5, 3.5);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Grocery Studio', centerX + 0.5, y + 3, { align: 'left' });
          y += 6;
        }
      } catch (e) { }

      return y + 2; // Return final Y with a small bottom margin
    };

    // First pass: Calculate required height
    const calcPdf = new jsPDF('p', 'mm', [width, 1000]); // 1 meter should be enough
    const finalHeight = await drawContent(calcPdf);

    // Second pass: Generate actual PDF with dynamic height
    const pdf = new jsPDF('p', 'mm', [width, finalHeight]);
    await drawContent(pdf);

    // Output
    if (invoiceNumber) {
      await handlePDFOutput(pdf, `Receipt-${invoiceNumber}.pdf`);
    } else {
      await handlePDFOutput(pdf, `Receipt-Preview.pdf`);
    }

    if (window.showToast) window.showToast(`Thermal Bill (${size}) Generated`, 'success');
  };

  // Main download bill function
  // Generate order and then print bill (used by Shift + F4 shortcut)
  const generateBillAndPrint = async () => {
    if (billItems.length === 0) return;

    try {
      // Generate order first
      await generateBill();

      // Wait a bit for order to be created and synced
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Then print the bill
      await downloadBill();
    } catch (error) {

      if (window.showToast) {
        window.showToast('Error generating order and bill. Please try again.', 'error');
      }
    }
  };

  const downloadBill = async () => {
    if (billItems.length === 0) return;

    const currentPrintSize = printSizeRef.current; // Use ref to get current value

    try {
      // Use the last created order for bill data
      const lastOrder = lastCreatedOrder.current;
      const invoiceNumber = lastOrder?.invoiceNumber || `BILL-${Date.now().toString().slice(-6)}`;

      // Use items from the order as billItems might have been cleared
      const itemsToUse = (billItems && billItems.length > 0) ? billItems : (lastOrder?.items || []).map(item => ({
        ...item,
        price: item.sellingPrice || item.price || 0 // Map sellingPrice to price for compatibility
      }));

      // Create bill data from the order
      const billData = {
        id: lastOrder?.invoiceNumber || lastOrder?.id || Date.now().toString(),
        customerName: lastOrder?.customerName || 'Walk-in Customer',
        customerMobile: lastOrder?.customerMobile || '',
        paymentMethod: lastOrder?.paymentMethod || 'cash',
        splitPaymentDetails: lastOrder?.splitPaymentDetails || null,
        total: lastOrder?.totalAmount || 0,
        items: itemsToUse,
        date: lastOrder?.createdAt || new Date().toISOString(),
        upiId: lastOrder?.upiId || state.currentUser?.upiId || state.upiId || ''
      };

      // Handle different print formats
      if (currentPrintSize === '58mm' || currentPrintSize === '80mm') {
        // Thermal printer format - use receipt-style layout
        await generateThermalBill(currentPrintSize, invoiceNumber, billData);
      } else {
        // Regular paper format (A4)
        generateAndDownloadPDF(billData);


      }
    } catch (error) {

      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  };

  // Find the most recent order that matches current bill items
  const findMatchingOrderForBill = () => {
    const currentTime = Date.now();
    const fiveMinutesAgo = currentTime - (5 * 60 * 1000); // 5 minutes window

    // Find orders created in the last 5 minutes
    const recentOrders = state.orders.filter(order => {
      const orderTime = new Date(order.createdAt).getTime();
      return orderTime >= fiveMinutesAgo && orderTime <= currentTime;
    });

    // Find the order with matching items (by checking total and item count)
    const currentTotal = total;
    const currentItemCount = billItems.length;

    for (const order of recentOrders.reverse()) { // Check most recent first
      if (order.totalAmount === currentTotal && order.items.length === currentItemCount) {
        // Additional check: compare first item's name and quantity
        const firstBillItem = billItems[0];
        const firstOrderItem = order.items[0];
        if (firstBillItem && firstOrderItem &&
          firstBillItem.name === firstOrderItem.name &&
          firstBillItem.quantity === firstOrderItem.quantity) {
          return order;
        }
      }
    }

    return null;
  };

  // Helper to get template styles
  const getTemplateStyles = (templateId) => {
    const primaryColor = [47, 60, 126]; // #2f3c7e

    // Default: 'standard'
    const base = {
      id: 'standard',
      font: 'helvetica',
      headerBg: [255, 255, 255],
      textColor: [0, 0, 0],
      tableHeaderBg: [240, 240, 240],
      tableHeaderText: primaryColor,
      borderColor: [230, 230, 230],
      accentColor: primaryColor,
      footerBg: [255, 255, 255],
      showBorders: true
    };

    switch (templateId) {
      case 'classic':
        return {
          ...base,
          id: 'classic',
          font: 'times', // jsPDF supports 'times'
          tableHeaderBg: [255, 255, 255],
          tableHeaderText: [0, 0, 0],
          borderColor: [0, 0, 0],
          accentColor: [0, 0, 0], // Classic uses black usually
          showBorders: true // Double border logic can be handled in renderer if needed
        };
      case 'modern':
        return {
          ...base,
          id: 'modern',
          headerBg: [245, 247, 255], // Very light blue
          tableHeaderBg: primaryColor,
          tableHeaderText: [255, 255, 255],
          borderColor: [200, 200, 240],
          accentColor: primaryColor
        };
      case 'minimal':
        return {
          ...base,
          id: 'minimal',
          headerBg: [255, 255, 255],
          tableHeaderBg: [255, 255, 255], // No background
          tableHeaderText: [80, 80, 80],
          borderColor: [240, 240, 240],
          showBorders: false, // Minimal lines
          accentColor: [60, 60, 60]
        };
      case 'bold':
        return {
          ...base,
          id: 'bold',
          headerBg: [255, 255, 255],
          tableHeaderBg: [0, 0, 0],
          tableHeaderText: [255, 255, 255],
          borderColor: [0, 0, 0],
          accentColor: [0, 0, 0],
          showBorders: true,
          isBold: true
        };
      default:
        return base;
    }
  };

  // Generate paper format bill (Matches "Professional GST Bill" Format)
  const generatePaperBill = async (pdf, invoiceNumber = null, billData = null) => {
    try {
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;

      /* ================= 1. PREMIUM HEADER ================= */
      const settings = sellerSettings?.billSettings || {};

      // Get styles based on template
      const currentTemplate = settings.template || 'standard';
      const styles = getTemplateStyles(currentTemplate);
      const accentHex = settings.colors?.accent || '#2f3c7e';
      const hexToRgb = (hex) => {
        const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return res ? [parseInt(res[1], 16), parseInt(res[2], 16), parseInt(res[3], 16)] : [47, 60, 126];
      };
      const accentColor = hexToRgb(accentHex);


      // Branding Accent
      pdf.setFillColor(...accentColor);
      pdf.rect(0, 0, pageWidth, 2, 'F');

      let y = 10;
      const storeName = state.storeName || 'Grocery Store';
      const address = state.currentUser?.shopAddress || '';
      const phone = state.currentUser?.phoneNumber || '';
      const gstin = state.currentUser?.gstNumber || '';
      const billNo = invoiceNumber || `INV-${Date.now().toString().slice(-6)}`;
      const dateStr = billData?.date ? new Date(billData.date).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
      const cxName = billData?.customerName || 'Walk-in Customer';

      // Logo & Store Info
      let logoOffset = 0;
      const logoShow = settings.showLogo !== undefined ? settings.showLogo : (settings.header?.showLogo ?? true);
      if (logoShow) {
        try {
          const publicUrl = process.env.PUBLIC_URL || '';
          const defaultLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
          const sellerLogo = state.currentUser?.logoUrl || state.storeLogo || settings.logoUrl;
          const logoUrl = sellerLogo || defaultLogo;

          const res = await fetch(logoUrl).catch(() => null);
          if (res && res.ok) {
            const blob = await res.blob();
            const base64 = await new Promise(r => {
              const reader = new FileReader();
              reader.onloadend = () => r(reader.result);
              reader.readAsDataURL(blob);
            });
            pdf.addImage(base64, 'PNG', margin, y, 16, 16);
            logoOffset = 20;
          } else if (logoUrl !== defaultLogo) {
            const defaultRes = await fetch(defaultLogo).catch(() => null);
            if (defaultRes && defaultRes.ok) {
              const blob = await defaultRes.blob();
              const base64 = await new Promise(r => {
                const reader = new FileReader();
                reader.onloadend = () => r(reader.result);
                reader.readAsDataURL(blob);
              });
              pdf.addImage(base64, 'PNG', margin, y, 16, 16);
              logoOffset = 20;
            }
          }
        } catch (e) {
          console.error("Logo generation error:", e);
        }
      }

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.setTextColor(...accentColor);
      const headerStoreName = state.storeName || state.currentUser?.shopName || 'Grocery Store';
      safeDrawText(pdf, headerStoreName.toUpperCase(), margin + logoOffset, y + 6, { fontSize: 22, color: `rgb(${accentColor.join(',')})` });

      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184); // slate-400
      pdf.text('PREMIUM RETAIL PARTNER', margin + logoOffset, y + 11);

      // Tax Invoice Badge
      pdf.setFillColor(248, 250, 252); // slate-50
      pdf.roundedRect(pageWidth - margin - 45, y, 45, 10, 2, 2, 'F');
      pdf.setFontSize(13);
      pdf.setTextColor(30, 41, 59); // slate-900
      pdf.text('TAX INVOICE', pageWidth - margin - 22.5, y + 6.5, { align: 'center' });

      y += 20;

      const addressShow = settings.showAddress !== undefined ? settings.showAddress : (settings.header?.showAddress ?? true);
      if (addressShow) {
        pdf.setDrawColor(...accentColor);
        pdf.setLineWidth(0.5);
        pdf.line(margin, y, margin, y + 15);
        pdf.setFontSize(9);
        pdf.setTextColor(71, 85, 105); // slate-600

        const mainAddr = state.currentUser?.shopAddress || state.storeAddress || '123, Central Plaza, Main Market';
        pdf.text(mainAddr, margin + 4, y + 3);

        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(100, 116, 139); // slate-500
        const addr2 = [
          state.currentUser?.city || state.storeCity,
          state.currentUser?.state || state.storeState,
          state.currentUser?.pincode || state.storePincode
        ].filter(Boolean).join(' - ') || 'Metropolis City - 400001';
        pdf.text(addr2, margin + 4, y + 7);

        pdf.text(`Phone: ${state.currentUser?.phoneNumber || state.storePhone || '+91 98765 43210'}`, margin + 4, y + 11);

        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(30, 41, 59);
        pdf.text(`GSTIN: ${state.currentUser?.gstNumber || state.storeGstin || '27ABCDE1234F1Z5'}`, margin + 4, y + 15);
      }

      y += 20;

      // Bill To & Supply
      pdf.setDrawColor(241, 245, 249); // border
      pdf.line(margin, y, pageWidth - margin, y);
      y += 6;
      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184);
      pdf.text('BILL TO', margin, y);
      pdf.text('PLACE OF SUPPLY', pageWidth - margin, y, { align: 'right' });
      y += 5;
      pdf.setFontSize(10);
      pdf.setTextColor(30, 41, 59);
      safeDrawText(pdf, cxName.toUpperCase(), margin, y, { fontSize: 10 });
      pdf.text('LOCAL (WITHIN STATE)', pageWidth - margin, y, { align: 'right' });

      // Add Customer Mobile if available
      if (billData?.customerMobile) {
        y += 4;
        pdf.setFontSize(9);
        pdf.setTextColor(71, 85, 105); // slate-600
        pdf.text(`Mobile: ${billData.customerMobile}`, margin, y);
      }

      y += 8;
      pdf.line(margin, y, pageWidth - margin, y);
      y += 10;


      /* ================= 2. ITEM TABLE ================= */
      // Cols: Sr, Item, HSN, Qty, Rate, Taxable, GST Amt, Total
      // Widths: Sr(8), Item(50), HSN(20), Qty(15), Rate(20), Taxable(25), GST(25), Total(27) -> Approx 190
      const cols = [
        { header: "Sr No", width: 10, align: 'center', key: 'sr' },
        { header: "Item Name", width: 55, align: 'left', key: 'name' },
        { header: "HSN", width: 20, align: 'center', key: 'hsn' },
        { header: "Quantity", width: 18, align: 'center', key: 'qty' },
        { header: "Rate", width: 18, align: 'right', key: 'rate' },
        { header: "Taxable Amt", width: 25, align: 'right', key: 'taxable' },
        { header: "GST Amit", width: 20, align: 'right', key: 'gst' }, // CGST+SGST or IGST
        { header: "Line Total", width: 24, align: 'right', key: 'total' }
      ];

      // Draw Table Header
      const headerHeight = 10;
      pdf.setFillColor(...accentColor);
      pdf.roundedRect(margin, y, pageWidth - (margin * 2), headerHeight, 2, 2, 'F');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(255, 255, 255);


      pdf.setFont(styles.font, 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(...styles.tableHeaderText);

      let curX = margin;
      cols.forEach(col => {
        let textX = curX + (col.width / 2);
        if (col.align === 'left') textX = curX + 2;
        if (col.align === 'right') textX = curX + col.width - 2;

        pdf.text(col.header, textX, y + 5, { align: col.align });

        // Vertical Line - Only if showBorders is true
        if (styles.showBorders && col !== cols[cols.length - 1]) {
          pdf.line(curX + col.width, y, curX + col.width, y + headerHeight);
        }

        col.x = curX;
        curX += col.width;
      });

      y += headerHeight;

      // Draw Rows
      pdf.setFont(styles.font, 'normal');
      pdf.setTextColor(...styles.textColor); // Reset text color

      const items = billData?.items || billItems;
      let totalTaxable = 0;
      let totalTax = 0;
      let grandTotal = 0;

      // GST Summary Data Structure
      const gstSummary = {}; // Key: Rate, Value: { taxable: 0, cgst: 0, sgst: 0, igst: 0 }

      items.forEach((item, index) => {
        // Calculation
        const qty = Number(item.quantity) || 0;
        const rate = Number(item.price) || 0; // Nominal Price
        const gstPercent = Number(item.gstPercent) || 0;
        const isInclusive = item.isGstInclusive !== false;

        let taxableUnit, taxUnit, totalUnit;
        if (isInclusive) {
          taxableUnit = rate / (1 + gstPercent / 100);
          taxUnit = rate - taxableUnit;
          totalUnit = rate;
        } else {
          taxableUnit = rate;
          taxUnit = rate * (gstPercent / 100);
          totalUnit = taxableUnit + taxUnit;
        }

        const lineTaxable = taxableUnit * qty;
        const lineTax = taxUnit * qty;
        const lineTotal = totalUnit * qty;

        totalTaxable += lineTaxable;
        totalTax += lineTax;
        grandTotal += lineTotal;

        // GST Breakdown
        if (!gstSummary[gstPercent]) gstSummary[gstPercent] = { taxable: 0, tax: 0 };
        gstSummary[gstPercent].taxable += lineTaxable;
        gstSummary[gstPercent].tax += lineTax;

        // Rendering
        const descLines = pdf.splitTextToSize(item.name, cols[1].width - 4);
        const rowHeight = Math.max(10, descLines.length * 4 + 2);

        // Zebra Stripping
        if (index % 2 === 1) {
          pdf.setFillColor(248, 250, 252); // slate-50
          pdf.rect(margin, y, pageWidth - margin * 2, rowHeight, 'F');
        }


        // Page break check
        if (y + rowHeight > pageHeight - 50) { // Leave room for footer
          // Close current table
          if (styles.showBorders) pdf.line(margin, y, pageWidth - margin, y);

          // Add page
          pdf.addPage();
          y = 20;
          // Redraw header
          pdf.setDrawColor(...styles.borderColor);
          if (styles.showBorders) {
            pdf.setFillColor(...styles.tableHeaderBg);
            pdf.rect(margin, y, pageWidth - (margin * 2), headerHeight, 'FD');
          } else {
            if (styles.id === 'minimal') {
              pdf.line(margin, y + headerHeight, pageWidth - margin, y + headerHeight);
            } else {
              pdf.setFillColor(...styles.tableHeaderBg);
              pdf.rect(margin, y, pageWidth - (margin * 2), headerHeight, 'F');
            }
          }

          pdf.setFont(styles.font, 'bold');
          pdf.setTextColor(...styles.tableHeaderText);

          let hx = margin;
          cols.forEach(col => {
            let tx = hx + (col.width / 2);
            if (col.align === 'left') tx = hx + 2;
            if (col.align === 'right') tx = hx + col.width - 2;
            pdf.text(col.header, tx, y + 5, { align: col.align });
            if (styles.showBorders && col !== cols[cols.length - 1]) pdf.line(hx + col.width, y, hx + col.width, y + headerHeight);
            hx += col.width;
          });
          y += headerHeight;

          pdf.setFont(styles.font, 'normal');
          pdf.setTextColor(...styles.textColor);
        }

        // Row Content
        const cy = y + 4;
        pdf.text(String(index + 1), cols[0].x + cols[0].width / 2, cy, { align: 'center' });
        safeDrawText(pdf, item.name, cols[1].x + 2, cy, { fontSize: 8, maxWidth: cols[1].width - 4 });
        pdf.text("-", cols[2].x + cols[2].width / 2, cy, { align: 'center' }); // HSN
        pdf.text(String(qty), cols[3].x + cols[3].width / 2, cy, { align: 'center' });
        pdf.text(taxableUnit.toFixed(2), cols[4].x + cols[4].width - 2, cy, { align: 'right' });
        pdf.text(lineTaxable.toFixed(2), cols[5].x + cols[5].width - 2, cy, { align: 'right' });
        pdf.text(lineTax.toFixed(2), cols[6].x + cols[6].width - 2, cy, { align: 'right' });
        pdf.text(lineTotal.toFixed(2), cols[7].x + cols[7].width - 2, cy, { align: 'right' });

        // Vertical Lines
        if (styles.showBorders) {
          let lx = margin;
          cols.forEach(col => {
            if (col !== cols[cols.length - 1]) {
              pdf.line(lx + col.width, y, lx + col.width, y + rowHeight);
            }
            lx += col.width;
          });

          // Draw side borders for this row
          pdf.line(margin, y, margin, y + rowHeight); // Left
          pdf.line(pageWidth - margin, y, pageWidth - margin, y + rowHeight); // Right
        }

        y += rowHeight;
      });

      // Bottom border of table
      if (styles.showBorders) {
        pdf.line(margin, y, pageWidth - margin, y);
      } else if (styles.id !== 'minimal') {
        // For classic/others, maybe a closing line
        pdf.setDrawColor(...styles.borderColor);
        pdf.line(margin, y, pageWidth - margin, y);
      }

      y += 5;

      /* ================= 3. GST SUMMARY & TOTALS ================= */
      // We'll create a new block. Left side: GST Summary. Right side: Grand Totals.

      const summaryY = y;

      // GST Summary Table (Mini)
      pdf.setFont(styles.font, 'bold');
      pdf.setFontSize(8);
      pdf.text("GST Summary", margin, y);
      y += 3;

      const sumCols = [
        { name: "Taxable", width: 25 },
        { name: "CGST", width: 20 },
        { name: "SGST", width: 20 },
        { name: "Total Tax", width: 20 }
      ];
      // Header
      let sx = margin;
      pdf.setDrawColor(...styles.borderColor);
      sumCols.forEach(c => {
        if (styles.showBorders) pdf.rect(sx, y, c.width, 6);
        else if (styles.id !== 'minimal') {
          // For others, maybe underline or fill
          pdf.setFillColor(...styles.tableHeaderBg);
          pdf.rect(sx, y, c.width, 6, 'F');
          pdf.setDrawColor(...styles.borderColor);
        }
        pdf.text(c.name, sx + 2, y + 4);
        sx += c.width;
      });
      y += 6;

      // Rows
      pdf.setFont(styles.font, 'normal');
      Object.keys(gstSummary).forEach(rate => {
        if (Number(rate) === 0) return;
        const row = gstSummary[rate];
        const halfTax = row.tax / 2;
        const halfRate = Number(rate) / 2;

        sx = margin;
        // Taxable
        if (styles.showBorders) pdf.rect(sx, y, sumCols[0].width, 6);
        pdf.text(row.taxable.toFixed(2), sx + sumCols[0].width - 2, y + 4, { align: 'right' });
        sx += sumCols[0].width;

        // CGST
        if (styles.showBorders) pdf.rect(sx, y, sumCols[1].width, 6);
        pdf.text(`${halfRate}% (${halfTax.toFixed(1)})`, sx + sumCols[1].width - 2, y + 4, { align: 'right' });
        sx += sumCols[1].width;

        // SGST
        if (styles.showBorders) pdf.rect(sx, y, sumCols[2].width, 6);
        pdf.text(`${halfRate}% (${halfTax.toFixed(1)})`, sx + sumCols[2].width - 2, y + 4, { align: 'right' });
        sx += sumCols[2].width;

        // Total
        if (styles.showBorders) pdf.rect(sx, y, sumCols[3].width, 6);
        pdf.text(row.tax.toFixed(2), sx + sumCols[3].width - 2, y + 4, { align: 'right' });

        y += 6;
      });

      // === Right Side: Grand Total & Payment ===
      let ty = summaryY;
      const tX = pageWidth / 2 + 20;
      const valX = pageWidth - margin;

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(148, 163, 184); // slate-400

      // Subtotal
      pdf.text("SUB TOTAL", tX, ty + 5);
      pdf.setTextColor(30, 41, 59);
      pdf.text(totalTaxable.toFixed(2), valX, ty + 5, { align: 'right' });
      ty += 6;

      // Total GST
      pdf.setTextColor(148, 163, 184);
      pdf.text("TOTAL GST", tX, ty + 5);
      pdf.setTextColor(30, 41, 59);
      pdf.text(totalTax.toFixed(2), valX, ty + 5, { align: 'right' });
      ty += 6;

      // Divider
      pdf.setDrawColor(226, 232, 240); // slate-200
      pdf.line(tX, ty, pageWidth - margin, ty);
      ty += 10;

      // Grand Total
      pdf.setFontSize(14);
      pdf.setTextColor(...accentColor);
      pdf.setFont('helvetica', 'bold');
      pdf.text("GRAND TOTAL", tX, ty);
      pdf.text(Math.round(grandTotal).toFixed(2), valX, ty, { align: 'right' });
      ty += 10;


      // Payment Info
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      const payMode = getPaymentMethodLabel(billData?.paymentMethod);
      pdf.text(`Payment Mode: ${payMode}`, tX, ty + 5);
      ty += 5;

      // Balance Due (Logic: if split, show details. Else assume fully paid unless 'due')
      if (billData?.paymentMethod === 'split' && billData?.splitPaymentDetails) {
        const paidAmount = Number(billData.splitPaymentDetails.cashAmount || 0) + Number(billData.splitPaymentDetails.onlineAmount || 0);
        const creditUsed = Number(billData.splitPaymentDetails.creditAmount || 0);
        const dueAmount = Number(billData.splitPaymentDetails.dueAmount || 0);

        pdf.text(`Amount Paid: ${paidAmount.toFixed(2)}`, tX, ty + 5);
        ty += 5;
        if (creditUsed > 0) {
          pdf.text(`Credit Used: ${creditUsed.toFixed(2)}`, tX, ty + 5);
          ty += 5;
        }
        pdf.text(`Balance Due: ${dueAmount.toFixed(2)}`, tX, ty + 5);
      } else if (billData?.paymentMethod === 'due') {
        pdf.text(`Amount Paid: 0.00`, tX, ty + 5);
        ty += 5;
        pdf.text(`Balance Due: ${grandTotal.toFixed(2)}`, tX, ty + 5);
      } else {
        pdf.text(`Amount Paid: ${grandTotal.toFixed(2)}`, tX, ty + 5);
        ty += 5;
        pdf.text(`Balance Due: 0.00`, tX, ty + 5);
      }

      y = Math.max(y, ty + 10);

      /* ================= 4. FOOTER ================= */
      // Fix Layout at bottom
      const footerY = pageHeight - 25;

      // Line separator
      pdf.setDrawColor(0);
      pdf.line(margin, footerY, pageWidth - margin, footerY);

      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'italic');

      let fy = footerY + 5;

      const terms = billSettings?.termsAndConditions || billSettings?.billSettings?.termsAndConditions;
      if (terms) {
        // Render terms above the standard footer
        const termsY = footerY - 15; // Move up a bit for terms
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.text('Terms & Conditions:', margin, termsY);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        const splitTerms = pdf.splitTextToSize(terms, pageWidth - margin * 2);
        pdf.text(splitTerms, margin, termsY + 4);
      }

      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(8);

      pdf.text("* Prices are inclusive of GST where applicable", margin, fy);
      fy += 4;
      pdf.text("* This is a computer-generated invoice", margin, fy);
      fy += 6;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      const footerMsg = billSettings?.footerMessage || billSettings?.billSettings?.footerMessage || "Thank you, visit again";
      pdf.text(footerMsg, pageWidth / 2, fy, { align: 'center' });

      // QR Code for Paper Bill (Right aligned in Footer)
      if (grandTotal > 0) {
        const sellerUpiIdValue = billData?.upiId || state.currentUser?.upiId || state.upiId;
        if (sellerUpiIdValue && sellerUpiIdValue.includes('@')) {
          try {
            const upiUrl = `upi://pay?pa=${sellerUpiIdValue}&am=${grandTotal.toFixed(2)}&cu=INR&tn=Bill%20Payment`;
            const qrResult = await QRCode.toDataURL(upiUrl, { margin: 1, width: 120 });
            if (qrResult) {
              const qrSize = 22;
              const qrY = footerY + 2;
              const qrX = pageWidth - margin - qrSize;
              pdf.addImage(qrResult, 'PNG', qrX, qrY, qrSize, qrSize);
              pdf.setFontSize(8);
              pdf.text("Scan to Pay", qrX + (qrSize / 2), qrY + qrSize + 4, { align: 'center' });
            }
          } catch (error) {
            console.error("QR Error", error);
          }
        }
      }
      // Powered By Branding
      try {
        const publicUrl = process.env.PUBLIC_URL || '';
        const gsLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
        const gsLogoRes = await fetch(gsLogo).catch(() => null);
        if (gsLogoRes && gsLogoRes.ok) {
          const blob = await gsLogoRes.blob();
          const base64 = await new Promise(r => {
            const reader = new FileReader();
            reader.onloadend = () => r(reader.result);
            reader.readAsDataURL(blob);
          });
          const gsY = pageHeight - 7;
          pdf.setFontSize(6);
          pdf.setTextColor(160, 160, 160);
          pdf.setFont('helvetica', 'normal');
          pdf.text('Powered by ', pageWidth / 2 - 5, gsY, { align: 'right' });
          pdf.addImage(base64, 'PNG', pageWidth / 2 - 4.2, gsY - 2.8, 3.5, 3.5);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Grocery Studio', pageWidth / 2 + 0.5, gsY, { align: 'left' });
        }
      } catch (e) { }


      // Output
      const fileName = `GST-Invoice-${billNo}.pdf`;
      await handlePDFOutput(pdf, fileName);

      if (window.showToast) {
        window.showToast('GST Invoice generated successfully!', 'success');
      }

    } catch (error) {
      console.error("PDF Error", error);
      if (window.showToast) window.showToast('Error generating invoice', 'error');
    }
  };




  // F4 and Shift+F4 keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event) => {
      // Check if F4 key is pressed (keyCode 115 or key === 'F4')
      if (event.keyCode === 115 || event.key === 'F4') {
        // Prevent default browser behavior
        event.preventDefault();

        // Only proceed if there are bill items
        if (billItems.length > 0) {
          if (event.shiftKey) {
            // Shift + F4: Auto generate order and print bill

            generateBillAndPrint();
          } else {
            // F4: Open complete payment popup

            setShowPaymentAndCustomerModal(true);
          }
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
  }, [billItems]);

  // Format number respecting user's currency format preference
  const formatNumber = (num) => {
    return formatCurrencySmart(num, state.currencyFormat);
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

  const buildBillItem = (product, quantity, unit, baseUnitHint, fixedAmount = null, selectedBatchId = null) => {
    const productUnit = product.quantityUnit || product.unit || 'pcs';
    const baseUnit = baseUnitHint || getBaseUnit(productUnit);
    const quantityInBaseUnit = convertToBaseUnit(quantity, unit);
    const productUnitInBaseUnitRaw = convertToBaseUnit(1, productUnit);
    const productUnitInBaseUnit = productUnitInBaseUnitRaw === 0 ? 1 : productUnitInBaseUnitRaw;
    const quantityInProductUnits = quantityInBaseUnit / productUnitInBaseUnit;

    // Use batch-aware pricing calculation
    const batchPricing = calculateBatchPricing(product, quantity, unit, saleMode, selectedBatchId);
    const sellingPricePerProductUnit = batchPricing.averageSellingPrice;
    const costPricePerProductUnit = Number(product.costPrice || product.unitPrice || 0);

    // If fixedAmount is provided (for amount-based items), use it directly to ensure exact amount
    // Otherwise, use batch-aware pricing calculation
    const totalSellingPrice = fixedAmount !== null
      ? Math.floor((Number(fixedAmount) || 0) * 100) / 100  // Use exact amount
      : batchPricing.totalSellingPrice;  // Use batch-aware calculation

    // For cost price, use batch-aware calculation
    const totalCostPrice = batchPricing.totalCostPrice;
    const priceCalculation = calculatePriceWithUnitConversion(
      quantity,
      unit,
      product.sellingPrice || product.costPrice || 0,
      product.quantityUnit || 'pcs'
    );

    // Apply smart unit conversion for better display
    const smartUnitResult = convertToSmartUnit(quantity, unit);
    const finalQuantity = smartUnitResult.quantity;
    const finalUnit = smartUnitResult.unit;

    const gstPercent = product.gstPercent || 0;
    const isGstInclusive = product.isGstInclusive !== false;
    let finalTotalSellingPrice = totalSellingPrice;
    let gstAmount = 0;

    if (gstPercent > 0) {
      if (isGstInclusive) {
        // Price is inclusive: totalSellingPrice is the final price, calculate GST from it
        gstAmount = (totalSellingPrice * gstPercent) / (100 + gstPercent);
      } else {
        // Price is exclusive: totalSellingPrice is base, add GST to it
        gstAmount = (totalSellingPrice * gstPercent) / 100;
        finalTotalSellingPrice = totalSellingPrice + gstAmount;
      }
    }

    return {
      id: product.id,
      productId: product._id || product.id,
      name: product.name,
      // Truncate to 2 decimal places (no rounding)
      price: quantity !== 0 ? Math.floor((finalTotalSellingPrice / quantity) * 100) / 100 : 0,
      quantity: finalQuantity,
      unit: finalUnit,
      quantityUnit: product.quantityUnit || 'pcs',
      category: product.category,
      displayQuantity: priceCalculation.displayQuantity,
      maxQuantity: getTotalStockQuantity(product),
      baseUnit,
      productUnit,
      productSellingPricePerUnit: sellingPricePerProductUnit,
      productCostPricePerUnit: costPricePerProductUnit,
      selectedQuantityInProductUnits: quantityInProductUnits,
      gstPercent: gstPercent,
      isGstInclusive: isGstInclusive,
      hsnCode: product.hsnCode || '',
      gstAmount: Math.floor(gstAmount * 100) / 100,
      totalSellingPrice: Math.floor(finalTotalSellingPrice * 100) / 100,
      totalCostPrice,
      quantityInBaseUnit: quantityInBaseUnit,
      // Add batch information for tracking
      usedBatches: batchPricing.usedBatches,
      selectedBatchId: selectedBatchId,
      hasMultipleBatchPrices: batchPricing.usedBatches.length > 1 || (batchPricing.usedBatches.length === 1 && batchPricing.usedBatches[0].quantity < quantityInProductUnits)
    };

  };

  const calculateTotalGst = (items) => {
    return items.reduce((sum, item) => sum + (item.gstAmount || 0), 0);
  };


  return (
    <div className="min-h-screen pb-8 billing-page-container">
      {/* Simple Premium Header */}
      <div className="mb-8 px-4 sm:px-0">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              {getTranslation('billingSystem', state.currentLanguage)}
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {getTranslation('createAndManageBills', state.currentLanguage)}
            </p>
          </div>
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

        {/* Sale Mode & Printer Settings Header Bar */}
        <div className="flex flex-wrap items-center gap-4 py-3 px-4 rounded-none sm:rounded-2xl border-y sm:border mb-6" style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-bg)' }}>
          {/* Sale Mode Selector */}
          <div className="flex items-center gap-3 pr-4 border-r" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-2">
              <ShoppingCart className={`h-4 w-4 ${saleMode === 'wholesale' ? 'text-orange-500' : 'text-indigo-600'}`} />
              <span className="text-sm font-bold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{getTranslation('saleMode', state.currentLanguage)}</span>
            </div>
            <div className="flex bg-gray-100 dark:bg-slate-800/50 p-1 rounded-xl border border-gray-200 dark:border-slate-700">
              <button
                onClick={() => {
                  if (saleMode === 'retail') return;
                  if (billItems.length > 0) {
                    setPendingSaleMode('retail');
                    setShowModeChangeConfirm(true);
                  } else {
                    setSaleMode('retail');
                    showToast(state.currentLanguage === 'hi' ? 'रिटेल मोड में स्विच किया गया' : 'Switched to Retail mode', 'info');
                  }
                }}
                className={`px-4 py-1.5 text-[10px] uppercase tracking-wider font-black rounded-lg transition-all ${saleMode === 'retail' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
              >
                {getTranslation('retail', state.currentLanguage)}
              </button>
              <button
                onClick={() => {
                  if (saleMode === 'wholesale') return;
                  if (billItems.length > 0) {
                    setPendingSaleMode('wholesale');
                    setShowModeChangeConfirm(true);
                  } else {
                    setSaleMode('wholesale');
                    showToast(state.currentLanguage === 'hi' ? 'थोक (Wholesale) मोड में स्विच किया गया' : 'Switched to Wholesale mode', 'info');
                  }
                }}
                className={`px-4 py-1.5 text-[10px] uppercase tracking-wider font-black rounded-lg transition-all ${saleMode === 'wholesale' ? 'bg-white dark:bg-slate-700 shadow-sm text-orange-500' : 'text-gray-400 hover:text-gray-600'}`}
              >
                {getTranslation('wholesale', state.currentLanguage)}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 pr-4 border-r" style={{ borderColor: 'var(--border-subtle)' }}>

            <Printer className="h-4 w-4 text-[var(--brand-primary)] dark:text-white" />
            <span className="text-sm font-bold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{getTranslation('printerSettings', state.currentLanguage)}</span>
          </div>

          {isDirectPrint && (
            <div className="flex items-center gap-4 flex-wrap border-l pl-4" style={{ borderColor: 'var(--border-subtle)' }}>
              {/* Connected Printers List */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{getTranslation('deviceLabel', state.currentLanguage)}</span>
                <div className="relative group">
                  {availablePrinters.length > 0 ? (
                    <select
                      value={selectedPrinter?.id || ''}
                      onChange={(e) => {
                        const printer = availablePrinters.find(p => p.id === e.target.value);
                        setSelectedPrinter(printer || null);
                      }}
                      className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold py-1.5 pl-3 pr-8 rounded-xl border border-transparent hover:border-slate-300 dark:hover:border-slate-600 outline-none appearance-none transition-all cursor-pointer w-full max-w-[120px] sm:max-w-[180px] truncate"
                    >
                      <option value="">Select Printer</option>
                      {availablePrinters.map(printer => (
                        <option key={printer.id} value={printer.id}>
                          {printer.name} ({printer.type})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></div>
                      <span className="text-xs font-bold text-red-600 dark:text-red-400">{getTranslation('noPrinterConnected', state.currentLanguage)}</span>
                    </div>
                  )}
                  {availablePrinters.length > 0 && (
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                      <svg className="w-3.3 h-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleScanPrinters}
                  className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                  title="Connect New Printer"
                >
                  <Usb className="h-4 w-4" />
                </button>
              </div>

              {/* Print Sizes */}
              <div className="flex items-center gap-2 flex-wrap border-l pl-4" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{getTranslation('formatLabel', state.currentLanguage)}</span>
                <div className="flex items-center gap-1.5">
                  {[
                    { id: 'a4', label: 'A4', icon: Receipt },
                    { id: '58mm', label: '58mm', icon: Receipt },
                    { id: '80mm', label: '80mm', icon: Receipt }
                  ].map((format) => (
                    <button
                      key={format.id}
                      onClick={() => setPrintSize(format.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all duration-200 ${printSize === format.id
                        ? 'border-indigo-500 bg-indigo-500 text-white shadow-sm'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 hover:border-slate-300'
                        }`}
                    >
                      <span className="text-xs font-bold">{format.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="sm:ml-auto flex items-center gap-3">
            <button
              onClick={() => setIsDirectPrint(!isDirectPrint)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl border transition-all duration-200 ${isDirectPrint
                ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
            >
              <div className="flex items-center gap-2">
                <Printer className={`h-3.5 w-3.5 ${isDirectPrint ? '' : 'opacity-40'}`} />
                <span className="text-xs font-bold whitespace-nowrap">{isDirectPrint ? getTranslation('directPrintOn', state.currentLanguage) : getTranslation('directPrintOff', state.currentLanguage)}</span>
              </div>
              <div className={`w-8 h-4 rounded-full relative transition-colors duration-200 ${isDirectPrint ? 'bg-emerald-500/80' : 'bg-slate-300 dark:bg-slate-600'}`}>
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white dark:bg-slate-100 rounded-full transition-all duration-200 ${isDirectPrint ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </button>
          </div>
        </div>

        {(() => {
          // Prefer aggregatedUsage from backend (which tracks usage against the *current* plan)
          // If not available, fallback to local count
          const ordUsed = state.aggregatedUsage?.orders?.used !== undefined
            ? state.aggregatedUsage.orders.used
            : (state.orders ? state.orders.filter(o => !o.isDeleted).length : 0);

          const custUsed = state.aggregatedUsage?.customers?.used !== undefined
            ? state.aggregatedUsage.customers.used
            : (state.customers ? state.customers.filter(c => !c.isDeleted).length : 0);

          const { maxOrders, maxCustomers } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
          const ordRemaining = maxOrders === Infinity ? Infinity : Math.max(0, maxOrders - ordUsed);
          const custRemaining = maxCustomers === Infinity ? Infinity : Math.max(0, maxCustomers - custUsed);

          if ((ordRemaining >= 15 || maxOrders === Infinity) && (custRemaining >= 15 || maxCustomers === Infinity)) return null;

          return (
            <div className="flex gap-3 text-xs mt-2">
              {ordRemaining < 15 && maxOrders !== Infinity && (
                <span className="px-2.5 py-1 rounded-md font-medium bg-red-50 text-red-700 border border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/30">
                  {getTranslation('orders', state.currentLanguage)} Left: {ordRemaining}
                </span>
              )}
              {custRemaining < 15 && maxCustomers !== Infinity && (
                <span className="px-2.5 py-1 rounded-md font-medium bg-red-50 text-red-700 border border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/30">
                  {getTranslation('customers', state.currentLanguage)}: {custUsed}/{maxCustomers} ({custRemaining} left)
                </span>
              )}
            </div>
          );
        })()}
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Left Column - Customer & Products */}
        <div className="lg:col-span-2 space-y-5">
          {/* Scanner Card - Rectangular & Compact */}
          {/* Scanner Card - Rectangular & Compact */}


          {/* D-Product Input Section */}
          <div className="card mb-4 p-4 border-l-4 !rounded-none sm:!rounded-2xl border-blue-500 bg-blue-50 dark:bg-slate-800 dark:border-blue-400">
            <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4" /> Add Direct Product (D-Product)
            </h4>
            <div className="flex gap-3">
              <div className="flex-[2]">
                <input
                  type="text"
                  placeholder="Enter Code + Amount (e.g. SH400)"
                  className="input-field w-full"
                  value={dProductInput}
                  onChange={(e) => setDProductInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddDProduct()}
                />
              </div>
              <button
                onClick={handleAddDProduct}
                className="btn-primary px-6 flex-1"
              >
                Add
              </button>
            </div>
          </div>


          {/* Products - Simple & Clean */}
          <div className="card" id="billing-products-section">


            <div className="space-y-3 mb-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder={getTranslation('searchProductsPlaceholder', state.currentLanguage)}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input-field pr-24"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                  <button
                    onClick={() => setShowVoiceModal(true)}
                    className="p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95 text-[#2F3C7E] bg-[#2F3C7E]/10 border border-[#2F3C7E]/15 dark:text-white dark:bg-slate-700 dark:border-slate-600"
                    title="Voice input - Say product names with quantities"
                  >
                    <Mic className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setShowInlineScanner(!showInlineScanner)}
                    className={`p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95 ${showInlineScanner
                      ? 'text-red-600 bg-red-100 border border-red-300 dark:text-red-400 dark:bg-red-900/30 dark:border-red-900/50'
                      : 'text-[#2F3C7E] bg-[#2F3C7E]/10 border border-[#2F3C7E]/15 dark:text-white dark:bg-slate-700 dark:border-slate-600'
                      }`}
                    title={showInlineScanner ? "Close Scanner" : "Open Camera Scanner"}
                  >
                    {showInlineScanner ? <X className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => {
                      const modes = ['list', 'grid', 'large-grid'];
                      const currentIndex = modes.indexOf(productsViewMode);
                      const nextIndex = (currentIndex + 1) % modes.length;
                      setProductsViewMode(modes[nextIndex]);

                      // Adjust height based on mode for better view if it was default
                      if (modes[nextIndex] !== 'list' && productsGridHeight === 'max-h-64') {
                        setProductsGridHeight('max-h-[600px]');
                      } else if (modes[nextIndex] === 'list' && productsGridHeight === 'max-h-[600px]') {
                        setProductsGridHeight('max-h-64');
                      }
                    }}
                    className={`p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95 border ${productsViewMode !== 'list'
                      ? 'text-indigo-600 bg-indigo-50 border-indigo-200 dark:text-indigo-400 dark:bg-indigo-900/30 dark:border-indigo-800'
                      : 'text-[#2F3C7E] bg-[#2F3C7E]/10 border-[#2F3C7E]/15 dark:text-white dark:bg-slate-700 dark:border-slate-600'
                      }`}
                    title="Change Products View Mode (List/Grid)"
                  >
                    {productsViewMode === 'list' ? <LayoutGrid className="h-4 w-4" /> :
                      productsViewMode === 'grid' ? <Square className="h-4 w-4" /> :
                        <Maximize2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {isListening && (
                <div className="bg-blue-50 dark:bg-slate-700/50 border border-blue-200 dark:border-slate-600 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                    <p className="text-sm text-blue-800 font-semibold">
                      {getTranslation('listening', state.currentLanguage)}
                    </p>
                  </div>
                  {voiceTranscript && (
                    <div className="mt-2 p-2 bg-white dark:bg-slate-800 rounded border border-blue-200 dark:border-slate-600">
                      <p className="text-sm text-gray-700 dark:text-slate-200">
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

              <div className="absolute opacity-0 pointer-events-none" style={{ left: '-9999px' }}>
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
                  className="w-0 h-0"
                  aria-hidden="true"
                />
              </div>
            </div>

            <div className={`grid gap-3 ${productsGridHeight} overflow-y-auto ${productsViewMode === 'list'
              ? 'grid-cols-1 md:grid-cols-2'
              : productsViewMode === 'grid'
                ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5'
                : 'grid-cols-2 sm:grid-cols-3'
              }`}>
              {filteredProducts.map(product => {
                // Calculate current quantity in cart for this product
                const cartItem = billItems.find(item => item.id === product.id);
                const currentQuantity = cartItem ? cartItem.quantity : 0;
                const unit = cartItem ? cartItem.unit : (product.quantityUnit || product.unit || 'pcs');

                if (productsViewMode === 'list') {
                  return (
                    <div
                      key={product.id}
                      onClick={() => handleAddProduct(product)}
                      className="p-3 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700/50 hover:border-blue-200 dark:hover:border-slate-600 transition-all duration-200 border dark:border-slate-700 cursor-pointer group relative"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex items-center justify-between">
                        {/* Product Image */}
                        <div className="flex-shrink-0 mr-3">
                          {product.imageUrl || (product.images && product.images.length > 0) ? (
                            <img
                              src={product.imageUrl || product.images[0]}
                              alt={product.name}
                              className="h-10 w-10 rounded-md object-cover border border-gray-200 dark:border-slate-600"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextSibling.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <div className={`h-10 w-10 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-500 ${(product.imageUrl || (product.images && product.images.length > 0)) ? 'hidden' : 'flex'}`}>
                            <Package className="h-5 w-5" />
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium truncate group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors" style={{ color: 'var(--text-primary)' }} title={product.name}>
                            {product.name}
                          </h4>
                          <p className="text-xs mt-0.5 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" style={{ color: 'var(--text-secondary)' }}>
                            ₹{getEffectivePrice(product, saleMode).toFixed(2)}/{product.quantityUnit || product.unit || 'pcs'} • Stock: {getTotalStockQuantity(product)}
                          </p>

                        </div>
                        <div className="flex items-center gap-2 ml-2">
                          {currentQuantity > 0 && (
                            <div className="flex items-center gap-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-full text-xs font-medium">
                              <span>{currentQuantity}</span>
                              <span className="text-green-600">{unit}</span>
                            </div>
                          )}
                          <span className="text-xs text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                            Click
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                } else {
                  // Grid View (grid or large-grid)
                  const isLarge = productsViewMode === 'large-grid';
                  return (
                    <div
                      key={product.id}
                      onClick={() => handleAddProduct(product)}
                      className="flex flex-col border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-200 hover:border-indigo-400 dark:hover:border-indigo-500 cursor-pointer group bg-white dark:bg-slate-800"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="aspect-square relative overflow-hidden bg-gray-50 dark:bg-slate-900/50">
                        {product.imageUrl || (product.images && product.images.length > 0) ? (
                          <img
                            src={product.imageUrl || product.images[0]}
                            alt={product.name}
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              e.currentTarget.nextSibling.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div className={`absolute inset-0 items-center justify-center text-gray-300 dark:text-slate-700 ${(product.imageUrl || (product.images && product.images.length > 0)) ? 'hidden' : 'flex'}`}>
                          <Package className={isLarge ? "h-12 w-12" : "h-8 w-8"} />
                        </div>

                        {currentQuantity > 0 && (
                          <div className="absolute top-1 right-1 bg-green-500 text-white rounded-full px-2 h-6 flex items-center justify-center text-[10px] font-bold shadow-md z-10 border border-white whitespace-nowrap">
                            {currentQuantity} <span className="ml-1 font-medium opacity-90">{unit}</span>
                          </div>
                        )}

                      </div>

                      <div className="p-2 flex-grow flex flex-col justify-between">
                        <h4 className={`font-bold truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors ${isLarge ? 'text-sm' : 'text-xs'}`} style={{ color: 'var(--text-primary)' }} title={product.name}>
                          {product.name}
                        </h4>
                        <div className="mt-1">
                          <div className="flex items-center justify-between">
                            <p className={`font-bold text-indigo-600 dark:text-indigo-400 ${isLarge ? 'text-base' : 'text-sm'}`}>
                              ₹{getEffectivePrice(product, saleMode).toFixed(0)}
                            </p>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${getTotalStockQuantity(product) > 0 ? 'bg-amber-50 text-amber-700 border border-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900/30' : 'bg-red-50 text-red-700 border border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/30'}`}>
                              {getTotalStockQuantity(product)} {product.quantityUnit || product.unit || 'pcs'}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-500 dark:text-slate-400 truncate">
                            /{product.quantityUnit || product.unit || 'pcs'}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
              })}
            </div>
          </div>

          {/* Cart Items - Simple & Clean */}
          <div className="card" id="billing-cart-section">
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
                  const handleEditQuantity = (prod, qty, unit, fixedAmount, selectedBatchId) => {
                    return handleReplaceQuantity(prod, qty, unit, fixedAmount, selectedBatchId);
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
                          _currentUnit: item.unit || item.quantityUnit || 'pcs',
                          _selectedBatchId: item.selectedBatchId
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
                      {/* Product Image & Info */}
                      <div className="flex items-center gap-3 flex-1 min-w-0 w-full sm:w-auto">
                        <div className="flex-shrink-0">
                          {product.imageUrl || (product.images && product.images.length > 0) ? (
                            <img
                              src={product.imageUrl || product.images[0]}
                              alt={product.name}
                              className="h-10 w-10 rounded-md object-cover border border-gray-200 dark:border-slate-600"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextSibling.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <div className={`h-10 w-10 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-500 ${(product.imageUrl || (product.images && product.images.length > 0)) ? 'hidden' : 'flex'}`}>
                            <Package className="h-5 w-5" />
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-medium break-words sm:truncate" style={{ color: 'var(--text-primary)' }}>
                              {item.name}
                            </h4>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                              {formatQuantityWithUnit(item.quantity, item.unit || item.quantityUnit || 'pcs')}
                            </span>
                          </div>
                          <p className="text-xs mt-0.5 whitespace-nowrap overflow-x-auto scrollbar-hide" style={{ color: 'var(--text-secondary)' }} title={`${formatNumber(item.price)}/${item.unit || item.quantityUnit || 'pcs'}`}>
                            {formatNumberOnly(item.price)}/{item.unit || item.quantityUnit || 'pcs'}
                          </p>
                        </div>
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
                        <div className="relative flex-shrink-0">
                          <span className={`font-bold text-base sm:text-base sm:w-20 sm:text-right whitespace-nowrap overflow-x-auto scrollbar-hide ${item.hasMultipleBatchPrices ? 'cursor-help' : ''}`} style={{ color: 'var(--text-primary)' }} title={formatNumber(getItemTotalAmount(item))}>
                            {formatNumber(getItemTotalAmount(item))}
                          </span>

                          {/* Batch details tooltip for items with multiple batch prices */}
                          {item.hasMultipleBatchPrices && item.usedBatches && item.usedBatches.length > 0 && (
                            <div className="absolute z-20 invisible group-hover:visible bg-gray-900 text-white text-xs rounded-lg py-2 px-3 mt-1 whitespace-nowrap shadow-lg right-0 top-full">
                              <div className="font-semibold mb-1">Batch Details:</div>
                              {item.usedBatches.map((batch, index) => (
                                <div key={batch.batchId || index} className="flex justify-between gap-4">
                                  <span>{batch.batchNumber || `Batch ${index + 1}`}:</span>
                                  <span>{batch.quantity.toFixed(2)} × ₹{batch.sellingPrice.toFixed(2)}</span>
                                </div>
                              ))}
                              <div className="border-t border-gray-600 mt-1 pt-1 font-semibold">
                                Total: ₹{getItemTotalAmount(item).toFixed(2)}
                              </div>
                            </div>
                          )}
                        </div>

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
        <div className="lg:col-span-1" id="billing-summary-section">
          <div className="card sticky top-4">
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              {getTranslation('summary', state.currentLanguage)}
            </h3>

            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-secondary)' }}>{getTranslation('subtotal', state.currentLanguage)}</span>
                <span className="font-medium whitespace-nowrap overflow-x-auto scrollbar-hide max-w-[120px] text-right text-emerald-600" title={formatNumber(subtotal)}>
                  {formatNumber(subtotal)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-secondary)' }}>{getTranslation('discount', state.currentLanguage)}</span>
                <span className="font-medium whitespace-nowrap overflow-x-auto scrollbar-hide max-w-[120px] text-right text-rose-600" title={`- ${formatNumber(discountAmount)}`}>
                  - {formatNumber(discountAmount)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-secondary)' }}>{getTranslation('tax', state.currentLanguage)}</span>
                <span className="font-medium whitespace-nowrap overflow-x-auto scrollbar-hide max-w-[120px] text-right" style={{ color: 'var(--text-primary)' }} title={formatNumber(taxAmount)}>
                  {formatNumber(taxAmount)}
                </span>
              </div>
              <div className="h-px my-3" style={{ background: 'var(--border-subtle)' }}></div>
              <div className="flex justify-between text-lg font-bold">
                <span style={{ color: 'var(--text-primary)' }}>{getTranslation('total', state.currentLanguage)}</span>
                <span className="whitespace-nowrap overflow-x-auto scrollbar-hide max-w-[150px] text-right text-emerald-600 font-bold" title={formatNumber(total)}>
                  {formatNumber(total)}
                </span>
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {getTranslation('discountPercent', state.currentLanguage)}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={discount || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || (/^[0-9]*\.?[0-9]*$/.test(value) && parseFloat(value || 0) <= 100)) {
                      setDiscount(value === '' ? '' : value);
                    }
                  }}
                  className="input-field text-sm"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {getTranslation('taxPercent', state.currentLanguage)}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={tax || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || (/^[0-9]*\.?[0-9]*$/.test(value) && parseFloat(value || 0) <= 100)) {
                      setTax(value === '' ? '' : value);
                    }
                  }}
                  className="input-field text-sm"
                  placeholder="0"
                />
              </div>

              <button
                onClick={handleQuickPayClick}
                className={`w-full btn-success mt-4 flex items-center justify-center ${isPlanExpired(state) ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                disabled={isGeneratingBill.current || billItems.length === 0 || isPlanExpired(state)}
              >
                <Wallet className="h-4 w-4 mr-2" />
                {getTranslation('quickPay', state.currentLanguage)}
              </button>

              <button
                onClick={handleGenerateBillClick}
                className={`w-full btn-primary mt-2 flex items-center justify-center ${isPlanExpired(state) ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                disabled={isGeneratingBill.current || billItems.length === 0 || isPlanExpired(state)}
              >
                <Zap className="h-4 w-4 mr-2" />
                {getTranslation('generateBill', state.currentLanguage)}
              </button>
            </div>
          </div>
        </div>

        {showQuantityModal && selectedProduct && (
          <QuantityModal
            product={selectedProduct}
            saleMode={saleMode}
            onClose={() => {
              setShowQuantityModal(false);
              setSelectedProduct(null);
            }}
            onAdd={(product, quantity, unit, fixedAmount, selectedBatchId) => {
              const addHandler = selectedProduct._editHandler || handleAddWithQuantity;
              const added = addHandler(product, quantity, unit, fixedAmount, selectedBatchId);
              return added;
            }}
          />
        )}


        {/* Inline Camera Scanner - Full Camera View */}


        {showCameraScanner && (
          <BarcodeScanner
            onScan={(barcode) => {
              setBarcodeInput(barcode);
              handleBarcodeScan(barcode);
              // Keep scanner open after successful scan - user must close manually
            }}
            onClose={() => setShowCameraScanner(false)}
            keepOpen={true}
          />
        )}

        {/* QR Code Modal */}
        {showQRCode && qrCodeData && (
          <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border dark:border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
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
                <div className="bg-gray-100 dark:bg-slate-700/50 p-4 rounded-lg mb-4">
                  <div className="text-sm text-gray-600 dark:text-slate-300 mb-2">Bill ID: {qrCodeData.billId}</div>
                  <div className="text-sm text-gray-600 dark:text-slate-300 mb-2">Customer: {qrCodeData.customerName}</div>
                  <div className="text-sm text-gray-600 dark:text-slate-300 mb-2">Total: ₹{qrCodeData.total.toFixed(2)}</div>
                  <div className="text-sm text-gray-600 dark:text-slate-300 mb-2">Date: {formatDate(qrCodeData.date)}</div>
                </div>

                {/* Simple QR Code representation */}
                <div className="bg-white dark:bg-slate-200 border-2 border-gray-300 p-4 rounded-lg mb-4 inline-block">
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
                    <Printer className="h-4 w-4 mr-2" />
                    Print Bill
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
                backgroundColor: state.darkMode ? '#1e293b' : 'white',
                borderRadius: '12px',
                padding: '24px',
                maxWidth: '500px',
                width: '90%',
                boxShadow: state.darkMode ? '0 20px 25px -5px rgba(0, 0, 0, 0.4)' : '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                border: state.darkMode ? '1px solid #334155' : 'none'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{
                fontSize: '20px',
                fontWeight: '600',
                marginBottom: '16px',
                color: state.darkMode ? '#f8fafc' : '#111827'
              }}>
                {foundCustomers.length === 1 ? 'Customer Found' : 'Multiple Customers Found'}
              </h3>

              <p style={{
                fontSize: '14px',
                color: state.darkMode ? '#94a3b8' : '#6b7280',
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
                        backgroundColor: state.darkMode ? '#334155' : '#f9fafb',
                        border: '2px solid',
                        borderColor: state.darkMode ? '#475569' : '#e5e7eb',
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
                        color: state.darkMode ? '#f8fafc' : '#111827',
                        marginBottom: '8px'
                      }}>
                        {customer.name}
                      </div>
                      <div style={{
                        fontSize: '14px',
                        color: state.darkMode ? '#94a3b8' : '#6b7280',
                        marginBottom: '4px'
                      }}>
                        📱 Mobile: {mobile}
                      </div>
                      <div style={{
                        fontSize: '14px',
                        color: dueAmount > 0 ? (state.darkMode ? '#fb923c' : '#ea580c') : (state.darkMode ? '#94a3b8' : '#6b7280'),
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
                    backgroundColor: state.darkMode ? '#334155' : '#f3f4f6',
                    color: state.darkMode ? '#f8fafc' : '#374151',
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
                  {getTranslation('newCustomer', state.currentLanguage)}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sale Mode Change Confirmation Modal */}
      {showModeChangeConfirm && (
        <SaleModeConfirmModal
          mode={pendingSaleMode}
          onClose={() => {
            setShowModeChangeConfirm(false);
            setPendingSaleMode(null);
          }}
          onConfirm={() => {
            setBillItems([]);
            setSaleMode(pendingSaleMode);
            setShowModeChangeConfirm(false);
            setPendingSaleMode(null);
            const modeName = pendingSaleMode === 'retail'
              ? (state.currentLanguage === 'hi' ? 'रिटेल' : 'Retail')
              : (state.currentLanguage === 'hi' ? 'थोक (Wholesale)' : 'Wholesale');
            showToast(
              state.currentLanguage === 'hi'
                ? `कार्ट खाली कर दी गई और ${modeName} मोड में स्विच किया गया`
                : `Cart cleared and switched to ${modeName} mode`,
              'info'
            );
          }}
        />
      )}

      {/* Voice Instructions Modal */}
      {showVoiceInstructions && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col mx-4 border dark:border-slate-700/60 transition-colors">
            <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2 tracking-tight">
                <Mic className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                {getTranslation('howToUseVoice', state.currentLanguage)}
              </h2>
            </div>

            <div className="overflow-y-auto px-6 flex-1">
              <div className="space-y-4 mb-6">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/30 rounded-xl p-4">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-3 flex items-center gap-2">
                    <Smartphone className="h-4 w-4" />
                    {getTranslation('speakingInstructions', state.currentLanguage)}
                  </h3>
                  <ul className="space-y-2.5 text-sm text-blue-800 dark:text-blue-400/90">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 flex-shrink-0"></span>
                      <span>{getTranslation('singleProductInstruction', state.currentLanguage)}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 flex-shrink-0"></span>
                      <span>{getTranslation('multipleProductsInstruction', state.currentLanguage)}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 flex-shrink-0"></span>
                      <span>{getTranslation('quantityUpdatesInstruction', state.currentLanguage)}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 flex-shrink-0"></span>
                      <span>{getTranslation('unitsSupportedInstruction', state.currentLanguage)}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 flex-shrink-0"></span>
                      <span>{getTranslation('piecesInstruction', state.currentLanguage)}</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 rounded-xl p-4">
                  <h3 className="font-semibold text-amber-900 dark:text-amber-300 mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {getTranslation('tips', state.currentLanguage)}
                  </h3>
                  <ul className="space-y-2 text-sm text-amber-800 dark:text-amber-400/90 font-medium">
                    <li>• {getTranslation('speakClearly', state.currentLanguage)}</li>
                    <li>• {getTranslation('autoMerge', state.currentLanguage)}</li>
                    <li>• {getTranslation('clickMicToStop', state.currentLanguage)}</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-6 pt-4 border-t border-gray-100 dark:border-slate-800 flex-shrink-0">
              <input
                type="checkbox"
                id="dontShowAgain"
                checked={dontShowAgainChecked}
                onChange={(e) => setDontShowAgainChecked(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer bg-white dark:bg-slate-800"
              />
              <label htmlFor="dontShowAgain" className="text-sm font-medium text-gray-700 dark:text-slate-300 cursor-pointer">
                {getTranslation('dontShowAgain', state.currentLanguage)}
              </label>
            </div>

            <div className="flex justify-end gap-3 p-6 pt-0 flex-shrink-0">
              <button
                onClick={() => handleVoiceInstructionsOK(dontShowAgainChecked)}
                className="w-full py-3 bg-indigo-600 dark:bg-indigo-500 text-white rounded-xl hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-all font-bold shadow-lg shadow-indigo-500/20 active:scale-[0.98]"
              >
                {getTranslation('gotItStart', state.currentLanguage)}
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
                {isListening ? getTranslation('listening', state.currentLanguage) : getTranslation('starting', state.currentLanguage)}
              </p>
              <p className="text-white/70 text-xs sm:text-sm mb-2 px-2">
                {getTranslation('voiceInputGuide', state.currentLanguage)}
              </p>

              {/* Feature Disclaimer */}
              <div className="mb-6 sm:mb-8 px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg max-w-md">
                <p className="text-yellow-200/80 text-[10px] sm:text-xs text-center leading-relaxed">
                  ⚠️ This feature is not working 100% proper, it can make mistakes. We will update it as soon as possible.
                </p>
              </div>

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
                            <div className="flex flex-col items-end">
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
                              </span>
                              {!item.matched && <span className="text-red-400 text-[10px] sm:text-xs font-bold px-2 py-0.5 bg-red-400/10 rounded mt-1">Product Missing</span>}
                              {item.matched && !item.unitCompatible && (
                                <div className="flex flex-col items-end gap-1 mt-1">
                                  <span className="text-yellow-400 text-[10px] sm:text-xs font-bold px-2 py-0.5 bg-yellow-400/10 rounded border border-yellow-400/30">Wrong Unit: {item.unit}</span>
                                  <div className="flex gap-1">
                                    {(item.possibleUnits || [item.correctUnit]).map(unitOption => (
                                      <button
                                        key={unitOption}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const oldTranscript = voiceModalTranscript;
                                          const textToReplace = item.rawMatchedText;
                                          const fixIndex = item.rawIndex;

                                          if (textToReplace && fixIndex !== undefined) {
                                            const before = oldTranscript.substring(0, fixIndex);
                                            const after = oldTranscript.substring(fixIndex + textToReplace.length);
                                            const replacement = `${item.quantity} ${unitOption}`;
                                            const newTranscript = before + replacement + after;

                                            setVoiceModalTranscript(newTranscript);
                                            accumulatedTranscriptRef.current = newTranscript;
                                            showToast(`Fixed unit to ${unitOption}`, 'success');
                                            speakFeedback(`Changed to ${unitOption}`);
                                          }
                                        }}
                                        className="text-[10px] sm:text-xs bg-indigo-500 hover:bg-indigo-400 text-white px-2 py-1 rounded-md font-bold transition-all active:scale-90"
                                      >
                                        Use {unitOption}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
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

              {/* AI Feedback Banner */}
              {window.speechSynthesis.speaking && (
                <div className="w-full max-w-md mb-6 py-2 px-4 bg-indigo-500/20 border border-indigo-500/40 rounded-full flex items-center gap-3 animate-bounce">
                  <div className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></div>
                  <span className="text-indigo-200 text-sm font-bold italic">Assistant is talking...</span>
                </div>
              )}

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
                    const itemsToAdd = allItems.filter(item => !removedItems.has(item.id) && item.matched && item.unitCompatible);

                    if (itemsToAdd.length === 0) {
                      const hasIssues = allItems.some(i => !i.matched || !i.unitCompatible);
                      showToast(hasIssues ? getTranslation('fixIssuesBeforeAdding', state.currentLanguage) : getTranslation('noItemsFound', state.currentLanguage), 'warning');
                      if (hasIssues) speakFeedback(getTranslation('fixErrorsInList', state.currentLanguage));
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
                    showToast(getTranslation('productsAddedToCart', state.currentLanguage).replace('{count}', itemsToAdd.length), 'success');

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
                  <span className="hidden sm:inline">{getTranslation('confirmAndAdd', state.currentLanguage)}</span>
                  <span className="sm:hidden">{getTranslation('confirm', state.currentLanguage)}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Screen Scanner Modal using Premium UI */}
      {showInlineScanner && (
        <BarcodeScanner
          onScan={(barcode) => {
            setBarcodeInput(barcode);
            handleBarcodeScan(barcode);
          }}
          onClose={() => setShowInlineScanner(false)}
          inline={false}
          keepOpen={true}
        >
          {/* INJECTED CART VIEW FOR BILLING SCANNER */}
          <div className="w-full bg-white dark:bg-slate-900 rounded-none -mt-6 flex flex-col shadow-[0_-4px_20px_rgba(0,0,0,0.5)] max-h-[40vh] overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/90 dark:bg-slate-800/90 backdrop-blur-sm sticky top-0 z-20">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm sm:text-base">
                <ShoppingCart className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-600" />
                {getTranslation('cartItems', state.currentLanguage) || 'Cart Items'}
                <span className="bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs px-2 py-0.5 rounded-full">
                  {billItems.length}
                </span>
              </h3>
              <div className="text-sm font-bold text-gray-900 dark:text-white">
                {formatCurrencySmart(billItems.reduce((sum, item) => sum + getItemTotalAmount(item), 0), state.currencyFormat)}
              </div>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto">
              {billItems.length === 0 ? (
                <div className="h-32 flex flex-col items-center justify-center text-gray-400 space-y-2">
                  <ScanLine className="h-10 w-10 opacity-20" />
                  <p className="text-xs sm:text-sm">{getTranslation('scanToAddToCart', state.currentLanguage) || 'Scan items to add to cart'}</p>
                </div>
              ) : (
                [...billItems].reverse().map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 animate-slideUp">
                    <div className="flex-1 min-w-0 mr-3">
                      <h4 className="font-medium text-gray-900 dark:text-white truncate text-xs sm:text-sm">
                        {item.name}
                      </h4>
                      <p className="text-[10px] sm:text-xs text-gray-500 dark:text-slate-400">
                        {formatCurrencySmart(item.price, state.currencyFormat)} / {item.unit || item.quantityUnit || 'pcs'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 mr-3">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-600 shadow-sm transition-all active:scale-90"
                        title="Decrease quantity"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-xs sm:text-sm font-bold min-w-[30px] text-center text-gray-900 dark:text-white">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-600 shadow-sm transition-all active:scale-90"
                        title="Increase quantity"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="text-right flex items-center gap-3">
                      <div className="hidden sm:block">
                        <p className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm">
                          {formatCurrencySmart(getItemTotalAmount(item), state.currencyFormat)}
                        </p>
                      </div>
                      <button
                        onClick={() => removeFromBill(item.id)}
                        className="p-2 sm:p-2 rounded-lg text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                        title="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Finish Button */}
            <div className="p-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-800">
              <button
                onClick={() => setShowInlineScanner(false)}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 dark:shadow-none transition-all active:scale-95 flex items-center justify-center gap-2 text-sm"
              >
                <Check className="h-4 w-4" />
                {getTranslation('finishScanning', state.currentLanguage) || 'Finish Scanning'}
              </button>
            </div>
          </div>
        </BarcodeScanner>
      )}

      <QuickNavButtons
        onNav={(id) => {
          const element = document.getElementById(id);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }}
      />
    </div>
  );
};

// Quick Navigation Component for Mobile & Desktop
const QuickNavButtons = ({ onNav }) => {
  const { state } = useApp();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-24 right-6 sm:bottom-10 sm:right-10 flex flex-col items-end gap-4 z-[100] pointer-events-none">
      <div className={`flex flex-col gap-4 transition-all duration-300 transform ${isOpen ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-10 opacity-0 pointer-events-none'}`}>
        <button
          onClick={() => { onNav('billing-products-section'); setIsOpen(false); }}
          className="flex items-center gap-2 group pointer-events-auto"
        >
          <span className="bg-white dark:bg-slate-800 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg shadow-xl border dark:border-slate-700 text-gray-600 dark:text-gray-300">Products</span>
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 flex items-center justify-center active:scale-90 transition-all border-2 border-white/20">
            <LayoutGrid className="w-6 h-6" />
          </div>
        </button>

        <button
          onClick={() => { onNav('billing-cart-section'); setIsOpen(false); }}
          className="flex items-center gap-2 group pointer-events-auto"
        >
          <span className="bg-white dark:bg-slate-800 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg shadow-xl border dark:border-slate-700 text-gray-600 dark:text-gray-300">Cart</span>
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 flex items-center justify-center active:scale-90 transition-all border-2 border-white/20">
            <ShoppingCart className="w-6 h-6" />
          </div>
        </button>

        <button
          onClick={() => { onNav('billing-summary-section'); setIsOpen(false); }}
          className="flex items-center gap-2 group pointer-events-auto"
        >
          <span className="bg-white dark:bg-slate-800 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg shadow-xl border dark:border-slate-700 text-gray-600 dark:text-gray-300">Summary</span>
          <div className="w-12 h-12 rounded-2xl bg-amber-600 text-white shadow-lg shadow-amber-600/20 flex items-center justify-center active:scale-90 transition-all border-2 border-white/20">
            <Calculator className="w-6 h-6" />
          </div>
        </button>
      </div>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-14 h-14 rounded-2xl shadow-2xl flex items-center justify-center transition-all duration-300 active:scale-90 pointer-events-auto border-2 border-white/20 ${isOpen ? 'bg-white rotate-45 shadow-none' : 'bg-black dark:bg-white shadow-black/20 dark:shadow-white/20'}`}
      >
        <Plus className={`w-8 h-8 transition-colors ${isOpen ? 'text-black' : (state.darkMode ? 'text-black' : 'text-white')}`} />
      </button>
    </div>
  );
};

export default Billing;

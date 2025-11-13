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
  Share2
} from 'lucide-react';
import jsPDF from 'jspdf';
import { calculatePriceWithUnitConversion, checkStockAvailability, convertToBaseUnit, convertFromBaseUnit, getBaseUnit, isCountBasedUnit, isDecimalAllowedUnit } from '../../utils/unitConversion';
import QuantityModal from './QuantityModal';
import UPIPaymentModal from './UPIPaymentModal';
import { getTranslation } from '../../utils/translations';
import { getSellerIdFromAuth } from '../../utils/api';
import { getPlanLimits, canAddOrder, canAddCustomer } from '../../utils/planUtils';
import { sanitizeMobileNumber, isValidMobileNumber } from '../../utils/validation';
import BarcodeScanner from '../BarcodeScanner/BarcodeScanner';

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
  const [showQRCode, setShowQRCode] = useState(false);
  const [qrCodeData, setQrCodeData] = useState(null);
  const [showUPIPayment, setShowUPIPayment] = useState(false);
  const [currentBill, setCurrentBill] = useState(null);
  const [pendingOrder, setPendingOrder] = useState(null);
  const isGeneratingBill = useRef(false);
  const sellerUpiId = (state.currentUser?.upiId || state.upiId || '').trim();
  const [upiIdDraft, setUpiIdDraft] = useState(sellerUpiId);
  const [isSavingUpi, setIsSavingUpi] = useState(false);
  const draftRestoredRef = useRef(false);
  const draftSyncEnabledRef = useRef(false);
  const lastDraftSnapshotRef = useRef(null);

  const { maxOrders, maxCustomers } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
  const activeOrders = state.orders.filter(order => !order.isDeleted);
  const activeCustomers = state.customers.filter(customer => !customer.isDeleted);
  const planNameLabel = state.currentPlanDetails?.planName
    || (state.currentPlan ? `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}` : 'Current');
  const orderLimitReached = !canAddOrder(activeOrders.length, state.currentPlan, state.currentPlanDetails);
  const customerLimitReached = !canAddCustomer(activeCustomers.length, state.currentPlan, state.currentPlanDetails);
  const orderLimitLabel = maxOrders === Infinity ? 'Unlimited' : maxOrders;
  const customerLimitLabel = maxCustomers === Infinity ? 'Unlimited' : maxCustomers;
  const ordersUsed = state.currentPlanDetails?.totalOrders ?? activeOrders.length;
  const customersUsed = state.currentPlanDetails?.totalCustomers ?? activeCustomers.length;

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
    }, 100);
  };

  const showOrderLimitWarning = () => {
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

  useEffect(() => () => {
    if (barcodeScanTimeoutRef.current) {
      clearTimeout(barcodeScanTimeoutRef.current);
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
      handleAddProduct(product); // Open quantity modal
    } else {
      const message = state.currentLanguage === 'hi' 
        ? `${getTranslation('productNotFound', state.currentLanguage)}: ${barcode}. ${getTranslation('pleaseAddProductFirst', state.currentLanguage)}.`
        : `${getTranslation('productNotFound', state.currentLanguage)}: ${barcode}. ${getTranslation('pleaseAddProductFirst', state.currentLanguage)}.`;
      showToast(message, 'error');
    }
    setBarcodeInput('');
  };

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

    const stockCheck = checkStockAvailability(product, sanitizedQuantity, unit);

    if (!stockCheck.available) {
      if (stockCheck.error) {
        showToast(stockCheck.error, 'error');
        return false;
      }

      const message = state.currentLanguage === 'hi'
        ? `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}, ${getTranslation('requested', state.currentLanguage)}: ${stockCheck.requestedDisplay}. ${getTranslation('pleaseReduceQuantity', state.currentLanguage)}.`
        : `⚠️ ${getTranslation('lowStockWarning', state.currentLanguage)}! ${getTranslation('available', state.currentLanguage)}: ${stockCheck.stockDisplay}, ${getTranslation('requested', state.currentLanguage)}: ${stockCheck.requestedDisplay}. ${getTranslation('pleaseReduceQuantity', state.currentLanguage)}.`;
      showToast(message, 'warning');
      return false;
    }

    const existingItemIndex = billItems.findIndex(item => item.id === product.id && item.unit === unit);

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
    if (!ensureOrderCapacity()) {
      isGeneratingBill.current = false;
      return false;
    }

    dispatch({ type: ActionTypes.ADD_ORDER, payload: order });

    // Update product quantities
    billItemsSnapshot.forEach(item => {
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

      const updatedProduct = {
        ...product,
        quantity: roundedUpdatedQuantity,
        stock: roundedUpdatedQuantity
      };

      dispatch({
        type: ActionTypes.UPDATE_PRODUCT,
        payload: updatedProduct,
        meta: { suppressProductSync: true }
      });
    });

    if (isDueLikePayment) {
      const customerMobileNumber = sanitizedMobile;
      let customer = matchedDueCustomer || allCustomers.find(
        (c) => c.name && c.name.toLowerCase() === customerName.toLowerCase()
      );

      if (customer) {
        const updatedCustomer = {
          ...customer,
          balanceDue: (customer.balanceDue || customer.dueAmount || 0) + bill.total,
          dueAmount: (customer.dueAmount || customer.balanceDue || 0) + bill.total,
          mobileNumber: (useCustomNameFlag && customerMobileNumber)
            ? customerMobileNumber
            : (customer.mobileNumber || customer.phone || '')
        };
        dispatch({ type: ActionTypes.UPDATE_CUSTOMER, payload: updatedCustomer });
      } else {
        if (customerLimitReached) {
          showCustomerLimitWarning();
          isGeneratingBill.current = false;
          return false;
        }

        const newCustomer = {
          id: Date.now().toString(),
          name: customerName,
          balanceDue: bill.total,
          dueAmount: bill.total,
          mobileNumber: customerMobileNumber || '',
          email: '',
          address: '',
          createdAt: new Date().toISOString()
        };
        dispatch({ type: 'ADD_CUSTOMER', payload: newCustomer });
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

    if (sendWhatsAppInvoiceFlag) {
      openWhatsAppInvoice(bill, sanitizedMobile || effectiveMobile);
    }

    resetBillingForm();
    setPendingOrder(null);
    setShowUPIPayment(false);
    isGeneratingBill.current = false;
    return true;
  };

  const customerNameProvided = useCustomName
    ? (customCustomerName || '').trim()
    : (state.customers.find(c => c.id === selectedCustomer)?.name || selectedCustomer || '').toString().trim();

  const generateBill = () => {
    // Prevent multiple simultaneous calls
    if (isGeneratingBill.current) {
      console.warn('⚠️ Bill generation already in progress, ignoring duplicate call');
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
    // For other payment methods, customer name is required
    let customerName = useCustomName ? customCustomerName : (state.customers.find(c => c.name === selectedCustomer)?.name || selectedCustomer);
    
  // Only require customer name for non-cash payment methods
  if (paymentMethod !== 'cash' && paymentMethod !== 'upi') {
      if (!customerName || customerName.trim() === '') {
        showToast(getTranslation('pleaseEnterCustomerName', state.currentLanguage), 'warning');
        isGeneratingBill.current = false;
        return;
      }
    } else {
      // For cash payments, use default if no customer name provided
      if (!customerName || customerName.trim() === '') {
        customerName = 'Walk-in Customer';
      }
    }

    const effectiveMobile = billingMobile.trim();
    const sanitizedMobile = sanitizeMobileNumber(effectiveMobile);

    if (sendWhatsAppInvoice) {
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

    // Validate customer name and mobile number for due payment method only
    if (paymentMethod === 'due' || paymentMethod === 'credit') {
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
    
    const isDueLikePayment = paymentMethod === 'due' || paymentMethod === 'credit';
    let matchedDueCustomer = null;
    if (isDueLikePayment && customerName) {
      matchedDueCustomer = activeCustomers.find(
        (c) => c.name && c.name.toLowerCase() === customerName.toLowerCase()
      );
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

    // Find customer ID if customer exists
    let customerId = null;
    if (!useCustomName && selectedCustomer) {
      const selectedCustomerObj = state.customers.find(c => c.id === selectedCustomer || c.name === selectedCustomer);
      if (selectedCustomerObj) {
        customerId = selectedCustomerObj.id; // Use frontend ID, will be mapped to MongoDB _id in sync
      }
    } else if (useCustomName && customerName) {
      // Try to find existing customer by name
      const existingCustomer = state.customers.find(c => c.name.toLowerCase() === customerName.toLowerCase());
      if (existingCustomer) {
        customerId = existingCustomer.id;
      }
    }

    if (!customerId && sanitizedMobile) {
      const existingByMobile = state.customers.find(c => sanitizeMobileNumber(c.mobileNumber || c.phone || '') === sanitizedMobile);
      if (existingByMobile) {
        customerId = existingByMobile.id;
        if (!customerName || customerName === 'Walk-in Customer') {
          customerName = existingByMobile.name || customerName;
        }
      }
    }

    if (
      !customerId &&
      sanitizedMobile &&
      customerName &&
      customerName.trim() !== '' &&
      customerName.trim().toLowerCase() !== 'walk-in customer'
    ) {
      if (customerLimitReached) {
        showCustomerLimitWarning();
      } else {
        const newCustomer = {
          id: Date.now().toString(),
          name: customerName.trim(),
          mobileNumber: sanitizedMobile,
          phone: sanitizedMobile,
          email: '',
          address: '',
          balanceDue: 0,
          dueAmount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'billing_auto'
        };
        dispatch({ type: ActionTypes.ADD_CUSTOMER, payload: newCustomer });
        customerId = newCustomer.id;
      }
    }

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

      const totalSellingPrice =
        billItem.totalSellingPrice ??
        Math.round(((billItem.price || 0) * (billItem.quantity || 0)) * 100) / 100;
      const totalCostPrice =
        billItem.totalCostPrice ??
        (product ? getItemTotalCost(billItem, product) : Math.round(((product?.costPrice || product?.unitPrice || 0) * (billItem.quantity || 0)) * 100) / 100);
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

      const unitSellingPrice =
        roundedQuantity !== 0 ? Math.round((parsedTotalSelling / roundedQuantity) * 100) / 100 : 0;
      const unitCostPrice =
        roundedQuantity !== 0 ? Math.round((parsedTotalCost / roundedQuantity) * 100) / 100 : 0;
      const roundedTotalSelling = Math.round(parsedTotalSelling * 100) / 100;
      const roundedTotalCost = Math.round(parsedTotalCost * 100) / 100;

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

    // Normalize total amount to avoid floating point precision issues
    const normalizedTotal = Math.round(total * 100) / 100;
    
    if (!ensureOrderCapacity()) {
      return;
    }

    // Create Order object matching MongoDB Order schema
    const order = {
      id: Date.now().toString(),
      sellerId: sellerId,
      customerId: customerId,
      customerName: customerName,
      customerMobile: sanitizedMobile || effectiveMobile || '',
      paymentMethod: paymentMethod,
      items: orderItems,
      totalAmount: normalizedTotal,
      subtotal: subtotal,
      discountPercent: discount,
      taxPercent: tax,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSynced: false
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
      customerMobile: sanitizedMobile || effectiveMobile,
      date: order.createdAt,
      status: paymentMethod === 'upi' ? 'pending' : 'completed',
      storeName: state.storeName || 'Grocery Store'
    };

    const finalizePayload = {
      order,
      bill,
      billItemsSnapshot,
      matchedDueCustomer,
      isDueLikePayment,
      customerName,
      sanitizedMobile,
      useCustomNameFlag: useCustomName,
      sendWhatsAppInvoiceFlag: sendWhatsAppInvoice,
      effectiveMobile
    };

    if (paymentMethod === 'upi') {
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
      const successMessage = `${getTranslation('billGeneratedSuccessfully', state.currentLanguage)}! ${getTranslation('customers', state.currentLanguage)}: ${bill.customerName}, ${getTranslation('total', state.currentLanguage)}: ₹${bill.total.toFixed(2)}`;
      showToast(successMessage, 'success');
    }
  };

  const handlePaymentReceived = (paymentSummary) => {
    if (!pendingOrder) {
      showToast('No pending online payment to confirm.', 'warning');
      setShowUPIPayment(false);
      setCurrentBill(null);
      return;
    }

    const success = finalizeOrder(pendingOrder);

    if (success) {
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
      const customerName = useCustomName ? customCustomerName : (state.customers.find(c => c.id === selectedCustomer)?.name || '');
      
      // Customer name is required for due/credit payments
      if (!customerName || customerName.trim() === '') {
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
          const updatedProduct = {
            ...product,
            id: product.id, // Ensure ID is preserved
            quantity: finalQuantity,
            stock: finalQuantity, // MongoDB uses 'stock' field
            isSynced: false // Mark as unsynced so it syncs to MongoDB
          };
          
          console.log('Dispatching UPDATE_PRODUCT for:', updatedProduct.name, 'New quantity:', updatedProduct.quantity);
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

  const formatNumber = (num) => {
    if (num >= 100000000) { // 10 crore
      return `₹${(num / 100000000).toFixed(2)}Cr`;
    } else if (num >= 10000000) { // 1 crore
      return `₹${(num / 10000000).toFixed(2)}Cr`;
    } else if (num >= 100000) { // 10 lakh
      return `₹${(num / 100000).toFixed(2)}L`;
    } else if (num >= 1000) { // 1 thousand
      return `₹${(num / 1000).toFixed(2)}K`;
    } else {
      return `₹${num.toFixed(2)}`;
    }
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
    return Math.round((Number(baseTotal) || 0) * 100) / 100;
  }

  function getItemTotalCost(item, product) {
    if (item?.totalCostPrice !== undefined && item?.totalCostPrice !== null) {
      return Math.round((Number(item.totalCostPrice) || 0) * 100) / 100;
    }
    const productUnit = item.productUnit || product?.quantityUnit || product?.unit || 'pcs';
    const costPricePerProductUnit = item.productCostPricePerUnit ?? product?.costPrice ?? product?.unitPrice ?? 0;
    const quantityInProductUnits = item.selectedQuantityInProductUnits ?? (() => {
      const quantityInBaseUnit = convertToBaseUnit(item.quantity, item.unit);
      const productUnitInBaseUnit = convertToBaseUnit(1, productUnit) || 1;
      return quantityInBaseUnit / productUnitInBaseUnit;
    })();
    return Math.round((costPricePerProductUnit * quantityInProductUnits) * 100) / 100;
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
    const totalSellingPrice = Math.round((sellingPricePerProductUnit * quantityInProductUnits) * 100) / 100;
    const totalCostPrice = Math.round((costPricePerProductUnit * quantityInProductUnits) * 100) / 100;
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
      price: quantity !== 0 ? Math.round((totalSellingPrice / quantity) * 100) / 100 : 0,
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
          {/* Customer Info - Simple & Clean */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Customer Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    id="customName"
                    checked={useCustomName}
                    onChange={(e) => setUseCustomName(e.target.checked)}
                    className="h-4 w-4 rounded"
                    style={{ accentColor: 'var(--brand-primary)' }}
                  />
                  <label htmlFor="customName" className="cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                    Custom name
                  </label>
                </div>
                
                {useCustomName ? (
                  <input
                    type="text"
                    value={customCustomerName}
                    onChange={(e) => setCustomCustomerName(e.target.value)}
                    placeholder="Customer name"
                    className="input-field"
                    required={paymentMethod === 'due' || paymentMethod === 'credit'}
                  />
                ) : (
                  <select
                    value={selectedCustomer}
                    onChange={(e) => setSelectedCustomer(e.target.value)}
                    className="input-field"
                  >
                    <option value="">Select customer</option>
                    {allCustomers.map(customer => {
                      const mobileNumber = customer.mobileNumber || customer.phone || '';
                      return (
                        <option key={customer.id} value={customer.name}>
                          {customer.name} {mobileNumber ? `(${mobileNumber})` : ''} {(customer.balanceDue || customer.dueAmount) ? `- ₹${(customer.dueAmount || customer.balanceDue || 0).toFixed(2)} due` : ''}
                        </option>
                      );
                    })}
                  </select>
                )}

                <div>
                  <input
                    type="tel"
                    value={billingMobile}
                    onChange={(e) => handleBillingMobileChange(e.target.value)}
                    placeholder="Mobile number"
                    className="input-field"
                    maxLength={10}
                  />
                  {customerNameProvided && !billingMobile && (
                    <p className="text-xs mt-1.5" style={{ color: '#C2410C' }}>
                      {state.currentLanguage === 'hi' 
                        ? 'Mobile number required'
                        : 'Mobile number required'}
                    </p>
                  )}
                  {billingMobile && !isBillingMobileValid && (
                    <p className="text-xs mt-1.5" style={{ color: '#BE123C' }}>
                      {state.currentLanguage === 'hi'
                        ? 'Invalid mobile number'
                        : 'Invalid mobile number'}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      id="send-whatsapp-invoice"
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      style={{ accentColor: 'var(--brand-primary)' }}
                      checked={sendWhatsAppInvoice}
                      onChange={(e) => setSendWhatsAppInvoice(e.target.checked)}
                    />
                    <label htmlFor="send-whatsapp-invoice" className="cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                      Send WhatsApp invoice
                    </label>
                  </div>
                </div>
              </div>
              
              <div>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="input-field"
                >
                  <option value="cash">Cash</option>
                  <option value="upi">Online Payment</option>
                  <option value="due">Due (Credit)</option>
                </select>
                {paymentMethod === 'upi' && !sellerUpiId && (
                  <div className="mt-3 p-3 rounded-lg" style={{ background: 'var(--brand-primary-soft)' }}>
                    <p className="text-xs font-medium mb-2" style={{ color: 'var(--brand-primary)' }}>
                      Add UPI ID for online payments
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={upiIdDraft}
                        onChange={(e) => setUpiIdDraft(e.target.value)}
                        className="input-field flex-1 text-sm"
                        placeholder="e.g., myshop@upi"
                      />
                      <button
                        type="button"
                        onClick={handleSaveUpiId}
                        className="btn-primary text-sm px-4 py-2"
                        disabled={isSavingUpi}
                      >
                        {isSavingUpi ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
                {paymentMethod === 'upi' && sellerUpiId && (
                  <div className="mt-2 text-xs px-2 py-1 rounded-md inline-block" style={{ 
                    background: 'rgba(74, 222, 128, 0.14)',
                    color: '#047857'
                  }}>
                    ✓ Using {sellerUpiId}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Products - Simple & Clean */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Add Products
            </h3>
            
            <div className="space-y-3 mb-4">
              <input
                type="text"
                placeholder="Search products..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field"
              />
              
              <div className="relative">
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
                <button
                  onClick={() => setShowCameraScanner(true)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95"
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
              {filteredProducts.map(product => (
                <div
                  key={product.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors border"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
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
                    className="flex items-center justify-between p-3 rounded-lg border"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <h4 className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {item.name}
                      </h4>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        ₹{item.price.toFixed(2)}/{item.unit || item.quantityUnit || 'pcs'}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 border rounded-lg px-2 py-1" style={{ borderColor: 'var(--border-subtle)' }}>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center font-semibold transition-all duration-200 hover:scale-110 active:scale-95"
                          style={{ 
                            color: 'var(--text-primary)',
                            background: 'rgba(47, 60, 126, 0.05)',
                            border: '1px solid rgba(47, 60, 126, 0.1)'
                          }}
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center font-semibold transition-all duration-200 hover:scale-110 active:scale-95"
                          style={{ 
                            color: 'var(--text-primary)',
                            background: 'rgba(47, 60, 126, 0.05)',
                            border: '1px solid rgba(47, 60, 126, 0.1)'
                          }}
                        >
                          +
                        </button>
                      </div>
                      
                      <span className="font-bold w-20 text-right text-base" style={{ color: 'var(--text-primary)' }}>
                        ₹{getItemTotalAmount(item).toFixed(2)}
                      </span>
                      
                      <button
                        onClick={() => removeFromBill(item.id)}
                        className="p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95"
                        style={{ 
                          color: '#BE123C',
                          background: 'rgba(190, 18, 60, 0.08)',
                          border: '1px solid rgba(190, 18, 60, 0.15)'
                        }}
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
                onClick={generateBill}
                className="w-full btn-primary mt-4 flex items-center justify-center"
                disabled={
                  isGeneratingBill.current ||
                  billItems.length === 0 ||
                  (paymentMethod === 'upi' && !sellerUpiId) ||
                  ((customerNameProvided || billingMobile) && !isBillingMobileValid) ||
                  (customerNameProvided && !billingMobile) ||
                  ((paymentMethod === 'due' || paymentMethod === 'credit') && (
                    (!useCustomName && !selectedCustomer) ||
                    (useCustomName && !customCustomerName)
                  ))
                }
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

        {/* UPI Payment Modal - Only show for UPI payment method */}
        {showUPIPayment && currentBill && currentBill.paymentMethod === 'upi' && (
          <UPIPaymentModal
            bill={currentBill}
            onClose={handleCancelUPIPayment}
            onPaymentReceived={handlePaymentReceived}
          />
        )}
      </div>
    </div>
  );
};

export default Billing;
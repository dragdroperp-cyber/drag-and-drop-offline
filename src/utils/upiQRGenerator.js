import QRCode from 'qrcode';
import { formatCurrency } from './orderUtils';

// UPI QR Code Generator utilities

const DEFAULT_UPI_ID = '7898488935@ibl';
const DEFAULT_MERCHANT_NAME = 'Inventory Studio';

/**
 * Generate UPI QR Code for payment (Simple Canvas-based)
 * @param {number} amount - Payment amount
 * @param {string} transactionId - Unique transaction ID
 * @param {string} upiId - Seller UPI ID (required)
 * @returns {Promise<string>} - Base64 encoded QR code image
 */
export const generateUPIQRCode = async (amount, transactionId, upiId) => {
  if (!upiId || !upiId.trim() || !upiId.includes('@')) {
    throw new Error('Valid seller UPI ID is required to generate QR code.');
  }

  try {
    const upiUrl = createUPIPaymentURL(amount, transactionId, upiId);
    const qrCodeDataURL = await QRCode.toDataURL(upiUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 8
    });
    return qrCodeDataURL;
  } catch (error) {

    throw error;
  }
};

/**
 * Create UPI payment URL
 * @param {number} amount - Payment amount
 * @param {string} transactionId - Unique transaction ID
 * @param {string} upiId - Seller UPI ID (required)
 * @returns {string} - UPI payment URL
 */
export const createUPIPaymentURL = (amount, transactionId, upiId) => {
  if (!upiId || !upiId.trim() || !upiId.includes('@')) {
    throw new Error('Valid seller UPI ID is required to create UPI payment URL.');
  }

  const formattedAmount = Math.max(0, parseFloat(amount) || 0).toFixed(2);
  const params = new URLSearchParams();
  params.set('pa', upiId.trim());
  params.set('am', formattedAmount);
  if (transactionId) {
    params.set('tr', transactionId);
  }
  return `upi://pay?${params.toString()}`;
};

/**
 * Generate unique transaction ID
 * @returns {string} - Unique transaction ID
 */
export const generateTransactionId = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `TXN${timestamp}${random}`.toUpperCase();
};

/**
 * Validate UPI payment amount
 * @param {number} amount - Payment amount
 * @returns {boolean} - Whether amount is valid
 */
export const validatePaymentAmount = (amount) => {
  return amount > 0 && amount <= 1000000; // Max ₹10 lakh per transaction
};

/**
 * Format amount for display
 * @param {number} amount - Payment amount
 * @returns {string} - Formatted amount string
 */
export const formatAmount = (amount) => {
  return formatCurrency(amount);
};

/**
 * Create payment summary object
 * @param {Object} bill - Bill object
 * @param {string} transactionId - Transaction ID
 * @param {string} upiId - Seller UPI ID (required)
 * @param {string} merchantName - Merchant name
 * @returns {Object} - Payment summary
 */
export const createPaymentSummary = (bill, transactionId, upiId, merchantName = DEFAULT_MERCHANT_NAME) => {
  if (!upiId || !upiId.trim() || !upiId.includes('@')) {
    throw new Error('Valid seller UPI ID is required for payment summary.');
  }

  return {
    transactionId,
    upiId: upiId.trim(),
    amount: bill.total,
    formattedAmount: formatAmount(bill.total),
    merchantName,
    billId: bill.id,
    customerName: bill.customerName,
    items: bill.items.length,
    paymentMethod: 'UPI',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
};

/**
 * Generate QR code for bill payment
 * @param {Object} bill - Bill object
 * @returns {Promise<Object>} - QR code data and payment info
 */
export const generateBillPaymentQR = async (bill, options = {}) => {
  try {

    const transactionId = generateTransactionId();

    // Prioritize seller UPI ID from options, then bill.upiId
    let upiId = options.upiId || bill.upiId;

    // Validate UPI ID format (should contain @)
    if (!upiId || !upiId.trim() || !upiId.includes('@')) {
      throw new Error('Seller UPI ID is required. Please enter your UPI ID to generate QR code.');
    }

    upiId = upiId.trim();

    const merchantName = options.merchantName || bill.storeName || DEFAULT_MERCHANT_NAME;

    // For split payments, use online amount instead of total
    let paymentAmount = bill.total;
    let isSplitPayment = false;

    if (bill.splitPaymentDetails && bill.splitPaymentDetails.onlineAmount > 0) {
      paymentAmount = parseFloat(bill.splitPaymentDetails.onlineAmount) || 0;
      isSplitPayment = true;

    }

    // Validate payment amount
    if (!paymentAmount || paymentAmount <= 0) {
      throw new Error(`Invalid payment amount: ${paymentAmount}. Cannot generate QR code.`);
    }

    const description = options.description ||
      (isSplitPayment
        ? `Split Payment (Online) for Bill #${bill.id} - ${bill.customerName}`
        : `Payment for Bill #${bill.id} - ${bill.customerName}`);

    const qrCodeDataURL = await generateUPIQRCode(
      paymentAmount,
      transactionId,
      upiId
    );

    // Create payment summary with correct amount
    const paymentSummary = {
      transactionId,
      upiId,
      amount: paymentAmount,
      formattedAmount: formatAmount(paymentAmount),
      merchantName,
      billId: bill.id,
      customerName: bill.customerName,
      items: bill.items.length,
      paymentMethod: isSplitPayment ? 'Split Payment (Online)' : 'UPI',
      status: 'pending',
      createdAt: new Date().toISOString(),
      isSplitPayment,
      splitPaymentDetails: bill.splitPaymentDetails
    };

    return {
      qrCodeDataURL,
      paymentSummary,
      upiUrl: createUPIPaymentURL(
        paymentAmount,
        transactionId,
        upiId
      )
    };
  } catch (error) {

    throw error;
  }
};

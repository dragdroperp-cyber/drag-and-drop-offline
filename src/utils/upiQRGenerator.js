import QRCode from 'qrcode';

// UPI QR Code Generator utilities

const DEFAULT_UPI_ID = '7898488935@ibl';
const DEFAULT_MERCHANT_NAME = 'Drag & Drop';

/**
 * Generate UPI QR Code for payment (Simple Canvas-based)
 * @param {number} amount - Payment amount
 * @param {string} transactionId - Unique transaction ID
 * @param {string} merchantName - Merchant/store name
 * @param {string} description - Payment description
 * @returns {Promise<string>} - Base64 encoded QR code image
 */
export const generateUPIQRCode = async (amount, transactionId, upiId = DEFAULT_UPI_ID) => {
  try {
    const upiUrl = createUPIPaymentURL(amount, transactionId, upiId);
    const qrCodeDataURL = await QRCode.toDataURL(upiUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 8
    });
    return qrCodeDataURL;
  } catch (error) {
    console.error('Error generating UPI QR code:', error);
    throw error;
  }
};

/**
 * Create UPI payment URL
 * @param {number} amount - Payment amount
 * @param {string} transactionId - Unique transaction ID
 * @param {string} merchantName - Merchant/store name
 * @param {string} description - Payment description
 * @returns {string} - UPI payment URL
 */
export const createUPIPaymentURL = (amount, transactionId, upiId = DEFAULT_UPI_ID) => {
  const formattedAmount = Math.max(0, parseFloat(amount) || 0).toFixed(2);
  const params = new URLSearchParams();
  params.set('pa', upiId);
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
  return `₹${parseFloat(amount).toFixed(2)}`;
};

/**
 * Create payment summary object
 * @param {Object} bill - Bill object
 * @param {string} transactionId - Transaction ID
 * @returns {Object} - Payment summary
 */
export const createPaymentSummary = (bill, transactionId, upiId = DEFAULT_UPI_ID, merchantName = DEFAULT_MERCHANT_NAME) => {
  return {
    transactionId,
    upiId,
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
    const upiId = options.upiId || bill.upiId || DEFAULT_UPI_ID;
    const merchantName = options.merchantName || bill.storeName || DEFAULT_MERCHANT_NAME;
    const description = options.description || `Payment for Bill #${bill.id} - ${bill.customerName}`;

    const qrCodeDataURL = await generateUPIQRCode(
      bill.total,
      transactionId,
      upiId,
      merchantName,
      description
    );
    
    const paymentSummary = createPaymentSummary(bill, transactionId, upiId, merchantName);
    
    return {
      qrCodeDataURL,
      paymentSummary,
      upiUrl: createUPIPaymentURL(
        bill.total,
        transactionId,
        upiId,
        merchantName,
        description
      )
    };
  } catch (error) {
    console.error('Error generating bill payment QR:', error);
    throw error;
  }
};

/**
 * Calculate rate and total for order items using consistent dashboard logic
 * @param {Object} item - Order item object
 * @returns {Object} - { rate, total, qty, unit }
 */
export const calculateItemRateAndTotal = (item) => {
  if (!item) return { rate: 0, total: 0, qty: 0, unit: '' };
  // Helper to convert to number safely
  const toNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };
  const qty = toNumber(item.quantity || item.qty || 0, 0); // Default to 0 if no quantity
  const unit = item.unit || item.quantityUnit || 'pcs';
  // ✅ Correct per-unit rate logic (matches dashboard)
  const totalValue = toNumber(
    item.totalSellingPrice ??
    item.total ??
    item.sellingPrice ??
    item.totalAmount ??
    item.amount ??
    item.subtotal ??
    item.lineTotal ??
    0,
    0
  );
  // Calculate rate per unit (matches Dashboard logic exactly)
  let rate = qty > 0
    ? totalValue / qty
    : toNumber(
      item.unitSellingPrice ??
      item.sellingPrice ??
      item.price ??
      item.unitPrice ??
      item.costPrice ??
      item.rate ??
      0,
      0
    );
  // Fallback: If rate is still 0, try to get it from any price field
  if (rate === 0) {
    rate = toNumber(
      item.sellingPrice ??
      item.price ??
      item.unitPrice ??
      item.costPrice ??
      item.rate ??
      0,
      0
    );
  }
  // Calculate total (always rate * qty, or fallback to totalValue)
  const total = qty > 0
    ? rate * qty
    : totalValue || (rate * qty);
  // Ensure we have valid numbers, even if they're 0
  const finalRate = Number.isFinite(rate) ? Number(rate.toFixed(2)) : 0;
  const finalTotal = Number.isFinite(total) ? Number(total.toFixed(2)) : 0;
  return {
    rate: finalRate,
    total: finalTotal,
    qty: qty || 1, // Ensure quantity is at least 1 for display
    unit: unit || 'pcs'
  };
};
/**
 * Format currency with ₹ symbol
 * @param {number} value - Numeric value
 * @returns {string} - Formatted currency string
 */
export const formatCurrency = (value) => {
  const amount = Number(value || 0) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

/**
 * Format currency in a compact way (e.g., ₹4k, ₹5.5L)
 * @param {number} value - Numeric value
 * @returns {string} - Compact formatted currency string
 */
export const formatCurrencyCompact = (value) => {
  const amount = Number(value || 0) || 0;
  // For small amounts, show full currency
  if (Math.abs(amount) < 1000) {
    return formatCurrency(amount);
  }

  // Use Intl.NumberFormat with compact notation but WITHOUT currency style
  // as the currency style with en-US often adds trailing currency codes or different symbols.
  // We prepend the rupee symbol manually to ensure it looks like ₹1K, ₹10K etc.
  const formatted = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1
  }).format(amount);

  return `₹${formatted}`;
};

/**
 * Smart currency formatter that respects user preference
 * @param {number} value - Numeric value
 * @param {string} userPreference - 'plain' or 'compact'
 * @returns {string} - Formatted currency string
 */
export const formatCurrencySmart = (value, userPreference = 'compact') => {
  if (userPreference === 'plain') {
    return formatCurrency(value);
  }
  return formatCurrencyCompact(value);
};

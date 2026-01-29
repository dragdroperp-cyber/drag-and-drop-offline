/**
 * Format number with maximum 2 decimal places
 * No rounding, no abbreviations - shows full number
 * @param {number|string} value - The number to format
 * @returns {string} Formatted number string with ₹ prefix
 */
export const formatNumber = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '₹0.00';
  }

  // Truncate to 2 decimal places to match original behavior (no rounding)
  let valueToFormat = num;
  const numStr = num.toString();
  const parts = numStr.split('.');
  if (parts.length > 1 && parts[1].length > 2) {
    const truncated = parts[0] + '.' + parts[1].substring(0, 2);
    valueToFormat = Number(truncated);
  }

  return valueToFormat.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

/**
 * Format number without currency symbol
 * Maximum 2 decimal places, no rounding, no abbreviations
 * @param {number|string} value - The number to format
 * @returns {string} Formatted number string
 */
export const formatNumberOnly = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '0.00';
  }

  // Truncate to 2 decimal places to match original behavior (no rounding)
  let valueToFormat = num;
  const numStr = num.toString();
  const parts = numStr.split('.');
  if (parts.length > 1 && parts[1].length > 2) {
    const truncated = parts[0] + '.' + parts[1].substring(0, 2);
    valueToFormat = Number(truncated);
  }

  return valueToFormat.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};
/**
 * Truncate number to 2 decimal places without rounding
 * @param {number} num - The number to truncate
 * @returns {number} Number truncated to 2 decimal places
 */
export const truncateToTwoDecimals = (num) => {
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.floor(num * 100) / 100;
};

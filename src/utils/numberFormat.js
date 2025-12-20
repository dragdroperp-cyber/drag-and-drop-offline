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
  // Convert to string and handle decimal places
  const numStr = num.toString();
  const parts = numStr.split('.');
  // If no decimal part or decimal part is 2 digits or less, use toFixed(2)
  if (parts.length === 1 || parts[1].length <= 2) {
    return `₹${num.toFixed(2)}`;
  }
  // If more than 2 decimal places, truncate (not round) to 2 decimal places
  const truncated = parts[0] + '.' + parts[1].substring(0, 2);
  return `₹${parseFloat(truncated).toFixed(2)}`;
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
  // Convert to string and handle decimal places
  const numStr = num.toString();
  const parts = numStr.split('.');
  // If no decimal part or decimal part is 2 digits or less, use toFixed(2)
  if (parts.length === 1 || parts[1].length <= 2) {
    return num.toFixed(2);
  }
  // If more than 2 decimal places, truncate (not round) to 2 decimal places
  const truncated = parts[0] + '.' + parts[1].substring(0, 2);
  return parseFloat(truncated).toFixed(2);
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
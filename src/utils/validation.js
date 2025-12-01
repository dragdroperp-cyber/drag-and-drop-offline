export const sanitizeMobileNumber = (mobile) =>
  (mobile || '')
    .toString()
    .replace(/\D/g, '')
    .slice(-10);

export const isValidMobileNumber = (mobile) => {
  const sanitized = sanitizeMobileNumber(mobile);
  return /^[6-9]\d{9}$/.test(sanitized);
};

/**
 * Sanitize GST number - remove spaces and convert to uppercase
 */
export const sanitizeGSTNumber = (gst) => {
  if (!gst) return '';
  return gst.toString().trim().replace(/\s+/g, '').toUpperCase();
};

/**
 * Validate GST number format
 * GST format: 15 characters
 * - 2 digits (state code)
 * - 10 alphanumeric (PAN)
 * - 1 digit (entity number)
 * - 1 letter (Z) - position 14
 * - 1 digit (check digit)
 * Example: 27ABCDE1234F1Z5
 */
export const isValidGSTNumber = (gst) => {
  if (!gst) return false;
  const sanitized = sanitizeGSTNumber(gst);
  
  // Check length
  if (sanitized.length !== 15) {
    return false;
  }
  
  // Check format: 2 digits + 10 alphanumeric (PAN) + 1 digit + 1 letter (Z) + 1 digit
  const gstPattern = /^[0-9]{2}[A-Z0-9]{10}[0-9]{1}Z[0-9]{1}$/;
  
  if (!gstPattern.test(sanitized)) {
    return false;
  }
  
  // Additional validation: First 2 digits should be valid state code (01-37, 38-40, 41-42)
  const stateCode = parseInt(sanitized.substring(0, 2), 10);
  if (stateCode < 1 || stateCode > 42) {
    return false;
  }
  
  // Check that 14th character is 'Z'
  if (sanitized.charAt(13) !== 'Z') {
    return false;
  }
  
  return true;
};

/**
 * Debug function to test GST validation
 */
export const debugGSTValidation = (gst) => {
  console.log('🔍 GST Debug for:', gst);
  if (!gst) {
    console.log('❌ GST is empty');
    return false;
  }

  const sanitized = sanitizeGSTNumber(gst);
  console.log('📝 Sanitized:', sanitized);
  console.log('📏 Length:', sanitized.length);

  if (sanitized.length !== 15) {
    console.log('❌ Wrong length, expected 15, got', sanitized.length);
    return false;
  }

  const gstPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  console.log('🔍 Regex test result:', gstPattern.test(sanitized));

  if (!gstPattern.test(sanitized)) {
    console.log('❌ Regex failed');
    console.log('Expected pattern: 2 digits + 10 alphanumeric (PAN) + 1 digit + Z + 1 digit');
    console.log('Positions:');
    for (let i = 0; i < sanitized.length; i++) {
      console.log(`  ${i + 1}: "${sanitized[i]}"`);
    }
    return false;
  }

  const stateCode = parseInt(sanitized.substring(0, 2), 10);
  console.log('🏛️ State code:', stateCode);
  if (stateCode < 1 || stateCode > 42) {
    console.log('❌ Invalid state code');
    return false;
  }

  const fourteenthChar = sanitized.charAt(13);
  console.log('🔢 14th character:', fourteenthChar);
  if (fourteenthChar !== 'Z') {
    console.log('❌ 14th character must be Z');
    return false;
  }

  console.log('✅ GST is valid');
  return true;
};



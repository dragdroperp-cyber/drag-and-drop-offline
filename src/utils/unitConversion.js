// Comprehensive Unit Conversion System for ERP
// All units are converted to base units for consistent comparison

export const UNIT_CONVERSIONS = {
  // Weight conversions (base unit: grams)
  'mg': 0.001,        // milligram to gram
  'g': 1,             // gram (base unit)
  'gm': 1,            // gram (alternative)
  'gram': 1,          // gram (full name)
  'grams': 1,         // gram (plural)
  'kg': 1000,         // kilogram to gram
  'kilogram': 1000,   // kilogram (full name)
  'kilograms': 1000,  // kilogram (plural)
  
  // Volume conversions (base unit: milliliters)
  'ml': 1,            // milliliter (base unit)
  'milliliter': 1,    // milliliter (full name)
  'milliliters': 1,   // milliliter (plural)
  'l': 1000,          // liter to milliliter
  'liter': 1000,      // liter (full name)
  'liters': 1000,     // liter (plural)
  'litre': 1000,      // liter (British spelling)
  'litres': 1000,     // liter (British plural)
  
  // Count-based units (no conversion needed)
  'pcs': 1,           // pieces
  'pieces': 1,        // pieces (full name)
  'box': 1,           // box
  'boxes': 1,         // boxes
  'packet': 1,        // packet
  'packets': 1,       // packets
  'bottle': 1,        // bottle
  'bottles': 1,       // bottles
  'unit': 1,          // unit
  'units': 1,         // units
};

// Get base unit for a given unit
export const getBaseUnit = (unit) => {
  const normalizedUnit = unit?.toLowerCase()?.trim();
  
  if (!normalizedUnit) return 'pcs';
  
  // Weight units -> grams
  if (['mg', 'g', 'gm', 'gram', 'grams', 'kg', 'kilogram', 'kilograms'].includes(normalizedUnit)) {
    return 'g';
  }
  
  // Volume units -> ml
  if (['ml', 'milliliter', 'milliliters', 'l', 'liter', 'liters', 'litre', 'litres'].includes(normalizedUnit)) {
    return 'ml';
  }
  
  // Count units -> pcs
  return 'pcs';
};

// Convert any unit to base unit
export const convertToBaseUnit = (quantity, fromUnit) => {
  const normalizedUnit = fromUnit?.toLowerCase()?.trim() || 'pcs';
  const conversionFactor = UNIT_CONVERSIONS[normalizedUnit] || 1;
  return quantity * conversionFactor;
};

// Convert from base unit to any unit
export const convertFromBaseUnit = (quantity, toUnit) => {
  const normalizedUnit = toUnit?.toLowerCase()?.trim() || 'pcs';
  const conversionFactor = UNIT_CONVERSIONS[normalizedUnit] || 1;
  return quantity / conversionFactor;
};

// Check if two units are compatible (same category)
export const areUnitsCompatible = (unit1, unit2) => {
  const base1 = getBaseUnit(unit1);
  const base2 = getBaseUnit(unit2);
  return base1 === base2;
};

export const COUNT_BASED_UNITS = [
  'pcs',
  'piece',
  'pieces',
  'box',
  'boxes',
  'packet',
  'packets',
  'bottle',
  'bottles',
  'unit',
  'units'
];

export const DECIMAL_ALLOWED_UNITS = [
  'mg',
  'g',
  'gm',
  'gram',
  'grams',
  'kg',
  'kilogram',
  'kilograms',
  'ml',
  'milliliter',
  'milliliters',
  'l',
  'liter',
  'liters',
  'litre',
  'litres'
];

export const isCountBasedUnit = (unit) => {
  const normalizedUnit = unit?.toLowerCase()?.trim();
  if (!normalizedUnit) {
    return false;
  }
  return COUNT_BASED_UNITS.includes(normalizedUnit);
};

export const isDecimalAllowedUnit = (unit) => {
  const normalizedUnit = unit?.toLowerCase()?.trim();
  if (!normalizedUnit) {
    return false;
  }
  return DECIMAL_ALLOWED_UNITS.includes(normalizedUnit);
};

// Format quantity with unit for display
export const formatQuantityWithUnit = (quantity, unit) => {
  const normalizedUnit = unit?.toLowerCase()?.trim() || 'pcs';
  
  // Format quantity based on unit type
  if (isDecimalAllowedUnit(normalizedUnit)) {
    // For weight or volume, show decimal places if needed
    return `${quantity} ${normalizedUnit}`;
  }

  // For count-based units, show as integer
  return `${Math.round(quantity)} ${normalizedUnit}`;
};

// Calculate price with proper unit conversion
export const calculatePriceWithUnitConversion = (quantity, unit, pricePerUnit, productUnit) => {
  // Convert both quantities to base units for comparison
  const quantityInBaseUnit = convertToBaseUnit(quantity, unit);
  const productUnitInBaseUnit = convertToBaseUnit(1, productUnit);
  
  // Calculate total price based on base unit conversion
  const totalPrice = (quantityInBaseUnit / productUnitInBaseUnit) * pricePerUnit;
  
  return {
    quantityInBaseUnit,
    totalPrice: Math.round(totalPrice * 100) / 100, // Round to 2 decimal places
    displayQuantity: formatQuantityWithUnit(quantity, unit)
  };
};

// Check stock availability with unit conversion
export const checkStockAvailability = (product, requestedQuantity, requestedUnit) => {
  // Use quantity instead of stock, support migration
  const productQuantity = product.quantity || product.stock || 0;
  const productUnit = product.unit || product.quantityUnit || 'pcs';
  
  // Convert both to base units
  const quantityInBaseUnit = convertToBaseUnit(productQuantity, productUnit);
  const requestedInBaseUnit = convertToBaseUnit(requestedQuantity, requestedUnit);
  
  // Check if units are compatible
  if (!areUnitsCompatible(productUnit, requestedUnit)) {
    return {
      available: false,
      error: `Unit mismatch: Cannot compare ${productUnit} with ${requestedUnit}`,
      stockInBaseUnit: quantityInBaseUnit,
      requestedInBaseUnit,
      baseUnit: getBaseUnit(productUnit)
    };
  }
  
  return {
    available: requestedInBaseUnit <= quantityInBaseUnit,
    stockInBaseUnit: quantityInBaseUnit,
    requestedInBaseUnit,
    baseUnit: getBaseUnit(productUnit),
    stockDisplay: formatQuantityWithUnit(productQuantity, productUnit),
    requestedDisplay: formatQuantityWithUnit(requestedQuantity, requestedUnit)
  };
};

// Get all available units grouped by category
export const getAvailableUnits = () => {
  return {
    weight: ['mg', 'g', 'gm', 'kg'],
    volume: ['ml', 'l'],
    count: ['pcs', 'box', 'packet', 'bottle']
  };
};

// Validate unit conversion
export const validateUnitConversion = (quantity, fromUnit, toUnit) => {
  if (!areUnitsCompatible(fromUnit, toUnit)) {
    return {
      valid: false,
      error: `Cannot convert from ${fromUnit} to ${toUnit} - incompatible units`
    };
  }
  
  const convertedQuantity = convertFromBaseUnit(convertToBaseUnit(quantity, fromUnit), toUnit);
  
  return {
    valid: true,
    originalQuantity: quantity,
    originalUnit: fromUnit,
    convertedQuantity,
    convertedUnit: toUnit
  };
};
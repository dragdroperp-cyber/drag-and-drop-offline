import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';
import { getBaseUnit, isCountBasedUnit, isDecimalAllowedUnit, checkStockAvailability, convertToBaseUnit, getTotalStockQuantity, convertFromBaseUnit, formatQuantityWithUnit } from '../../utils/unitConversion';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';

import { getEffectivePrice, getEffectiveWholesaleMOQ } from '../../utils/productUtils';

const QuantityModal = ({ product, saleMode, onClose, onAdd }) => {
  const { state } = useApp();
  // If editing from cart, pre-fill with current quantity
  const isEditing = product._isEdit;
  const currentQuantity = product._currentQuantity;
  const currentUnit = product._currentUnit;
  const [quantity, setQuantity] = useState(() => {
    if (isEditing && currentQuantity) return currentQuantity.toString();
    const moq = getEffectiveWholesaleMOQ(product);
    if (saleMode === 'wholesale' && moq > 1) {
      return moq.toString();
    }
    return '';
  });

  const normalizedProductUnit = (product.productUnit || product.quantityUnit || product.unit || 'pcs').toLowerCase();
  const baseUnit = getBaseUnit(normalizedProductUnit);

  const allowedUnits = (() => {
    if (baseUnit === 'g') {
      return ['kg', 'g'];
    }
    if (baseUnit === 'ml') {
      return ['l', 'ml'];
    }
    return [normalizedProductUnit];
  })();
  // If editing from cart, use current cart item's unit
  const initialUnit = isEditing && currentUnit ? currentUnit : normalizedProductUnit;
  const [unit, setUnit] = useState(allowedUnits.includes(initialUnit) ? initialUnit : allowedUnits[0]);
  const [validationError, setValidationError] = useState('');

  // Helper to calculate price per selected unit
  const getPricePerUnit = (targetUnit) => {
    const price = getEffectivePrice(product, saleMode);
    let pricePerUnit = price;

    const pUnit = (product.productUnit || product.quantityUnit || product.unit || 'pcs').toLowerCase();
    const selectedUnit = targetUnit.toLowerCase();

    if (pUnit !== selectedUnit) {
      if (pUnit === 'kg' && selectedUnit === 'g') pricePerUnit = price / 1000;
      else if (pUnit === 'g' && selectedUnit === 'kg') pricePerUnit = price * 1000;
      else if (pUnit === 'l' && selectedUnit === 'ml') pricePerUnit = price / 1000;
      else if (pUnit === 'ml' && selectedUnit === 'l') pricePerUnit = price * 1000;
    }
    return pricePerUnit;
  };


  const [amount, setAmount] = useState(() => {
    if (isEditing && currentQuantity) {
      const pricePerUnit = getPricePerUnit(allowedUnits.includes(initialUnit) ? initialUnit : allowedUnits[0]);
      return (parseFloat(currentQuantity) * pricePerUnit).toFixed(2);
    }
    const moq = getEffectiveWholesaleMOQ(product);
    if (saleMode === 'wholesale' && moq > 1) {
      // Use the unit state which is already initialized above
      const pricePerUnit = getPricePerUnit(unit);
      return (moq * pricePerUnit).toFixed(2);
    }
    return '';
  });


  const availableQuantity = getTotalStockQuantity(product);

  const validate = (qty, currentUnit) => {
    const qtyValue = parseFloat(qty);
    if (!qty || isNaN(qtyValue)) {
      return ''; // Don't show error for empty input yet
    }
    if (qtyValue <= 0) {
      return getTranslation('enterValidQuantity', state.currentLanguage) || 'Please enter a quantity greater than zero';
    }
    if (isCountBasedUnit(currentUnit) && !Number.isInteger(qtyValue)) {
      return getTranslation('wholeNumberRequired', state.currentLanguage) || 'Decimals are not allowed for this unit';
    }

    // New: Check stock availability
    const stockCheck = checkStockAvailability(product, qtyValue, currentUnit);
    if (!stockCheck.available) {
      return state.currentLanguage === 'hi'
        ? `⚠️ ${getTranslation('lowStock', state.currentLanguage) || 'स्टॉक कम है'}! उपलब्ध: ${stockCheck.stockDisplay}`
        : `⚠️ ${getTranslation('lowStock', state.currentLanguage) || 'Low Stock'}! Available: ${stockCheck.stockDisplay}`;
    }

    // New: Check Wholesale MOQ
    const moq = getEffectiveWholesaleMOQ(product);
    if (saleMode === 'wholesale' && moq > 1) {
      const productUnit = product.quantityUnit || product.unit || 'pcs';
      const qtyInBase = convertToBaseUnit(qtyValue, currentUnit);
      const prodUnitInBase = convertToBaseUnit(1, productUnit) || 1;
      let targetQuantityInProductUnits = qtyInBase / prodUnitInBase;

      // If adding (not editing), we should consider what's already in the cart
      if (!isEditing) {
        // Find existing quantity in cart
        const existingItem = state.billItems?.find(item =>
          (product.id && item.id === product.id) ||
          (item.name.toLowerCase().trim() === product.name.toLowerCase().trim())
        );

        if (existingItem) {
          const existingQty = existingItem.quantity;
          const initialUnit = existingItem.unit || existingItem.quantityUnit || 'pcs';
          let existingQtyInProductUnits = existingQty;
          if (initialUnit !== productUnit) {
            const existingQtyInBase = convertToBaseUnit(existingQty, initialUnit);
            existingQtyInProductUnits = existingQtyInBase / prodUnitInBase;
          }
          targetQuantityInProductUnits += existingQtyInProductUnits;
        }
      }

      if (targetQuantityInProductUnits < moq) {
        return state.currentLanguage === 'hi'
          ? `थोक बिक्री के लिए कुल मात्रा ${moq} ${productUnit} आवश्यक है (अभी: ${targetQuantityInProductUnits})`
          : `Wholesale MOQ is ${moq} ${productUnit} total (currently: ${targetQuantityInProductUnits})`;
      }
    }


    return '';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const error = validate(quantity, unit);
    if (error) {
      setValidationError(error);
      return;
    }

    const quantityValue = parseFloat(quantity);
    if (isNaN(quantityValue)) {
      setValidationError(getTranslation('enterValidQuantity', state.currentLanguage) || 'Please enter a valid quantity');
      return;
    }

    const added = onAdd(product, quantityValue, unit);
    if (added !== false) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-[1300] flex items-end md:items-center justify-center animate-fadeIn" onClick={onClose}>
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out forwards; }
      `}</style>
      <div
        className="bg-white dark:bg-slate-900 w-full md:max-w-2xl !rounded-none md:!rounded-xl shadow-lg border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:h-auto m-0"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">
            {isEditing ? getTranslation('editQuantity', state.currentLanguage) || 'Edit Quantity' : getTranslation('addQuantity', state.currentLanguage)}
          </h3>
          <button onClick={onClose} className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/30 rounded-xl">
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">{getTranslation('product', state.currentLanguage)}</p>
                <p className="font-bold text-indigo-900 dark:text-indigo-100">{product.name}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                  <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase">
                    {saleMode === 'wholesale' ? getTranslation('wholesalePrice', state.currentLanguage) : getTranslation('price', state.currentLanguage)}: {formatCurrencySmart(saleMode === 'wholesale' ? (product.wholesalePrice || product.sellingPrice || 0) : (product.sellingPrice || product.costPrice || 0), state.currencyFormat)} / {product.productUnit || product.quantityUnit || 'pcs'}
                  </p>

                  <p className="text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                    {getTranslation('available', state.currentLanguage)}: {(() => {
                      const productUnit = product.productUnit || product.quantityUnit || product.unit || 'pcs';
                      const availableInBase = convertToBaseUnit(availableQuantity, productUnit);
                      const availableInSelectedUnit = convertFromBaseUnit(availableInBase, unit);
                      const displayQty = Number.isInteger(availableInSelectedUnit) ? availableInSelectedUnit : parseFloat(availableInSelectedUnit.toFixed(3));
                      return formatQuantityWithUnit(displayQty, unit);
                    })()}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('quantity', state.currentLanguage)}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => {
                    const value = e.target.value;
                    const isDecimalAllowed = isDecimalAllowedUnit(unit) || baseUnit === 'g' || baseUnit === 'ml';
                    const pattern = isDecimalAllowed ? /^[0-9]*\.?[0-9]*$/ : /^[0-9]*$/;
                    if (value === '' || pattern.test(value)) {
                      setQuantity(value);
                      const error = validate(value, unit);
                      setValidationError(error);
                      if (value === '') setAmount('');
                      else {
                        const qtyVal = parseFloat(value);
                        const pricePerUnit = getPricePerUnit(unit);
                        if (!isNaN(qtyVal) && pricePerUnit > 0) setAmount((qtyVal * pricePerUnit).toFixed(2));
                      }
                    }
                  }}
                  className={`block w-full px-4 py-3 bg-white dark:bg-slate-900 border ${validationError ? 'border-red-500 shadow-[0_0_0_1px_rgba(239,68,68,0.5)]' : 'border-gray-200 dark:border-slate-700'} rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all`}
                  placeholder="0.00"
                  autoFocus
                />
                {validationError && (
                  <p className="mt-1 text-[11px] font-bold text-red-500 animate-fadeIn pl-0.5">
                    {validationError}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('amount', state.currentLanguage)} (₹)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || /^[0-9]*\.?[0-9]*$/.test(value)) {
                      setAmount(value);
                      if (value === '') {
                        setQuantity('');
                        setValidationError('');
                      } else {
                        const amountVal = parseFloat(value);
                        const pricePerUnit = getPricePerUnit(unit);
                        if (!isNaN(amountVal) && pricePerUnit > 0) {
                          const calculatedQty = amountVal / pricePerUnit;
                          const newQty = parseFloat(calculatedQty.toFixed(3)).toString();
                          setQuantity(newQty);
                          const error = validate(newQty, unit);
                          setValidationError(error);
                        }
                      }
                    }
                  }}
                  className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('unit', state.currentLanguage)}</label>
                <select
                  value={unit}
                  onChange={(e) => {
                    const newUnit = e.target.value;
                    setUnit(newUnit);
                    const error = validate(quantity, newUnit);
                    setValidationError(error);
                    if (quantity) {
                      const qtyVal = parseFloat(quantity);
                      const pricePerUnit = getPricePerUnit(newUnit);
                      if (!isNaN(qtyVal) && pricePerUnit > 0) setAmount((qtyVal * pricePerUnit).toFixed(2));
                    }
                  }}
                  className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                >
                  {allowedUnits.map(u => (
                    <option key={u} value={u}>
                      {getTranslation(`unit_${u === 'g' ? 'gm' : u === 'l' ? 'liters' : u}`, state.currentLanguage) || u}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="p-6 pt-0 pb-8 md:pb-6">
            <button
              type="submit"
              className="w-full py-3.5 rounded-lg font-bold text-sm text-white dark:text-slate-900 bg-gray-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2"
            >
              <Plus className="h-4 w-4" />
              {isEditing ? (getTranslation('updateQuantity', state.currentLanguage) || 'Update Quantity') : getTranslation('addToBill', state.currentLanguage)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default QuantityModal;

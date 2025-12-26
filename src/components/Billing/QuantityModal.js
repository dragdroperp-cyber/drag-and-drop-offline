import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';
import { getBaseUnit, isCountBasedUnit, isDecimalAllowedUnit } from '../../utils/unitConversion';
import { formatCurrency } from '../../utils/orderUtils';

const QuantityModal = ({ product, onClose, onAdd }) => {
  const { state } = useApp();
  // If editing from cart, pre-fill with current quantity
  const isEditing = product._isEdit;
  const currentQuantity = product._currentQuantity;
  const currentUnit = product._currentUnit;
  const [quantity, setQuantity] = useState(isEditing && currentQuantity ? currentQuantity.toString() : '');
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

  // Helper to calculate price per selected unit
  const getPricePerUnit = (targetUnit) => {
    const price = parseFloat(product.sellingPrice || product.costPrice || 0);
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
    return '';
  });

  const availableQuantity = Number(product.quantity ?? product.stock ?? 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    const quantityValue = parseFloat(quantity);

    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      window.showToast?.('Please enter a valid quantity greater than zero.', 'warning');
      return;
    }

    if (isCountBasedUnit(unit) && !Number.isInteger(quantityValue)) {
      window.showToast?.('Quantity must be a whole number for pieces, packets and boxes.', 'warning');
      return;
    }

    const added = onAdd(product, quantityValue, unit);
    if (added !== false) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 border dark:border-slate-700/60 transition-colors">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white tracking-tight">
            {isEditing ? getTranslation('editQuantity', state.currentLanguage) || 'Edit Quantity' : getTranslation('addQuantity', state.currentLanguage)}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700/50">
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              {getTranslation('product', state.currentLanguage)}: <span className="text-indigo-600 dark:text-indigo-400">{product.name}</span>
            </label>
            <p className="text-sm text-gray-600 dark:text-slate-400">
              {getTranslation('price', state.currentLanguage)}: <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(product.sellingPrice || product.costPrice || 0)}</span> per {product.productUnit || product.quantityUnit || 'pcs'}
            </p>
            <p className="mt-1.5 text-sm text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
              {getTranslation('available', state.currentLanguage)}: {availableQuantity} {product.quantityUnit || product.unit || 'pcs'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              {getTranslation('quantity', state.currentLanguage)}
            </label>
            <input
              type="text"
              value={quantity}
              onChange={(e) => {
                const value = e.target.value;
                // Validate input based on unit type
                const isDecimalAllowed = isDecimalAllowedUnit(unit) || baseUnit === 'g' || baseUnit === 'ml';
                const pattern = isDecimalAllowed ? /^[0-9]*\.?[0-9]*$/ : /^[0-9]*$/;
                if (value === '' || pattern.test(value)) {
                  setQuantity(value);

                  // Calculate amount based on quantity
                  if (value === '') {
                    setAmount('');
                  } else {
                    const qtyVal = parseFloat(value);
                    const pricePerUnit = getPricePerUnit(unit);

                    if (!isNaN(qtyVal) && pricePerUnit > 0) {
                      setAmount((qtyVal * pricePerUnit).toFixed(2));
                    }
                  }
                }
              }}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 dark:text-white placeholder:text-slate-400"
              inputMode="decimal"
              placeholder="Enter quantity"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              Amount (₹)
            </label>
            <input
              type="text"
              value={amount}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '' || /^[0-9]*\.?[0-9]*$/.test(value)) {
                  setAmount(value);

                  // Calculate quantity based on amount
                  if (value === '') {
                    setQuantity('');
                  } else {
                    const amountVal = parseFloat(value);
                    const pricePerUnit = getPricePerUnit(unit);

                    if (!isNaN(amountVal) && pricePerUnit > 0) {
                      const calculatedQty = amountVal / pricePerUnit;
                      // Format to max 3 decimals and remove trailing zeros
                      setQuantity(parseFloat(calculatedQty.toFixed(3)).toString());
                    }
                  }
                }
              }}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 dark:text-white placeholder:text-slate-400"
              inputMode="decimal"
              placeholder="Enter amount"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              {getTranslation('unit', state.currentLanguage)}
            </label>
            <select
              value={unit}
              onChange={(e) => {
                const newUnit = e.target.value;
                setUnit(newUnit);

                // Recalculate amount if quantity is present, based on new unit
                if (quantity) {
                  const qtyVal = parseFloat(quantity);
                  const pricePerUnit = getPricePerUnit(newUnit);

                  if (!isNaN(qtyVal) && pricePerUnit > 0) {
                    setAmount((qtyVal * pricePerUnit).toFixed(2));
                  }
                }
              }}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 dark:text-white"
            >
              {allowedUnits.map(u => (
                <option key={u} value={u} className="dark:bg-slate-800">
                  {u === 'pcs' ? getTranslation('pieces', state.currentLanguage) :
                    u === 'kg' ? getTranslation('kilograms', state.currentLanguage) :
                      u === 'g' ? getTranslation('grams', state.currentLanguage) : u}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="w-full bg-indigo-600 dark:bg-indigo-500 text-white py-3 px-4 rounded-xl hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-all font-semibold shadow-lg shadow-indigo-500/20 active:scale-[0.98] mt-2"
          >
            {isEditing ? (getTranslation('updateQuantity', state.currentLanguage) || 'Update Quantity') : getTranslation('addToBill', state.currentLanguage)}
          </button>
        </form>
      </div>
    </div>
  );
};

export default QuantityModal;

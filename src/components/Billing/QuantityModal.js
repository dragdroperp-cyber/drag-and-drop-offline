import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';
import { getBaseUnit, isCountBasedUnit, isDecimalAllowedUnit } from '../../utils/unitConversion';

const QuantityModal = ({ product, onClose, onAdd }) => {
  const { state } = useApp();
  const [quantity, setQuantity] = useState('');
  const normalizedProductUnit = (product.quantityUnit || product.unit || 'pcs').toLowerCase();
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
  const [unit, setUnit] = useState(allowedUnits.includes(normalizedProductUnit) ? normalizedProductUnit : allowedUnits[0]);
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
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800">{getTranslation('addQuantity', state.currentLanguage)}</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {getTranslation('product', state.currentLanguage)}: {product.name}
            </label>
            <p className="text-sm text-gray-600">
              {getTranslation('price', state.currentLanguage)}: ₹{(product.sellingPrice || product.costPrice || 0).toFixed(2)} per {product.quantityUnit || 'pcs'}
            </p>
            <p className="mt-1 text-sm text-blue-600 font-medium">
              {getTranslation('available', state.currentLanguage)}: {availableQuantity} {product.quantityUnit || product.unit || 'pcs'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {getTranslation('quantity', state.currentLanguage)}
            </label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input-field"
              step={isDecimalAllowedUnit(unit) || baseUnit === 'g' || baseUnit === 'ml' ? '0.01' : '1'}
              min="0"
              placeholder="Enter quantity"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {getTranslation('unit', state.currentLanguage)}
            </label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="input-field"
            >
              {allowedUnits.map(u => (
                <option key={u} value={u}>
                  {u === 'pcs' ? getTranslation('pieces', state.currentLanguage) :
                   u === 'kg' ? getTranslation('kilograms', state.currentLanguage) :
                   u === 'g' ? getTranslation('grams', state.currentLanguage) : u}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="w-full bg-emerald-600 text-white py-2.5 px-4 rounded-md hover:bg-emerald-700 transition-colors"
          >
            {getTranslation('addToBill', state.currentLanguage)}
          </button>
        </form>
      </div>
    </div>
  );
};

export default QuantityModal;




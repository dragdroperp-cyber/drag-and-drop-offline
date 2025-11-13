import React, { useState, useEffect } from 'react';
import { X, Package, Plus, AlertTriangle, QrCode } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getSellerIdFromAuth } from '../../utils/api';
import { ActionTypes } from '../../context/AppContext';
import BarcodeScanner from '../BarcodeScanner/BarcodeScanner';

const AddProductModal = ({
  onClose,
  onSave,
  scannedBarcode = '',
  planLimitError = '',
  onClearPlanLimitError
}) => {
  const { state, dispatch } = useApp();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: '',
    quantity: '',
    barcode: scannedBarcode, // Use scanned barcode if provided
    expiryDate: '',
    mfgDate: '',
    costPrice: '',
    sellingPrice: '',
    quantityUnit: 'pcs'
  });
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [trackExpiry, setTrackExpiry] = useState(false);

  // Update barcode when scannedBarcode prop changes
  useEffect(() => {
    if (scannedBarcode) {
      setFormData(prev => ({ ...prev, barcode: scannedBarcode }));
    }
  }, [scannedBarcode]);

  // Filter categories by current seller
  const currentSellerId = getSellerIdFromAuth();
  const allCategories = state.categories
    .filter(cat => !cat.sellerId || (currentSellerId && cat.sellerId === currentSellerId))
    .map(cat => (cat.name || '').toLowerCase())
    .filter(Boolean)
    .sort();

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) {
      if (window.showToast) {
        window.showToast('Please enter a category name', 'error');
      } else {
        alert('Please enter a category name');
      }
      return;
    }

    const trimmedName = newCategoryName.trim().toLowerCase();
    
    // Check if category already exists
    if (allCategories.includes(trimmedName)) {
      if (window.showToast) {
        window.showToast('Category already exists', 'warning');
      } else {
        alert('Category already exists');
      }
      return;
    }

    // Create category object and save to IndexedDB
    const newCategory = {
      id: `cat-${Date.now()}`,
      name: trimmedName,
      createdAt: new Date().toISOString()
    };

    // Dispatch to save category to IndexedDB
    dispatch({ type: ActionTypes.ADD_CATEGORY, payload: newCategory });

    // Set the new category and close the modal
    setFormData(prev => ({ ...prev, category: trimmedName }));
    setNewCategoryName('');
    setShowCreateCategory(false);

    if (window.showToast) {
      window.showToast(`Category "${trimmedName}" created and selected`, 'success');
    }
  };

  const handleChange = (e) => {
    const { name } = e.target;
    let { value } = e.target;
    
    // Strict integer handling for quantity
    if (name === 'quantity') {
      const numericValue = value.replace(/,/g, '.');
      const isFractionalUnit = ['kg', 'gm', 'liters', 'ml'].includes((formData.quantityUnit || '').toLowerCase());
      const pattern = isFractionalUnit ? /^[0-9]*\.?[0-9]*$/ : /^[0-9]*$/;
      if (!pattern.test(numericValue)) {
        return;
      }
      value = numericValue;
    }

    setFormData(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'quantityUnit') {
        const unit = (value || '').toLowerCase();
        if (next.quantity !== '' && next.quantity !== null && next.quantity !== undefined) {
          const numericQty = Number(next.quantity);
          if (Number.isFinite(numericQty)) {
            if (['pcs', 'pieces', 'piece', 'packet', 'packets', 'box', 'boxes'].includes(unit)) {
              next.quantity = String(Math.max(0, Math.floor(numericQty)));
            } else {
              next.quantity = String(numericQty);
            }
          }
        }
      }
      if (name === 'quantity' && (value === '' || value === null)) {
        next.quantity = '';
      }
      return next;
    });

    if (planLimitError && onClearPlanLimitError) {
      onClearPlanLimitError();
    }
    
    // Search for product by barcode when barcode changes
    if (name === 'barcode' && value.trim()) {
      searchProductByBarcode(value);
    }
  };

  // Search for existing product by barcode
  const searchProductByBarcode = (barcode) => {
    if (!barcode.trim()) return;
    
    // Search in existing products
    const existingProduct = state.products.find(p => p.barcode === barcode);
    
    if (existingProduct) {
      // Auto-fill product details if found
      const formatDateForInput = (d) => {
        if (!d) return '';
        try {
          const date = new Date(d);
          if (Number.isNaN(date.getTime())) return '';
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        } catch { return ''; }
      };
      setFormData(prev => ({
        ...prev,
        name: existingProduct.name,
        description: existingProduct.description || '',
        category: existingProduct.category || '',
        costPrice: existingProduct.costPrice || '',
        sellingPrice: existingProduct.sellingPrice || '',
        quantityUnit: existingProduct.quantityUnit || existingProduct.unit || 'pcs',
        mfgDate: formatDateForInput(existingProduct.mfgDate || existingProduct.mfg || ''),
        expiryDate: formatDateForInput(existingProduct.expiryDate || existingProduct.expiry || '')
      }));
      setTrackExpiry(Boolean(existingProduct.expiryDate || existingProduct.expiry || existingProduct.mfgDate || existingProduct.mfg));
      
      // Show notification
      if (window.showToast) {
        window.showToast(`Product "${existingProduct.name}" found! Details auto-filled.`, 'success');
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validation according to backend model requirements
    const errors = [];
    
    // Required fields from backend: name, quantity, unit, unitPrice, sellingUnitPrice, mfg, expiryDate, description
    if (!formData.name || !formData.name.trim()) {
      errors.push('Product name is required');
    }
    
    if (!formData.quantityUnit || !formData.quantityUnit.trim()) {
      errors.push('Quantity unit is required');
    }
    
    // Check if quantity is provided (backend requires quantity)
    const quantity = (() => {
      const raw = formData.quantity ? Number(formData.quantity) : 0;
      if (!Number.isFinite(raw) || raw < 0) return NaN;
      if (['pcs', 'pieces', 'piece', 'packet', 'packets', 'box', 'boxes'].includes((formData.quantityUnit || '').toLowerCase())) {
        return Math.floor(raw);
      }
      return raw;
    })();
    if (!Number.isFinite(quantity) || quantity < 0) {
      errors.push('Quantity must be a valid number and 0 or greater');
    }
    
    // Backend requires unitPrice (costPrice) and sellingUnitPrice (sellingPrice)
    const costPrice = parseFloat(formData.costPrice) || 0;
    const sellingPrice = parseFloat(formData.sellingPrice) || 0;
    
    if (costPrice < 0) {
      errors.push('Cost price must be 0 or greater');
    }
    
    if (sellingPrice < 0) {
      errors.push('Selling price must be 0 or greater');
    }
    
    // Validate optional expiry tracking fields
    if (trackExpiry) {
      if (!formData.mfgDate) {
        errors.push('Manufacturing date (MFG Date) is required');
      }
      
      if (!formData.expiryDate) {
        errors.push('Expiry date is required');
      }
    }
    
    // Backend requires description
    if (!formData.description || !formData.description.trim()) {
      errors.push('Product description is required');
    }
    
    // Validate dates
    if (trackExpiry && formData.mfgDate && formData.expiryDate) {
      const mfgDate = new Date(formData.mfgDate);
      const expiryDate = new Date(formData.expiryDate);
      if (expiryDate < mfgDate) {
        errors.push('Expiry date must be after manufacturing date');
      }
    }
    
    if (errors.length > 0) {
      const errorMessage = errors.join('\n');
      if (window.showToast) {
        window.showToast(errorMessage, 'error');
      } else {
        alert(errorMessage);
      }
      return;
    }
    
    const productData = {
      ...formData,
      quantity: quantity, // Backend uses 'quantity' field
      costPrice: costPrice,
      unitPrice: costPrice, // Backend uses 'unitPrice' field
      sellingPrice: sellingPrice,
      sellingUnitPrice: sellingPrice, // Backend uses 'sellingUnitPrice' field
      quantityUnit: formData.quantityUnit || 'pcs',
      unit: formData.quantityUnit || 'pcs', // Backend uses 'unit' field
      mfg: trackExpiry ? formData.mfgDate : undefined, // Backend uses 'mfg' field
      mfgDate: trackExpiry ? formData.mfgDate : undefined, // Keep for backward compatibility
      expiryDate: trackExpiry ? formData.expiryDate : undefined
    };
    
    // Remove stock field if it exists
    delete productData.stock;
    if (!trackExpiry) {
      delete productData.mfg;
      delete productData.mfgDate;
      delete productData.expiryDate;
    }
    
    onSave(productData);
    if (window.showToast) {
      window.showToast(`Product "${formData.name}" added successfully.`, 'success');
    }
  };


  const handleScanResult = (result) => {
    setFormData(prev => ({
      ...prev,
      barcode: result
    }));
  };

  // Note: Scanner integration would be implemented here
  // For now, this is a placeholder for future barcode scanning functionality

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 sticky top-0 bg-white rounded-t-xl">
          <div className="flex items-center">
            <div className="p-1.5 sm:p-2 bg-blue-100 rounded-lg mr-2 sm:mr-3">
              <Package className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Add New Product</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          {planLimitError && (
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-amber-100 to-amber-50 p-4 shadow-md">
              <div className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-amber-700">Plan limit reached</p>
                  <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                    {planLimitError}
                  </p>
                </div>
              </div>
            </div>
          )}
          {/* Basic Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Product Name *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="input-field"
                placeholder="Enter product name"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category
              </label>
              <div className="flex gap-2">
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  className="input-field flex-1"
                >
                  <option value="">
                    {allCategories.length === 0 ? 'No categories yet - Create one' : 'Select Category'}
                  </option>
                  {allCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ')}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowCreateCategory(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2 whitespace-nowrap"
                  title="Create New Category"
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">New</span>
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4 sm:space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description *
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                className="input-field"
                rows={3}
                placeholder="Enter product description"
                required
              />
            </div>
            <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 select-none">
              <input
                id="trackExpiry"
                type="checkbox"
                checked={trackExpiry}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setTrackExpiry(checked);
                  if (!checked) {
                    setFormData(prev => ({
                      ...prev,
                      mfgDate: '',
                      expiryDate: ''
                    }));
                  }
                }}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Track product expiry
            </label>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cost Price (₹) *
              </label>
              <input
                type="number"
                name="costPrice"
                value={formData.costPrice}
                onChange={handleChange}
                className="input-field"
                placeholder="0.00"
                step="0.01"
                min="0"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selling Price (₹) *
              </label>
              <input
                type="number"
                name="sellingPrice"
                value={formData.sellingPrice}
                onChange={handleChange}
                className="input-field"
                placeholder="0.00"
                step="0.01"
                min="0"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quantity Unit *
              </label>
              <select
                name="quantityUnit"
                value={formData.quantityUnit || 'pcs'}
                onChange={handleChange}
                className="input-field"
                required
              >
                <option value="pcs">Pieces (pcs)</option>
                <option value="kg">Kilograms (kg)</option>
                <option value="gm">Grams (gm)</option>
                <option value="liters">Liters (L)</option>
                <option value="ml">Milliliters (mL)</option>
                <option value="boxes">Boxes</option>
                <option value="packets">Packets</option>
                <option value="bottles">Bottles</option>
              </select>
            </div>
          </div>

          {/* Inventory */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quantity *
              </label>
              <input
                type="number"
                name="quantity"
                value={formData.quantity}
                onChange={handleChange}
                onWheel={(e) => e.currentTarget.blur()}
                className="input-field"
                placeholder="0"
                min="0"
                step={['kg', 'gm', 'liters', 'ml'].includes((formData.quantityUnit || '').toLowerCase()) ? '0.01' : '1'}
                required
              />
            </div>

            {trackExpiry && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Manufacturing Date (MFG) *
                  </label>
                  <input
                    type="date"
                    name="mfgDate"
                    value={formData.mfgDate}
                    onChange={handleChange}
                    className="input-field"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Expiry Date *
                  </label>
                  <input
                    type="date"
                    name="expiryDate"
                    value={formData.expiryDate}
                    onChange={handleChange}
                    className="input-field"
                    required
                  />
                </div>
              </>
            )}
          </div>

          {/* Barcode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Barcode
            </label>
            <div className="relative">
              <input
                type="text"
                name="barcode"
                value={formData.barcode}
                onChange={handleChange}
                className="input-field w-full pr-12"
                placeholder="Enter or scan barcode"
              />
              <button
                type="button"
                onClick={() => setShowBarcodeScanner(true)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white border border-primary-500 text-primary-600 rounded-lg hover:bg-primary-50 transition-colors"
                title="Scan with camera"
              >
                <QrCode className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-4 sm:pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary w-full sm:w-auto order-2 sm:order-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary w-full sm:w-auto order-1 sm:order-2"
            >
              Add Product
            </button>
          </div>
        </form>

        {/* Camera Barcode Scanner */}
        {showBarcodeScanner && (
          <BarcodeScanner
            onScan={(barcode) => {
              setFormData(prev => ({ ...prev, barcode }));
              searchProductByBarcode(barcode);
              setShowBarcodeScanner(false);
            }}
            onClose={() => setShowBarcodeScanner(false)}
          />
        )}

        {/* Create Category Modal */}
        {showCreateCategory && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <div className="flex items-center">
                  <div className="p-2 bg-blue-100 rounded-lg mr-3">
                    <Plus className="h-5 w-5 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Create New Category</h3>
                </div>
                <button
                  onClick={() => {
                    setShowCreateCategory(false);
                    setNewCategoryName('');
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Close modal"
                >
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Category Name *
                  </label>
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    className="input-field w-full"
                    placeholder="Enter category name (e.g., Electronics, Frozen Foods)"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateCategory();
                      }
                    }}
                    autoFocus
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Category will be saved and can be used for future products
                  </p>
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateCategory(false);
                      setNewCategoryName('');
                    }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateCategory}
                    className="btn-primary"
                  >
                    Create & Select
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AddProductModal;

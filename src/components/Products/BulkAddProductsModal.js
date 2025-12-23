import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Package, AlertTriangle, Save, Zap, Minimize2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getLimitErrorMessage } from '../../utils/planUtils';
const BulkAddProductsModal = ({
  onClose,
  onSave,
  planLimitError = '',
  onClearPlanLimitError
}) => {
  const { state } = useApp();
  // Initial product template - matching AddProductModal fields
  const createEmptyProduct = () => ({
    name: '',
    description: '',
    category: '',
    barcode: '',
    unit: 'pcs',
    lowStockLevel: 10,
    isActive: true
  });
  // Load saved data from localStorage on component mount
  const loadSavedProducts = () => {
    try {
      const saved = localStorage.getItem('bulkAddProducts_saved');
      if (saved) {
        const parsedProducts = JSON.parse(saved);
        // Validate that we have an array of products
        if (Array.isArray(parsedProducts) && parsedProducts.length > 0) {
          return parsedProducts;
        }
      }
    } catch (error) {
      // Clear corrupted data
      localStorage.removeItem('bulkAddProducts_saved');
    }
    // Return default empty products
    return [createEmptyProduct(), createEmptyProduct()];
  };
  const [products, setProducts] = useState(loadSavedProducts);
  const [saving, setSaving] = useState(false);
  const [limitError, setLimitError] = useState('');
  // Focus trap for accessibility
  const { containerRef } = useFocusTrap();
  // Clear limit error when modal opens
  useEffect(() => {
    if (planLimitError && onClearPlanLimitError) {
      onClearPlanLimitError();
    }
  }, [planLimitError, onClearPlanLimitError]);
  // Update product at specific index
  const updateProduct = (index, field, value) => {
    const updatedProducts = [...products];
    updatedProducts[index] = {
      ...updatedProducts[index],
      [field]: value
    };
    setProducts(updatedProducts);
    // Clear limit error when user makes changes
    if (limitError) {
      setLimitError('');
    }
  };
  // Add new product row
  const addProductRow = () => {
    setProducts([...products, createEmptyProduct()]);
  };
  // Remove product row
  const removeProductRow = (index) => {
    if (products.length > 1) {
      const updatedProducts = products.filter((_, i) => i !== index);
      setProducts(updatedProducts);
    }
  };
  // Save products to localStorage and close modal
  const handleMinimize = () => {
    try {
      // Filter out completely empty products (those with no data at all)
      const productsToSave = products.filter(product =>
        product.name?.trim() ||
        product.description?.trim() ||
        product.category?.trim() ||
        product.barcode?.trim() ||
        product.unit !== 'pcs' ||
        product.lowStockLevel !== 10
      );
      // If no meaningful data, don't save anything
      if (productsToSave.length === 0) {
        localStorage.removeItem('bulkAddProducts_saved');
      } else {
        // Always save at least 2 products (current + empty for convenience)
        const finalProducts = productsToSave.length >= 2
          ? productsToSave
          : [...productsToSave, createEmptyProduct()];
        localStorage.setItem('bulkAddProducts_saved', JSON.stringify(finalProducts));
      }
      onClose(); // Close the modal
    } catch (error) {
      // Still close the modal even if save fails
      onClose();
    }
  };
  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    // Validate products
    const validProducts = products.filter(p => p.name && p.name.trim());
    if (validProducts.length === 0) {
      setLimitError('Please add at least one product with a name');
      return;
    }
    // Check limits
    const remainingCapacity = state.aggregatedUsage?.products?.remaining || 0;
    if (remainingCapacity !== null && remainingCapacity !== undefined && remainingCapacity < validProducts.length) {
      const errorMessage = getLimitErrorMessage('products', state.aggregatedUsage);
      setLimitError(errorMessage);
      return;
    }
    setSaving(true);
    try {
      const result = onSave(validProducts);
      if (result !== false) {
        // Success - clear saved data and modal will be closed by parent
        localStorage.removeItem('bulkAddProducts_saved');
      }
    } catch (error) {
      setLimitError('Error saving products. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  // Get current limit info
  const limit = state.aggregatedUsage?.products?.limit;
  const used = state.aggregatedUsage?.products?.used || 0;
  const remaining = limit === 'Unlimited' || limit === null ? 'Unlimited' : Math.max(0, (limit || 0) - used);
  const canAdd = remaining === 'Unlimited' || remaining > products.filter(p => p.name && p.name.trim()).length;
  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-[1050] p-4">
      <div
        ref={containerRef}
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden transition-colors"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-add-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Zap className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="bulk-add-title" className="text-xl font-bold text-gray-900 dark:text-white truncate">
                Bulk Add Products
              </h2>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Same fields as single product form • Press Shift + M to open
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMinimize}
              className="px-3 py-1.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-lg transition-colors flex items-center gap-1"
              aria-label="Save and close modal"
              title="Save progress and close (data will be restored when reopened)"
            >
              <Minimize2 className="h-3 w-3" />
              Save & Close
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('bulkAddProducts_saved');
                onClose();
              }}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors rounded-lg hover:bg-white dark:hover:bg-slate-700"
              aria-label="Close without saving"
              title="Close without saving progress"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {/* Limit Info */}
        <div className="px-6 py-3 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-slate-400">
              Product Limit: {used} / {limit === 'Unlimited' || limit === null ? '∞' : limit}
              {!canAdd && ' (Limit reached)'}
            </span>
            <span className={`font-medium ${canAdd ? 'text-green-600' : 'text-red-600'}`}>
              {remaining === 'Unlimited' ? 'Unlimited' : `${remaining} remaining`}
            </span>
          </div>
        </div>
        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
          {/* Products Table */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-4">
              {products.map((product, index) => (
                <div
                  key={index}
                  className="bg-white dark:bg-slate-700/30 border border-gray-200 dark:border-slate-700 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
                >
                  {/* Row Header */}
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${product.name && product.name.trim()
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        }`}>
                        <Package className="h-4 w-4" />
                      </div>
                      <span className="font-medium text-gray-900 dark:text-white">Product {index + 1}</span>
                      {product.name && product.name.trim() && (
                        <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-1 rounded-full">
                          ✓ Ready
                        </span>
                      )}
                    </div>
                    {products.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeProductRow(index)}
                        className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label={`Remove product ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {/* Product Fields - Matching AddProductModal */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Product Name */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                        Product Name *
                      </label>
                      <input
                        type="text"
                        value={product.name}
                        onChange={(e) => updateProduct(index, 'name', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                        placeholder="Enter product name"
                        required
                      />
                    </div>
                    {/* Category */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                        Category
                      </label>
                      <input
                        type="text"
                        value={product.category}
                        onChange={(e) => updateProduct(index, 'category', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                        placeholder="Enter category (optional)"
                      />
                    </div>
                    {/* Description */}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                        Description
                      </label>
                      <input
                        type="text"
                        value={product.description}
                        onChange={(e) => updateProduct(index, 'description', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                        placeholder="Enter product description (optional)"
                      />
                    </div>
                    {/* Unit */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                        Unit *
                      </label>
                      <select
                        value={product.unit}
                        onChange={(e) => updateProduct(index, 'unit', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
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
                    {/* Low Stock Level */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                        Low Stock Level
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={product.lowStockLevel}
                        onChange={(e) => updateProduct(index, 'lowStockLevel', parseInt(e.target.value) || 10)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                        placeholder="10"
                      />
                    </div>
                    {/* Barcode */}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                        Barcode
                      </label>
                      <input
                        type="text"
                        value={product.barcode}
                        onChange={(e) => updateProduct(index, 'barcode', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                        placeholder="Enter or scan barcode (optional)"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Footer */}
          <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50 flex-shrink-0">
            {/* Add Row Button */}
            <button
              type="button"
              onClick={addProductRow}
              className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Product Row
            </button>
            {/* Error Message */}
            {(limitError || planLimitError) && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertTriangle className="h-4 w-4" />
                {limitError || planLimitError}
              </div>
            )}
            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !canAdd}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save {products.filter(p => p.name && p.name.trim()).length} Products
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
export default BulkAddProductsModal;

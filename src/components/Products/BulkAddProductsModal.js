import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Package, AlertTriangle, Save, Zap, Minus } from 'lucide-react';
import { useApp, isPlanExpired } from '../../context/AppContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getTranslation } from '../../utils/translations';
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
        if (Array.isArray(parsedProducts) && parsedProducts.length > 0) {
          return parsedProducts;
        }
      }
    } catch (error) {
      localStorage.removeItem('bulkAddProducts_saved');
    }
    return [createEmptyProduct()];
  };

  const [products, setProducts] = useState(loadSavedProducts);
  const [saving, setSaving] = useState(false);
  const [limitError, setLimitError] = useState('');
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
    if (limitError) setLimitError('');
  };

  // Add new product row
  const addProductRow = () => {
    setProducts([createEmptyProduct(), ...products]);
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
      const productsToSave = products.filter(product =>
        product.name?.trim() ||
        product.description?.trim() ||
        product.category?.trim() ||
        product.barcode?.trim() ||
        product.unit !== 'pcs' ||
        product.lowStockLevel !== 10
      );
      if (productsToSave.length === 0) {
        localStorage.removeItem('bulkAddProducts_saved');
      } else {
        const finalProducts = productsToSave.length >= 2
          ? productsToSave
          : [...productsToSave, createEmptyProduct()];
        localStorage.setItem('bulkAddProducts_saved', JSON.stringify(finalProducts));
      }
      onClose();
    } catch (error) {
      onClose();
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isPlanExpired(state)) {
      setLimitError(getTranslation('planExpiredAddProduct', state.currentLanguage));
      return;
    }
    const validProducts = products.filter(p => p.name && p.name.trim());
    if (validProducts.length === 0) {
      setLimitError(getTranslation('atLeastOneProductName', state.currentLanguage));
      return;
    }
    const remainingCapacity = state.aggregatedUsage?.products?.remaining || 0;
    if (remainingCapacity !== null && remainingCapacity !== undefined && remainingCapacity < validProducts.length) {
      const errorMessage = getLimitErrorMessage('products', state.aggregatedUsage);
      setLimitError(errorMessage);
      return;
    }
    setSaving(true);
    try {
      const result = await onSave(validProducts);
      if (result !== false) {
        localStorage.removeItem('bulkAddProducts_saved');
      }
    } catch (error) {
      setLimitError(getTranslation('errorSavingProducts', state.currentLanguage));
    } finally {
      setSaving(false);
    }
  };

  const limit = state.aggregatedUsage?.products?.limit;
  const used = state.aggregatedUsage?.products?.used || 0;
  const remaining = limit === 'Unlimited' || limit === null ? 'Unlimited' : Math.max(0, (limit || 0) - used);
  const canAdd = remaining === 'Unlimited' || remaining > products.filter(p => p.name && p.name.trim()).length;

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 z-[99999] flex items-end md:items-center justify-center animate-fadeIn">
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
      `}</style>
      <div
        ref={containerRef}
        className="bg-white dark:bg-slate-900 w-full md:max-w-4xl !h-full md:!h-[90vh] !rounded-none md:!rounded-xl shadow-lg border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:h-auto m-0"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
              <Zap className="h-5 w-5 text-slate-900 dark:text-slate-100" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">
                {getTranslation('bulkAddProducts', state.currentLanguage)}
              </h2>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                {getTranslation('bulkAddProductsDesc', state.currentLanguage)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMinimize}
              className="p-2 text-gray-400 hover:text-slate-900 dark:hover:text-indigo-400 transition-colors"
              title={getTranslation('minimizeDesc', state.currentLanguage)}
            >
              <Minus className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('bulkAddProducts_saved');
                onClose();
              }}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
              title={getTranslation('closeWithoutSaving', state.currentLanguage)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Limit Tracker */}
        <div className="px-6 py-2.5 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-3 w-3 text-gray-400" />
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                {getTranslation('productLimit', state.currentLanguage)}: {used} / {limit === 'Unlimited' || limit === null ? '∞' : limit}
              </span>
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-widest ${canAdd ? 'text-green-600' : 'text-red-600'}`}>
              {remaining === 'Unlimited' ? getTranslation('unlimited', state.currentLanguage) : `${remaining} ${getTranslation('remaining', state.currentLanguage)}`}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0" noValidate>
          {/* Scrollable Rows */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 dark:bg-transparent">
            {products.map((product, index) => (
              <div
                key={index}
                className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden"
              >
                <div className="px-4 py-3 bg-gray-50/80 dark:bg-slate-800/30 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-900 dark:bg-slate-900 text-white text-[10px] font-bold">
                      {products.length - index}
                    </span>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      {product.name?.trim() ? product.name : `${getTranslation('product', state.currentLanguage)} ${products.length - index}`}
                    </span>
                  </div>
                  {products.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeProductRow(index)}
                      className="p-1 px-2 text-[10px] font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-md transition-all uppercase tracking-widest border border-red-100 dark:border-red-900/20"
                    >
                      {getTranslation('remove', state.currentLanguage)}
                    </button>
                  )}
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-0.5">
                      {getTranslation('productNameLabel', state.currentLanguage)} *
                    </label>
                    <input
                      type="text"
                      value={product.name}
                      onChange={(e) => updateProduct(index, 'name', e.target.value)}
                      className="block w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder={getTranslation('enterProductName', state.currentLanguage)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-0.5">
                      {getTranslation('categoryHeader', state.currentLanguage)}
                    </label>
                    <input
                      type="text"
                      value={product.category}
                      onChange={(e) => updateProduct(index, 'category', e.target.value)}
                      className="block w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder={getTranslation('enterCategoryOptional', state.currentLanguage)}
                    />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-0.5">
                      {getTranslation('descriptionHeader', state.currentLanguage)}
                    </label>
                    <input
                      type="text"
                      value={product.description}
                      onChange={(e) => updateProduct(index, 'description', e.target.value)}
                      className="block w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder={getTranslation('enterProductDescriptionOptional', state.currentLanguage)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 md:col-span-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-0.5">
                        {getTranslation('unitLabel', state.currentLanguage)}
                      </label>
                      <select
                        value={product.unit}
                        onChange={(e) => updateProduct(index, 'unit', e.target.value)}
                        className="block w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      >
                        <option value="pcs">{getTranslation('unit_pcs', state.currentLanguage)}</option>
                        <option value="kg">{getTranslation('unit_kg', state.currentLanguage)}</option>
                        <option value="gm">{getTranslation('unit_gm', state.currentLanguage)}</option>
                        <option value="liters">{getTranslation('unit_liters', state.currentLanguage)}</option>
                        <option value="ml">{getTranslation('unit_ml', state.currentLanguage)}</option>
                        <option value="boxes">{getTranslation('unit_boxes', state.currentLanguage)}</option>
                        <option value="packets">{getTranslation('unit_packets', state.currentLanguage)}</option>
                        <option value="bottles">{getTranslation('unit_bottles', state.currentLanguage)}</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-0.5">
                        {getTranslation('lowStockLevelLabel', state.currentLanguage)}
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={product.lowStockLevel}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === '' || /^[0-9]*\.?[0-9]*$/.test(value)) {
                            updateProduct(index, 'lowStockLevel', value);
                          }
                        }}
                        className="block w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                        placeholder="10"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-0.5">
                      {getTranslation('barcodeHeader', state.currentLanguage)}
                    </label>
                    <input
                      type="text"
                      value={product.barcode}
                      onChange={(e) => updateProduct(index, 'barcode', e.target.value)}
                      className="block w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder={getTranslation('enterOrScanBarcodeOptional', state.currentLanguage)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-gray-100 dark:border-slate-800 space-y-4 flex-shrink-0">
            {(limitError || planLimitError) && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase tracking-widest">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                {limitError || planLimitError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={addProductRow}
                className="flex-1 py-3.5 rounded-lg font-bold text-sm text-gray-600 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:bg-gray-100 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[10px]"
              >
                <Plus className="h-3.5 w-3.5" />
                {getTranslation('addProductRow', state.currentLanguage)}
              </button>

              <button
                type="submit"
                disabled={saving || !canAdd}
                className={`flex-[2] py-3.5 rounded-lg font-bold text-sm text-white transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 ${saving || !canAdd ? 'bg-gray-300 dark:bg-slate-800 text-gray-500 cursor-not-allowed' : 'bg-gray-900 dark:bg-slate-900 hover:opacity-90'
                  }`}
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                    {getTranslation('saving', state.currentLanguage).toUpperCase()}
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5" />
                    {getTranslation('saveProducts', state.currentLanguage).replace('{count}', products.filter(p => p.name && p.name.trim()).length).toUpperCase()}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default BulkAddProductsModal;

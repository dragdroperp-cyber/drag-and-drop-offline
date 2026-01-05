import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { X, Package, Plus, AlertTriangle, QrCode, ScanLine, RefreshCw, Minus } from 'lucide-react';
import { useApp, isPlanExpired, ActionTypes } from '../../context/AppContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getSellerIdFromAuth } from '../../utils/api';
import BarcodeScanner from '../BarcodeScanner/BarcodeScanner';
import { getTranslation } from '../../utils/translations';
import { canAddData, getLimitErrorMessage } from '../../utils/planUtils';

const AddProductModal = ({
  onClose,
  onSave,
  scannedBarcode = '',
  planLimitError = '',
  onClearPlanLimitError
}) => {
  const { state, dispatch } = useApp();
  const scannerRef = useRef(null);
  const barcodeInputRef = useRef(null);
  const { containerRef: modalRef } = useFocusTrap();

  useEffect(() => {
    if (isPlanExpired(state)) {
      if (onClose) onClose();
      if (window.showToast) {
        window.showToast(getTranslation('accessRestrictedPlanRequired', state.currentLanguage), 'warning');
      }
    }
  }, [state, onClose]);

  const loadSavedProductData = () => {
    try {
      const saved = localStorage.getItem('addProduct_saved');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return { ...parsed, barcode: scannedBarcode || parsed.barcode || '' };
        }
      }
    } catch (e) {
      localStorage.removeItem('addProduct_saved');
    }
    return {
      name: '',
      description: '',
      category: '',
      barcode: scannedBarcode || '',
      unit: 'pcs',
      lowStockLevel: 10,
      trackExpiry: false,
      isActive: true
    };
  };

  const [formData, setFormData] = useState(loadSavedProductData());
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [limitError, setLimitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [errors, setErrors] = useState({});

  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };

  const currentSellerId = getSellerIdFromAuth();
  const allCategories = state.categories
    .filter(cat => !cat.sellerId || (currentSellerId && cat.sellerId === currentSellerId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
    if (limitError) setLimitError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const newErrors = {};
    if (!formData.name?.trim()) newErrors.name = getTranslation('pleaseEnterProductName', state.currentLanguage);
    if (!formData.unit?.trim()) newErrors.unit = getTranslation('unitRequired', state.currentLanguage);

    if (formData.barcode?.trim()) {
      const duplicate = state.products.find(p => p.barcode?.trim() === formData.barcode.trim() && !p.isDeleted);
      if (duplicate) newErrors.barcode = getTranslation('barcodeExists', state.currentLanguage).replace('{name}', duplicate.name);
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    const activeProducts = state.products.filter(p => !p.isDeleted);
    const canAdd = await canAddData(activeProducts.length, 'products', state.aggregatedUsage, state.currentPlan, state.currentPlanDetails);

    if (!canAdd) {
      setLimitError(getLimitErrorMessage('products', state.aggregatedUsage));
      setIsSubmitting(false);
      return;
    }

    const productData = {
      ...formData,
      name: formData.name.trim(),
      barcode: formData.barcode?.trim() || '',
      categoryId: formData.category || null,
      lowStockLevel: Number(formData.lowStockLevel) || 10
    };

    onSave(productData);
    localStorage.removeItem('addProduct_saved');
    setIsSubmitting(false);
    handleCloseModal();
  };

  return (
    <div
      className={`fixed inset-0 bg-slate-900/40 flex items-end md:items-center justify-center z-[200] transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
      onClick={handleCloseModal}
    >
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
      `}</style>
      <div
        ref={modalRef}
        key={isClosing ? 'closing' : 'opening'}
        style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.3s ease-out forwards` }}
        className="bg-white dark:bg-slate-900 !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-2xl border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:h-auto m-0"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight flex items-center gap-2">
            <Package className="h-5 w-5 text-slate-900" />
            {getTranslation('addNewProduct', state.currentLanguage)}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (formData.name?.trim()) localStorage.setItem('addProduct_saved', JSON.stringify(formData));
                handleCloseModal();
              }}
              className="p-1 text-indigo-600 hover:text-indigo-800 transition-colors"
              title="Save draft"
            >
              <Minus className="h-5 w-5" />
            </button>
            <button onClick={handleCloseModal} className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {limitError && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-lg flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-400 font-medium leading-relaxed">{limitError}</p>
              </div>
            )}

            {/* Desktop Grid Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              {/* Product Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('productNameLabel', state.currentLanguage)}</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className={`block w-full px-4 py-3 bg-white dark:bg-slate-900 border ${errors.name ? 'border-red-500 ring-4 ring-red-500/10' : 'border-gray-200 dark:border-slate-700'} rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all`}
                  placeholder={getTranslation('enterProductName', state.currentLanguage)}
                />
                {errors.name && (
                  <p className="text-[10px] text-red-500 font-bold px-1 flex items-center gap-1">
                    <X className="h-3 w-3 bg-red-500 text-white rounded-full p-0.5" />
                    {errors.name}
                  </p>
                )}
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('categoryHeader', state.currentLanguage)}</label>
                <div className="flex gap-2">
                  <select
                    name="category"
                    value={formData.category}
                    onChange={handleChange}
                    className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all appearance-none"
                  >
                    <option value="">{getTranslation('selectCategory', state.currentLanguage)}</option>
                    {allCategories.map(cat => (
                      <option key={cat.id || cat._id} value={cat.id || cat._id}>{cat.name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setShowCreateCategory(true)} className="px-3 bg-indigo-50 dark:bg-indigo-900/20 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-900 hover:text-white transition-all">
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Unit */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('unitLabel', state.currentLanguage)}</label>
                <select
                  name="unit"
                  value={formData.unit}
                  onChange={handleChange}
                  className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all appearance-none"
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

              {/* Low Stock */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('lowStockLevelLabel', state.currentLanguage)}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  name="lowStockLevel"
                  value={formData.lowStockLevel}
                  onChange={handleChange}
                  className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                  placeholder="10"
                />
              </div>

              {/* Barcode */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('barcodeHeader', state.currentLanguage)}</label>
                <div className="relative">
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    name="barcode"
                    value={formData.barcode}
                    onChange={handleChange}
                    className={`block w-full px-4 py-3 pr-12 bg-white dark:bg-slate-900 border ${errors.barcode ? 'border-red-500 ring-4 ring-red-500/10' : 'border-gray-200 dark:border-slate-700'} rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all`}
                    placeholder={getTranslation('enterOrScanBarcode', state.currentLanguage)}
                  />
                  <button type="button" onClick={() => setShowBarcodeScanner(true)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-slate-900 transition-colors">
                    <QrCode className="h-5 w-5" />
                  </button>
                </div>
                {errors.barcode && (
                  <p className="text-[10px] text-red-500 font-bold px-1 flex items-center gap-1">
                    <X className="h-3 w-3 bg-red-500 text-white rounded-full p-0.5" />
                    {errors.barcode}
                  </p>
                )}
              </div>

              {/* Track Expiry Toggle */}
              <div className="flex items-end">
                <label className="flex items-center gap-3 p-[11px] w-full bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-800 transition-all">
                  <input
                    type="checkbox"
                    checked={formData.trackExpiry}
                    onChange={(e) => setFormData(prev => ({ ...prev, trackExpiry: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-tight">{getTranslation('trackProductExpiry', state.currentLanguage)}</span>
                </label>
              </div>

              {/* Description - Full Width */}
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('descriptionHeader', state.currentLanguage)}</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all resize-none h-20"
                  placeholder={getTranslation('enterProductDescriptionOptional', state.currentLanguage)}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-6 pt-0 pb-8 md:pb-6">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-lg font-bold text-sm text-white bg-gray-900 dark:bg-slate-900 hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2"
            >
              {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {getTranslation('addProduct', state.currentLanguage)}
            </button>
          </div>
        </form>

        {/* Create Category Modal */}
        {showCreateCategory && (
          <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[300] p-4 animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-xs border border-gray-200 dark:border-slate-800 overflow-hidden">
              <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">{getTranslation('newCategory', state.currentLanguage)}</h3>
                <button onClick={() => setShowCreateCategory(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
              </div>
              <div className="p-4 space-y-4">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="block w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-indigo-500 font-bold"
                  placeholder={getTranslation('categoryNamePlaceholder', state.currentLanguage)}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newCategoryName.trim()) return;
                    const catObj = { id: `cat-${Date.now()}`, name: newCategoryName.trim().toLowerCase(), createdAt: new Date().toISOString(), sellerId: currentSellerId };
                    dispatch({ type: ActionTypes.ADD_CATEGORY, payload: catObj });
                    setFormData(prev => ({ ...prev, category: catObj.id }));
                    setNewCategoryName('');
                    setShowCreateCategory(false);
                  }}
                  className="w-full py-2 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-800 transition-all uppercase tracking-widest"
                >
                  {getTranslation('create', state.currentLanguage)}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scanner Portal - Using new Fullscreen UI */}
        {showBarcodeScanner && (
          <BarcodeScanner
            ref={scannerRef}
            onScan={(code) => {
              if (code?.trim()) {
                setFormData(prev => ({ ...prev, barcode: code.trim() }));
                setShowBarcodeScanner(false);
              }
            }}
            onClose={() => setShowBarcodeScanner(false)}
            inline={false}
            keepOpen={false}
            hideControls={true}
          />
        )}
      </div>
    </div>
  );
};

export default AddProductModal;

import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Package, QrCode, Plus, ScanLine, RefreshCw, Sparkles, AlertTriangle } from 'lucide-react';
import { useApp, isPlanExpired, ActionTypes } from '../../context/AppContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getSellerIdFromAuth } from '../../utils/api';
import BarcodeScanner from '../BarcodeScanner/BarcodeScanner';
import { getTranslation } from '../../utils/translations';

const EditProductModal = ({ product, onClose, onSave }) => {
  const { state, dispatch } = useApp();
  const { containerRef: modalRef } = useFocusTrap();

  useEffect(() => {
    if (isPlanExpired(state)) {
      if (onClose) onClose();
      if (window.showToast) {
        window.showToast(getTranslation('accessRestrictedPlanRequired', state.currentLanguage), 'warning');
      }
    }
  }, [state, onClose]);

  const [formData, setFormData] = useState({
    name: product.name || '',
    description: product.description || '',
    category: product.categoryId || product.category || '',
    barcode: product.barcode || '',
    unit: product.unit || 'pcs',
    lowStockLevel: product.lowStockLevel || 10,
    trackExpiry: Boolean(product.trackExpiry),
    isActive: Boolean(product.isActive),
    hsnCode: product.hsnCode || '',
    gstPercent: product.gstPercent || 0,
    isGstInclusive: product.isGstInclusive !== false,
    wholesalePrice: product.wholesalePrice || 0,
    wholesaleMOQ: product.wholesaleMOQ || 1
  });

  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [errors, setErrors] = useState({});
  const scannerRef = useRef(null);

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

    setFormData(prev => {
      const newData = { ...prev, [name]: value };

      // Professional HSN Suggestion Engine (IMS Standard)
      if (name === 'gstPercent') {
        const gst = Number(value);
        const hsnMapping = {
          0: '1006',  // Grains/Rice
          5: '0910',  // Spices/Tea
          12: '0405', // Ghee/Butter
          18: '3401', // Personal Care
          28: '2202'  // Beverages/Luxury
        };

        const currentHSN = (prev.hsnCode || '').trim();
        const defaultCodes = Object.values(hsnMapping);
        const isDefaultOrEmpty = currentHSN === '' || defaultCodes.includes(currentHSN);

        // Update suggestion if field is empty or still using a previously suggested default
        if (hsnMapping[gst] !== undefined && isDefaultOrEmpty) {
          newData.hsnCode = hsnMapping[gst];
        }
      }

      return newData;
    });

    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const newErrors = {};
    if (!formData.name?.trim()) newErrors.name = getTranslation('pleaseEnterProductName', state.currentLanguage);
    if (!formData.unit?.trim()) newErrors.unit = getTranslation('unitRequired', state.currentLanguage);

    if (formData.barcode?.trim()) {
      const currentId = String(product.id || product._id || '');
      const duplicate = state.products.find(p => {
        if (!p.barcode || p.isDeleted) return false;
        if (p.barcode.trim() !== formData.barcode.trim()) return false;
        const pId = String(p.id || p._id || '');
        return pId !== currentId;
      });
      if (duplicate) newErrors.barcode = getTranslation('barcodeExists', state.currentLanguage).replace('{name}', duplicate.name);
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const selectedCategory = allCategories.find(c => (c.id || c._id) === formData.category);
    const categoryName = selectedCategory ? selectedCategory.name : formData.category;

    const productData = {
      ...product,
      ...formData,
      name: formData.name.trim(),
      category: categoryName,
      barcode: formData.barcode?.trim() || '',
      categoryId: formData.category || null,
      lowStockLevel: Number(formData.lowStockLevel) || 10,
      wholesalePrice: Number(formData.wholesalePrice) || 0,
      wholesaleMOQ: Number(formData.wholesaleMOQ) || 1,
      gstPercent: Number(formData.gstPercent) || 0
    };

    onSave(productData);
    if (window.showToast) window.showToast(getTranslation('productUpdatedSuccess', state.currentLanguage)?.replace('{name}', formData.name) || `Product "${formData.name}" updated successfully.`, 'success');
    handleCloseModal();
  };

  if (!product) return null;

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
        className="bg-white dark:bg-slate-900 !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-2xl border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:max-h-[90vh] m-0"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight flex items-center gap-2">
            <Package className="h-5 w-5 text-slate-900" />
            {getTranslation('editProduct', state.currentLanguage)}
          </h2>
          <button onClick={handleCloseModal} className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              {/* Product Name */}
              <div className="space-y-1.5 single-col-span">
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

              {/* Tax Compliance Group (Pro IMS Interface) */}
              <div className="md:col-span-2 p-5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-0.5">
                    <label className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Tax (GST)</label>
                    <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/40 px-2 py-0.5 rounded-full uppercase tracking-tighter border border-indigo-100 dark:border-indigo-800">Slab Selector</span>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <select
                        name="gstPercent"
                        value={formData.gstPercent}
                        onChange={handleChange}
                        className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all appearance-none cursor-pointer"
                      >
                        <option value="0">0% (Nil Rated)</option>
                        <option value="5">5% (Grocery Basic)</option>
                        <option value="12">12% (Standard I)</option>
                        <option value="18">18% (Standard II)</option>
                        <option value="28">28% (Luxury/Cess)</option>
                      </select>
                    </div>
                    <select
                      name="isGstInclusive"
                      value={formData.isGstInclusive.toString()}
                      onChange={(e) => setFormData(prev => ({ ...prev, isGstInclusive: e.target.value === 'true' }))}
                      className="block w-32 px-3 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-[10px] font-extrabold uppercase tracking-tight text-slate-600 dark:text-slate-400 focus:border-indigo-500 outline-none transition-all appearance-none text-center cursor-pointer"
                    >
                      <option value="true">Incl. GST</option>
                      <option value="false">Excl. GST</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between px-0.5">
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{getTranslation('hsnCode', state.currentLanguage)}</label>
                      <Sparkles className="h-3 w-3 text-indigo-400" />
                    </div>
                    {formData.hsnCode && (
                      <div className="text-[9px] font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full uppercase tracking-tighter">
                        Smart Suggested
                      </div>
                    )}
                  </div>
                  <input
                    type="text"
                    name="hsnCode"
                    value={formData.hsnCode}
                    onChange={handleChange}
                    className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                    placeholder="Enter HSN Code"
                  />
                  <p className="text-[9px] text-slate-400 font-medium px-1 italic">
                    * Suggested code based on tax slab. Verify for compliance.
                  </p>
                </div>
              </div>

              {/* Wholesale Pricing */}
              <div className="md:col-span-2 grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('wholesalePrice', state.currentLanguage)}</label>
                  <input
                    type="number"
                    name="wholesalePrice"
                    value={formData.wholesalePrice}
                    onChange={handleChange}
                    className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                    placeholder="0"
                    min="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('wholesaleMOQ', state.currentLanguage)}</label>
                  <input
                    type="number"
                    name="wholesaleMOQ"
                    value={formData.wholesaleMOQ}
                    onChange={handleChange}
                    className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                    placeholder="1"
                    min="1"
                  />
                </div>
              </div>

              {/* Barcode */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('barcodeHeader', state.currentLanguage)}</label>
                <div className="relative">
                  <input
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

              {/* Description */}
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
          <div className="p-6 pt-0 pb-8 md:pb-6 border-t border-gray-50 dark:border-slate-800/50 mt-auto">
            <button
              type="submit"
              disabled={JSON.stringify({
                name: formData.name,
                description: formData.description,
                category: formData.category,
                barcode: formData.barcode,
                unit: formData.unit,
                lowStockLevel: Number(formData.lowStockLevel),
                trackExpiry: formData.trackExpiry,
                hsnCode: formData.hsnCode,
                gstPercent: Number(formData.gstPercent),
                isGstInclusive: formData.isGstInclusive,
                wholesalePrice: Number(formData.wholesalePrice),
                wholesaleMOQ: Number(formData.wholesaleMOQ)
              }) === JSON.stringify({
                name: product.name || '',
                description: product.description || '',
                category: product.categoryId || product.category || '',
                barcode: product.barcode || '',
                unit: product.unit || 'pcs',
                lowStockLevel: Number(product.lowStockLevel || 10),
                trackExpiry: Boolean(product.trackExpiry),
                hsnCode: product.hsnCode || '',
                gstPercent: product.gstPercent || 0,
                isGstInclusive: product.isGstInclusive !== false,
                wholesalePrice: product.wholesalePrice || 0,
                wholesaleMOQ: product.wholesaleMOQ || 1
              })}
              className="w-full py-3.5 rounded-lg font-bold text-sm text-white dark:text-slate-900 bg-gray-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              <RefreshCw className="h-4 w-4" />
              {getTranslation('updateProduct', state.currentLanguage)}
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
                    const catObj = { id: `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, name: newCategoryName.trim().toLowerCase(), createdAt: new Date().toISOString(), sellerId: currentSellerId };
                    dispatch({ type: ActionTypes.ADD_CATEGORY, payload: catObj });
                    setFormData(prev => ({ ...prev, category: catObj.id }));

                    if (window.showToast) {
                      window.showToast(getTranslation('categoryAddedSuccess', state.currentLanguage).replace('{name}', newCategoryName.trim()), 'success');
                    }

                    setNewCategoryName('');
                    setShowCreateCategory(false);
                  }}
                  className="w-full py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-slate-900 rounded-lg text-sm font-bold transition-all uppercase tracking-widest"
                >
                  {getTranslation('create', state.currentLanguage)}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scanner Portal */}
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

export default EditProductModal;

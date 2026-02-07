import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Package, QrCode, Plus, ScanLine, RefreshCw, Sparkles, AlertTriangle, Image as ImageIcon, Search, Check, ChevronRight } from 'lucide-react';
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
    expiryThreshold: product.expiryThreshold || 30,
    trackExpiry: Boolean(product.trackExpiry),
    isActive: Boolean(product.isActive),
    hsnCode: product.hsnCode || '',
    gstPercent: product.gstPercent || 0,
    isGstInclusive: product.isGstInclusive !== false,
    wholesalePrice: product.wholesalePrice || 0,
    wholesaleMOQ: product.wholesaleMOQ || 1,
    longDescription: product.longDescription || '',
    isFeatured: Boolean(product.isFeatured),
    discountPrice: product.discountPrice || 0,
    images: product.images || (product.image ? [product.image] : []),
    onlineSale: product.onlineSale !== false
  });

  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryImage, setNewCategoryImage] = useState('');
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [errors, setErrors] = useState({});
  const [showCategorySelector, setShowCategorySelector] = useState(false);
  const [catSearch, setCatSearch] = useState('');
  const scannerRef = useRef(null);

  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };

  const currentSellerId = getSellerIdFromAuth();
  const allCategories = (state.categories || [])
    .filter(cat => !cat.sellerId || (currentSellerId && cat.sellerId === currentSellerId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Robust category name resolver
  const getSelectedCategoryName = (catId) => {
    if (!catId) return getTranslation('selectCategory', state.currentLanguage);

    // 1. Check current seller's categories
    const foundInAll = allCategories.find(c => String(c.id || c._id) === String(catId));
    if (foundInAll) return foundInAll.name;

    // 2. Check ALL categories (in case it's a global or legacy category)
    const foundInGlobal = (state.categories || []).find(c => String(c.id || c._id) === String(catId));
    if (foundInGlobal) return foundInGlobal.name;

    // 3. Fallback to stored category name from product if available and looks like a name
    if (product.category && String(product.category) !== String(catId)) {
      return product.category;
    }

    // 4. Return the ID as last resort
    return catId;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    // Numerical validation for specific fields
    const numericFields = ['lowStockLevel', 'wholesalePrice', 'wholesaleMOQ', 'discountPrice', 'gstPercent', 'expiryThreshold'];
    if (numericFields.includes(name)) {
      if (value !== '' && !/^\d*\.?\d*$/.test(value)) {
        return; // Don't update if not a valid number
      }
    }

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
      expiryThreshold: Number(formData.expiryThreshold) || 30,
      wholesalePrice: Number(formData.wholesalePrice) || 0,
      wholesaleMOQ: Number(formData.wholesaleMOQ) || 1,
      gstPercent: Number(formData.gstPercent) || 0,
      longDescription: formData.longDescription || '',
      isFeatured: formData.isFeatured || false,
      discountPrice: Number(formData.discountPrice) || 0,
      images: formData.images || [],
      onlineSale: formData.onlineSale !== false
    };

    onSave(productData);
    if (window.showToast) window.showToast(getTranslation('productUpdatedSuccess', state.currentLanguage)?.replace('{name}', formData.name) || `Product "${formData.name}" updated successfully.`, 'success');
    handleCloseModal();
  };

  const generateBarcode = () => {
    const newBarcode = Math.floor(100000000000 + Math.random() * 900000000000).toString();
    setFormData(prev => ({ ...prev, barcode: newBarcode }));
    if (errors.barcode) setErrors(prev => ({ ...prev, barcode: '' }));
    if (window.showToast) window.showToast('Unique Code 128 generated!', 'success');
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

              <div className="space-y-1.5 single-col-span">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('categoryHeader', state.currentLanguage)}</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCategorySelector(true)}
                    className="flex-1 flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white hover:border-slate-400 transition-all text-left"
                  >
                    <span className={formData.category ? 'text-gray-900 dark:text-white font-bold' : 'text-gray-400'}>
                      {getSelectedCategoryName(formData.category)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </button>
                  <button type="button" onClick={() => setShowCreateCategory(true)} className="px-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-600 hover:text-white transition-all border border-indigo-100 dark:border-indigo-800">
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

              <div className="md:col-span-2 grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('wholesalePrice', state.currentLanguage)}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    name="wholesalePrice"
                    value={formData.wholesalePrice}
                    onChange={handleChange}
                    className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('wholesaleMOQ', state.currentLanguage)}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    name="wholesaleMOQ"
                    value={formData.wholesaleMOQ}
                    onChange={handleChange}
                    className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                    placeholder="1"
                  />
                </div>
              </div>

              {/* Barcode */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('barcodeHeader', state.currentLanguage)}</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
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
                  <button
                    type="button"
                    onClick={generateBarcode}
                    className="px-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-600 hover:text-white transition-all flex items-center gap-1 min-w-[100px] justify-center text-[10px] font-bold uppercase"
                    title="Generate Code 128 Barcode"
                  >
                    <Sparkles className="h-4 w-4" />
                    Generate
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
              {/* Track Expiry Toggle */}
              <div className="flex gap-4">
                <div className="flex-1 flex items-end">
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

                {formData.trackExpiry && (
                  <div className="space-y-1.5 w-32 animate-fadeIn">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Alert Days</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      name="expiryThreshold"
                      value={formData.expiryThreshold}
                      onChange={handleChange}
                      className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                      placeholder="30"
                    />
                  </div>
                )}
              </div>

              {/* Description */}
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('descriptionHeader', state.currentLanguage)} (Short)</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all resize-none h-20"
                  placeholder="Short description for list view..."
                />
              </div>

              {/* Detailed Description */}
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Detailed Description (Web)</label>
                <textarea
                  name="longDescription"
                  value={formData.longDescription || ''}
                  onChange={handleChange}
                  className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all resize-none h-32"
                  placeholder="Detailed content, ingredients..."
                />
              </div>

              {/* Product Images */}
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Product Images (Max 5)</label>
                <div className="space-y-3">
                  {(formData.images || []).map((img, index) => (
                    <div key={index} className="flex gap-4 items-start">
                      <div className="flex-1">
                        <input
                          type="text"
                          value={img}
                          onChange={(e) => {
                            const newImages = [...(formData.images || [])];
                            newImages[index] = e.target.value;
                            setFormData(prev => ({ ...prev, images: newImages }));
                          }}
                          className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                          placeholder="https://..."
                        />
                      </div>
                      <div className="h-12 w-12 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 shrink-0 relative group">
                        {img && <img src={img} alt={`Preview ${index + 1}`} className="w-full h-full object-cover" />}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const newImages = formData.images.filter((_, i) => i !== index);
                          setFormData(prev => ({ ...prev, images: newImages }));
                        }}
                        className="p-3 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  ))}

                  {(!formData.images || formData.images.length < 5) && (
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, images: [...(prev.images || []), ''] }))}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded-lg transition-colors uppercase tracking-tight"
                    >
                      <Plus className="h-4 w-4" />
                      Add Image URL
                    </button>
                  )}
                </div>
              </div>

              {/* Ecommerce & Website Settings (Minimal Row) */}
              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">


                {/* Online Sale Toggle */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Visibility</span>
                  <label className="flex items-center gap-3 h-[48px] px-4 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg cursor-pointer hover:border-emerald-500 transition-all select-none">
                    <input
                      type="checkbox"
                      checked={formData.onlineSale !== false}
                      onChange={(e) => setFormData(prev => ({ ...prev, onlineSale: e.target.checked }))}
                      className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-tight">On Website</span>
                  </label>
                </div>


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
                expiryThreshold: Number(formData.expiryThreshold),
                trackExpiry: formData.trackExpiry,
                hsnCode: formData.hsnCode,
                gstPercent: Number(formData.gstPercent),
                isGstInclusive: formData.isGstInclusive,
                wholesalePrice: Number(formData.wholesalePrice),
                wholesaleMOQ: Number(formData.wholesaleMOQ),
                longDescription: formData.longDescription,
                isFeatured: formData.isFeatured,
                discountPrice: Number(formData.discountPrice),
                images: formData.images || [],
                onlineSale: formData.onlineSale
              }) === JSON.stringify({
                name: product.name || '',
                description: product.description || '',
                category: product.categoryId || product.category || '',
                barcode: product.barcode || '',
                unit: product.unit || 'pcs',
                lowStockLevel: Number(product.lowStockLevel || 10),
                expiryThreshold: Number(product.expiryThreshold || 30),
                trackExpiry: Boolean(product.trackExpiry),
                hsnCode: product.hsnCode || '',
                gstPercent: product.gstPercent || 0,
                isGstInclusive: product.isGstInclusive !== false,
                wholesalePrice: product.wholesalePrice || 0,
                wholesaleMOQ: product.wholesaleMOQ || 1,
                longDescription: product.longDescription || '',
                isFeatured: Boolean(product.isFeatured),
                discountPrice: product.discountPrice || 0,
                images: product.images || (product.image ? [product.image] : []),
                onlineSale: product.onlineSale !== false
              })}
              className="w-full py-3.5 rounded-lg font-bold text-sm text-white dark:text-slate-900 bg-gray-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              <RefreshCw className="h-4 w-4" />
              {getTranslation('updateProduct', state.currentLanguage)}
            </button>
          </div>
        </form>

        {/* Category Selector Popup Modal */}
        {showCategorySelector && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-0 md:p-4 animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 shadow-2xl w-full h-full md:h-auto md:max-h-[90vh] md:max-w-2xl md:rounded-xl rounded-none border-none md:border md:border-white/20 dark:md:border-slate-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between shrink-0">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white uppercase tracking-tight">Select Category</h3>
                <button onClick={() => setShowCategorySelector(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-400 transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-4 border-b border-gray-50 dark:border-slate-800 shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search categories..."
                    value={catSearch}
                    onChange={(e) => setCatSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-sm focus:ring-2 focus:ring-slate-900 dark:focus:ring-white transition-all"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                <div className="space-y-1">
                  {allCategories
                    .filter(cat => cat.name.toLowerCase().includes(catSearch.toLowerCase()))
                    .map(cat => (
                      <button
                        key={cat.id || cat._id}
                        onClick={() => {
                          setFormData(prev => ({ ...prev, category: cat.id || cat._id }));
                          setShowCategorySelector(false);
                          setCatSearch('');
                        }}
                        className={`w-full flex items-center justify-between p-4 rounded-lg transition-all group ${String(formData.category) === String(cat.id || cat._id)
                          ? 'bg-slate-900 text-white shadow-md'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300'
                          }`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`h-12 w-12 rounded-lg flex items-center justify-center font-bold text-xs uppercase overflow-hidden shrink-0 ${String(formData.category) === String(cat.id || cat._id) ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'
                            }`}>
                            {cat.image ? (
                              <img src={cat.image} alt={cat.name} className="w-full h-full object-cover" />
                            ) : (
                              cat.name.substring(0, 2)
                            )}
                          </div>
                          <div className="flex flex-col items-start">
                            <span className="font-bold text-sm tracking-tight">{cat.name}</span>
                            {cat.description && <span className={`text-[10px] line-clamp-1 ${String(formData.category) === String(cat.id || cat._id) ? 'text-white/60' : 'text-gray-400'}`}>{cat.description}</span>}
                          </div>
                        </div>
                        {String(formData.category) === String(cat.id || cat._id) && <Check className="h-5 w-5" />}
                      </button>
                    ))}
                  {allCategories.filter(cat => cat.name.toLowerCase().includes(catSearch.toLowerCase())).length === 0 && (
                    <div className="p-8 text-center">
                      <p className="text-gray-400 text-sm font-medium italic">No categories found</p>
                      <button
                        onClick={() => {
                          setShowCategorySelector(false);
                          setShowCreateCategory(true);
                          setNewCategoryName(catSearch);
                        }}
                        className="mt-4 text-indigo-600 font-bold text-xs uppercase tracking-widest hover:underline"
                      >
                        Create "{catSearch}"
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 border-t border-gray-50 dark:border-slate-800 shrink-0">
                <button
                  onClick={() => {
                    setShowCategorySelector(false);
                    setShowCreateCategory(true);
                  }}
                  className="w-full py-3 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-slate-700 transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add New Category
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Create Category Popup Modal */}
        {showCreateCategory && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-0 md:p-4 animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 shadow-2xl w-full h-full md:h-auto md:max-h-[85vh] md:max-w-xl md:rounded-xl rounded-none border-none md:border md:border-white/20 dark:md:border-slate-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <Plus className="h-5 w-5 text-slate-900 dark:text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white uppercase tracking-tight">Create New Category</h3>
                </div>
                <button onClick={() => setShowCreateCategory(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-400 transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-8 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="md:col-span-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Preview</label>
                    <div className="w-24 h-24 md:w-full md:aspect-square bg-slate-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 flex items-center justify-center overflow-hidden relative shadow-inner mt-2">
                      {newCategoryImage ? (
                        <img src={newCategoryImage} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-gray-300" />
                      )}
                    </div>
                  </div>
                  <div className="md:col-span-3 space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Name</label>
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        className="w-full h-[52px] px-5 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-base font-bold text-gray-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none transition-all"
                        placeholder="e.g. Fresh Fruits"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Image URL</label>
                      <input
                        type="text"
                        value={newCategoryImage}
                        onChange={(e) => setNewCategoryImage(e.target.value)}
                        className="w-full h-[52px] px-5 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none transition-all"
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Description</label>
                  <textarea
                    id="new-cat-desc-edit"
                    className="w-full h-[100px] px-5 py-4 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none resize-none transition-all"
                    placeholder="Add a short description..."
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Visibility</label>
                  <label className="flex items-center gap-4 h-[52px] px-5 bg-slate-50 dark:bg-slate-800 border-none rounded-xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-all select-none">
                    <input
                      type="checkbox"
                      id="new-cat-online-edit"
                      defaultChecked={true}
                      className="h-5 w-5 rounded-lg border-gray-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-tight">Display on online store</span>
                  </label>
                </div>
              </div>

              <div className="p-6 border-t border-gray-50 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                <button
                  onClick={() => {
                    if (!newCategoryName.trim()) return;
                    const desc = document.getElementById('new-cat-desc-edit').value;
                    const online = document.getElementById('new-cat-online-edit').checked;

                    const catObj = {
                      id: `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                      name: newCategoryName.trim(),
                      createdAt: new Date().toISOString(),
                      sellerId: currentSellerId,
                      image: newCategoryImage || '',
                      description: desc || '',
                      onlineSale: online
                    };
                    dispatch({ type: ActionTypes.ADD_CATEGORY, payload: catObj });
                    setFormData(prev => ({ ...prev, category: catObj.id }));

                    if (window.showToast) {
                      window.showToast(`Category "${newCategoryName.trim()}" created`, 'success');
                    }

                    setNewCategoryName('');
                    setNewCategoryImage('');
                    setShowCreateCategory(false);
                  }}
                  disabled={!newCategoryName.trim()}
                  className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-sm font-bold uppercase tracking-widest transition-all shadow-xl active:scale-[0.98] disabled:opacity-50"
                >
                  Create Category
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

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Package, AlertTriangle, Save, Zap, Minus, Sparkles, Image as ImageIcon, QrCode, Search, Check, ChevronRight } from 'lucide-react';
import { useApp, isPlanExpired, ActionTypes } from '../../context/AppContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getTranslation } from '../../utils/translations';
import { getLimitErrorMessage } from '../../utils/planUtils';
import { getSellerIdFromAuth } from '../../utils/api';
import BarcodeScanner from '../BarcodeScanner/BarcodeScanner';

const BulkAddProductsModal = ({
  onClose,
  onSave,
  planLimitError = '',
  onClearPlanLimitError
}) => {
  const { state, dispatch } = useApp();

  // Initial product template - matching AddProductModal fields
  const createEmptyProduct = () => ({
    name: '',
    description: '',
    category: '',
    barcode: '',
    unit: 'pcs',
    lowStockLevel: 10,
    isActive: true,
    // New fields from AddProductModal
    gstPercent: 0,
    isGstInclusive: true,
    hsnCode: '',
    wholesalePrice: 0,
    wholesaleMOQ: 1,
    trackExpiry: false,
    expiryThreshold: 3,
    longDescription: '',
    onlineSale: true,
    image: ''
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

  // Scanner & Category State
  const [showScanner, setShowScanner] = useState(false);
  const [activeScanIndex, setActiveScanIndex] = useState(null);

  const [showCategorySelector, setShowCategorySelector] = useState(false);
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(null);
  const [catSearch, setCatSearch] = useState('');

  // Create Category State
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryImage, setNewCategoryImage] = useState('');

  const { containerRef } = useFocusTrap();
  const scannerRef = useRef(null);

  // Categories helper
  const currentSellerId = getSellerIdFromAuth();
  const allCategories = (state.categories || []).filter(cat => !cat.sellerId || (currentSellerId && cat.sellerId === currentSellerId));

  // Clear limit error when modal opens
  useEffect(() => {
    if (planLimitError && onClearPlanLimitError) {
      onClearPlanLimitError();
    }
  }, [planLimitError, onClearPlanLimitError]);

  // Update product at specific index
  const updateProduct = (index, field, value) => {
    const updatedProducts = [...products];

    // Auto-suggest HSN based on GST
    if (field === 'gstPercent') {
      const gst = Number(value);
      const hsnMapping = {
        0: '1006', 5: '0910', 12: '0405', 18: '3401', 28: '2202'
      };
      // Only update if hsnCode is empty or matches a default
      const currentHSN = (updatedProducts[index].hsnCode || '').trim();
      const defaultCodes = Object.values(hsnMapping);
      if (hsnMapping[gst] !== undefined && (currentHSN === '' || defaultCodes.includes(currentHSN))) {
        updatedProducts[index].hsnCode = hsnMapping[gst];
      }
    }

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
        product.description?.trim() || // short description
        product.category?.trim() ||
        product.barcode?.trim() ||
        product.unit !== 'pcs' ||
        product.lowStockLevel !== 10 ||
        product.longDescription?.trim() ||
        product.image?.trim() ||
        product.wholesalePrice > 0 ||
        product.gstPercent > 0
      );
      if (productsToSave.length === 0) {
        localStorage.removeItem('bulkAddProducts_saved');
      } else {
        const finalProducts = productsToSave.length >= 1
          ? productsToSave
          : [...productsToSave, createEmptyProduct()]; // Ensure at least one empty
        localStorage.setItem('bulkAddProducts_saved', JSON.stringify(finalProducts));
      }
      onClose();
    } catch (error) {
      onClose();
    }
  };

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) return;
    const desc = document.getElementById('new-cat-desc')?.value;
    const online = document.getElementById('new-cat-online')?.checked;

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

    // If activeCategoryIndex is set (we came from a specific row's + button or selector), update that row
    if (activeCategoryIndex !== null) {
      updateProduct(activeCategoryIndex, 'category', catObj.name);
      setActiveCategoryIndex(null);
    }

    if (window.showToast) {
      window.showToast(`Category "${newCategoryName.trim()}" created`, 'success');
    }

    setNewCategoryName('');
    setNewCategoryImage('');
    setShowCreateCategory(false);
    setShowCategorySelector(false);
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
      // Map back to expected structure if needed, currently straightforward
      const formattedProducts = validProducts.map(p => ({
        ...p,
        // Ensure images array is created from single image field
        images: p.image ? [p.image] : []
      }));

      const result = await onSave(formattedProducts);
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
    <div className="fixed inset-0 bg-slate-900/40 z-[99999] flex items-center justify-center animate-fadeIn">
      <div
        ref={containerRef}
        className="bg-white dark:bg-slate-900 w-full h-full shadow-lg border-0 flex flex-col overflow-hidden fixed inset-0 m-0"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex-shrink-0 bg-white dark:bg-slate-900 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
              <Zap className="h-5 w-5 text-slate-900 dark:text-slate-100" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">
                {getTranslation('bulkAddProducts', state.currentLanguage)}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMinimize}
              className="p-2 text-gray-400 hover:text-slate-900 dark:hover:text-indigo-400 transition-colors"
              title={getTranslation('minimizeDesc', state.currentLanguage)}
            >
              <Minus className="h-6 w-6" />
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('bulkAddProducts_saved');
                onClose();
              }}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
              title={getTranslation('closeWithoutSaving', state.currentLanguage)}
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Limit Tracker */}
        <div className="px-6 py-2.5 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
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

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 bg-slate-50/50 dark:bg-slate-900" noValidate>
          {/* Scrollable Rows */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            <div className="max-w-7xl mx-auto w-full space-y-6">
              {products.map((product, index) => (
                <div
                  key={index}
                  className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden"
                >
                  <div className="px-5 py-4 bg-gray-50/80 dark:bg-slate-800/30 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-900 dark:bg-slate-700 text-white text-xs font-bold shadow-sm">
                        {products.length - index}
                      </span>
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                        {product.name?.trim() ? product.name : `${getTranslation('product', state.currentLanguage)} ${products.length - index}`}
                      </span>
                    </div>
                    {products.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeProductRow(index)}
                        className="text-xs font-bold text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/10 px-3 py-1.5 rounded-lg transition-all uppercase tracking-widest border border-transparent hover:border-red-100"
                      >
                        {getTranslation('remove', state.currentLanguage)}
                      </button>
                    )}
                  </div>

                  <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6">
                    {/* Basic Info Column */}
                    <div className="md:col-span-4 space-y-4">
                      <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-slate-800 pb-2 mb-2">Basic Info</h4>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">{getTranslation('productNameLabel', state.currentLanguage)} *</label>
                        <input
                          type="text"
                          value={product.name}
                          onChange={(e) => updateProduct(index, 'name', e.target.value)}
                          className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                          placeholder={getTranslation('enterProductName', state.currentLanguage)}
                          required
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">{getTranslation('categoryHeader', state.currentLanguage)}</label>
                          <div className="flex gap-2">
                            <div
                              onClick={() => {
                                setActiveCategoryIndex(index);
                                setCatSearch('');
                                setShowCategorySelector(true);
                              }}
                              className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all cursor-pointer flex items-center justify-between group hover:border-gray-400 flex-1"
                              role="button"
                            >
                              <span className={product.category ? 'text-gray-900 dark:text-white' : 'text-gray-400'}>
                                {product.category || 'Select...'}
                              </span>
                              <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveCategoryIndex(index);
                                setShowCreateCategory(true);
                                setNewCategoryName('');
                              }}
                              className="px-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-600 hover:text-white transition-all border border-indigo-100 dark:border-indigo-800"
                            >
                              <Plus className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">{getTranslation('unitLabel', state.currentLanguage)}</label>
                          <select
                            value={product.unit}
                            onChange={(e) => updateProduct(index, 'unit', e.target.value)}
                            className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                          >
                            <option value="pcs">Pcs</option>
                            <option value="kg">Kg</option>
                            <option value="gm">Gm</option>
                            <option value="liters">Liters</option>
                            <option value="ml">Ml</option>
                            <option value="boxes">Boxes</option>
                            <option value="packets">Packets</option>
                            <option value="bottles">Bottles</option>
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">{getTranslation('descriptionHeader', state.currentLanguage)} (Short)</label>
                        <input
                          type="text"
                          value={product.description}
                          onChange={(e) => updateProduct(index, 'description', e.target.value)}
                          className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                          placeholder="Short description..."
                        />
                      </div>
                    </div>

                    {/* Pricing & Tax Column */}
                    <div className="md:col-span-4 space-y-4">
                      <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-slate-800 pb-2 mb-2">Pricing & Tax</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">GST %</label>
                          <select
                            value={product.gstPercent}
                            onChange={(e) => updateProduct(index, 'gstPercent', e.target.value)}
                            className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                          >
                            <option value="0">0%</option>
                            <option value="5">5%</option>
                            <option value="12">12%</option>
                            <option value="18">18%</option>
                            <option value="28">28%</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">{getTranslation('hsnCode', state.currentLanguage)}</label>
                          <div className="relative">
                            <input
                              type="text"
                              value={product.hsnCode}
                              onChange={(e) => updateProduct(index, 'hsnCode', e.target.value)}
                              className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                              placeholder="HSN"
                            />
                            {product.hsnCode && <Sparkles className="absolute right-2 top-2.5 h-3 w-3 text-indigo-400" />}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">{getTranslation('wholesalePrice', state.currentLanguage)}</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={product.wholesalePrice}
                            onChange={(e) => updateProduct(index, 'wholesalePrice', e.target.value)}
                            className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">Min Qty</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={product.wholesaleMOQ}
                            onChange={(e) => updateProduct(index, 'wholesaleMOQ', e.target.value)}
                            className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                            placeholder="1"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 cursor-pointer mt-2">
                          <input
                            type="checkbox"
                            checked={product.isGstInclusive}
                            onChange={(e) => updateProduct(index, 'isGstInclusive', e.target.checked)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                          />
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Price is GST Inclusive</span>
                        </label>
                      </div>
                    </div>

                    {/* Inventory & Others Column */}
                    <div className="md:col-span-4 space-y-4">
                      <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-slate-800 pb-2 mb-2">Inventory & Web</h4>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">{getTranslation('barcodeHeader', state.currentLanguage)}</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={product.barcode}
                            onChange={(e) => updateProduct(index, 'barcode', e.target.value)}
                            className="block w-full px-3 py-2.5 pr-10 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                            placeholder="Scan/Enter Barcode"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setActiveScanIndex(index);
                              setShowScanner(true);
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                          >
                            <QrCode className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">Low Stock</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={product.lowStockLevel}
                            onChange={(e) => updateProduct(index, 'lowStockLevel', e.target.value)}
                            className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                            placeholder="10"
                          />
                        </div>
                        {product.trackExpiry && (
                          <div className="space-y-1.5 animate-fadeIn">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">Alert Days</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={product.expiryThreshold}
                              onChange={(e) => updateProduct(index, 'expiryThreshold', e.target.value)}
                              className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                              placeholder="3"
                            />
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <label className="flex items-center gap-2 cursor-pointer bg-gray-50 dark:bg-slate-800 p-2 rounded-lg border border-gray-100 dark:border-slate-700">
                          <input
                            type="checkbox"
                            checked={product.trackExpiry}
                            onChange={(e) => updateProduct(index, 'trackExpiry', e.target.checked)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                          />
                          <span className="text-[10px] font-bold uppercase tracking-tight text-gray-600 dark:text-gray-300">Track Expiry</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer bg-gray-50 dark:bg-slate-800 p-2 rounded-lg border border-gray-100 dark:border-slate-700">
                          <input
                            type="checkbox"
                            checked={product.onlineSale}
                            onChange={(e) => updateProduct(index, 'onlineSale', e.target.checked)}
                            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                          />
                          <span className="text-[10px] font-bold uppercase tracking-tight text-gray-600 dark:text-gray-300">Online Sale</span>
                        </label>
                      </div>
                    </div>

                    {/* Full Width Info */}
                    <div className="md:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-gray-50 dark:border-slate-800/50">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">Image URL</label>
                        <div className="flex gap-3">
                          <div className="flex-1">
                            <input
                              type="text"
                              value={product.image}
                              onChange={(e) => updateProduct(index, 'image', e.target.value)}
                              className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                              placeholder="https://..."
                            />
                          </div>
                          {product.image && (
                            <div className="h-10 w-10 rounded border border-gray-200 bg-gray-50 overflow-hidden shrink-0">
                              <img src={product.image} alt="Preview" className="w-full h-full object-cover" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-0.5">Web Description (Detailed)</label>
                        <input
                          type="text"
                          value={product.longDescription}
                          onChange={(e) => updateProduct(index, 'longDescription', e.target.value)}
                          className="block w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                          placeholder="More details for website..."
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-5 border-t border-gray-100 dark:border-slate-800 space-y-4 flex-shrink-0 bg-white dark:bg-slate-900 z-10 shadow-[0_-5px_20px_rgba(0,0,0,0.05)]">
            <div className="max-w-7xl mx-auto w-full">
              {(limitError || planLimitError) && (
                <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase tracking-widest">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  {limitError || planLimitError}
                </div>
              )}

              <div className="flex flex-col md:flex-row gap-4">
                <button
                  type="button"
                  onClick={addProductRow}
                  className="w-full md:flex-1 py-4 rounded-xl font-bold text-sm text-gray-600 bg-white dark:bg-slate-800 border-2 border-dashed border-gray-300 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800/80 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-xs"
                >
                  <Plus className="h-4 w-4" />
                  {getTranslation('addProductRow', state.currentLanguage)}
                </button>

                <button
                  type="submit"
                  disabled={saving || !canAdd}
                  className={`w-full md:flex-[2] py-4 rounded-xl font-bold text-sm transition-all active:scale-[0.98] shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 btn-shimmer ${saving || !canAdd ? 'bg-gray-300 dark:bg-slate-800 text-gray-500 cursor-not-allowed' : 'bg-gray-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90'
                    }`}
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      {getTranslation('saving', state.currentLanguage).toUpperCase()}
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      {getTranslation('saveProducts', state.currentLanguage).replace('{count}', products.filter(p => p.name && p.name.trim()).length).toUpperCase()}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Barcode Scanner Overlay */}
        {showScanner && (
          <BarcodeScanner
            onScan={(code) => {
              if (activeScanIndex !== null) {
                updateProduct(activeScanIndex, 'barcode', code);
                setShowScanner(false);
                setActiveScanIndex(null);
                if (window.showToast) window.showToast('Barcode Scanned!', 'success');
              }
            }}
            onClose={() => {
              setShowScanner(false);
              setActiveScanIndex(null);
            }}
          />
        )}

        {/* Category Selector Overlay */}
        {showCategorySelector && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100000] flex items-center justify-center p-0 md:p-4 animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 shadow-2xl w-full h-full md:h-auto md:max-h-[90vh] md:max-w-2xl md:rounded-xl rounded-none border-none md:border md:border-white/20 dark:md:border-slate-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between shrink-0">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white uppercase tracking-tight">Select Category</h3>
                <button
                  onClick={() => {
                    setShowCategorySelector(false);
                    setActiveCategoryIndex(null);
                  }}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-400 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-4 border-b border-gray-50 dark:border-slate-800 shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={catSearch}
                    onChange={(e) => setCatSearch(e.target.value)}
                    placeholder="Search categories..."
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                {allCategories
                  .filter(cat => cat.name.toLowerCase().includes(catSearch.toLowerCase()))
                  .map((cat, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        if (activeCategoryIndex !== null) {
                          updateProduct(activeCategoryIndex, 'category', cat.name);
                          setShowCategorySelector(false);
                          setActiveCategoryIndex(null);
                        }
                      }}
                      className="w-full flex items-center justify-between p-4 rounded-lg transition-all group hover:bg-slate-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-lg flex items-center justify-center font-bold text-xs uppercase overflow-hidden shrink-0 bg-slate-100 dark:bg-slate-700">
                          {cat.image ? (
                            <img src={cat.image} alt={cat.name} className="w-full h-full object-cover" />
                          ) : (
                            cat.name.substring(0, 2)
                          )}
                        </div>
                        <div className="flex flex-col items-start">
                          <span className="font-bold text-sm tracking-tight">{cat.name}</span>
                          {cat.description && <span className="text-[10px] line-clamp-1 text-gray-400">{cat.description}</span>}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-gray-300" />
                    </button>
                  ))}

                {allCategories.filter(cat => cat.name.toLowerCase().includes(catSearch.toLowerCase())).length === 0 && (
                  <div className="p-8 text-center text-gray-400 text-sm italic">
                    No categories found matching "{catSearch}"
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-gray-50 dark:border-slate-800 shrink-0">
                <button
                  onClick={() => {
                    setShowCategorySelector(false);
                    setShowCreateCategory(true);
                    setNewCategoryName(catSearch);
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

        {/* Create Category Modal */}
        {showCreateCategory && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100001] flex items-center justify-center p-0 md:p-4 animate-fadeIn">
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
                    id="new-cat-desc"
                    className="w-full h-[100px] px-5 py-4 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none resize-none transition-all"
                    placeholder="Add a short description..."
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Visibility</label>
                  <label className="flex items-center gap-4 h-[52px] px-5 bg-slate-50 dark:bg-slate-800 border-none rounded-xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-all select-none">
                    <input
                      type="checkbox"
                      id="new-cat-online"
                      defaultChecked={true}
                      className="h-5 w-5 rounded-lg border-gray-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-tight">Display on online store</span>
                  </label>
                </div>
              </div>

              <div className="p-6 border-t border-gray-50 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                <button
                  onClick={handleCreateCategory}
                  disabled={!newCategoryName.trim()}
                  className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-sm font-bold uppercase tracking-widest transition-all shadow-xl active:scale-[0.98] disabled:opacity-50"
                >
                  Create Category
                </button>
              </div>
            </div>
          </div>
        )
        }
      </div>
    </div>,
    document.body
  );
};

export default BulkAddProductsModal;

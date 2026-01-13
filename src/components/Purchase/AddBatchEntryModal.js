import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../context/AppContext';
import {
    X,
    Plus,
    Package,
    Calendar,
    AlertCircle,
    Save,
    IndianRupee,
    Minus,
    ChevronDown
} from 'lucide-react';
import { formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';
import AddProductModal from '../Products/AddProductModal';
import ProductSelectionModal from '../Products/ProductSelectionModal';
import { ActionTypes } from '../../context/AppContext';
import { addToSyncQueue } from '../../utils/dataFetcher';

const AddBatchEntryModal = ({ isOpen, onClose, onSave, existingEntry = null }) => {
    const { state, dispatch } = useApp();
    const containerRef = useRef(null);
    const [isClosing, setIsClosing] = useState(false);

    // Initialize form state
    const [formData, setFormData] = useState({
        productId: '',
        productName: '',
        quantity: '',
        costPrice: '',
        sellingUnitPrice: '',
        wholesalePrice: '',
        wholesaleMOQ: '',
        batchNumber: '',
        expiry: '',
        mfg: '',
        trackExpiry: false
    });

    const [isProductSelectionModalOpen, setIsProductSelectionModalOpen] = useState(false);
    const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
    const [error, setError] = useState('');

    // Load existing entry if editing
    useEffect(() => {
        if (isOpen) {
            setIsClosing(false);
            if (existingEntry) {
                setFormData(existingEntry);
            } else {
                setFormData({
                    productId: '',
                    productName: '',
                    quantity: '',
                    costPrice: '',
                    sellingUnitPrice: '',
                    wholesalePrice: '',
                    wholesaleMOQ: '',
                    batchNumber: '',
                    expiry: '',
                    mfg: '',
                    trackExpiry: false
                });
            }
            setError('');
        }
    }, [isOpen, existingEntry]);

    const handleCloseModal = () => {
        setIsClosing(true);
        setTimeout(() => {
            onClose();
            setIsClosing(false);
        }, 300);
    };

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));

        // Auto-fill product details when product is selected
        if (field === 'productId' && value) {
            const product = state.products.find(p => p.id === value || p._id === value);
            if (product) {
                setFormData(prev => ({
                    ...prev,
                    productName: product.name,
                    wholesalePrice: product.wholesalePrice ? Number(product.wholesalePrice).toLocaleString('en-IN') : '',
                    wholesaleMOQ: product.wholesaleMOQ ? Number(product.wholesaleMOQ).toLocaleString('en-IN') : '',
                    sellingUnitPrice: product.sellingPrice ? Number(product.sellingPrice).toLocaleString('en-IN') : '',
                    costPrice: product.costPrice ? Number(product.costPrice).toLocaleString('en-IN') : '',
                    trackExpiry: product.trackExpiry || false
                }));
            }
        }
    };

    const handleSaveNewProduct = async (productData) => {
        try {
            const { addItem, STORES } = await import('../../utils/indexedDB');

            const newProduct = {
                ...productData,
                id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                sellerId: state.user?.sellerId || state.user?.uid,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                isSynced: false,
                quantity: 0,
                stock: 0
            };

            newProduct._id = newProduct.id;

            await addItem(STORES.products, newProduct);
            dispatch({ type: ActionTypes.ADD_PRODUCT, payload: newProduct });
            await addToSyncQueue('product_create', { id: newProduct.id, ...newProduct });

            // Auto-select the new product
            setFormData(prev => ({
                ...prev,
                productId: newProduct.id,
                productName: newProduct.name,
                trackExpiry: newProduct.trackExpiry || false,
                wholesalePrice: newProduct.wholesalePrice || '',
                wholesaleMOQ: newProduct.wholesaleMOQ || ''
            }));

            setIsAddProductModalOpen(false);

            if (window.showToast) {
                window.showToast(getTranslation('productCreatedSuccess', state.currentLanguage) || 'Product created successfully', 'success');
            }
        } catch (err) {
            console.error('Failed to create product:', err);
            if (window.showToast) {
                window.showToast('Failed to create product', 'error');
            }
        }
    };

    const validateForm = () => {
        if (!formData.productName) {
            setError(getTranslation('selectProductLabel', state.currentLanguage) || 'Please select a product');
            return false;
        }
        if (!formData.quantity || parseFloat(formData.quantity.toString().replace(/,/g, '')) <= 0) {
            setError(getTranslation('validQuantityRequired', state.currentLanguage) || 'Please enter a valid quantity');
            return false;
        }
        if (!formData.costPrice || parseFloat(formData.costPrice.toString().replace(/,/g, '')) < 0) {
            setError(getTranslation('validCostPriceRequired', state.currentLanguage) || 'Please enter a valid cost price');
            return false;
        }
        if (!formData.sellingUnitPrice || parseFloat(formData.sellingUnitPrice.toString().replace(/,/g, '')) < 0) {
            setError(getTranslation('validSellingPriceRequired', state.currentLanguage) || 'Please enter a valid selling price');
            return false;
        }

        // Expiry tracking validation
        if (formData.trackExpiry) {
            if (!formData.mfg) {
                setError('MFG date is required for products with expiry tracking');
                return false;
            }
            if (!formData.expiry) {
                setError('Expiry date is required for products with expiry tracking');
                return false;
            }
            if (formData.mfg && formData.expiry && new Date(formData.expiry) <= new Date(formData.mfg)) {
                setError('Expiry date must be after MFG date');
                return false;
            }
        }

        return true;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!validateForm()) return;

        onSave(formData);
        handleCloseModal();
    };

    const parseVal = (val) => {
        if (!val) return 0;
        return parseFloat(val.toString().replace(/,/g, '')) || 0;
    };

    const retailProfit = parseVal(formData.quantity) * (parseVal(formData.sellingUnitPrice) - parseVal(formData.costPrice));
    const wholesaleProfit = parseVal(formData.quantity) * (parseVal(formData.wholesalePrice) - parseVal(formData.costPrice));

    if (!isOpen) return null;

    return createPortal(
        <div
            className={`fixed inset-0 bg-slate-900/40 flex items-end md:items-center justify-center z-[100000] transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
            onClick={handleCloseModal}
        >
            <style>{`
                @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
                @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
            `}</style>
            <div
                ref={containerRef}
                key={isClosing ? 'closing' : 'opening'}
                style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.3s ease-out forwards` }}
                className="bg-white dark:bg-slate-900 !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-2xl border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:max-h-[85vh] m-0"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <Package className="h-5 w-5 text-gray-800 dark:text-gray-100" />
                        <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">
                            {existingEntry ? 'Edit Batch Entry' : 'Add Batch Entry'}
                        </h2>
                    </div>
                    <button onClick={handleCloseModal} className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {error && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-lg flex items-start gap-2">
                                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-red-700 dark:text-red-400 font-medium leading-relaxed">{error}</p>
                            </div>
                        )}

                        {/* Product Selection */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                                {getTranslation('product', state.currentLanguage)}
                            </label>
                            <div className="flex gap-2">
                                <div
                                    onClick={() => setIsProductSelectionModalOpen(true)}
                                    className="flex-1 px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white cursor-pointer flex items-center justify-between hover:border-slate-400 dark:hover:border-slate-500 transition-colors"
                                >
                                    <span className={formData.productId ? '' : 'text-gray-500'}>
                                        {formData.productName || getTranslation('selectProductLabel', state.currentLanguage)}
                                    </span>
                                    <ChevronDown className="h-4 w-4 text-gray-400" />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsAddProductModalOpen(true)}
                                    className="p-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all flex-shrink-0"
                                    title="Add New Product"
                                >
                                    <Plus className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        {/* Product Selection Modal */}
                        {isProductSelectionModalOpen && (
                            <ProductSelectionModal
                                isOpen={isProductSelectionModalOpen}
                                onClose={() => setIsProductSelectionModalOpen(false)}
                                onSelect={(product) => {
                                    setFormData(prev => ({
                                        ...prev,
                                        productId: product.id || product._id,
                                        productName: product.name,
                                        wholesalePrice: product.wholesalePrice ? Number(product.wholesalePrice).toLocaleString('en-IN') : '',
                                        wholesaleMOQ: product.wholesaleMOQ ? Number(product.wholesaleMOQ).toLocaleString('en-IN') : '',
                                        sellingUnitPrice: product.sellingPrice ? Number(product.sellingPrice).toLocaleString('en-IN') : '',
                                        costPrice: product.costPrice ? Number(product.costPrice).toLocaleString('en-IN') : '',
                                        trackExpiry: product.trackExpiry || false
                                    }));
                                    setIsProductSelectionModalOpen(false);
                                }}
                                products={state.products}
                            />
                        )}

                        {/* Quantity */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                                {getTranslation('quantity', state.currentLanguage)}
                            </label>
                            <input
                                type="text"
                                value={formData.quantity}
                                onChange={(e) => {
                                    const rawValue = e.target.value.replace(/,/g, '');
                                    if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                                        const parts = rawValue.split('.');
                                        if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                                        handleChange('quantity', parts.join('.'));
                                    }
                                }}
                                inputMode="decimal"
                                className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                                placeholder="0"
                            />
                        </div>

                        {/* Cost & Selling Price */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                                    {getTranslation('costPrice', state.currentLanguage)}
                                </label>
                                <div className="relative">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                                        <IndianRupee className="h-3 w-3" />
                                    </div>
                                    <input
                                        type="text"
                                        value={formData.costPrice}
                                        onChange={(e) => {
                                            const rawValue = e.target.value.replace(/,/g, '');
                                            if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                                                const parts = rawValue.split('.');
                                                if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                                                handleChange('costPrice', parts.join('.'));
                                            }
                                        }}
                                        inputMode="decimal"
                                        className="block w-full pl-9 pr-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                                    {getTranslation('sellingPrice', state.currentLanguage)}
                                </label>
                                <div className="relative">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                                        <IndianRupee className="h-3 w-3" />
                                    </div>
                                    <input
                                        type="text"
                                        value={formData.sellingUnitPrice}
                                        onChange={(e) => {
                                            const rawValue = e.target.value.replace(/,/g, '');
                                            if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                                                const parts = rawValue.split('.');
                                                if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                                                handleChange('sellingUnitPrice', parts.join('.'));
                                            }
                                        }}
                                        inputMode="decimal"
                                        className="block w-full pl-9 pr-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Wholesale Price & MOQ */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                                    {getTranslation('wholesalePrice', state.currentLanguage) || 'Wholesale Price'}
                                </label>
                                <div className="relative">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                                        <IndianRupee className="h-3 w-3" />
                                    </div>
                                    <input
                                        type="text"
                                        value={formData.wholesalePrice}
                                        onChange={(e) => {
                                            const rawValue = e.target.value.replace(/,/g, '');
                                            if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                                                const parts = rawValue.split('.');
                                                if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                                                handleChange('wholesalePrice', parts.join('.'));
                                            }
                                        }}
                                        inputMode="decimal"
                                        className="block w-full pl-9 pr-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                                    {getTranslation('wholesaleMOQ', state.currentLanguage) || 'Wholesale MOQ'}
                                </label>
                                <input
                                    type="text"
                                    value={formData.wholesaleMOQ}
                                    onChange={(e) => {
                                        const rawValue = e.target.value.replace(/,/g, '');
                                        if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                                            const parts = rawValue.split('.');
                                            if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                                            handleChange('wholesaleMOQ', parts.join('.'));
                                        }
                                    }}
                                    inputMode="numeric"
                                    className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                                    placeholder="1"
                                />
                            </div>
                        </div>

                        {/* Batch Number */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                                Batch Number
                            </label>
                            <input
                                type="text"
                                value={formData.batchNumber}
                                onChange={(e) => handleChange('batchNumber', e.target.value)}
                                className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                                placeholder="Auto-generated if left empty"
                            />
                        </div>

                        {/* MFG & Expiry (if trackExpiry is true) */}
                        {formData.trackExpiry && (
                            <div className="bg-amber-50/50 dark:bg-amber-900/10 p-4 rounded-xl border border-amber-100 dark:border-amber-900/20">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider px-0.5 flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            {getTranslation('mfg', state.currentLanguage)}
                                        </label>
                                        <input
                                            type="date"
                                            value={formData.mfg}
                                            onChange={(e) => handleChange('mfg', e.target.value)}
                                            className="block w-full px-4 py-3 bg-white dark:bg-slate-700 border border-amber-200 dark:border-amber-900/30 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider px-0.5 flex items-center gap-1">
                                            <AlertCircle className="h-3 w-3" />
                                            {getTranslation('expiry', state.currentLanguage)}
                                        </label>
                                        <input
                                            type="date"
                                            value={formData.expiry}
                                            onChange={(e) => handleChange('expiry', e.target.value)}
                                            className="block w-full px-4 py-3 bg-white dark:bg-slate-700 border border-amber-200 dark:border-amber-900/30 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Profit Display */}
                        <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 p-4 rounded-xl border border-green-200 dark:border-green-900/30">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-bold text-green-700 dark:text-green-400 uppercase tracking-wider mb-1">
                                        Retail Profit
                                    </span>
                                    <span className={`text-xl font-black ${retailProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                        {formatCurrencySmart(retailProfit, state.currencyFormat)}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] font-bold text-green-700 dark:text-green-400 uppercase tracking-wider mb-1">
                                        Wholesale Profit
                                    </span>
                                    <span className={`text-xl font-black ${wholesaleProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                        {parseVal(formData.wholesalePrice) > 0 ? formatCurrencySmart(wholesaleProfit, state.currencyFormat) : '-'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-6 pt-0 pb-8 md:pb-6 grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={handleCloseModal}
                            className="w-full py-3.5 rounded-lg font-bold text-sm text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all active:scale-[0.98]"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="w-full py-3.5 rounded-lg font-bold text-sm text-white dark:text-slate-900 bg-slate-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2"
                        >
                            <Save className="h-4 w-4" />
                            {existingEntry ? 'Update Entry' : 'Add Entry'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Add Product Modal */}
            {isAddProductModalOpen && (
                <AddProductModal
                    onClose={() => setIsAddProductModalOpen(false)}
                    onSave={handleSaveNewProduct}
                />
            )}
        </div>,
        document.body
    );
};

export default AddBatchEntryModal;

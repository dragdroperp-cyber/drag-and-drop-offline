import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { Search, X, Check, Printer, ScanLine, ChevronRight, AlertCircle, ShoppingBag, Package, Info, Plus } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { updateItem, STORES } from '../../utils/indexedDB';
import { getTranslation } from '../../utils/translations';
import syncService from '../../services/syncService';

const BarcodePrintModal = ({ isOpen, onClose }) => {
    const { state, dispatch } = useApp();
    const [step, setStep] = useState(1); // 1: Select Products, 2: Preview & Print
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProductIds, setSelectedProductIds] = useState([]);
    const [productQuantities, setProductQuantities] = useState({}); // { pid: quantity }
    const [isProcessing, setIsProcessing] = useState(false);
    const [showPrice, setShowPrice] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [warningState, setWarningState] = useState({ isOpen: false, productsToFix: [] });

    // Extract unique categories for filtering
    const categories = useMemo(() => {
        const cats = new Set(state.products.filter(p => !p.isDeleted).map(p => p.category || 'General'));
        return ['All', ...Array.from(cats).sort()];
    }, [state.products]);

    const filteredProducts = useMemo(() => {
        return state.products.filter(p => {
            const matchesSearch = !p.isDeleted &&
                (p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (p.barcode && p.barcode.toLowerCase().includes(searchTerm.toLowerCase())));
            const matchesCategory = selectedCategory === 'All' || (p.category || 'General') === selectedCategory;
            return matchesSearch && matchesCategory;
        });
    }, [state.products, searchTerm, selectedCategory]);

    const toggleProduct = (pid) => {
        setSelectedProductIds(prev => {
            if (prev.includes(pid)) {
                // Remove
                const newIds = prev.filter(id => id !== pid);
                setProductQuantities(prevQ => {
                    const newQ = { ...prevQ };
                    delete newQ[pid];
                    return newQ;
                });
                return newIds;
            } else {
                // Add
                setProductQuantities(prevQ => ({ ...prevQ, [pid]: 1 }));
                return [...prev, pid];
            }
        });
    };

    const handleSelectAll = (select) => {
        if (select) {
            const allIds = filteredProducts.map(p => p.id || p._id);
            setSelectedProductIds(allIds);
            const newQuantities = {};
            allIds.forEach(id => newQuantities[id] = 1);
            setProductQuantities(newQuantities);
        } else {
            setSelectedProductIds([]);
            setProductQuantities({});
        }
    };

    const updateQuantity = (pid, val) => {
        const qty = val === '' ? '' : parseInt(val);
        setProductQuantities(prev => ({ ...prev, [pid]: qty }));
    };

    const generateBarcodeValue = () => {
        return Math.floor(100000000000 + Math.random() * 900000000000).toString();
    };

    const handleConfirmSelection = async () => {
        if (selectedProductIds.length === 0) {
            if (window.showToast) window.showToast('Please select at least one product', 'warning');
            return;
        }

        const productsWithAlphaNumeric = selectedProductIds
            .map(pid => state.products.find(p => (p.id || p._id) === pid))
            .filter(product => product && product.barcode && /\D/.test(product.barcode));

        if (productsWithAlphaNumeric.length > 0) {
            setWarningState({ isOpen: true, productsToFix: productsWithAlphaNumeric });
            return;
        }

        await processBarcodes();
    };

    const processBarcodes = async (productsToUpdatesOverrides = []) => {
        setIsProcessing(true);
        const updatedProducts = [];

        try {
            for (const pid of selectedProductIds) {
                let product = state.products.find(p => (p.id || p._id) === pid);
                if (!product) continue;

                const override = productsToUpdatesOverrides.find(p => (p.id || p._id) === (product.id || product._id));
                let productToUpdate = override || product;
                let needsUpdate = !!override;

                if (!productToUpdate.barcode) {
                    const newBarcode = generateBarcodeValue();
                    productToUpdate = {
                        ...productToUpdate,
                        barcode: newBarcode,
                    };
                    needsUpdate = true;
                }

                if (needsUpdate) {
                    const updatedProduct = {
                        ...productToUpdate,
                        updatedAt: new Date().toISOString(),
                        isSynced: false
                    };
                    await updateItem(STORES.products, updatedProduct);
                    updatedProducts.push(updatedProduct);
                }
            }

            if (updatedProducts.length > 0) {
                updatedProducts.forEach(p => {
                    dispatch({ type: ActionTypes.UPDATE_PRODUCT, payload: p });
                });

                if (syncService.isOnline()) {
                    syncService.scheduleSync();
                }

                if (window.showToast) {
                    window.showToast(`Updated barcodes for ${updatedProducts.length} products`, 'success');
                }
            }

            setStep(2);
        } catch (error) {
            console.error('Error generating barcodes:', error);
            if (window.showToast) window.showToast('Error generating barcodes', 'error');
        } finally {
            setIsProcessing(false);
            setWarningState({ isOpen: false, productsToFix: [] });
        }
    };

    const handleFixBarcodes = () => {
        const fixedProducts = warningState.productsToFix.map(p => ({
            ...p,
            barcode: generateBarcodeValue()
        }));
        processBarcodes(fixedProducts);
    };

    const handleSkipFix = () => {
        processBarcodes([]);
    };

    const handlePrint = () => {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
            const barcodesHtml = document.getElementById('barcode-print-grid').innerHTML;
            printWindow.document.write(`
                <html>
                    <head>
                        <title>Print Barcodes</title>
                        <style>
                            @page {
                                margin: 0;
                                size: auto;
                            }
                            body {
                                margin: 0;
                                padding: 10mm;
                                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                            }
                            .barcode-grid {
                                display: grid;
                                grid-template-columns: repeat(3, 1fr);
                                gap: 5mm;
                                width: 100%;
                            }
                            .barcode-label {
                                border: 0.1mm solid #eee;
                                padding: 5mm 2mm;
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                justify-content: center;
                                text-align: center;
                                page-break-inside: avoid;
                                min-height: 35mm;
                            }
                            .product-name {
                                font-size: 8pt;
                                font-weight: bold;
                                margin-bottom: 2mm;
                                text-transform: uppercase;
                                line-height: 1.1;
                                overflow: hidden;
                                display: -webkit-box;
                                -webkit-line-clamp: 2;
                                -webkit-box-orient: vertical;
                            }
                            .product-price {
                                font-size: 10pt;
                                font-weight: 900;
                                margin-top: 2mm;
                            }
                            svg {
                                width: 100% !important;
                                height: auto !important;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="barcode-grid">
                            ${barcodesHtml}
                        </div>
                        <script>
                            window.onload = () => {
                                setTimeout(() => {
                                    window.print();
                                    setTimeout(() => window.close(), 500);
                                }, 800);
                            };
                        </script>
                    </body>
                </html>
            `);
            printWindow.document.close();
        } else {
            if (window.showToast) window.showToast('Please allow popups for printing', 'warning');
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[1200] flex flex-col bg-white dark:bg-slate-900 animate-in fade-in duration-300 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-30 shadow-sm shrink-0">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl text-indigo-600 dark:text-indigo-400 shadow-sm">
                        <ScanLine className="h-6 w-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-gray-900 dark:text-white tracking-tight uppercase">
                            {step === 1 ? 'Select Products' : 'Print Barcodes'}
                        </h2>
                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">
                            {step === 1 ? 'Step 1: Choose items for labeling' : 'Step 2: Preview and print output'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => step === 2 ? setStep(1) : onClose()}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all active:scale-90"
                >
                    <X className="h-6 w-6" />
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/50 dark:bg-slate-900">
                {step === 1 ? (
                    <div className="flex flex-col h-full max-w-7xl mx-auto">
                        {/* Sticky Search & Filter Header */}
                        <div className="sticky top-0 z-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl px-8 py-6 space-y-6 border-b border-gray-100 dark:border-slate-800/50 rounded-b-3xl shadow-sm">
                            <div className="flex flex-col lg:flex-row gap-4">
                                {/* Search Box */}
                                <div className="relative flex-1 group">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-indigo-600 transition-colors" />
                                    <input
                                        type="text"
                                        placeholder="Search products by name or current barcode..."
                                        className="w-full pl-12 pr-4 h-[56px] bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700/50 rounded-2xl text-base font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all shadow-inner placeholder:text-gray-400 placeholder:font-medium"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>

                                {/* Category Filters */}
                                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar lg:max-w-md">
                                    {categories.map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => setSelectedCategory(cat)}
                                            className={`px-5 py-2.5 rounded-2xl text-[11px] font-black tracking-widest uppercase transition-all whitespace-nowrap border-2 ${selectedCategory === cat
                                                ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-900 shadow-lg'
                                                : 'bg-white/50 border-gray-100 text-gray-500 hover:border-gray-200 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600'
                                                }`}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Selection Controls */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleSelectAll(true)}
                                        className="flex items-center gap-2 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 rounded-[14px] transition-all"
                                    >
                                        <Check className="h-4 w-4" />
                                        Select All
                                    </button>
                                    <button
                                        onClick={() => handleSelectAll(false)}
                                        className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 rounded-[14px] transition-all"
                                    >
                                        Reset Select
                                    </button>
                                </div>
                                <div className="hidden sm:flex items-center gap-3">
                                    <div className="h-1 w-24 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-indigo-500 transition-all duration-500"
                                            style={{ width: `${(selectedProductIds.length / (filteredProducts.length || 1)) * 100}%` }}
                                        ></div>
                                    </div>
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                                        {selectedProductIds.length} / {filteredProducts.length} Selected
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="p-8 pb-32">
                            {/* Product List */}
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                {filteredProducts.map(p => {
                                    const isSelected = selectedProductIds.includes(p.id || p._id);
                                    const stockStatus = (p.quantity || 0) <= 0 ? 'Out of Stock' : `${p.quantity} In Stock`;
                                    const isLowStock = (p.quantity || 0) <= (state.lowStockThreshold || 5);

                                    return (
                                        <div
                                            key={p.id || p._id}
                                            onClick={() => toggleProduct(p.id || p._id)}
                                            className={`group relative flex flex-col p-5 rounded-[28px] border-2 transition-all cursor-pointer overflow-hidden ${isSelected
                                                ? 'bg-white dark:bg-slate-800 border-indigo-500 shadow-2xl shadow-indigo-500/10 -translate-y-1'
                                                : 'bg-white dark:bg-slate-900/40 border-gray-100 dark:border-slate-800/60 hover:border-gray-300 dark:hover:border-slate-600 hover:shadow-xl'
                                                }`}
                                        >
                                            <div className="flex items-start gap-4 h-full">
                                                <div className="h-20 w-20 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden border border-gray-100 dark:border-slate-700 shadow-inner group-hover:scale-110 transition-transform duration-500">
                                                    {p.imageUrl || (p.images && p.images.length > 0) ? (
                                                        <img
                                                            src={p.imageUrl || p.images[0]}
                                                            alt={p.name}
                                                            className="h-full w-full object-cover"
                                                        />
                                                    ) : (
                                                        <Package className="h-8 w-8 text-slate-200 dark:text-slate-700" />
                                                    )}
                                                </div>

                                                <div className="flex-1 min-w-0 flex flex-col h-full justify-between py-1">
                                                    <div>
                                                        <h3 className="font-extrabold text-gray-900 dark:text-white truncate text-lg tracking-tight mb-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                                            {p.name}
                                                        </h3>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{p.category || 'General'}</span>
                                                            <div className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-indigo-500 animate-pulse' : 'bg-gray-200'}`}></div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center justify-between mt-3">
                                                        <p className="text-xl font-black text-gray-900 dark:text-white">
                                                            ₹{p.sellingPrice || p.price || 0}
                                                        </p>
                                                        <span className={`text-[10px] font-black uppercase tracking-tighter px-2.5 py-1 rounded-lg ${isLowStock ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'}`}>
                                                            {stockStatus}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mt-5 pt-4 border-t border-gray-50 dark:border-slate-800/50 flex items-center justify-between">
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Current Barcode</span>
                                                    {p.barcode ? (
                                                        <span className="flex items-center gap-1.5 text-xs font-extrabold text-indigo-600 dark:text-indigo-400 font-mono">
                                                            <ScanLine className="h-3.5 w-3.5" /> {p.barcode}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] font-black text-orange-500 uppercase italic tracking-tighter">Not Assigned</span>
                                                    )}
                                                </div>

                                                {isSelected ? (
                                                    <div className="flex flex-col items-end" onClick={e => e.stopPropagation()}>
                                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Copies</span>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="text"
                                                                inputMode="numeric"
                                                                value={productQuantities[p.id || p._id] !== undefined ? productQuantities[p.id || p._id] : 1}
                                                                onChange={(e) => {
                                                                    const val = e.target.value.replace(/[^0-9]/g, '');
                                                                    updateQuantity(p.id || p._id, val);
                                                                }}
                                                                className="w-16 h-10 px-2 text-center font-black text-base text-indigo-600 bg-indigo-50/50 dark:bg-indigo-500/10 border-2 border-indigo-500/30 rounded-xl focus:outline-none focus:border-indigo-500 transition-colors"
                                                            />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="h-10 w-10 rounded-full border-2 border-gray-100 dark:border-slate-800 flex items-center justify-center text-gray-200 dark:text-slate-800 group-hover:border-indigo-500/30 group-hover:text-indigo-500/30 transition-all">
                                                        <Plus className="h-5 w-5" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Selected Badge Indicator */}
                                            {isSelected && (
                                                <div className="absolute top-0 right-0 p-2 transform translate-x-2 -translate-y-2">
                                                    <div className="bg-indigo-500 text-white p-1 rounded-bl-2xl shadow-lg">
                                                        <Check className="h-4 w-4" />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {filteredProducts.length === 0 && (
                                <div className="py-24 text-center animate-in fade-in zoom-in duration-700">
                                    <div className="w-32 h-32 bg-slate-100 dark:bg-slate-800/40 rounded-full flex items-center justify-center mx-auto mb-8 border-4 border-white dark:border-slate-800 shadow-xl">
                                        <Package className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                                    </div>
                                    <h3 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">No Items Matching Search</h3>
                                    <p className="text-gray-500 dark:text-slate-400 mt-3 max-w-sm mx-auto font-medium leading-relaxed">
                                        Try refining your search terms or select a different category to find the items you're looking for.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="p-6 md:p-12 space-y-8 max-w-7xl mx-auto">
                        <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-8 bg-white dark:bg-slate-800/50 rounded-3xl border border-gray-100 dark:border-slate-800/50 shadow-sm">
                            <div>
                                <h4 className="text-lg font-black text-gray-900 dark:text-white tracking-tight">Print Customization</h4>
                                <p className="text-sm text-gray-500 dark:text-slate-400">Configure visual elements for your printed labels</p>
                            </div>
                            <label className="flex items-center gap-4 px-6 py-3 bg-slate-50 dark:bg-slate-900/50 rounded-2xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-all select-none border border-transparent hover:border-indigo-500/30">
                                <div className={`h-6 w-6 rounded-lg border-2 flex items-center justify-center transition-all ${showPrice ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 dark:border-slate-700'}`}>
                                    <Check className={`h-4 w-4 transition-opacity ${showPrice ? 'opacity-100 text-white' : 'opacity-0'}`} />
                                </div>
                                <input
                                    type="checkbox"
                                    checked={showPrice}
                                    onChange={(e) => setShowPrice(e.target.checked)}
                                    className="hidden"
                                />
                                <span className="text-sm font-black text-gray-700 dark:text-gray-200 uppercase tracking-widest">Show Price</span>
                            </label>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 preview-barcode-grid" id="barcode-print-grid">
                            {selectedProductIds.map(pid => {
                                const product = state.products.find(p => (p.id || p._id) === pid);
                                if (!product || !product.barcode) return null;

                                const rawQty = productQuantities[pid];
                                const qty = (rawQty === undefined) ? 1 : (parseInt(rawQty) || 0);

                                return Array.from({ length: qty }).map((_, i) => (
                                    <div key={`${pid}-${i}`} className="barcode-label group">
                                        <p className="product-name">{product.name}</p>
                                        <div className="barcode-wrapper bg-white p-2 rounded-lg">
                                            <BarcodeItem value={product.barcode} name={product.name} />
                                        </div>
                                        {showPrice && (
                                            <p className="product-price">₹{product.sellingPrice || product.price || 0}</p>
                                        )}
                                    </div>
                                ));
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Sticky Footer */}
            <div className="px-8 py-6 border-t border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] shrink-0 z-40">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center gap-4">
                    {step === 1 ? (
                        <button
                            onClick={handleConfirmSelection}
                            disabled={isProcessing || selectedProductIds.length === 0}
                            className="w-full py-5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-[22px] text-sm font-black uppercase tracking-[0.2em] transition-all shadow-xl hover:shadow-2xl active:scale-[0.98] disabled:opacity-30 disabled:grayscale flex items-center justify-center gap-3"
                        >
                            {isProcessing ? (
                                <div className="h-5 w-5 border-2 border-white/30 border-t-white dark:border-slate-900/30 dark:border-t-slate-900 animate-spin rounded-full"></div>
                            ) : (
                                <>
                                    <span>Review Selection</span>
                                    <span className="bg-white/20 dark:bg-slate-900/10 px-3 py-0.5 rounded-full text-[10px]">
                                        {selectedProductIds.length} ITEMS
                                    </span>
                                </>
                            )}
                        </button>
                    ) : (
                        <div className="w-full flex gap-4">
                            <button
                                onClick={() => setStep(1)}
                                className="flex-1 py-5 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-[22px] text-sm font-black uppercase tracking-[0.2em] transition-all hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.98]"
                            >
                                Back to Selection
                            </button>
                            <button
                                onClick={handlePrint}
                                className="flex-[2] py-5 bg-indigo-600 dark:bg-indigo-500 text-white rounded-[22px] text-sm font-black uppercase tracking-[0.2em] transition-all shadow-xl hover:shadow-2xl active:scale-[0.98] flex items-center justify-center gap-3"
                            >
                                <Printer className="h-5 w-5" />
                                Send to Printer
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                .preview-barcode-grid .barcode-label {
                    background: white;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 16px 8px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                    min-height: 140px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                }
                .preview-barcode-grid .barcode-label:hover {
                    border-color: #6366f1;
                    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.1);
                    transform: translateY(-2px);
                }
                .preview-barcode-grid .product-name {
                    font-size: 10px;
                    font-weight: 800;
                    text-align: center;
                    margin-bottom: 6px;
                    color: #1e293b;
                    text-transform: uppercase;
                    letter-spacing: -0.01em;
                    line-height: 1.2;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                    width: 100%;
                }
                .preview-barcode-grid .product-price {
                    font-size: 14px;
                    font-weight: 900;
                    margin-top: 6px;
                    color: #0f172a;
                }
                .preview-barcode-grid svg {
                    max-width: 100%;
                    height: auto !important;
                }
                .dark .preview-barcode-grid .barcode-label {
                    background: white;
                    border-color: #334155;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
                }
                .dark .preview-barcode-grid .product-name {
                    color: #0f172a;
                }
                .dark .preview-barcode-grid .product-price {
                    color: #0f172a;
                }
            `}</style>

            {/* Warning Modal for Alphanumeric Barcodes */}
            {warningState.isOpen && (
                <div className="absolute inset-0 z-[1300] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full border border-gray-100 dark:border-slate-800 p-6 space-y-4">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-full shrink-0">
                                <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-500" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                    {getTranslation('hardToScanBarcode', state.currentLanguage) || 'Hard to Scan Barcode'}
                                </h3>
                                <p className="mt-2 text-sm text-gray-600 dark:text-slate-400 leading-relaxed">
                                    {warningState.productsToFix.length === 1
                                        ? `The product "${warningState.productsToFix[0].name}" has a text-based barcode ("${warningState.productsToFix[0].barcode}") which may be very small and difficult to scan.`
                                        : `${warningState.productsToFix.length} products have text-based barcodes which may be very small and hard to scan.`
                                    }
                                    <br /><br />
                                    We recommend changing it to a numeric barcode for better scanning.
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3 mt-6 pt-2">
                            <button
                                onClick={handleSkipFix}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 font-semibold text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                            >
                                {getTranslation('cancel', state.currentLanguage) || 'Cancel (Keep As Is)'}
                            </button>
                            <button
                                onClick={handleFixBarcodes}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-gray-900 dark:bg-indigo-600 text-white font-bold shadow-lg hover:opacity-90 transition-all active:scale-[0.98]"
                            >
                                {getTranslation('okChange', state.currentLanguage) || 'OK, Change It'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
};

const BarcodeItem = ({ value, name }) => {
    const svgRef = useRef(null);

    useEffect(() => {
        if (value && svgRef.current) {
            try {
                const renderBarcode = typeof JsBarcode === 'function' ? JsBarcode : (JsBarcode.default || JsBarcode);
                if (typeof renderBarcode === 'function') {
                    renderBarcode(svgRef.current, value, {
                        format: "CODE128",
                        width: 1.5,
                        height: 40,
                        displayValue: true,
                        fontSize: 10,
                        background: "#ffffff",
                        lineColor: "#000000",
                        margin: 0
                    });
                }
            } catch (err) {
                console.error('Barcode Error:', err);
            }
        }
    }, [value]);

    return <svg ref={svgRef} className="max-w-full h-auto"></svg>;
};

export default BarcodePrintModal;

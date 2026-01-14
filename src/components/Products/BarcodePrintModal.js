import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { Search, X, Check, Printer, ScanLine as BarcodeIcon, ChevronRight, AlertCircle, ShoppingBag, Package, Info } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { updateItem, STORES } from '../../utils/indexedDB';
import { getTranslation } from '../../utils/translations';
import syncService from '../../services/syncService';

const BarcodePrintModal = ({ isOpen, onClose }) => {
    const { state, dispatch } = useApp();
    const [step, setStep] = useState(1); // 1: Select Products, 2: Preview & Print
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProductIds, setSelectedProductIds] = useState([]);
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
        setSelectedProductIds(prev =>
            prev.includes(pid) ? prev.filter(id => id !== pid) : [...prev, pid]
        );
    };

    const handleSelectAll = (select) => {
        if (select) {
            setSelectedProductIds(filteredProducts.map(p => p.id || p._id));
        } else {
            setSelectedProductIds([]);
        }
    };

    const generateBarcodeValue = () => {
        return Math.floor(100000000000 + Math.random() * 900000000000).toString();
    };

    const handleConfirmSelection = async () => {
        if (selectedProductIds.length === 0) {
            if (window.showToast) window.showToast('Please select at least one product', 'warning');
            return;
        }

        // Check for alphanumeric barcodes
        const productsWithAlphaNumeric = selectedProductIds
            .map(pid => state.products.find(p => (p.id || p._id) === pid))
            .filter(product => product && product.barcode && /\D/.test(product.barcode)); // Check for non-digits

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

                // Check if this product has an override from the fix step
                const override = productsToUpdatesOverrides.find(p => (p.id || p._id) === (product.id || product._id));

                let productToUpdate = override || product;
                let needsUpdate = !!override; // If it's an override, we definitely need to update

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
        processBarcodes([]); // Proceed without overriding existing barcodes
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
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0">
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 tracking-tight flex items-center gap-2">
                    <BarcodeIcon className="h-5 w-5 text-slate-900 dark:text-indigo-400" />
                    {step === 1 ? getTranslation('selectProductsForBarcode', state.currentLanguage) || 'Select Products' : getTranslation('printBarcodes', state.currentLanguage) || 'Print Barcodes'}
                </h2>
                <button
                    onClick={() => step === 2 ? setStep(1) : onClose()}
                    className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto scrollbar-hide">
                {step === 1 ? (
                    <div className="flex flex-col h-full">
                        {/* Sticky Search & Filter Header */}
                        <div className="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl px-6 py-4 space-y-4 border-b border-gray-100 dark:border-slate-800">
                            {/* Search Box */}
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search products by name or current barcode..."
                                    className="w-full pl-12 pr-4 py-3.5 bg-gray-50 dark:bg-slate-800/80 border-none rounded-2xl text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>

                            {/* Category Filters */}
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide no-scrollbar">
                                {categories.map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => setSelectedCategory(cat)}
                                        className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border-2 ${selectedCategory === cat
                                            ? 'bg-gray-900 border-gray-900 text-white dark:bg-white dark:border-white dark:text-slate-900 shadow-md'
                                            : 'bg-white border-gray-100 text-gray-500 hover:border-gray-200 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:border-slate-700'
                                            }`}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 px-6 py-6 space-y-6">
                            {/* Selection Controls */}
                            <div className="flex items-center justify-between">
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleSelectAll(true)}
                                        className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-all"
                                    >
                                        Select All
                                    </button>
                                    <button
                                        onClick={() => handleSelectAll(false)}
                                        className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-all"
                                    >
                                        Clear All
                                    </button>
                                </div>
                                <div className="text-right">
                                    <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">
                                        {filteredProducts.length} items found
                                    </span>
                                </div>
                            </div>

                            {/* Product List */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {filteredProducts.map(p => {
                                    const isSelected = selectedProductIds.includes(p.id || p._id);
                                    const stockStatus = (p.quantity || 0) <= 0 ? 'Out of Stock' : `${p.quantity} In Stock`;
                                    const isLowStock = (p.quantity || 0) <= (state.lowStockThreshold || 5);

                                    return (
                                        <div
                                            key={p.id || p._id}
                                            onClick={() => toggleProduct(p.id || p._id)}
                                            className={`group relative flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer ${isSelected
                                                ? 'bg-indigo-50/30 dark:bg-indigo-900/10 border-indigo-500/50 shadow-sm'
                                                : 'bg-white dark:bg-slate-900 border-gray-100 dark:border-slate-800 hover:border-gray-200 dark:hover:border-slate-700'
                                                }`}
                                        >
                                            <div className={`p-3 rounded-xl shrink-0 transition-colors ${isSelected
                                                ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
                                                : 'bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-500'
                                                }`}>
                                                <Package className="h-6 w-6" />
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-0.5">
                                                    <p className="font-bold text-gray-900 dark:text-white truncate text-base leading-tight">
                                                        {p.name}
                                                    </p>
                                                    <div className="text-right ml-2 shrink-0">
                                                        <span className="text-sm font-black text-gray-900 dark:text-white">
                                                            ₹{p.sellingPrice || p.price || 0}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-semibold text-gray-400 dark:text-slate-500 capitalize">{p.category || 'General'}</span>
                                                        <span className="text-gray-300 dark:text-slate-700">|</span>
                                                        {p.barcode ? (
                                                            <span className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-tighter">
                                                                <BarcodeIcon className="h-3 w-3" /> {p.barcode}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] font-bold text-orange-500 dark:text-orange-400 uppercase tracking-tighter italic">
                                                                No Barcode
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-right">
                                                        <span className={`text-[10px] font-bold uppercase tracking-widest ${isLowStock ? 'text-red-500' : 'text-emerald-500'}`}>
                                                            {stockStatus}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className={`flex items-center justify-center h-6 w-6 rounded-full border-2 transition-all shrink-0 ${isSelected
                                                ? 'bg-indigo-600 border-indigo-600'
                                                : 'border-gray-200 dark:border-slate-800 bg-transparent'
                                                }`}>
                                                {isSelected && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="p-6 space-y-8">
                        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-800/50 rounded-2xl border border-gray-100 dark:border-slate-800">
                            <span className="text-sm font-bold text-gray-500 dark:text-slate-400">Label Options</span>
                            <label className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl cursor-pointer shadow-sm hover:border-indigo-500/50 transition-all">
                                <input
                                    type="checkbox"
                                    checked={showPrice}
                                    onChange={(e) => setShowPrice(e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="text-sm font-bold text-gray-700 dark:text-gray-200">Show Price on Barcode</span>
                            </label>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 preview-barcode-grid" id="barcode-print-grid">
                            {selectedProductIds.map(pid => {
                                const product = state.products.find(p => (p.id || p._id) === pid);
                                if (!product || !product.barcode) return null;
                                return (
                                    <div key={pid} className="barcode-label">
                                        <p className="product-name">{product.name}</p>
                                        <BarcodeItem value={product.barcode} name={product.name} />
                                        {showPrice && (
                                            <p className="product-price">₹{product.sellingPrice || product.price || 0}</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-100 dark:border-slate-800/50 mt-auto flex justify-center shrink-0">
                {step === 1 ? (
                    <button
                        onClick={handleConfirmSelection}
                        disabled={isProcessing || selectedProductIds.length === 0}
                        className="min-w-[280px] md:min-w-[400px] py-3 rounded-xl font-bold text-base text-white dark:text-slate-900 bg-gray-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isProcessing ? 'Generating...' : `Confirm & Continue (${selectedProductIds.length})`}
                    </button>
                ) : (
                    <button
                        onClick={handlePrint}
                        className="min-w-[280px] md:min-w-[400px] py-3 rounded-xl font-bold text-base text-white dark:text-slate-900 bg-gray-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-xl flex items-center justify-center gap-2"
                    >
                        <Printer className="h-5 w-5" />
                        Print Labels Now
                    </button>
                )}
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
                /* Dark mode specific - Force white background for labels (WYSIWYG) */\n                .dark .preview-barcode-grid .barcode-label {\n                    background: white;\n                    border-color: #334155;\n                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);\n                }\n                .dark .preview-barcode-grid .product-name {\n                    color: #0f172a;\n                }\n                .dark .preview-barcode-grid .product-price {\n                    color: #0f172a;\n                }
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

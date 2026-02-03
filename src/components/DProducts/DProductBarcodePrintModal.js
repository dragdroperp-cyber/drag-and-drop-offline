import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { Search, X, Check, Printer, ScanLine as BarcodeIcon, Plus, Trash2, ShoppingBag, Package, Info } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { getSellerIdFromAuth } from '../../utils/api';
import { DProductModal } from './DProducts';

const DProductBarcodePrintModal = ({ isOpen, onClose, initialProduct }) => {
    const { state, dispatch } = useApp();
    const [step, setStep] = useState(1); // 1: Setup, 2: Preview & Print
    const [items, setItems] = useState([]);
    const [printType, setPrintType] = useState('qr'); // 'barcode' or 'qr'
    const [searchTerm, setSearchTerm] = useState('');
    const [isCreateProductModalOpen, setIsCreateProductModalOpen] = useState(false);
    const [isPreparingPrint, setIsPreparingPrint] = useState(false);

    const MAX_LABELS_BATCH = 100;

    // Add initial product when modal opens
    useEffect(() => {
        if (isOpen && initialProduct && items.length === 0) {
            setItems([{
                id: Date.now(),
                productId: initialProduct.id,
                productName: initialProduct.productName,
                pCode: initialProduct.pCode,
                amount: '',
                quantity: '1'
            }]);
        }
    }, [isOpen, initialProduct, items.length]);

    const handleAddItem = (product) => {
        setItems(prev => [...prev, {
            id: Date.now(),
            productId: product.id,
            productName: product.productName,
            pCode: product.pCode,
            amount: '',
            quantity: '1'
        }]);
    };

    const handleCreateProduct = (data) => {
        const dProducts = state.dProducts || [];
        // Check for duplicate pCode locally
        const exists = dProducts.some(p => !p.isDeleted && p.pCode.toLowerCase() === data.pCode.toLowerCase());
        if (exists) {
            if (window.showToast) window.showToast('Product Code already exists!', 'error');
            return;
        }

        const sellerId = getSellerIdFromAuth();
        const newProduct = {
            id: `dp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Generate a local ID
            sellerId,
            ...data,
            isSynced: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        dispatch({ type: ActionTypes.ADD_D_PRODUCT, payload: newProduct });
        if (window.showToast) window.showToast('D-Product created successfully!', 'success');

        // Auto-select the newly created product
        handleAddItem(newProduct);
        document.getElementById('add-more-dproducts-selector').close(); // Close selector as we're done

    };

    const handleUpdateItem = (id, field, value) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, [field]: value } : item
        ));
    };

    const handleRemoveItem = (id) => {
        setItems(prev => prev.filter(item => item.id !== id));
    };

    const handleConfirm = () => {
        if (items.length === 0) {
            if (window.showToast) window.showToast('Please add at least one item', 'warning');
            return;
        }

        const invalidItems = items.filter(item => !item.amount || !item.quantity || item.quantity <= 0);
        if (invalidItems.length > 0) {
            if (window.showToast) window.showToast('Please enter valid amount and quantity for all items', 'warning');
            return;
        }

        const totalQuantity = items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
        if (totalQuantity > MAX_LABELS_BATCH) {
            if (window.showToast) window.showToast(`Cannot print more than ${MAX_LABELS_BATCH} labels at once.`, 'error');
            return;
        }

        setStep(2);
    };

    const handlePrint = async () => {
        setIsPreparingPrint(true);
        // Simulate preparing/rendering time to ensure DOM is ready
        await new Promise(resolve => setTimeout(resolve, 1500));

        const printWindow = window.open('', '_blank');
        if (printWindow) {
            const barcodesHtml = document.getElementById('dproduct-barcode-grid-print').innerHTML;
            printWindow.document.write(`
                <html>
                    <head>
                        <title>Print D-Product ${printType === 'qr' ? 'QR Codes' : 'Barcodes'}</title>
                        <style>
                            @page {
                                margin: 0;
                                size: auto;
                            }
                            body {
                                margin: 0;
                                padding: 5mm;
                                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                                background: white;
                                color: black;
                            }
                            .barcode-grid {
                                display: grid;
                                grid-template-columns: repeat(3, 1fr);
                                gap: 2mm;
                                width: 100%;
                            }
                            .barcode-label {
                                border: 0.1mm solid #000;
                                padding: 2mm;
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                justify-content: space-between;
                                text-align: center;
                                page-break-inside: avoid;
                                height: 40mm;
                                width: 100%;
                                overflow: hidden;
                                box-sizing: border-box;
                                background: white !important;
                                color: black !important;
                            }
                            .product-name {
                                font-size: 9pt;
                                font-weight: 800;
                                margin: 0 0 1mm 0;
                                text-transform: uppercase;
                                line-height: 1.1;
                                width: 100%;
                                color: black !important;
                                word-wrap: break-word;
                                display: -webkit-box;
                                -webkit-line-clamp: 2;
                                -webkit-box-orient: vertical;
                                overflow: hidden;
                                flex: 0 0 auto;
                            }
                            .product-price {
                                font-size: 11pt;
                                font-weight: 900;
                                margin: 1mm 0 0 0;
                                color: black !important;
                                flex: 0 0 auto;
                            }
                            svg, img {
                                width: auto;
                                max-width: 100%;
                                height: auto;
                                max-height: 100%;
                                object-fit: contain;
                                display: block;
                                margin: auto;
                                flex: 1 1 auto;
                                min-height: 0;
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
        setIsPreparingPrint(false);
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[1200] flex flex-col bg-white dark:bg-slate-900 animate-in fade-in duration-300 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 tracking-tight flex items-center gap-2">
                        <BarcodeIcon className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        Print D-Product Barcodes
                    </h2>

                    {/* Type Selector */}

                </div>

                <button
                    onClick={() => {
                        if (step === 2) setStep(1);
                        else onClose();
                    }}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-500 transition-colors"
                >
                    <X className="h-6 w-6" />
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
                {step === 1 ? (
                    <div className="max-w-4xl mx-auto space-y-6">


                        {/* Type Selector - Moved from Header */}
                        <div className="flex justify-center">
                            <div className="flex bg-gray-100 dark:bg-slate-800 p-1 rounded-xl">
                                <button
                                    onClick={() => setPrintType('qr')}
                                    className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${printType === 'qr'
                                        ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm'
                                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                                >
                                    QR Code
                                </button>
                                <button
                                    onClick={() => setPrintType('barcode')}
                                    className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${printType === 'barcode'
                                        ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm'
                                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                                >
                                    Barcode
                                </button>
                            </div>
                        </div>


                        <div className="flex justify-center pt-2">
                            <button
                                onClick={() => {
                                    // Show list of D-Products to add
                                    const modal = document.getElementById('add-more-dproducts-selector');
                                    if (modal) modal.showModal();
                                }}
                                className="flex items-center gap-2 px-6 py-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold rounded-2xl border-2 border-dashed border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all"
                            >
                                <Plus className="w-5 h-5" />
                                Add More D-Products
                            </button>
                        </div>

                        <div className="space-y-4">
                            {items.map((item, index) => (
                                <div key={item.id} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-4 rounded-2xl shadow-sm space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold">
                                                {index + 1}
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-gray-900 dark:text-white">{item.productName}</h3>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">P-Code: <span className="font-mono bg-gray-100 dark:bg-slate-700 px-1 rounded">{item.pCode}</span></p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleRemoveItem(item.id)}
                                            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Amount (₹)</label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-gray-900 dark:text-white"
                                                placeholder="e.g. 500"
                                                value={item.amount}
                                                onChange={(e) => {
                                                    let val = e.target.value.replace(/[^0-9.]/g, '');
                                                    const parts = val.split('.');
                                                    if (parts.length > 2) val = `${parts[0]}.${parts.slice(1).join('')}`;
                                                    handleUpdateItem(item.id, 'amount', val);
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Quantity (Labels)</label>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-gray-900 dark:text-white"
                                                placeholder="e.g. 10"
                                                value={item.quantity}
                                                onChange={(e) => {
                                                    const val = e.target.value.replace(/[^0-9]/g, '');
                                                    handleUpdateItem(item.id, 'quantity', val);
                                                }}
                                            />
                                        </div>
                                    </div>

                                    {item.amount && (
                                        <div className="pt-2">
                                            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                                                Generated Value: <span className="font-bold">{item.pCode}{item.amount}</span>
                                            </p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>


                    </div>
                ) : (
                    <div className="p-6">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" id="dproduct-barcode-grid-print">
                            {items.map(item => {
                                const barcodeValue = `${item.pCode}${item.amount}`;
                                // Create an array of length item.quantity
                                return Array.from({ length: item.quantity }).map((_, i) => (
                                    <div key={`${item.id}-${i}`} className="barcode-label">
                                        <p className="product-name">{item.productName}</p>
                                        <BarcodeItem value={barcodeValue} name={item.productName} type={printType} />
                                        <p className="product-price">₹{item.amount}</p>
                                    </div>
                                ));
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900 shrink-0">
                <div className="max-w-4xl mx-auto flex flex-col items-center gap-2">
                    {step === 1 && (
                        <div className={`text-xs font-bold ${items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0) > MAX_LABELS_BATCH ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                            Total Labels: {items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0)} / {MAX_LABELS_BATCH}
                        </div>
                    )}

                    {step === 1 ? (
                        <button
                            onClick={handleConfirm}
                            disabled={items.length === 0}
                            className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-10 py-2.5 rounded-xl font-bold text-base shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-3"
                        >
                            Next: Preview Labels
                            <Check className="w-5 h-5" />
                        </button>
                    ) : (
                        <div className="w-full flex justify-center">
                            <button
                                onClick={handlePrint}
                                disabled={isPreparingPrint}
                                className={`w-full max-w-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-2.5 px-12 rounded-xl font-bold text-sm sm:text-base shadow-2xl transition-all flex items-center justify-center gap-2 sm:gap-3 ${isPreparingPrint ? 'opacity-70 cursor-wait' : 'hover:scale-[1.02] active:scale-[0.98]'}`}
                            >
                                {isPreparingPrint ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white dark:border-slate-900/30 dark:border-t-slate-900 rounded-full animate-spin" />
                                        <span>Preparing Print...</span>
                                    </>
                                ) : (
                                    <>
                                        <Printer className="w-5 h-5 shrink-0" />
                                        <span className="whitespace-nowrap">
                                            Print <span className="hidden sm:inline">{items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0)} Labels</span>
                                        </span>
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Custom Modal for Adding More D-Products */}
            <dialog id="add-more-dproducts-selector" className="modal p-0 m-0 w-full h-full max-w-none max-h-none backdrop:bg-black/50 backdrop:backdrop-blur-sm overflow-hidden border-none bg-transparent">
                <div className="bg-white dark:bg-slate-900 w-full h-full flex flex-col shadow-none">
                    <div className="p-6 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-gray-50/50 dark:bg-slate-800/50 shrink-0">
                        <h3 className="text-xl font-black text-gray-900 dark:text-white italic uppercase tracking-tight flex items-center gap-2">
                            <Plus className="w-6 h-6 text-indigo-500" />
                            Select Products
                        </h3>
                        <button onClick={() => document.getElementById('add-more-dproducts-selector').close()} className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full transition-colors text-gray-500">
                            <X className="w-6 h-6" />
                        </button>
                    </div>

                    <div className="p-4 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search products by name or code..."
                                className="w-full pl-12 pr-4 py-3 bg-gray-100 dark:bg-slate-800 border-none rounded-xl text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                                autoFocus
                            />
                        </div>
                    </div>

                    <div className="overflow-y-auto p-6 flex-1 bg-gray-50/50 dark:bg-slate-900/50">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {/* Static Create Product Card */}
                            <button
                                onClick={() => {
                                    setIsCreateProductModalOpen(true);
                                    // Don't close selector, just open creation modal on top
                                }}
                                className="flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-900/10 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-all group text-center h-full min-h-[120px]"
                            >
                                <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-3 group-hover:scale-110 transition-transform">
                                    <Plus className="w-6 h-6" />
                                </div>
                                <p className="font-bold text-indigo-900 dark:text-indigo-300">Create New D-Product</p>
                                <p className="text-xs text-indigo-600/70 dark:text-indigo-400/70 mt-1">Add to database & select</p>
                            </button>

                            {(state.dProducts || [])
                                .filter(p => !p.isDeleted && (
                                    p.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                    p.pCode.toLowerCase().includes(searchTerm.toLowerCase())
                                ))
                                .map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => {
                                            handleAddItem(p);
                                            document.getElementById('add-more-dproducts-selector').close();
                                        }}
                                        className="flex flex-col items-start p-5 rounded-2xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-indigo-500 hover:shadow-lg hover:shadow-indigo-500/10 transition-all text-left group h-full relative overflow-hidden"
                                    >
                                        <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg transform translate-x-2 -translate-y-2 group-hover:translate-x-0 group-hover:translate-y-0 transition-transform">
                                                <Plus className="w-5 h-5" />
                                            </div>
                                        </div>

                                        <div className="mb-auto w-full">
                                            <div className="flex items-start gap-3 mb-2">
                                                <div className="h-10 w-10 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden shrink-0">
                                                    {p.imageUrl || (p.images && p.images.length > 0) ? (
                                                        <img
                                                            src={p.imageUrl || p.images[0]}
                                                            alt={p.productName}
                                                            className="h-full w-full object-cover"
                                                            onError={(e) => {
                                                                e.target.style.display = 'none';
                                                                e.currentTarget.nextSibling.style.display = 'block';
                                                            }}
                                                        />
                                                    ) : null}
                                                    <div className={(p.imageUrl || (p.images && p.images.length > 0)) ? 'hidden' : 'block'}>
                                                        <Package className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-gray-900 dark:text-white text-lg leading-tight line-clamp-2">{p.productName}</h4>
                                                </div>
                                            </div>
                                            <div className="inline-flex items-center px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-slate-700 text-xs font-mono font-medium text-gray-600 dark:text-gray-300">
                                                {p.pCode}
                                            </div>
                                        </div>

                                        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700 w-full flex justify-between items-end">
                                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Select Item</span>
                                        </div>
                                    </button>
                                ))}
                        </div>

                        {/* Empty State */}
                        {(state.dProducts || []).filter(p => !p.isDeleted && (p.productName.toLowerCase().includes(searchTerm.toLowerCase()) || p.pCode.toLowerCase().includes(searchTerm.toLowerCase()))).length === 0 && (
                            <div className="flex flex-col items-center justify-center py-12 text-center opacity-60">
                                <Search className="w-12 h-12 text-gray-300 dark:text-slate-600 mb-4" />
                                <p className="text-gray-500 dark:text-slate-400 font-medium">No products found matching "{searchTerm}"</p>
                            </div>
                        )}
                    </div>


                    {/* Create D-Product Modal */}
                    <DProductModal
                        isOpen={isCreateProductModalOpen}
                        onClose={() => setIsCreateProductModalOpen(false)}
                        onSubmit={handleCreateProduct}
                        title="Create New D-Product"
                        zIndexClass="z-[99999]"
                    />
                </div>
            </dialog>


            <style>{`
                .barcode-label {
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
                .product-name {
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
                .product-price {
                    font-size: 14px;
                    font-weight: 900;
                    margin-top: 6px;
                    color: #0f172a;
                }
                svg, img {
                    max-width: 100%;
                    height: auto !important;
                }
                .dark .barcode-label {
                    background: white;
                    border-color: #334155;
                }
                .dark .product-name, .dark .product-price {
                    color: #0f172a;
                }
            `}</style>
        </div>,
        document.body
    );
};

const BarcodeItem = ({ value, name, type }) => {
    const svgRef = useRef(null);
    const [qrCodeUrl, setQrCodeUrl] = useState(null);

    useEffect(() => {
        if (value) {
            if (type === 'qr') {
                QRCode.toDataURL(value, {
                    width: 150,
                    margin: 1,
                    errorCorrectionLevel: 'H'
                })
                    .then(url => {
                        setQrCodeUrl(url);
                    })
                    .catch(err => {
                        console.error('QR Code Generation Error:', err);
                    });
            } else if (svgRef.current) {
                try {
                    const renderBarcode = typeof JsBarcode === 'function' ? JsBarcode : (JsBarcode.default || JsBarcode);
                    if (typeof renderBarcode === 'function') {
                        renderBarcode(svgRef.current, value, {
                            format: "CODE128",
                            width: 2,
                            height: 60,
                            displayValue: false,
                            background: "#ffffff",
                            lineColor: "#000000",
                            margin: 10
                        });

                        // Set viewBox to make SVG responsive and stable in print
                        const bbox = svgRef.current.getBBox();
                        svgRef.current.setAttribute('viewBox', `0 0 ${bbox.width} ${bbox.height}`);
                        svgRef.current.removeAttribute('width');
                        svgRef.current.removeAttribute('height');
                    }
                } catch (err) {
                    console.error('Barcode Error:', err);
                }
            }
        }
    }, [value, type]);

    if (type === 'qr') {
        return qrCodeUrl ? (
            <img
                src={qrCodeUrl}
                alt={`QR Code for ${name}`}
                style={{ height: '90px', width: '90px', objectFit: 'contain' }}
            />
        ) : (
            <div className="h-[90px] w-[90px] animate-pulse bg-gray-200 rounded"></div>
        );
    }

    return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }}></svg>;
};

export default DProductBarcodePrintModal;

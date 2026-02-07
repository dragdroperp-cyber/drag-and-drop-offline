import React, { useState, useMemo } from 'react';
import { useApp, ActionTypes, triggerSyncStatusUpdate } from '../../context/AppContext';
import { Plus, Edit, Trash2, Search, X, AlertCircle, Printer, Package } from 'lucide-react';
import { getSellerIdFromAuth } from '../../utils/api';
import DProductBarcodePrintModal from './DProductBarcodePrintModal';

const DeleteConfirmModal = ({ isOpen, onClose, onConfirm, productName }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-8 text-center">
                    <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Trash2 className="w-8 h-8 text-red-600 dark:text-red-400" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Delete Product?</h3>
                    <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                        Are you sure you want to delete <span className="font-bold text-slate-800 dark:text-slate-200">"{productName}"</span>? This action cannot be undone.
                    </p>
                </div>
                <div className="flex border-t border-slate-100 dark:border-slate-700">
                    <button
                        onClick={onClose}
                        className="flex-1 px-6 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors outline-none"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 px-6 py-4 text-sm font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors border-l border-slate-100 dark:border-slate-700 outline-none"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};

export const DProductModal = ({ isOpen, onClose, onSubmit, initialData = null, title, zIndexClass = 'z-50' }) => {
    const [formData, setFormData] = useState({
        pCode: initialData?.pCode || '',
        productName: initialData?.productName || '',
        unit: initialData?.unit || 'PCS',
        taxPercentage: initialData?.taxPercentage !== undefined ? initialData.taxPercentage.toString() : ''
    });
    const [error, setError] = useState('');

    // Reset form when modal opens or initialData changes
    React.useEffect(() => {
        if (isOpen) {
            setFormData({
                pCode: initialData?.pCode || '',
                productName: initialData?.productName || '',
                unit: initialData?.unit || 'PCS',
                taxPercentage: initialData?.taxPercentage !== undefined ? initialData.taxPercentage.toString() : ''
            });
            setError('');
        }
    }, [isOpen, initialData]);

    if (!isOpen) return null;

    const handleChange = (e) => {
        const { name, value } = e.target;

        if (name === 'taxPercentage') {
            // Only allow numbers and decimal point
            let sanitized = value.replace(/[^0-9.]/g, '');
            // Ensure only one decimal point
            const parts = sanitized.split('.');
            if (parts.length > 2) {
                sanitized = `${parts[0]}.${parts.slice(1).join('')}`;
            }

            setFormData(prev => ({
                ...prev,
                taxPercentage: sanitized
            }));
            return;
        }

        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.pCode.trim() || !formData.productName.trim()) {
            setError('Please fill in all required fields.');
            return;
        }

        // Convert string back to number for the database
        const processedData = {
            ...formData,
            taxPercentage: parseFloat(formData.taxPercentage) || 0
        };

        onSubmit(processedData);
        onClose();
    };

    return (
        <div className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center ${zIndexClass} backdrop-blur-sm`}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6 transform transition-all scale-100">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white">{title}</h2>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
                        <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                    </button>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Product Code (Required)</label>
                        <input
                            type="text"
                            name="pCode"
                            value={formData.pCode}
                            onChange={handleChange}
                            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                            placeholder="e.g. D001"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Product Name (Required)</label>
                        <input
                            type="text"
                            name="productName"
                            value={formData.productName}
                            onChange={handleChange}
                            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                            placeholder="e.g. Service Charge"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Unit</label>
                            <select
                                name="unit"
                                value={formData.unit}
                                onChange={handleChange}
                                className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                            >
                                <option value="PCS">PCS</option>
                                <option value="KG">KG</option>
                                <option value="LTR">LTR</option>
                                <option value="BOX">BOX</option>
                                <option value="PACK">PACK</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tax (%)</label>
                            <input
                                type="text"
                                name="taxPercentage"
                                value={formData.taxPercentage}
                                onChange={handleChange}
                                className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                placeholder="0.00"
                                inputMode="decimal"
                            />
                        </div>
                    </div>

                    <div className="mt-8">
                        <button
                            type="submit"
                            className="w-full py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 font-bold"
                        >

                            Add Product
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const DProducts = () => {
    const { state, dispatch } = useApp();
    const [searchTerm, setSearchTerm] = useState('');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);
    const [initialBarcodeProduct, setInitialBarcodeProduct] = useState(null);
    const [deletingProduct, setDeletingProduct] = useState(null);

    const dProducts = state.dProducts || [];

    const filteredProducts = useMemo(() => {
        return dProducts.filter(p =>
            !p.isDeleted && (
                p.pCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.productName.toLowerCase().includes(searchTerm.toLowerCase())
            )
        );
    }, [dProducts, searchTerm]);

    const handleAddProduct = (data) => {
        const sellerId = getSellerIdFromAuth();

        // Check for duplicate pCode locally
        const exists = dProducts.some(p => !p.isDeleted && p.pCode.toLowerCase() === data.pCode.toLowerCase());
        if (exists) {
            if (window.showToast) window.showToast('Product Code already exists!', 'error');
            return;
        }

        const localId = `dp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newProduct = {
            id: localId,
            localId: localId,
            sellerId,
            ...data,
            isSynced: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        dispatch({ type: ActionTypes.ADD_D_PRODUCT, payload: newProduct });
        if (window.showToast) window.showToast('D-Product added successfully!', 'success');
    };

    const handleUpdateProduct = (data) => {
        // Check for duplicate pCode locally (excluding the product currently being edited)
        const exists = dProducts.some(p =>
            !p.isDeleted &&
            p.id !== editingProduct.id &&
            p.pCode.toLowerCase() === data.pCode.toLowerCase()
        );

        if (exists) {
            if (window.showToast) window.showToast('Product Code already exists!', 'error');
            return;
        }

        const updatedProduct = {
            ...editingProduct,
            ...data,
            isSynced: false, // Mark for sync
            updatedAt: new Date().toISOString()
        };

        dispatch({ type: ActionTypes.UPDATE_D_PRODUCT, payload: updatedProduct });
        if (window.showToast) window.showToast('D-Product updated successfully!', 'success');
        setEditingProduct(null);
    };

    const handleDeleteProduct = (product) => {
        setDeletingProduct(product);
    };

    const confirmDelete = () => {
        if (deletingProduct) {
            dispatch({ type: ActionTypes.DELETE_D_PRODUCT, payload: deletingProduct.id });
            if (window.showToast) window.showToast('D-Product deleted successfully!', 'success');
            setDeletingProduct(null);
        }
    };

    const handlePrintBarcode = (product) => {
        setInitialBarcodeProduct(product);
        setIsBarcodeModalOpen(true);
    };

    return (
        <div className="space-y-6 pb-6">
            {/* Simple Premium Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-6 border-b border-gray-200 dark:border-slate-700">
                <div className="flex items-start gap-4">
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl text-blue-600 dark:text-blue-400 shrink-0">
                        <Package className="h-7 w-7 sm:h-8 sm:w-8" />
                    </div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white leading-tight">
                            Direct Products
                        </h1>
                        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 max-w-md">
                            Manage non-inventory items, service charges, and miscellaneous products.
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="btn-primary flex items-center text-sm"
                    >
                        <Plus className="h-4 w-4 mr-1 sm:mr-2" />
                        <span className="hidden sm:inline">Add D-Product</span>
                        <span className="sm:hidden">Add</span>
                    </button>
                </div>
            </div>

            {/* Enhanced Search Bar & Filter */}
            <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 relative">
                    <label htmlFor="dproduct-search" className="sr-only">Search D-Products</label>
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-5 w-5 text-gray-400 dark:text-slate-500" />
                    </div>
                    <input
                        id="dproduct-search"
                        type="text"
                        placeholder="Search by Product Code or Name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="block w-full pl-10 pr-10 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm focus:shadow-md outline-none"
                    />
                    {searchTerm && (
                        <button
                            type="button"
                            onClick={() => setSearchTerm('')}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Products List (Mobile) */}
            <div className="md:hidden space-y-4">
                {filteredProducts.length > 0 ? (
                    filteredProducts.map((product) => (
                        <div key={product.id} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h3 className="font-bold text-slate-900 dark:text-white">{product.productName}</h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 font-mono mt-0.5">#{product.pCode}</p>
                                </div>
                                <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-xs font-semibold text-slate-600 dark:text-slate-300">
                                    {product.unit}
                                </span>
                            </div>

                            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                <span className="font-medium">Tax:</span>
                                <span className="font-mono">{product.taxPercentage}%</span>
                            </div>

                            <div className="pt-3 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-2">
                                <button
                                    onClick={() => handlePrintBarcode(product)}
                                    className="flex-1 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    <Printer className="w-4 h-4" />
                                    Print
                                </button>
                                <button
                                    onClick={() => setEditingProduct(product)}
                                    className="flex-1 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    <Edit className="w-4 h-4" />
                                    Edit
                                </button>
                                <button
                                    onClick={() => handleDeleteProduct(product)}
                                    className="flex-1 px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-8 shadow-sm border border-slate-200 dark:border-slate-700 text-center text-slate-500 dark:text-slate-400">
                        <div className="flex flex-col items-center gap-3">
                            <Search className="w-12 h-12 opacity-20" />
                            <p>No products found matching your search.</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Products Table (Desktop) */}
            <div className="hidden md:block bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
                                <th className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Product Code</th>
                                <th className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Product Name</th>
                                <th className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Unit</th>
                                <th className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300 text-right">Tax (%)</th>
                                <th className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {filteredProducts.length > 0 ? (
                                filteredProducts.map((product) => (
                                    <tr key={product.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                        <td className="px-6 py-4 text-slate-900 dark:text-white font-medium">{product.pCode}</td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{product.productName}</td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                                            <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-xs font-semibold text-slate-600 dark:text-slate-300">
                                                {product.unit}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300 text-right font-mono">
                                            {product.taxPercentage}%
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handlePrintBarcode(product)}
                                                    className="p-2 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                                                    title="Print Barcode"
                                                >
                                                    <Printer className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => setEditingProduct(product)}
                                                    className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                                    title="Edit"
                                                >
                                                    <Edit className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteProduct(product)}
                                                    className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center">
                                                <Package className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                                            </div>
                                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">No D-Products found</h3>
                                            <p className="text-sm">Try searching or add a new one.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modals */}
            <DProductModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSubmit={handleAddProduct}
                title="Add New D-Product"
            />

            {editingProduct && (
                <DProductModal
                    isOpen={true}
                    onClose={() => setEditingProduct(null)}
                    onSubmit={handleUpdateProduct}
                    initialData={editingProduct}
                    title="Edit D-Product"
                />
            )}

            <DProductBarcodePrintModal
                isOpen={isBarcodeModalOpen}
                onClose={() => {
                    setIsBarcodeModalOpen(false);
                    setInitialBarcodeProduct(null);
                }}
                initialProduct={initialBarcodeProduct}
            />

            {deletingProduct && (
                <DeleteConfirmModal
                    isOpen={true}
                    onClose={() => setDeletingProduct(null)}
                    onConfirm={confirmDelete}
                    productName={deletingProduct.productName}
                />
            )}
        </div>
    );
};

export default DProducts;

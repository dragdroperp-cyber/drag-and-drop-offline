import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, User, Phone, Mail, IndianRupee, Check } from 'lucide-react';
import { getTranslation } from '../../utils/translations';
import { useApp } from '../../context/AppContext';
import { formatCurrencySmart } from '../../utils/orderUtils';

const SupplierSelectionModal = ({ isOpen, onClose, onSelect, suppliers = [] }) => {
    const { state } = useApp();
    const [searchQuery, setSearchQuery] = useState('');

    const filteredSuppliers = useMemo(() => {
        return suppliers.filter(s =>
            !s.isDeleted &&
            (s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                s.mobileNumber?.includes(searchQuery) ||
                s.email?.toLowerCase().includes(searchQuery.toLowerCase()))
        );
    }, [suppliers, searchQuery]);

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100000] flex items-center justify-center p-0 md:p-4 animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 w-full h-full md:h-auto md:max-w-2xl md:rounded-2xl shadow-2xl border-none md:border md:border-gray-200 md:dark:border-slate-800 flex flex-col md:max-h-[85vh] overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 sticky top-0 z-10">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                            {getTranslation('selectSupplier', state.currentLanguage)}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-slate-400">
                            {suppliers.length} {getTranslation('suppliers', state.currentLanguage)} available
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-all"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {/* Search Bar */}
                <div className="p-4 bg-gray-50/50 dark:bg-slate-800/30 border-b border-gray-100 dark:border-slate-800">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                            autoFocus
                            type="text"
                            placeholder="Search by name, phone or email..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-500 outline-none transition-all text-gray-900 dark:text-white shadow-sm"
                        />
                    </div>
                </div>

                {/* Supplier List */}
                <div className="flex-1 overflow-y-auto p-2 no-scrollbar">
                    {filteredSuppliers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                            <div className="p-4 bg-gray-100 dark:bg-slate-800 rounded-full mb-4">
                                <User className="h-8 w-8 text-gray-400" />
                            </div>
                            <p className="font-medium">No suppliers found</p>
                            <p className="text-sm">Try adjusting your search terms</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            {filteredSuppliers.map((supplier) => (
                                <button
                                    key={supplier.id || supplier._id}
                                    onClick={() => onSelect(supplier)}
                                    className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-gray-100 dark:border-slate-800 hover:border-slate-900 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-indigo-900/10 transition-all text-left relative overflow-hidden"
                                >
                                    <div className="flex items-center gap-4 flex-1">
                                        <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-indigo-500 transition-colors">
                                            <User className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <h4 className="font-bold text-gray-900 dark:text-white truncate flex items-center gap-2">
                                                {supplier.name}
                                            </h4>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500 dark:text-slate-400">
                                                {supplier.mobileNumber && (
                                                    <span className="flex items-center gap-1">
                                                        <Phone className="h-3 w-3" /> {supplier.mobileNumber}
                                                    </span>
                                                )}
                                                {supplier.email && (
                                                    <span className="flex items-center gap-1">
                                                        <Mail className="h-3 w-3" /> {supplier.email}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-4 sm:mt-0 sm:pl-4 border-t sm:border-t-0 sm:border-l border-gray-100 dark:border-slate-800 flex flex-col items-end justify-center min-w-[120px]">
                                        <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-0.5">Due Balance</p>
                                        <p className={`text-sm font-black ${supplier.dueAmount > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                            {formatCurrencySmart(supplier.dueAmount || 0, state.currencyFormat)}
                                        </p>
                                    </div>

                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block">
                                        <Check className="h-5 w-5 text-slate-900 dark:text-indigo-400" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl text-gray-700 dark:text-slate-300 font-bold hover:bg-gray-50 dark:hover:bg-slate-700 transition-all active:scale-95"
                    >
                        {getTranslation('cancel', state.currentLanguage)}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default SupplierSelectionModal;

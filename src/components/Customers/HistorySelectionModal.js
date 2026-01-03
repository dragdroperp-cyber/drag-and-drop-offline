import React, { useState } from 'react';
import { X, Receipt, History, ShoppingCart, ChevronRight } from 'lucide-react';
import { getTranslation } from '../../utils/translations';
import { useApp } from '../../context/AppContext';

const HistorySelectionModal = ({ customer, onClose, onSelectOrderHistory, onSelectTransactionHistory }) => {
    const { state } = useApp();
    const [isClosing, setIsClosing] = useState(false);

    const handleClose = () => {
        setIsClosing(true);
        setTimeout(onClose, 300);
    };

    return (
        <div
            className={`fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[1100] p-4 transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'opacity-100'}`}
            onClick={handleClose}
        >
            <div
                className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all duration-300 ${isClosing ? 'scale-95 translate-y-4' : 'scale-100 translate-y-0'}`}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-slate-700">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                            {getTranslation('viewHistory', state.currentLanguage)}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
                            {customer?.name}
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl text-gray-400 transition-colors"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {/* Options */}
                <div className="p-5 space-y-4">
                    <button
                        onClick={() => {
                            onSelectOrderHistory();
                            onClose();
                        }}
                        className="w-full group flex items-center gap-4 p-4 rounded-2xl bg-gray-50 dark:bg-slate-700/50 border border-gray-100 dark:border-slate-700 hover:border-purple-200 dark:hover:border-purple-900/50 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-all text-left"
                    >
                        <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform">
                            <ShoppingCart className="h-6 w-6" />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-gray-900 dark:text-white">
                                {getTranslation('orderHistory', state.currentLanguage)}
                            </h4>
                            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                {getTranslation('viewAllPastOrders', state.currentLanguage)}
                            </p>
                        </div>
                        <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-purple-400 transition-colors" />
                    </button>

                    <button
                        onClick={() => {
                            onSelectTransactionHistory();
                            onClose();
                        }}
                        className="w-full group flex items-center gap-4 p-4 rounded-2xl bg-gray-50 dark:bg-slate-700/50 border border-gray-100 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-900/50 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all text-left"
                    >
                        <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform">
                            <History className="h-6 w-6" />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-gray-900 dark:text-white">
                                {getTranslation('transactionHistory', state.currentLanguage)}
                            </h4>
                            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                {getTranslation('viewAllPaymentsCredits', state.currentLanguage)}
                            </p>
                        </div>
                        <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-blue-400 transition-colors" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default HistorySelectionModal;

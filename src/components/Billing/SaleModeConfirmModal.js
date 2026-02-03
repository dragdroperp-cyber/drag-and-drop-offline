import React from 'react';
import { X, ShoppingCart, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';

const SaleModeConfirmModal = ({ mode, onClose, onConfirm }) => {
    const { state } = useApp();

    return (
        <div className="fixed inset-0 bg-slate-900/40 z-[1000] flex items-center justify-center p-4 animate-fadeIn" onClick={onClose}>
            <div
                className="bg-white dark:bg-black w-full max-w-sm rounded-2xl shadow-xl border border-gray-100 dark:border-white/10 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-6">
                    <div className="flex items-center gap-4 mb-5">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${mode === 'wholesale' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30' : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30'}`}>
                            <ShoppingCart className="h-6 w-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
                                {state.currentLanguage === 'hi' ? 'कार्ट खाली हो जाएगी' : 'Cart will be cleared'}
                            </h3>
                            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                                {state.currentLanguage === 'hi'
                                    ? `${mode === 'wholesale' ? 'थोक' : 'रिटेल'} मोड में स्विच करने पर कार्ट के आइटम हट जाएंगे।`
                                    : `Switching to ${mode} mode will remove current cart items.`}
                            </p>
                        </div>
                    </div>

                    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 rounded-xl p-4 mb-6 flex gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 leading-relaxed">
                            {state.currentLanguage === 'hi'
                                ? 'क्या आप सुनिश्चित हैं कि आप जारी रखना चाहते हैं? इस क्रिया को बदला नहीं जा सकता।'
                                : 'Are you sure you want to continue? This action cannot be undone.'}
                        </p>
                    </div>

                    <div className="flex flex-col gap-2">
                        <button
                            onClick={onConfirm}
                            className={`w-full py-3.5 rounded-xl font-bold text-sm text-white shadow-lg transition-all active:scale-[0.98] ${mode === 'wholesale' ? 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/10' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/10'}`}
                        >
                            {state.currentLanguage === 'hi' ? 'हाँ, जारी रखें' : 'Yes, Continue'}
                        </button>
                        <button
                            onClick={onClose}
                            className="w-full py-3 rounded-xl font-bold text-sm text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                        >
                            {getTranslation('cancel', state.currentLanguage)}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SaleModeConfirmModal;

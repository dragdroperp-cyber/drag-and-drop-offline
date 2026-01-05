import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, X, AlertOctagon } from 'lucide-react';

const RefreshProgressModal = ({ isOpen, message, progress, onClose, error }) => {
    const [show, setShow] = useState(isOpen);

    useEffect(() => {
        setShow(isOpen);
    }, [isOpen]);

    if (!show) return null;

    const isSuccess = !error && progress === 100;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[2000] p-4 animate-in fade-in duration-300">
            <div
                className={`w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden border transition-all duration-300 
        ${error ? 'border-red-100 dark:border-red-900/30 ring-4 ring-red-50 dark:ring-red-900/10' :
                        isSuccess ? 'border-green-100 dark:border-green-900/30 ring-4 ring-green-50 dark:ring-green-900/10' :
                            'border-slate-100 dark:border-slate-800'} 
        animate-in zoom-in-95`}
            >
                {error ? (
                    // Attractive Error View
                    <div className="p-8 flex flex-col items-center text-center">
                        <div className="h-16 w-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-5 ring-8 ring-red-50 dark:ring-red-900/5 animate-in zoom-in duration-300">
                            <AlertOctagon className="h-8 w-8 text-red-500" strokeWidth={2.5} />
                        </div>

                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                            Sync Failed
                        </h3>

                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
                            {message || "Something went wrong while syncing data. Please check your connection and try again."}
                        </p>

                        <button
                            onClick={onClose}
                            className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-all shadow-lg shadow-red-200 dark:shadow-red-900/20 active:scale-[0.98]"
                        >
                            Dismiss
                        </button>
                    </div>
                ) : isSuccess ? (
                    // Attractive Success View
                    <div className="p-8 flex flex-col items-center text-center">
                        <div className="h-16 w-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-5 ring-8 ring-green-50 dark:ring-green-900/5 animate-in zoom-in duration-300">
                            <CheckCircle2 className="h-8 w-8 text-green-500" strokeWidth={2.5} />
                        </div>

                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                            Sync Complete
                        </h3>

                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
                            Your data has been successfully synchronized and is up to date.
                        </p>

                        <button
                            onClick={onClose}
                            className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-xl transition-all shadow-lg shadow-green-200 dark:shadow-green-900/20 active:scale-[0.98]"
                        >
                            Done
                        </button>
                    </div>
                ) : (
                    // Standard Progress View
                    <>
                        {/* Header */}
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                            <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                Refreshing Data...
                            </h3>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-4">
                            {/* Progress Bar */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                                    <span>Progress</span>
                                    <span>{Math.round(progress)}%</span>
                                </div>
                                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full transition-all duration-300 ease-out rounded-full bg-blue-500"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            </div>

                            {/* Status Message */}
                            <p className="text-center text-sm text-slate-600 dark:text-slate-300 font-medium animate-pulse">
                                {message || 'Syncing...'}
                            </p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default RefreshProgressModal;

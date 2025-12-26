import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, X } from 'lucide-react';

const RefreshProgressModal = ({ isOpen, message, progress, onClose }) => {
    const [show, setShow] = useState(isOpen);

    useEffect(() => {
        setShow(isOpen);
    }, [isOpen]);

    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[2000] p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                    <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        {progress < 100 ? (
                            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                        ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                        )}
                        {progress < 100 ? 'Refreshing Data...' : 'Refresh Complete'}
                    </h3>
                    {progress === 100 && (
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                        >
                            <X className="h-4 w-4 text-slate-500" />
                        </button>
                    )}
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
                                className={`h-full transition-all duration-300 ease-out rounded-full ${progress === 100 ? 'bg-green-500' : 'bg-blue-500'
                                    }`}
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>

                    {/* Status Message */}
                    <p className="text-center text-sm text-slate-600 dark:text-slate-300 font-medium animate-pulse">
                        {message || 'Syncing...'}
                    </p>
                </div>

                {/* Footer actions if needed */}
                {progress === 100 && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 flex justify-center">
                        <button
                            onClick={onClose}
                            className="px-6 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
                        >
                            Close
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RefreshProgressModal;

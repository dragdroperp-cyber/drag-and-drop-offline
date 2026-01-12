import React from 'react';
import { Download, Wifi, WifiOff, CheckCircle, Loader, X } from 'lucide-react';

/**
 * Modal component to prompt users to download app for offline use
 * Shows when essential resources are not cached
 */
const OfflineDownloadModal = ({
    isOpen,
    onClose,
    onDownload,
    isDownloading,
    cacheProgress,
    missingResources
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 animate-fadeIn">
            <div className="bg-white dark:bg-black rounded-2xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-white/10 animate-slideUp">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20">
                            <WifiOff className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                                Enable Offline Mode
                            </h3>
                            <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
                                Download app for offline access
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                        aria-label="Close"
                    >
                        <X className="h-5 w-5 text-gray-400 dark:text-slate-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="mb-6">
                    <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/20 rounded-xl mb-4">
                        <Wifi className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                                Your app is not fully downloaded for offline use
                            </p>
                            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                                Download essential resources now to work without internet connection.
                            </p>
                        </div>
                    </div>

                    {/* Missing Resources Info */}
                    {missingResources && missingResources.length > 0 && (
                        <div className="mb-4">
                            <p className="text-xs font-semibold text-gray-700 dark:text-slate-300 mb-2">
                                Missing Resources ({missingResources.length}):
                            </p>
                            <div className="max-h-32 overflow-y-auto bg-gray-50 dark:bg-white/5 rounded-lg p-3 space-y-1">
                                {missingResources.slice(0, 5).map((resource, index) => {
                                    const isOptional = resource.includes('assets/') || resource.includes('fonts.googleapis');
                                    return (
                                        <div key={index} className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400">
                                            <div className={`w-1.5 h-1.5 rounded-full ${isOptional ? 'bg-blue-400 dark:bg-blue-500' : 'bg-gray-400 dark:bg-slate-500'}`} />
                                            <span className="font-mono flex-1">{resource}</span>
                                            {isOptional && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                                                    optional
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                                {missingResources.length > 5 && (
                                    <p className="text-xs text-gray-500 dark:text-slate-500 italic pl-3.5">
                                        +{missingResources.length - 5} more...
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Progress Bar */}
                    {isDownloading && (
                        <div className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-gray-700 dark:text-slate-300">
                                    Downloading...
                                </span>
                                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                                    {cacheProgress}%
                                </span>
                            </div>
                            <div className="w-full h-2 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300 ease-out"
                                    style={{ width: `${cacheProgress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Benefits */}
                    <div className="space-y-2 mb-4">
                        <p className="text-xs font-semibold text-gray-700 dark:text-slate-300 mb-2">
                            Benefits of offline mode:
                        </p>
                        {[
                            'Work without internet connection',
                            'Faster app loading times',
                            'Access all features offline',
                            'Auto-sync when online'
                        ].map((benefit, index) => (
                            <div key={index} className="flex items-center gap-2">
                                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                                <span className="text-sm text-gray-600 dark:text-slate-400">{benefit}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-all"
                        disabled={isDownloading}
                    >
                        Maybe Later
                    </button>
                    <button
                        onClick={onDownload}
                        disabled={isDownloading}
                        className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isDownloading ? (
                            <>
                                <Loader className="h-4 w-4 animate-spin" />
                                Downloading...
                            </>
                        ) : (
                            <>
                                <Download className="h-4 w-4" />
                                Download Now
                            </>
                        )}
                    </button>
                </div>

                {/* Footer Note */}
                <p className="text-xs text-center text-gray-500 dark:text-slate-500 mt-4">
                    This will download all app pages for complete offline access (~5-15 MB)
                </p>
            </div>
        </div>
    );
};

export default OfflineDownloadModal;

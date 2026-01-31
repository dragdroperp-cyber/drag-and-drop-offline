import React, { useState, useEffect } from 'react';
import { X, Gift, Sparkles, Copy, Check } from 'lucide-react';

const PromotionModal = ({ isOpen, onClose, onClaim, coupon }) => {
    const [copied, setCopied] = useState(false);

    // If no coupon is provided, don't render anything
    if (!isOpen || !coupon) return null;

    const couponCode = coupon.code;
    const discountText = `${coupon.discountType === 'percentage' ? coupon.discountValue + '%' : '₹' + coupon.discountValue} OFF`;

    const handleCopy = () => {
        navigator.clipboard.writeText(couponCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div
                className="relative w-full max-w-md sm:max-w-2xl overflow-hidden rounded-2xl sm:rounded-xl bg-white dark:bg-slate-900 shadow-2xl animate-in zoom-in-95 duration-300 border border-white dark:border-slate-800"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Decorative background elements */}
                <div className="absolute top-0 right-0 -mr-16 -mt-16 h-48 w-48 rounded-full bg-indigo-500/10 blur-3xl"></div>
                <div className="absolute bottom-0 left-0 -ml-16 -mb-16 h-48 w-48 rounded-full bg-blue-500/10 blur-2xl"></div>

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all z-10"
                >
                    <X className="h-5 w-5" />
                </button>

                <div className="relative p-7 sm:p-8 sm:px-12 text-center md:text-left md:flex md:items-center md:gap-8">
                    {/* Header Icon - Desktop side view */}
                    <div className="flex-shrink-0 hidden md:flex items-center justify-center w-24 h-24 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl relative">
                        <Gift className="h-10 w-10 text-indigo-600 dark:text-indigo-400" />
                        <div className="absolute -top-2 -right-2">
                            <Sparkles className="h-6 w-6 text-amber-400 animate-pulse" />
                        </div>
                    </div>

                    <div className="flex-1">
                        {/* Header Icon (Mobile only) */}
                        <div className="md:hidden mx-auto w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mb-5 relative">
                            <Gift className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
                            <div className="absolute -top-1 -right-1">
                                <Sparkles className="h-5 w-5 text-amber-400 animate-pulse" />
                            </div>
                        </div>

                        {/* Text Content */}
                        <div className="flex flex-col md:flex-row md:items-baseline md:gap-3 mb-2">
                            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                                Special Offer! 🎁
                            </h2>
                            <span className="hidden md:inline-block px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded text-[10px] font-black uppercase tracking-widest leading-none">Limited Offer</span>
                        </div>

                        <p className="text-slate-500 dark:text-slate-400 text-base sm:text-lg leading-relaxed mb-6">
                            {coupon?.description || (
                                <>Get a flat <span className="font-bold text-indigo-600 dark:text-indigo-400">{discountText}</span> on all plans of ₹500 or more.</>
                            )}
                        </p>

                        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
                            {/* Coupon Box */}
                            <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-3 sm:px-5 group relative overflow-hidden transition-all hover:border-indigo-300 dark:hover:border-indigo-500/30 flex items-center justify-between">
                                <div className="text-left">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-0.5">
                                        CODE
                                    </p>
                                    <span className="text-lg sm:text-xl font-black tracking-widest text-slate-800 dark:text-white uppercase select-all">
                                        {couponCode}
                                    </span>
                                </div>
                                <button
                                    onClick={handleCopy}
                                    className={`p-1.5 sm:p-2 rounded-lg transition-all ${copied ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 hover:bg-indigo-600 hover:text-white shadow-sm ring-1 ring-slate-200 dark:ring-slate-600'}`}
                                    title="Copy code"
                                >
                                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </button>
                            </div>

                            <button
                                onClick={onClaim}
                                className="flex-shrink-0 px-8 py-3.5 sm:py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black shadow-xl shadow-indigo-500/20 active:scale-95 transition-all text-base sm:text-lg"
                            >
                                Claim Now
                            </button>
                        </div>

                        <p className="text-[10px] sm:text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-4 flex items-center justify-center md:justify-start gap-1.5 leading-none">
                            Valid on all major plans of ₹500+ • Instant Discount
                        </p>
                    </div>
                </div>
            </div>
            {/* Backdrop click to close */}
            <div className="absolute inset-0 -z-10" onClick={onClose}></div>
        </div>
    );
};

export default PromotionModal;

import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { apiRequest } from '../../utils/api';
import {
    Loader, Calendar, Package, ArrowLeft, CheckCircle, XCircle, Clock, Users,
    X, CreditCard, ShieldCheck, History, Fingerprint, Shield, ArrowRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '../../utils/dateUtils';
import { formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';

const PlanHistory = () => {
    const { state } = useApp();
    const navigate = useNavigate();
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [availablePlans, setAvailablePlans] = useState([]);
    const [selectedPlan, setSelectedPlan] = useState(null);
    const initialLoadStarted = React.useRef(false);

    useEffect(() => {
        if (initialLoadStarted.current) return;

        const fetchHistory = async () => {
            try {
                initialLoadStarted.current = true;
                setLoading(true);
                const result = await apiRequest(`/data/plans?_t=${Date.now()}`);
                if (result.success && result.data) {
                    const responseData = result.data.data || result.data;
                    let catalog = Array.isArray(responseData) ? responseData : (responseData.data || []);
                    setAvailablePlans(catalog);
                    let planOrders = responseData.planOrderHistory || responseData.usagePlans || result.data.planOrderHistory || result.data.usagePlans || [];
                    planOrders.sort((a, b) => new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate));
                    setPlans(planOrders);
                } else {
                    setError(getTranslation('failedToLoadHistory', state.currentLanguage));
                }
            } catch (err) {
                setError(getTranslation('connectionError', state.currentLanguage));
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();
    }, [state.currentLanguage]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
                <Loader className="animate-spin h-10 w-10 text-[#2F3C7E]" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <button
                    onClick={() => navigate('/upgrade')}
                    className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                    <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-slate-400" />
                </button>
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{getTranslation('planHistoryTitle', state.currentLanguage)}</h1>
                    <p className="text-gray-600 dark:text-slate-400 mt-1">{getTranslation('planHistorySubtitle', state.currentLanguage)}</p>
                </div>
            </div>

            {error ? (
                <div className="text-center p-8 bg-white dark:bg-slate-800 rounded-2xl border border-red-100 dark:border-red-900/30">
                    <p className="text-red-500">{error}</p>
                </div>
            ) : plans.length === 0 ? (
                <div className="text-center p-12 bg-white dark:bg-slate-800 rounded-2xl border dark:border-slate-700">
                    <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">{getTranslation('noEntriesFound', state.currentLanguage)}</h3>
                    <p className="text-gray-500 dark:text-slate-400 mt-2">{getTranslation('noPlansPurchased', state.currentLanguage)}</p>
                </div>
            ) : (
                <>
                    {/* Desktop View - Table */}
                    <div className="hidden md:block bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 dark:bg-slate-900/50">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('planNameHeader', state.currentLanguage)}</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('priceHeader', state.currentLanguage)}</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('startDateHeader', state.currentLanguage)}</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('expiryDateHeader', state.currentLanguage)}</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('status', state.currentLanguage)}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                    {plans.map((plan) => {
                                        let planId = typeof plan.planId === 'string' ? plan.planId : (plan.planId?._id || plan.planId?.id);
                                        if (!planId) planId = plan.id || plan._id;
                                        const matchingPlan = availablePlans.find(p => p.id === planId || p._id === planId);
                                        const planName = plan.name || plan.planName || (plan.planId?.name) || matchingPlan?.name || getTranslation('unknownPlan', state.currentLanguage);
                                        const price = plan.price !== undefined ? plan.price : (plan.amount !== undefined ? plan.amount : matchingPlan?.price);
                                        const displayPrice = formatCurrencySmart(price || 0, state.currencyFormat);
                                        const startDate = plan.startDate || plan.createdAt;
                                        const expiryDate = plan.expiryDate || plan.expiresAt || plan.subscriptionExpiry;
                                        const now = new Date();
                                        const isExpired = plan.status === 'expired' || (expiryDate && new Date(expiryDate) < now);
                                        const isActive = !isExpired && (plan.status === 'active' || plan.status === 'completed' || plan.status === 'paused');

                                        return (
                                            <tr
                                                key={plan.id || plan._id}
                                                onClick={() => setSelectedPlan(plan)}
                                                className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer group"
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="flex items-center gap-3">
                                                        <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                                                            <Package className="h-4 w-4" />
                                                        </div>
                                                        <span className="font-medium text-gray-900 dark:text-white">{planName}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-slate-300">
                                                    {displayPrice}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-slate-300">
                                                    <div className="flex items-center gap-2">
                                                        <Calendar className="h-4 w-4 text-gray-400" />
                                                        {startDate ? formatDate(startDate) : '-'}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-slate-300">
                                                    <div className="flex items-center gap-2">
                                                        <Clock className="h-4 w-4 text-gray-400" />
                                                        {expiryDate ? formatDate(expiryDate) : getTranslation('never', state.currentLanguage)}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {isActive ? (
                                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border border-green-200 dark:border-green-500/20">
                                                            <CheckCircle className="h-3 w-3" />
                                                            {getTranslation('activeBadge', state.currentLanguage)}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-400 border border-gray-200 dark:border-slate-700">
                                                            <XCircle className="h-3 w-3" />
                                                            {getTranslation('expired', state.currentLanguage)}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Mobile View - Cards */}
                    <div className="md:hidden space-y-4">
                        {plans.map((plan) => {
                            let planId = typeof plan.planId === 'string' ? plan.planId : (plan.planId?._id || plan.planId?.id);
                            if (!planId) planId = plan.id || plan._id;
                            const matchingPlan = availablePlans.find(p => p.id === planId || p._id === planId);
                            const planName = plan.name || plan.planName || (plan.planId?.name) || matchingPlan?.name || getTranslation('unknownPlan', state.currentLanguage);
                            let price = plan.price !== undefined ? plan.price : (plan.amount !== undefined ? plan.amount : matchingPlan?.price);
                            const displayPrice = formatCurrencySmart(price || 0, state.currencyFormat);
                            const startDate = plan.startDate || plan.createdAt;
                            const expiryDate = plan.expiryDate || plan.expiresAt || plan.subscriptionExpiry;
                            const now = new Date();
                            const isExpired = plan.status === 'expired' || (expiryDate && new Date(expiryDate) < now);
                            const isActive = !isExpired && (plan.status === 'active' || plan.status === 'completed' || plan.status === 'paused');

                            return (
                                <div
                                    key={plan.id || plan._id}
                                    onClick={() => setSelectedPlan(plan)}
                                    className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 flex flex-col gap-4 cursor-pointer hover:border-indigo-500/50 transition-all active:scale-[0.98]"
                                >
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400">
                                                <Package className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-gray-900 dark:text-white text-lg">{planName}</h3>
                                                <p className="text-sm font-semibold text-gray-500 dark:text-slate-400">{displayPrice}</p>
                                            </div>
                                        </div>
                                        {isActive ? (
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border border-green-200 dark:border-green-500/20">
                                                {getTranslation('activeBadge', state.currentLanguage)}
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-400 border border-gray-200 dark:border-slate-700">
                                                {getTranslation('expired', state.currentLanguage)}
                                            </span>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100 dark:border-slate-700/50">
                                        <div>
                                            <p className="text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide">{getTranslation('startDateHeader', state.currentLanguage)}</p>
                                            <div className="flex items-center gap-1.5 mt-1.5 text-sm rounded-lg text-gray-700 dark:text-slate-300">
                                                <Calendar className="h-4 w-4 text-gray-400" />
                                                {startDate ? formatDate(startDate) : '-'}
                                            </div>
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide">{getTranslation('expiryDateHeader', state.currentLanguage)}</p>
                                            <div className="flex items-center gap-1.5 mt-1.5 text-sm rounded-lg text-gray-700 dark:text-slate-300">
                                                <Clock className="h-4 w-4 text-gray-400" />
                                                {expiryDate ? formatDate(expiryDate) : getTranslation('never', state.currentLanguage)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* Plan Detail Modal */}
            {selectedPlan && (() => {
                const planId = typeof selectedPlan.planId === 'string' ? selectedPlan.planId : (selectedPlan.planId?._id || selectedPlan.planId?.id);
                const matchingPlan = availablePlans.find(p => p.id === planId || p._id === planId);
                const planName = selectedPlan.name || selectedPlan.planName || (selectedPlan.planId?.name) || matchingPlan?.name || getTranslation('unknownPlan', state.currentLanguage);
                const price = selectedPlan.price !== undefined ? selectedPlan.price : (selectedPlan.amount !== undefined ? selectedPlan.amount : matchingPlan?.price);
                const maxCustomers = selectedPlan.customerLimit !== undefined ? selectedPlan.customerLimit : (selectedPlan.maxCustomers !== undefined ? selectedPlan.maxCustomers : matchingPlan?.maxCustomers);
                const maxProducts = selectedPlan.productLimit !== undefined ? selectedPlan.productLimit : (selectedPlan.maxProducts !== undefined ? selectedPlan.maxProducts : matchingPlan?.maxProducts);
                const maxOrders = selectedPlan.orderLimit !== undefined ? selectedPlan.orderLimit : (selectedPlan.maxOrders !== undefined ? selectedPlan.maxOrders : matchingPlan?.maxOrders);
                const startDate = selectedPlan.startDate || selectedPlan.createdAt;
                const expiryDate = selectedPlan.expiryDate || selectedPlan.expiresAt || selectedPlan.subscriptionExpiry;
                const now = new Date();
                const isExpired = selectedPlan.status === 'expired' || (expiryDate && new Date(expiryDate) < now);
                const isActive = !isExpired && (selectedPlan.status === 'active' || selectedPlan.status === 'completed' || selectedPlan.status === 'paused');

                return (
                    <div
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[10000] flex items-end sm:items-center justify-center sm:p-6 animate-fadeIn"
                        onClick={() => setSelectedPlan(null)}
                    >
                        <div
                            className="bg-white dark:bg-slate-800 w-full sm:max-w-2xl h-auto max-h-[95vh] sm:h-auto sm:max-h-[90vh] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl flex flex-col relative overflow-hidden dark:border dark:border-slate-700 animate-slideUp"
                            onClick={e => e.stopPropagation()}
                        >
                            <button
                                onClick={() => setSelectedPlan(null)}
                                className="absolute top-6 right-6 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors z-[80]"
                                aria-label="Close"
                            >
                                <X className="h-6 w-6" />
                            </button>

                            <div className="flex-1 overflow-y-auto p-8 space-y-8 dark:scrollbar-thumb-slate-700">
                                <div className="pt-2">
                                    <h3 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-4 flex items-center gap-3">
                                        {planName}
                                        {isActive ? (
                                            <span className="bg-green-500 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-md uppercase tracking-wider">{getTranslation('activeBadge', state.currentLanguage)}</span>
                                        ) : (
                                            <span className="bg-gray-400 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-md uppercase tracking-wider">{getTranslation('expired', state.currentLanguage)}</span>
                                        )}
                                    </h3>
                                    <div className="flex items-center flex-wrap gap-4">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-4xl font-black text-[#2F3C7E] dark:text-blue-400">
                                                {formatCurrencySmart(price || 0, state.currencyFormat)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border border-gray-100 dark:border-slate-700/50">
                                    <div className="flex items-center gap-2 text-gray-600 dark:text-slate-400">
                                        <History className="h-5 w-5" />
                                        <span className="font-bold">{getTranslation('validity', state.currentLanguage)}</span>
                                    </div>
                                    <span className="text-lg font-black text-gray-900 dark:text-white capitalize">
                                        {selectedPlan.durationDays || matchingPlan?.durationDays || '-'} {getTranslation('days', state.currentLanguage) || 'Days'}
                                    </span>
                                </div>

                                {selectedPlan.razorpayOrderId && (
                                    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border border-gray-100 dark:border-slate-700/50">
                                        <div className="flex items-center gap-2 text-gray-600 dark:text-slate-400">
                                            <Fingerprint className="h-5 w-5" />
                                            <span className="font-bold">Razorpay ID</span>
                                        </div>
                                        <span className="text-sm font-black text-gray-900 dark:text-white font-mono select-all">
                                            {selectedPlan.razorpayOrderId}
                                        </span>
                                    </div>
                                )}

                                <div>
                                    <h4 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-4">{getTranslation('planLimits', state.currentLanguage)}</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border dark:border-slate-700">
                                            <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                                                {maxCustomers === -1 || maxCustomers === Infinity || maxCustomers === 'unlimited' ? getTranslation('unlimited', state.currentLanguage) : maxCustomers}
                                            </div>
                                            <div className="text-xs text-gray-600 dark:text-slate-500 flex items-center gap-1">
                                                <Users className="h-3 w-3" />
                                                {getTranslation('customers', state.currentLanguage)}
                                            </div>
                                        </div>
                                        <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border dark:border-slate-700">
                                            <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                                                {maxProducts === -1 || maxProducts === Infinity || maxProducts === 'unlimited' ? getTranslation('unlimited', state.currentLanguage) : maxProducts}
                                            </div>
                                            <div className="text-xs text-gray-600 dark:text-slate-500 flex items-center gap-1">
                                                <Package className="h-3 w-3" />
                                                {getTranslation('products', state.currentLanguage)}
                                            </div>
                                        </div>
                                        <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border dark:border-slate-700">
                                            <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                                                {maxOrders === -1 || maxOrders === Infinity || maxOrders === 'unlimited' ? getTranslation('unlimited', state.currentLanguage) : maxOrders}
                                            </div>
                                            <div className="text-xs text-gray-600 dark:text-slate-500 flex items-center gap-1">
                                                <ShieldCheck className="h-3 w-3" />
                                                {getTranslation('orders', state.currentLanguage) || 'Orders'}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {(selectedPlan.unlockedModules?.length > 0 || matchingPlan?.unlockedModules?.length > 0) && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-4">{getTranslation('unlockedFeatures', state.currentLanguage)}</h4>
                                            <div className="space-y-3">
                                                {(selectedPlan.unlockedModules || matchingPlan?.unlockedModules || []).map((module, idx) => (
                                                    <div key={idx} className="flex items-center gap-2 text-gray-700 dark:text-slate-200">
                                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                                        <span className="text-sm font-medium">{module.replace(/_/g, ' ')}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}



                                <div className="space-y-4">
                                    <h4 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Order Timeline</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border border-gray-100 dark:border-slate-700/50">
                                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{getTranslation('startDateHeader', state.currentLanguage)}</div>
                                            <div className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                                <Calendar className="h-4 w-4 text-indigo-500" />
                                                {startDate ? formatDate(startDate) : '-'}
                                            </div>
                                        </div>
                                        <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border border-gray-100 dark:border-slate-700/50">
                                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{getTranslation('expiryDateHeader', state.currentLanguage)}</div>
                                            <div className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                                <Clock className="h-4 w-4 text-red-500" />
                                                {expiryDate ? formatDate(expiryDate) : getTranslation('never', state.currentLanguage)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 border-t dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 backdrop-blur-sm">
                                <button
                                    onClick={() => setSelectedPlan(null)}
                                    className="w-full py-4 rounded-2xl bg-[#2F3C7E] dark:bg-blue-600 text-white font-bold shadow-lg hover:bg-[#3d4a8f] dark:hover:bg-blue-700 transition-all flex items-center justify-center gap-2 active:scale-95 group"
                                >
                                    <span>{getTranslation('close', state.currentLanguage)}</span>
                                    <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                                </button>
                                <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                                    <div className="flex items-center gap-2 text-gray-400 dark:text-slate-500">
                                        <Shield className="h-4 w-4" />
                                        <span className="text-xs font-medium">{getTranslation('securePayment', state.currentLanguage)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default PlanHistory;

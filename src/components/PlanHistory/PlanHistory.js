import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { apiRequest } from '../../utils/api';
import { Loader, Calendar, Package, ArrowLeft, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '../../utils/dateUtils';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';

const PlanHistory = () => {
    const { state } = useApp();
    const navigate = useNavigate();
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [availablePlans, setAvailablePlans] = useState([]);

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                setLoading(true);
                const result = await apiRequest(`/data/plans?_t=${Date.now()}`);
                if (result.success && result.data) {
                    const responseData = result.data.data || result.data;

                    // Available plans catalog
                    let catalog = Array.isArray(responseData) ? responseData : (responseData.data || []);
                    setAvailablePlans(catalog);

                    // usagePlans contains the history of plan orders
                    // Prefer planOrderHistory if available (full history), otherwise fallback to usagePlans
                    let planOrders = responseData.planOrderHistory || responseData.usagePlans || result.data.planOrderHistory || result.data.usagePlans || [];

                    // Sort by creation date descending
                    planOrders.sort((a, b) => new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate));
                    setPlans(planOrders);
                } else {
                    setError('Failed to load plan history');
                }
            } catch (err) {
                setError('Connection error');
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
                <Loader className="animate-spin h-10 w-10 text-[#2F3C7E]" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <button
                        onClick={() => navigate('/upgrade')}
                        className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                    >
                        <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-slate-400" />
                    </button>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Plan History</h1>
                        <p className="text-gray-600 dark:text-slate-400 mt-1">View your subscription history and details</p>
                    </div>
                </div>

                {error ? (
                    <div className="text-center p-8 bg-white dark:bg-slate-800 rounded-2xl border border-red-100 dark:border-red-900/30">
                        <p className="text-red-500">{error}</p>
                    </div>
                ) : plans.length === 0 ? (
                    <div className="text-center p-12 bg-white dark:bg-slate-800 rounded-2xl border dark:border-slate-700">
                        <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">No entries found</h3>
                        <p className="text-gray-500 dark:text-slate-400 mt-2">You haven't purchased any plans yet.</p>
                    </div>
                ) : (
                    <>
                        {/* Desktop View - Table */}
                        <div className="hidden md:block bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-gray-50 dark:bg-slate-900/50">
                                        <tr>
                                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Plan Name</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Price</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Start Date</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Expiry Date</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                        {plans.map((plan) => {
                                            // Attempt to find plan details if they are nested or reference an ID
                                            let planId = typeof plan.planId === 'string' ? plan.planId : (plan.planId?._id || plan.planId?.id);
                                            if (!planId) planId = plan.id || plan._id;

                                            const matchingPlan = availablePlans.find(p => p.id === planId || p._id === planId);
                                            const planName = plan.name || plan.planName || (plan.planId?.name) || matchingPlan?.name || 'Unknown Plan';

                                            let price = plan.price !== undefined ? plan.price : (plan.amount);
                                            if (price === undefined && matchingPlan) {
                                                price = matchingPlan.price;
                                            }
                                            const displayPrice = formatCurrencySmart(price || 0, state.currencyFormat);

                                            const startDate = plan.startDate || plan.createdAt;
                                            const expiryDate = plan.expiryDate || plan.expiresAt;

                                            const now = new Date();
                                            const isExpired = plan.status === 'expired' || (expiryDate && new Date(expiryDate) < now);
                                            const isActive = !isExpired && plan.status !== 'cancelled';

                                            return (
                                                <tr key={plan.id || plan._id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <div className="flex items-center gap-3">
                                                            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400">
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
                                                            {expiryDate ? formatDate(expiryDate) : 'Never'}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        {isActive ? (
                                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border border-green-200 dark:border-green-500/20">
                                                                <CheckCircle className="h-3 w-3" />
                                                                Active
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-400 border border-gray-200 dark:border-slate-700">
                                                                <XCircle className="h-3 w-3" />
                                                                Expired
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
                                const planName = plan.name || plan.planName || (plan.planId?.name) || matchingPlan?.name || 'Unknown Plan';

                                let price = plan.price !== undefined ? plan.price : (plan.amount);
                                if (price === undefined && matchingPlan) {
                                    price = matchingPlan.price;
                                }
                                const displayPrice = formatCurrencySmart(price || 0, state.currencyFormat);

                                const startDate = plan.startDate || plan.createdAt;
                                const expiryDate = plan.expiryDate || plan.expiresAt;

                                const now = new Date();
                                const isExpired = plan.status === 'expired' || (expiryDate && new Date(expiryDate) < now);
                                const isActive = !isExpired && plan.status !== 'cancelled';

                                return (
                                    <div key={plan.id || plan._id} className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 flex flex-col gap-4">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400">
                                                    <Package className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-gray-900 dark:text-white text-lg">{planName}</h3>
                                                    <p className="text-sm font-semibold text-gray-500 dark:text-slate-400 mt-0.5">{displayPrice}</p>
                                                </div>
                                            </div>
                                            {isActive ? (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border border-green-200 dark:border-green-500/20">
                                                    Active
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-400 border border-gray-200 dark:border-slate-700">
                                                    Expired
                                                </span>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100 dark:border-slate-700/50">
                                            <div>
                                                <p className="text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide">Start Date</p>
                                                <div className="flex items-center gap-1.5 mt-1.5 text-sm rounded-lg text-gray-700 dark:text-slate-300">
                                                    <Calendar className="h-4 w-4 text-gray-400" />
                                                    {startDate ? formatDate(startDate) : '-'}
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide">Expiry Date</p>
                                                <div className="flex items-center gap-1.5 mt-1.5 text-sm rounded-lg text-gray-700 dark:text-slate-300">
                                                    <Clock className="h-4 w-4 text-gray-400" />
                                                    {expiryDate ? formatDate(expiryDate) : 'Never'}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div >
    );
};

export default PlanHistory;

import React, { useState, useEffect, useMemo } from 'react';
import { useApp, ActionTypes } from '../../context/AppContext';
import {
    Plus,
    Target,
    Trophy,
    TrendingUp,
    Calendar,
    CheckCircle,
    CheckCircle2,
    XCircle,
    Sparkles,
    AlertCircle,
    ChevronRight,
    ArrowUpRight,
    ListChecks,
    Trophy as TrophyIcon
} from 'lucide-react';
import { PageSkeleton } from '../UI/SkeletonLoader';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';
import { formatCurrencySmart } from '../../utils/orderUtils';
import { formatDate } from '../../utils/dateUtils';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

const SalesTarget = () => {
    const { state, dispatch } = useApp();
    const [targetInput, setTargetInput] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [viewMode, setViewMode] = useState('chart'); // 'chart' | 'list'
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [suggestionData, setSuggestionData] = useState(null);

    // Map refunds to orders for lookup with robust ID matching (Sync with SalesOrderHistory)
    const refundsMap = useMemo(() => {
        const map = {};
        (state.refunds || []).forEach(refund => {
            if (refund.isDeleted) return;
            const rid = (refund.orderId || refund.orderLocalId || refund.orderMongoId || refund.order_id || refund.orderID || '').toString();
            if (!rid) return;

            // Find the corresponding order to ensure we use the correct key(s) for the map
            const order = (state.orders || []).find(o =>
                (o._id && o._id.toString() === rid) ||
                (o.id && o.id.toString() === rid) ||
                (o.localId && o.localId.toString() === rid)
            );

            const amount = Number(refund.totalRefundAmount || refund.amount || 0);

            if (order) {
                // Map to all possible IDs used for lookup
                const mongoId = order._id?.toString();
                const localId = order.id?.toString();
                const syncLocalId = order.localId?.toString();

                if (mongoId) map[mongoId] = (map[mongoId] || 0) + amount;
                if (localId && localId !== mongoId) map[localId] = (map[localId] || 0) + amount;
                if (syncLocalId && syncLocalId !== mongoId && syncLocalId !== localId) map[syncLocalId] = (map[syncLocalId] || 0) + amount;
            } else {
                // Fallback: use the ID present in the refund
                map[rid] = (map[rid] || 0) + amount;
            }
        });
        return map;
    }, [state.refunds, state.orders]);

    // Calculate Today's Sales from Context (for immediate feedback)
    const todaySales = useMemo(() => {
        if (!state.orders) return 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return state.orders
            .filter(o => !o.isDeleted && new Date(o.createdAt || o.date) >= today)
            .reduce((sum, o) => {
                const refundAmount = refundsMap[o._id] || refundsMap[o.id] || refundsMap[o.localId] || 0;
                return sum + Math.max(0, (o.totalAmount || 0) - refundAmount);
            }, 0);
    }, [state.orders, refundsMap]);

    // Calculate History and Today's Target from Context
    const { history, todayTarget } = useMemo(() => {
        const targets = state.targets || [];
        const orders = state.orders || [];

        // Sort targets by date descending
        const sortedTargets = [...targets].sort((a, b) => new Date(b.date) - new Date(a.date));

        // Calculate achieved amount for each target
        const historyWithAchieved = sortedTargets.map(target => {
            const targetDate = new Date(target.date);
            const startOfDay = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);

            const achieved = orders
                .filter(o => {
                    if (o.isDeleted) return false;
                    const orderDate = new Date(o.createdAt || o.date);
                    return orderDate >= startOfDay && orderDate <= endOfDay;
                })
                .reduce((sum, o) => {
                    const refundAmount = refundsMap[o._id] || refundsMap[o.id] || refundsMap[o.localId] || 0;
                    return sum + Math.max(0, (o.totalAmount || 0) - refundAmount);
                }, 0);

            return {
                ...target,
                achievedAmount: achieved
            };
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const current = historyWithAchieved.find(t => {
            const d = new Date(t.date);
            d.setHours(0, 0, 0, 0);
            return d.getTime() === today.getTime();
        });

        return { history: historyWithAchieved, todayTarget: current };
    }, [state.targets, state.orders, refundsMap]);

    // AI Suggestion Logic: Realistic but challenging
    const handleAutoSetTarget = () => {
        try {
            const orders = state.orders || [];
            if (orders.length === 0) {
                if (window.showToast) window.showToast('Please record some sales first for AI analysis', 'info');
                return;
            }

            const now = new Date();
            const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

            // Analysis: Last 14 productive days (excluding today)
            const lookbackDays = 14;
            const historyStart = new Date(todayStart);
            historyStart.setDate(historyStart.getDate() - lookbackDays);

            const dailyTotals = {};
            orders.forEach(o => {
                if (o.isDeleted) return;
                const oDate = new Date(o.createdAt || o.date);
                if (oDate < historyStart || oDate >= todayStart) return;

                const dayKey = oDate.toISOString().split('T')[0];
                const refundAmount = refundsMap[o._id] || refundsMap[o.id] || refundsMap[o.localId] || 0;
                const netAmount = Math.max(0, (o.totalAmount || 0) - refundAmount);

                dailyTotals[dayKey] = (dailyTotals[dayKey] || 0) + netAmount;
            });

            const values = Object.values(dailyTotals);
            if (values.length === 0) {
                if (window.showToast) window.showToast('Need at least 1 day of past sales history', 'info');
                return;
            }

            // Suggestion formula: Average Daily Sales + 15% growth push
            const avgSales = values.reduce((a, b) => a + b, 0) / values.length;
            let growthFactor = 1.15; // 15% growth target

            // Adjust based on current volume
            if (avgSales < 1000) growthFactor = 1.30; // Push harder for very low volume
            else if (avgSales > 10000) growthFactor = 1.10; // Moderate push for high volume

            let suggested = avgSales * growthFactor;

            // Round to clean multiples (100 or 500)
            if (suggested < 5000) {
                suggested = Math.round(suggested / 100) * 100;
            } else {
                suggested = Math.round(suggested / 500) * 500;
            }

            suggested = Math.max(suggested, 500); // Floor

            setSuggestionData({
                suggested,
                avgSales,
                growthPercentage: Math.round((growthFactor - 1) * 100),
                reason: `Based on your recent average daily sales of ${formatCurrencySmart(avgSales, state.currencyFormat)}, we recommend a ${Math.round((growthFactor - 1) * 100)}% growth push to help you scale your business.`
            });
            setShowConfirmModal(true);

        } catch (error) {
            console.error('AI analysis error:', error);
            if (window.showToast) window.showToast('Could not analyze data', 'error');
        }
    };

    const confirmAutoTarget = () => {
        if (suggestionData) {
            setTargetInput(suggestionData.suggested.toString());
            if (window.showToast) {
                window.showToast(`AI Suggested target applied: ${formatCurrencySmart(suggestionData.suggested, state.currencyFormat)}`, 'success');
            }
        }
        setShowConfirmModal(false);
    };

    // Initialize/Update input when today's target changes
    useEffect(() => {
        if (todayTarget) {
            setTargetInput(todayTarget.targetAmount.toString());
        }
    }, [todayTarget ? todayTarget.targetAmount : null]);

    const handleSetTarget = async (e) => {
        e.preventDefault();
        if (!targetInput || isNaN(targetInput) || Number(targetInput) < 0) {
            if (window.showToast) window.showToast('Please enter a valid target amount', 'error');
            return;
        }

        try {
            setIsSubmitting(true);
            const amount = Number(targetInput);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Use context helper if available, or manual dispatch
            const newTarget = {
                id: todayTarget ? todayTarget.id : `target-${Date.now()}`,
                localId: todayTarget ? todayTarget.localId : `local-target-${Date.now()}`,
                date: today.toISOString(),
                targetAmount: amount,
                sellerId: state.currentUser?.sellerId,
                isDeleted: false,
                updatedAt: new Date().toISOString()
            };

            dispatch({
                type: todayTarget ? ActionTypes.UPDATE_TARGET : ActionTypes.ADD_TARGET,
                payload: newTarget
            });

            if (window.showToast) window.showToast(`Daily target ${todayTarget ? 'updated' : 'set'} successfully`, 'success');

            // Set input again just in case
            setTargetInput(amount.toString());

        } catch (error) {
            console.error('Error setting target:', error);
            if (window.showToast) window.showToast('Failed to save target', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const progressPercentage = useMemo(() => {
        if (!todayTarget || todayTarget.targetAmount === 0) return 0;
        return Math.min(100, Math.round((todaySales / todayTarget.targetAmount) * 100));
    }, [todaySales, todayTarget]);

    const chartData = useMemo(() => {
        // Reverse history for chronological order (oldest -> newest) for chart
        const sortedHistory = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));

        return {
            labels: sortedHistory.map(h => formatDate(h.date)),
            datasets: [
                {
                    label: 'Target',
                    data: sortedHistory.map(h => h.targetAmount),
                    borderColor: 'rgb(99, 102, 241)', // Indigo
                    borderDash: [5, 5],
                    tension: 0.4,
                    fill: false
                },
                {
                    label: 'Achieved',
                    data: sortedHistory.map(h => h.achievedAmount),
                    borderColor: 'rgb(16, 185, 129)', // Emerald
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    tension: 0.4,
                    fill: true
                }
            ]
        };
    }, [history]);

    const chartOptions = {
        responsive: true,
        plugins: {
            legend: { position: 'top' },
            title: { display: false }
        },
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    callback: (value) => formatCurrencySmart(value, state.currencyFormat)
                }
            }
        }
    };

    const statusTheme = useMemo(() => {
        if (progressPercentage >= 100) return {
            bg: 'bg-emerald-600 dark:bg-emerald-900',
            shadow: 'shadow-emerald-500/40',
        };
        if (progressPercentage >= 50) return {
            bg: 'bg-indigo-600 dark:bg-indigo-900',
            shadow: 'shadow-indigo-500/30',
        };
        if (progressPercentage > 0) return {
            bg: 'bg-amber-500 dark:bg-amber-900/60',
            shadow: 'shadow-amber-500/20',
        };
        return {
            bg: 'bg-slate-800 dark:bg-slate-900',
            shadow: 'shadow-slate-500/20',
        };
    }, [progressPercentage]);

    if (!state.initialLoadDone && !state.targets) {
        return <PageSkeleton />;
    }

    return (
        <div className="space-y-6 fade-in-up pb-20 max-w-[1400px] mx-auto sm:px-0">
            {/* Page Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8 px-4 sm:px-0">
                <div className="flex items-center gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">
                        <Target className="h-8 w-8" />
                    </div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                            Sales Targets
                        </h1>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                            Scale your business with AI-driven goals
                        </p>
                    </div>
                </div>

                {/* Quick Stats in Header */}
                <div className="flex items-center gap-3">
                    <div className="bg-white dark:bg-slate-800 px-4 py-2 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                            <TrendingUp className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 mb-0.5">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Growth</p>
                                <span className="text-[9px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 px-1.5 rounded-md whitespace-nowrap">
                                    Last 14 Days
                                </span>
                            </div>
                            <p className="text-sm font-black text-slate-900 dark:text-white">
                                +{suggestionData?.growthPercentage || 0}%
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Interactive Card */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 sm:gap-6">
                {/* Setting Target Section */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-none sm:rounded-3xl p-6 sm:p-8 shadow-xl shadow-slate-200/50 dark:shadow-none border-b sm:border border-white dark:border-slate-700/50 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <Target className="w-32 h-32 text-indigo-600 -mr-16 -mt-16" />
                    </div>

                    <div className="relative z-10">
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900/40 rounded-xl text-indigo-600 dark:text-indigo-400">
                                    <Calendar className="h-6 w-6" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-slate-900 dark:text-white">Today's Goal</h2>
                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">{formatDate(new Date())}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handleAutoSetTarget}
                                className="flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold text-xs transition-all active:scale-95 shadow-md hover:opacity-90"
                            >
                                <Sparkles className="h-3.5 w-3.5" />
                                AI SUGGEST
                            </button>
                        </div>

                        <form onSubmit={handleSetTarget} className="space-y-6">
                            <div className="relative">
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-3 px-1">
                                    Define Your Target
                                </label>
                                <div className="relative group/input">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                        <span className="text-lg font-black text-indigo-600 dark:text-indigo-400 tracking-tighter">₹</span>
                                    </div>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={targetInput}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === '' || /^\d+$/.test(val)) {
                                                setTargetInput(val);
                                            }
                                        }}
                                        placeholder="Enter target amount..."
                                        className="block w-full pl-14 pr-32 py-5 bg-slate-50 dark:bg-slate-900/50 border-2 border-slate-100 dark:border-slate-700/50 rounded-2xl text-xl font-black text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-700 focus:outline-none focus:border-indigo-600 dark:focus:border-indigo-500 focus:ring-4 focus:ring-indigo-600/10 transition-all"
                                    />
                                    <div className="absolute inset-y-2 right-2">
                                        <button
                                            type="submit"
                                            disabled={isSubmitting}
                                            className="h-full px-6 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black text-sm rounded-xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 hover:opacity-90"
                                        >
                                            {isSubmitting ? (
                                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            ) : (
                                                <>
                                                    <CheckCircle2 className="w-4 h-4" />
                                                    {todayTarget ? 'UPDATE' : 'SET GOAL'}
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Current Sales</p>
                                    <p className="text-xl font-black text-slate-900 dark:text-white">
                                        {formatCurrencySmart(todaySales, state.currencyFormat)}
                                    </p>
                                </div>
                                <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 text-right">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Target</p>
                                    <p className="text-xl font-black text-indigo-600 dark:text-indigo-400">
                                        {formatCurrencySmart(Number(targetInput) || 0, state.currencyFormat)}
                                    </p>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Progress Visualizer Section */}
                <div className={`${statusTheme.bg} rounded-none sm:rounded-3xl p-8 flex flex-col justify-between items-center text-center text-white relative overflow-hidden group shadow-2xl ${statusTheme.shadow} transition-all duration-700`}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.2),transparent)] pointer-events-none"></div>

                    <div className="relative z-10 w-full">
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-[10px] font-bold uppercase tracking-widest mb-6">
                            <ArrowUpRight className="w-3 h-3" />
                            Live Performance
                        </div>

                        <div className="relative mb-6">
                            <svg className="w-40 h-40 mx-auto" viewBox="0 0 100 100">
                                <circle
                                    cx="50" cy="50" r="45"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="8"
                                    className="opacity-10"
                                />
                                <circle
                                    cx="50" cy="50" r="45"
                                    fill="none"
                                    stroke="white"
                                    strokeWidth="8"
                                    strokeDasharray={`${progressPercentage * 2.827} 282.7`}
                                    strokeLinecap="round"
                                    className="drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] transition-all duration-1000 ease-out"
                                    transform="rotate(-90 50 50)"
                                />
                                <text x="50" y="55" fontSize="18" fontWeight="900" textAnchor="middle" fill="white" className="tabular-nums">
                                    {progressPercentage}%
                                </text>
                            </svg>
                        </div>

                        <h3 className="text-2xl font-black mb-2 tracking-tight">
                            {progressPercentage >= 100 ? "Goal Smashed! 🏆" : progressPercentage >= 50 ? "Halfway There! 🔥" : "Getting Started! 🚀"}
                        </h3>
                        <p className="text-indigo-100 text-sm font-medium leading-relaxed max-w-[200px] mx-auto">
                            {progressPercentage >= 100
                                ? `You've exceeded your daily target by ${formatCurrencySmart(todaySales - (todayTarget?.targetAmount || 0), state.currencyFormat)}.`
                                : `Just ${formatCurrencySmart((todayTarget?.targetAmount || 0) - todaySales, state.currencyFormat)} more to reach your goal.`}
                        </p>
                    </div>

                    <div className="relative z-10 mt-8 w-full p-3 bg-white/10 backdrop-blur-md rounded-2xl border border-white/10">
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest opacity-80 mb-2">
                            <span>Efficiency</span>
                            <span>{progressPercentage >= 100 ? 'Peak' : 'Optimal'}</span>
                        </div>
                        <div className="w-full bg-white/20 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full bg-white transition-all duration-1000" style={{ width: `${progressPercentage}%` }}></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* History Section */}
            <div className="bg-white dark:bg-slate-800 rounded-none sm:rounded-[32px] p-6 sm:p-8 shadow-xl shadow-slate-200/50 dark:shadow-none border-t sm:border border-white dark:border-slate-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-slate-400">
                            <HistoryIcon className="h-6 w-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 dark:text-white">Performance History</h2>
                            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Growth metrics over time</p>
                        </div>
                    </div>
                    <div className="flex bg-slate-100 dark:bg-slate-900/50 p-1.5 rounded-2xl">
                        <button
                            onClick={() => setViewMode('chart')}
                            className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-black transition-all ${viewMode === 'chart' ? 'bg-white dark:bg-slate-800 shadow-lg text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <TrendingUp className="w-4 h-4" />
                            CHART
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-black transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-800 shadow-lg text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <ListChecks className="w-4 h-4" />
                            LOG
                        </button>
                    </div>
                </div>

                {history.length > 0 ? (
                    viewMode === 'chart' ? (
                        <div className="h-[300px] sm:h-[400px]">
                            <Line data={chartData} options={chartOptions} />
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {/* Desktop Table - Hidden on Mobile */}
                            <div className="hidden sm:block overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                                    <thead className="bg-gray-50 dark:bg-slate-700/50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Date</th>
                                            <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Goal</th>
                                            <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Sold</th>
                                            <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Result</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                                        {history.map((item) => {
                                            const isMet = (item.achievedAmount || 0) >= (item.targetAmount || 0);
                                            const targetDate = new Date(item.date);
                                            const today = new Date();
                                            const isToday = targetDate.getDate() === today.getDate() &&
                                                targetDate.getMonth() === today.getMonth() &&
                                                targetDate.getFullYear() === today.getFullYear();

                                            return (
                                                <tr key={item.id || item._id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                                                    <td className="px-4 py-4 whitespace-nowrap text-sm font-black text-slate-900 dark:text-white">
                                                        {formatDate(item.date)}
                                                    </td>
                                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-right text-indigo-600 dark:text-indigo-400 font-extrabold">
                                                        {formatCurrencySmart(item.targetAmount, state.currencyFormat)}
                                                    </td>
                                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-right text-emerald-600 dark:text-emerald-400 font-black">
                                                        {formatCurrencySmart(item.achievedAmount, state.currencyFormat)}
                                                    </td>
                                                    <td className="px-4 py-4 whitespace-nowrap text-center">
                                                        {isMet ? (
                                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/30">
                                                                <CheckCircle2 className="h-3 w-3" /> Met
                                                            </span>
                                                        ) : isToday ? (
                                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-100 dark:border-amber-800/30">
                                                                <TrendingUp className="h-3 w-3" /> Live
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 border border-rose-100 dark:border-rose-800/30">
                                                                <AlertCircle className="h-3 w-3" /> Off
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile List - Visible only on small screens */}
                            <div className="sm:hidden space-y-3">
                                {history.map((item) => {
                                    const isMet = (item.achievedAmount || 0) >= (item.targetAmount || 0);
                                    const targetDate = new Date(item.date);
                                    const today = new Date();
                                    const isToday = targetDate.getDate() === today.getDate() &&
                                        targetDate.getMonth() === today.getMonth() &&
                                        targetDate.getFullYear() === today.getFullYear();

                                    return (
                                        <div key={item.id || item._id} className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-5 border border-slate-100 dark:border-slate-800/50 shadow-sm active:scale-[0.99] transition-transform">
                                            <div className="flex justify-between items-start mb-4">
                                                <div>
                                                    <p className="text-sm font-black text-slate-900 dark:text-white tracking-tight">
                                                        {formatDate(item.date).split(',')[0]}
                                                    </p>
                                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                                                        {formatDate(item.date).split(',')[1]}
                                                    </p>
                                                </div>
                                                {isMet ? (
                                                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-lg border border-emerald-100 dark:border-emerald-800/30">
                                                        <TrophyIcon className="w-3 h-3" />
                                                        <span className="text-[10px] font-black uppercase tracking-tighter">Goal Met</span>
                                                    </div>
                                                ) : isToday ? (
                                                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-lg border border-amber-100 dark:border-amber-800/30">
                                                        <TrendingUp className="w-3 h-3" />
                                                        <span className="text-[10px] font-black uppercase tracking-tighter">Live Now</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-200/50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg border border-slate-300/30">
                                                        <AlertCircle className="w-3 h-3" />
                                                        <span className="text-[10px] font-black uppercase tracking-tighter">Missed</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 shadow-sm">
                                                    <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest mb-1">Target</p>
                                                    <p className="text-sm font-black text-indigo-600 dark:text-indigo-400">
                                                        {formatCurrencySmart(item.targetAmount, state.currencyFormat)}
                                                    </p>
                                                </div>
                                                <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 shadow-sm">
                                                    <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest mb-1">Achieved</p>
                                                    <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                                                        {formatCurrencySmart(item.achievedAmount, state.currencyFormat)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )
                ) : (
                    <div className="text-center py-12">
                        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-full h-16 w-16 flex items-center justify-center mx-auto mb-4">
                            <TrendingUp className="h-8 w-8 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">No history yet</h3>
                        <p className="text-gray-500 dark:text-slate-400 mt-1">Start setting targets to see your performance history.</p>
                    </div>
                )}
            </div>

            {/* AI Confirmation Modal */}
            {showConfirmModal && suggestionData && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-slate-900 rounded-[40px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 border border-indigo-100/50 dark:border-indigo-900/30">
                        <div className="bg-indigo-600 p-10 flex flex-col items-center text-center relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.2),transparent)] pointer-events-none"></div>
                            <div className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur-xl flex items-center justify-center text-white mb-6 shadow-xl border border-white/20">
                                <Sparkles className="h-10 w-10 animate-pulse" />
                            </div>
                            <h3 className="text-2xl font-black text-white tracking-tight uppercase">AI Magic Suggestion</h3>
                        </div>

                        <div className="p-8 sm:p-10 space-y-8">
                            <div className="text-center">
                                <p className="text-sm font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Recommended Goal</p>
                                <p className="text-5xl font-black text-indigo-600 dark:text-indigo-400 tracking-tighter tabular-nums">
                                    {formatCurrencySmart(suggestionData.suggested, state.currencyFormat)}
                                </p>
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl p-6 border-2 border-indigo-50 dark:border-indigo-900/20">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-ping"></div>
                                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Analysis Engine</h4>
                                </div>
                                <p className="text-sm font-bold text-slate-600 dark:text-slate-300 leading-relaxed italic">
                                    " {suggestionData.reason} "
                                </p>
                            </div>

                            <div className="grid grid-cols-1 gap-3 pt-4">
                                <button
                                    onClick={confirmAutoTarget}
                                    className="w-full py-5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black rounded-2xl transition-all shadow-xl active:scale-[0.98] flex items-center justify-center gap-3 group hover:opacity-90"
                                >
                                    <span>YES, APPLY TARGET</span>
                                    <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                </button>
                                <button
                                    onClick={() => setShowConfirmModal(false)}
                                    className="w-full py-4 text-slate-400 hover:text-red-500 font-black text-[11px] uppercase tracking-widest transition-all"
                                >
                                    Dismiss Suggestion
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Helper icon
const HistoryIcon = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

export default SalesTarget;

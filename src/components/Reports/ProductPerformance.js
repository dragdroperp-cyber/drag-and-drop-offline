
import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
    TrendingUp,
    Package,
    ShoppingCart,
    Calendar,
    ChevronDown,
    ArrowUpRight,
    ArrowDownRight,
    Target,
    Users,
    Search,
    Zap,
    CheckCircle,
    AlertCircle,
    BarChart2,
    Filter,
    Download,
    FileText,
    CalendarRange,
    X,
    XCircle,
    Plus,
    ScanLine as BarcodeIcon,
    Check
} from 'lucide-react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { formatDate } from '../../utils/dateUtils';
import { formatCurrencySmart, formatCurrencyCompact } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

const ProductPerformance = () => {
    const { state } = useApp();
    const [selectedProductIds, setSelectedProductIds] = useState([]);
    const [timeRange, setTimeRange] = useState('30d');
    const [showCustomDateModal, setShowCustomDateModal] = useState(false);
    const [customDateRange, setCustomDateRange] = useState({
        start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    });
    const [tempCustomRange, setTempCustomRange] = useState({ ...customDateRange });
    const [showProductModal, setShowProductModal] = useState(false);
    const [tempSelectedProductIds, setTempSelectedProductIds] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [isChipsExpanded, setIsChipsExpanded] = useState(false);
    const [isAlertsExpanded, setIsAlertsExpanded] = useState(false);
    const [isLoyalistsExpanded, setIsLoyalistsExpanded] = useState(false);
    const [isInventoryExpanded, setIsInventoryExpanded] = useState(false);

    // Get unique categories
    const categories = useMemo(() => {
        const cats = new Set(state.products.map(p => p.category || 'General'));
        return ['All', ...Array.from(cats).sort()];
    }, [state.products]);

    // Get selected product objects
    const selectedProducts = useMemo(() =>
        state.products.filter(p => selectedProductIds.includes(p._id) || selectedProductIds.includes(p.localId) || selectedProductIds.includes(p.id)),
        [state.products, selectedProductIds]
    );

    // Toggle product selection (Modal staging)
    const toggleTempProduct = (productId) => {
        setTempSelectedProductIds(prev => {
            if (prev.includes(productId)) {
                return prev.filter(id => id !== productId);
            }
            return [...prev, productId];
        });
    };

    // Filter products for modal search and category
    const filteredProducts = useMemo(() => {
        let items = state.products;

        if (selectedCategory !== 'All') {
            items = items.filter(p => (p.category || 'General') === selectedCategory);
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            items = items.filter(p =>
                p.name?.toLowerCase().includes(query) ||
                p.barcode?.toLowerCase().includes(query) ||
                p.category?.toLowerCase().includes(query)
            );
        }

        return items.slice(0, 100);
    }, [state.products, searchQuery, selectedCategory]);

    // Context-aware selection logic
    const allFilteredIds = useMemo(() => filteredProducts.map(p => p._id || p.localId || p.id), [filteredProducts]);
    const isAllFilteredSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => tempSelectedProductIds.includes(id));

    const toggleSelectAllModal = () => {
        if (isAllFilteredSelected) {
            // Remove only the items currently in view
            setTempSelectedProductIds(prev => prev.filter(id => !allFilteredIds.includes(id)));
        } else {
            // Add all items currently in view
            setTempSelectedProductIds(prev => {
                const uniqueIds = new Set([...prev, ...allFilteredIds]);
                return Array.from(uniqueIds);
            });
        }
    };

    // Date range calculation
    const dateRange = useMemo(() => {
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        const start = new Date();

        if (timeRange === 'today') {
            start.setHours(0, 0, 0, 0);
        } else if (timeRange === '7d') {
            start.setDate(end.getDate() - 7);
            start.setHours(0, 0, 0, 0);
        } else if (timeRange === '30d') {
            start.setDate(end.getDate() - 30);
            start.setHours(0, 0, 0, 0);
        } else if (timeRange === 'all') {
            start.setTime(0);
        } else if (timeRange === 'custom') {
            const customStart = new Date(customDateRange.start);
            customStart.setHours(0, 0, 0, 0);
            const customEnd = new Date(customDateRange.end);
            customEnd.setHours(23, 59, 59, 999);
            return { start: customStart, end: customEnd };
        }

        return { start, end };
    }, [timeRange, customDateRange]);

    // Process data for selected products
    const performanceData = useMemo(() => {
        if (selectedProductIds.length === 0) return null;

        const { start, end } = dateRange;
        const productOrders = state.orders.filter(order => {
            if (order.isDeleted) return false;

            // Match SalesOrderHistory/Reports logic: for online orders, only count if 'Delivered'
            if (order.orderSource === 'online' && order.orderStatus !== 'Delivered') {
                return false;
            }

            const orderDate = new Date(order.createdAt || order.date);
            if (orderDate < start || orderDate > end) return false;

            return order.items?.some(item =>
                selectedProductIds.includes(item.productId) ||
                selectedProductIds.includes(item.localProductId) ||
                selectedProductIds.includes(item._id)
            );
        });

        let totalUnitsSold = 0;
        let totalRevenue = 0;
        let totalCost = 0;
        const dailyData = new Map();
        const customerMap = new Map();

        // Initialize daily map for trend chart
        const loopDate = new Date(start);
        while (loopDate <= end) {
            if (loopDate.getTime() === 0 && timeRange === 'all') break;
            const dayKey = formatDate(loopDate);
            dailyData.set(dayKey, { revenue: 0, units: 0, profit: 0 });
            loopDate.setDate(loopDate.getDate() + 1);
        }

        // Pre-process refunds for efficient lookup
        const refundsMap = new Map(); // orderId -> Map<productId, qty>
        (state.refunds || []).forEach(r => {
            const oId = String(r.orderId || r.order_id);
            if (!refundsMap.has(oId)) refundsMap.set(oId, new Map());
            if (Array.isArray(r.items)) {
                r.items.forEach(ri => {
                    const pId = String(ri.productId || ri.product_id || ri._id || ri.id);
                    const q = Number(ri.qty || ri.quantity || 0);
                    const existing = refundsMap.get(oId).get(pId) || 0;
                    refundsMap.get(oId).set(pId, existing + q);
                });
            }
        });

        productOrders.forEach(order => {
            const orderDate = new Date(order.createdAt || order.date);
            const dayKey = formatDate(orderDate);
            const orderId = String(order._id || order.id);

            const orderItems = order.items.filter(item =>
                selectedProductIds.includes(item.productId) ||
                selectedProductIds.includes(item.localProductId) ||
                selectedProductIds.includes(item._id)
            );

            orderItems.forEach(item => {
                const originalQty = Number(item.quantity || 0);
                if (originalQty <= 0) return;

                const pId = String(item.productId || item.localProductId || item._id);

                // Get refunded quantity
                const refundedQty = refundsMap.get(orderId)?.get(pId) || 0;
                const qty = Math.max(0, originalQty - refundedQty);

                if (qty <= 0) return; // Skip if fully refunded

                // Determine original price to calculate unit price
                let originalPrice = 0;
                if (item.totalSellingPrice !== undefined && item.totalSellingPrice !== null) {
                    originalPrice = Number(item.totalSellingPrice);
                } else if (item.total !== undefined && item.total !== null) {
                    originalPrice = Number(item.total);
                } else if (item.amount !== undefined && item.amount !== null) {
                    originalPrice = Number(item.amount);
                } else {
                    originalPrice = Number(item.sellingPrice || 0) * originalQty;
                }

                const unitPrice = originalPrice / originalQty;
                const price = unitPrice * qty;

                // Determine original cost to calculate unit cost
                let originalCost = 0;
                if (item.totalCostPrice !== undefined && item.totalCostPrice !== null) {
                    originalCost = Number(item.totalCostPrice);
                } else {
                    originalCost = Number(item.costPrice || 0) * originalQty;
                }

                const unitCost = originalCost / originalQty;
                const cost = unitCost * qty;

                totalUnitsSold += qty;
                totalRevenue += price;
                totalCost += cost;

                if (dailyData.has(dayKey)) {
                    const current = dailyData.get(dayKey);
                    current.revenue += price;
                    current.units += qty;
                    current.profit += (price - cost);
                }

                if (order.customerName && order.customerName !== 'Walk-in Customer') {
                    const custKey = order.customerMobile || order.customerName;
                    const currentCust = customerMap.get(custKey) || { name: order.customerName, count: 0, revenue: 0 };
                    currentCust.count += qty;
                    currentCust.revenue += price;
                    customerMap.set(custKey, currentCust);
                }
            });
        });

        const totalProfit = totalRevenue - totalCost;
        const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
        const avgOrderValue = productOrders.length > 0 ? totalRevenue / productOrders.length : 0;

        // Growth strategy logic (Aggregated)
        const strategies = [];
        const lowStockThreshold = state.lowStockThreshold || 10;

        // Check stock for all selected products
        const lowStockProductNames = selectedProducts
            .filter(p => Number(p.quantity || p.stock || 0) <= lowStockThreshold)
            .map(p => p.name);

        if (lowStockProductNames.length > 0) {
            const displayNames = lowStockProductNames.slice(0, 5).join(', ');
            const remainingCount = lowStockProductNames.length - 5;
            strategies.push({
                id: 'inventory-alert',
                title: 'Inventory Alert',
                description: `${lowStockProductNames.length} selected product(s) are low on stock: ${displayNames}${remainingCount > 0 ? ` + ${remainingCount} others` : ''}`,
                fullList: lowStockProductNames.join(', '),
                icon: Package,
                color: 'text-orange-500',
                bg: 'bg-orange-50'
            });
        }

        if (totalUnitsSold > 100 * selectedProductIds.length && timeRange === '30d') {
            strategies.push({
                title: 'High Performance Group',
                description: 'These products are collectively driving high volume. Consider bundle offers to increase average order value.',
                icon: Zap,
                color: 'text-amber-500',
                bg: 'bg-amber-50'
            });
        }

        if (profitMargin < 15 && totalRevenue > 0) {
            strategies.push({
                title: 'Group Margin Optimization',
                description: 'The combined margin is below 15%. Review pricing for the lower-performing items in this group.',
                icon: AlertCircle,
                color: 'text-rose-500',
                bg: 'bg-rose-50'
            });
        }

        if (strategies.length === 0) {
            strategies.push({
                title: 'Group Performance Stable',
                description: 'Selection performance is stable. Continue monitoring individual items for outliers.',
                icon: CheckCircle,
                color: 'text-emerald-500',
                bg: 'bg-emerald-50'
            });
        }

        return {
            totalUnitsSold,
            totalRevenue,
            totalProfit,
            profitMargin,
            avgOrderValue,
            dailyData: Array.from(dailyData.entries()).map(([date, vals]) => ({ date, ...vals })),
            topCustomers: Array.from(customerMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 50),
            strategies,
            orderCount: productOrders.length
        };
    }, [selectedProductIds, selectedProducts, dateRange, state.orders, state.lowStockThreshold, timeRange]);

    // Chart configs
    const lineChartData = useMemo(() => {
        if (!performanceData) return null;
        return {
            labels: performanceData.dailyData.map(d => d.date),
            datasets: [
                {
                    label: 'Revenue',
                    data: performanceData.dailyData.map(d => d.revenue),
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                },
                {
                    label: 'Profit',
                    data: performanceData.dailyData.map(d => d.profit),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                }
            ]
        };
    }, [performanceData]);

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 6 } },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                titleColor: '#1e293b',
                bodyColor: '#475569',
                borderColor: '#e2e8f0',
                borderWidth: 1,
                padding: 12,
                boxPadding: 4,
                usePointStyle: true,
            }
        },
        scales: {
            x: { grid: { display: false } },
            y: {
                beginAtZero: true,
                ticks: { callback: (value) => formatCurrencySmart(value, state.currencyFormat) }
            }
        }
    };

    const StatCard = ({ title, value, subValue, icon: Icon, colorClass }) => (
        <div className="relative overflow-hidden -mx-3 sm:mx-0 rounded-none sm:rounded-3xl border-y sm:border border-slate-200/60 bg-white p-6 shadow-sm transition-all hover:shadow-md dark:border-slate-700/50 dark:bg-slate-800/50">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</p>
                    <h3 className="mt-2 text-2xl font-bold text-slate-800 dark:text-white">{value}</h3>
                    {subValue && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subValue}</p>}
                </div>
                <div className={`rounded-2xl p-3 ${colorClass}`}>
                    <Icon className="h-6 w-6" />
                </div>
            </div>
            <div className="absolute -bottom-4 -right-4 h-24 w-24 opacity-[0.03]">
                <Icon className="h-full w-full" />
            </div>
        </div>
    );

    return (
        <div className="space-y-6 pb-6">
            {/* Header Section */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-slate-200 dark:border-slate-700">
                <div className="min-w-0">
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white truncate">
                        {getTranslation('productPerformance', state.currentLanguage)}
                    </h1>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Compare sales metrics for multiple products
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                    {/* Time Range Selector - Full width scroll on mobile */}
                    <div className="flex items-center gap-1 rounded-2xl bg-white p-1.5 shadow-sm border border-slate-200/60 dark:bg-slate-800/80 dark:border-slate-700/50 overflow-x-auto no-scrollbar scroll-smooth w-full sm:w-auto">
                        {[
                            { id: 'today', label: 'Today' },
                            { id: '7d', label: '7 Days' },
                            { id: '30d', label: '30 Days' },
                            { id: 'custom', label: 'Custom' }
                        ].map((range) => (
                            <button
                                key={range.id}
                                onClick={() => {
                                    if (range.id === 'custom') {
                                        setShowCustomDateModal(true);
                                    } else {
                                        setTimeRange(range.id);
                                    }
                                }}
                                className={`px-4 py-2.5 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 whitespace-nowrap min-w-fit flex-1 sm:flex-none ${timeRange === range.id
                                    ? 'bg-slate-900 text-white shadow-md dark:bg-white dark:text-slate-900'
                                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/50'
                                    }`}
                            >
                                {range.id === 'custom' && <CalendarRange className="h-4 w-4" />}
                                {range.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Product Selection Section */}
            <div className={`transition-all relative z-10`}>
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg dark:bg-white dark:text-slate-900 flex-shrink-0">
                        <Package className="h-7 w-7" />
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                                <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Inventory Analysis</h2>
                                <p className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">Select Products to Analyze</p>
                            </div>
                            {selectedProductIds.length > 0 && (
                                <button
                                    onClick={() => setSelectedProductIds([])}
                                    className="inline-flex items-center gap-2 text-xs font-bold text-rose-500 hover:text-rose-600 transition-colors uppercase tracking-widest bg-rose-50 dark:bg-rose-950/20 px-4 py-2 rounded-xl border border-rose-100 dark:border-rose-900/30"
                                >
                                    <X className="h-3.5 w-3.5" />
                                    Clear All ({selectedProductIds.length})
                                </button>
                            )}
                        </div>

                        {/* Chips for already selected products */}
                        <div className="mt-6">
                            {selectedProducts.length > 0 ? (
                                <div className="space-y-3">
                                    <div className={`flex flex-wrap gap-2.5 transition-all duration-300 ${!isChipsExpanded ? 'max-h-[88px] overflow-hidden' : ''}`}>
                                        {selectedProducts.map(p => (
                                            <div key={p._id || p.localId} className="flex items-center gap-2.5 rounded-2xl bg-white px-4 py-2 border border-slate-200 shadow-sm text-sm font-bold text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 group animate-in zoom-in-95 duration-200 hover:border-indigo-400 dark:hover:border-indigo-500 transition-all">
                                                <span className="truncate max-w-[150px]">{p.name}</span>
                                                <button
                                                    onClick={() => setSelectedProductIds(prev => prev.filter(id => id !== (p._id || p.localId || p.id)))}
                                                    className="rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 p-0.5 transition-colors text-slate-400 hover:text-rose-500"
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    {selectedProducts.length > 8 && (
                                        <button
                                            onClick={() => setIsChipsExpanded(!isChipsExpanded)}
                                            className="text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors uppercase tracking-widest px-2 py-1"
                                        >
                                            {isChipsExpanded ? 'Show Less' : `View All (${selectedProducts.length})`}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="flex items-center gap-3 text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/30 px-4 py-3 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 w-full">
                                    <Filter className="h-4 w-4" />
                                    <p className="text-sm font-medium">No products selected. Add items below to begin analysis.</p>
                                </div>
                            )}
                        </div>

                        <div className="relative mt-8">
                            <button
                                onClick={() => {
                                    setTempSelectedProductIds([...selectedProductIds]);
                                    setShowProductModal(true);
                                }}
                                className="flex w-full items-center justify-between rounded-2xl border border-slate-200/80 bg-white p-3.5 text-left transition-all hover:bg-slate-50 hover:shadow-md hover:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:bg-slate-800/80 group"
                            >
                                <div className="flex items-center gap-4 min-w-0">
                                    <div className="bg-indigo-50 dark:bg-indigo-900/30 p-2 rounded-xl border border-indigo-100 dark:border-indigo-800 group-hover:bg-indigo-100 transition-colors">
                                        <Plus className="h-5 w-5 text-indigo-600" strokeWidth={2.5} />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                                            {selectedProductIds.length > 0 ? `${selectedProductIds.length} Products Selected` : "Add products to analyze..."}
                                        </span>
                                        <span className="text-xs text-slate-400 font-medium">Click to browse your inventory</span>
                                    </div>
                                </div>
                                <div className="bg-slate-100 dark:bg-slate-800 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 transition-transform group-hover:scale-110">
                                    <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform duration-300 ${showProductModal ? 'rotate-180' : ''}`} />
                                </div>
                            </button>

                            {/* Fullscreen Standardized Product Selection Modal */}
                            {showProductModal && (
                                <div className="fixed inset-0 z-[1600] flex flex-col bg-white dark:bg-slate-900 animate-in fade-in duration-300 overflow-hidden">
                                    {/* Modal Header */}
                                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0">
                                        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 tracking-tight flex items-center gap-2">
                                            <BarcodeIcon className="h-5 w-5 text-slate-900 dark:text-indigo-400" />
                                            Select Products
                                        </h2>
                                        <button
                                            onClick={() => setShowProductModal(false)}
                                            className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors"
                                        >
                                            <X className="h-5 w-5" />
                                        </button>
                                    </div>

                                    {/* Scrollable Content Area */}
                                    <div className="flex-1 overflow-y-auto scrollbar-hide">
                                        <div className="flex flex-col h-full">
                                            {/* Sticky Search & Filter Header */}
                                            <div className="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl px-6 py-4 space-y-4 border-b border-gray-100 dark:border-slate-800">
                                                {/* Search Box */}
                                                <div className="relative">
                                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                                    <input
                                                        type="text"
                                                        placeholder="Search products by name or current barcode..."
                                                        className="w-full pl-12 pr-4 py-3.5 bg-gray-50 dark:bg-slate-800/80 border-none rounded-2xl text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all font-bold"
                                                        value={searchQuery}
                                                        onChange={(e) => setSearchQuery(e.target.value)}
                                                        autoFocus
                                                    />
                                                </div>

                                                {/* Category Filters */}
                                                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar scroll-smooth">
                                                    {categories.map(cat => (
                                                        <button
                                                            key={cat}
                                                            onClick={() => setSelectedCategory(cat)}
                                                            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border-2 ${selectedCategory === cat
                                                                ? 'bg-gray-900 border-gray-900 text-white dark:bg-white dark:border-white dark:text-slate-900 shadow-md'
                                                                : 'bg-white border-gray-100 text-gray-500 hover:border-gray-200 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:border-slate-700'
                                                                }`}
                                                        >
                                                            {cat}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="flex-1 px-6 py-6 space-y-6">
                                                {/* Selection Controls */}
                                                <div className="flex items-center justify-between">
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => {
                                                                const allIds = filteredProducts.map(p => p._id || p.localId || p.id);
                                                                setTempSelectedProductIds(allIds);
                                                            }}
                                                            className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-all"
                                                        >
                                                            SELECT ALL
                                                        </button>
                                                        <button
                                                            onClick={() => setTempSelectedProductIds([])}
                                                            className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-all"
                                                        >
                                                            CLEAR ALL
                                                        </button>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">
                                                            {filteredProducts.length} ITEMS FOUND
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Product List */}
                                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                                    {filteredProducts.map((p) => {
                                                        const id = p._id || p.localId || p.id;
                                                        const isSelected = tempSelectedProductIds.includes(id);
                                                        const stockStatus = (p.quantity || 0) <= 0 ? 'Out of Stock' : `${p.quantity} In Stock`;
                                                        const isLowStock = (p.quantity || 0) <= (state.lowStockThreshold || 5);

                                                        return (
                                                            <div
                                                                key={id}
                                                                onClick={() => toggleTempProduct(id)}
                                                                className={`group relative flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer ${isSelected
                                                                    ? 'bg-indigo-50/30 dark:bg-indigo-900/10 border-indigo-500/50 shadow-sm'
                                                                    : 'bg-white dark:bg-slate-900 border-gray-100 dark:border-slate-800 hover:border-gray-200 dark:hover:border-slate-700'
                                                                    }`}
                                                            >
                                                                {/* Product Icon */}
                                                                <div className={`p-3 rounded-xl shrink-0 transition-colors ${isSelected
                                                                    ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
                                                                    : 'bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-500'
                                                                    }`}>
                                                                    <Package className="h-6 w-6" />
                                                                </div>

                                                                {/* Product Details */}
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center justify-between mb-0.5">
                                                                        <p className="font-bold text-gray-900 dark:text-white truncate text-base leading-tight">
                                                                            {p.name}
                                                                        </p>
                                                                        <div className="text-right ml-2 shrink-0">
                                                                            <span className="text-sm font-black text-gray-900 dark:text-white">
                                                                                {formatCurrencySmart(p.sellingPrice, state.currencyFormat)}
                                                                            </span>
                                                                        </div>
                                                                    </div>

                                                                    <div className="flex items-center justify-between">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-xs font-semibold text-gray-400 dark:text-slate-500 capitalize">{p.category || '-'}</span>
                                                                            <span className="text-gray-300 dark:text-slate-700">|</span>
                                                                            {p.barcode ? (
                                                                                <span className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-tighter">
                                                                                    <BarcodeIcon className="h-3 w-3" /> {p.barcode}
                                                                                </span>
                                                                            ) : (
                                                                                <span className="text-[10px] font-bold text-orange-500 dark:text-orange-400 uppercase tracking-tighter italic">
                                                                                    No Barcode
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <span className={`text-[10px] font-bold uppercase tracking-widest ${isLowStock ? 'text-red-500' : 'text-emerald-500'}`}>
                                                                                {stockStatus}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Checkbox Indicator */}
                                                                <div className={`flex items-center justify-center h-6 w-6 rounded-full border-2 transition-all shrink-0 ${isSelected
                                                                    ? 'bg-indigo-600 border-indigo-600'
                                                                    : 'border-gray-200 dark:border-slate-800 bg-transparent'
                                                                    }`}>
                                                                    {isSelected && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {filteredProducts.length === 0 && (
                                                    <div className="py-24 text-center">
                                                        <div className="bg-gray-50 dark:bg-slate-900 w-20 h-20 rounded-[32px] flex items-center justify-center mx-auto mb-4 border border-gray-100 dark:border-slate-800">
                                                            <Package className="h-10 w-10 text-gray-300" />
                                                        </div>
                                                        <h4 className="text-xl font-bold text-gray-900 dark:text-white">No items found</h4>
                                                        <p className="text-sm text-gray-500 mt-1">Try adjusting your search or category filter</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Footer */}
                                    <div className="p-4 border-t border-gray-100 dark:border-slate-800/50 mt-auto flex justify-center shrink-0">
                                        <button
                                            onClick={() => {
                                                setSelectedProductIds(tempSelectedProductIds);
                                                setShowProductModal(false);
                                            }}
                                            disabled={tempSelectedProductIds.length === 0}
                                            className="min-w-[280px] md:min-w-[400px] py-3 rounded-xl font-bold text-base text-white dark:text-slate-900 bg-gray-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Confirm & Continue ({tempSelectedProductIds.length})
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {selectedProductIds.length > 0 ? (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* KPI Row */}
                    <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                        <StatCard
                            title="Combined Units Sold"
                            value={performanceData.totalUnitsSold}
                            subValue={`${performanceData.orderCount} total orders`}
                            icon={ShoppingCart}
                            colorClass="bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400"
                        />
                        <StatCard
                            title="Combined Revenue"
                            value={formatCurrencySmart(performanceData.totalRevenue, state.currencyFormat)}
                            subValue="Aggregate sales value"
                            icon={TrendingUp}
                            colorClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400"
                        />
                        <StatCard
                            title="Net Group Profit"
                            value={formatCurrencySmart(performanceData.totalProfit, state.currencyFormat)}
                            subValue={`${performanceData.profitMargin.toFixed(1)}% margin`}
                            icon={Target}
                            colorClass="bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400"
                        />
                        <StatCard
                            title="Avg. Order Value"
                            value={formatCurrencySmart(performanceData.avgOrderValue, state.currencyFormat)}
                            subValue="Revenue per transaction"
                            icon={BarChart2}
                            colorClass="bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                        {/* Chart Section */}
                        <div className="-mx-3 sm:mx-0 rounded-none sm:rounded-[32px] border-y sm:border border-slate-200/60 bg-white p-5 sm:p-8 shadow-sm dark:border-slate-700/50 dark:bg-slate-800/50 lg:col-span-2">
                            <div className="mb-8 flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">Aggregate Performance Trend</h3>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Combined revenue and profit metrics for all selected products</p>
                                </div>
                            </div>
                            <div className="h-[300px] sm:h-[400px]">
                                <Line data={lineChartData} options={chartOptions} />
                            </div>
                        </div>

                        {/* Strategy & Insights */}
                        <div className="flex flex-col gap-8">
                            <div className="-mx-3 sm:mx-0 flex-1 rounded-none sm:rounded-[32px] border-y sm:border border-slate-200/60 bg-white p-5 sm:p-8 shadow-sm dark:border-slate-700/50 dark:bg-slate-800/50">
                                <div className="mb-6 flex items-center gap-3">
                                    <Zap className="h-6 w-6 text-indigo-500" />
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">Aggregated Growth Strategy</h3>
                                </div>
                                <div className="space-y-4">
                                    {(isAlertsExpanded ? performanceData.strategies : performanceData.strategies.slice(0, 3)).map((strat, idx) => (
                                        <div key={idx} className={`rounded-2xl p-5 ${strat.bg} border border-transparent transition-all hover:border-slate-200 animate-in fade-in slide-in-from-top-2 duration-300`}>
                                            <div className="flex items-start gap-4">
                                                <div className={`rounded-xl p-2.5 ${strat.color} bg-white shadow-sm flex-shrink-0`}>
                                                    <strat.icon className="h-5 w-5" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="font-bold text-slate-900">{strat.title}</h4>
                                                    <div className="mt-1">
                                                        <p className="text-sm text-slate-600 leading-relaxed">
                                                            {strat.id === 'inventory-alert' && isInventoryExpanded
                                                                ? `${performanceData.strategies.find(s => s.id === 'inventory-alert').fullList.split(',').length} selected product(s) are low on stock: ${strat.fullList}`
                                                                : strat.description
                                                            }
                                                        </p>
                                                        {strat.id === 'inventory-alert' && strat.fullList.split(', ').length > 5 && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setIsInventoryExpanded(!isInventoryExpanded);
                                                                }}
                                                                className="mt-2 text-[10px] font-bold text-orange-600 hover:text-orange-700 uppercase tracking-widest transition-colors"
                                                            >
                                                                {isInventoryExpanded ? 'View Less' : 'View More Products'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {performanceData.strategies.length > 3 && (
                                        <button
                                            onClick={() => setIsAlertsExpanded(!isAlertsExpanded)}
                                            className="w-full py-2.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors uppercase tracking-widest border border-dashed border-indigo-200 rounded-xl hover:bg-indigo-50/50"
                                        >
                                            {isAlertsExpanded ? 'Show Less Insights' : `View All Insights (${performanceData.strategies.length})`}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Top Customers */}
                            <div className="-mx-3 sm:mx-0 rounded-none sm:rounded-[32px] border-y sm:border border-slate-200/60 bg-white p-5 sm:p-8 shadow-sm dark:border-slate-700/50 dark:bg-slate-800/50">
                                <div className="mb-6 flex items-center gap-3">
                                    <Users className="h-6 w-6 text-indigo-500" />
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">Group Top Loyalists</h3>
                                </div>
                                <div className="space-y-4">
                                    {performanceData.topCustomers.length > 0 ? (
                                        <>
                                            {(isLoyalistsExpanded ? performanceData.topCustomers : performanceData.topCustomers.slice(0, 5)).map((cust, idx) => (
                                                <div key={idx} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 transition-all hover:bg-slate-100 dark:bg-slate-900/50 dark:hover:bg-slate-900 animate-in fade-in slide-in-from-top-2 duration-300">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 font-bold dark:bg-indigo-900/40">
                                                            {cust.name.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-slate-800 dark:text-white">{cust.name}</p>
                                                            <p className="text-xs text-slate-500 dark:text-slate-400">{cust.count} units bought (from group)</p>
                                                        </div>
                                                    </div>
                                                    <p className="font-bold text-slate-900 dark:text-indigo-400">
                                                        {formatCurrencySmart(cust.revenue, state.currencyFormat)}
                                                    </p>
                                                </div>
                                            ))}
                                            {performanceData.topCustomers.length > 5 && (
                                                <button
                                                    onClick={() => setIsLoyalistsExpanded(!isLoyalistsExpanded)}
                                                    className="w-full py-2.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors uppercase tracking-widest border border-dashed border-indigo-200 rounded-xl hover:bg-indigo-50/50"
                                                >
                                                    {isLoyalistsExpanded ? 'Show Less' : `View All Customers (${performanceData.topCustomers.length})`}
                                                </button>
                                            )}
                                        </>
                                    ) : (
                                        <div className="py-8 text-center text-slate-400 bg-slate-50 rounded-2xl dark:bg-slate-900/30">
                                            <p className="text-sm">No specific customer data found for this selection</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center rounded-[32px] border-2 border-dashed border-slate-200 bg-white py-32 text-center dark:border-slate-700 dark:bg-slate-800/30">
                    <div className="relative mb-6">
                        <div className="absolute inset-0 scale-150 animate-pulse bg-indigo-500/10 blur-3xl" />
                        <Package className="relative h-20 w-20 text-slate-300" />
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white">No Products Selected</h3>
                    <p className="mt-2 max-w-sm text-slate-500">
                        Please pick one or more products from the menu above to unlock detailed performance analytics and growth strategies for your selection.
                    </p>
                </div>
            )}

            {/* Custom Range Modal */}
            {showCustomDateModal && (
                <div className="fixed inset-0 z-[1400] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl animate-in zoom-in-95 slide-in-from-bottom-8 duration-300 dark:bg-slate-800">
                        <div className="flex items-center justify-between border-b border-gray-100 p-4 dark:border-slate-700">
                            <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
                                <CalendarRange className="h-5 w-5 text-slate-900 dark:text-white" />
                                Custom Range
                            </h3>
                            <button
                                onClick={() => setShowCustomDateModal(false)}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                            >
                                <XCircle className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Start Date</label>
                                <input
                                    type="date"
                                    className="w-full px-4 py-2 border border-gray-200 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:border-slate-700 dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                                    value={tempCustomRange.start}
                                    onChange={(e) => setTempCustomRange({ ...tempCustomRange, start: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">End Date</label>
                                <input
                                    type="date"
                                    className="w-full px-4 py-2 border border-gray-200 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:border-slate-700 dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                                    value={tempCustomRange.end}
                                    onChange={(e) => setTempCustomRange({ ...tempCustomRange, end: e.target.value })}
                                />
                            </div>

                            <div className="pt-2 flex flex-col gap-2">
                                <button
                                    onClick={() => {
                                        setCustomDateRange(tempCustomRange);
                                        setTimeRange('custom');
                                        setShowCustomDateModal(false);
                                    }}
                                    className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 font-bold rounded-xl transition-all shadow-lg active:scale-95"
                                >
                                    Apply Range
                                </button>

                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductPerformance;

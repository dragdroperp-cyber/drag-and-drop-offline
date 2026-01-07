import React, { useState, useMemo } from 'react';
import { formatDate } from '../../utils/dateUtils';
import { formatCurrencySmart } from '../../utils/orderUtils';
import { useApp } from '../../context/AppContext';
import {
    FileText,
    Download,
    Calendar,
    Search,
    ArrowRight,
    TrendingUp,
    CreditCard,
    PieChart,
    Table as TableIcon,
    ChevronRight,
    Filter
} from 'lucide-react';
import jsPDF from 'jspdf';
import { getTranslation } from '../../utils/translations';
import { getSellerIdFromAuth } from '../../utils/api';

const GstPage = () => {
    const { state } = useApp();
    const [timeRange, setTimeRange] = useState('today');
    const [showCustomDateModal, setShowCustomDateModal] = useState(false);
    const [customDateRange, setCustomDateRange] = useState({
        start: new Date().toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    });
    const [tempCustomRange, setTempCustomRange] = useState({
        start: new Date().toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    });
    const [searchTerm, setSearchTerm] = useState('');

    const sellerIdFromAuth = (() => {
        try {
            return getSellerIdFromAuth();
        } catch (error) {
            return null;
        }
    })();

    const normalizeId = (value) => {
        if (!value && value !== 0) return null;
        const stringValue = value?.toString?.().trim?.();
        return stringValue || null;
    };

    const sellerIdentifiers = new Set(
        [
            sellerIdFromAuth,
            state.currentUser?.sellerId,
            state.currentUser?.id,
            state.currentUser?._id,
        ]
            .map(normalizeId)
            .filter(Boolean)
    );

    const belongsToSeller = (record, identifiers) => {
        if (!record || !(identifiers instanceof Set) || identifiers.size === 0) return true;
        const candidateIds = [
            record.sellerId,
            record.sellerID,
            record.seller_id,
            record._sellerId,
            record.seller?.id,
            record.seller?._id,
            record.seller?.sellerId,
        ]
            .map(normalizeId)
            .filter(Boolean);
        if (candidateIds.length === 0) return true;
        return candidateIds.some((candidate) => identifiers.has(candidate));
    };

    const filterBySeller = (records = []) => {
        if (!Array.isArray(records) || sellerIdentifiers.size === 0) return records || [];
        return records.filter((record) => belongsToSeller(record, sellerIdentifiers));
    };

    const getDateRange = () => {
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        let startDate = new Date(todayStart);

        switch (timeRange) {
            case 'today':
                return { startDate: todayStart, endDate: today };
            case 'yesterday':
                const yest = new Date(todayStart);
                yest.setDate(yest.getDate() - 1);
                const yestEnd = new Date(yest);
                yestEnd.setHours(23, 59, 59, 999);
                return { startDate: yest, endDate: yestEnd };
            case '7d':
                startDate.setDate(today.getDate() - 7);
                break;
            case '30d':
                startDate.setDate(today.getDate() - 30);
                break;
            case 'month':
                startDate.setDate(1);
                break;
            case 'custom':
                const s = new Date(customDateRange.start);
                s.setHours(0, 0, 0, 0);
                const e = new Date(customDateRange.end);
                e.setHours(23, 59, 59, 999);
                return { startDate: s, endDate: e };
            default:
                return { startDate: todayStart, endDate: today };
        }

        return { startDate, endDate: today };
    };

    const { startDate, endDate } = getDateRange();

    const filteredOrders = useMemo(() => {
        return filterBySeller(state.orders || []).filter(order => {
            if (order.isDeleted) return false;
            const orderDate = new Date(order.createdAt || order.date || 0);
            const matchesDate = orderDate >= startDate && orderDate <= endDate;

            if (!matchesDate) return false;

            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                return (
                    (order.customerName || '').toLowerCase().includes(term) ||
                    (order.invoiceNumber || '').toLowerCase().includes(term) ||
                    (order.id || '').toLowerCase().includes(term)
                );
            }
            return true;
        });
    }, [state.orders, startDate, endDate, searchTerm]);

    const gstData = useMemo(() => {
        let totalTaxableValue = 0;
        let totalGstCollected = 0;
        const breakup = {
            '0': { taxable: 0, gst: 0 },
            '5': { taxable: 0, gst: 0 },
            '12': { taxable: 0, gst: 0 },
            '18': { taxable: 0, gst: 0 },
            '28': { taxable: 0, gst: 0 },
            'others': { taxable: 0, gst: 0 }
        };

        const b2bTransactions = [];

        filteredOrders.forEach(order => {
            const items = order.items || [];
            let orderTaxable = 0;
            let orderGst = 0;

            items.forEach(item => {
                const sellingPrice = Number(item.totalSellingPrice || item.sellingPrice || 0);
                const gstPercent = Number(item.gstPercent || 0);
                const gstAmount = Number(item.gstAmount || 0);
                const taxable = sellingPrice - gstAmount;

                orderTaxable += taxable;
                orderGst += gstAmount;

                const key = breakup[gstPercent.toString()] ? gstPercent.toString() : 'others';
                breakup[key].taxable += taxable;
                breakup[key].gst += gstAmount;
            });

            totalTaxableValue += orderTaxable;
            totalGstCollected += orderGst;

            // Check if B2B (Customer has GST number)
            const customer = state.customers?.find(c => c.id === order.customerId || c._id === order.customerId);
            if (customer?.gstNumber) {
                b2bTransactions.push({
                    date: order.createdAt,
                    invoiceNumber: order.invoiceNumber || order.id,
                    customerName: order.customerName,
                    customerGst: customer.gstNumber,
                    taxableValue: orderTaxable,
                    gstAmount: orderGst,
                    totalAmount: order.totalAmount || (orderTaxable + orderGst)
                });
            }
        });

        return {
            totalTaxableValue,
            totalGstCollected,
            cgst: totalGstCollected / 2,
            sgst: totalGstCollected / 2,
            breakup,
            b2bTransactions
        };
    }, [filteredOrders, state.customers]);

    const exportGstCSV = () => {
        const headers = ['Date', 'Invoice No', 'Customer Name', 'Customer GST', 'Taxable Value', 'GST Amount', 'Total Amount'];
        const rows = filteredOrders.map(order => {
            const customer = state.customers?.find(c => c.id === order.customerId || c._id === order.customerId);
            const items = order.items || [];
            const orderGst = items.reduce((sum, item) => sum + (Number(item.gstAmount) || 0), 0);
            const orderTaxable = (Number(order.totalAmount) || 0) - orderGst;

            return [
                formatDate(order.createdAt),
                order.invoiceNumber || order.id,
                order.customerName || 'Walk-in Customer',
                customer?.gstNumber || 'N/A',
                orderTaxable.toFixed(2),
                orderGst.toFixed(2),
                (order.totalAmount || 0).toFixed(2)
            ];
        });

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `GST_Report_${timeRange}_${formatDate(new Date())}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const exportGstPDF = () => {
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const margin = 15;
        let y = 20;

        pdf.setFontSize(18);
        pdf.setTextColor(47, 60, 126);
        pdf.text('GST FILING REPORT', margin, y);
        y += 10;

        pdf.setFontSize(10);
        pdf.setTextColor(100, 100, 100);
        pdf.text(`Store: ${state.storeName || 'Grocery Store'}`, margin, y);
        pdf.text(`Period: ${formatDate(startDate)} to ${formatDate(endDate)}`, pageWidth - margin, y, { align: 'right' });
        y += 15;

        // Summary Table
        pdf.setFillColor(248, 250, 252);
        pdf.rect(margin, y, pageWidth - margin * 2, 35, 'F');
        pdf.setTextColor(47, 60, 126);
        pdf.setFont('helvetica', 'bold');
        pdf.text('SUMMARY', margin + 5, y + 8);

        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(0, 0, 0);
        pdf.text(`Total Taxable Value:`, margin + 5, y + 18);
        pdf.text(`₹${gstData.totalTaxableValue.toFixed(2)}`, pageWidth - margin - 5, y + 18, { align: 'right' });

        pdf.text(`Total GST (CGST + SGST):`, margin + 5, y + 26);
        pdf.text(`₹${gstData.totalGstCollected.toFixed(2)}`, pageWidth - margin - 5, y + 26, { align: 'right' });

        y += 45;

        // Breakup Table
        pdf.setFont('helvetica', 'bold');
        pdf.text('GST BREAKUP BY PERCENTAGE', margin, y);
        y += 8;

        pdf.setFillColor(241, 245, 249);
        pdf.rect(margin, y, pageWidth - margin * 2, 8, 'F');
        pdf.setFontSize(9);
        pdf.text('GST %', margin + 5, y + 5);
        pdf.text('Taxable Value', margin + 60, y + 5);
        pdf.text('GST Amount', pageWidth - margin - 5, y + 5, { align: 'right' });
        y += 8;

        Object.entries(gstData.breakup).forEach(([rate, data]) => {
            if (data.taxable > 0) {
                pdf.setFont('helvetica', 'normal');
                pdf.text(`${rate}%`, margin + 5, y + 6);
                pdf.text(`₹${data.taxable.toFixed(2)}`, margin + 60, y + 6);
                pdf.text(`₹${data.gst.toFixed(2)}`, pageWidth - margin - 5, y + 6, { align: 'right' });
                y += 8;
            }
        });

        pdf.save(`GST_Report_${formatDate(new Date())}.pdf`);
    };

    return (
        <div className="min-h-screen pb-12">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                        <FileText className="h-7 w-7 text-indigo-600" />
                        {getTranslation('gstReports', state.currentLanguage)}
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                        Track your Goods and Services Tax collection and generate filing reports
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={exportGstCSV}
                        className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all font-medium text-sm"
                    >
                        <Download className="h-4 w-4" />
                        CSV
                    </button>
                    <button
                        onClick={exportGstPDF}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none transition-all font-medium text-sm"
                    >
                        <FileText className="h-4 w-4" />
                        PDF Report
                    </button>
                </div>
            </div>

            {/* Filters & Tools */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
                {/* Time Range Selector */}
                <div className="lg:col-span-3 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 text-slate-400 mr-2">
                        <Calendar className="h-4 w-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Period</span>
                    </div>
                    {[
                        { id: 'today', label: 'Today' },
                        { id: 'yesterday', label: 'Yesterday' },
                        { id: '7d', label: 'Last 7 Days' },
                        { id: '30d', label: 'Last 30 Days' },
                        { id: 'month', label: 'This Month' },
                        { id: 'custom', label: 'Custom Range' }
                    ].map(range => (
                        <button
                            key={range.id}
                            onClick={() => {
                                if (range.id === 'custom') setShowCustomDateModal(true);
                                else setTimeRange(range.id);
                            }}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${timeRange === range.id
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                                }`}
                        >
                            {range.label}
                        </button>
                    ))}
                </div>

                {/* Search */}
                <div className="relative h-full min-h-[60px]">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search invoice or customer..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full h-full pl-11 pr-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                    />
                </div>
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl">
                            <TrendingUp className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Taxable Value</p>
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
                                {formatCurrencySmart(gstData.totalTaxableValue, state.currencyFormat)}
                            </h3>
                        </div>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full w-full" />
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl">
                            <CreditCard className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total GST</p>
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
                                {formatCurrencySmart(gstData.totalGstCollected, state.currencyFormat)}
                            </h3>
                        </div>
                    </div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Collected on {filteredOrders.length} transactions
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl">
                            <PieChart className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">CGST (50%)</p>
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
                                {formatCurrencySmart(gstData.cgst, state.currencyFormat)}
                            </h3>
                        </div>
                    </div>
                    <p className="text-xs font-medium text-emerald-600">Central Tax</p>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-2xl">
                            <PieChart className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">SGST (50%)</p>
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
                                {formatCurrencySmart(gstData.sgst, state.currencyFormat)}
                            </h3>
                        </div>
                    </div>
                    <p className="text-xs font-medium text-amber-600">State Tax</p>
                </div>
            </div>

            {/* GST Breakup Table */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden h-fit">
                <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Filter className="h-5 w-5 text-indigo-500" />
                        GST Rate breakup
                    </h3>
                </div>
                <div className="p-6 space-y-4">
                    {Object.entries(gstData.breakup).map(([rate, data]) => (
                        <div key={rate} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-bold text-slate-600 dark:text-slate-400">{rate === 'others' ? 'Others' : `${rate}% GST`}</span>
                                <span className="text-sm font-bold text-slate-900 dark:text-white">{formatCurrencySmart(data.gst, state.currencyFormat)}</span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                <span>Taxable: {formatCurrencySmart(data.taxable, state.currencyFormat)}</span>
                                <span>{((data.gst / (gstData.totalGstCollected || 1)) * 100).toFixed(1)}% of total</span>
                            </div>
                            <div className="h-2 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-indigo-500 rounded-full transition-all duration-1000"
                                    style={{ width: `${(data.gst / (gstData.totalGstCollected || 1)) * 100}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Custom Date Range Modal */}
            {showCustomDateModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowCustomDateModal(false)} />
                    <div className="relative bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Custom Date Range</h3>
                            <button
                                onClick={() => setShowCustomDateModal(false)}
                                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                            >
                                <ChevronRight className="h-5 w-5 rotate-180" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Start Date</label>
                                <input
                                    type="date"
                                    value={tempCustomRange.start}
                                    onChange={(e) => setTempCustomRange(prev => ({ ...prev, start: e.target.value }))}
                                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-semibold"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">End Date</label>
                                <input
                                    type="date"
                                    value={tempCustomRange.end}
                                    onChange={(e) => setTempCustomRange(prev => ({ ...prev, end: e.target.value }))}
                                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-semibold"
                                />
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50 dark:bg-slate-900/50 flex gap-3">
                            <button
                                onClick={() => setShowCustomDateModal(false)}
                                className="flex-1 py-3 px-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 font-bold text-sm hover:bg-slate-100 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    setCustomDateRange(tempCustomRange);
                                    setTimeRange('custom');
                                    setShowCustomDateModal(false);
                                }}
                                className="flex-1 py-3 px-4 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                            >
                                Apply Range
                                <ArrowRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GstPage;

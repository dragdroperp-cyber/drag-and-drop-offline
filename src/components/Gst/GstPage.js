import React, { useState, useMemo } from 'react';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
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
    Filter,
    CalendarRange,
    XCircle,
    X
} from 'lucide-react';
import jsPDF from 'jspdf';
import { getTranslation } from '../../utils/translations';
import { addWatermarkToPDF } from '../../utils/pdfUtils';
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

    const exportGstPDF = async () => {
        try {
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const margin = 15;
            const contentWidth = pageWidth - margin * 2;

            const COLORS = {
                primary: [47, 60, 126], // #2F3C7E
                secondary: [236, 72, 153], // #EC4899 (Pink)
                success: [16, 185, 129], // #10B981
                gray: [100, 116, 139],
                lightBg: [248, 250, 252],
                border: [226, 232, 240],
                black: [15, 23, 42],
                white: [255, 255, 255]
            };

            const formatPDFCurrency = (val) => {
                return `Rs. ${Number(val || 0).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                })}`;
            };



            /* ================= HEADER ================= */
            const headerHeight = 50; // Increased to accommodate logo + details
            pdf.setFillColor(...COLORS.white);
            pdf.rect(0, 0, pageWidth, headerHeight, 'F');

            // Top Accent Bar
            pdf.setFillColor(...COLORS.primary);
            pdf.rect(0, 0, pageWidth, 2.5, 'F');

            /* -------- LOGO & APP BRANDING -------- */
            const logoX = margin;
            const logoY = 6;
            const logoSize = 18;

            try {
                const publicUrl = process.env.PUBLIC_URL || '';
                const logoUrl = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
                const res = await fetch(logoUrl);
                if (res.ok) {
                    const blob = await res.blob();
                    const base64 = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });
                    pdf.addImage(base64, 'PNG', logoX, logoY, logoSize, logoSize);
                }
            } catch (e) {
                console.warn('Logo could not be loaded for PDF:', e.message);
            }

            // Application Name (Modern Branding)
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(18);
            pdf.setTextColor(...COLORS.primary);
            pdf.text('Grocery studio', logoX + logoSize + 4, logoY + 9);

            pdf.setFontSize(7);
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(...COLORS.gray);
            pdf.text('Advanced Billing & Inventory Solution', logoX + logoSize + 4, logoY + 13);

            /* -------- SHOP INFO SECTION (Modern Box) -------- */
            const boxW = (pageWidth / 2) - margin;
            const boxY = logoY + 24;

            pdf.setFillColor(255, 255, 255);
            pdf.roundedRect(margin, boxY - 2, boxW + 8, 26, 2, 2, 'F');
            pdf.setDrawColor(...COLORS.border);
            pdf.setLineWidth(0.1);
            pdf.roundedRect(margin, boxY - 2, boxW + 8, 26, 2, 2, 'S');

            let currentDetailY = boxY + 4;
            const drawShopLine = (label, val) => {
                if (!val) return;
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(8);
                pdf.setTextColor(...COLORS.black);
                pdf.text(`${label}:`, margin + 4, currentDetailY);

                pdf.setFont('helvetica', 'bold'); // Bolder value
                pdf.setTextColor(...COLORS.black); // Darker color for value
                const displayVal = String(val).substring(0, 60);
                pdf.text(displayVal, margin + 25, currentDetailY);
                currentDetailY += 5;
            };

            drawShopLine('Shop Name', state.storeName || 'My Store');
            drawShopLine('Address', state.storeAddress);
            drawShopLine('Contact', state.storePhone);
            drawShopLine('GSTIN', state.storeGstin);

            // Report Meta (Right Side)
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(14);
            pdf.setTextColor(...COLORS.black);
            pdf.text('GST FILING REPORT', pageWidth - margin, 12, { align: 'right' });

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(9);
            pdf.setTextColor(...COLORS.gray);
            pdf.text(`Period: ${formatDate(startDate)} - ${formatDate(endDate)}`, pageWidth - margin, 18, { align: 'right' });
            pdf.text(`Generated: ${formatDateTime(new Date())}`, pageWidth - margin, 23, { align: 'right' });

            let y = headerHeight + 6;

            /* ================= SUMMARY CARDS ================= */
            const cardW = (contentWidth - 8) / 3;
            const cardH = 22;

            const summaryMetrics = [
                { label: 'TAXABLE VALUE', value: formatPDFCurrency(gstData.totalTaxableValue), color: COLORS.primary },
                { label: 'TOTAL GST', value: formatPDFCurrency(gstData.totalGstCollected), color: COLORS.secondary },
                { label: 'NET RECEIVABLE', value: formatPDFCurrency(gstData.totalTaxableValue + gstData.totalGstCollected), color: COLORS.success }
            ];

            summaryMetrics.forEach((m, i) => {
                const x = margin + i * (cardW + 4);

                // Premium Card (Shadowless approach for clean modern look)
                pdf.setFillColor(255, 255, 255);
                pdf.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'F');
                pdf.setDrawColor(...COLORS.border);
                pdf.setLineWidth(0.1);
                pdf.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'S');

                pdf.setFontSize(7.5);
                pdf.setFont('helvetica', 'bold');
                pdf.setTextColor(...COLORS.gray);
                pdf.text(m.label, x + 6, y + 8);

                pdf.setFontSize(14); // Increased font size
                pdf.setFont('helvetica', 'bold'); // Ensure bold
                pdf.setTextColor(...COLORS.black);
                pdf.text(m.value, x + 6, y + 16);
            });

            y += cardH + 15;

            /* ================= GST RATE BREAKUP ================= */
            pdf.setFontSize(10.5);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(...COLORS.black);
            pdf.text('GST RATE BREAKUP', margin, y);
            y += 6.5; // More padding before header

            const breakCols = [contentWidth * 0.3, contentWidth * 0.4, contentWidth * 0.3];
            const breakHeaders = ['GST RATE', 'TAXABLE VALUE', 'GST AMOUNT'];

            // Table Header Bordered
            pdf.setFillColor(245, 247, 255);
            pdf.roundedRect(margin, y, contentWidth, 10, 2, 2, 'F');
            pdf.setTextColor(...COLORS.primary);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(9.5);

            breakHeaders.forEach((h, i) => {
                const x = margin + breakCols.slice(0, i).reduce((a, b) => a + b, 0);
                pdf.text(h, x + 4, y + 6.5);
            });
            y += 10;

            // Table Rows
            const visibleRates = Object.entries(gstData.breakup).filter(([_, data]) => data.taxable > 0);

            if (visibleRates.length === 0) {
                pdf.setTextColor(...COLORS.gray);
                pdf.text('No GST data for this period', margin + contentWidth / 2, y + 8, { align: 'center' });
                y += 12;
            } else {
                visibleRates.forEach(([rate, data], idx) => {
                    const rowH = 10;
                    if (idx % 2 === 1) {
                        pdf.setFillColor(252, 253, 255);
                        pdf.rect(margin, y, contentWidth, rowH, 'F');
                    }

                    pdf.setTextColor(...COLORS.black);
                    pdf.setFont('helvetica', 'bold'); // Bolder row data
                    const x0 = margin;
                    const x1 = margin + breakCols[0];
                    const x2 = margin + breakCols[0] + breakCols[1];

                    pdf.text(rate === 'others' ? 'Others' : `${rate}%`, x0 + 4, y + 6.5);
                    pdf.text(formatPDFCurrency(data.taxable), x1 + 4, y + 6.5);
                    pdf.text(formatPDFCurrency(data.gst), x2 + 4, y + 6.5);

                    y += rowH;
                });

                // Add Total row for Breakup
                pdf.setDrawColor(...COLORS.black);
                pdf.setLineWidth(0.2);
                pdf.line(margin, y, margin + contentWidth, y);
                pdf.setFont('helvetica', 'bold');
                pdf.setTextColor(...COLORS.black);
                pdf.text('Net Total', margin + 4, y + 7.5);
                pdf.text(formatPDFCurrency(gstData.totalTaxableValue), margin + breakCols[0] + 4, y + 7.5);
                pdf.text(formatPDFCurrency(gstData.totalGstCollected), margin + breakCols[0] + breakCols[1] + 4, y + 7.5);
                y += 12;
            }

            y += 12;

            /* ================= B2B TRANSACTIONS ================= */
            if (gstData.b2bTransactions && gstData.b2bTransactions.length > 0) {
                // Check if we need a new page
                if (y > pageHeight - 40) {
                    pdf.addPage();
                    y = 20;
                }

                pdf.setFontSize(10);
                pdf.setFont('helvetica', 'bold');
                pdf.setTextColor(...COLORS.black);
                pdf.text('B2B TRANSACTIONS (GSTIN HOLDERS)', margin, y);
                y += 6;

                const b2bCols = [contentWidth * 0.15, contentWidth * 0.25, contentWidth * 0.2, contentWidth * 0.2, contentWidth * 0.2];
                const b2bHeaders = ['DATE', 'INVOICE NO', 'GSTIN', 'TAXABLE', 'GST AMT'];

                pdf.setFillColor(245, 247, 255);
                pdf.roundedRect(margin, y, contentWidth, 10, 2, 2, 'F');
                pdf.setTextColor(...COLORS.primary);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(8.5);

                b2bHeaders.forEach((h, i) => {
                    const x = margin + b2bCols.slice(0, i).reduce((a, b) => a + b, 0);
                    pdf.text(h, x + 3, y + 6.5);
                });
                y += 11;

                gstData.b2bTransactions.forEach((tx, idx) => {
                    if (y > pageHeight - 20) {
                        pdf.addPage();
                        y = 20;
                        // Repeat Header
                        pdf.setFillColor(...COLORS.primary);
                        pdf.rect(margin, y, contentWidth, 9, 'F');
                        pdf.setTextColor(...COLORS.white);
                        b2bHeaders.forEach((h, i) => {
                            const x = margin + b2bCols.slice(0, i).reduce((a, b) => a + b, 0);
                            pdf.text(h, x + 3, y + 6);
                        });
                        y += 9;
                    }

                    if (idx % 2 === 1) {
                        pdf.setFillColor(252, 252, 254);
                        pdf.rect(margin, y, contentWidth, 8, 'F');
                    }

                    pdf.setTextColor(...COLORS.black);
                    pdf.setFont('helvetica', 'normal');

                    const xs = b2bCols.reduce((acc, current, i) => {
                        acc.push(margin + b2bCols.slice(0, i).reduce((a, b) => a + b, 0));
                        return acc;
                    }, []);

                    pdf.setFont('helvetica', 'bold'); // Bolder B2B row data
                    pdf.text(formatDate(tx.date), xs[0] + 3, y + 5.5);
                    pdf.text(tx.invoiceNumber?.toString() || '', xs[1] + 3, y + 5.5);
                    pdf.text(tx.customerGst || '', xs[2] + 3, y + 5.5);
                    pdf.text(formatPDFCurrency(tx.taxableValue), xs[3] + 3, y + 5.5);
                    pdf.text(formatPDFCurrency(tx.gstAmount), xs[4] + 3, y + 5.5);

                    y += 8;
                });
            }

            /* ================= FOOTER ================= */
            const pageCount = pdf.internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                pdf.setPage(i);
                pdf.setFontSize(8);
                pdf.setTextColor(...COLORS.gray);
                pdf.text(`Page ${i} of ${pageCount}`, margin, pageHeight - 10);
                pdf.text(`${state.storeName || 'Store'} - GST Compliance Report`, pageWidth - margin, pageHeight - 10, { align: 'right' });
            }

            // Add watermark
            await addWatermarkToPDF(pdf);

            pdf.save(`GST_Report_${formatDate(new Date()).replace(/\//g, '-')}.pdf`);
            if (window.showToast) window.showToast('GST PDF Report generated', 'success');
        } catch (error) {
            console.error('PDF Export Error:', error);
            if (window.showToast) window.showToast('Failed to generate PDF', 'error');
        }
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

            {/* Custom Date Modal */}
            {
                showCustomDateModal && (
                    <div className="fixed inset-0 z-[1400] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
                        <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-slideUp">
                            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
                                <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
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
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Start Date</label>
                                    <input
                                        type="date"
                                        value={tempCustomRange.start}
                                        onChange={(e) => setTempCustomRange(prev => ({ ...prev, start: e.target.value }))}
                                        className="w-full px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">End Date</label>
                                    <input
                                        type="date"
                                        value={tempCustomRange.end}
                                        onChange={(e) => setTempCustomRange(prev => ({ ...prev, end: e.target.value }))}
                                        className="w-full px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                                    />
                                </div>

                                <div className="pt-2 flex flex-col gap-2">
                                    <button
                                        onClick={() => {
                                            setCustomDateRange(tempCustomRange);
                                            setTimeRange('custom');
                                            setShowCustomDateModal(false);
                                        }}
                                        className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 font-bold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
                                    >
                                        Apply Range
                                        <ArrowRight className="h-4 w-4" />
                                    </button>
                                    <button
                                        onClick={() => setShowCustomDateModal(false)}
                                        className="w-full py-3 text-gray-500 hover:text-gray-700 font-medium transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div>
    );
};

export default GstPage;

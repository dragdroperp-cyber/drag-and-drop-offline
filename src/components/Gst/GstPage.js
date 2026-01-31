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
    CheckCircle,
    AlertCircle,
    ChevronRight,
    Filter,
    CalendarRange,
    XCircle,
    X,
    BookOpen
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
    const [saleMode, setSaleMode] = useState('normal'); // 'normal' | 'direct'
    const [searchTerm, setSearchTerm] = useState('');
    const [showRulesModal, setShowRulesModal] = useState(false);
    const [rulesTab, setRulesTab] = useState('rates'); // rates, registration, filing, composition

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
        return filterBySeller(state.orders || [])
            .filter(order => {
                if (order.isDeleted) return false;

                // GST reports only include finalized sales. 
                // Exclude online orders that are not 'Delivered'.
                if (order.orderSource === 'online' && order.orderStatus !== 'Delivered') {
                    return false;
                }

                // Also exclude Cancelled or Pending orders generally
                const status = (order.orderStatus || order.status || '').toLowerCase();
                if (status === 'cancelled' || status === 'pending') return false;

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
            })
            .map(order => {
                if (!order.items || !Array.isArray(order.items)) return null;

                const orderIdStr = normalizeId(order._id || order.id);
                const orderRefunds = (state.refunds || []).filter(r => normalizeId(r.orderId) === orderIdStr);

                // Identify and subtract refunded items
                const netItems = order.items.map(item => {
                    const iPid = normalizeId(item.productId || item.product_id || item._id || item.id);
                    let refundedQty = 0;

                    orderRefunds.forEach(r => {
                        (r.items || []).forEach(ri => {
                            const riPid = normalizeId(ri.productId || ri.product_id || ri._id || ri.id);
                            const namesMatch = item.name && ri.name &&
                                item.name.trim().toLowerCase() === ri.name.trim().toLowerCase();
                            const isDP = item.isDProduct === true || String(item.isDProduct) === 'true' ||
                                ri.isDProduct === true || String(ri.isDProduct) === 'true';

                            if ((iPid === riPid && iPid) || (namesMatch && isDP)) {
                                refundedQty += Number(ri.qty || 0);
                            }
                        });
                    });

                    const originalQty = Number(item.quantity || item.qty || 1);
                    const netQty = Math.max(0, originalQty - refundedQty);

                    if (netQty <= 0) return null;

                    const originalItemTotal = Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0);
                    const unitPrice = originalQty > 0 ? (originalItemTotal / originalQty) : originalItemTotal;

                    return {
                        ...item,
                        quantity: netQty,
                        totalSellingPrice: netQty * unitPrice
                    };
                }).filter(Boolean);

                if (netItems.length === 0) return null;

                // Collective sums for the net order
                const originalItemsSum = order.items.reduce((sum, item) => sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0), 0);
                const netItemsSum = netItems.reduce((sum, item) => sum + item.totalSellingPrice, 0);

                const originalGrandTotal = Number(order.totalAmount || order.total || 0);
                const totalOrderRefundAmount = orderRefunds.reduce((sum, r) => sum + Number(r.totalRefundAmount || r.amount || 0), 0);
                const netGrandTotal = Math.max(0, originalGrandTotal - totalOrderRefundAmount);

                const proportionalFactor = originalItemsSum > 0 ? (netItemsSum / originalItemsSum) : 0;

                const correctedItems = netItems.map(item => {
                    const itemRatio = netItemsSum > 0 ? (item.totalSellingPrice / netItemsSum) : 0;

                    // The "Full Value" of this net item including its share of delivery charges and discounts
                    const itemFullValue = itemRatio * netGrandTotal;

                    const gstPercent = Number(item.gstPercent || 0);
                    // Professional GST inclusive calculation: Base = Gross / (1 + Rate/100)
                    const itemTaxable = itemFullValue / (1 + (gstPercent / 100));
                    const itemGstAmount = itemFullValue - itemTaxable;

                    return {
                        ...item,
                        totalSellingPrice: itemFullValue,
                        gstAmount: itemGstAmount,
                        taxableValue: itemTaxable
                    };
                });

                return {
                    ...order,
                    items: correctedItems,
                    totalAmount: netGrandTotal,
                    totalTaxable: correctedItems.reduce((sum, i) => sum + i.taxableValue, 0),
                    totalGst: correctedItems.reduce((sum, i) => sum + i.gstAmount, 0)
                };
            })
            .filter(Boolean);
    }, [state.orders, state.refunds, startDate, endDate, searchTerm]);

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

            items.forEach(item => {
                const taxable = Number(item.taxableValue || 0);
                const gstAmount = Number(item.gstAmount || 0);
                const gstPercent = Number(item.gstPercent || 0);

                const key = breakup[gstPercent.toString()] ? gstPercent.toString() : 'others';
                breakup[key].taxable += taxable;
                breakup[key].gst += gstAmount;
            });

            totalTaxableValue += (order.totalTaxable || 0);
            totalGstCollected += (order.totalGst || 0);

            // Check if B2B (Customer has GST number)
            const customer = state.customers?.find(c => c.id === order.customerId || c._id === order.customerId);
            if (customer?.gstNumber) {
                b2bTransactions.push({
                    date: order.createdAt,
                    invoiceNumber: order.invoiceNumber || order.id,
                    customerName: order.customerName,
                    customerGst: customer.gstNumber,
                    taxableValue: order.totalTaxable || 0,
                    gstAmount: order.totalGst || 0,
                    totalAmount: order.totalAmount || ((order.totalTaxable || 0) + (order.totalGst || 0))
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
            const orderGst = order.totalGst || 0;
            const orderTaxable = order.totalTaxable || 0;

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

            const publicUrl = process.env.PUBLIC_URL || '';
            const defaultLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
            const sellerLogo = state.storeLogo || state.currentUser?.logoUrl;
            const logoUrl = sellerLogo || defaultLogo;

            try {
                const loadImage = (src) => new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = 'Anonymous';
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        resolve(canvas.toDataURL('image/png'));
                    };
                    img.onerror = reject;
                    img.src = src;
                });

                let logoBase64;
                try {
                    logoBase64 = await loadImage(logoUrl);
                } catch (e) {
                    if (logoUrl !== defaultLogo) {
                        logoBase64 = await loadImage(defaultLogo);
                    }
                }

                if (logoBase64) {
                    pdf.addImage(logoBase64, 'PNG', logoX, logoY, logoSize, logoSize);
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
            // Powered By Logo Logic
            let gsLogoBase64 = null;
            try {
                const publicUrl = process.env.PUBLIC_URL || '';
                const gsLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
                const gsLogoRes = await fetch(gsLogo).catch(() => null);
                if (gsLogoRes && gsLogoRes.ok) {
                    const blob = await gsLogoRes.blob();
                    gsLogoBase64 = await new Promise(r => {
                        const reader = new FileReader();
                        reader.onloadend = () => r(reader.result);
                        reader.readAsDataURL(blob);
                    });
                }
            } catch (e) { }

            const pageCount = pdf.internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                pdf.setPage(i);
                pdf.setFontSize(8);
                pdf.setTextColor(...COLORS.gray);
                if (pageCount > 1) {
                    pdf.text(`Page ${i} of ${pageCount}`, margin, pageHeight - 10);
                }

                // Powered By Branding
                if (gsLogoBase64) {
                    const gsY = pageHeight - 7;
                    const centerX = pageWidth / 2;
                    pdf.setFontSize(6);
                    pdf.setTextColor(160, 160, 160);
                    pdf.setFont('helvetica', 'normal');
                    pdf.text('Powered by ', centerX - 5, gsY, { align: 'right' });
                    pdf.addImage(gsLogoBase64, 'PNG', centerX - 4.2, gsY - 2.8, 3.5, 3.5);
                    pdf.setFont('helvetica', 'bold');
                    pdf.text('Grocery Studio', centerX + 0.5, gsY, { align: 'left' });
                }

                pdf.setFontSize(8);
                pdf.setTextColor(...COLORS.gray);
                pdf.setFont('helvetica', 'normal');
                pdf.text(`${state.storeName || 'Store'} - GST Compliance Report`, pageWidth - margin, pageHeight - 10, { align: 'right' });
            }

            // Add watermark
            await addWatermarkToPDF(pdf, sellerLogo || undefined);

            pdf.save(`GST_Report_${formatDate(new Date()).replace(/\//g, '-')}.pdf`);
            if (window.showToast) window.showToast('GST PDF Report generated', 'success');
        } catch (error) {
            console.error('PDF Export Error:', error);
            if (window.showToast) window.showToast('Failed to generate PDF', 'error');
        }
    };

    return (
        <div className="min-h-screen pb-12 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 mb-8">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl">
                        <FileText className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                            {getTranslation('gstReports', state.currentLanguage)}
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
                            GST filing reports & collections
                        </p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={() => setShowRulesModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-white/80 dark:bg-slate-800/80 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-indigo-600 dark:text-indigo-400 font-bold text-xs uppercase tracking-wider shadow-sm transition-all"
                    >
                        <BookOpen className="h-4 w-4" />
                        GST Rules & Info
                    </button>
                    <div className="flex items-center gap-2 p-1 bg-white/80 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm backdrop-blur-sm">
                        <button
                            onClick={exportGstCSV}
                            className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300 transition-all font-bold text-xs uppercase tracking-wider"
                        >
                            <Download className="h-4 w-4" />
                            CSV
                        </button>
                        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
                        <button
                            onClick={exportGstPDF}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all font-bold text-xs uppercase tracking-wider"
                        >
                            <FileText className="h-4 w-4" />
                            PDF Report
                        </button>
                    </div>
                </div>
            </div>

            {/* Filters & Search */}
            <div className="flex flex-col lg:flex-row items-center gap-4 mb-8">
                {/* Time Range Selector */}
                <div className="w-full lg:flex-1 flex flex-wrap items-center justify-center lg:justify-start gap-1 p-1 bg-white/80 dark:bg-slate-800/80 rounded-2xl sm:rounded-full border border-slate-200 dark:border-slate-700 shadow-sm backdrop-blur-sm overflow-x-auto no-scrollbar">
                    {[
                        { id: 'today', label: 'Today' },
                        { id: 'yesterday', label: 'Yesterday' },
                        { id: '7d', label: '7 Days' },
                        { id: '30d', label: '30 Days' },
                        { id: 'month', label: 'Month' },
                        { id: 'custom', label: 'Custom' }
                    ].map(range => (
                        <button
                            key={range.id}
                            onClick={() => {
                                if (range.id === 'custom') setShowCustomDateModal(true);
                                else setTimeRange(range.id);
                            }}
                            className={`px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${timeRange === range.id
                                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md scale-[1.02]'
                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
                                }`}
                        >
                            {range.label}
                        </button>
                    ))}
                </div>

                {/* Search */}
                <div className="w-full lg:w-80 relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                    <input
                        type="text"
                        placeholder="Search invoice or customer..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-sm font-medium"
                    />
                </div>
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-8">
                {[
                    { label: 'Taxable Value', value: gstData.totalTaxableValue, icon: TrendingUp, color: 'indigo', description: 'Total Base Amount' },
                    { label: 'Total GST', value: gstData.totalGstCollected, icon: CreditCard, color: 'amber', description: `${filteredOrders.length} Transactions` },
                    { label: 'CGST (50%)', value: gstData.cgst, icon: PieChart, color: 'emerald', description: 'Central Tax Collection' },
                    { label: 'SGST (50%)', value: gstData.sgst, icon: PieChart, color: 'emerald', description: 'State Tax Collection' }
                ].map((stat, i) => {
                    const getColorClasses = (c) => {
                        switch (c) {
                            case 'indigo': return 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800';
                            case 'amber': return 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800';
                            case 'emerald': return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
                            default: return 'bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-600';
                        }
                    };

                    const getTextClass = (c) => {
                        if (c === 'emerald') return 'text-emerald-600 dark:text-emerald-400';
                        if (c === 'amber') return 'text-amber-600 dark:text-amber-400';
                        return 'text-slate-900 dark:text-white';
                    };

                    const Icon = stat.icon;

                    return (
                        <div key={i} className="relative bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 transition-all hover:shadow-md">
                            {/* Icon Top Right */}
                            <div className={`absolute top-4 right-4 p-2.5 rounded-xl border ${getColorClasses(stat.color)}`}>
                                <Icon className="h-5 w-5" />
                            </div>

                            <div className="mt-2">
                                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{stat.label}</p>
                                <p className={`text-2xl font-bold whitespace-nowrap overflow-x-auto scrollbar-hide ${getTextClass(stat.color)}`}>
                                    {formatCurrencySmart(stat.value, state.currencyFormat)}
                                </p>
                            </div>

                            <div className="mt-2 text-xs text-gray-500 dark:text-slate-500">
                                {stat.description}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* GST Breakup Table */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-lg overflow-hidden h-fit mb-8">
                <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
                    <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-3 uppercase tracking-tight italic">
                        <Filter className="h-5 w-5 text-indigo-500" />
                        GST Rate Breakup Analysis
                    </h3>
                </div>
                <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {Object.entries(gstData.breakup).filter(([_, data]) => data.taxable > 0 || data.gst > 0).map(([rate, data]) => (
                        <div key={rate} className="flex flex-col gap-3 group">
                            <div className="flex items-end justify-between">
                                <div>
                                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">{rate === 'others' ? 'Other Rates' : `${rate}% Rate`}</span>
                                    <span className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                                        {formatCurrencySmart(data.gst, state.currencyFormat)}
                                    </span>
                                </div>
                                <div className="text-right">
                                    <span className="text-[10px] bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-lg font-black uppercase">
                                        {((data.gst / (gstData.totalGstCollected || 1)) * 100).toFixed(1)}% Share
                                    </span>
                                </div>
                            </div>

                            <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden shadow-inner">
                                <div
                                    className="h-full bg-indigo-600 rounded-full transition-all duration-1000 group-hover:bg-indigo-500 shadow-lg"
                                    style={{ width: `${(data.gst / (gstData.totalGstCollected || 1)) * 100}%` }}
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Taxable Value</span>
                                <span className="text-[11px] font-black text-slate-700 dark:text-slate-300">{formatCurrencySmart(data.taxable, state.currencyFormat)}</span>
                            </div>
                        </div>
                    ))}
                    {Object.entries(gstData.breakup).filter(([_, data]) => data.taxable > 0 || data.gst > 0).length === 0 && (
                        <div className="col-span-full py-12 flex flex-col items-center justify-center text-center opacity-50 italic">
                            <TableIcon className="w-12 h-12 mb-3 text-slate-300" />
                            <p className="text-slate-500">No GST collection data available for the selected period.</p>
                        </div>
                    )}
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

                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
            {/* GST Rules Modal */}
            {showRulesModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={() => setShowRulesModal(false)}>
                    <div className="bg-white dark:bg-slate-900 w-full sm:max-w-4xl h-full sm:h-[90vh] rounded-none sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-slideUp" onClick={e => e.stopPropagation()}>
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-indigo-100 dark:bg-indigo-900/40 rounded-xl">
                                    <BookOpen className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">GST Rules & Guide</h2>
                                    <p className="text-xs sm:text-sm text-slate-500 font-medium">Simplified explanation of Goods & Services Tax</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowRulesModal(false)}
                                className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors"
                            >
                                <X className="h-6 w-6" />
                            </button>
                        </div>

                        {/* Modal Tabs */}
                        <div className="flex items-center gap-2 p-2 mx-4 sm:mx-6 mt-4 bg-gray-100/50 dark:bg-slate-800/50 rounded-xl overflow-x-auto no-scrollbar shrink-0">
                            {[
                                { id: 'rates', label: 'Tax Rates' },
                                { id: 'registration', label: 'Registration' },
                                { id: 'components', label: 'CGST/SGST/IGST' },
                                { id: 'filing', label: 'Returns & Filing' },
                                { id: 'composition', label: 'Composition Scheme' }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setRulesTab(tab.id)}
                                    className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 ${rulesTab === tab.id
                                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-700/50'
                                        }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Modal Content */}
                        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
                            {rulesTab === 'rates' && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 p-6 rounded-2xl border border-indigo-100 dark:border-indigo-900/30">
                                        <h3 className="text-lg font-bold text-indigo-900 dark:text-white mb-2">GST Tax Rate Slabs</h3>
                                        <p className="text-indigo-700 dark:text-indigo-300">Goods and services are divided into five different tax slabs for collection of tax: 0%, 5%, 12%, 18% and 28%.</p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="p-5 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-700 dark:text-green-400 font-bold">0%</div>
                                                <h4 className="font-bold text-slate-900 dark:text-white">Exempted Goods</h4>
                                            </div>
                                            <ul className="list-disc leading-relaxed pl-5 space-y-1 text-slate-600 dark:text-slate-400 text-sm">
                                                <li>Food grains, cereals, milk, curd</li>
                                                <li>Fruits, vegetables, salt, fresh meat</li>
                                                <li>Newspapers, books, journals</li>
                                                <li>Services like hotels charge less than ₹1000/night</li>
                                            </ul>
                                        </div>

                                        <div className="p-5 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold">5%</div>
                                                <h4 className="font-bold text-slate-900 dark:text-white">Common Items</h4>
                                            </div>
                                            <ul className="list-disc leading-relaxed pl-5 space-y-1 text-slate-600 dark:text-slate-400 text-sm">
                                                <li>Sugar, spices, tea, coffee, edible oil</li>
                                                <li>Life-saving drugs, medical supplies</li>
                                                <li>Sweets, packaged food items</li>
                                                <li>Transport services (Railways, Air economy)</li>
                                            </ul>
                                        </div>

                                        <div className="p-5 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-700 dark:text-orange-400 font-bold">12%</div>
                                                <h4 className="font-bold text-slate-900 dark:text-white">Standard Rate I</h4>
                                            </div>
                                            <ul className="list-disc leading-relaxed pl-5 space-y-1 text-slate-600 dark:text-slate-400 text-sm">
                                                <li>Processed food, butter, cheese, ghee</li>
                                                <li>Mobiles, computers, umbrellas</li>
                                                <li>Apparel above ₹1000</li>
                                                <li>Business class air tickets</li>
                                            </ul>
                                        </div>

                                        <div className="p-5 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-700 dark:text-purple-400 font-bold">18%</div>
                                                <h4 className="font-bold text-slate-900 dark:text-white">Standard Rate II</h4>
                                            </div>
                                            <ul className="list-disc leading-relaxed pl-5 space-y-1 text-slate-600 dark:text-slate-400 text-sm">
                                                <li>Most manufactured goods, footwear &gt; ₹500</li>
                                                <li>Soaps, toothpaste, hair oil, pasta</li>
                                                <li>Capital goods, industrial intermediaries</li>
                                                <li>IT services, telecom, financial services</li>
                                            </ul>
                                        </div>

                                        <div className="p-5 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors col-span-1 md:col-span-2">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-700 dark:text-red-400 font-bold">28%</div>
                                                <h4 className="font-bold text-slate-900 dark:text-white">Luxury & Sin Goods</h4>
                                            </div>
                                            <ul className="list-disc leading-relaxed pl-5 space-y-1 text-slate-600 dark:text-slate-400 text-sm columns-1 md:columns-2 gap-8">
                                                <li>Luxury cars, motorcycles</li>
                                                <li>Air conditioners, refrigerators, washing machines</li>
                                                <li>Cigarettes, aerated drinks, pan masala</li>
                                                <li>High-end electronic items</li>
                                                <li>Cement, paints, varnishes</li>
                                                <li>Betting, gambling, lottery</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {rulesTab === 'registration' && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">When is GST Registration Mandatory?</h3>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-2xl">
                                            <h4 className="font-bold text-slate-900 dark:text-white mb-2">Turnover Threshold (Goods)</h4>
                                            <div className="text-3xl font-black text-indigo-600 dark:text-indigo-400 mb-2">₹40 Lakhs</div>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                                Businesses supplying goods with annual turnover exceeding ₹40 Lakhs (₹20 Lakhs for hilly/NE states) must register.
                                            </p>
                                        </div>
                                        <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-2xl">
                                            <h4 className="font-bold text-slate-900 dark:text-white mb-2">Turnover Threshold (Services)</h4>
                                            <div className="text-3xl font-black text-blue-600 dark:text-blue-400 mb-2">₹20 Lakhs</div>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                                Service providers with annual turnover exceeding ₹20 Lakhs (₹10 Lakhs for hilly/NE states) must register.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="border-t border-gray-100 dark:border-slate-800 pt-6">
                                        <h4 className="font-bold text-slate-900 dark:text-white mb-4">Mandatory Registration Case</h4>
                                        <ul className="space-y-3">
                                            {[
                                                'Inter-state supply of goods (Supplying to another state)',
                                                'Casual taxable persons & Non-Resident taxable persons',
                                                'E-commerce operators & sellers on e-commerce platforms',
                                                'Persons liable to pay tax under Reverse Charge Mechanism (RCM)',
                                                'Input Service Distributors & Agents of a supplier'
                                            ].map((item, i) => (
                                                <li key={i} className="flex items-start gap-3">
                                                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                                                    <span className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">{item}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-xl border border-yellow-100 dark:border-yellow-900/30">
                                        <h5 className="font-bold text-yellow-800 dark:text-yellow-400 mb-1">Documents Required</h5>
                                        <p className="text-xs text-yellow-700 dark:text-yellow-300/80">
                                            PAN Card, Aadhaar Card, Business Address Proof (Electricity bill/Rent agreement), Bank Account Canceled Cheque/Passbook, Photo of Owner/Partners.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {rulesTab === 'components' && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                                        India follows a dual GST model where both Central and State governments levy tax on supplies.
                                    </p>

                                    <div className="space-y-4">
                                        <div className="flex gap-4 p-5 border border-slate-200 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-800">
                                            <div className="w-16 h-16 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center font-black text-xl text-orange-600 dark:text-orange-400 shrink-0">CGST</div>
                                            <div>
                                                <h4 className="font-bold text-slate-900 dark:text-white text-lg">Central Goods & Services Tax</h4>
                                                <p className="text-sm font-medium text-slate-500 mb-2">Collected by Central Government</p>
                                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                                    Applicable on <span className="font-bold">Intra-state</span> supplies (within the same state). Replaces earlier central taxes like Service Tax, Excise Duty, CST.
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex gap-4 p-5 border border-slate-200 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-800">
                                            <div className="w-16 h-16 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center font-black text-xl text-green-600 dark:text-green-400 shrink-0">SGST</div>
                                            <div>
                                                <h4 className="font-bold text-slate-900 dark:text-white text-lg">State Goods & Services Tax</h4>
                                                <p className="text-sm font-medium text-slate-500 mb-2">Collected by State Government</p>
                                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                                    Applicable on <span className="font-bold">Intra-state</span> supplies. Replaces earlier state taxes like VAT, Entertainment Tax, Luxury Tax.
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex gap-4 p-5 border border-slate-200 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-800">
                                            <div className="w-16 h-16 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center font-black text-xl text-blue-600 dark:text-blue-400 shrink-0">IGST</div>
                                            <div>
                                                <h4 className="font-bold text-slate-900 dark:text-white text-lg">Integrated Goods & Services Tax</h4>
                                                <p className="text-sm font-medium text-slate-500 mb-2">Collected by Central Govt (shared with State)</p>
                                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                                    Applicable on <span className="font-bold">Inter-state</span> supplies (between two different states) and Imports.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-center">
                                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Example: Selling an item worth ₹1000 with 18% GST</p>
                                        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-3">
                                            <div className="bg-white dark:bg-slate-700 px-4 py-2 rounded-lg shadow-sm">
                                                <span className="block text-xs text-slate-400 uppercase">Within State</span>
                                                <span className="font-mono font-bold text-slate-900 dark:text-white">CGST (9%) + SGST (9%)</span>
                                            </div>
                                            <div className="bg-white dark:bg-slate-700 px-4 py-2 rounded-lg shadow-sm">
                                                <span className="block text-xs text-slate-400 uppercase">Other State</span>
                                                <span className="font-mono font-bold text-slate-900 dark:text-white">IGST (18%)</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {rulesTab === 'filing' && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Key GST Returns</h3>

                                    <div className="overflow-hidden border border-slate-200 dark:border-slate-700 rounded-2xl">
                                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                                            <thead className="bg-gray-50 dark:bg-slate-800">
                                                <tr>
                                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Return</th>
                                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Details</th>
                                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Frequency</th>
                                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Due Date</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                                                <tr>
                                                    <td className="px-4 py-4 font-bold text-slate-900 dark:text-white">GSTR-1</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">Details of Outward Supplies (Sales)</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">Monthly / Quarterly*</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">11th (Monthly) / 13th (QRMP)</td>
                                                </tr>
                                                <tr>
                                                    <td className="px-4 py-4 font-bold text-slate-900 dark:text-white">GSTR-3B</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">Summary Return & Tax Payment</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">Monthly / Quarterly*</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">20th (Monthly) / 22nd-24th (QRMP)</td>
                                                </tr>
                                                <tr>
                                                    <td className="px-4 py-4 font-bold text-slate-900 dark:text-white">GSTR-9</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">Annual Return</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">Annually</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">31st December of next FY</td>
                                                </tr>
                                                <tr>
                                                    <td className="px-4 py-4 font-bold text-slate-900 dark:text-white">GSTR-4</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">Return for Composition Dealers</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">Annually</td>
                                                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">30th April of next FY</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="text-xs text-slate-400 italic mt-2">* QRMP (Quarterly Return Monthly Payment) scheme available for turnover up to ₹5 Cr.</p>
                                </div>
                            )}

                            {rulesTab === 'composition' && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <div className="bg-emerald-50 dark:bg-emerald-900/20 p-6 rounded-2xl border border-emerald-100 dark:border-emerald-900/30">
                                        <h3 className="text-lg font-bold text-emerald-900 dark:text-white mb-2">Composition Scheme</h3>
                                        <p className="text-emerald-700 dark:text-emerald-300">A simple and easy scheme for small taxpayers to lower compliance burden. They pay tax at a lower fixed rate on turnover.</p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <h4 className="font-bold text-slate-900 dark:text-white mb-4">Eligibility & Features</h4>
                                            <ul className="space-y-3">
                                                <li className="flex items-start gap-3">
                                                    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                                                    <span className="text-sm text-slate-600 dark:text-slate-300">Turnover up to ₹1.5 Crore (₹75 Lakhs for special states)</span>
                                                </li>
                                                <li className="flex items-start gap-3">
                                                    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                                                    <span className="text-sm text-slate-600 dark:text-slate-300">Quarterly return filing (CMP-08)</span>
                                                </li>
                                                <li className="flex items-start gap-3">
                                                    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                                                    <span className="text-sm text-slate-600 dark:text-slate-300">Cannot issue Tax Invoice (Cannot charge GST from customer)</span>
                                                </li>
                                                <li className="flex items-start gap-3">
                                                    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                                                    <span className="text-sm text-slate-600 dark:text-slate-300">Cannot claim Input Tax Credit (ITC)</span>
                                                </li>
                                            </ul>
                                        </div>

                                        <div>
                                            <h4 className="font-bold text-slate-900 dark:text-white mb-4">Tax Rates (on Turnover)</h4>
                                            <div className="space-y-3">
                                                <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                                                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Manufacturers & Traders</span>
                                                    <span className="font-black text-slate-900 dark:text-white">1%</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                                                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Restaurants (No Alcohol)</span>
                                                    <span className="font-black text-slate-900 dark:text-white">5%</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                                                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Service Providers</span>
                                                    <span className="font-black text-slate-900 dark:text-white">6%</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer with Robust Legal Disclaimer */}
                        <div className="p-4 sm:p-6 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
                            <div className="flex gap-4">
                                <div className="shrink-0 pt-1">
                                    <AlertCircle className="h-5 w-5 text-slate-400" />
                                </div>
                                <div className="space-y-2">
                                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                        Legal Disclaimer
                                    </p>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed text-justify">
                                        Information is for general guidance only. Grocery Studio does not provide professional tax advice. Please consult a Chartered Accountant (CA) for official compliance.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GstPage;

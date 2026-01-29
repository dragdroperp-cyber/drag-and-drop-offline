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
    const [saleMode, setSaleMode] = useState('normal'); // 'normal' | 'direct'
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
        </div>
    );
};

export default GstPage;

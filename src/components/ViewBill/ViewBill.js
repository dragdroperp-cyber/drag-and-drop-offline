import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Phone, Check, Receipt, Download, AlertCircle, Loader2 } from 'lucide-react';
import { calculateItemRateAndTotal } from '../../utils/orderUtils';

import jsPDF from 'jspdf';
import QRCode from 'qrcode';

// Helper to format date
const formatDateTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
};

const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
};

const ViewBill = () => {
    const { invoiceNo } = useParams();
    const [mobileNumber, setMobileNumber] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [order, setOrder] = useState(null);
    const [sellerSettings, setSellerSettings] = useState(null);
    const [verified, setVerified] = useState(false);
    const [downloading, setDownloading] = useState(false);

    const handleVerify = async (e) => {
        e.preventDefault();
        if (!mobileNumber || mobileNumber.length < 10) {
            setError('Please enter a valid mobile number');
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            const response = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/public/bill/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    invoiceNo,
                    mobileNumber
                })
            });

            const data = await response.json();

            if (data.success) {
                setOrder(data.order);
                setSellerSettings(data.sellerSettings || {});
                setVerified(true);
            } else {
                setError(data.message || 'Verification failed');
            }
        } catch (err) {
            console.error(err);
            setError('Failed to connect to server');
        } finally {
            setIsLoading(false);
        }
    };

    // Helper functions copied/adapted from Billing.js


    const safeDrawText = (doc, text, x, y, options = {}) => {
        // Simplified for port - advanced Hindi rendering requires canvas which is harder in this context
        // Try native text first
        doc.text(text, x, y, options);
    };

    const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16)
        ] : [47, 60, 126]; // Default branding color
    };

    const generateA4PDF = async () => {
        if (!order) return;
        setDownloading(true);

        try {
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();

            // Retrieve branding
            const settings = sellerSettings?.billSettings || {};
            const accentHex = settings.colors?.accent || settings.accentColor || '#2f3c7e';
            const accentColor = hexToRgb(accentHex);

            const COLORS = {
                accent: accentColor,
                text: [30, 41, 59],
                slate400: [148, 163, 184],
                slate50: [248, 250, 252],
                border: [241, 245, 249],
                white: [255, 255, 255]
            };

            const margin = 15;
            let y = 10;

            // 1. Branding Accent
            pdf.setFillColor(...COLORS.accent);
            pdf.rect(0, 0, pageWidth, 2, 'F');

            // 2. Header

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(22);
            pdf.setTextColor(...COLORS.accent);

            const storeName = order.sellerId?.shopName || 'Grocery Store';
            pdf.text(storeName.toUpperCase(), margin, y + 6);

            pdf.setFontSize(8);
            pdf.setTextColor(...COLORS.slate400);
            pdf.text('PREMIUM RETAIL PARTNER', margin, y + 11);

            pdf.setFillColor(...COLORS.slate50);
            pdf.roundedRect(pageWidth - margin - 45, y, 45, 10, 2, 2, 'F');
            pdf.setFontSize(13);
            pdf.setTextColor(...COLORS.text);
            pdf.text('TAX INVOICE', pageWidth - margin - 22.5, y + 6.5, { align: 'center' });

            y += 20;

            // Address Section
            pdf.setDrawColor(...COLORS.accent);
            pdf.setLineWidth(0.5);
            pdf.line(margin, y, margin, y + 15);

            pdf.setFontSize(9);
            pdf.setTextColor(71, 85, 105);
            const sellerInfo = order.sellerId || {};
            const mainAddr = sellerInfo.shopAddress || '';
            if (mainAddr) pdf.text(mainAddr, margin + 4, y + 3);

            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(100, 116, 139);
            const addr2 = [sellerInfo.city, sellerInfo.state, sellerInfo.pincode].filter(Boolean).join(' - ');
            if (addr2) pdf.text(addr2, margin + 4, y + 7);

            const phone = sellerInfo.phoneNumber || sellerInfo.phone || '';
            if (phone) pdf.text(`Phone: ${phone}`, margin + 4, y + 11);

            const gstin = sellerInfo.gstNumber || '';
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(...COLORS.text);
            if (gstin) pdf.text(`GSTIN: ${gstin}`, margin + 4, y + 15);

            // Invoice Details
            pdf.setFontSize(9);
            pdf.setTextColor(...COLORS.slate400);
            pdf.text('Invoice No', pageWidth - margin - 35, y + 15, { align: 'right' });
            pdf.text('Date', pageWidth - margin - 35, y + 20, { align: 'right' });
            pdf.text('Payment', pageWidth - margin - 35, y + 25, { align: 'right' });

            pdf.setTextColor(...COLORS.text);
            pdf.text(order.invoiceNumber || order.id, pageWidth - margin, y + 15, { align: 'right' });
            pdf.text(formatDate(order.createdAt || order.date), pageWidth - margin, y + 20, { align: 'right' });

            const pMethod = (order.paymentMethod || 'CASH').toUpperCase();
            pdf.text(pMethod, pageWidth - margin, y + 25, { align: 'right' });

            if (pMethod === 'SPLIT' && order.splitPaymentDetails) {
                const parts = [];
                if (order.splitPaymentDetails.cashAmount > 0) parts.push(`Cash: ${Number(order.splitPaymentDetails.cashAmount).toFixed(2)}`);
                if (order.splitPaymentDetails.onlineAmount > 0) parts.push(`Online: ${Number(order.splitPaymentDetails.onlineAmount).toFixed(2)}`);
                if (order.splitPaymentDetails.dueAmount > 0) parts.push(`Due: ${Number(order.splitPaymentDetails.dueAmount).toFixed(2)}`);

                if (parts.length > 0) {
                    pdf.setFontSize(7);
                    pdf.setTextColor(...COLORS.slate400);
                    pdf.text(parts.join(', '), pageWidth - margin, y + 29, { align: 'right' });
                }
            }

            y += 35;

            // 3. Bill To
            pdf.setDrawColor(...COLORS.border);
            pdf.line(margin, y, pageWidth - margin, y);
            y += 6;
            pdf.setFontSize(8);
            pdf.setTextColor(...COLORS.slate400);
            pdf.text('BILL TO', margin, y);
            pdf.text('PLACE OF SUPPLY', pageWidth - margin, y, { align: 'right' });
            y += 5;
            pdf.setFontSize(10);
            pdf.setTextColor(...COLORS.text);
            pdf.text((order.customerName || 'Customer').toUpperCase(), margin, y);
            pdf.text('LOCAL (WITHIN STATE)', pageWidth - margin, y, { align: 'right' });

            if (order.customerMobile) {
                y += 5;
                pdf.setFontSize(9);
                pdf.setTextColor(...COLORS.slate400);
                pdf.text(`Mobile: ${order.customerMobile}`, margin, y);
            }

            y += 8;
            pdf.line(margin, y, pageWidth - margin, y);
            y += 10;

            // 4. Table Header
            pdf.setFillColor(0, 0, 0); // Standardized black header
            pdf.roundedRect(margin, y, pageWidth - margin * 2, 10, 2, 2, 'F');
            pdf.setFontSize(9);
            pdf.setTextColor(...COLORS.white);
            pdf.text('#', margin + 4, y + 6.5);
            pdf.text('ITEM DESCRIPTION', margin + 12, y + 6.5);
            pdf.text('QTY', margin + 100, y + 6.5, { align: 'center' });
            pdf.text('RATE', margin + 130, y + 6.5, { align: 'right' });
            pdf.text('GST %', margin + 155, y + 6.5, { align: 'right' });
            pdf.text('AMOUNT', pageWidth - margin - 4, y + 6.5, { align: 'right' });
            y += 10;

            const items = order.items || [];
            let totalTaxable = 0;
            let totalGst = 0;

            // Items Loop
            items.forEach((item, idx) => {
                const rowH = 12;
                if (y + rowH > pageHeight - 60) { pdf.addPage(); y = 20; }
                if (idx % 2 === 1) { pdf.setFillColor(...COLORS.slate50); pdf.rect(margin, y, pageWidth - margin * 2, rowH, 'F'); }

                // Use robust calculation (handles case where sellingPrice is total)
                const { rate, total, qty, unit } = calculateItemRateAndTotal(item);

                pdf.setTextColor(...COLORS.slate400);
                pdf.text(String(idx + 1), margin + 4, y + 7.5);

                pdf.setTextColor(...COLORS.text);
                pdf.setFont('helvetica', 'bold');
                pdf.text(item.name || 'Item', margin + 12, y + 6);

                pdf.setFontSize(7);
                pdf.setTextColor(...COLORS.slate400);
                pdf.setFont('helvetica', 'normal');
                pdf.text(`HSN: ${item.hsnCode || '1001'} • CGST+SGST`, margin + 12, y + 10);

                pdf.setFontSize(9);
                pdf.setTextColor(...COLORS.text);

                pdf.text(`${qty} ${unit}`, margin + 100, y + 7.5, { align: 'center' });
                pdf.text(Number(rate).toFixed(2), margin + 130, y + 7.5, { align: 'right' });
                pdf.text(`${item.gstPercent || 0}%`, margin + 155, y + 7.5, { align: 'right' });

                pdf.text(Number(total).toFixed(2), pageWidth - margin - 4, y + 7.5, { align: 'right' });

                // Reconstruct Tax
                const gst = item.gstPercent || 0;
                const isInclusive = item.isGstInclusive !== false;
                let taxable, lineGst;
                if (isInclusive) {
                    taxable = total / (1 + gst / 100);
                    lineGst = total - taxable;
                } else {
                    taxable = total;
                    lineGst = total * (gst / 100);
                }
                totalTaxable += taxable;
                totalGst += lineGst;

                y += rowH;
            });

            // 5. Totals & Footer
            y += 10;
            pdf.setDrawColor(...COLORS.border);
            pdf.setLineWidth(0.5);
            pdf.line(margin, y, pageWidth - margin, y);
            y += 10;

            const itemsTotal = items.reduce((acc, i) => acc + calculateItemRateAndTotal(i).total, 0);
            const discountAmount = order.discountAmount || order.discount || 0;
            const grandTotal = order.totalAmount || (itemsTotal - discountAmount);

            const footerY = y;
            const leftColW = 100;

            // Terms
            if (settings.footer?.showTerms !== false) {
                pdf.setFontSize(8);
                pdf.setTextColor(...COLORS.slate400);
                pdf.setFont('helvetica', 'bold');
                pdf.text('TERMS & CONDITIONS', margin, y);
                y += 4;

                pdf.setFillColor(...COLORS.slate50);
                pdf.setDrawColor(...COLORS.border);
                const terms = settings.footer?.terms || "1. Goods once sold will not be taken back.\n2. Subject to local jurisdiction.";
                const termsLines = pdf.splitTextToSize(terms, leftColW - 10);
                const termsH = (termsLines.length * 4) + 8;
                pdf.roundedRect(margin, y, leftColW, termsH, 3, 3, 'FD');

                pdf.setFont('helvetica', 'italic');
                pdf.setFontSize(7);
                pdf.setTextColor(100, 116, 139);
                pdf.text(termsLines, margin + 5, y + 5);
                y += termsH + 10;
            }

            // QR Code
            try {
                let qrData = '';
                const upiId = order.sellerId?.upiId;
                if (grandTotal > 0 && upiId && upiId.includes('@')) {
                    qrData = `upi://pay?pa=${upiId}&am=${Number(grandTotal).toFixed(2)}&cu=INR&tn=Bill%20Payment`;
                }

                if (qrData) {
                    const qrBase64 = await QRCode.toDataURL(qrData, { margin: 1, width: 100 });
                    pdf.addImage(qrBase64, 'PNG', margin, y, 20, 20);
                    pdf.setFontSize(7);
                    pdf.setTextColor(...COLORS.slate400);
                    pdf.setFont('helvetica', 'bold');
                    pdf.text("SCAN TO PAY", margin + 25, y + 8);
                }
            } catch (e) { }

            // Right Side Totals
            y = footerY;
            const rightColX = pageWidth - margin - 60;
            const valX = pageWidth - margin;

            pdf.setFontSize(9);
            pdf.setTextColor(...COLORS.slate400);
            pdf.setFont('helvetica', 'bold');
            pdf.text('SUB TOTAL', rightColX, y);
            pdf.setTextColor(...COLORS.text);
            pdf.text(`Rs. ${Number(itemsTotal).toFixed(2)}`, valX, y, { align: 'right' });

            y += 6;
            pdf.setTextColor(...COLORS.slate400);
            pdf.text('TAX (GST)', rightColX, y);
            pdf.setTextColor(...COLORS.text);
            pdf.text(`Rs. ${Number(totalGst).toFixed(2)}`, valX, y, { align: 'right' });

            if (discountAmount > 0) {
                y += 6;
                pdf.setTextColor(...COLORS.slate400);
                pdf.text('DISCOUNT', rightColX, y);
                pdf.setTextColor('red');
                pdf.text(`- Rs. ${Number(discountAmount).toFixed(2)}`, valX, y, { align: 'right' });
            }

            y += 10;
            pdf.setDrawColor(30, 41, 59);
            pdf.setLineWidth(0.8);
            pdf.line(rightColX, y - 4, valX, y - 4);

            pdf.setFontSize(13);
            pdf.setTextColor(30, 41, 59);
            pdf.text('GRAND TOTAL', rightColX, y + 4);
            pdf.setTextColor(30, 41, 59);
            pdf.text(`Rs. ${Number(grandTotal).toFixed(2)}`, valX, y + 4, { align: 'right' });

            // Signatory
            y += 30;
            pdf.setDrawColor(...COLORS.border);
            pdf.setLineWidth(0.2);
            pdf.setLineDash([1, 1], 0);
            pdf.line(valX - 50, y, valX, y);
            pdf.setLineDash([], 0);

            pdf.setFontSize(8);
            pdf.setTextColor(...COLORS.text);
            pdf.setFont('helvetica', 'bold');
            pdf.text('AUTHORIZED SIGNATORY', valX - 25, y + 5, { align: 'center' });

            pdf.save(`invoice-${order.invoiceNumber || 'bill'}.pdf`);

        } catch (e) {
            console.error(e);
            alert('Error generating PDF');
        } finally {
            setDownloading(false);
        }
    };

    const generateThermalPDF = async (size) => {
        if (!order) return;
        setDownloading(true);

        try {
            const width = size === '58mm' ? 58 : 80;
            const margin = 2;
            const centerX = width / 2;
            const items = order.items || [];

            // Calculate pseudo height
            let estimatedHeight = 150 + (items.length * 15);

            const pdf = new jsPDF({
                orientation: 'p',
                unit: 'mm',
                format: [width, estimatedHeight < 297 ? 297 : estimatedHeight]
            });

            const drawDashedLine = (yPos) => {
                pdf.setLineDash([1, 1], 0);
                pdf.setDrawColor(0);
                pdf.line(margin, yPos, width - margin, yPos);
                pdf.setLineDash([], 0);
            };

            let y = 5;
            const storeName = order.sellerId?.shopName || 'MY STORE';
            const address = order.sellerId?.shopAddress || '';
            const phone = order.sellerId?.phoneNumber || order.sellerId?.phone || '';
            const gstin = order.sellerId?.gstNumber || '';

            // Header
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(8);
            pdf.setTextColor(0, 0, 0);
            pdf.text("TAX INVOICE", centerX, y, { align: 'center' });
            y += 5;

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(size === '58mm' ? 10 : 12);

            // Branding color
            const settings = sellerSettings?.billSettings || {};
            const accentHex = settings.colors?.accent || settings.accentColor || '#2f3c7e';
            const rgb = hexToRgb(accentHex);
            pdf.setTextColor(rgb[0], rgb[1], rgb[2]);

            const storeNameLines = pdf.splitTextToSize(storeName, width - 4);
            pdf.text(storeNameLines, centerX, y, { align: 'center' });
            y += (storeNameLines.length * 4) + 1;

            pdf.setTextColor(0, 0, 0);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(8);

            if (address) {
                const addrLines = pdf.splitTextToSize(address, width - 4);
                pdf.text(addrLines, centerX, y, { align: 'center' });
                y += (addrLines.length * 3.5);
            }

            if (phone) {
                pdf.text(`Contact :${phone}`, centerX, y, { align: 'center' });
                y += 3.5;
            }

            if (gstin) {
                pdf.text(`GSTIN :${gstin}`, centerX, y, { align: 'center' });
                y += 4;
            }

            y += 2;
            const metaY = y;
            pdf.setFontSize(8);
            pdf.setTextColor(150, 0, 0);
            pdf.text("Inv No", margin, metaY);

            pdf.setTextColor(0, 0, 0);
            pdf.setFont('helvetica', 'bold');
            const invNo = order.invoiceNumber || order.id;

            if (size === '58mm' && invNo.length > 12) {
                pdf.text(invNo, margin, metaY + 3.5);
            } else {
                pdf.text(invNo, margin + 12, metaY);
            }

            pdf.text(formatDate(order.createdAt), width - margin, metaY, { align: 'right' });
            y += 5;

            // Customer
            pdf.setFontSize(9);
            pdf.setFont('helvetica', 'bold');
            pdf.text(`Customer: ${order.customerName || 'Walk-in'}`, margin, y);
            y += 4;
            if (order.customerMobile) {
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(8);
                pdf.text(`Mobile: ${order.customerMobile}`, margin, y);
                y += 4;
            }

            drawDashedLine(y);
            y += 3;

            // Table Header
            pdf.setFontSize(size === '58mm' ? 7 : 8);
            pdf.setFont('helvetica', 'bold');

            const cols = size === '58mm' ? [
                { name: "Sl.No.", x: margin, align: 'left' },
                { name: "Item Name", x: margin + 8, align: 'left' },
                { name: "QTY.", x: width - margin - 22, align: 'right' },
                { name: "Price", x: width - margin - 12, align: 'right' },
                { name: "Amount", x: width - margin, align: 'right' }
            ] : [
                { name: "Sl.No.", x: margin, align: 'left' },
                { name: "Item Name", x: margin + 10, align: 'left' },
                { name: "QTY.", x: width - margin - 35, align: 'right' },
                { name: "Price", x: width - margin - 18, align: 'right' },
                { name: "Amount", x: width - margin, align: 'right' }
            ];

            cols.forEach(c => pdf.text(c.name, c.x, y, { align: c.align }));
            y += 2;
            drawDashedLine(y);
            y += 3;

            // Table Body
            pdf.setFont('helvetica', 'bold');
            let totalQty = 0;
            items.forEach((item, index) => {
                const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
                totalQty += qty;

                const maxItemWidth = size === '58mm' ? 22 : 35;
                const nameLines = pdf.splitTextToSize(item.name || 'Item', maxItemWidth);
                pdf.text(nameLines, cols[1].x, y);

                pdf.text(String(index + 1), cols[0].x, y);

                pdf.text(qty.toFixed(2), cols[2].x, y, { align: 'right' });
                pdf.text(Number(rate).toFixed(2), cols[3].x, y, { align: 'right' });
                pdf.text(Number(total).toFixed(2), cols[4].x, y, { align: 'right' });

                y += (nameLines.length * 3.5);
            });

            drawDashedLine(y);
            y += 4;

            // Totals
            const itemsTotal = items.reduce((acc, i) => acc + calculateItemRateAndTotal(i).total, 0);
            const discountAmount = order.discountAmount || order.discount || 0;
            const grandTotal = order.totalAmount || (itemsTotal - discountAmount);

            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'bold');
            pdf.text(`Total`, margin, y);
            pdf.text(Number(grandTotal).toFixed(2), width - margin, y, { align: 'right' });
            y += 10;

            // Footer Msg
            const footerMsg = settings.footerMessage || settings.billSettings?.footerMessage || "Thank you for shopping!";
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'italic');
            pdf.text(footerMsg, centerX, y, { align: 'center' });

            pdf.save(`bill-${size}-${order.invoiceNumber}.pdf`);

        } catch (e) {
            console.error(e);
            alert('Error generating PDF');
        } finally {
            setDownloading(false);
        }
    };

    if (verified && order) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-slate-900 pb-12">
                {/* Header */}
                <div className="bg-white dark:bg-slate-800 shadow-sm sticky top-0 z-10 px-4 py-3">
                    <div className="max-w-3xl mx-auto flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="bg-indigo-50 dark:bg-indigo-900/30 p-2 rounded-lg text-indigo-600 dark:text-indigo-400">
                                <Receipt className="w-5 h-5" />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">Invoice</h1>
                                <p className="text-xs text-gray-500 dark:text-slate-400">#{order.invoiceNumber || order.id || 'N/A'}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="inline-block px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-bold rounded-lg uppercase tracking-wider">
                                Paid
                            </span>
                        </div>
                    </div>
                </div>

                <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
                    {/* Customer Info Card */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-4">
                        <div className="flex flex-col sm:flex-row justify-between gap-4">
                            <div>
                                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wider font-bold mb-1">Billed To</p>
                                <p className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                    {order.customerName || 'Walk-in Customer'}
                                </p>
                                <p className="text-sm text-gray-600 dark:text-slate-300 mt-0.5">{order.customerMobile}</p>
                            </div>
                            <div className="text-left sm:text-right">
                                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wider font-bold mb-1">Details</p>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">{formatDateTime(order.createdAt)}</p>
                                <div className="text-sm text-gray-600 dark:text-slate-300 mt-0.5">
                                    Payment: <span className="font-medium">{order.paymentMethod || 'Cash'}</span>
                                    {order.paymentMethod && order.paymentMethod.toLowerCase() === 'split' && order.splitPaymentDetails && (
                                        <div className="text-xs mt-1 space-y-0.5 text-gray-500 font-medium">
                                            {order.splitPaymentDetails.cashAmount > 0 && <div>Cash: ₹{Number(order.splitPaymentDetails.cashAmount).toFixed(2)}</div>}
                                            {order.splitPaymentDetails.onlineAmount > 0 && <div>Online: ₹{Number(order.splitPaymentDetails.onlineAmount).toFixed(2)}</div>}
                                            {order.splitPaymentDetails.dueAmount > 0 && <div>Due: ₹{Number(order.splitPaymentDetails.dueAmount).toFixed(2)}</div>}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Items List - Mimicking Billing.js Cart Style */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white px-1">Items ({order.items.length})</h3>

                        {order.items.map((item, idx) => {
                            const { rate, total, qty, unit } = calculateItemRateAndTotal(item);

                            return (
                                <div
                                    key={idx}
                                    className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                >
                                    {/* Product Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                            <h4 className="font-medium text-gray-900 dark:text-white truncate">
                                                {item.name}
                                            </h4>
                                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50">
                                                {qty} {unit}
                                            </span>
                                        </div>
                                        <p className="text-xs text-gray-500 dark:text-slate-400">
                                            ₹{rate}/{unit}
                                        </p>
                                    </div>

                                    {/* Price */}
                                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-0 border-gray-50 dark:border-slate-700 mt-2 sm:mt-0">
                                        <span className="text-sm sm:hidden text-gray-500">Total</span>
                                        <span className="font-bold text-gray-900 dark:text-white text-base">
                                            ₹{Number(total).toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Summary Card - Mimicking Billing.js Summary Style */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-4 sticky bottom-4">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Summary</h3>

                        <div className="space-y-2 mb-3">
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-slate-400">Subtotal</span>
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">₹{Number(order.subtotal || order.totalAmount).toFixed(2)}</span>
                            </div>
                            {(order.totalGstAmount > 0) && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500 dark:text-slate-400">Tax (GST)</span>
                                    <span className="font-medium text-gray-900 dark:text-white">₹{order.totalGstAmount.toFixed(2)}</span>
                                </div>
                            )}
                            {(order.discountAmount > 0) && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500 dark:text-slate-400">Discount</span>
                                    <span className="font-medium text-rose-600 dark:text-rose-400">- ₹{order.discountAmount.toFixed(2)}</span>
                                </div>
                            )}
                            <div className="h-px bg-gray-100 dark:bg-slate-700 my-2"></div>
                            <div className="flex justify-between items-center text-lg font-bold">
                                <span className="text-gray-900 dark:text-white">Total</span>
                                <span className="text-emerald-600 dark:text-emerald-500">₹{Number(order.totalAmount).toFixed(2)}</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                            <button
                                onClick={generateA4PDF}
                                disabled={downloading}
                                className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 transition-colors"
                            >
                                <Download className="w-4 h-4" />
                                <span className="text-xs font-bold">A4</span>
                            </button>
                            <button
                                onClick={() => generateThermalPDF('80mm')}
                                disabled={downloading}
                                className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-gray-700 dark:text-slate-300 hover:bg-gray-100 transition-colors"
                            >
                                <Receipt className="w-4 h-4" />
                                <span className="text-xs font-bold">80mm</span>
                            </button>
                            <button
                                onClick={() => generateThermalPDF('58mm')}
                                disabled={downloading}
                                className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-gray-700 dark:text-slate-300 hover:bg-gray-100 transition-colors"
                            >
                                <Receipt className="w-4 h-4" />
                                <span className="text-xs font-bold">58mm</span>
                            </button>
                        </div>
                    </div>

                    <div className="text-center text-xs text-gray-400 dark:text-slate-600 pb-8">
                        Verified & Secure • Invoice #{order.invoiceNumber}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 dark:bg-slate-900 flex flex-col items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-xl w-full max-w-md border border-gray-100 dark:border-slate-700">
                <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Verify Identity</h2>
                    <p className="text-gray-500 dark:text-slate-400 mt-2">Enter your mobile number to view the bill for Invoice <span className="font-mono font-medium text-gray-700 dark:text-slate-300">#{invoiceNo}</span></p>
                </div>

                <form onSubmit={handleVerify} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Mobile Number</label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                            <input
                                type="tel"
                                value={mobileNumber}
                                onChange={(e) => setMobileNumber(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:bg-slate-700 dark:text-white"
                                placeholder="Enter 10-digit number"
                                maxLength={10}
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <p>{error}</p>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-indigo-600 text-white py-2.5 rounded-lg hover:bg-indigo-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-md"
                    >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Check className="w-5 h-5" /> Verify & View Bill</>}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ViewBill;

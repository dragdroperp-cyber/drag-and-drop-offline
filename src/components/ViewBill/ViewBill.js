import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Phone, Check, FileText, Download, AlertCircle, Loader2, MessageCircle, Share2, ExternalLink } from 'lucide-react';
import { calculateItemRateAndTotal, formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import { addWatermarkToPDF } from '../../utils/pdfUtils';

import jsPDF from 'jspdf';
import QRCode from 'qrcode';

// Helper functions removed here as they are now imported from dateUtils

const ViewBill = () => {
    const { invoiceNo } = useParams();
    const [mobileNumber, setMobileNumber] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [order, setOrder] = useState(null);
    const [sellerSettings, setSellerSettings] = useState(null);
    const [verified, setVerified] = useState(false);
    const [downloading, setDownloading] = useState(null); // 'a4', '80mm', '58mm' or null

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

    // Helper: Safe text drawing for PDF (handles Hindi/UTF-8)
    const safeDrawText = (doc, text, x, y, options = {}) => {
        if (!text) return;
        let displayText = text.toString();
        const maxWidth = options.maxWidth || 0;

        // Truncate if maxWidth is provided
        if (maxWidth > 0) {
            const currentFont = doc.getFont().fontName;
            const currentSize = doc.getFontSize();
            doc.setFont(options.font || 'helvetica', options.fontStyle || 'normal');
            doc.setFontSize(options.fontSize || 10);

            if (doc.getTextWidth(displayText) > maxWidth) {
                while (displayText.length > 0 && doc.getTextWidth(displayText + '...') > maxWidth) {
                    displayText = displayText.slice(0, -1);
                }
                displayText += '...';
            }
            // Restore font/size if needed (jsPDF state)
            doc.setFont(currentFont);
            doc.setFontSize(currentSize);
        }

        const isHindi = /[\u0900-\u097F\u20B9]/.test(displayText);
        if (isHindi) {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const fontSize = options.fontSize || 10;
                ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
                const metrics = ctx.measureText(displayText);
                const fontScale = 2; // High resolution
                canvas.width = metrics.width * fontScale + 10;
                canvas.height = fontSize * fontScale * 1.5;
                ctx.scale(fontScale, fontScale);
                ctx.fillStyle = options.color || '#000000';
                ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
                ctx.fillText(displayText, 0, fontSize);

                const dataUrl = canvas.toDataURL('image/png');
                const w = metrics.width / 3.78;
                const h = (fontSize * 1.5) / 3.78;

                let drawX = x;
                if (options.align === 'right') drawX -= w;
                else if (options.align === 'center') drawX -= w / 2;

                doc.addImage(dataUrl, 'PNG', drawX, y - (fontSize / 2.5), w, h);
            } catch (e) {
                doc.text(displayText, x, y, options);
            }
        } else {
            doc.text(displayText, x, y, options);
        }
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
        setDownloading('a4');

        try {
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const margin = 15;

            // Retrieve settings
            const settings = sellerSettings?.billSettings || {};
            const accentHex = settings.colors?.accent || settings.accentColor || '#2f3c7e';
            const hexToRgb = (hex) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? [
                    parseInt(result[1], 16),
                    parseInt(result[2], 16),
                    parseInt(result[3], 16)
                ] : [47, 60, 126];
            };

            const COLORS = {
                accent: hexToRgb(accentHex),
                text: [30, 41, 59],
                slate400: [148, 163, 184],
                slate50: [248, 250, 252],
                border: [241, 245, 249],
                white: [255, 255, 255]
            };

            let y = 10;

            // 1. Branding Accent
            pdf.setFillColor(...COLORS.accent);
            pdf.rect(0, 0, pageWidth, 2, 'F');
            y += 15;

            // 2. Header
            let logoOffset = 0;
            const logoShow = settings.showLogo !== false;
            if (logoShow) {
                try {
                    const publicUrl = process.env.PUBLIC_URL || '';
                    const defaultLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
                    const sellerLogo = order.sellerId?.logoUrl || order.sellerId?.profilePicture || settings.logoUrl;
                    const logoUrl = sellerLogo || defaultLogo;

                    const loadImage = (src) => new Promise((resolve, reject) => {
                        const img = new Image();
                        img.crossOrigin = 'Anonymous';
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width; canvas.height = img.height;
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
                        } else throw e;
                    }

                    if (logoBase64) {
                        pdf.addImage(logoBase64, 'PNG', margin, y, 16, 16);
                        logoOffset = 20;
                    }
                } catch (e) {
                    console.error("Logo load error in A4:", e);
                }
            }

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(22);
            pdf.setTextColor(...COLORS.accent);
            const storeName = order.sellerId?.shopName || 'Grocery Store';
            safeDrawText(pdf, storeName.toUpperCase(), margin + logoOffset, y + 6, { fontSize: 22, color: `rgb(${COLORS.accent.join(',')})` });

            pdf.setFontSize(8);
            pdf.setTextColor(...COLORS.slate400);
            pdf.text('PREMIUM RETAIL PARTNER', margin + logoOffset, y + 11);

            pdf.setFillColor(...COLORS.slate50);
            pdf.roundedRect(pageWidth - margin - 45, y, 45, 10, 2, 2, 'F');
            pdf.setFontSize(13);
            pdf.setTextColor(...COLORS.text);
            pdf.text('TAX INVOICE', pageWidth - margin - 22.5, y + 6.5, { align: 'center' });

            y += 20;

            // Shop Info
            pdf.setDrawColor(...COLORS.accent);
            pdf.setLineWidth(0.5);
            pdf.line(margin, y, margin, y + 15);
            pdf.setFontSize(9);
            pdf.setTextColor(71, 85, 105);

            const mainAddr = order.sellerId?.shopAddress || '';
            if (mainAddr) pdf.text(mainAddr, margin + 4, y + 3);

            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(100, 116, 139);
            const addr2 = [order.sellerId?.city, order.sellerId?.state, order.sellerId?.pincode].filter(Boolean).join(' - ');
            if (addr2) pdf.text(addr2, margin + 4, y + 7);

            const phone = order.sellerId?.phoneNumber || order.sellerId?.phone || '';
            if (phone) pdf.text(`Phone: ${phone}`, margin + 4, y + 11);

            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(...COLORS.text);
            const gstin = order.sellerId?.gstNumber || '';
            if (gstin) pdf.text(`GSTIN: ${gstin}`, margin + 4, y + 15);

            // Invoice Info
            pdf.setFontSize(9);
            pdf.setTextColor(...COLORS.slate400);
            const infoX = pageWidth - margin - 35;
            pdf.text('Invoice No', infoX, y + 15, { align: 'right' });
            pdf.text('Date', infoX, y + 20, { align: 'right' });
            pdf.text('Payment', infoX, y + 25, { align: 'right' });

            pdf.setTextColor(...COLORS.text);
            const displayInvNo = order.invoiceNumber || order.invoiceNo || order.billNumber || (order._id || '').slice(-6).toUpperCase();
            pdf.text(String(displayInvNo), pageWidth - margin, y + 15, { align: 'right' });
            const dateStr = order.date || order.createdAt ? new Date(order.date || order.createdAt).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
            pdf.text(dateStr, pageWidth - margin, y + 20, { align: 'right' });
            pdf.text((order.paymentMethod || 'PAID').toUpperCase(), pageWidth - margin, y + 25, { align: 'right' });

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
            safeDrawText(pdf, (order.customerName || 'Walk-in Customer').toUpperCase(), margin, y, { fontSize: 10 });
            pdf.text('LOCAL (WITHIN STATE)', pageWidth - margin, y, { align: 'right' });
            y += 8;
            pdf.line(margin, y, pageWidth - margin, y);
            y += 10;

            // 4. Table Header
            pdf.setFillColor(...COLORS.accent);
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

            // Items
            const items = order.items || [];
            let totalTaxable = 0;
            let totalGst = 0;

            items.forEach((item, idx) => {
                const maxWidth = 75;
                const fontSize = 9;

                // Wrapping Logic
                const isHindi = /[\u0900-\u097F\u20B9]/.test(item.name);
                let nameLines = [];
                if (!isHindi) {
                    // Set font for accurate width calculation
                    pdf.setFont('helvetica', 'bold');
                    pdf.setFontSize(fontSize);
                    nameLines = pdf.splitTextToSize(item.name || 'Item', maxWidth);
                }

                const lineHeight = 4;
                const nameHeight = isHindi ? lineHeight : (Math.max(1, nameLines.length) * lineHeight);

                // Calculate dynamic row height
                const baseRowH = 12;
                const extraH = Math.max(0, nameHeight - lineHeight);
                const rowH = baseRowH + extraH;

                if (y + rowH > pageHeight - 60) { pdf.addPage(); y = 20; }
                if (idx % 2 === 1) { pdf.setFillColor(...COLORS.slate50); pdf.rect(margin, y, pageWidth - margin * 2, rowH, 'F'); }

                const { rate, total, qty, unit } = calculateItemRateAndTotal(item);

                pdf.setTextColor(...COLORS.slate400);
                pdf.text(String(idx + 1), margin + 4, y + 7.5);

                pdf.setTextColor(...COLORS.text);
                pdf.setFont('helvetica', 'bold');

                if (isHindi) {
                    safeDrawText(pdf, item.name || 'Item', margin + 12, y + 6, { fontSize: 9, maxWidth: 75 });
                } else {
                    pdf.text(nameLines, margin + 12, y + 6);
                }

                pdf.setFontSize(7);
                pdf.setTextColor(...COLORS.slate400);
                pdf.setFont('helvetica', 'normal');
                // HSN below the name
                const hsnY = y + 6 + nameHeight;
                pdf.text(`HSN: ${item.hsnCode || '1001'} • CGST+SGST`, margin + 12, hsnY);

                pdf.setFontSize(9);
                pdf.setTextColor(...COLORS.text);
                pdf.text(`${qty} ${unit}`, margin + 100, y + 7.5, { align: 'center' });
                pdf.text(rate.toFixed(2), margin + 130, y + 7.5, { align: 'right' });
                pdf.text(`${item.gstPercent || 0}%`, margin + 155, y + 7.5, { align: 'right' });
                pdf.text(total.toFixed(2), pageWidth - margin - 4, y + 7.5, { align: 'right' });

                // Tax Calculation for totals
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

            // 5. Totals
            y += 10;
            pdf.setDrawColor(...COLORS.border);
            pdf.setLineWidth(0.5);
            pdf.line(margin, y, pageWidth - margin, y);
            y += 10;

            const discountAmount = order.discountAmount || order.discount || 0;
            const itemsTotal = items.reduce((acc, i) => acc + calculateItemRateAndTotal(i).total, 0);
            const grandTotal = order.totalAmount || order.total || (itemsTotal - discountAmount);
            const footerY = y;

            // Terms
            const leftColW = 100;
            if (settings.showFooter !== false) {
                pdf.setFontSize(8);
                pdf.setTextColor(...COLORS.slate400);
                pdf.setFont('helvetica', 'bold');
                pdf.text('TERMS & CONDITIONS', margin, y);
                y += 4;

                pdf.setFillColor(...COLORS.slate50);
                pdf.setDrawColor(...COLORS.border);
                const terms = settings.termsAndConditions || "1. Goods once sold will not be taken back.\n2. Subject to local jurisdiction.";
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
            const sellerUpiIdValue = order.sellerId?.upiId || settings.upiId;
            if (grandTotal > 0 && sellerUpiIdValue && sellerUpiIdValue.includes('@')) {
                try {
                    const qrUrl = `upi://pay?pa=${sellerUpiIdValue}&am=${Number(grandTotal).toFixed(2)}&cu=INR&tn=Bill%20Payment`;
                    const qrImg = await QRCode.toDataURL(qrUrl, { margin: 1, width: 100 });
                    pdf.addImage(qrImg, 'PNG', margin, y, 20, 20);
                    pdf.setFontSize(7);
                    pdf.setTextColor(...COLORS.slate400);
                    pdf.setFont('helvetica', 'bold');
                    pdf.text('SCAN TO PAY', margin + 25, y + 8);
                } catch (e) { }
            }

            // Right Totals
            y = footerY;
            const rightColX = pageWidth - margin - 60;
            const valX = pageWidth - margin;

            pdf.setFontSize(9);
            pdf.setTextColor(...COLORS.slate400);
            pdf.setFont('helvetica', 'bold');
            pdf.text('SUB TOTAL', rightColX, y);
            pdf.setTextColor(...COLORS.text);
            pdf.text(`Rs. ${totalTaxable.toFixed(2)}`, valX, y, { align: 'right' });

            y += 6;
            pdf.setTextColor(...COLORS.slate400);
            pdf.text('TAX (GST)', rightColX, y);
            pdf.setTextColor(...COLORS.text);
            pdf.text(`Rs. ${totalGst.toFixed(2)}`, valX, y, { align: 'right' });

            if (discountAmount > 0) {
                y += 6;
                pdf.setTextColor(...COLORS.slate400);
                pdf.text('DISCOUNT', rightColX, y);
                pdf.setTextColor(220, 38, 38);
                pdf.text(`- Rs. ${discountAmount.toFixed(2)}`, valX, y, { align: 'right' });
            }

            const deliveryCharge = order.deliveryCharge || 0;
            if (deliveryCharge > 0) {
                y += 6;
                pdf.setTextColor(...COLORS.slate400);
                pdf.text('DELIVERY CHARGE', rightColX, y);
                pdf.setTextColor(...COLORS.text);
                pdf.text(`Rs. ${deliveryCharge.toFixed(2)}`, valX, y, { align: 'right' });
            }

            y += 10;
            pdf.setDrawColor(30, 41, 59);
            pdf.setLineWidth(0.8);
            pdf.line(rightColX, y - 4, valX, y - 4);

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(12);
            pdf.setTextColor(30, 41, 59);
            pdf.text('GRAND TOTAL', rightColX, y + 4);
            pdf.setTextColor(...COLORS.accent);
            pdf.text(`Rs. ${Math.round(grandTotal).toFixed(2)}`, valX, y + 4, { align: 'right' });

            y += 30;
            pdf.setDrawColor(...COLORS.border);
            pdf.setLineWidth(0.2);
            pdf.line(valX - 50, y, valX, y);

            pdf.setFontSize(8);
            pdf.setTextColor(...COLORS.text);
            pdf.setFont('helvetica', 'bold');
            pdf.text('AUTHORIZED SIGNATORY', valX - 25, y + 5, { align: 'center' });

            // Watermark
            const sellerLogoUrl = order.sellerId?.logoUrl || order.sellerId?.profilePicture || settings.logoUrl;
            await addWatermarkToPDF(pdf, sellerLogoUrl || undefined);

            // 6. Powered By Branding
            try {
                const publicUrl = process.env.PUBLIC_URL || '';
                const gsLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
                const gsLogoRes = await fetch(gsLogo).catch(() => null);
                if (gsLogoRes && gsLogoRes.ok) {
                    const blob = await gsLogoRes.blob();
                    const base64 = await new Promise(r => {
                        const reader = new FileReader();
                        reader.onloadend = () => r(reader.result);
                        reader.readAsDataURL(blob);
                    });
                    const gsY = pageHeight - 7;
                    pdf.setFontSize(6);
                    pdf.setTextColor(160, 160, 160);
                    pdf.setFont('helvetica', 'normal');
                    pdf.text('Powered by ', pageWidth / 2 - 5, gsY, { align: 'right' });
                    pdf.addImage(base64, 'PNG', pageWidth / 2 - 4.2, gsY - 2.8, 3.5, 3.5);
                    pdf.setFont('helvetica', 'bold');
                    pdf.text('Grocery Studio', pageWidth / 2 + 0.5, gsY, { align: 'left' });
                }
            } catch (e) { }

            pdf.save(`Invoice-${displayInvNo}.pdf`);
        } catch (e) {
            console.error(e);
            if (window.showToast) window.showToast('Error generating PDF', 'error');
        } finally {
            setDownloading(null);
        }
    };

    const getPaymentMethodLabel = (method, splitDetails) => {
        const m = (method || '').toLowerCase();
        if (m === 'split' && splitDetails) {
            const parts = [];
            if (splitDetails.cashAmount > 0) parts.push(`Cash: ${Number(splitDetails.cashAmount).toFixed(2)}`);
            if (splitDetails.onlineAmount > 0) parts.push(`Online: ${Number(splitDetails.onlineAmount).toFixed(2)}`);
            if (splitDetails.dueAmount > 0) parts.push(`Due: ${Number(splitDetails.dueAmount).toFixed(2)}`);
            return `Split(${parts.join(', ')})`;
        }
        if (m === 'cash') return 'Cash';
        if (m === 'online') return 'Online';
        if (m === 'due' || m === 'credit') return 'Due';
        return method || 'N/A';
    };

    const generateThermalPDF = async (size) => {
        if (!order) return;
        setDownloading(size);

        try {
            const width = size === '58mm' ? 58 : 80;
            const margin = 2; // small margin for thermal
            const centerX = width / 2;
            const items = order.items || [];

            // Settings
            const settings = sellerSettings?.billSettings || {};
            const accentHex = settings.colors?.accent || settings.accentColor || '#1e293b';
            const hexToRgb = (hex) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 30, g: 41, b: 59 };
            };
            const rgb = hexToRgb(accentHex);

            const storeName = order.sellerId?.shopName || 'Grocery Store';
            const address = order.sellerId?.shopAddress || '';
            const phone = order.sellerId?.phoneNumber || order.sellerId?.phone || '';
            const gstin = order.sellerId?.gstNumber || '';

            const displayInvNo = order.invoiceNumber || order.invoiceNo || order.billNumber || (order._id || '').slice(-6).toUpperCase();
            const dateStr = order.date || order.createdAt ? new Date(order.date || order.createdAt).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');

            const itemsTotal = items.reduce((acc, i) => acc + calculateItemRateAndTotal(i).total, 0);
            const discountAmount = order.discountAmount || order.discount || 0;
            const grandTotal = order.totalAmount || order.total || (itemsTotal - discountAmount);
            const sellerUpiIdValue = order.sellerId?.upiId || settings.upiId;

            // Helper: Draw Content
            const drawContent = async (pdf) => {
                let y = 5;

                const drawDashedLine = (yPos) => {
                    pdf.setLineDash([1, 1], 0);
                    pdf.setDrawColor(0);
                    pdf.line(margin, yPos, width - margin, yPos);
                    pdf.setLineDash([], 0);
                };

                // Logo
                const logoUrl = order.sellerId?.logoUrl || order.sellerId?.profilePicture || settings.logoUrl;
                if (logoUrl) {
                    try {
                        const loadImage = (src) => new Promise((resolve, reject) => {
                            const img = new Image();
                            img.crossOrigin = 'Anonymous';
                            img.onload = () => {
                                const canvas = document.createElement('canvas');
                                canvas.width = img.width; canvas.height = img.height;
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(img, 0, 0);
                                resolve(canvas.toDataURL('image/png'));
                            };
                            img.onerror = reject;
                            img.src = src;
                        });

                        const logoBase64 = await loadImage(logoUrl);
                        const logoW = size === '58mm' ? 12 : 16;
                        const logoH = logoW;
                        pdf.addImage(logoBase64, 'PNG', centerX - (logoW / 2), y, logoW, logoH);
                        y += logoH + 2;
                    } catch (e) {
                        console.error("Thermal logo load error:", e);
                    }
                }

                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(8);
                pdf.setTextColor(0, 0, 0);
                pdf.text("TAX INVOICE", centerX, y, { align: 'center' });
                y += 5;

                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(size === '58mm' ? 10 : 12);
                pdf.setTextColor(rgb.r, rgb.g, rgb.b);

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
                    pdf.text(`Contact: ${phone}`, centerX, y, { align: 'center' });
                    y += 3.5;
                }

                if (gstin) {
                    pdf.text(`GSTIN: ${gstin}`, centerX, y, { align: 'center' });
                    y += 4;
                }

                y += 2;
                pdf.setFontSize(8);
                pdf.setTextColor(150, 0, 0);
                pdf.text("Inv No", margin, y);
                pdf.setTextColor(0, 0, 0);
                pdf.setFont('helvetica', 'bold');
                pdf.text(displayInvNo, margin + 12, y);

                pdf.text(dateStr, width - margin, y, { align: 'right' });
                y += 5;

                // Customer Info
                const cxName = order.customerName || 'Walk-in Customer';
                pdf.setFontSize(9);
                pdf.text(`Customer: ${cxName}`, margin, y);
                y += 4;

                if (order.customerMobile) {
                    pdf.setFont('helvetica', 'normal');
                    pdf.setFontSize(8);
                    pdf.text(`Mobile: ${order.customerMobile}`, margin, y);
                    y += 4;
                }

                drawDashedLine(y);
                y += 3;

                // TABLE HEADER
                pdf.setFontSize(size === '58mm' ? 7 : 8);
                pdf.setFont('helvetica', 'bold');

                const cols = size === '58mm' ? [
                    { name: "Sl.", x: margin, align: 'left' },
                    { name: "Item", x: margin + 8, align: 'left' },
                    { name: "QTY", x: width - margin - 22, align: 'right' },
                    { name: "Rate", x: width - margin - 12, align: 'right' },
                    { name: "Amt", x: width - margin, align: 'right' }
                ] : [
                    { name: "Sl.", x: margin, align: 'left' },
                    { name: "Item Name", x: margin + 10, align: 'left' },
                    { name: "QTY", x: width - margin - 28, align: 'right' },
                    { name: "Price", x: width - margin - 15, align: 'right' },
                    { name: "Amount", x: width - margin, align: 'right' }
                ];

                cols.forEach(c => pdf.text(c.name, c.x, y, { align: c.align }));
                y += 2;
                drawDashedLine(y);
                y += 3;

                // TABLE BODY
                let totalQtyCount = 0;
                items.forEach((item, index) => {
                    const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
                    totalQtyCount += qty;

                    pdf.text(String(index + 1), cols[0].x, y);

                    // Wrapping Logic
                    // Wrapping Logic
                    // 58mm: Item(10) -> QTY Ends(34). QTY Start~26. Safe width ~15.
                    // 80mm: Item(12) -> QTY Ends(50). QTY Start~40. Safe width ~27.
                    const maxWidth = size === '58mm' ? 15 : 27;
                    const fontSize = size === '58mm' ? 7 : 8;
                    pdf.setFontSize(fontSize);

                    const isHindi = /[\u0900-\u097F\u20B9]/.test(item.name);
                    let nameLines = [];
                    if (!isHindi) {
                        nameLines = pdf.splitTextToSize(item.name || 'Item', maxWidth);
                    }

                    if (isHindi) {
                        safeDrawText(pdf, item.name || 'Item', cols[1].x, y, { fontSize, maxWidth });
                    } else {
                        pdf.text(nameLines, cols[1].x, y);
                    }

                    pdf.text(qty.toFixed(2), cols[2].x, y, { align: 'right' });
                    pdf.text(rate.toFixed(2), cols[3].x, y, { align: 'right' });
                    pdf.text(total.toFixed(2), cols[4].x, y, { align: 'right' });

                    const height = isHindi ? 3.5 : (Math.max(1, nameLines.length) * 3.5);
                    y += height;
                });

                drawDashedLine(y);
                y += 3;

                // TOTALS LINE
                pdf.setFontSize(8);
                pdf.setFont('helvetica', 'bold');
                pdf.text(`Items: ${items.length}`, margin, y);
                pdf.text(`Qty: ${totalQtyCount.toFixed(2)}`, width / 2, y, { align: 'center' });
                pdf.text(itemsTotal.toFixed(2), width - margin, y, { align: 'right' });

                y += 3;
                drawDashedLine(y);
                y += 4;

                // GST SUMMARY
                const gstSummary = {};
                items.forEach(item => {
                    const gst = item.gstPercent || 0;
                    if (gst >= 0) {
                        const { total } = calculateItemRateAndTotal(item);
                        if (!gstSummary[gst]) gstSummary[gst] = { taxable: 0, tax: 0 };
                        const isInclusive = item.isGstInclusive !== false;
                        let taxAmt = 0;
                        let taxable = 0;
                        if (isInclusive) {
                            taxable = total / (1 + gst / 100);
                            taxAmt = total - taxable;
                        } else {
                            taxable = total;
                            taxAmt = total * (gst / 100);
                        }
                        gstSummary[gst].taxable += taxable;
                        gstSummary[gst].tax += taxAmt;
                    }
                });

                if (Object.keys(gstSummary).length > 0) {
                    pdf.setFontSize(size === '58mm' ? 6 : 7);
                    pdf.setFont('helvetica', 'normal');
                    const gCols = size === '58mm' ? [
                        { n: "Tax %", x: margin },
                        { n: "Taxable", x: margin + 11 },
                        { n: "CGST", x: margin + 30 },
                        { n: "SGST", x: margin + 38 },
                        { n: "GST", x: width - margin - 5, align: 'center' }
                    ] : [
                        { n: "Tax %", x: margin },
                        { n: "Taxable Val", x: margin + 12 },
                        { n: "CGST", x: margin + 32 },
                        { n: "SGST", x: margin + 46 },
                        { n: "GST", x: width - margin - 12, align: 'center' }
                    ];

                    gCols.forEach(c => pdf.text(c.n, c.x, y, { align: c.align || 'left' }));
                    y += 3;
                    Object.keys(gstSummary).forEach(rate => {
                        const row = gstSummary[rate];
                        const halfTax = row.tax / 2;
                        pdf.text(Number(rate).toFixed(2), gCols[0].x, y);
                        pdf.text(row.taxable.toFixed(2), gCols[1].x + 2, y, { align: 'center' });
                        pdf.text(halfTax.toFixed(2), gCols[2].x, y);
                        pdf.text(halfTax.toFixed(2), gCols[3].x, y);
                        pdf.text(row.tax.toFixed(2), gCols[4].x, y, { align: 'center' });
                        y += 3;
                    });
                    drawDashedLine(y);
                    y += 4;
                }

                // Delivery Charge
                const deliveryCharge = order.deliveryCharge || 0;
                if (deliveryCharge > 0) {
                    pdf.setFontSize(8);
                    pdf.text("Delivery Charge", margin, y);
                    pdf.text(Number(deliveryCharge).toFixed(2), width - margin, y, { align: 'right' });
                    y += 4;
                }

                // FINAL BIG TOTAL
                pdf.setFontSize(14);
                pdf.setFont('helvetica', 'bold');
                y += 2;
                pdf.text("Total", margin, y);
                pdf.text(Math.round(grandTotal).toFixed(2), width - margin, y, { align: 'right' });
                y += 6;
                drawDashedLine(y);
                y += 4;

                // FOOTER
                if (settings.showFooter !== false) {
                    pdf.setFontSize(10);
                    pdf.setFont('helvetica', 'bold');
                    pdf.text("Terms and Conditions", centerX, y, { align: 'center' });
                    y += 4;
                    pdf.setFontSize(7);
                    pdf.setFont('helvetica', 'normal');
                    const termsText = settings.termsAndConditions || "";
                    if (termsText) {
                        const splitTerms = pdf.splitTextToSize(termsText, width - 4);
                        splitTerms.forEach(l => { pdf.text(l, centerX, y, { align: 'center' }); y += 3; });
                    }
                    y += 2;
                    const footerMsg = settings.footerMessage || "Thank you, visit again";
                    const splitFooter = pdf.splitTextToSize(footerMsg, width - 4);
                    pdf.setFont('helvetica', 'bold');
                    splitFooter.forEach(l => { pdf.text(l, centerX, y, { align: 'center' }); y += 3; });
                    y += 3;
                    pdf.setFontSize(8);
                    pdf.text("Thank You", centerX, y, { align: 'center' });
                    y += 4;
                }

                // UPI QR Code
                if (grandTotal > 0 && sellerUpiIdValue) {
                    try {
                        const upiUrl = `upi://pay?pa=${sellerUpiIdValue}&am=${grandTotal.toFixed(2)}&cu=INR&tn=Bill%20Payment`;
                        const qrImg = await QRCode.toDataURL(upiUrl, { margin: 1, width: 120 });
                        const qrSize = size === '58mm' ? 25 : 30;
                        pdf.addImage(qrImg, 'PNG', centerX - (qrSize / 2), y, qrSize, qrSize);
                        y += qrSize + 4;
                    } catch (e) { }
                }

                // 6. Powered By Branding
                try {
                    const publicUrl = process.env.PUBLIC_URL || '';
                    const gsLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
                    const gsLogoRes = await fetch(gsLogo).catch(() => null);
                    if (gsLogoRes && gsLogoRes.ok) {
                        const blob = await gsLogoRes.blob();
                        const base64 = await new Promise(r => {
                            const reader = new FileReader();
                            reader.onloadend = () => r(reader.result);
                            reader.readAsDataURL(blob);
                        });
                        y += 2;
                        pdf.setFontSize(6);
                        pdf.setTextColor(160, 160, 160);
                        pdf.setFont('helvetica', 'normal');
                        pdf.text('Powered by ', centerX - 5, y + 3, { align: 'right' });
                        pdf.addImage(base64, 'PNG', centerX - 4.2, y + 0.2, 3.5, 3.5);
                        pdf.setFont('helvetica', 'bold');
                        pdf.text('Grocery Studio', centerX + 0.5, y + 3, { align: 'left' });
                        y += 6;
                    }
                } catch (e) { }

                return y + 2;
            };

            const tempPdf = new jsPDF('p', 'mm', [width, 1000]);
            const finalHeight = await drawContent(tempPdf);
            const pdf = new jsPDF('p', 'mm', [width, finalHeight]);
            await drawContent(pdf);

            // Watermark
            const sellerLogoUrl = order.sellerId?.logoUrl || order.sellerId?.profilePicture || settings.logoUrl;
            await addWatermarkToPDF(pdf, sellerLogoUrl || undefined);

            pdf.save(`Receipt-${displayInvNo}.pdf`);
        } catch (e) {
            console.error(e);
            alert('Error generating PDF');
        } finally {
            setDownloading(null);
        }
    };

    const getPaymentMethodBadgeClass = (method) => {
        const m = (method || '').toLowerCase();
        if (m === 'cash') return 'bg-green-50 text-green-700 border-green-100';
        if (m === 'card' || m === 'upi' || m === 'online') return 'bg-blue-50 text-blue-700 border-blue-100';
        if (m === 'due' || m === 'credit') return 'bg-red-50 text-red-700 border-red-100';
        return 'bg-gray-50 text-gray-700 border-gray-100';
    };

    if (verified && order) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-20 font-sans selection:bg-slate-200 dark:selection:bg-slate-800">
                {/* Download Progress Overlay */}
                {downloading && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-md animate-in fade-in duration-500"></div>
                        <div className="relative bg-white dark:bg-slate-900 p-10 rounded-sm shadow-[0_0_50px_rgba(0,0,0,0.3)] border border-white/20 dark:border-slate-800 flex flex-col items-center gap-6 animate-in zoom-in-95 slide-in-from-bottom-10 duration-500">
                            <div className="relative">
                                <div className="w-20 h-20 border-4 border-slate-100 dark:border-slate-800 rounded-full"></div>
                                <div className="absolute inset-0 border-4 border-slate-900 dark:border-white rounded-full border-t-transparent animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Download className="w-8 h-8 text-slate-900 dark:text-white animate-bounce" />
                                </div>
                            </div>
                            <div className="text-center space-y-2">
                                <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Download Started</h3>
                                <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.3em]">Preparing your documents...</p>
                            </div>
                            <div className="w-48 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-slate-900 dark:bg-white animate-progress"></div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Header - Glassmorphism */}
                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 px-4 py-4">
                    <div className="max-w-4xl mx-auto flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <div className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 p-2 rounded-full shadow-lg transition-transform hover:scale-110">
                                <FileText className="w-6 h-6" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight">Tax Invoice</h1>
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">#{order.invoiceNumber || order.id || 'N/A'}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-4">
                            <button
                                onClick={async () => {
                                    const storeName = order.sellerId?.shopName || 'our store';
                                    const shareText = `Hi, check out my bill from ${storeName}. View it here: ${window.location.href}`;
                                    if (navigator.share) {
                                        try {
                                            await navigator.share({
                                                title: `Bill from ${storeName}`,
                                                text: shareText,
                                                url: window.location.href
                                            });
                                        } catch (err) { }
                                    } else {
                                        const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
                                        window.open(waUrl, '_blank');
                                    }
                                }}
                                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white text-xs font-bold rounded-sm uppercase tracking-widest transition-all"
                            >
                                <Share2 className="w-4 h-4" />
                                Share
                            </button>
                            {(() => {
                                const method = (order.paymentMethod || '').toLowerCase();
                                const due = order.splitPaymentDetails?.dueAmount || (['due', 'credit'].includes(method) ? order.totalAmount : 0);
                                const isUnpaid = Number(due) >= Number(order.totalAmount) && Number(order.totalAmount) > 0;
                                const isPartial = Number(due) > 0 && Number(due) < Number(order.totalAmount);

                                if (isUnpaid) {
                                    return (
                                        <span className="inline-flex items-center px-4 py-1.5 bg-rose-500/10 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-bold rounded-sm uppercase tracking-widest border border-rose-500/20 shadow-sm shadow-rose-500/10">
                                            Unpaid
                                        </span>
                                    );
                                } else if (isPartial) {
                                    return (
                                        <span className="inline-flex items-center px-4 py-1.5 bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-bold rounded-sm uppercase tracking-widest border border-amber-500/20 shadow-sm shadow-amber-500/10">
                                            Partially Paid
                                        </span>
                                    );
                                }
                                return (
                                    <span className="inline-flex items-center px-4 py-1.5 bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold rounded-sm uppercase tracking-widest border border-emerald-500/20 shadow-sm shadow-emerald-500/10">
                                        Paid
                                    </span>
                                );
                            })()}
                        </div>
                    </div>
                </div>

                <div className="max-w-4xl mx-auto px-4 py-8">
                    {/* Main Card */}
                    <div className="bg-white dark:bg-slate-900 shadow-2xl shadow-slate-200/50 dark:shadow-black/50 border border-slate-100 dark:border-slate-800 rounded-sm overflow-hidden relative">

                        {/* Top Accent Bar */}
                        <div className="h-1.5 w-full bg-slate-900 dark:bg-slate-100" />

                        <div className="p-6 sm:p-10 space-y-10">

                            {/* Meta Grid - Premium Layout */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 border-b border-slate-100 dark:border-slate-800 pb-8">
                                <div className="md:col-span-1">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-2">Issued Date</p>
                                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatDateTime(order.createdAt || order.date)}</p>
                                </div>
                                <div className="md:col-span-3 grid grid-cols-2 sm:grid-cols-3 gap-8">
                                    <div className="col-span-2 sm:col-span-1">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-2">Billed To</p>
                                        <p className="text-lg font-bold text-slate-900 dark:text-white truncate">{order.customerName || 'Walk-in Customer'}</p>
                                        {order.customerMobile && <p className="text-sm text-slate-500 font-medium mt-1">{order.customerMobile}</p>}
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-2">Payment</p>
                                        {/* Strip existing badge classes and apply custom sharp ones */}
                                        <div className={`inline-block px-3 py-1 text-xs font-bold border rounded-sm ${getPaymentMethodBadgeClass(order.paymentMethod).replace(/rounded-full/g, '')}`}>
                                            {getPaymentMethodLabel(order.paymentMethod, order.splitPaymentDetails)}
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-2">Total Amount</p>
                                        <p className="text-2xl font-black text-slate-900 dark:text-white">
                                            ₹{Number(order.totalAmount).toFixed(2)}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Payment Breakdown Section */}
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-sm border border-slate-100 dark:border-slate-700">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-4">Payment Breakdown</p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                                    {(() => {
                                        const method = (order.paymentMethod || '').toLowerCase();
                                        const cash = order.paymentMethod?.toLowerCase() === 'split' ? (order.splitPaymentDetails?.cashAmount || 0) : (order.paymentMethod?.toLowerCase() === 'cash' ? order.totalAmount : 0);
                                        const online = order.paymentMethod?.toLowerCase() === 'split' ? (order.splitPaymentDetails?.onlineAmount || 0) : (['online', 'upi', 'card'].includes(order.paymentMethod?.toLowerCase()) ? order.totalAmount : 0);
                                        const due = order.paymentMethod?.toLowerCase() === 'split' ? (order.splitPaymentDetails?.dueAmount || 0) : (['due', 'credit'].includes(order.paymentMethod?.toLowerCase()) ? order.totalAmount : 0);

                                        return (
                                            <>
                                                {Number(cash) > 0 && (
                                                    <div>
                                                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Cash Payment</p>
                                                        <p className="text-base font-black text-slate-900 dark:text-white">₹{Number(cash).toFixed(2)}</p>
                                                    </div>
                                                )}
                                                {Number(online) > 0 && (
                                                    <div>
                                                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Online Payment</p>
                                                        <p className="text-base font-black text-slate-900 dark:text-white">₹{Number(online).toFixed(2)}</p>
                                                    </div>
                                                )}
                                                {Number(due) > 0 && (
                                                    <div>
                                                        <p className="text-[10px] text-rose-500 uppercase font-bold mb-1">Balance Due</p>
                                                        <p className="text-base font-black text-rose-600">₹{Number(due).toFixed(2)}</p>
                                                    </div>
                                                )}
                                                {Number(cash) === 0 && Number(online) === 0 && Number(due) === 0 && (
                                                    <div className="col-span-3">
                                                        <p className="text-sm font-bold text-emerald-600">Full Payment Settled</p>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* Items Section */}
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-widest mb-6 flex items-center gap-4">
                                    <span>Items Purchased</span>
                                    <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800"></div>
                                    <span className="text-slate-400 text-xs">({order.items?.length || 0})</span>
                                </h3>

                                {/* Desktop Table */}
                                <div className="hidden sm:block overflow-hidden border border-slate-200 dark:border-slate-700 rounded-sm">
                                    <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                                        <thead className="bg-slate-50 dark:bg-slate-800">
                                            <tr>
                                                <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">Description</th>
                                                <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">Qty</th>
                                                <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">Rate</th>
                                                <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                                            {order.items?.map((item, index) => {
                                                const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
                                                return (
                                                    <tr key={index} className="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                        <td className="px-6 py-4 text-sm font-bold text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-500 transition-colors">{item.name || 'N/A'}</td>
                                                        <td className="px-6 py-4 text-sm font-medium text-slate-600 dark:text-slate-400 text-right">{qty} {unit}</td>
                                                        <td className="px-6 py-4 text-sm font-medium text-slate-600 dark:text-slate-400 text-right">₹{Number(rate).toFixed(2)}</td>
                                                        <td className="px-6 py-4 text-sm font-black text-slate-900 dark:text-white text-right">₹{Number(total).toFixed(2)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot className="bg-slate-50 dark:bg-slate-800/50">
                                            <tr>
                                                <td colSpan="3" className="px-6 py-4 text-right text-[10px] font-bold uppercase tracking-widest text-slate-500">Sub Total</td>
                                                <td className="px-6 py-4 text-right text-base font-bold text-slate-700 dark:text-slate-300">
                                                    ₹{Number(order.items.reduce((acc, i) => acc + calculateItemRateAndTotal(i).total, 0)).toFixed(2)}
                                                </td>
                                            </tr>
                                            {order.discountAmount > 0 && (
                                                <tr>
                                                    <td colSpan="3" className="px-6 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-red-500">Discount</td>
                                                    <td className="px-6 py-2 text-right text-base font-bold text-red-600">
                                                        -₹{Number(order.discountAmount).toFixed(2)}
                                                    </td>
                                                </tr>
                                            )}
                                            {order.deliveryCharge > 0 && (
                                                <tr>
                                                    <td colSpan="3" className="px-6 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-slate-500">Delivery Charge</td>
                                                    <td className="px-6 py-2 text-right text-base font-bold text-slate-700 dark:text-slate-300">
                                                        ₹{Number(order.deliveryCharge).toFixed(2)}
                                                    </td>
                                                </tr>
                                            )}
                                            <tr>
                                                <td colSpan="3" className="px-6 py-6 text-right text-xs font-black uppercase tracking-widest text-slate-900 dark:text-white">Grand Total</td>
                                                <td className="px-6 py-6 text-right text-xl font-black text-slate-900 dark:text-white">
                                                    ₹{Number(order.totalAmount).toFixed(2)}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                                {/* Mobile List View */}
                                <div className="sm:hidden space-y-3">
                                    {order.items?.map((item, index) => {
                                        const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
                                        return (
                                            <div key={index} className="bg-slate-50 dark:bg-slate-800/50 p-4 border border-slate-200 dark:border-slate-700 rounded-sm">
                                                <div className="flex justify-between items-start mb-2">
                                                    <span className="font-bold text-slate-900 dark:text-white text-sm">{item.name}</span>
                                                    <span className="font-black text-slate-900 dark:text-white text-sm">₹{Number(total).toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-xs text-slate-500">
                                                    <span>{qty} {unit}</span>
                                                    <span>@ ₹{Number(rate).toFixed(2)}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2">
                                        {order.deliveryCharge > 0 && (
                                            <div className="flex justify-between items-center text-slate-500 text-sm">
                                                <span className="font-bold">Delivery Charge</span>
                                                <span className="font-bold">₹{Number(order.deliveryCharge).toFixed(2)}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center">
                                            <span className="font-black text-slate-900 dark:text-white uppercase tracking-widest text-xs">Total Paid</span>
                                            <span className="font-black text-slate-900 dark:text-white text-xl">₹{Number(order.totalAmount).toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* WhatsApp Community CTA */}
                            {order.sellerId?.whatsappLink && (
                                <div className="relative group overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/20 dark:to-teal-500/20 animate-pulse group-hover:animate-none transition-all"></div>
                                    <div className="relative p-6 sm:p-8 border border-emerald-100 dark:border-emerald-900/30 rounded-sm flex flex-col sm:flex-row items-center justify-between gap-6 overflow-hidden">
                                        <div className="flex items-center gap-5 z-10">
                                            <div className="bg-emerald-500 text-white p-4 rounded-full shadow-xl shadow-emerald-500/20 animate-bounce-slow">
                                                <MessageCircle className="w-8 h-8" />
                                            </div>
                                            <div className="space-y-1">
                                                <h4 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">Join Our Community</h4>
                                                <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Get exclusive offers, new arrivals & stock updates!</p>
                                            </div>
                                        </div>
                                        <a
                                            href={order.sellerId.whatsappLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm tracking-widest uppercase rounded-sm shadow-xl shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-1 transition-all group/btn"
                                        >
                                            <span>Join WhatsApp Group</span>
                                            <ExternalLink className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                                        </a>
                                        {/* Decorative Circle */}
                                        <div className="absolute -right-10 -bottom-10 w-32 h-32 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-full blur-3xl"></div>
                                    </div>
                                </div>
                            )}

                            {/* Download Section */}
                            <div className="pt-10 border-t border-slate-100 dark:border-slate-800">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-6 text-center">Download Official Receipt</p>
                                <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-4">
                                    <button
                                        onClick={generateA4PDF}
                                        disabled={!!downloading}
                                        className="group min-w-[240px] flex items-center justify-center gap-3 px-8 py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-sm tracking-wide rounded-sm shadow-xl shadow-slate-200 dark:shadow-black/30 hover:shadow-2xl hover:-translate-y-0.5 transition-all disabled:opacity-50"
                                    >
                                        {downloading === 'a4' ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                <span>Preparing PDF...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Download className="w-5 h-5 group-hover:animate-bounce" />
                                                <span>Download A4 Invoice</span>
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => generateThermalPDF('80mm')}
                                        disabled={!!downloading}
                                        className="group min-w-[240px] flex items-center justify-center gap-3 px-8 py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-sm tracking-wide rounded-sm shadow-xl shadow-slate-200 dark:shadow-black/30 hover:shadow-2xl hover:-translate-y-0.5 transition-all disabled:opacity-50"
                                    >
                                        {downloading === '80mm' ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                <span>Preparing 80mm...</span>
                                            </>
                                        ) : (
                                            <>
                                                <FileText className="w-5 h-5 group-hover:animate-pulse" />
                                                <span>Download 80mm Bill</span>
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => generateThermalPDF('58mm')}
                                        disabled={!!downloading}
                                        className="group min-w-[240px] flex items-center justify-center gap-3 px-8 py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-sm tracking-wide rounded-sm shadow-xl shadow-slate-200 dark:shadow-black/30 hover:shadow-2xl hover:-translate-y-0.5 transition-all disabled:opacity-50"
                                    >
                                        {downloading === '58mm' ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                <span>Preparing 58mm...</span>
                                            </>
                                        ) : (
                                            <>
                                                <FileText className="w-5 h-5 group-hover:animate-pulse" />
                                                <span>Download 58mm Bill</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>

                        </div>
                    </div>

                    <div className="mt-8 text-center pb-20 ">
                        <div className="flex items-center justify-center gap-4 opacity-40">
                            <div className="h-px w-8 bg-slate-300 dark:bg-slate-700"></div>
                            <img src="/assets/grocery-store-logo-removebg-preview.png" alt="GS" className="w-5 h-5 grayscale" />
                            <div className="h-px w-8 bg-slate-300 dark:bg-slate-700"></div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
            {/* Background Decorative Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20 dark:opacity-10">
                <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-slate-400 rounded-full blur-[120px]" />
                <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-slate-400 rounded-full blur-[120px]" />
            </div>

            <div className="w-full max-w-md relative z-10 flex flex-col items-center">
                {/* Branding */}
                <div className="mb-10 flex flex-col items-center animate-fadeInDown">
                    <div className="w-24 h-24 bg-white dark:bg-slate-800 rounded-full shadow-2xl shadow-slate-200/50 dark:shadow-none flex items-center justify-center p-4 mb-5 border border-white dark:border-slate-700 group hover:scale-105 transition-transform duration-500">
                        <img
                            src="/assets/grocery-store-logo-removebg-preview.png"
                            alt="Grocery studio Logo"
                            className="w-full h-full object-contain"
                            onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = "https://cdn-icons-png.flaticon.com/512/3724/3724720.png"; // Fallback icon
                            }}
                        />
                    </div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter flex items-center gap-2">
                        Grocery <span className="text-slate-500 dark:text-slate-400 italic">Studio</span>
                    </h1>
                    <div className="flex items-center gap-2 mt-3">
                        <div className="h-[1px] w-6 bg-slate-300 dark:bg-slate-700" />
                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.3em]">Official Receipt Portal</p>
                        <div className="h-[1px] w-6 bg-slate-300 dark:bg-slate-700" />
                    </div>
                </div>

                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-8 sm:p-10 rounded-sm shadow-2xl shadow-slate-200 dark:shadow-none w-full border border-white dark:border-slate-800 animate-fadeInUp">
                    <div className="text-center mb-10">
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight">Authentication Required</h2>
                        <p className="text-slate-500 dark:text-slate-400 mt-2 text-xs font-medium">
                            Enter mobile number for Invoice <span className="text-slate-900 dark:text-white font-black decoration-dotted underline underline-offset-4">#{invoiceNo}</span>
                        </p>
                    </div>

                    <form onSubmit={handleVerify} className="space-y-6">
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1 mb-2">Mobile Number</label>
                            <div className="relative group">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-slate-900 dark:group-focus-within:text-white transition-colors">
                                    <Phone className="w-full h-full" />
                                </div>
                                <input
                                    type="tel"
                                    value={mobileNumber}
                                    onChange={(e) => setMobileNumber(e.target.value)}
                                    className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-sm focus:ring-0 focus:border-slate-900 dark:focus:border-white outline-none transition-all dark:text-white font-bold text-lg placeholder:text-slate-300 dark:placeholder:text-slate-700"
                                    placeholder="98765 43210"
                                    maxLength={10}
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="p-4 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 text-xs font-bold rounded-sm flex items-center gap-3 border border-red-100 dark:border-red-900/20 animate-shake">
                                <AlertCircle className="w-5 h-5 shrink-0" />
                                <p>{error}</p>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full group py-4 rounded-sm bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-black text-sm tracking-widest uppercase transition-all shadow-xl shadow-slate-200 dark:shadow-none flex items-center justify-center gap-3 disabled:opacity-70"
                        >
                            {isLoading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    <span>Unlock Receipt</span>
                                    <Check className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-8 flex items-center justify-center gap-2 opacity-50">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Secure Connection</span>
                    </div>
                </div>

                <div className="mt-12 flex flex-col items-center opacity-30 hover:opacity-100 transition-opacity">
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-[0.2em] mb-2">Powered by</p>
                    <div className="flex items-center gap-2 grayscale group-hover:grayscale-0 transition-all duration-500">
                        <img src="/assets/grocery-store-logo-removebg-preview.png" alt="GS" className="w-5 h-5 object-contain" />
                        <span className="text-xs font-black text-slate-600 dark:text-slate-400">Grocery Studio</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ViewBill;

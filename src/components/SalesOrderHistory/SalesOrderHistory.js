import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { apiRequest } from '../../utils/api';
import {
  Calendar,
  Download,
  Eye,
  Receipt,
  IndianRupee,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  FileSpreadsheet,
  FileJson,
  X,
  Share2,
  CalendarRange,
  XCircle,
  ShoppingCart,
  Search,
  SearchX,
  Printer,
  Truck,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Wallet,
  Calculator,
  Target,
  FileClock,
  Package
} from 'lucide-react';
import QRCode from 'qrcode';
import { getAllItems, STORES } from '../../utils/indexedDB';
import jsPDF from 'jspdf';
import { sanitizeMobileNumber } from '../../utils/validation';
import { calculateItemRateAndTotal, formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import { getTranslation } from '../../utils/translations';
import { addWatermarkToPDF } from '../../utils/pdfUtils';
import { PageSkeleton, SkeletonStats, SkeletonCard } from '../UI/SkeletonLoader';



const SalesOrderHistory = () => {
  const { state } = useApp();
  const [isLoading, setIsLoading] = useState(() => {
    const hasData = state.orders?.length > 0 || state.transactions?.length > 0;
    return !hasData && !state.initialLoadDone;
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('all');
  const [filterDateRange, setFilterDateRange] = useState('today');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(25);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [isClosingOrderDetails, setIsClosingOrderDetails] = useState(false);
  const [showRefundsModal, setShowRefundsModal] = useState(false);

  // Print Modal State
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [orderToPrint, setOrderToPrint] = useState(null);
  const [selectedPrintFormat, setSelectedPrintFormat] = useState('a4');

  const handleCloseOrderDetails = () => {
    setIsClosingOrderDetails(true);
    setTimeout(() => {
      setShowOrderDetails(false);
      setSelectedOrder(null);
      setIsClosingOrderDetails(false);
    }, 400);
  };

  const [sellerSettings, setSellerSettings] = useState(null);

  useEffect(() => {
    const loadCustomSettings = async () => {
      try {
        const settingsList = await getAllItems(STORES.settings);
        if (settingsList && settingsList.length > 0) {
          setSellerSettings(settingsList[0]);
        }
      } catch (err) {
        console.error("Failed to load seller settings", err);
      }
    };
    loadCustomSettings();
  }, []);

  // Manage loading state
  // Manage loading state
  useEffect(() => {
    // If we have data, stop loading immediately to show content
    if (state.orders?.length > 0 || state.transactions?.length > 0 || state.initialLoadDone) {
      setIsLoading(false);
    }
  }, [state.initialLoadDone, state.dataFreshness, state.orders, state.transactions]);

  const showToast = (message, type = 'info') => {
    if (window.showToast) window.showToast(message, type);
  };

  // Helper: Safe text drawing for PDF (handles Hindi/UTF-8)
  const safeDrawText = (doc, text, x, y, options = {}) => {
    if (!text) return;
    const isHindi = /[\u0900-\u097F\u20B9]/.test(text.toString());
    if (isHindi) {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const fontSize = options.fontSize || 10;
        ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
        const metrics = ctx.measureText(text);
        const fontScale = 2; // High resolution
        canvas.width = metrics.width * fontScale + 10;
        canvas.height = fontSize * fontScale * 1.5;
        ctx.scale(fontScale, fontScale);
        ctx.fillStyle = options.color || '#000000';
        ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
        ctx.fillText(text, 0, fontSize);

        const dataUrl = canvas.toDataURL('image/png');
        // Convert px to mm (approx 3.78 px per mm)
        const w = metrics.width / 3.78;
        const h = (fontSize * 1.5) / 3.78;

        let drawX = x;
        if (options.align === 'right') drawX -= w;
        else if (options.align === 'center') drawX -= w / 2;

        doc.addImage(dataUrl, 'PNG', drawX, y - (fontSize / 2.5), w, h);
      } catch (e) {
        doc.text(text.toString(), x, y, options);
      }
    } else {
      doc.text(text.toString(), x, y, options);
    }
  };

  const getItemTotalAmount = (item) => {
    // Priority: item.total -> item.totalAmount -> (price * qty)
    const price = Number(item.sellingPrice ?? item.price ?? 0);
    const qty = Number(item.quantity ?? item.qty ?? 0);
    const baseTotal = Number(item.total ?? item.totalAmount ?? (price * qty));
    return Math.floor(baseTotal * 100) / 100;
  };



  // --- Thermal Bill Generation (Matches Billing.js) ---
  const generateThermalBill = async (size, invoiceNumber, billData) => {
    const width = size === '58mm' ? 58 : 80;
    const margin = 2; // small margin for thermal
    const centerX = width / 2;
    const items = billData.items || [];

    // Settings (Use state.currentUser as sellerSettings source in History)
    const settings = state.currentUser?.billSettings || {};
    const accentHex = settings.accentColor || '#2f3c7e';
    const hexToRgb = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 47, g: 60, b: 126 };
    };
    const rgb = hexToRgb(accentHex);

    const storeName = state.storeName || state.currentUser?.shopName || 'Grocery Store';
    const address = state.currentUser?.shopAddress || state.storeAddress || '';
    const phone = state.currentUser?.phoneNumber || state.currentUser?.phone || state.storePhone || '';
    const gstin = state.currentUser?.gstNumber || state.storeGstin || '';

    // Strict priority: Invoice Number > formatted ID. Avoid showing raw MongoDB IDs (24 char hex).
    // Strict priority: Invoice Number > formatted ID. Avoid showing raw MongoDB IDs (24 char hex).
    // Prioritize passed argument as well
    let displayInvNo = invoiceNumber || billData.invoiceNumber || billData.invoiceNo || billData.billNumber;

    // CRITICAL: If the resolved invoice number is a Mongo ID (24 hex chars), reject it and force fallback.
    if (displayInvNo && /^[0-9a-fA-F]{24}$/.test(String(displayInvNo))) {
      displayInvNo = null;
    }

    if (!displayInvNo) {
      // Fallbacks if no invoice number
      if (billData.id && String(billData.id).startsWith('ord-')) {
        displayInvNo = billData.id;
      } else if (billData.id && !/^[0-9a-fA-F]{24}$/.test(String(billData.id))) {
        // Use ID only if it's NOT a Mongo ID
        displayInvNo = billData.id;
      } else {
        // If all we have is a Mongo ID, try to show a cleaner date-based fallback or nothing
        // Match A4 fallback format exactly
        displayInvNo = `INV-${new Date(billData.date || Date.now()).getTime().toString().slice(-6)}`;
      }
    }
    const billNo = displayInvNo;

    // Date formatting
    const dateObj = billData.date ? new Date(billData.date) : new Date();
    const dateStr = dateObj.toLocaleDateString('en-IN');

    const itemsTotal = items.reduce((acc, item) => {
      const { total } = calculateItemRateAndTotal(item);
      return acc + total;
    }, 0);
    const discountAmount = billData.discountAmount || ((itemsTotal * (billData.discountPercent || 0)) / 100);
    let deliveryCharge = billData.deliveryCharge || 0;
    const taxPercent = billData.taxPercent || 0;
    const taxAmount = (billData.taxAmount !== undefined && billData.taxAmount !== null) ? billData.taxAmount : ((itemsTotal - discountAmount) * taxPercent / 100);

    // Fallback: If delivery charge is missing but there is a gap between a provided total and calculated total, infer it.
    const tempGrandTotal = billData.totalAmount || billData.total || 0;
    if (tempGrandTotal > 0 && !deliveryCharge && tempGrandTotal > (itemsTotal - discountAmount + taxAmount + 1)) {
      deliveryCharge = tempGrandTotal - (itemsTotal - discountAmount + taxAmount);
    }

    const grandTotal = billData.totalAmount || billData.total || (itemsTotal - discountAmount + taxAmount + deliveryCharge);
    const sellerUpiIdValue = billData.upiId || state.currentUser?.upiId;

    // Helper: Draw Content
    const drawContent = async (pdf) => {
      let y = 5;

      const drawDashedLine = (yPos) => {
        pdf.setLineDash([1, 1], 0);
        pdf.setDrawColor(0);
        pdf.line(margin, yPos, width - margin, yPos);
        pdf.setLineDash([], 0);
      };

      // HEADER
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
      const metaY = y;
      pdf.setFontSize(8);
      pdf.setTextColor(150, 0, 0);
      pdf.text("Inv No", margin, metaY);
      const invLabelWidth = pdf.getTextWidth("Inv No ");

      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'bold');

      // Handle long invoice numbers
      // Handle long invoice numbers: Do not slice arbitrarily if it obscures the ID
      let displayBillNo = billNo;
      // if (size === '58mm' && billNo.length > 12) displayBillNo = billNo.slice(-12); // Removed arbitrary slicing

      if (size === '58mm') {
        pdf.text(displayBillNo, margin, metaY + 3.5);
        y += 4; // Extra spacing for wrapped invoice number to prevent overlap
      } else {
        pdf.text(displayBillNo, margin + invLabelWidth, metaY);
      }

      const dateValWidth = pdf.getTextWidth(dateStr);
      pdf.text(dateStr, width - margin, metaY, { align: 'right' });
      pdf.setTextColor(150, 0, 0);
      const dateLabelWidth = pdf.getTextWidth("Date ");
      pdf.text("Date ", width - margin - dateValWidth - dateLabelWidth, metaY);

      pdf.setTextColor(0, 0, 0);
      y += 5;

      // Customer Info
      const displayCustomerName = billData.customerName || 'Walk-in Customer';
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`Customer name: ${displayCustomerName}`, margin, y);
      y += 4;

      if (billData.customerMobile) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.text(`Mobile no.: ${billData.customerMobile}`, margin, y);
        y += 4;
      }

      drawDashedLine(y);
      y += 3;

      // TABLE HEADER
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
        { name: "QTY.", x: width - margin - 28, align: 'right' },
        { name: "Price", x: width - margin - 15, align: 'right' },
        { name: "Amount", x: width - margin, align: 'right' }
      ];

      cols.forEach(c => pdf.text(c.name, c.x, y, { align: c.align }));
      y += 2;
      drawDashedLine(y);
      y += 3;

      // TABLE BODY
      pdf.setFont('helvetica', 'bold');
      let totalQty = 0;
      items.forEach((item, index) => {
        const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
        totalQty += qty;

        pdf.text(String(index + 1), cols[0].x, y);

        // Name Wrapping Logic
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

      // TOTALS
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`Total Item(s): ${items.length}`, margin, y);
      const qtyText = `Qty.: ${totalQty.toFixed(2)}`;
      const qtyX = width / 2;
      pdf.text(qtyText, qtyX, y, { align: 'center' });
      pdf.text(Number(itemsTotal).toFixed(2), width - margin, y, { align: 'right' });

      y += 3;
      drawDashedLine(y);
      y += 4;

      // DETAILS (Tax, etc)
      // Since this is history, we might not have full tax breakdown if not stored.
      // We will try to reconstruct if items have tax info
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
      if (deliveryCharge > 0) {
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.text("Delivery Charge", margin, y);
        pdf.text(Number(deliveryCharge).toFixed(2), width - margin, y, { align: 'right' });
        y += 4;
      }

      // Discount
      if (discountAmount > 0) {
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.text("Discount", margin, y);
        pdf.text(`- ${Number(discountAmount).toFixed(2)}`, width - margin, y, { align: 'right' });
        y += 4;
      }

      // Tax
      if (taxAmount > 0) {
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Tax (${taxPercent}%)`, margin, y);
        pdf.text(Number(taxAmount).toFixed(2), width - margin, y, { align: 'right' });
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

      // FOOTER MSG
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
        pdf.setFont('helvetica', 'bold');
        pdf.text("Thank You", centerX, y, { align: 'center' });
        y += 4;
      }

      // QR CODE
      if (Number(grandTotal) > 0 && sellerUpiIdValue) {
        try {
          const upiUrl = `upi://pay?pa=${sellerUpiIdValue}&am=${Number(grandTotal).toFixed(2)}&cu=INR&tn=Bill%20Payment`;
          const qrResult = await QRCode.toDataURL(upiUrl, { margin: 1, width: 120 });
          if (qrResult) {
            const qrSize = size === '58mm' ? 25 : 30;
            pdf.addImage(qrResult, 'PNG', centerX - (qrSize / 2), y, qrSize, qrSize);
            y += qrSize + 2;
            pdf.setFontSize(8);
            pdf.text("Scan to Pay", centerX, y + 2, { align: 'center' });
            y += 5;
          }
        } catch (e) { }
      }

      // 6. Powered By Branding
      try {
        const publicUrl = process.env.PUBLIC_URL || '';
        const gsLogo = `${publicUrl}/assets/inventory-studio-logo-removebg.png`;
        const gsLogoRes = await fetch(gsLogo).catch(() => null);
        if (gsLogoRes && gsLogoRes.ok) {
          const blob = await gsLogoRes.blob();
          const base64 = await new Promise(r => {
            const reader = new FileReader();
            reader.onloadend = () => r(reader.result);
            reader.readAsDataURL(blob);
          });
          // Center GS logo at bottom
          y += 4;
          const centerX = width / 2;
          pdf.setFontSize(6);
          pdf.setTextColor(160, 160, 160);
          pdf.setFont('helvetica', 'normal');
          pdf.text('Powered by ', centerX - 5, y + 3, { align: 'right' });
          pdf.addImage(base64, 'PNG', centerX - 4.2, y + 0.2, 3.5, 3.5);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Inventory Studio', centerX + 0.5, y + 3, { align: 'left' });
          y += 6;
        }
      } catch (e) { }

      return y + 2;
    };

    // 1. Calc Height
    const tempPdf = new jsPDF('p', 'mm', [width, 1000]);
    const height = await drawContent(tempPdf);

    // 2. Generate Real PDF
    const pdf = new jsPDF('p', 'mm', [width, height]);
    await drawContent(pdf);



    pdf.save(`Receipt-${billNo}.pdf`);
  };
  // --- A4 Bill Generation (Matches Billing.js) ---
  const generateA4Bill = async (billData) => {
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;

    // Use state.currentUser for settings
    const settings = state.currentUser?.billSettings || {};
    const accentHex = settings.colors?.accent || settings.accentColor || '#2f3c7e';
    const hexToRgb = (hex) => {
      const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return res ? [parseInt(res[1], 16), parseInt(res[2], 16), parseInt(res[3], 16)] : [47, 60, 126];
    };
    const accentColor = hexToRgb(accentHex);

    const COLORS = {
      accent: accentColor,
      text: [30, 41, 59],
      slate400: [148, 163, 184],
      slate50: [248, 250, 252],
      border: [241, 245, 249],
      white: [255, 255, 255]
    };

    // 1. Header Bar
    pdf.setFillColor(...COLORS.accent);
    pdf.rect(0, 0, pageWidth, 2, 'F');
    let y = 10;

    /* Logo Removed
    const logoShow = settings.showLogo !== false;
    if (logoShow) {
        // ... logo code removed ...
    }
    */
    const logoOffset = 0;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(22);
    pdf.setTextColor(...COLORS.accent);
    const storeName = state.storeName || state.currentUser?.shopName || 'Grocery Store';
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

    // Shop Address
    pdf.setDrawColor(...COLORS.accent);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y, margin, y + 15);
    pdf.setFontSize(9);
    pdf.setTextColor(71, 85, 105);

    const mainAddr = state.currentUser?.shopAddress || state.storeAddress || '';
    if (mainAddr) pdf.text(mainAddr, margin + 4, y + 3);

    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100, 116, 139);

    // Attempt to construct addr2 if available or leave blank spacer to match ViewBill
    const addr2 = [state.currentUser?.city, state.currentUser?.state, state.currentUser?.pincode].filter(Boolean).join(' - ');
    if (addr2) pdf.text(addr2, margin + 4, y + 7);

    const phone = state.currentUser?.phoneNumber || state.currentUser?.phone || state.storePhone || '';
    if (phone) pdf.text(`Phone: ${phone}`, margin + 4, y + 11);

    const gstin = state.currentUser?.gstNumber || state.storeGstin || '';
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...COLORS.text);
    if (gstin) pdf.text(`GSTIN: ${gstin}`, margin + 4, y + 15);

    // Bill Info
    // Bill Info
    // Adjust label position (moved from -45 to -25 to reduce gap as per user request)
    pdf.setFontSize(9);
    pdf.setTextColor(...COLORS.slate400);
    const labelX = pageWidth - margin - 25;
    pdf.text('Invoice No', labelX, y + 15, { align: 'right' });
    pdf.text('Date', labelX, y + 20, { align: 'right' });
    pdf.text('Payment', labelX, y + 25, { align: 'right' });

    pdf.setTextColor(...COLORS.text);
    pdf.setTextColor(...COLORS.text);
    // Strict priority: Invoice Number > formatted ID. Avoid showing raw MongoDB IDs (24 char hex).
    let displayInvNo = billData.invoiceNumber || billData.invoiceNo || billData.billNumber;

    if (!displayInvNo) {
      // Fallbacks if no invoice number
      if (billData.id && String(billData.id).startsWith('ord-')) {
        displayInvNo = billData.id;
      } else if (billData.id && !/^[0-9a-fA-F]{24}$/.test(String(billData.id))) {
        // Use ID only if it's NOT a Mongo ID
        displayInvNo = billData.id;
      } else {
        // If all we have is a Mongo ID, try to show a cleaner date-based fallback or nothing
        displayInvNo = `INV-${new Date(billData.date || Date.now()).getTime().toString().slice(-6)}`;
      }
    }

    pdf.text(displayInvNo, pageWidth - margin, y + 15, { align: 'right' });
    const dateStr = billData.date ? new Date(billData.date).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
    pdf.text(dateStr, pageWidth - margin, y + 20, { align: 'right' });
    const pMethod = (billData.paymentMethod || 'PAID').toUpperCase();
    pdf.text(pMethod, pageWidth - margin, y + 25, { align: 'right' });

    if (pMethod === 'SPLIT' && billData.splitPaymentDetails) {
      const parts = [];
      if (billData.splitPaymentDetails.cashAmount > 0) parts.push(`Cash: ${Number(billData.splitPaymentDetails.cashAmount).toFixed(2)}`);
      if (billData.splitPaymentDetails.onlineAmount > 0) parts.push(`Online: ${Number(billData.splitPaymentDetails.onlineAmount).toFixed(2)}`);
      if (billData.splitPaymentDetails.dueAmount > 0) parts.push(`Due: ${Number(billData.splitPaymentDetails.dueAmount).toFixed(2)}`);

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
    safeDrawText(pdf, (billData.customerName || 'Walk-in Customer').toUpperCase(), margin, y, { fontSize: 10 });
    pdf.text('LOCAL (WITHIN STATE)', pageWidth - margin, y, { align: 'right' });
    y += 8;
    pdf.line(margin, y, pageWidth - margin, y);
    y += 10;

    // 4. Table Header
    pdf.setFillColor(0, 0, 0); // Black header per user image
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

    const items = billData.items || [];
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
      // Position HSN below the name
      const hsnY = y + 6 + nameHeight;
      pdf.text(`HSN: ${item.hsnCode || '1001'} • CGST+SGST`, margin + 12, hsnY);

      pdf.setFontSize(9);
      pdf.setTextColor(...COLORS.text);
      pdf.text(`${qty} ${unit}`, margin + 100, y + 7.5, { align: 'center' });
      pdf.text(rate.toFixed(2), margin + 130, y + 7.5, { align: 'right' });
      pdf.text(`${item.gstPercent || 0}%`, margin + 155, y + 7.5, { align: 'right' });
      pdf.text(total.toFixed(2), pageWidth - margin - 4, y + 7.5, { align: 'right' });

      // Tax Calculation (Reconstruct)
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

    // Explicit Totals from billData fallbacks
    const itemsTotal = items.reduce((acc, i) => acc + calculateItemRateAndTotal(i).total, 0);
    const discountAmount = billData.discountAmount || ((itemsTotal * (billData.discountPercent || 0)) / 100);
    const taxPercent = billData.taxPercent || 0;
    const taxAmount = (billData.taxAmount !== undefined && billData.taxAmount !== null) ? billData.taxAmount : ((itemsTotal - discountAmount) * taxPercent / 100);
    const deliveryCharge = billData.deliveryCharge || 0;
    const grandTotal = billData.totalAmount || billData.total || (itemsTotal - discountAmount + taxAmount + deliveryCharge);

    const footerY = y;

    // Left Side: Terms
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
    const sellerUpiIdValue = billData.upiId || state.currentUser?.upiId;
    if (grandTotal > 0 && sellerUpiIdValue && sellerUpiIdValue.includes('@')) {
      try {
        const qrUrl = `upi://pay?pa=${sellerUpiIdValue}&am=${grandTotal.toFixed(2)}&cu=INR&tn=Bill%20Payment`;
        const qrImg = await QRCode.toDataURL(qrUrl, { margin: 1, width: 100 });
        pdf.addImage(qrImg, 'PNG', margin, y, 20, 20);
        pdf.setFontSize(7);
        pdf.setTextColor(...COLORS.slate400);
        pdf.setFont('helvetica', 'bold');
        pdf.text('SCAN TO PAY', margin + 25, y + 8);
      } catch (e) { }
    }

    // Right Side: Totals
    y = footerY;
    const rightColX = pageWidth - margin - 60;
    const valX = pageWidth - margin;

    pdf.setFontSize(9);
    pdf.setTextColor(...COLORS.slate400);
    pdf.setFont('helvetica', 'bold');
    pdf.text('SUB TOTAL', rightColX, y);
    pdf.setTextColor(...COLORS.text);
    // Use reconstructed totals for consistency with table
    pdf.text(`Rs. ${itemsTotal.toFixed(2)}`, valX, y, { align: 'right' });

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

    if (deliveryCharge > 0) {
      y += 6;
      pdf.setTextColor(...COLORS.slate400);
      pdf.text('DELIVERY CHARGE', rightColX, y);
      pdf.setTextColor(...COLORS.text);
      pdf.text(`Rs. ${deliveryCharge.toFixed(2)}`, valX, y, { align: 'right' });
    }

    if (taxAmount > 0) {
      y += 6;
      pdf.setTextColor(...COLORS.slate400);
      pdf.text(`ADDITIONAL TAX (${taxPercent}%)`, rightColX, y);
      pdf.setTextColor(...COLORS.text);
      pdf.text(`Rs. ${taxAmount.toFixed(2)}`, valX, y, { align: 'right' });
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

    // Payment Method Split Details (Removed from footer, moved to header)

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

    // 6. Powered By Branding
    try {
      const publicUrl = process.env.PUBLIC_URL || '';
      const gsLogo = `${publicUrl}/assets/inventory-studio-logo-removebg.png`;
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
        pdf.text('Inventory Studio', pageWidth / 2 + 0.5, gsY, { align: 'left' });
      }
    } catch (e) { }

    pdf.save(`Invoice-${displayInvNo}.pdf`);
  };

  // Renamed old printOrder to initiatePrint
  const initiatePrint = (order) => {
    setOrderToPrint(order);
    // Default to saved preference or A4
    const savedFormat = localStorage.getItem('printSize') || sellerSettings?.billSettings?.billFormat || 'a4';
    setSelectedPrintFormat(savedFormat);
    setShowPrintModal(true);
  };

  const executePrint = async (format) => {
    const order = orderToPrint;
    try {
      if (!order) return;

      // Save user preference
      localStorage.setItem('printSize', format);

      const printSize = format;

      let freshOrder = { ...order };
      // Always attempt to fetch fresh data (specifically Invoice Number and Delivery Charge) from server
      // This ensures we have the most up-to-date details like delivery charges which might be missing from stale local data
      if (freshOrder.customerMobile) {
        try {
          const res = await apiRequest('/public/verify-bill', {
            method: 'POST',
            body: {
              invoiceNo: freshOrder.id, // Use local ID to find the order
              mobileNumber: freshOrder.customerMobile
            }
          });
          if (res && res.success && res.order && res.order.invoiceNumber) {
            // Merge server data, prioritizing server invoice number
            freshOrder = { ...freshOrder, ...res.order };
          }
        } catch (e) {
          // Silently fail and use local data
        }
      }

      const billData = {
        ...freshOrder,
        // Ensure invoiceNumber is passed clearly. Check multiple possible keys.
        // DO NOT fallback to 'id' here directly to avoid polluting invoiceNumber with Mongo IDs
        invoiceNumber: freshOrder.invoiceNumber || freshOrder.invoiceNo || freshOrder.billNumber,
        id: freshOrder.id || freshOrder._id, // Keep internal ID separate
        customerName: freshOrder.customerName,
        customerMobile: freshOrder.customerMobile,
        items: freshOrder.items,
        total: freshOrder.totalAmount || freshOrder.total,
        date: freshOrder.createdAt || freshOrder.date,
        upiId: freshOrder.upiId || state.currentUser?.upiId || state.upiId || sellerSettings?.billSettings?.upiId,
        paymentMethod: freshOrder.paymentMethod,
        splitPaymentDetails: freshOrder.splitPaymentDetails
      };

      showToast(`Generating ${printSize.toUpperCase()} Bill...`, 'info');

      if (printSize === '58mm' || printSize === '80mm') {
        await generateThermalBill(printSize, billData.invoiceNumber, billData);
      } else {
        await generateA4Bill(billData);
      }

      setShowPrintModal(false);
      setOrderToPrint(null);

    } catch (error) {
      console.error('Print Error:', error);
      showToast('Failed to generate print', 'error');
    }
  };

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showCustomDateModal, setShowCustomDateModal] = useState(false);
  const [customDateRange, setCustomDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [tempCustomRange, setTempCustomRange] = useState({ ...customDateRange });
  const exportMenuRef = useRef(null);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && typeof exportMenuRef.current.contains === 'function' && event.target && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };

    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu]);

  // Get all orders (excluding deleted) and enrich with customer details
  const allOrders = useMemo(() => {
    return (state.orders || []).filter(order => !order.isDeleted).map(order => {
      // Enrich with customer details if missing
      if ((!order.customerName || !order.customerMobile) && order.customerId) {
        const customer = state.customers.find(c => c.id === order.customerId || c._id === order.customerId);
        if (customer) {
          return {
            ...order,
            customerName: order.customerName || customer.name,
            customerMobile: order.customerMobile || customer.mobileNumber || customer.phone || ''
          };
        }
      }
      return order;
    });
  }, [state.orders, state.customers]);

  // Filter orders
  const filteredOrders = useMemo(() => {
    let filtered = allOrders;

    // Search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(order => {
        const customerName = (order.customerName || '').toLowerCase();
        const customerMobile = (order.customerMobile || '').toLowerCase();
        const orderId = (order.id || '').toString().toLowerCase();

        return customerName.includes(searchLower) ||
          customerMobile.includes(searchLower) ||
          orderId.includes(searchLower);
      });
    }

    // Payment method filter
    if (filterPaymentMethod !== 'all') {
      filtered = filtered.filter(order => {
        const paymentMethod = (order.paymentMethod || '').toLowerCase();
        if (filterPaymentMethod.toLowerCase() === 'online') {
          return paymentMethod === 'card' || paymentMethod === 'upi' || paymentMethod === 'online' ||
            (paymentMethod === 'split' && order.splitPaymentDetails && order.splitPaymentDetails.onlineAmount > 0);
        }
        if (filterPaymentMethod.toLowerCase() === 'cash') {
          return paymentMethod === 'cash' ||
            (paymentMethod === 'split' && order.splitPaymentDetails && order.splitPaymentDetails.cashAmount > 0);
        }
        if (filterPaymentMethod.toLowerCase() === 'due') {
          return paymentMethod === 'due' || paymentMethod === 'credit' ||
            (paymentMethod === 'split' && order.splitPaymentDetails && order.splitPaymentDetails.dueAmount > 0);
        }
        return paymentMethod === filterPaymentMethod.toLowerCase();
      });
    }

    // Date range filter
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    filtered = filtered.filter(order => {
      const orderDate = new Date(order.createdAt || order.date || 0);
      if (Number.isNaN(orderDate.getTime())) return false;
      orderDate.setHours(0, 0, 0, 0);

      switch (filterDateRange) {
        case 'today':
          return orderDate.getTime() === today.getTime();
        case 'week':
          const weekAgo = new Date(today);
          weekAgo.setDate(weekAgo.getDate() - 7);
          return orderDate >= weekAgo;
        case 'month':
          const monthAgo = new Date(today);
          monthAgo.setDate(monthAgo.getDate() - 30);
          return orderDate >= monthAgo;
        case 'custom':
          const customStart = new Date(customDateRange.start);
          customStart.setHours(0, 0, 0, 0);
          const customEnd = new Date(customDateRange.end);
          customEnd.setHours(23, 59, 59, 999);
          return orderDate >= customStart && orderDate <= customEnd;
        case 'all':
          return true;
        default:
          return true;
      }
    });

    // Sort by date (newest first)
    return filtered.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.date || 0);
      const dateB = new Date(b.createdAt || b.date || 0);
      return dateB - dateA;
    });
  }, [allOrders, searchTerm, filterPaymentMethod, filterDateRange, customDateRange]);

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedOrders = filteredOrders.slice(startIndex, startIndex + itemsPerPage);

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('ellipsis');
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('ellipsis');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    }
    return pages;
  };

  // Calculate stats
  // Modified to skip online orders that are not 'Delivered'
  const shouldCountOrder = (order) => {
    if (order.orderSource === 'online') {
      return order.orderStatus === 'Delivered';
    }
    return true;
  };

  // Calculate delivery charge for a single order (with inference)
  const getOrderDeliveryCharge = (order) => {
    const items = order.items || [];
    const discountAmount = Number(order.discountAmount || order.discount || 0);

    let itemsTotal = 0;
    // We use the imported helper if available, or fallback to simple calc
    if (items.length > 0) {
      items.forEach(item => {
        const { total } = calculateItemRateAndTotal(item);
        itemsTotal += total;
      });
    }

    const grandTotal = Number(order.totalAmount || order.total || 0);
    let deliveryCharge = Number(order.deliveryCharge || 0);

    // Fallback Inference
    if (!deliveryCharge && grandTotal > (itemsTotal - discountAmount + 1)) {
      deliveryCharge = grandTotal - (itemsTotal - discountAmount);
    }
    return Math.max(0, deliveryCharge);
  };

  // Calculate display totals (Final and Original/Cuted)
  // Calculate display totals (Final and Original/Cuted)
  // Calculate display totals (Final and Original/Cuted)
  const getOrderDisplayTotals = (order) => {
    const finalTotal = Number(order.totalAmount || order.total || 0);
    const items = order.items || [];

    let itemsSubtotal = 0;

    if (items.length > 0) {
      itemsSubtotal = items.reduce((sum, item) => {
        const { total } = calculateItemRateAndTotal(item);
        return sum + total;
      }, 0);
    } else {
      // Fallback: Final + Discount - Tax - Delivery
      const discount = Number(order.discountAmount || order.discount || 0);
      const delivery = Number(order.deliveryCharge || 0);
      const tax = Number(order.taxAmount || 0);

      itemsSubtotal = finalTotal + discount - delivery - tax;
      if (itemsSubtotal < 0) itemsSubtotal = finalTotal;
    }

    // STRICT CHECK: Only show strikethrough if there is an EXPLICIT discount.
    // User considers manual overrides as "The Price" if no discount is explicitly recorded.
    const explicitDiscountAmount = Number(order.discountAmount || order.discount || 0);
    const explicitDiscountPercent = Number(order.discountPercent || 0);

    // We only treat it as a discount if the system has a record of it being a discount
    const hasExplicitDiscount = explicitDiscountAmount > 0.05 || explicitDiscountPercent > 0;

    // Additionally, the math must support it (Original > Final)
    // We add a small tolerance for floating point + potential tax addition scenarios
    const isMathDiscount = itemsSubtotal > (finalTotal + 0.05);

    // Final decision: Must be explicit AND mathematically lower
    const showDiscount = hasExplicitDiscount && isMathDiscount;

    return {
      finalTotal,
      originalTotal: showDiscount ? itemsSubtotal : finalTotal, // Hide original if no discount
      hasDiscount: showDiscount,
      discount: showDiscount ? (itemsSubtotal - finalTotal) : 0
    };
  };

  // Calculate period refunds
  const periodRefunds = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    let startDate, endDate;

    switch (filterDateRange) {
      case 'today':
        startDate = today;
        endDate = tomorrow;
        break;
      case 'week':
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);
        endDate = tomorrow;
        break;
      case 'month':
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 30);
        endDate = tomorrow;
        break;
      case 'custom':
        startDate = new Date(customDateRange.start);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(customDateRange.end);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'all':
        startDate = new Date(0);
        endDate = new Date(8640000000000000); // Far future
        break;
      default:
        startDate = new Date(0);
        endDate = new Date(8640000000000000); // Far future
    }

    return (state.refunds || []).filter(refund => {
      const rDateValue = refund.refundDate || refund.createdAt || refund.date;
      if (!rDateValue) return filterDateRange === 'all';
      const rDate = new Date(rDateValue);
      if (Number.isNaN(rDate.getTime())) return filterDateRange === 'all';
      return rDate >= startDate && rDate <= endDate;
    });
  }, [state.refunds, filterDateRange, customDateRange]);

  // Calculate Total Refunds and their impacts for the selected period
  const refundImpacts = useMemo(() => {

    const impacts = {
      product: 0,
      delivery: 0,
      cash: 0,
      online: 0,
      due: 0,
      cod: 0,
      pending: 0,
      overall: 0
    };

    periodRefunds.forEach(refund => {
      const amount = Number(refund.totalRefundAmount || refund.amount || 0);
      impacts.overall += amount;

      const rid = (refund.orderId || refund.orderID || refund.order_id || '').toString();
      const order = (state.orders || []).find(o =>
        (o._id && o._id.toString() === rid) ||
        (o.id && o.id.toString() === rid)
      );

      if (order) {
        const grandTotal = Number(order.totalAmount || order.total || 0);
        const delivery = getOrderDeliveryCharge(order);
        const productTotal = grandTotal - delivery;

        const isDelivered = shouldCountOrder(order);
        const ratio = grandTotal > 0 ? (amount / grandTotal) : 1;

        if (isDelivered) {
          impacts.product += productTotal * ratio;
          impacts.delivery += delivery * ratio;

          const method = (order.paymentMethod || '').toLowerCase();
          const details = order.splitPaymentDetails || {};

          if (method === 'cash') impacts.cash += amount;
          else if (method === 'online' || method === 'upi' || method === 'card') impacts.online += amount;
          else if (method === 'due' || method === 'credit') impacts.due += amount;
          else if (method === 'cod') impacts.cod += amount;
          else if (method === 'split') {
            impacts.cash += amount * ((details.cashAmount || 0) / (grandTotal || 1));
            impacts.online += amount * ((details.onlineAmount || 0) / (grandTotal || 1));
            impacts.due += amount * ((details.dueAmount || 0) / (grandTotal || 1));
          }
        } else if (order.orderSource === 'online' && order.orderStatus !== 'Cancelled') {
          // Subtract from pending sales if order is pending online
          impacts.pending += amount;
        }
      } else {
        // Fallback: attribute to product sales and cash
        impacts.product += amount;
        impacts.cash += amount;
      }
    });

    return impacts;
  }, [periodRefunds, state.orders]);

  const totalRefunds = refundImpacts.overall;

  const calculateOrderCost = (order) => {
    const normalizeOrderItems = (o) => Array.isArray(o?.items) ? o.items : [];
    const sanitizeNumber = (v) => (typeof v === 'number' ? v : parseFloat(v)) || 0;

    return normalizeOrderItems(order).reduce((sum, item) => {
      const unitCost = sanitizeNumber(item.costPrice ?? item.purchasePrice ?? item.unitCost ?? item.basePrice ?? 0);
      const totalCostProp = sanitizeNumber(item.totalCostPrice);
      const finalItemCost = totalCostProp > 0 ? totalCostProp : unitCost;
      return sum + finalItemCost;
    }, 0);
  };

  const getOrderPendingProfit = (order) => {
    const finalTotal = Number(order.totalAmount || order.total || 0);
    const cost = calculateOrderCost(order);
    return finalTotal - cost;
  };

  // Map refunds to orders for lookup with robust ID matching
  const refundsMap = useMemo(() => {
    const map = {};
    (state.refunds || []).forEach(refund => {
      const rid = (refund.orderId || refund.order_id || refund.orderID || '').toString();
      if (!rid) return;

      // Find the corresponding order to ensure we use the correct key(s)
      const order = (state.orders || []).find(o =>
        (o._id && o._id.toString() === rid) ||
        (o.id && o.id.toString() === rid)
      );

      const amount = Number(refund.totalRefundAmount || refund.amount || 0);

      if (order) {
        // Map to both possible IDs used for lookup in the table
        const mongoId = order._id?.toString();
        const localId = order.id?.toString();

        if (mongoId) map[mongoId] = (map[mongoId] || 0) + amount;
        if (localId && localId !== mongoId) map[localId] = (map[localId] || 0) + amount;
      } else {
        // Fallback: use the ID present in the refund
        map[rid] = (map[rid] || 0) + amount;
      }
    });
    return map;
  }, [state.refunds, state.orders]);

  const totalDeliveryCharges = filteredOrders.reduce((sum, order) => {
    if (!shouldCountOrder(order)) return sum;
    const refund = refundsMap[order._id || order.id] || 0;
    const gross = Number(order.totalAmount) || Number(order.total) || 0;
    const delivery = getOrderDeliveryCharge(order);
    const deliveryRefund = delivery * (refund / (gross || 1));
    return sum + (delivery - deliveryRefund);
  }, 0);

  const totalSales = filteredOrders.reduce((sum, order) => {
    if (!shouldCountOrder(order)) return sum;
    const refund = refundsMap[order._id || order.id] || 0;
    const gross = Number(order.totalAmount) || Number(order.total) || 0;
    const delivery = getOrderDeliveryCharge(order);
    const productSales = gross - delivery;
    const productRefund = productSales * (refund / (gross || 1));
    return sum + (productSales - productRefund);
  }, 0);

  // New Metrics to realign with Financial page
  const totalCogs = useMemo(() => {
    const grossCogs = filteredOrders.reduce((sum, order) => {
      if (!shouldCountOrder(order)) return sum;
      return sum + calculateOrderCost(order);
    }, 0);

    // Estimate refunded cost (proportional to refund amount)
    const totalRefundedCost = filteredOrders.reduce((sum, order) => {
      if (!shouldCountOrder(order)) return sum;
      const refund = refundsMap[order._id || order.id] || 0;
      const gross = Number(order.totalAmount) || Number(order.total) || 0;
      const orderCost = calculateOrderCost(order);
      const refundedCost = orderCost * (refund / (gross || 1));
      return sum + refundedCost;
    }, 0);

    return grossCogs - totalRefundedCost;
  }, [filteredOrders, refundsMap]);

  const grossProfit = totalSales - totalCogs;

  const { pettyExpenses, purchaseExpenses } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    let startDate, endDate;
    switch (filterDateRange) {
      case 'today': startDate = today; endDate = tomorrow; break;
      case 'week': startDate = new Date(today); startDate.setDate(today.getDate() - 7); endDate = tomorrow; break;
      case 'month': startDate = new Date(today); startDate.setDate(today.getDate() - 30); endDate = tomorrow; break;
      case 'custom':
        startDate = new Date(customDateRange.start); startDate.setHours(0, 0, 0, 0);
        endDate = new Date(customDateRange.end); endDate.setHours(23, 59, 59, 999);
        break;
      case 'all': startDate = new Date(0); endDate = new Date(8640000000000000); break;
      default: startDate = new Date(0); endDate = new Date(8640000000000000);
    }

    const petty = (state.expenses || []).reduce((sum, exp) => {
      const expDate = new Date(exp.date || exp.createdAt);
      if (expDate >= startDate && expDate <= endDate) return sum + (Number(exp.amount) || 0);
      return sum;
    }, 0);

    const purchase = (state.purchaseOrders || []).reduce((sum, po) => {
      if (po.isDeleted || po.status !== 'completed') return sum;
      const poDate = new Date(po.createdAt || po.orderDate || po.date || 0);
      if (poDate >= startDate && poDate <= endDate) return sum + (Number(po.total || po.grandTotal || po.amount || 0));
      return sum;
    }, 0);

    return { pettyExpenses: petty, purchaseExpenses: purchase };
  }, [state.expenses, state.purchaseOrders, filterDateRange, customDateRange]);

  const netProfit = grossProfit - pettyExpenses;

  const cashSales = filteredOrders.reduce((sum, order) => {
    if (!shouldCountOrder(order)) return sum;
    const refund = refundsMap[order._id || order.id] || 0;
    const method = (order.paymentMethod || '').toLowerCase();
    const details = order.splitPaymentDetails || {};
    const grandTotal = Number(order.totalAmount) || Number(order.total) || 0;

    let amount = 0;
    if (method === 'split') {
      amount = Number(details.cashAmount) || 0;
    } else if (method === 'cash') {
      amount = grandTotal;
    }

    if (amount <= 0) return sum;
    const cashRefund = refund * (amount / (grandTotal || 1));
    return sum + (amount - cashRefund);
  }, 0);

  const onlineSales = filteredOrders.reduce((sum, order) => {
    if (!shouldCountOrder(order)) return sum;
    const refund = refundsMap[order._id || order.id] || 0;
    const method = (order.paymentMethod || '').toLowerCase();
    const details = order.splitPaymentDetails || {};
    const grandTotal = Number(order.totalAmount) || Number(order.total) || 0;

    let amount = 0;
    if (method === 'split') {
      amount = Number(details.onlineAmount) || 0;
    } else if (method === 'card' || method === 'upi' || method === 'online') {
      amount = grandTotal;
    }

    if (amount <= 0) return sum;
    const onlineRefund = refund * (amount / (grandTotal || 1));
    return sum + (amount - onlineRefund);
  }, 0);

  const dueSales = filteredOrders.reduce((sum, order) => {
    if (!shouldCountOrder(order)) return sum;
    const refund = refundsMap[order._id || order.id] || 0;
    const method = (order.paymentMethod || '').toLowerCase();
    const details = order.splitPaymentDetails || {};
    const grandTotal = Number(order.totalAmount) || Number(order.total) || 0;

    let amount = 0;
    if (method === 'split') {
      amount = Number(details.dueAmount) || 0;
    } else if (method === 'due' || method === 'credit') {
      amount = grandTotal;
    }

    if (amount <= 0) return sum;
    const dueRefund = refund * (amount / (grandTotal || 1));
    return sum + (amount - dueRefund);
  }, 0);

  const codSales = filteredOrders.reduce((sum, order) => {
    if (!shouldCountOrder(order)) return sum;
    const method = (order.paymentMethod || '').toLowerCase();
    if (method !== 'cod') return sum;
    const refund = refundsMap[order._id || order.id] || 0;
    const gross = Number(order.totalAmount) || Number(order.total) || 0;
    return sum + (gross - refund);
  }, 0);

  const pendingStats = useMemo(() => {
    const orders = filteredOrders.filter(order => order.orderSource === 'online' && order.orderStatus !== 'Delivered' && order.orderStatus !== 'Cancelled');
    const sales = orders.reduce((sum, order) => {
      const refund = refundsMap[order._id || order.id] || 0;
      const gross = Number(order.totalAmount) || Number(order.total) || 0;
      return sum + (gross - refund);
    }, 0);
    const profit = orders.reduce((sum, order) => {
      return sum + getOrderPendingProfit(order);
    }, 0);

    return { sales, profit };
  }, [filteredOrders, refundsMap]);

  const pendingSales = pendingStats.sales;
  const pendingProfit = pendingStats.profit;


  // Export functions
  const exportToCSV = () => {
    const headers = ['Customer Name', 'Customer Mobile', 'Payment Method', 'Total Amount', 'Date'];
    const rows = filteredOrders.map(order => [
      order.customerName || '',
      order.customerMobile || '',
      getPaymentMethodLabel(order.paymentMethod, order.splitPaymentDetails) || '',
      (Number(order.totalAmount) || Number(order.total) || 0).toFixed(2),
      formatDate(order.createdAt || order.date)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales-orders-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const exportToJSON = () => {
    // Clone orders and replace ID with random ID, and remove strictly internal MongoDB/system IDs
    const data = filteredOrders.map(order => {
      // Create a shallow copy
      const newOrder = { ...order };

      // Replace id with random
      newOrder.id = Math.random().toString(36).substr(2, 9);

      // Remove root level internal IDs
      if (newOrder._id) delete newOrder._id;
      // Randomize sensitive IDs instead of deleting them
      if (newOrder.customerId) newOrder.customerId = Math.random().toString(36).substr(2, 9);
      if (newOrder.sellerId) newOrder.sellerId = Math.random().toString(36).substr(2, 9);
      if (newOrder.merchantId) newOrder.merchantId = Math.random().toString(36).substr(2, 9);
      if (newOrder.userId) newOrder.userId = Math.random().toString(36).substr(2, 9);

      // Sanitize items
      if (newOrder.items && Array.isArray(newOrder.items)) {
        newOrder.items = newOrder.items.map(item => {
          const newItem = { ...item };
          // Replace/Remove Item IDs
          if (newItem._id) delete newItem._id;
          // If item has an id, randomize it to ensure no DB id leaks
          if (newItem.id) newItem.id = Math.random().toString(36).substr(2, 9);

          // Randomize specific internal keys
          if (newItem.productId) newItem.productId = Math.random().toString(36).substr(2, 9);
          if (newItem.sellerId) newItem.sellerId = Math.random().toString(36).substr(2, 9);

          return newItem;
        });
      }
      return newOrder;
    });

    const dataStr = JSON.stringify(data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales-orders-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  };

  /* ================= MODERN PDF EXPORT ================= */
  const exportToPDF = async () => {
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;

      /* ================= CONFIG ================= */
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
        const amount = Number(val || 0);
        const isWhole = amount % 1 === 0;
        return `Rs. ${amount.toLocaleString('en-IN', {
          minimumFractionDigits: isWhole ? 0 : 2,
          maximumFractionDigits: 2
        })}`;
      };



      /* -------- HELPERS -------- */
      const safeDrawText = (pdf, text, x, y, options = {}) => {
        const isHindi = /[\u0900-\u097F\u20B9]/.test(text);
        if (isHindi) {
          try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const fontSize = options.fontSize || 10;
            ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
            const metrics = ctx.measureText(text);
            canvas.width = metrics.width * 2;
            canvas.height = fontSize * 2.5;
            ctx.scale(2, 2);
            ctx.fillStyle = options.color || '#000000';
            ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
            ctx.fillText(text, 0, fontSize);
            const dataUrl = canvas.toDataURL('image/png');
            const w = metrics.width / 3.78;
            const h = fontSize * 1.5 / 3.78;
            let drawX = x;
            if (options.align === 'right') drawX -= w;
            else if (options.align === 'center') drawX -= w / 2;
            pdf.addImage(dataUrl, 'PNG', drawX, y - (fontSize / 2.5), w, h);
          } catch (e) {
            pdf.text(text, x, y, options); // Fallback
          }
        } else {
          pdf.text(text, x, y, options);
        }
      };

      /* ================= HEADER ================= */
      const headerHeight = 28;
      doc.setFillColor(...COLORS.white);
      doc.rect(0, 0, pageWidth, headerHeight, 'F');
      doc.setDrawColor(...COLORS.primary);
      doc.setLineWidth(1.5);
      doc.line(0, headerHeight - 1, pageWidth, headerHeight - 1);

      /* -------- LOGO & APP NAME -------- */
      const logoX = margin;
      const logoY = 10;
      const logoSize = 16;

      const publicUrl = process.env.PUBLIC_URL || '';
      const defaultLogo = `${publicUrl}/assets/inventory-studio-logo-removebg.png`;
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
          doc.addImage(logoBase64, 'PNG', logoX, logoY, logoSize, logoSize);
        }
      } catch (e) { }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(...COLORS.primary);
      doc.text('Inventory Studio', logoX + logoSize + 4, logoY + 7);

      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.gray);
      doc.text('Advanced Billing & Inventory Solution', logoX + logoSize + 4, logoY + 11);

      /* -------- RIGHT META -------- */
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.black);
      safeDrawText(doc, getTranslation('salesReport', state.currentLanguage) || 'SALES REPORT', pageWidth - margin, logoY + 5, { align: 'right', color: '#000000', fontSize: 14 });

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.gray);
      const today = new Date();
      safeDrawText(doc, `Date: ${formatDate(today)}`, pageWidth - margin, logoY + 11, { align: 'right', color: '#787878', fontSize: 9 });

      /* -------- CENTER SHOP INFO -------- */
      let currentY = headerHeight + 10;

      // Shop Name (Big & Bold)
      if (state.storeName) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.setTextColor(...COLORS.black);
        doc.text(state.storeName, pageWidth / 2, currentY, { align: 'center' });
        currentY += 7;
      }

      // Address & other info (Smaller, Centered)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...COLORS.gray);

      const details = [];
      if (state.storeAddress) details.push(state.storeAddress);
      if (state.storePhone) details.push(`Contact: ${state.storePhone}`);
      if (state.storeGstin) details.push(`GSTIN: ${state.storeGstin}`);

      if (details.length > 0) {
        doc.text(details.join(' | '), pageWidth / 2, currentY, { align: 'center' });
        currentY += 8;
      } else {
        currentY += 5;
      }

      /* ================= SUMMARY CARDS ================= */
      let y = currentY + 2;
      const cardW = (contentWidth - 9) / 4;
      const cardH = 22;

      // Calculate totals
      const stats_revenue = filteredOrders.reduce((sum, order) => sum + (Number(order.totalAmount) || Number(order.total) || 0), 0);
      const stats_count = filteredOrders.length;

      const metrics = [
        { label: getTranslation('totalOrders', state.currentLanguage), value: stats_count.toString(), color: COLORS.primary },
        { label: getTranslation('totalRevenue', state.currentLanguage), value: formatPDFCurrency(stats_revenue), color: COLORS.success },
        { label: 'AVG. ORDER', value: formatPDFCurrency(stats_count ? stats_revenue / stats_count : 0), color: COLORS.secondary },
        { label: 'REFUNDED', value: filteredOrders.filter(o => o.status === 'refunded').length.toString(), color: COLORS.gray }
      ];

      metrics.forEach((m, i) => {
        const x = margin + i * (cardW + 3);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'F');
        doc.setDrawColor(...COLORS.border);
        doc.setLineWidth(0.1);
        doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'S');

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.gray);
        safeDrawText(doc, m.label, x + 4, y + 8, { color: '#787878', fontSize: 7.5 });

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.black);
        safeDrawText(doc, m.value, x + 4, y + 16, { color: '#000000', fontSize: 16 });
      });

      y += cardH + 15;

      /* ================= TABLE ================= */
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.black);
      safeDrawText(doc, getTranslation('orderDetails', state.currentLanguage), margin, y, { color: '#000000', fontSize: 10.5 });
      y += 6.5;

      const headers = [
        'S.No.',
        getTranslation('invoiceNumber', state.currentLanguage) || 'Inv No.',
        getTranslation('date', state.currentLanguage),
        getTranslation('customer', state.currentLanguage),
        { text: getTranslation('items', state.currentLanguage), align: 'center' },
        { text: getTranslation('amount', state.currentLanguage), align: 'right' },
        getTranslation('status', state.currentLanguage)
      ];

      // Portrait Weights
      const colWeights = [
        { w: 15, align: 'center' }, // S.No.
        { w: 25, align: 'center' }, // ID
        { w: 25, align: 'center' }, // Date
        { w: 45, align: 'left' },   // Customer (Left)
        { w: 15, align: 'center' }, // Items
        { w: 30, align: 'right' },  // Amount (Right)
        { w: 25, align: 'center' }  // Status
      ];

      // Header Row (Grid Style)
      doc.setFillColor(245, 247, 255);
      doc.rect(margin, y, contentWidth, 10, 'F');

      // Header Outline
      doc.setDrawColor(...COLORS.border);
      doc.setLineWidth(0.1);
      doc.rect(margin, y, contentWidth, 10, 'S');

      // Header Vertical Lines
      let vHeaderX = margin;
      colWeights.forEach((col, i) => {
        if (i < colWeights.length - 1) {
          vHeaderX += col.w;
          doc.line(vHeaderX, y, vHeaderX, y + 10);
        }
      });

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.primary);

      let hX = margin;
      headers.forEach((h, i) => {
        const headerText = typeof h === 'object' ? h.text : h;
        const align = colWeights[i].align || 'left';

        let drawX = hX + 2;
        if (align === 'center') drawX = hX + (colWeights[i].w / 2);
        if (align === 'right') drawX = hX + colWeights[i].w - 2;

        safeDrawText(doc, headerText, drawX, y + 6.5, { align, color: '#2F3C7E', fontSize: 9 });
        hX += colWeights[i].w;
      });

      y += 10;

      // Rows
      if (filteredOrders.length === 0) {
        doc.setDrawColor(...COLORS.border);
        doc.rect(margin, y, contentWidth, 12, 'S');
        doc.setTextColor(...COLORS.gray);
        doc.text('No sales found', margin + contentWidth / 2, y + 8, { align: 'center' });
        y += 12;
      } else {
        filteredOrders.forEach((order, index) => {
          const rowH = 10;
          if (y > pageHeight - 20) {
            doc.addPage();
            y = 20;

            // Header Background
            doc.setFillColor(245, 247, 255);
            doc.rect(margin, y, contentWidth, 10, 'F');

            // Header Outline
            doc.setDrawColor(...COLORS.border);
            doc.setLineWidth(0.1);
            doc.rect(margin, y, contentWidth, 10, 'S');

            // Header Vertical Lines
            let vHeaderRepeatX = margin;
            colWeights.forEach((col, i) => {
              if (i < colWeights.length - 1) {
                vHeaderRepeatX += col.w;
                doc.line(vHeaderRepeatX, y, vHeaderRepeatX, y + 10);
              }
            });

            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...COLORS.primary);

            let rHX = margin;
            headers.forEach((h, i) => {
              const headerText = typeof h === 'object' ? h.text : h;
              const align = colWeights[i].align || 'left';
              let drawX = rHX + 2;
              if (align === 'center') drawX = rHX + (colWeights[i].w / 2);
              if (align === 'right') drawX = rHX + colWeights[i].w - 2;

              safeDrawText(doc, headerText, drawX, y + 6.5, { align, color: '#2F3C7E', fontSize: 9 });
              rHX += colWeights[i].w;
            });
            y += 10;
          }

          if (index % 2 === 1) {
            doc.setFillColor(252, 253, 255);
            doc.rect(margin, y, contentWidth, rowH, 'F');
          }

          // Row Outline
          doc.setDrawColor(...COLORS.border);
          doc.setLineWidth(0.1);
          doc.rect(margin, y, contentWidth, rowH, 'S');

          // Row Vertical Lines
          let vRowX = margin;
          colWeights.forEach((col, i) => {
            if (i < colWeights.length - 1) {
              vRowX += col.w;
              doc.line(vRowX, y, vRowX, y + rowH);
            }
          });

          doc.setTextColor(...COLORS.black);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);

          const displayInvNo = order.invoiceNumber || order.invoiceNo || order.billNumber || (order.id ? order.id.toString().slice(-6).toUpperCase() : '-');
          const dateStr = formatDate(order.createdAt || order.date);
          const customerName = (order.customerName || getTranslation('walkInCustomer', state.currentLanguage)).substring(0, 25);
          const itemsCount = (order.items || []).length.toString();
          const amountStr = formatPDFCurrency(order.totalAmount || 0);
          const status = (order.status || 'Completed').toUpperCase();

          let rowX = margin;

          // S.No.
          safeDrawText(doc, (index + 1).toString(), rowX + (colWeights[0].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
          rowX += colWeights[0].w;

          // ID (Center)
          safeDrawText(doc, displayInvNo, rowX + (colWeights[1].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
          rowX += colWeights[1].w;

          // Date (Center)
          safeDrawText(doc, dateStr, rowX + (colWeights[2].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
          rowX += colWeights[2].w;

          // Customer (Left Aligned Data, but Header was Centered)
          safeDrawText(doc, customerName, rowX + 2, y + 6.5, { color: '#000000', fontSize: 9 });
          rowX += colWeights[3].w;

          // Items (Center)
          safeDrawText(doc, itemsCount, rowX + (colWeights[4].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
          rowX += colWeights[4].w;

          // Amount (Right)
          doc.setFont('helvetica', 'bold');
          safeDrawText(doc, amountStr, rowX + colWeights[5].w - 2, y + 6.5, { align: 'right', color: '#000000', fontSize: 9 });
          doc.setFont('helvetica', 'normal');
          rowX += colWeights[5].w;

          // Status (Center)
          if (status === 'REFUNDED' || status === 'CANCELLED') doc.setTextColor(220, 38, 38);
          else if (status === 'PENDING') doc.setTextColor(202, 138, 4);
          else doc.setTextColor(22, 163, 74); // Green

          safeDrawText(doc, status, rowX + (colWeights[6].w / 2), y + 6.5, { align: 'center', fontSize: 8 });
          doc.setTextColor(...COLORS.black); // Reset

          y += rowH;
        });
      }

      /* ================= FOOTER ================= */
      // Powered By Logo Logic
      let gsLogoBase64 = null;
      try {
        const publicUrl = process.env.PUBLIC_URL || '';
        const gsLogo = `${publicUrl}/assets/inventory-studio-logo-removebg.png`;
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

      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(...COLORS.gray);
        if (pageCount > 1) {
          doc.text(`Page ${i} of ${pageCount}`, margin, pageHeight - 10);
        }

        // Powered By Branding
        if (gsLogoBase64) {
          const gsY = pageHeight - 7;
          const centerX = pageWidth / 2;
          doc.setFontSize(6);
          doc.setTextColor(160, 160, 160);
          doc.setFont('helvetica', 'normal');
          doc.text('Powered by ', centerX - 5, gsY, { align: 'right' });
          doc.addImage(gsLogoBase64, 'PNG', centerX - 4.2, gsY - 2.8, 3.5, 3.5);
          doc.setFont('helvetica', 'bold');
          doc.text('Inventory Studio', centerX + 0.5, gsY, { align: 'left' });
        }

        doc.setFontSize(8);
        doc.setTextColor(...COLORS.gray);
        doc.setFont('helvetica', 'normal');
        doc.text(
          `${state.storeName || state.currentUser?.shopName || 'Store'} - Sales Report`,
          pageWidth - margin,
          pageHeight - 10,
          { align: 'right' }
        );
      }

      // Add watermark
      await addWatermarkToPDF(doc, sellerLogo || undefined);

      doc.save(`sales-report-${formatDate(new Date()).replace(/\//g, '-')}.pdf`);
      if (window.showToast) {
        window.showToast(getTranslation('exportPDFSuccess', state.currentLanguage), 'success');
      }

    } catch (error) {
      console.error('Error generating PDF:', error);
      if (window.showToast) {
        window.showToast(getTranslation('exportError', state.currentLanguage), 'error');
      }
    }
  };

  const handleViewOrder = (order) => {
    setSelectedOrder(order);
    setShowOrderDetails(true);
  };

  const getPaymentMethodBadgeClass = (method) => {
    const m = (method || '').toLowerCase();
    if (m === 'cash') return 'bg-green-50 text-green-700';
    if (m === 'card' || m === 'upi' || m === 'online') return 'bg-blue-50 text-blue-700';
    if (m === 'due' || m === 'credit') return 'bg-red-50 text-red-700';
    if (m === 'cod') return 'bg-cyan-50 text-cyan-700';
    return 'bg-gray-50 text-gray-700';
  };

  const getPaymentMethodLabel = (method, splitDetails) => {
    const m = (method || '').toLowerCase();
    if (m === 'split' && splitDetails) {
      const parts = [];
      if (splitDetails.cashAmount > 0) parts.push(`${getTranslation('cash', state.currentLanguage)}: ${formatCurrencySmart(splitDetails.cashAmount, state.currencyFormat)}`);
      if (splitDetails.onlineAmount > 0) parts.push(`${getTranslation('online', state.currentLanguage)}: ${formatCurrencySmart(splitDetails.onlineAmount, state.currencyFormat)}`);
      if (splitDetails.creditAmount > 0) parts.push(`${getTranslation('creditUsed', state.currentLanguage) || 'Credit Used'}: ${formatCurrencySmart(splitDetails.creditAmount, state.currencyFormat)}`);
      if (splitDetails.dueAmount > 0) parts.push(`${getTranslation('due', state.currentLanguage)}: ${formatCurrencySmart(splitDetails.dueAmount, state.currencyFormat)}`);
      return `${getTranslation('split', state.currentLanguage) || 'Split'}(${parts.join(', ')})`;
    }
    if (m === 'cash') return getTranslation('cash', state.currentLanguage);
    if (m === 'online') return getTranslation('online', state.currentLanguage);
    if (m === 'due' || m === 'credit') return getTranslation('due', state.currentLanguage);
    if (m === 'cod') return getTranslation('cod', state.currentLanguage) || 'COD';
    return method || 'N/A';
  };

  const getSourceStatusBadgeClass = (order) => {
    if (order.orderSource !== 'online') return 'bg-slate-50 text-slate-600 border border-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
    const s = (order.orderStatus || '').toLowerCase();
    if (s === 'pending') return 'bg-yellow-50 text-yellow-700 border border-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-900/30';
    if (s === 'delivered' || s === 'completed') return 'bg-green-50 text-green-700 border border-green-100 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/30';
    if (s === 'cancelled') return 'bg-red-50 text-red-700 border border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/30';
    return 'bg-blue-50 text-blue-700 border border-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-900/30';
  };

  const buildWhatsAppInvoiceMessage = (order) => {
    if (!order) return '';

    const withNull = (value) =>
      value === null || value === undefined || value === '' ? 'null' : value;

    const storeName = withNull(
      state.storeName || state.currentUser?.shopName || state.currentUser?.username || 'Store'
    );
    const storeAddress = withNull(state.currentUser?.shopAddress || '');
    const storePhoneRaw =
      state.currentUser?.phoneNumber ||
      state.currentUser?.mobileNumber ||
      state.currentUser?.phone ||
      state.currentUser?.contact ||
      '';
    const storePhoneSanitized = sanitizeMobileNumber(storePhoneRaw);
    const storePhoneDisplay = storePhoneSanitized
      ? `+ 91 ${storePhoneSanitized} `
      : withNull(storePhoneRaw);

    const invoiceDateObj = new Date(order.createdAt || order.date || Date.now());
    const invoiceDate = Number.isNaN(invoiceDateObj.getTime())
      ? 'null'
      : formatDate(invoiceDateObj);

    const customerName = withNull(order.customerName || 'Customer');
    const customerMobileSanitized = sanitizeMobileNumber(order.customerMobile || '');
    const customerPhoneDisplay = customerMobileSanitized
      ? `+ 91 ${customerMobileSanitized} `
      : 'null';

    const toNumber = (value, fallback = 0) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    const subtotalRaw = toNumber(order.subtotal ?? order.subTotal ?? order.totalAmount ?? order.total ?? 0, 0);
    const discountRaw = toNumber(order.discountAmount ?? order.discount ?? 0, 0);
    const taxAmountRaw = toNumber(order.taxAmount ?? order.tax ?? 0, 0);
    const totalRaw = toNumber(order.totalAmount ?? order.total ?? subtotalRaw, 0);

    const taxPercentSource = order.taxPercent ?? order.taxRate;
    const taxPercentRaw =
      taxPercentSource !== undefined && taxPercentSource !== null
        ? Number(taxPercentSource)
        : subtotalRaw > 0
          ? (taxAmountRaw / subtotalRaw) * 100
          : null;

    const subtotalDisplay = formatCurrencySmart(subtotalRaw, state.currencyFormat);
    const discountDisplay = formatCurrencySmart(discountRaw, state.currencyFormat);
    const taxAmountDisplay = formatCurrencySmart(taxAmountRaw, state.currencyFormat);
    const taxPercentDisplay = Number.isFinite(taxPercentRaw)
      ? `${(taxPercentRaw % 1 === 0 ? taxPercentRaw.toFixed(0) : taxPercentRaw.toFixed(2))}% `
      : 'null';
    const totalDisplay = formatCurrencySmart(totalRaw, state.currencyFormat);

    // Column widths optimized for WhatsApp display
    // WhatsApp may collapse spaces, so we use wider columns and ensure proper spacing
    const itemWidth = 30; // Wider for better readability on WhatsApp
    const quantityWidth = 10; // Wider for centering
    const rateWidth = 15; // Wider for currency values
    const amountWidth = 16; // Wider for large amounts
    const spacing = '  |  '; // Use pipe separator for better visual separation on WhatsApp
    const spacingLength = spacing.length;

    // Calculate total line width for consistency
    const totalLineWidth = itemWidth + spacingLength + quantityWidth + spacingLength + rateWidth + spacingLength + amountWidth;

    // Helper to ensure exact width (truncates or pads as needed)
    // This ensures every column cell is exactly its width - critical for alignment
    const ensureWidth = (text, width, align = 'left') => {
      const textStr = String(text || '');
      if (textStr.length > width) {
        return textStr.substring(0, width);
      }
      if (align === 'center') {
        const padding = Math.floor((width - textStr.length) / 2);
        return ' '.repeat(padding) + textStr + ' '.repeat(width - textStr.length - padding);
      } else if (align === 'right') {
        return textStr.padStart(width, ' ');
      } else {
        return textStr.padEnd(width, ' ');
      }
    };

    // Helper to center-align text within a column width (ensures exact width)
    const centerInColumn = (text, width) => {
      const textStr = String(text || '');
      if (textStr.length >= width) {
        return textStr.substring(0, width);
      }
      const padding = Math.floor((width - textStr.length) / 2);
      const leftPad = ' '.repeat(padding);
      const rightPad = ' '.repeat(width - textStr.length - padding);
      return leftPad + textStr + rightPad;
    };

    // Helper to left-align and wrap text within a column width (ensures exact width)
    const leftAlignAndWrap = (text, width) => {
      const textStr = String(text || '');
      if (textStr.length <= width) {
        return [ensureWidth(textStr, width)];
      }
      // Wrap text if it exceeds width
      const lines = [];
      let remaining = textStr;
      while (remaining.length > 0) {
        if (remaining.length <= width) {
          lines.push(ensureWidth(remaining, width));
          break;
        }
        // Try to break at word boundary
        let breakPoint = width;
        const spaceIndex = remaining.lastIndexOf(' ', width);
        if (spaceIndex > width * 0.5) {
          breakPoint = spaceIndex;
        }
        const line = remaining.substring(0, breakPoint);
        lines.push(ensureWidth(line, width));
        remaining = remaining.substring(breakPoint).trim();
      }
      return lines;
    };

    // Helper to center-align text within exact width
    // Optimized for WhatsApp - uses more padding for better visual centering
    const centerInWidth = (text, width) => {
      const textStr = String(text || '');
      if (textStr.length >= width) {
        return textStr.substring(0, width);
      }
      const totalPadding = width - textStr.length;
      const leftPadding = Math.floor(totalPadding / 2);
      const rightPadding = totalPadding - leftPadding;
      // Use multiple spaces for better visibility on WhatsApp
      const result = ' '.repeat(Math.max(1, leftPadding)) + textStr + ' '.repeat(Math.max(1, rightPadding));
      // Ensure result is exactly 'width' characters
      if (result.length > width) {
        return result.substring(0, width);
      }
      return result.padEnd(width, ' ');
    };

    // Helper to wrap text within a column width (ensures exact width for each line)
    // Each column wraps independently - no column affects another
    const wrapColumn = (text, width, align = 'left') => {
      const textStr = String(text || '');
      if (textStr.length <= width) {
        if (align === 'center') {
          return [centerInWidth(textStr, width)];
        } else if (align === 'right') {
          return [textStr.padStart(width, ' ')];
        } else {
          return [textStr.padEnd(width, ' ')];
        }
      }
      // Wrap text if it exceeds width - each line is exactly 'width' characters
      const lines = [];
      let remaining = textStr;
      while (remaining.length > 0) {
        if (remaining.length <= width) {
          if (align === 'center') {
            lines.push(centerInWidth(remaining, width));
          } else if (align === 'right') {
            lines.push(remaining.padStart(width, ' '));
          } else {
            lines.push(remaining.padEnd(width, ' '));
          }
          break;
        }
        // Break at exact width for numbers, try word boundary for text
        let breakPoint = width;
        if (align === 'left' && remaining.includes(' ')) {
          const spaceIndex = remaining.lastIndexOf(' ', width);
          if (spaceIndex > width * 0.5) {
            breakPoint = spaceIndex;
          }
        }
        const line = remaining.substring(0, breakPoint);
        // Ensure each line is exactly 'width' characters
        if (align === 'center') {
          lines.push(centerInWidth(line, width));
        } else if (align === 'right') {
          lines.push(line.padStart(width, ' '));
        } else {
          lines.push(line.padEnd(width, ' '));
        }
        remaining = remaining.substring(breakPoint).trim();
      }
      return lines;
    };

    // Helper to format and wrap numbers (always center-aligned, can wrap if needed)
    // Returns array of lines, each exactly 'width' characters, perfectly centered
    const formatNumberColumn = (value, width, isCurrency = false) => {
      let text;
      if (Number.isFinite(value)) {
        if (isCurrency) {
          text = formatCurrencySmart(value, state.currencyFormat);
        } else {
          text = value.toString();
        }
      } else {
        text = 'null';
      }
      // Wrap if needed and return array of lines - each line is exactly 'width' characters, centered
      return wrapColumn(text, width, 'center');
    };

    // Create a row with exact width - columns are completely independent
    // Optimized for WhatsApp display
    const createRow = (itemCol, qtyCol, rateCol, amountCol) => {
      // Each column is already exactly its width, spacing uses pipe for better visibility
      // Format: [Item]  |  [Qty]  |  [Rate]  |  [Amount]
      const row = `${itemCol}${spacing}${qtyCol}${spacing}${rateCol}${spacing}${amountCol} `;
      // Ensure row maintains exact width for alignment
      if (row.length !== totalLineWidth) {

      }
      return ensureWidth(row, totalLineWidth);
    };

    // No longer using table format - items are displayed as bullet points

    // Create empty column cells (exact width) - used when other columns wrap
    const createEmptyCol = (width) => {
      // Empty column is just spaces - exactly 'width' characters
      return ' '.repeat(width);
    };

    const orderItems = order.items || [];

    // Format items as bullet points instead of table
    const formatItemAsPoint = (item, index) => {
      const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
      const name = item.name || item.productName || `Item ${index + 1} `;

      // Format: • Item Name - Qty x Rate = Amount
      const qtyText = qty.toString();
      const rateText = formatCurrencySmart(rate, state.currencyFormat);
      const totalText = formatCurrencySmart(total, state.currencyFormat);

      let itemLine = `• ${name} `;
      if (qty > 0) {
        itemLine += ` - ${qtyText}${unit ? ` ${unit}` : ''} x ${rateText} = ${totalText} `;
      } else {
        itemLine += ` - ${totalText} `;
      }

      return itemLine;
    };

    // Create items section as bullet points
    let itemsSection;
    if (orderItems.length > 0) {
      const itemPoints = orderItems.map((item, index) => formatItemAsPoint(item, index));
      itemsSection = itemPoints.join('\n');
    } else {
      itemsSection = '• No items';
    }

    const paymentModeLabel = withNull(getPaymentMethodLabel(order.paymentMethod, order.splitPaymentDetails));

    const divider = '--------------------------------';

    const lines = [
      '             INVOICE',
      '',
      divider,
      `Shop Name: ${storeName} `,
      `Address: ${storeAddress} `,
      `Phone: ${storePhoneDisplay} `,
      `Date: ${invoiceDate} `,
      divider,
      `Customer Name: ${customerName} `,
      `Customer Phone: ${customerPhoneDisplay} `,
      divider,
      'Items:',
      '',
      itemsSection,
      divider,
      `Subtotal: ${subtotalDisplay} `,
      `Discount: ${discountDisplay} `,
      `Tax(${taxPercentDisplay})     : ${taxAmountDisplay} `,
      divider,
      `Grand Total: ${totalDisplay} `,
      `Payment Mode: ${paymentModeLabel} `,
      '',
      ...(state.currentUser?.whatsappLink ? [
        'Join our WhatsApp group for offers & updates:',
        state.currentUser.whatsappLink,
        ''
      ] : []),
      'Thank you for shopping with us!',
      divider,
      '       Powered by Inventory Studio',
      divider
    ];

    return lines.join('\n');
  };

  const handleShareInvoice = (order) => {
    if (!order) return;

    const customerMobile = sanitizeMobileNumber(order.customerMobile || '');

    if (!customerMobile) {
      if (window.showToast) {
        window.showToast('No customer mobile number found for this invoice.', 'warning');
      }
      return;
    }

    const identifier = order.invoiceNumber || order.id || order._id;
    const billUrl = `${window.location.origin}/view-bill/${identifier}`;

    const storeName = state.currentUser?.shopName || 'our store';
    const whatsappLink = state.currentUser?.whatsappLink;

    let messageText = `Hi ${order.customerName || 'Customer'},\nYour bill from ${storeName} is ready. View it here:\n${billUrl}`;

    if (whatsappLink) {
      messageText += `\n\nJoin our WhatsApp group for exciting offers & updates:\n${whatsappLink}`;
    }

    const message = encodeURIComponent(messageText);
    // Remove space at end
    const targetNumber = customerMobile.length === 10 ? `91${customerMobile}` : customerMobile;
    const waUrl = `https://wa.me/${targetNumber}?text=${message}`;
    window.open(waUrl, '_blank');
  };


  return (
    <div className="space-y-6">
      {/* Simple Premium Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-6 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl text-blue-600 dark:text-blue-400 shrink-0">
            <FileClock className="h-7 w-7 sm:h-8 sm:w-8" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white leading-tight">
              {getTranslation('salesOrderHistoryTitle', state.currentLanguage)}
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 max-w-md">
              {getTranslation('salesOrderHistorySubtitle', state.currentLanguage)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(true)}
              className="btn-secondary flex items-center justify-center gap-2 text-sm px-4 py-2 touch-manipulation dark:text-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-slate-600 w-full sm:w-auto"
            >
              <Download className="h-4 w-4" />
              <span>Export</span>
            </button>
            {showExportMenu && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowExportMenu(false)}>
                <div
                  className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-slate-700"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Export Orders</h3>
                    <button
                      onClick={() => setShowExportMenu(false)}
                      className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="p-2 space-y-1">
                    <button
                      onClick={() => {
                        exportToCSV();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-green-50 text-green-600 group-hover:bg-green-100 dark:bg-green-500/10 dark:text-green-500 dark:group-hover:bg-green-500/20 transition-colors">
                        <FileSpreadsheet className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsCSV', state.currentLanguage)}</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('spreadsheetFormat', state.currentLanguage)}</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        exportToJSON();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-500 dark:group-hover:bg-blue-500/20 transition-colors">
                        <FileJson className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsJSON', state.currentLanguage)}</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('rawDataFormat', state.currentLanguage)}</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        exportToPDF();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-red-50 text-red-600 group-hover:bg-red-100 dark:bg-red-500/10 dark:text-red-500 dark:group-hover:bg-red-500/20 transition-colors">
                        <Receipt className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsPDF', state.currentLanguage)}</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('printableDocumentFormat', state.currentLanguage)}</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="card p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:gap-4">
          {/* Search */}
          <div>
            <label htmlFor="order-search" className="block text-xs sm:text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">
              {getTranslation('searchOrdersLabel', state.currentLanguage)}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400 dark:text-slate-500" />
              </div>
              <input
                id="order-search"
                type="text"
                placeholder={getTranslation('searchCustomersPlaceholder', state.currentLanguage)}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm outline-none"
              />
            </div>
          </div>

          {/* Filter Pills Row */}
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            {/* Payment Method Filter */}
            <div className="flex-1 flex flex-col">
              <label className="block text-xs sm:text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">{getTranslation('paymentMethod', state.currentLanguage)}</label>
              <div className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 p-1 shadow-sm w-full h-[44px] sm:h-[42px]">
                {[
                  { value: 'all', label: getTranslation('all', state.currentLanguage) || 'All' },
                  { value: 'cash', label: getTranslation('cash', state.currentLanguage) },
                  { value: 'online', label: getTranslation('online', state.currentLanguage) },
                  { value: 'due', label: getTranslation('due', state.currentLanguage) },
                  { value: 'cod', label: getTranslation('cod', state.currentLanguage) || 'COD' }
                ].map((option) => {
                  const isActive = filterPaymentMethod === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setFilterPaymentMethod(option.value);
                        setCurrentPage(1);
                      }}
                      className={`px-2 sm:px-3 py-2 sm:py-1.5 text-xs font-medium rounded-full transition flex-1 h-full flex items-center justify-center touch-manipulation ${isActive
                        ? 'bg-gradient-to-r from-slate-900 to-slate-900 dark:from-white dark:to-white text-white dark:text-slate-900 shadow'
                        : 'text-slate-600 dark:text-slate-300 active:bg-gray-100 dark:active:bg-slate-700'
                        }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date Range Filter */}
            <div className="flex-1 flex flex-col">
              <label className="block text-xs sm:text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">{getTranslation('customRange', state.currentLanguage)}</label>
              <div className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 p-1 shadow-sm backdrop-blur-sm w-full h-[44px] sm:h-[42px]">
                {[
                  { value: 'today', label: getTranslation('today', state.currentLanguage) },
                  { value: 'week', label: '7 Days' },
                  { value: 'month', label: '30 Days' },
                  { value: 'all', label: getTranslation('all', state.currentLanguage) || 'All' },
                  { value: 'custom', label: getTranslation('custom', state.currentLanguage) || 'Custom' }
                ].map((option) => {
                  const isActive = filterDateRange === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        if (option.value === 'custom') {
                          setTempCustomRange({ ...customDateRange });
                          setShowCustomDateModal(true);
                        } else {
                          setFilterDateRange(option.value);
                          setCurrentPage(1);
                        }
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm flex-1 h-full flex items-center justify-center ${isActive
                        ? 'bg-gradient-to-r from-slate-900 to-slate-900 dark:from-white dark:to-white text-white dark:text-slate-900 shadow'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-700'
                        }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 auto-rows-[1fr]">
        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform duration-300">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalRevenue', state.currentLanguage)}</p>
            {isLoading ? (
              <SkeletonCard className="h-8 w-32 bg-emerald-200 dark:bg-emerald-900/30 rounded" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(totalSales)}>
                {formatCurrencySmart(totalSales, state.currencyFormat)}
              </h3>
            )}
          </div>
        </div>

        <div
          onClick={() => setShowRefundsModal(true)}
          className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full cursor-pointer group"
        >
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 group-hover:scale-110 transition-transform duration-300 text-center">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalRefunds', state.currentLanguage)}</p>
            {isLoading ? (
              <SkeletonCard className="h-8 w-32 bg-rose-200 dark:bg-rose-900/30 rounded" />
            ) : (
              <div className="flex items-center gap-2">
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(totalRefunds)}>
                  {formatCurrencySmart(totalRefunds, state.currencyFormat)}
                </h3>
                <span className="text-[10px] font-bold bg-rose-50 dark:bg-rose-900/20 text-rose-600 px-1.5 py-0.5 rounded uppercase tracking-wider">
                  {periodRefunds.length}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform duration-300">
            <Truck className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">Delivery Charges</p>
            {isLoading ? (
              <SkeletonCard className="h-8 w-32 bg-blue-200 dark:bg-blue-900/30 rounded" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(totalDeliveryCharges)}>
                {formatCurrencySmart(totalDeliveryCharges, state.currencyFormat)}
              </h3>
            )}
          </div>
        </div>



        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 text-center group-hover:scale-110 transition-transform duration-300">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">Pending Sales</p>
            {isLoading ? (
              <SkeletonCard className="h-8 w-32 bg-orange-200 dark:bg-orange-900/30 rounded" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(pendingSales)}>
                {formatCurrencySmart(pendingSales, state.currencyFormat)}
              </h3>
            )}
          </div>
        </div>

        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full text-center group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 text-center group-hover:scale-110 transition-transform duration-300">
            <Target className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">Pending Profit</p>
            {isLoading ? (
              <SkeletonCard className="h-8 w-32 bg-violet-200 dark:bg-violet-900/30 rounded" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(pendingProfit)}>
                {formatCurrencySmart(pendingProfit, state.currencyFormat)}
              </h3>
            )}
          </div>
        </div>

        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-slate-900 dark:text-slate-100 text-center group-hover:scale-110 transition-transform duration-300">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalOrders', state.currentLanguage)}</p>
            {isLoading ? (
              <SkeletonCard className="h-8 w-32 bg-indigo-200 dark:bg-indigo-900/30 rounded" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">{filteredOrders.length}</h3>
            )}
          </div>
        </div>

        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-center group-hover:scale-110 transition-transform duration-300">
            <IndianRupee className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('cashSales', state.currentLanguage)}</p>
            {isLoading ? (
              <SkeletonCard className="h-8 w-32 bg-green-200 dark:bg-green-900/30 rounded" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(cashSales)}>
                {formatCurrencySmart(cashSales, state.currencyFormat)}
              </h3>
            )}
          </div>
        </div>

        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-center group-hover:scale-110 transition-transform duration-300">
            <IndianRupee className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('onlineSales', state.currentLanguage)}</p>
            {isLoading ? (
              <SkeletonCard className="h-8 w-32 bg-blue-200 dark:bg-blue-900/30 rounded" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(onlineSales)}>
                {formatCurrencySmart(onlineSales, state.currencyFormat)}
              </h3>
            )}
          </div>
        </div>

        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-center group-hover:scale-110 transition-transform duration-300">
            <IndianRupee className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('dueSales', state.currentLanguage)}</p>
            {isLoading ? (
              <SkeletonCard className="h-8 w-32 bg-red-200 dark:bg-red-900/30 rounded" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(dueSales)}>
                {formatCurrencySmart(dueSales, state.currencyFormat)}
              </h3>
            )}
          </div>
        </div>

        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400 text-center group-hover:scale-110 transition-transform duration-300">
            <IndianRupee className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('codSales', state.currentLanguage)}</p>
            {isLoading ? (
              <SkeletonCard className="h-8 w-32 bg-cyan-200 dark:bg-cyan-900/30 rounded" />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(codSales)}>
                {formatCurrencySmart(codSales, state.currencyFormat)}
              </h3>
            )}
          </div>
        </div>
      </div>

      {/* Refunds List Modal */}
      {showRefundsModal && (
        <div
          className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 transition-opacity duration-300 animate-fadeIn"
          onClick={() => setShowRefundsModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 w-full h-[95vh] sm:h-auto sm:max-h-[85vh] sm:max-w-4xl rounded-none sm:rounded-2xl shadow-xl border dark:border-slate-700/60 flex flex-col overflow-hidden relative animate-slideUp"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 dark:border-slate-700 flex-shrink-0">
              <div className="flex flex-col">
                <h2 className="text-xl sm:text-2xl font-black text-rose-600 dark:text-rose-400 uppercase tracking-tight flex items-center gap-3">
                  <RotateCcw className="h-6 w-6" />
                  Refund Transactions
                </h2>
                <p className="text-sm text-slate-500 font-medium mt-1">
                  List of all refunds for the selected period
                </p>
              </div>
              <button
                onClick={() => setShowRefundsModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 active:bg-gray-100 dark:active:bg-slate-700 rounded-lg transition-colors touch-manipulation"
                aria-label="Close"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4 sm:p-6">
              {periodRefunds.length > 0 ? (
                <div className="space-y-4">
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-hidden border border-slate-200 dark:border-slate-700 rounded-xl">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                      <thead className="bg-gray-50 dark:bg-slate-700/50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider">Date</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider">Invoice #</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider">Customer</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                        {periodRefunds.map((refund, index) => {
                          const rid = (refund.orderId || refund.orderID || refund.order_id || '').toString();
                          const order = (state.orders || []).find(o =>
                            (o._id && o._id.toString() === rid) ||
                            (o.id && o.id.toString() === rid)
                          );
                          return (
                            <tr key={refund.id || index} className="hover:bg-rose-50/30 dark:hover:bg-rose-900/10 transition-colors">
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-slate-400">
                                {formatDateTime(refund.refundDate || refund.createdAt || refund.date)}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-blue-600 dark:text-blue-400">
                                {order?.invoiceNumber || order?.billNumber || 'N/A'}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-slate-300">
                                {order?.customerName || 'Walk-in Customer'}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm font-black text-rose-600 dark:text-rose-400 text-right">
                                {formatCurrencySmart(refund.totalRefundAmount || refund.amount || 0, state.currencyFormat)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="md:hidden space-y-3">
                    {periodRefunds.map((refund, index) => {
                      const rid = (refund.orderId || refund.orderID || refund.order_id || '').toString();
                      const order = (state.orders || []).find(o =>
                        (o._id && o._id.toString() === rid) ||
                        (o.id && o.id.toString() === rid)
                      );
                      return (
                        <div key={refund.id || index} className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                {order?.invoiceNumber || order?.billNumber || 'N/A'}
                              </p>
                              <h4 className="text-sm font-bold text-gray-900 dark:text-white mt-0.5">
                                {order?.customerName || 'Walk-in Customer'}
                              </h4>
                            </div>
                            <p className="text-base font-black text-rose-600 dark:text-rose-400">
                              {formatCurrencySmart(refund.totalRefundAmount || refund.amount, state.currencyFormat)}
                            </p>
                          </div>
                          <div className="flex justify-between items-center text-[10px] text-slate-500 font-medium tracking-tight">
                            <span>{formatDateTime(refund.refundDate || refund.createdAt || refund.date)}</span>
                            {refund.reason && (
                              <span className="italic truncate max-w-[150px]">"{refund.reason}"</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <RotateCcw className="h-12 w-12 text-slate-300 dark:text-slate-600 mb-4" />
                  <p className="text-slate-500 dark:text-slate-400 font-medium">No refunds found for the selected period.</p>
                </div>
              )}
            </div>

            <div className="bg-gray-50 dark:bg-slate-800/80 p-4 sm:p-6 border-t border-gray-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Total Refunded Amount</span>
                <span className="text-2xl font-black text-rose-600 dark:text-rose-400">
                  {formatCurrencySmart(totalRefunds, state.currencyFormat)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Orders Table - Desktop View */}
      <div className="card hidden lg:block bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-700/50">
              <tr>
                <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-gray-700 dark:text-slate-300">Invoice #</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">{getTranslation('customer', state.currentLanguage)}</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">{getTranslation('mobile', state.currentLanguage) || 'Mobile'}</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">Source / Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">{getTranslation('paymentMethod', state.currentLanguage)}</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">{getTranslation('amount', state.currentLanguage)}</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">{getTranslation('refunds', state.currentLanguage)}</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">{getTranslation('date', state.currentLanguage) || 'Date'}</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">{getTranslation('actionsHeader', state.currentLanguage)}</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3"><SkeletonCard className="h-4 w-16 bg-blue-100 dark:bg-blue-900/20 mx-auto rounded" /></td>
                    <td className="px-4 py-3"><SkeletonCard className="h-4 w-32 bg-gray-100 dark:bg-slate-700 mx-auto rounded" /></td>
                    <td className="px-4 py-3"><SkeletonCard className="h-4 w-24 bg-gray-100 dark:bg-slate-700 mx-auto rounded" /></td>
                    <td className="px-4 py-3"><SkeletonCard className="h-5 w-20 bg-emerald-100 dark:bg-emerald-900/20 mx-auto rounded-full" /></td>
                    <td className="px-4 py-3"><SkeletonCard className="h-5 w-24 bg-indigo-100 dark:bg-indigo-900/20 mx-auto rounded-full" /></td>
                    <td className="px-4 py-3"><SkeletonCard className="h-4 w-20 bg-emerald-100 dark:bg-emerald-900/20 mx-auto rounded" /></td>
                    <td className="px-4 py-3"><SkeletonCard className="h-4 w-16 bg-rose-100 dark:bg-rose-900/20 mx-auto rounded" /></td>
                    <td className="px-4 py-3"><SkeletonCard className="h-4 w-28 bg-gray-100 dark:bg-slate-700 mx-auto rounded" /></td>
                    <td className="px-4 py-3"><SkeletonCard className="h-8 w-24 bg-gray-100 dark:bg-slate-700 mx-auto rounded-lg" /></td>
                  </tr>
                ))
              ) : paginatedOrders.length > 0 ? (
                paginatedOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors text-center">
                    <td className="px-4 py-3 text-sm font-bold text-blue-600 dark:text-blue-400">
                      {order.invoiceNumber || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                      {order.customerName || 'Walk-in Customer'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 text-center">
                      {order.customerMobile || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${getSourceStatusBadgeClass(order)}`}>
                        {order.orderSource === 'online' ? 'ONLINE' : 'POS'}
                        {order.orderSource === 'online' && order.orderStatus ? ` / ${order.orderStatus.toUpperCase()}` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPaymentMethodBadgeClass(order.paymentMethod)}`}>
                        {getPaymentMethodLabel(order.paymentMethod, order.splitPaymentDetails) || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-center">
                      <div className="flex flex-col items-center justify-center">
                        {(() => {
                          const { finalTotal, originalTotal, hasDiscount } = getOrderDisplayTotals(order);
                          return (
                            <>
                              {hasDiscount && (
                                <span className="text-xs text-slate-400 line-through decoration-slate-400/50">
                                  {formatCurrencySmart(originalTotal, state.currencyFormat)}
                                </span>
                              )}
                              <span className="text-emerald-600" title={formatCurrency(finalTotal)}>
                                {formatCurrencySmart(finalTotal, state.currencyFormat)}
                              </span>
                            </>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-rose-600 text-center">
                      {refundsMap[order._id || order.id] ? (
                        <span title={formatCurrency(refundsMap[order._id || order.id])}>
                          -{formatCurrencySmart(refundsMap[order._id || order.id], state.currencyFormat)}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-slate-700">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-slate-300 text-center">
                      {formatDateTime(order.createdAt || order.date)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleViewOrder(order)}
                          className="p-2 text-slate-900 dark:text-slate-100 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => initiatePrint(order)}
                          className="p-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                          title="Print Bill"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        {order.customerMobile && (
                          <button
                            onClick={() => handleShareInvoice(order)}
                            className="p-2 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                            title="Share Invoice on WhatsApp"
                          >
                            <Share2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="px-4 py-12 text-center">
                    <SearchX className="h-12 w-12 text-gray-400 dark:text-slate-600 mx-auto mb-4" />
                    <p className="text-gray-600 dark:text-slate-400">{getTranslation('noOrdersFound', state.currentLanguage)}</p>
                    {searchTerm || filterPaymentMethod !== 'all' || filterDateRange !== 'all' ? (
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-2">Try adjusting your filters</p>
                    ) : null}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Orders Cards - Mobile/Tablet View */}
      <div className="lg:hidden space-y-3">
        {isLoading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="card p-4 bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 space-y-4">
              <div className="flex justify-between">
                <div className="space-y-2">
                  <SkeletonCard className="h-5 w-32 bg-gray-200 dark:bg-slate-700 rounded animate-pulse" />
                  <SkeletonCard className="h-4 w-24 bg-gray-100 dark:bg-slate-700 rounded animate-pulse" />
                </div>
                <div className="flex gap-2">
                  <SkeletonCard className="h-9 w-9 bg-gray-200 dark:bg-slate-700 rounded-lg animate-pulse" />
                  <SkeletonCard className="h-9 w-9 bg-gray-200 dark:bg-slate-700 rounded-lg animate-pulse" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 border-t border-gray-50 dark:border-slate-700/50 pt-4">
                <div className="space-y-1">
                  <div className="h-3 w-10 bg-gray-100 dark:bg-slate-700 rounded animate-pulse" />
                  <div className="h-5 w-16 bg-emerald-100 dark:bg-emerald-900/20 rounded animate-pulse" />
                </div>
                <div className="space-y-1">
                  <div className="h-3 w-10 bg-gray-100 dark:bg-slate-700 rounded animate-pulse" />
                  <div className="h-5 w-16 bg-indigo-100 dark:bg-indigo-900/20 rounded-full animate-pulse" />
                </div>
                <div className="space-y-1">
                  <div className="h-3 w-10 bg-gray-100 dark:bg-slate-700 rounded animate-pulse" />
                  <div className="h-5 w-16 bg-gray-200 dark:bg-slate-700 rounded animate-pulse" />
                </div>
              </div>
            </div>
          ))
        ) : paginatedOrders.length > 0 ? (
          paginatedOrders.map((order) => (
            <div key={order.id} className="card p-4 hover:shadow-md transition-shadow bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
                    {order.customerName || 'Walk-in Customer'}
                  </h3>
                  {order.customerMobile && (
                    <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{order.customerMobile}</p>
                  )}
                </div>
                <div className="ml-3 flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleViewOrder(order)}
                    className="p-2.5 text-slate-900 dark:text-slate-100 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors touch-manipulation"
                    title="View Details"
                  >
                    <Eye className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => initiatePrint(order)}
                    className="p-2.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors touch-manipulation"
                    title="Print Bill"
                  >
                    <Printer className="h-5 w-5" />
                  </button>
                  {order.customerMobile && (
                    <button
                      onClick={() => handleShareInvoice(order)}
                      className="p-2.5 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors touch-manipulation"
                      title="Share Invoice on WhatsApp"
                    >
                      <Share2 className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">{getTranslation('amount', state.currentLanguage)}</p>
                  <div className="flex flex-col items-start">
                    {(() => {
                      const { finalTotal, originalTotal, hasDiscount } = getOrderDisplayTotals(order);
                      return (
                        <>
                          {hasDiscount && (
                            <span className="text-xs text-slate-400 line-through decoration-slate-400/50 mb-0.5">
                              {formatCurrencySmart(originalTotal, state.currencyFormat)}
                            </span>
                          )}
                          <p className="text-xl font-black text-emerald-600 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(finalTotal)}>
                            {formatCurrencySmart(finalTotal, state.currencyFormat)}
                          </p>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">{getTranslation('refunds', state.currentLanguage)}</p>
                  <p className={`text-xl font-black ${refundsMap[order._id || order.id] ? 'text-rose-600' : 'text-gray-300'}`}>
                    {refundsMap[order._id || order.id] ? `-${formatCurrencySmart(refundsMap[order._id || order.id], state.currencyFormat)}` : '-'}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">{getTranslation('payment', state.currentLanguage)}</p>
                  <div className="">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-tight whitespace-normal h-auto text-left leading-tight ${getPaymentMethodBadgeClass(order.paymentMethod)}`}>
                      {getPaymentMethodLabel(order.paymentMethod, order.splitPaymentDetails) || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-slate-700 flex justify-between items-center">
                <p className="text-[10px] font-medium text-gray-500 dark:text-slate-400 uppercase tracking-widest">{formatDateTime(order.createdAt || order.date)}</p>
                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded">{order.invoiceNumber || `#${order.id.slice(-6).toUpperCase()}`}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="card p-12 text-center">
            <SearchX className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-base">No orders found</p>
            {searchTerm || filterPaymentMethod !== 'all' || filterDateRange !== 'all' ? (
              <p className="text-sm text-gray-500 mt-2">Try adjusting your filters</p>
            ) : null}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 mt-4 sm:mt-6 px-3 sm:px-4 py-3 sm:py-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
          <div className="text-xs sm:text-sm text-gray-700 dark:text-slate-300 text-center sm:text-left">
            Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
            <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredOrders.length)}</span> of{' '}
            <span className="font-semibold">{filteredOrders.length}</span> orders
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
              className="p-2 sm:p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg active:bg-gray-50 dark:active:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              aria-label="First page"
            >
              <ChevronsLeft className="h-4 w-4 sm:h-4 sm:w-4" />
            </button>
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-2 sm:p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg active:bg-gray-50 dark:active:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4 sm:h-4 sm:w-4" />
            </button>
            {getPageNumbers().map((page, index) => (
              <React.Fragment key={index}>
                {page === 'ellipsis' ? (
                  <span className="px-1 sm:px-2 text-gray-500 dark:text-slate-500 text-xs sm:text-sm">...</span>
                ) : (
                  <button
                    onClick={() => handlePageChange(page)}
                    className={`px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors touch-manipulation ${currentPage === page
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-slate-600 active:bg-gray-50 dark:active:bg-slate-600'
                      }`}
                  >
                    {page}
                  </button>
                )}
              </React.Fragment>
            ))}
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-2 sm:p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg active:bg-gray-50 dark:active:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4 sm:h-4 sm:w-4" />
            </button>
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
              className="p-2 sm:p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg active:bg-gray-50 dark:active:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              aria-label="Last page"
            >
              <ChevronsRight className="h-4 w-4 sm:h-4 sm:w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Order Details Modal */}
      {showOrderDetails && selectedOrder && (
        <div
          className={`fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 transition-opacity duration-300 ${isClosingOrderDetails ? 'opacity-0' : 'animate-fadeIn'}`}
          onClick={handleCloseOrderDetails}
        >
          <style>{`
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes slideUp {
                from { transform: translateY(100%); }
                to { transform: translateY(0); }
            }
            @keyframes slideDown {
                from { transform: translateY(0); }
                to { transform: translateY(100%); }
            }
          `}</style>
          <div
            key={isClosingOrderDetails ? 'closing' : 'opening'}
            style={{ animation: `${isClosingOrderDetails ? 'slideDown' : 'slideUp'} 0.4s ease-out forwards` }}
            className="bg-white dark:bg-slate-800 w-full h-[95vh] sm:h-auto sm:max-h-[85vh] sm:max-w-3xl rounded-none sm:rounded-2xl shadow-xl border dark:border-slate-700/60 flex flex-col overflow-hidden relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 dark:border-slate-700 flex-shrink-0">
              <div className="flex flex-col">
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">{getTranslation('orderDetails', state.currentLanguage)}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Invoice #</span>
                  <span className="text-sm font-black text-blue-600 dark:text-blue-400">{selectedOrder.invoiceNumber || '-'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => initiatePrint(selectedOrder)}
                  className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 active:bg-gray-100 dark:active:bg-slate-700 rounded-lg transition-colors touch-manipulation"
                  title="Print Bill"
                >
                  <Printer className="h-5 w-5 sm:h-5 sm:w-5" />
                </button>
                <button
                  onClick={handleCloseOrderDetails}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 active:bg-gray-100 dark:active:bg-slate-700 rounded-lg transition-colors touch-manipulation"
                  aria-label="Close"
                >
                  <X className="h-5 w-5 sm:h-5 sm:w-5" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 p-4 sm:p-6">
              <div className="space-y-4 sm:space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('date', state.currentLanguage) || 'Date'}</p>
                    <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white break-words">{formatDateTime(selectedOrder.createdAt || selectedOrder.date)}</p>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('customerName', state.currentLanguage)}</p>
                    <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white break-words">{selectedOrder.customerName || 'Walk-in Customer'}</p>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('mobile', state.currentLanguage) || 'Mobile'}</p>
                    <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white break-words">{selectedOrder.customerMobile || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('paymentMethod', state.currentLanguage)}</p>
                    <span className={`inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium ${getPaymentMethodBadgeClass(selectedOrder.paymentMethod)}`}>
                      {getPaymentMethodLabel(selectedOrder.paymentMethod, selectedOrder.splitPaymentDetails) || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">Status</p>
                    <span className={`inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium ${selectedOrder.orderStatus === 'Delivered' || selectedOrder.orderStatus === 'Completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                      selectedOrder.orderStatus === 'Pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                        selectedOrder.orderStatus === 'Cancelled' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                          'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                      }`}>
                      {selectedOrder.orderStatus || 'Completed'}
                    </span>
                  </div>
                  {(() => {
                    const paymentMethod = (selectedOrder.paymentMethod || '').toString().toLowerCase().trim();
                    if (paymentMethod === 'split') {
                      const paymentDetails = selectedOrder.splitPaymentDetails || {};
                      const cashAmount = Number(paymentDetails.cashAmount) || 0;
                      const onlineAmount = Number(paymentDetails.onlineAmount) || 0;
                      const creditAmount = Number(paymentDetails.creditAmount) || 0;
                      const dueAmount = Number(paymentDetails.dueAmount) || 0;

                      return (
                        <div className="sm:col-span-2">
                          <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-2">{getTranslation('paymentBreakdown', state.currentLanguage)}</p>
                          <div className={`grid ${creditAmount > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-2 sm:gap-3`}>
                            {cashAmount > 0 && (
                              <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-2.5 sm:p-3">
                                <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">Cash</p>
                                <p className="text-base sm:text-lg font-bold text-green-900 dark:text-green-100 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(cashAmount)}>
                                  {formatCurrencySmart(cashAmount, state.currencyFormat)}
                                </p>
                              </div>
                            )}
                            {onlineAmount > 0 && (
                              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2.5 sm:p-3">
                                <p className="text-xs text-blue-700 dark:text-blue-400 font-medium mb-1">Online</p>
                                <p className="text-base sm:text-lg font-bold text-blue-900 dark:text-blue-100 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(onlineAmount)}>
                                  {formatCurrencySmart(onlineAmount, state.currencyFormat)}
                                </p>
                              </div>
                            )}
                            {creditAmount > 0 && (
                              <div className="bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-lg p-2.5 sm:p-3">
                                <p className="text-xs text-purple-700 dark:text-purple-400 font-medium mb-1">Credit Used</p>
                                <p className="text-base sm:text-lg font-bold text-purple-900 dark:text-purple-100 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(creditAmount)}>
                                  {formatCurrencySmart(creditAmount, state.currencyFormat)}
                                </p>
                              </div>
                            )}
                            {dueAmount > 0 && (
                              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-2.5 sm:p-3">
                                <p className="text-xs text-red-700 dark:text-red-400 font-medium mb-1">Due</p>
                                <p className="text-base sm:text-lg font-bold text-red-900 dark:text-red-100 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(dueAmount)}>
                                  {formatCurrencySmart(dueAmount, state.currencyFormat)}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {selectedOrder.deliveryCharge > 0 && (
                    <div className="sm:col-span-2">
                      <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">Delivery Charge</p>
                      <p className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white" title={formatCurrency(selectedOrder.deliveryCharge)}>
                        {formatCurrencySmart(selectedOrder.deliveryCharge, state.currencyFormat)}
                      </p>
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('totalAmount', state.currentLanguage)}</p>
                    <div className="flex items-baseline gap-2">
                      {(() => {
                        const { finalTotal, originalTotal, hasDiscount } = getOrderDisplayTotals(selectedOrder);
                        return (
                          <>
                            {hasDiscount && (
                              <span className="text-sm sm:text-base text-slate-400 line-through decoration-slate-400/50">
                                {formatCurrencySmart(originalTotal, state.currencyFormat)}
                              </span>
                            )}
                            <p className="text-xl sm:text-2xl font-bold text-emerald-600 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(finalTotal)}>
                              {formatCurrencySmart(finalTotal, state.currencyFormat)}
                            </p>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {selectedOrder.items && selectedOrder.items.length > 0 && (
                  <div>
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">{getTranslation('orderItems', state.currentLanguage)}</h3>
                    {/* Desktop Table View */}
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                        <thead className="bg-gray-50 dark:bg-slate-700/50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">{getTranslation('product', state.currentLanguage) || 'Product'}</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">{getTranslation('quantityHeader', state.currentLanguage)}</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">{getTranslation('priceHeader', state.currentLanguage) || 'Price'}</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">{getTranslation('totalHeader', state.currentLanguage)}</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                          {selectedOrder.items.map((item, index) => {
                            const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
                            return (
                              <tr key={index}>
                                <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{item.name || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 text-right">
                                  {qty} {unit}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 text-right" title={formatCurrency(rate)}>
                                  {formatCurrencySmart(rate, state.currencyFormat)}
                                </td>
                                <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-right" title={formatCurrency(total)}>
                                  {formatCurrencySmart(total, state.currencyFormat)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* Mobile Card View */}
                    <div className="sm:hidden space-y-3">
                      {selectedOrder.items.map((item, index) => {
                        const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
                        return (
                          <div key={index} className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3 border border-gray-200 dark:border-slate-700">
                            <div className="flex items-start justify-between mb-2">
                              <p className="text-sm font-semibold text-gray-900 dark:text-white flex-1 pr-2">{item.name || 'N/A'}</p>
                              <p className="text-sm font-bold text-gray-900 dark:text-white" title={formatCurrency(total)}>{formatCurrencySmart(total, state.currencyFormat)}</p>
                            </div>
                            <div className="flex items-center justify-between text-xs text-gray-600 dark:text-slate-400">
                              <span>{qty} {unit}</span>
                              <span><span title={formatCurrency(rate)}>{formatCurrencySmart(rate, state.currencyFormat)}</span> per {unit}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(() => {
                  const mongoId = (selectedOrder._id || '').toString();
                  const localId = (selectedOrder.id || '').toString();
                  const orderRefunds = (state.refunds || []).filter(r => {
                    const rid = (r.orderId || r.orderID || r.order_id || '').toString();
                    return rid !== '' && (rid === mongoId || rid === localId);
                  });

                  if (orderRefunds.length === 0) return null;

                  return (
                    <div className="mt-8 pt-8 border-t border-red-100 dark:border-red-900/20">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                          <RotateCcw className="h-5 w-5 text-red-600 dark:text-red-400" />
                        </div>
                        <h3 className="text-base sm:text-lg font-bold text-red-600 dark:text-red-400 uppercase tracking-tight">Refund History</h3>
                      </div>

                      <div className="space-y-4">
                        {orderRefunds.map((refund, ridx) => (
                          <div key={refund.id || ridx} className="bg-red-50/50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-2xl p-4 sm:p-5">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                              <div>
                                <p className="text-[10px] font-black uppercase text-red-500/60 tracking-widest mb-1">Refund ID</p>
                                <p className="text-sm font-bold text-slate-900 dark:text-white font-mono">{refund.id?.toString().slice(-8).toUpperCase()}</p>
                              </div>
                              <div className="sm:text-right">
                                <p className="text-[10px] font-black uppercase text-red-500/60 tracking-widest mb-1">Date & Time</p>
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{formatDateTime(refund.refundDate || refund.createdAt || refund.date)}</p>
                              </div>
                            </div>

                            <div className="bg-white dark:bg-slate-900/50 rounded-xl overflow-hidden border border-red-100 dark:border-red-900/20 mb-4">
                              <table className="min-w-full divide-y divide-red-50 dark:divide-red-900/20">
                                <thead className="bg-red-50/30 dark:bg-red-900/20">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-[10px] font-black uppercase text-red-600 tracking-wider">Refunded Item</th>
                                    <th className="px-3 py-2 text-right text-[10px] font-black uppercase text-red-600 tracking-wider">Qty</th>
                                    <th className="px-3 py-2 text-right text-[10px] font-black uppercase text-red-600 tracking-wider">Amount</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-red-50/50 dark:divide-red-900/10">
                                  {(refund.items || []).map((ri, iidx) => (
                                    <tr key={iidx}>
                                      <td className="px-3 py-2 text-sm text-slate-700 dark:text-slate-300 font-medium">{ri.name}</td>
                                      <td className="px-3 py-2 text-sm text-slate-900 dark:text-white font-black text-right">{ri.qty} {ri.unit}</td>
                                      <td className="px-3 py-2 text-sm text-slate-900 dark:text-white font-black text-right">{formatCurrencySmart(ri.lineTotal || (ri.qty * ri.rate), state.currencyFormat)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              <div className="flex flex-col">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Cash Refunded</span>
                                <span className="text-sm font-bold text-slate-900 dark:text-white">{formatCurrencySmart(refund.cashRefunded || 0, state.currencyFormat)}</span>
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Credit Applied</span>
                                <span className="text-sm font-bold text-emerald-600">+{formatCurrencySmart((refund.totalRefundAmount || 0) - (refund.cashRefunded || 0), state.currencyFormat)}</span>
                              </div>
                              <div className="flex flex-col col-span-2 sm:col-span-1 border-t sm:border-t-0 sm:border-l border-red-100 dark:border-red-900/30 pt-2 sm:pt-0 sm:pl-3">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Total Refund</span>
                                <span className="text-base font-black text-red-600">{formatCurrencySmart(refund.totalRefundAmount, state.currencyFormat)}</span>
                              </div>
                            </div>

                            {refund.reason && (
                              <div className="mt-4 pt-3 border-t border-red-100 dark:border-red-900/30">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Reason</p>
                                <p className="text-xs italic text-slate-600 dark:text-slate-400">"{refund.reason}"</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Custom Date Modal */}
      {
        showCustomDateModal && (
          <div className="fixed inset-0 z-[1400] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-slideUp">
              <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                  <CalendarRange className="h-5 w-5 text-slate-900 dark:text-white" />
                  {getTranslation('customRange', state.currentLanguage)}
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
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{getTranslation('startDate', state.currentLanguage)}</label>
                  <input
                    type="date"
                    value={tempCustomRange.start}
                    onChange={e => setTempCustomRange({ ...tempCustomRange, start: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{getTranslation('endDate', state.currentLanguage)}</label>
                  <input
                    type="date"
                    value={tempCustomRange.end}
                    onChange={e => setTempCustomRange({ ...tempCustomRange, end: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setCustomDateRange(tempCustomRange);
                      setFilterDateRange('custom');
                      setShowCustomDateModal(false);
                      setCurrentPage(1);
                    }}
                    className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 font-bold rounded-xl transition-all shadow-lg"
                  >
                    {getTranslation('applyFilter', state.currentLanguage) || 'Apply Filter'}
                  </button>

                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* Print Size Selection Modal */}
      {
        showPrintModal && (
          <div className="fixed inset-0 z-[1400] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-slideUp">
              <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                  <Printer className="h-5 w-5 text-slate-900 dark:text-white" />
                  Select Bill Format
                </h3>
                <button
                  onClick={() => { setShowPrintModal(false); setOrderToPrint(null); }}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { id: 'a4', label: 'A4 Page', desc: 'Standard full page invoice' },
                    { id: '80mm', label: 'Thermal 80mm', desc: 'Wide thermal receipt' },
                    { id: '58mm', label: 'Thermal 58mm', desc: 'Narrow thermal receipt' }
                  ].map((format) => (
                    <button
                      key={format.id}
                      onClick={() => setSelectedPrintFormat(format.id)}
                      className={`flex items-center p-3 rounded-xl border transition-all ${selectedPrintFormat === format.id
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-500'
                        : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
                        }`}
                    >
                      <div className={`p-2 rounded-full mr-3 ${selectedPrintFormat === format.id
                        ? 'bg-indigo-500 text-white'
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                        }`}>
                        <Receipt className="h-5 w-5" />
                      </div>
                      <div className="text-left">
                        <div className={`font-semibold ${selectedPrintFormat === format.id ? 'text-indigo-700 dark:text-indigo-400' : 'text-gray-900 dark:text-white'
                          }`}>
                          {format.label}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{format.desc}</div>
                      </div>
                      {selectedPrintFormat === format.id && (
                        <div className="ml-auto w-4 h-4 rounded-full bg-indigo-500 border-2 border-white dark:border-slate-800 shadow-sm" />
                      )}
                    </button>
                  ))}
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    onClick={() => executePrint(selectedPrintFormat)}
                    className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 font-bold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
                  >
                    <Printer className="h-4 w-4" />
                    Print Invoice
                  </button>
                  <button
                    onClick={() => { setShowPrintModal(false); setOrderToPrint(null); }}
                    className="w-full py-3 text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-300 font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

    </div >
  );
};

export default SalesOrderHistory;

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp, isPlanExpired, triggerSyncStatusUpdate } from '../../context/AppContext';
import {
  Plus,
  Search,
  Package,
  Truck,
  Calendar,
  Trash2,
  Edit,
  CheckCircle,
  Clock,
  AlertCircle,
  ShoppingCart,
  TrendingUp,
  Eye,
  X,
  ChevronDown,

  Filter,
  Download,
  FileSpreadsheet,
  FileText
} from 'lucide-react';
import jsPDF from 'jspdf';
import { formatCurrency, formatCurrencyCompact, formatCurrencySmart } from '../../utils/orderUtils';
import syncService from '../../services/syncService';
import { addWatermarkToPDF } from '../../utils/pdfUtils';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import AddPurchaseOrderModal from './AddPurchaseOrderModal';
import { getTranslation } from '../../utils/translations';
import CancelOrderRefundModal from './CancelOrderRefundModal';

const Purchase = () => {
  const { state, dispatch } = useApp();
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, orderId: null, orderInfo: null });
  const [viewOrderDetails, setViewOrderDetails] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = React.useRef(null);
  const [cancelModal, setCancelModal] = useState({ show: false, order: null, refundAmount: '' });

  const confirmCancelOrder = async (amountInput) => {
    try {
      if (!cancelModal.order) return;

      // Import DB utils dynamically
      const { addItem, updateItem, STORES } = await import('../../utils/indexedDB');
      const { addToSyncQueue } = await import('../../utils/dataFetcher');

      const order = cancelModal.order;
      const refundAmount = typeof amountInput === 'number' ? amountInput : parseFloat(cancelModal.refundAmount || 0);
      const paidAmount = parseFloat(order.amountPaid || 0);

      // Validate refund amount? Warn but allow 0 if user wants.
      // But typically refund <= paidAmount.
      if (refundAmount > paidAmount) {
        if (window.showToast) window.showToast(`Refund amount cannot exceed paid amount (${paidAmount})`, 'warning');
        return;
      }

      // 1. Update Supplier Balance
      const suppliers = state.suppliers || [];
      const supplier = suppliers.find(s => s.name === order.supplierName) ||
        suppliers.find(s => s.id === order.supplierId || s._id === order.supplierId);

      if (supplier) {
        const currentDue = Number(supplier.dueAmount || supplier.balanceDue || 0);
        const orderTotal = Number(order.total || order.totalValue || 0);

        // Formula: NewBalance = OldBalance - OrderTotal + RefundAmount
        const newBalance = currentDue - orderTotal + refundAmount;
        const balanceAfterCancellation = currentDue - orderTotal;

        const updatedSupplier = {
          ...supplier,
          dueAmount: newBalance,
          balanceDue: newBalance,
          isSynced: false,
          isUpdate: true,
          lastModified: new Date().toISOString()
        };

        // Update in IndexedDB
        await updateItem(STORES.suppliers, updatedSupplier);

        // Dispatch Supplier Update
        dispatch({ type: 'UPDATE_SUPPLIER', payload: updatedSupplier });

        // Add to Sync Queue
        await addToSyncQueue('supplier_update', updatedSupplier);

        // Record Cancel Purchase Transaction (Reverse Liability)
        const cancelTransaction = {
          id: `tx_cancel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          supplierId: supplier.id || supplier._id,
          orderId: order.id,
          type: 'cancel_purchase',
          amount: -orderTotal,
          date: new Date().toISOString(),
          description: `Cancelled Purchase Order #${order.id?.toString().slice(-6)}`,
          previousBalance: currentDue,
          currentBalance: balanceAfterCancellation,
          isSynced: false,
          isDeleted: false,
          createdAt: new Date().toISOString()
        };

        // Save to IndexedDB
        await addItem(STORES.supplierTransactions, cancelTransaction);

        // Dispatch Transaction
        dispatch({ type: 'ADD_SUPPLIER_TRANSACTION', payload: cancelTransaction });

        // Add to Sync Queue
        await addToSyncQueue('supplier_transaction_create', cancelTransaction);

        // Record Refund Transaction
        if (refundAmount > 0) {
          const refundTransaction = {
            id: `tx_refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            supplierId: supplier.id || supplier._id,
            orderId: order.id,
            type: 'refund',
            amount: refundAmount,
            date: new Date().toISOString(),
            description: `Refund for Cancelled Order #${order.id?.toString().slice(-6)}`,
            previousBalance: balanceAfterCancellation,
            currentBalance: newBalance,
            isSynced: false,
            isDeleted: false,
            createdAt: new Date().toISOString()
          };

          // Save to IndexedDB
          await addItem(STORES.supplierTransactions, refundTransaction);

          // Dispatch Transaction
          dispatch({ type: 'ADD_SUPPLIER_TRANSACTION', payload: refundTransaction });

          // Add to Sync Queue
          await addToSyncQueue('supplier_transaction_create', refundTransaction);
        }
      } else {
        console.warn('Supplier not found for cancelled order:', order.supplierName);
      }

      // 2. Update Order Status
      const updatedOrder = {
        ...order,
        status: 'cancelled',
        balanceDue: 0,
        refundedAmount: refundAmount, // Store this for record
        isSynced: false,
        lastModified: new Date().toISOString()
      };

      // Update in IndexedDB
      await updateItem(STORES.purchaseOrders, updatedOrder);

      // Dispatch Order Update
      dispatch({ type: 'UPDATE_PURCHASE_ORDER', payload: updatedOrder });

      // Add to Sync Queue
      await addToSyncQueue('purchase_order_update', {
        id: updatedOrder.id,
        orderData: updatedOrder // Ensure consistency with create payload structure if needed, primarily updatedOrder is crucial
      });

      dispatch({
        type: 'ADD_ACTIVITY', payload: {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          message: `Purchase order ${order.id} cancelled. Refund: ${formatCurrency(refundAmount)}`,
          timestamp: new Date().toISOString(),
          type: 'po_cancelled_refund'
        }
      });

      // Trigger sync if online
      if (syncService.isOnline()) {
        syncService.scheduleSync();
      }

      if (window.showToast) window.showToast(`Order cancelled. Refund of ${formatCurrencyCompact(refundAmount)} recorded.`, 'success');
      setCancelModal({ show: false, order: null, refundAmount: '' });

    } catch (e) {
      console.error('Error cancelling order:', e);
      if (window.showToast) window.showToast('Error cancelling order', 'error');
    }
  };

  const handleStatusChange = async (orderId, newStatus) => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to update order status.', 'error', 5000);
      }
      return;
    }

    const order = state.purchaseOrders.find(o =>
      String(o.id) === String(orderId) ||
      (o._id && String(o._id) === String(orderId))
    );

    if (!order) {
      if (window.showToast) window.showToast('Purchase order not found', 'error');
      return;
    }

    // Intercept 'cancelled' status to ensure confirmation and proper ledger updates
    if (newStatus === 'cancelled') {
      const paid = Number(order.amountPaid || 0);
      setCancelModal({
        show: true,
        order: order,
        refundAmount: paid // Will be 0 if unpaid, which matches the Confirm Modal logic
      });
      return;
    }

    // Check if this is a newly created order (created within last 2 seconds)
    // If so, wait a bit to ensure IndexedDB save is complete
    const orderCreatedAt = order.createdAt ? new Date(order.createdAt).getTime() : 0;
    const now = Date.now();
    const timeSinceCreation = now - orderCreatedAt;

    if (timeSinceCreation < 2000 && !order.isSynced) {

      // Wait a bit longer to ensure IndexedDB save is complete
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Ensure we pass the complete order with all fields preserved
    const updatedOrder = {
      ...order,
      status: newStatus,
      // Ensure ID fields are preserved
      id: order.id,
      _id: order._id,
      // Preserve timestamps
      createdAt: order.createdAt,
      date: order.date || order.createdAt
    };

    dispatch({ type: 'UPDATE_PURCHASE_ORDER', payload: updatedOrder });

    dispatch({
      type: 'ADD_ACTIVITY', payload: {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        message: `Purchase order ${orderId} status changed to ${newStatus}`,
        timestamp: new Date().toISOString(),
        type: 'po_status_changed'
      }
    });

    // Create batches if order is confirmed/completed and batches don't already exist
    console.log('🔄 Status change debug:', {
      orderId,
      oldStatus: order.status,
      newStatus,
      hasBatches: !!(order.batches && order.batches.length > 0),
      batchesCount: order.batches?.length || 0,
      batches: order.batches
    });

    // Check if batches already exist for this order (they might have been created during order creation)
    const batchesAlreadyExist = state.products.some(product =>
      product.batches?.some(batch => batch.purchaseOrderId === orderId)
    );

    if ((newStatus === 'confirmed' || newStatus === 'completed') && ((order.batches && order.batches.length > 0) || (order.items && order.items.length > 0)) && !batchesAlreadyExist) {

      try {
        await createBatchesForPurchaseOrder(order);

      } catch (error) {

        if (window.showToast) {
          window.showToast('Error creating batches for purchase order', 'error');
        }
      }
    } else {
      //('⚠️ Skipping batch creation - status:', newStatus, 'hasBatches:', !!(order.batches && order.batches.length > 0), 'hasItems:', !!(order.items && order.items.length > 0));
    }

    if (window.showToast) {
      window.showToast(`Purchase order status changed to ${newStatus}`, 'success');
    }
  };

  const itemsPerPage = 10;

  // Filter purchase orders - exclude deleted items
  const filteredOrders = state.purchaseOrders.filter(order => {
    // Exclude deleted items from UI (they're kept in IndexedDB for sync)
    if (order.isDeleted === true) return false;

    const matchesSearch = order.supplierName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.id.includes(searchTerm);
    const matchesStatus = filterStatus === 'all' || order.status === filterStatus;
    return matchesSearch && matchesStatus;
  }).sort((a, b) => {
    const dateA = new Date(a.date || a.createdAt || 0);
    const dateB = new Date(b.date || b.createdAt || 0);
    return dateB - dateA;
  });

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedOrders = filteredOrders.slice(startIndex, startIndex + itemsPerPage);

  // Calculate stats - exclude deleted items
  const activeOrders = state.purchaseOrders.filter(order => order.isDeleted !== true);
  const completedOrdersOnly = activeOrders.filter(order => order.status === 'completed');
  const totalOrders = completedOrdersOnly.length; // Only count completed orders
  const pendingOrders = activeOrders.filter(order => order.status === 'pending').length;
  const completedOrders = completedOrdersOnly.length;
  const totalValue = completedOrdersOnly.reduce((sum, order) => sum + (Number(order.total) || 0), 0); // Only sum completed orders


  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-600" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'cancelled':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusBadge = (status) => {
    const baseClasses = "px-3 py-1 rounded-full text-xs font-semibold";
    switch (status) {
      case 'pending':
        return `${baseClasses} bg-yellow-100 text-yellow-800`;
      case 'completed':
        return `${baseClasses} bg-green-100 text-green-800`;
      case 'cancelled':
        return `${baseClasses} bg-red-100 text-red-800`;
      default:
        return `${baseClasses} bg-gray-100 text-gray-800`;
    }
  };

  // Create batches for confirmed purchase orders
  const createBatchesForPurchaseOrder = async (order) => {
    try {
      const { addItem, updateItem, STORES } = await import('../../utils/indexedDB');


      // Handle both local orders (batches) and synced orders (items)
      const dataToProcess = order.batches || order.items || [];
      const isSyncedOrder = !order.batches && !!order.items;

      for (const itemData of dataToProcess) {
        console.log('🔍 Looking for product:', {
          itemProductId: itemData.productId,
          itemProductName: itemData.productName,
          isSyncedOrder,
          availableProductIds: state.products.map(p => p.id || p._id),
          availableProductNames: state.products.map(p => p.name)
        });

        // Find the product - try multiple matching strategies
        let product = null;

        // First try exact ID match
        product = state.products.find(p =>
          p.id === itemData.productId ||
          p._id === itemData.productId
        );

        // If not found, try name match
        if (!product) {
          product = state.products.find(p => p.name === itemData.productName);
        }

        // If still not found, try partial name match (case insensitive)
        if (!product) {
          product = state.products.find(p =>
            p.name && itemData.productName &&
            p.name.toLowerCase().trim() === itemData.productName.toLowerCase().trim()
          );
        }

        if (!product) {
          console.error('❌ Product not found for item:', {
            itemProductId: itemData.productId,
            itemProductName: itemData.productName,
            isSyncedOrder,
            availableProducts: state.products.map(p => ({ id: p.id, _id: p._id, name: p.name })).slice(0, 5) // Show first 5 products
          });
          continue;
        }

        // Create new batch object - handle both local (batches) and synced (items) formats
        const newBatch = {
          id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          _id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          productId: product.id || product._id,
          batchNumber: isSyncedOrder ? `Batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}` : itemData.batchNumber,
          quantity: itemData.quantity,
          costPrice: isSyncedOrder ? itemData.price : itemData.costPrice,
          sellingUnitPrice: isSyncedOrder ? itemData.price * 1.2 : itemData.sellingUnitPrice, // Estimate selling price for synced orders
          expiry: isSyncedOrder ? null : itemData.expiry,
          mfg: isSyncedOrder ? null : itemData.mfg,
          purchaseOrderId: order.id,
          createdAt: new Date().toISOString(),
          isSynced: false,
          lastModified: new Date().toISOString()
        };

        // Save batch to IndexedDB (addItem will check for duplicates by batchNumber)
        const savedBatchId = await addItem(STORES.productBatches, newBatch);

        // If addItem returned an existing ID (duplicate found), skip updating product stock
        if (savedBatchId !== newBatch.id && savedBatchId !== newBatch._id) {

          continue; // Skip to next batch
        }

        // Update product with new batch - merge with existing batches
        const existingBatches = product.batches || [];
        const updatedBatches = [...existingBatches, newBatch];

        const updatedProduct = {
          ...product,
          batches: updatedBatches,
          // Update total quantity
          quantity: (product.quantity || 0) + itemData.quantity,
          stock: (product.stock || 0) + itemData.quantity,
          // Preserve isSynced status (don't mark as unsynced for batch updates)
          isSynced: product.isSynced,
          lastModified: new Date().toISOString()
        };

        // Save updated product to IndexedDB
        await updateItem(STORES.products, updatedProduct);

        // Update UI state
        dispatch({ type: 'UPDATE_PRODUCT', payload: { ...updatedProduct, isBatchUpdate: true } });
      }

      // Add activity log for batch creation
      dispatch({
        type: 'ADD_ACTIVITY',
        payload: {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          message: `Batches created for confirmed purchase order ${order.id}`,
          timestamp: new Date().toISOString(),
          type: 'batches_created_from_po'
        }
      });

      // Trigger instant sync status update
      triggerSyncStatusUpdate();

      // Trigger background sync if online
      if (syncService.isOnline()) {
        syncService.scheduleSync();
      }

    } catch (error) {

      if (window.showToast) {
        window.showToast('Error creating batches for purchase order', 'error');
      }
    }
  };



  const handleDeleteOrder = (orderId) => {
    const order = state.purchaseOrders.find(o => o.id === orderId);
    const orderInfo = order ? {
      id: orderId,
      supplierName: order.supplierName || 'Unknown Supplier',
      total: order.total || 0,
      date: order.orderDate || order.createdAt || ''
    } : { id: orderId, supplierName: 'Unknown Supplier', total: 0, date: '' };

    setDeleteConfirm({ show: true, orderId, orderInfo });
  };

  const confirmDeleteOrder = () => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to delete purchase orders.', 'warning', 8000);
      }
      return;
    }
    if (deleteConfirm.orderId) {
      dispatch({ type: 'DELETE_PURCHASE_ORDER', payload: deleteConfirm.orderId });

      dispatch({
        type: 'ADD_ACTIVITY', payload: {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          message: `Purchase order ${deleteConfirm.orderId} deleted`,
          timestamp: new Date().toISOString(),
          type: 'po_deleted'
        }
      });

      if (window.showToast) {
        window.showToast(`Purchase order "${deleteConfirm.orderInfo.supplierName}" has been deleted successfully`, 'success', 4000);
      }

      setDeleteConfirm({ show: false, orderId: null, orderInfo: null });
    }
  };

  // Export Functions
  const downloadFile = (filename, content, contentType) => {
    console.log('downloadFile called with:', filename, contentType);
    try {
      const blob = new Blob([content], { type: contentType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      console.log('Download triggered successfully');
    } catch (err) {
      console.error('Error in downloadFile:', err);
    }
  };

  const escapeValue = (value) => {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  const exportPurchaseCSV = () => {
    console.log('Starting CSV Export...');
    try {
      const headers = [
        getTranslation('orderIdHeader', state.currentLanguage) || 'Order ID',
        getTranslation('supplier', state.currentLanguage),
        getTranslation('date', state.currentLanguage),
        getTranslation('status', state.currentLanguage),
        getTranslation('totalValue', state.currentLanguage),
        getTranslation('items', state.currentLanguage)
      ];

      const rows = filteredOrders.map(order => [
        escapeValue((order.id || order._id || '').toString().slice(-8).toUpperCase()),
        escapeValue(order.supplierName || getTranslation('unknownSupplier', state.currentLanguage)),
        escapeValue(formatDate(order.createdAt || order.date)),
        escapeValue(order.status),
        escapeValue(formatCurrencySmart(order.totalValue || order.total || 0, state.currencyFormat)),
        escapeValue((order.items || order.batches || []).length)
      ]);

      const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
      downloadFile(
        `purchase-report-${new Date().toISOString().split('T')[0]}.csv`,
        csvContent,
        'text/csv;charset=utf-8;'
      );
      if (window.showToast) {
        window.showToast(getTranslation('exportCSVSuccess', state.currentLanguage) || 'Purchase orders exported as CSV.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('Export CSV Error Stack:', error.stack);
      console.error('Export CSV Error:', error);
      if (window.showToast) {
        window.showToast(getTranslation('exportError', state.currentLanguage) || 'Error exporting. Please try again.', 'error');
      }
    }
  };

  const exportPurchasePDF = async () => {
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
        const amount = Number(val || 0);
        const isWhole = amount % 1 === 0;
        return `Rs. ${amount.toLocaleString('en-IN', {
          minimumFractionDigits: isWhole ? 0 : 2,
          maximumFractionDigits: 2
        })}`;
      };



      // --------      /* -------- LOGO & APP BRANDING -------- */
      const logoX = margin;
      const logoY = 8;
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
      pdf.text('Grocery studio', logoX + logoSize + 4, logoY + 7);

      pdf.setFontSize(7);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...COLORS.gray);
      pdf.text('Advanced Billing & Inventory Solution', logoX + logoSize + 4, logoY + 11);

      // Report Meta (Right Side)
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.setTextColor(...COLORS.black);
      pdf.text('PURCHASE REPORT', pageWidth - margin, logoY + 5, { align: 'right' });

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(...COLORS.gray);
      const today = new Date();
      pdf.text(`Date: ${formatDate(today)}`, pageWidth - margin, logoY + 11, { align: 'right' });
      pdf.text(`Generated: ${formatDateTime(today)}`, pageWidth - margin, logoY + 16, { align: 'right' });

      /* -------- CENTER SHOP INFO -------- */
      let currentY = 28 + 10; // headerHeight is roughly 28 (implicit from previous view but not const here?) - wait, headerHeight was not defined in this snippet but likely similar. Let's use hardcoded or similar variable if available.
      // Re-checking previous file content... headerHeight isn't in the snippet but usually is 28.
      // Safe to assume similar flow or define it if missing. Actually in Purchase.js previous snippet didn't show headerHeight def.
      // Let's assume start Y.

      const currentUser = state.currentUser || {};
      const owner = currentUser.owner || currentUser;
      const shopName = state.storeName || owner.shopName || 'My Store';

      // Shop Name (Big & Bold)
      if (shopName) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(22);
        pdf.setTextColor(...COLORS.black);
        pdf.text(shopName, pageWidth / 2, currentY, { align: 'center' });
        currentY += 7;
      }

      // Address & other info (Smaller, Centered)
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(...COLORS.gray);

      const details = [];
      const addr = state.storeAddress || owner.address;
      const phone = state.storePhone || owner.phone || owner.mobileNumber;
      const gst = state.storeGstin || owner.gstin;

      if (addr) details.push(addr);
      if (phone) details.push(`Contact: ${phone}`);
      if (gst) details.push(`GSTIN: ${gst}`);

      if (details.length > 0) {
        pdf.text(details.join(' | '), pageWidth / 2, currentY, { align: 'center' });
        currentY += 8;
      } else {
        currentY += 5;
      }

      let y = currentY + 2;

      /* ================= SUMMARY CARDS ================= */
      const cardW = (contentWidth - 9) / 4; // 4 cards, 3 gaps of 3mm
      const cardH = 22;

      const activeOrders = state.purchaseOrders.filter(order => order.isDeleted !== true);
      const completedOrdersOnly = activeOrders.filter(order => order.status === 'completed');
      const stats_totalValue = completedOrdersOnly.reduce((sum, order) => sum + (Number(order.total) || 0), 0);

      const summaryMetrics = [
        { label: 'TOTAL VALUE', value: formatPDFCurrency(stats_totalValue), color: COLORS.primary },
        { label: 'COMPLETED', value: completedOrdersOnly.length.toString(), color: COLORS.success },
        { label: 'PENDING', value: activeOrders.filter(o => o.status === 'pending').length.toString(), color: COLORS.secondary },
        { label: 'TOTAL ORDERS', value: activeOrders.length.toString(), color: COLORS.gray } // Note: using activeOrders to match UI logic
      ];

      summaryMetrics.forEach((m, i) => {
        const x = margin + i * (cardW + 3);

        // Premium Card (Shadowless approach for clean modern look)
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'F');
        pdf.setDrawColor(...COLORS.border);
        pdf.setLineWidth(0.1);
        pdf.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'S');

        pdf.setFontSize(7.5);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...COLORS.gray);
        pdf.text(m.label, x + 4, y + 8);

        pdf.setFontSize(14); // Increased font size
        pdf.setFont('helvetica', 'bold'); // Ensure bold
        pdf.setTextColor(...COLORS.black);
        pdf.text(m.value, x + 4, y + 16);
      });

      y += cardH + 15;

      /* ================= TABLE ================= */
      pdf.setFontSize(10.5);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(...COLORS.black);
      pdf.text('ORDER DETAILS', margin, y);
      y += 6.5;

      // Table Weights (Portrait: Total ~180mm content width)
      const colWeights = [
        { header: 'S.No.', width: 15, align: 'center' },
        { header: 'ID', width: 25, align: 'center' }, // ID (Centered)
        { header: 'SUPPLIER', width: 45, align: 'center' }, // Supplier (Centered)
        { header: 'DATE', width: 25, align: 'center' }, // Date (Centered)
        { header: 'STATUS', width: 25, align: 'center' }, // Status (Centered)
        { header: 'ITEMS', width: 15, align: 'center' }, // Items (Centered)
        { header: 'TOTAL', width: 30, align: 'center' } // Total (Centered)
      ];

      // Table Header Bordered
      pdf.setFillColor(245, 247, 255);
      pdf.rect(margin, y, contentWidth, 10, 'F');

      // Header Outline
      pdf.setDrawColor(...COLORS.border);
      pdf.setLineWidth(0.1);
      pdf.rect(margin, y, contentWidth, 10, 'S');

      // Header Vertical Lines
      let vHeaderX = margin;
      colWeights.forEach((col, i) => {
        if (i < colWeights.length - 1) {
          vHeaderX += col.width;
          pdf.line(vHeaderX, y, vHeaderX, y + 10);
        }
      });

      pdf.setTextColor(...COLORS.primary);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);

      let currentX = margin;
      colWeights.forEach((col, i) => {
        // Enforce center alignment
        let drawX = currentX + (col.width / 2);
        pdf.text(col.header, drawX, y + 6.5, { align: 'center' });
        currentX += col.width;
      });
      y += 10;

      // Table Rows
      if (filteredOrders.length === 0) {
        pdf.setDrawColor(...COLORS.border);
        pdf.rect(margin, y, contentWidth, 12, 'S');
        pdf.setTextColor(...COLORS.gray);
        pdf.text('No purchase orders found', margin + contentWidth / 2, y + 8, { align: 'center' });
        y += 12;
      } else {
        filteredOrders.forEach((order, idx) => {
          const rowH = 10;
          if (y > pageHeight - 20) {
            pdf.addPage();
            y = 20;

            // Header Background
            pdf.setFillColor(245, 247, 255);
            pdf.rect(margin, y, contentWidth, 10, 'F');

            // Header Outline
            pdf.setDrawColor(...COLORS.border);
            pdf.setLineWidth(0.1);
            pdf.rect(margin, y, contentWidth, 10, 'S');

            // Header Vertical Lines
            let vHeaderRepeatX = margin;
            colWeights.forEach((col, i) => {
              if (i < colWeights.length - 1) {
                vHeaderRepeatX += col.width;
                pdf.line(vHeaderRepeatX, y, vHeaderRepeatX, y + 10);
              }
            });

            pdf.setTextColor(...COLORS.primary);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(9);

            let rCurrentX = margin;
            colWeights.forEach((col, i) => {
              let drawX = rCurrentX + 2;
              if (col.align === 'center') drawX = rCurrentX + (col.width / 2);
              if (col.align === 'right') drawX = rCurrentX + col.width - 2;
              pdf.text(col.header, drawX, y + 6.5, { align: col.align || 'left' });
              rCurrentX += col.width;
            });
            y += 10;
          }

          if (idx % 2 === 1) {
            pdf.setFillColor(252, 253, 255);
            pdf.rect(margin, y, contentWidth, rowH, 'F');
          }

          // Row Outline
          pdf.setDrawColor(...COLORS.border);
          pdf.setLineWidth(0.1);
          pdf.rect(margin, y, contentWidth, rowH, 'S');

          // Row Vertical Lines
          let vRowX = margin;
          colWeights.forEach((col, i) => {
            if (i < colWeights.length - 1) {
              vRowX += col.width;
              pdf.line(vRowX, y, vRowX, y + rowH);
            }
          });

          pdf.setTextColor(...COLORS.black);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9);

          let rowDX = margin;

          const orderId = (order.id || order._id || '').toString().slice(-6).toUpperCase();
          const supplierName = (order.supplierName || 'Unknown').substring(0, 25);
          const date = formatDate(order.createdAt || order.date);
          const status = (order.status || 'Pending').toUpperCase();
          const itemsCount = (order.items || order.batches || []).length.toString();
          const totalVal = formatPDFCurrency(order.totalValue || order.total || 0);

          // S.No.
          pdf.text((idx + 1).toString(), rowDX + (colWeights[0].width / 2), y + 6.5, { align: 'center' });
          rowDX += colWeights[0].width;

          // ID (Center)
          pdf.text(orderId, rowDX + (colWeights[1].width / 2), y + 6.5, { align: 'center' });
          rowDX += colWeights[1].width;

          // Supplier (Center)
          pdf.text(supplierName, rowDX + (colWeights[2].width / 2), y + 6.5, { align: 'center' });
          rowDX += colWeights[2].width;

          // Date (Center)
          pdf.text(date, rowDX + (colWeights[3].width / 2), y + 6.5, { align: 'center' });
          rowDX += colWeights[3].width;

          // Status (Center)
          if (status === 'COMPLETED' || status === 'RECEIVED') pdf.setTextColor(22, 163, 74);
          else if (status === 'Pending') pdf.setTextColor(202, 138, 4);
          else pdf.setTextColor(220, 38, 38);
          pdf.text(status, rowDX + (colWeights[4].width / 2), y + 6.5, { align: 'center', fontSize: 8 });
          pdf.setTextColor(...COLORS.black); // Reset
          rowDX += colWeights[4].width;

          // Items (Center)
          pdf.text(itemsCount, rowDX + (colWeights[5].width / 2), y + 6.5, { align: 'center' });
          rowDX += colWeights[5].width;

          // Total (Center)
          pdf.setFont('helvetica', 'bold');
          pdf.text(totalVal, rowDX + (colWeights[6].width / 2), y + 6.5, { align: 'center' });
          pdf.setFont('helvetica', 'normal');
          rowDX += colWeights[6].width;

          y += rowH;
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
        pdf.text(
          state.currentUser?.shopName || 'Store',
          pageWidth - margin,
          pageHeight - 10,
          { align: 'right' }
        );
      }

      // Add watermark
      await addWatermarkToPDF(pdf, sellerLogo || undefined);

      const pdfBlob = pdf.output('blob');
      downloadFile(
        `purchase-report-${new Date().toISOString().split('T')[0]}.pdf`,
        pdfBlob,
        'application/pdf'
      );
      if (window.showToast) {
        window.showToast(getTranslation('exportPDFSuccess', state.currentLanguage) || 'Purchase Report exported as PDF.', 'success');
      }
      setShowExportMenu(false);

    } catch (error) {
      console.error('Export PDF Error:', error);
      if (window.showToast) {
        window.showToast(getTranslation('exportError', state.currentLanguage) || 'Error exporting report. Please try again.', 'error');
      }
    }
  };

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-6 fade-in-up">
      {/* Professional Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{getTranslation('purchaseOrders', state.currentLanguage)}</h1>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{getTranslation('manageSupplierOrders', state.currentLanguage)}</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {/* Export Button */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="btn-secondary inline-flex items-center justify-center text-sm px-4 py-2 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-700 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              <Download className="h-4 w-4 mr-2" />
              <span>{getTranslation('export', state.currentLanguage)}</span>
            </button>

            {showExportMenu && (
              createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowExportMenu(false)}>
                  <div
                    className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-slate-700"
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{getTranslation('exportOrders', state.currentLanguage) || 'Export Orders'}</h3>
                      <button
                        onClick={() => setShowExportMenu(false)}
                        className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                    <div className="p-2 space-y-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('CSV Export Clicked');
                          if (window.showToast) window.showToast('Starting CSV Export...', 'info');
                          try {
                            exportPurchaseCSV();
                            // Delay closing slightly to ensure function runs? No, sync is fine.
                            // setShowExportMenu(false); // Kept for now, redundant call is fine
                          } catch (err) {
                            console.error(err);
                          }
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
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('PDF Export Clicked');
                          if (window.showToast) window.showToast('Generating PDF...', 'info');
                          setTimeout(() => {
                            exportPurchasePDF();
                          }, 100);
                          setShowExportMenu(false);
                        }}
                        className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                      >
                        <div className="p-2 rounded-lg bg-red-50 text-red-600 group-hover:bg-red-100 dark:bg-red-500/10 dark:text-red-500 dark:group-hover:bg-red-500/20 transition-colors">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsPDF', state.currentLanguage)}</span>
                          <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('printableDocumentFormat', state.currentLanguage)}</span>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )
            )}
          </div>

          <button
            onClick={() => {
              if (isPlanExpired(state)) {
                if (window.showToast) {
                  window.showToast('Your plan has expired. Please upgrade your plan to create new purchase orders.', 'warning', 8000);
                }
                return;
              }
              setShowAddModal(true);
            }}
            className="btn-primary inline-flex items-center justify-center text-sm px-4 py-2 touch-manipulation shadow-lg shadow-slate-900/20"
          >
            <ShoppingCart className="h-4 w-4 mr-2" />
            <span>{getTranslation('newPurchaseOrder', state.currentLanguage)}</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <div className="relative bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
            <Truck className="h-5 w-5" />
          </div>
          <div className="mt-2">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('fulfilled', state.currentLanguage)}</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-white whitespace-nowrap overflow-x-auto scrollbar-hide">{totalOrders}</p>
          </div>
        </div>

        <div className="relative bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400">
            <Clock className="h-5 w-5" />
          </div>
          <div className="mt-2">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('pending', state.currentLanguage)}</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-white whitespace-nowrap overflow-x-auto scrollbar-hide">{pendingOrders}</p>
          </div>
        </div>

        <div className="relative bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
            <CheckCircle className="h-5 w-5" />
          </div>
          <div className="mt-2">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('completed', state.currentLanguage)}</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-white whitespace-nowrap overflow-x-auto scrollbar-hide">{completedOrders}</p>
          </div>
        </div>

        <div className="relative bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-purple-50 dark:bg-purple-900/20 text-slate-900 dark:text-slate-100">
            <Package className="h-5 w-5" />
          </div>
          <div className="mt-2">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalValue', state.currentLanguage) || 'Total Value'}</p>
            <p className="text-2xl font-semibold text-rose-600 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(totalValue)}>
              {formatCurrencySmart(totalValue, state.currencyFormat)}
            </p>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex-1 lg:max-w-md">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2" htmlFor="purchase-search">
              {getTranslation('searchPurchaseOrders', state.currentLanguage)}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400 dark:text-slate-500" />
              </div>
              <input
                id="purchase-search"
                type="text"
                placeholder={getTranslation('searchPurchasePlaceholder', state.currentLanguage)}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm outline-none"
              />
            </div>
          </div>

          <div className="lg:w-auto lg:min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2" htmlFor="purchase-status-filter">
              {getTranslation('filterByStatus', state.currentLanguage)}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Filter className="h-4 w-4 text-gray-400 dark:text-slate-500" />
              </div>
              <select
                id="purchase-status-filter"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full pl-10 pr-10 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm outline-none appearance-none cursor-pointer"
              >
                <option value="all">{getTranslation('allStatus', state.currentLanguage)}</option>
                <option value="pending">{getTranslation('pendingOrders', state.currentLanguage)}</option>
                <option value="completed">{getTranslation('completedOrders', state.currentLanguage)}</option>
                <option value="cancelled">{getTranslation('cancelledOrders', state.currentLanguage)}</option>
              </select>
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Purchase Orders Table - Desktop View */}
      <div className="card hidden lg:block overflow-hidden dark:bg-slate-800 dark:border-slate-700">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-700/50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 sticky left-0 z-10 bg-slate-50 dark:bg-slate-800/50 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]">{getTranslation('supplier', state.currentLanguage)}</th>
                <th className="px-4 py-3 text-center">{getTranslation('items', state.currentLanguage)}</th>
                <th className="px-4 py-3 text-right">{getTranslation('total', state.currentLanguage)}</th>
                <th className="px-4 py-3 text-center">{getTranslation('payment', state.currentLanguage)}</th>
                <th className="px-4 py-3 text-center">{getTranslation('status', state.currentLanguage)}</th>
                <th className="px-4 py-3 text-right">{getTranslation('date', state.currentLanguage)}</th>
                <th className="px-4 py-3 text-right sticky right-0 z-10 bg-slate-50 dark:bg-slate-800/50 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.05)]">{getTranslation('actions', state.currentLanguage)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
              {paginatedOrders.map((order) => {
                // Calculate payment details if missing (fallback)
                const total = Number(order.total || order.totalValue || 0);
                const paid = Number(order.amountPaid || 0);
                const due = order.balanceDue !== undefined ? Number(order.balanceDue) : (total - paid);
                const paymentStatus = order.paymentStatus || (due <= 0.01 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid'));

                return (
                  <tr key={order.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group">
                    <td className="px-4 py-4 align-top sticky left-0 z-10 bg-white dark:bg-slate-800 group-hover:bg-slate-50 dark:group-hover:bg-slate-700/50 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 shadow-sm border border-indigo-100 dark:border-indigo-800">
                          <Truck className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-slate-900 dark:text-white break-all text-sm" title={order.supplierName || 'Unknown Supplier'}>
                            {order.supplierName || getTranslation('unknownSupplier', state.currentLanguage)}
                          </p>
                          <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-0.5">
                            #{order.id ? order.id.toString().slice(-6) : '---'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center align-top">
                      <div className="flex flex-col items-center justify-center h-full">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          <Package className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-xs font-semibold">
                            {(order.batches?.length || order.items?.length || 0)}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right align-top">
                      <span className="font-bold text-slate-900 dark:text-white text-sm" title={formatCurrency(total)}>
                        {formatCurrencySmart(total, state.currencyFormat)}
                      </span>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex flex-col gap-1.5 w-full max-w-[140px] mx-auto">
                        <div className="flex items-center justify-between text-xs">
                          <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] uppercase tracking-wider
                            ${paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' :
                              paymentStatus === 'partial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800' :
                                'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border border-rose-200 dark:border-rose-800'}`}>
                            {paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}
                          </span>
                          <span className="text-slate-400 text-[10px]">{order.paymentMethod === 'due' ? 'Credit' : 'Cash/Online'}</span>
                        </div>

                        {paymentStatus !== 'paid' && (
                          <div className="flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-800 rounded px-2 py-1 border border-slate-100 dark:border-slate-700">
                            <span className="text-slate-500">Due:</span>
                            <span className="font-bold text-rose-600 dark:text-rose-400">{formatCurrencyCompact(due)}</span>
                          </div>
                        )}
                        {paid > 0 && paymentStatus !== 'unpaid' && (
                          <div className="flex items-center justify-between text-xs px-2">
                            <span className="text-slate-400">Paid:</span>
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatCurrencyCompact(paid)}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top text-center">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusBadge(order.status).replace('px-3', '').replace('py-1', '').replace('rounded-full', '')} border-opacity-50`}>
                        {getStatusIcon(order.status)}
                        <span className="capitalize">{getTranslation(order.status, state.currentLanguage)}</span>
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right align-top">
                      <div className="flex flex-col items-end">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {new Date(order.date || order.createdAt).toLocaleDateString()}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(order.date || order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right align-top sticky right-0 z-10 bg-white dark:bg-slate-800 group-hover:bg-slate-50 dark:group-hover:bg-slate-700/50 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.05)]">
                      <div className="inline-flex items-center gap-2">
                        {order.status === 'pending' && (
                          <button
                            onClick={() => {
                              if (isPlanExpired(state)) {
                                if (window.showToast) window.showToast('Plan expired. Upgrade to update order status.', 'error');
                                return;
                              }
                              handleStatusChange(order.id, 'completed');
                            }}
                            className={`rounded-md border p-2 transition ${isPlanExpired(state)
                              ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed opacity-50'
                              : 'border-green-100 dark:border-green-900/50 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 hover:text-green-700 dark:hover:text-green-300'}`}
                            title="Mark as completed"
                            disabled={isPlanExpired(state)}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                        )}

                        <button
                          onClick={() => setViewOrderDetails(order)}
                          className="rounded-md border border-blue-100 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 p-2 text-blue-600 dark:text-blue-400 transition hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:text-blue-700 dark:hover:text-blue-300"
                          title="View order details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>

                        {(order.status !== 'completed' && order.status !== 'cancelled') && (
                          <button
                            onClick={() => {
                              if (isPlanExpired(state)) {
                                if (window.showToast) window.showToast('Plan expired. Upgrade to cancel order.', 'error');
                                return;
                              }
                              handleStatusChange(order.id, 'cancelled');
                            }}
                            className={`rounded-md border p-2 transition ${isPlanExpired(state)
                              ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed opacity-50'
                              : 'border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-700 dark:hover:text-red-300'}`}
                            title="Cancel order"
                            disabled={isPlanExpired(state)}
                          >
                            <AlertCircle className="h-4 w-4" />
                          </button>
                        )}

                        <button
                          onClick={() => {
                            if (isPlanExpired(state)) {
                              if (window.showToast) window.showToast('Plan expired. Upgrade to delete order.', 'error');
                              return;
                            }
                            handleDeleteOrder(order.id);
                          }}
                          className={`rounded-md p-1.5 transition-colors ${isPlanExpired(state)
                            ? 'text-gray-400 cursor-not-allowed opacity-50'
                            : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-300'}`}
                          title="Delete order"
                          disabled={isPlanExpired(state)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Purchase Orders Cards - Mobile/Tablet View */}
      <div className="lg:hidden space-y-4">
        {paginatedOrders.length > 0 ? (
          paginatedOrders.map((order) => {
            const total = Number(order.total || order.totalValue || 0);
            const paid = Number(order.amountPaid || 0);
            const due = order.balanceDue !== undefined ? Number(order.balanceDue) : (total - paid);
            const paymentStatus = order.paymentStatus || (due <= 0.01 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid'));

            return (
              <div key={order.id} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
                {/* Header with supplier info */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Truck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-gray-900 dark:text-white mb-0.5">
                      {order.supplierName || 'Unknown Supplier'}
                    </h3>
                    <p className="text-xs text-slate-500 font-mono">#{order.id ? order.id.toString().slice(-6) : '---'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setViewOrderDetails(order)}
                      className="w-8 h-8 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 flex items-center justify-center transition-colors touch-manipulation"
                      title="View order details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {order.status === 'pending' && (
                      <button
                        onClick={() => {
                          if (isPlanExpired(state)) {
                            if (window.showToast) window.showToast('Plan expired. Upgrade to update order status.', 'error');
                            return;
                          }
                          handleStatusChange(order.id, 'completed');
                        }}
                        className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors touch-manipulation ${isPlanExpired(state)
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-50'
                          : 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50'}`}
                        title="Mark as completed"
                        disabled={isPlanExpired(state)}
                      >
                        <CheckCircle className="h-4 w-4" />
                      </button>
                    )}
                    {(order.status !== 'completed' && order.status !== 'cancelled') && (
                      <button
                        onClick={() => {
                          if (isPlanExpired(state)) {
                            if (window.showToast) window.showToast('Plan expired. Upgrade to cancel order.', 'error');
                            return;
                          }
                          handleStatusChange(order.id, 'cancelled');
                        }}
                        className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors touch-manipulation ${isPlanExpired(state)
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-50'
                          : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50'}`}
                        title="Cancel order"
                        disabled={isPlanExpired(state)}
                      >
                        <AlertCircle className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (isPlanExpired(state)) {
                          if (window.showToast) window.showToast('Plan expired. Upgrade to delete order.', 'error');
                          return;
                        }
                        handleDeleteOrder(order.id);
                      }}
                      className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors touch-manipulation ${isPlanExpired(state)
                        ? 'text-gray-400 cursor-not-allowed opacity-50'
                        : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'}`}
                      title="Delete order"
                      disabled={isPlanExpired(state)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Order details */}
                <div className="mb-3">
                  {order.batches && order.batches.length > 0 ? (
                    <>
                      <div className="mb-2">
                        <div className="text-xs text-gray-600 dark:text-slate-400 mb-2">
                          {order.batches.length} product{order.batches.length === 1 ? '' : 's'} in order
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('quantity', state.currentLanguage) || 'Total Quantity'}</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-white">{order.totalQuantity || 0} pcs</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('totalCost', state.currentLanguage)}</p>
                            <p className="text-lg font-bold text-red-600 dark:text-red-400 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(order.totalCostValue || 0)}>
                              {formatCurrencySmart(order.totalCostValue || 0, state.currencyFormat)}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/40 px-2 py-1 text-xs font-semibold text-green-700 dark:text-green-300">
                          {order.batches.length} {order.batches.length === 1 ? 'batch' : 'batches'}
                        </span>
                      </div>
                    </>
                  ) : order.items && order.items.length > 0 ? (
                    <>
                      <div className="mb-2">
                        <div className="text-xs text-gray-600 dark:text-slate-400 mb-2">
                          {order.items.length} {order.items.length === 1 ? 'item' : 'items'} in order
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('quantity', state.currentLanguage) || 'Total Quantity'}</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-white">
                              {order.items.reduce((sum, item) => sum + (item.quantity || 0), 0)} {order.items[0]?.unit || 'pcs'}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('totalCost', state.currentLanguage)}</p>
                            <p className="text-lg font-bold text-red-600 dark:text-red-400 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(order.total || 0)}>
                              {formatCurrencySmart(order.total || 0, state.currencyFormat)}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/40 px-2 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                          {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4 text-gray-500 dark:text-slate-500">
                      <Package className="h-8 w-8 mx-auto mb-2 text-gray-300 dark:text-slate-700" />
                      <p className="text-sm">{getTranslation('noItemsAdded', state.currentLanguage) || 'No items in this order'}</p>
                    </div>
                  )}
                </div>

                {/* Payment Details */}
                <div className="mb-3 pt-3 border-t border-dashed border-gray-200 dark:border-slate-700/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Payment Status</span>
                    <span className={`px-2 py-0.5 rounded-md font-bold text-xs uppercase tracking-wider
                      ${paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' :
                        paymentStatus === 'partial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800' :
                          'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border border-rose-200 dark:border-rose-800'}`}>
                      {paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-slate-400">Paid:</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrencyCompact(paid)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-slate-400">Balance:</span>
                      <span className="font-bold text-rose-600 dark:text-rose-400">{formatCurrencyCompact(due)}</span>
                    </div>
                  </div>
                </div>

                {/* Status and date */}
                < div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-slate-700" >
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${getStatusBadge(order.status)}`}>
                    {getStatusIcon(order.status)}
                    <span className="capitalize">{order.status}</span>
                  </span>
                  <p className="text-sm text-gray-600 dark:text-slate-400">
                    {formatDate(order.date || order.createdAt || new Date())}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-8 text-center shadow-lg">
            <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Truck className="h-8 w-8 text-blue-400 dark:text-blue-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{getTranslation('noPurchaseOrdersYet', state.currentLanguage)}</h3>
            <p className="text-gray-600 dark:text-slate-400 mb-6 font-medium">{getTranslation('startManagingOrders', state.currentLanguage)}</p>
            <button
              onClick={() => {
                if (isPlanExpired(state)) {
                  if (window.showToast) {
                    window.showToast('Your plan has expired. Please upgrade your plan to create new purchase orders.', 'warning', 8000);
                  }
                  return;
                }
                setShowAddModal(true);
              }}
              className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-xl shadow-lg shadow-slate-900/20 active:scale-95 transition-all"
            >
              <Plus className="h-5 w-5" />
              <span className="font-bold">{getTranslation('createPurchaseOrder', state.currentLanguage)}</span>
            </button>
          </div>
        )}
      </div >

      {/* Pagination */}
      {
        totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4">
            <div className="text-sm text-gray-600 dark:text-slate-400">
              {getTranslation('showing', state.currentLanguage)} <span className="font-semibold text-gray-900 dark:text-white">{startIndex + 1}</span> {getTranslation('to', state.currentLanguage)}{' '}
              <span className="font-semibold text-gray-900 dark:text-white">{Math.min(startIndex + itemsPerPage, filteredOrders.length)}</span> {getTranslation('of', state.currentLanguage)}{' '}
              <span className="font-semibold text-gray-900 dark:text-white">{filteredOrders.length}</span> {getTranslation('orders', state.currentLanguage)}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all touch-manipulation shadow-sm"
              >
                Previous
              </button>

              <div className="flex items-center gap-1 px-2">
                <span className="text-sm font-bold text-gray-900 dark:text-white">{currentPage}</span>
                <span className="text-sm text-gray-500 dark:text-slate-400">of {totalPages}</span>
              </div>

              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all touch-manipulation shadow-sm"
              >
                Next
              </button>
            </div>
          </div>
        )
      }

      {/* Add Purchase Order Modal */}
      {
        showAddModal && (
          <AddPurchaseOrderModal
            isOpen={showAddModal}
            onClose={() => setShowAddModal(false)}
            onSave={(orderData) => {
              // The modal already handles storing to IndexedDB and dispatching to Redux
              // Just log the activity and close the modal
              dispatch({
                type: 'ADD_ACTIVITY', payload: {
                  id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                  message: `New purchase order ${orderData.id} created`,
                  timestamp: new Date().toISOString(),
                  type: 'po_created'
                }
              });
              setShowAddModal(false);
            }}
          />
        )
      }

      {/* Cancel Order with Refund Modal */}
      {
        cancelModal.show && (
          <CancelOrderRefundModal
            isOpen={cancelModal.show}
            onClose={() => setCancelModal({ show: false, order: null, refundAmount: '' })}
            onConfirm={async (amount) => {
              setCancelModal(prev => ({ ...prev, refundAmount: amount }));
              await confirmCancelOrder(amount);
            }}
            order={cancelModal.order}
            currencyFormat={state.currencyFormat}
          />
        )
      }

      {/* Professional Delete Confirmation Modal */}
      {
        deleteConfirm.show && (
          <div className="fixed inset-0 z-[1001] flex items-center justify-center p-4" style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)' }}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border dark:border-slate-700" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center mb-4">
                <div className="p-3 rounded-xl mr-4" style={{ background: 'rgba(251, 113, 133, 0.16)' }}>
                  <AlertCircle className="h-6 w-6 text-red-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">{getTranslation('deletePurchaseOrderTitle', state.currentLanguage)}</h3>
                  <p className="text-sm mt-1 text-gray-500 dark:text-slate-400">
                    {getTranslation('deleteOrderConfirmMessage', state.currentLanguage) || 'This action cannot be undone'}
                  </p>
                </div>
              </div>
              <div className="mb-6 p-4 rounded-xl bg-gray-50 dark:bg-slate-700/50">
                <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
                  {getTranslation('deletePurchaseOrderConfirm', state.currentLanguage)} <span className="font-bold text-gray-900 dark:text-white">"{deleteConfirm.orderInfo?.supplierName}"</span>?
                </p>
                {deleteConfirm.orderInfo?.total > 0 && (
                  <p className="text-xs mt-2 text-gray-500 dark:text-slate-400">
                    {getTranslation('orderTotal', state.currentLanguage) || 'Order Total'}: <span className="font-semibold text-gray-900 dark:text-white break-all" title={formatCurrency(deleteConfirm.orderInfo.total)}>{formatCurrencySmart(deleteConfirm.orderInfo.total, state.currencyFormat)}</span>
                  </p>
                )}
                <p className="text-xs mt-2 text-gray-400 dark:text-slate-500 italic">
                  {getTranslation('deleteOrderWarning', state.currentLanguage) || 'This purchase order will be permanently removed. All associated data will be lost.'}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm({ show: false, orderId: null, orderInfo: null })}
                  className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 transition-all"
                >
                  {getTranslation('cancel', state.currentLanguage)}
                </button>
                <button
                  onClick={confirmDeleteOrder}
                  className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-red-500/20"
                  style={{
                    background: 'linear-gradient(135deg, #BE123C, #991F3D)'
                  }}
                >
                  {getTranslation('deleteOrder', state.currentLanguage) || 'Delete Order'}
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Order Details Modal */}
      {
        viewOrderDetails && typeof document !== 'undefined' && (
          createPortal(
            <div className="fixed inset-0 bg-white dark:bg-slate-800 z-[99999] flex flex-col overflow-hidden animate-fadeIn">
              <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-4 sm:px-6 py-4 flex items-center justify-between z-10 flex-shrink-0">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  {getTranslation('purchaseOrderDetails', state.currentLanguage)}
                </h3>
                <button
                  onClick={() => setViewOrderDetails(null)}
                  className="p-2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="p-4 sm:p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div className="bg-gray-50 dark:bg-slate-700/30 p-4 rounded-xl border dark:border-slate-700">
                      <h4 className="font-bold text-gray-900 dark:text-white mb-3">{getTranslation('orderInformation', state.currentLanguage)}</h4>
                      <div className="space-y-3 text-sm">
                        {/* Order ID removed per request */}
                        <p className="flex justify-between border-b dark:border-slate-700 pb-2"><span className="text-gray-500 dark:text-slate-400">{getTranslation('supplier', state.currentLanguage)}:</span> <span className="font-semibold dark:text-white">{viewOrderDetails.supplierName || getTranslation('unknownSupplier', state.currentLanguage)}</span></p>
                        <p className="flex justify-between border-b dark:border-slate-700 pb-2"><span className="text-gray-500 dark:text-slate-400">{getTranslation('date', state.currentLanguage)}:</span> <span className="font-semibold dark:text-white">{viewOrderDetails.orderDate || viewOrderDetails.createdAt || viewOrderDetails.date ?
                          formatDate(viewOrderDetails.orderDate || viewOrderDetails.createdAt || viewOrderDetails.date) : 'N/A'}</span></p>
                        <div className="flex justify-between items-center"><span className="text-gray-500 dark:text-slate-400">{getTranslation('status', state.currentLanguage)}:</span>
                          <span className={`${getStatusBadge(viewOrderDetails.status || 'pending')} flex items-center gap-1`}>
                            {getStatusIcon(viewOrderDetails.status || 'pending')}
                            <span className="capitalize">{getTranslation(viewOrderDetails.status || 'pending', state.currentLanguage)}</span>
                          </span>
                        </div>
                        <p className="flex justify-between items-center"><span className="text-gray-500 dark:text-slate-400">{getTranslation('created', state.currentLanguage)}:</span> <span className="dark:text-slate-300 font-medium">{viewOrderDetails.createdAt ? new Date(viewOrderDetails.createdAt).toLocaleString() : 'N/A'}</span></p>
                      </div>
                    </div>

                    <div className="bg-gray-50 dark:bg-slate-700/30 p-4 rounded-xl border dark:border-slate-700">
                      <h4 className="font-bold text-gray-900 dark:text-white mb-3">{getTranslation('orderSummary', state.currentLanguage)}</h4>
                      <div className="space-y-3 text-sm">
                        <p className="flex justify-between border-b dark:border-slate-700 pb-2"><span className="text-gray-500 dark:text-slate-400">{getTranslation('totalQuantityKey', state.currentLanguage)}:</span> <span className="font-bold text-slate-900 dark:text-slate-100">{
                          // Handle both local (batches) and synced (items) data formats
                          viewOrderDetails.totalQuantity ||
                          (viewOrderDetails.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0)) ||
                          (viewOrderDetails.items?.reduce((sum, item) => sum + (item.quantity || 0), 0)) ||
                          0
                        } {
                            viewOrderDetails.productUnit || viewOrderDetails.unit ||
                            (viewOrderDetails.items?.[0]?.unit) ||
                            getTranslation('pcs', state.currentLanguage)
                          }</span></p>
                        <p className="flex justify-between border-b dark:border-slate-700 pb-2"><span className="text-gray-500 dark:text-slate-400">{getTranslation('totalValueKey', state.currentLanguage)}:</span> <span className="font-bold text-slate-900 dark:text-slate-100" title={formatCurrency(viewOrderDetails.totalValue || viewOrderDetails.total || 0)}>{formatCurrencySmart(viewOrderDetails.totalValue || viewOrderDetails.total || 0, state.currencyFormat)}</span></p>

                        {/* Payment Details in Modal */}
                        <div className="pt-2 mt-2 border-t dark:border-slate-700">
                          {(() => {
                            const vTotal = Number(viewOrderDetails.total || viewOrderDetails.totalValue || 0);
                            const vPaid = Number(viewOrderDetails.amountPaid || 0);
                            const vDue = viewOrderDetails.balanceDue !== undefined ? Number(viewOrderDetails.balanceDue) : (vTotal - vPaid);
                            const vStatus = viewOrderDetails.paymentStatus || (vDue <= 0.01 ? 'paid' : (vPaid > 0 ? 'partial' : 'unpaid'));
                            return (
                              <>
                                <p className="flex justify-between items-center mb-2">
                                  <span className="text-gray-500 dark:text-slate-400">Payment Status:</span>
                                  <span className={`px-2 py-0.5 rounded text-xs uppercase font-bold
                                  ${vStatus === 'paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
                                      vStatus === 'partial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
                                        'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'}`}>
                                    {vStatus === 'paid' ? 'Paid' : vStatus === 'partial' ? 'Partial' : 'Unpaid'}
                                  </span>
                                </p>
                                {vStatus !== 'paid' && (
                                  <p className="flex justify-between font-medium">
                                    <span className="text-gray-500 dark:text-slate-400">Balance Due:</span>
                                    <span className="text-rose-600 dark:text-rose-400">{formatCurrencySmart(vDue, state.currencyFormat)}</span>
                                  </p>
                                )}
                                {vPaid > 0 && (
                                  <p className="flex justify-between text-xs mt-1">
                                    <span className="text-gray-500 dark:text-slate-500">Amount Paid:</span>
                                    <span className="text-emerald-600 dark:text-emerald-500">{formatCurrencySmart(vPaid, state.currencyFormat)}</span>
                                  </p>
                                )}
                              </>
                            );
                          })()}
                        </div>

                        {viewOrderDetails.notes && (
                          <p className="flex flex-col gap-1 mt-2 pt-2 border-t dark:border-slate-700"><span className="text-gray-500 dark:text-slate-400">{getTranslation('notes', state.currentLanguage)}:</span> <span className="dark:text-white italic">{viewOrderDetails.notes}</span></p>
                        )}
                        {(!viewOrderDetails.batches?.length && !viewOrderDetails.items?.length) && (
                          <p className="text-orange-600 dark:text-orange-400 flex items-center gap-2 font-medium">
                            <AlertCircle className="h-4 w-4" />
                            {getTranslation('noItems', state.currentLanguage)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                      <Package className="h-5 w-5 text-slate-900 dark:text-slate-100" />
                      {viewOrderDetails.batches ? getTranslation('batchDetails', state.currentLanguage) : getTranslation('itemDetails', state.currentLanguage)}
                    </h4>
                    <div className="space-y-3">
                      {((viewOrderDetails.batches && viewOrderDetails.batches.length > 0) ||
                        (viewOrderDetails.items && viewOrderDetails.items.length > 0)) ? (
                        (viewOrderDetails.batches || viewOrderDetails.items || []).map((item, index) => {
                          // Handle both batch format (local) and item format (synced from backend)
                          const isBatchFormat = viewOrderDetails.batches;
                          const quantity = item.quantity || 0;
                          const unit = item.unit || viewOrderDetails.productUnit || viewOrderDetails.unit || getTranslation('pcs', state.currentLanguage);
                          const productName = item.productName || item.name || `${getTranslation('item', state.currentLanguage)} ${index + 1}`;

                          return (
                            <div key={item.id || item.batchId || item.batchNumber || item.productId || index} className="border border-gray-200 dark:border-slate-700 rounded-xl p-4 bg-white dark:bg-slate-800 hover:shadow-md transition-shadow">
                              <div className="flex items-center justify-between mb-3">
                                <h5 className="font-bold text-gray-900 dark:text-white">
                                  {isBatchFormat ? (item.batchNumber || item.name || `${getTranslation('batch', state.currentLanguage)} ${index + 1}`) : productName}
                                </h5>
                                <span className="bg-indigo-50 dark:bg-indigo-900/40 px-3 py-1 rounded-full text-sm font-bold text-slate-900 dark:text-slate-100">
                                  {quantity} {unit}
                                </span>
                              </div>

                              {isBatchFormat ? (
                                // Batch format (local purchase orders)
                                <>
                                  <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="text-gray-500 dark:text-slate-400">{getTranslation('costPrice', state.currentLanguage)}: <span className="font-semibold text-gray-900 dark:text-white" title={formatCurrency(item.costPrice || 0)}>{formatCurrencySmart(item.costPrice || 0, state.currencyFormat)}</span></div>
                                    <div className="text-gray-500 dark:text-slate-400 text-right">{getTranslation('sellingPrice', state.currentLanguage)}: <span className="font-semibold text-gray-900 dark:text-white" title={formatCurrency(item.sellingUnitPrice || item.sellingPrice || 0)}>{formatCurrencySmart(item.sellingUnitPrice || item.sellingPrice || 0, state.currencyFormat)}</span></div>
                                  </div>
                                  {(item.mfg || item.expiry || item.manufactureDate || item.expiryDate) && (
                                    <div className="grid grid-cols-2 gap-4 text-xs text-gray-500 dark:text-slate-500 mt-2 pt-2 border-t dark:border-slate-700">
                                      <div>{getTranslation('mfg', state.currentLanguage)}: {item.mfg || item.manufactureDate ? formatDate(item.mfg || item.manufactureDate) : 'N/A'}</div>
                                      <div className="text-right">{getTranslation('expiry', state.currentLanguage)}: {item.expiry || item.expiryDate ? formatDate(item.expiry || item.expiryDate) : 'N/A'}</div>
                                    </div>
                                  )}
                                  <div className="mt-3 text-sm font-bold text-green-600 dark:text-green-400 flex justify-end">
                                    {getTranslation('estimatedProfit', state.currentLanguage)}: <span title={formatCurrency((quantity) * ((item.sellingUnitPrice || item.sellingPrice || 0) - (item.costPrice || 0)))}>{formatCurrencySmart((quantity) * ((item.sellingUnitPrice || item.sellingPrice || 0) - (item.costPrice || 0)), state.currencyFormat)}</span>
                                  </div>
                                </>
                              ) : (
                                // Item format (synced from backend)
                                <>
                                  <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="text-gray-500 dark:text-slate-400">{getTranslation('unitPrice', state.currentLanguage)}: <span className="font-semibold text-gray-900 dark:text-white" title={formatCurrency(item.price || 0)}>{formatCurrencySmart(item.price || 0, state.currencyFormat)}</span></div>
                                    <div className="text-gray-500 dark:text-slate-400 text-right">{getTranslation('subtotal', state.currentLanguage)}: <span className="font-bold text-slate-900 dark:text-slate-100" title={formatCurrency(item.subtotal || (item.price * quantity) || 0)}>{formatCurrencySmart(item.subtotal || (item.price * quantity) || 0, state.currencyFormat)}</span></div>
                                  </div>
                                  {item.isCustomProduct && (
                                    <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 mt-2 bg-blue-50 dark:bg-blue-900/30 w-fit px-2 py-1 rounded">
                                      <span>⭐</span>
                                      <span className="font-semibold">{getTranslation('customProduct', state.currentLanguage)}</span>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-center py-12 bg-gray-50 dark:bg-slate-700/20 rounded-2xl border-2 border-dashed dark:border-slate-700">
                          <Package className="h-12 w-12 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
                          <p className="text-gray-700 dark:text-slate-300 font-medium">{getTranslation('noDetailsAvailable', state.currentLanguage)}</p>
                          <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">{getTranslation('dataMissingMsg', state.currentLanguage)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        )
      }
    </div >
  );
};

export default Purchase;

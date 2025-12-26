import React, { useState, useRef, useEffect, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import jsPDF from 'jspdf';
import {
  Package,
  Filter,
  Download,
  Upload,
  AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Eye,
  Minus,
  Edit,
  Trash2,
  RotateCcw,
  FileText,
  FileSpreadsheet,
  FileJson,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  X,
  Layers,
  Layout
} from 'lucide-react';
import { getPathForView } from '../../utils/navigation';
import { apiRequest } from '../../utils/api';
import { updateItem, STORES } from '../../utils/indexedDB';
import { formatDate } from '../../utils/dateUtils';

// Lazy load heavy components
const BulkAddProductsModal = lazy(() => import('../Products/BulkAddProductsModal'));

// Loading component for modals
const ModalLoadingSpinner = () => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
  </div>
);

const Inventory = () => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showBatchDetailsModal, setShowBatchDetailsModal] = useState(false);
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, productId: null, productName: null });
  const [editingBatchId, setEditingBatchId] = useState(null);
  const [editingBatchData, setEditingBatchData] = useState(null);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [pendingExportType, setPendingExportType] = useState(null); // 'pdf', 'csv', 'json'
  const exportMenuRef = useRef(null);


  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && typeof exportMenuRef.current.contains === 'function' && event.target && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut: Shift + M to open bulk add products modal
  useKeyboardShortcut('m', false, true, () => {

    setShowBulkAddModal(true);
  });

  // Responsive pagination: 10 for mobile, 25 for desktop
  const [itemsPerPage, setItemsPerPage] = useState(10);

  useEffect(() => {
    const updateItemsPerPage = () => {
      if (window.innerWidth >= 1025) {
        // Desktop (1025px and above)
        setItemsPerPage(25);
      } else {
        // Mobile/Tablet (below 1025px)
        setItemsPerPage(10);
      }
    };

    updateItemsPerPage();
    window.addEventListener('resize', updateItemsPerPage);
    return () => window.removeEventListener('resize', updateItemsPerPage);
  }, []);

  const goToView = (view) => {
    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
    navigate(getPathForView(view));
  };

  const handleBatchDetailsClick = (product) => {
    if (!product || !product.id) {
      return;
    }

    // Ensure we get the product with batches from state
    const productWithBatches = state.products.find(p => p.id === product.id || p._id === product.id);
    setSelectedProduct(productWithBatches || product);
    setShowBatchDetailsModal(true);
  };

  const handleEditBatch = (batch) => {
    if (editingBatchId === (batch.id || batch._id)) {
      // Cancel editing
      setEditingBatchId(null);
      setEditingBatchData(null);
    } else {
      // Start editing
      setEditingBatchId(batch.id || batch._id);
      setEditingBatchData({
        batchNumber: batch.batchNumber || '',
        quantity: batch.quantity || '',
        costPrice: batch.costPrice || '',
        sellingUnitPrice: batch.sellingUnitPrice || '',
        mfg: batch.mfg ? new Date(batch.mfg).toISOString().split('T')[0] : '',
        expiry: batch.expiry ? new Date(batch.expiry).toISOString().split('T')[0] : ''
      });
    }
  };

  const handleBatchInputChange = (field, value) => {
    setEditingBatchData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleConfirmBatchEdit = async () => {
    try {
      const updateData = {
        batchNumber: editingBatchData.batchNumber,
        quantity: Number(editingBatchData.quantity),
        costPrice: Number(editingBatchData.costPrice),
        sellingUnitPrice: Number(editingBatchData.sellingUnitPrice),
        ...(editingBatchData.mfg && { mfg: editingBatchData.mfg }),
        ...(editingBatchData.expiry && { expiry: editingBatchData.expiry })
      };

      // Create the updated batch data for offline storage
      const currentBatch = selectedProduct.batches.find(b => (b.id || b._id) === editingBatchId);
      const updatedBatch = {
        ...currentBatch,
        ...updateData,
        id: editingBatchId,
        _id: editingBatchId,
        isSynced: false, // Mark as not synced for offline-first approach
        lastModified: new Date().toISOString()
      };

      // Update the batch in the selected product
      const updatedProduct = {
        ...selectedProduct,
        batches: selectedProduct.batches.map(b =>
          (b.id || b._id) === editingBatchId ? updatedBatch : b
        ),
        // Ensure the product has the correct ID for IndexedDB (MongoDB _id as id)
        id: selectedProduct._id || selectedProduct.id,
        _id: selectedProduct._id || selectedProduct.id,
        isSynced: false, // Mark product as having unsynced changes
        lastModified: new Date().toISOString()
      };

      // STEP 1: Save to IndexedDB FIRST (offline-first approach)
      console.log('💾 Saving to IndexedDB (offline-first):', {
        store: STORES.products,
        productId: updatedProduct.id,
        batchCount: updatedProduct.batches?.length
      });

      let localSaveSuccess = false;
      try {
        // Update the product in products store
        const productUpdateResult = await updateItem(STORES.products, updatedProduct);

        // Also update the individual batch in productBatches store
        const batchUpdateResult = await updateItem(STORES.productBatches, updatedBatch);

        localSaveSuccess = true;

      } catch (localError) {

        window.showToast('Failed to save locally. Please check your storage.', 'error');
        return;
      }

      if (localSaveSuccess) {
        // STEP 2: Update UI immediately

        const updatedProductsArray = state.products.map(p =>
          (p.id === updatedProduct.id || p._id === updatedProduct._id) ? updatedProduct : p
        );

        dispatch({
          type: 'SET_PRODUCTS',
          payload: updatedProductsArray
        });

        // Update local state
        setSelectedProduct(updatedProduct);

        // Show immediate success feedback
        window.showToast('Batch updated locally! Syncing to server...', 'success');

        // STEP 3: Add to sync queue for background sync
        try {
          const { addToSyncQueue } = await import('../../utils/dataFetcher');
          await addToSyncQueue('batch_update', {
            batchId: editingBatchId,
            productId: selectedProduct.id || selectedProduct._id,
            updateData,
            timestamp: new Date().toISOString()
          });

        } catch (queueError) {

        }

        // STEP 4: Attempt background sync if online
        try {
          const { isOnline } = await import('../../utils/dataFetcher');
          if (isOnline()) {

            const { backgroundSyncWithBackend } = await import('../../utils/dataFetcher');
            // Trigger sync in background (don't await to avoid blocking UI)
            backgroundSyncWithBackend(dispatch, {}).catch(syncError => {

            });
          } else {

            window.showToast('You are offline. Changes will sync when online.', 'info');
          }
        } catch (syncError) {

        }

        // Reset editing state
        setEditingBatchId(null);
        setEditingBatchData(null);
      }

    } catch (error) {

      window.showToast('Failed to update batch. Please try again.', 'error');
    }
  };

  const handleBulkAddProducts = (productsData) => {
    if (!productsData || productsData.length === 0) {
      if (window.showToast) {
        window.showToast('No products to add', 'warning');
      }
      return false;
    }

    // Check if we have enough capacity for all products
    const activeProducts = state.products.filter(product => !product.isDeleted);
    const totalProducts = activeProducts.length;
    const remainingCapacity = state.aggregatedUsage?.products?.remaining || 0;

    if (remainingCapacity !== null && remainingCapacity !== undefined && remainingCapacity < productsData.length) {
      const message = `Cannot add ${productsData.length} products. Only ${remainingCapacity} product slots remaining.`;
      if (window.showToast) {
        window.showToast(message, 'error', 5000);
      }
      return false;
    }

    // Get sellerId from auth
    const sellerId = state.currentUser?.sellerId;
    const productSellerId = sellerId || 'default';

    const addedProducts = [];
    const currentTime = new Date().toISOString();

    try {
      // Process each product
      for (let i = 0; i < productsData.length; i++) {
        const productData = productsData[i];

        // Skip empty products
        if (!productData.name || !productData.name.trim()) {

          continue;
        }

        // Build product object - matching AddProductModal structure
        const unit = productData.unit || 'pcs';
        const lowStockLevel = productData.lowStockLevel || 10;

        const newProduct = {
          id: Date.now().toString() + '_' + i, // Unique ID for each product
          name: productData.name,
          description: productData.description || '',
          category: productData.category || '',
          barcode: productData.barcode || '',
          sellerId: productSellerId,
          quantity: 0, // Default to 0 stock for bulk add
          stock: 0, // Default to 0 stock for bulk add
          unit: unit,
          costPrice: 0, // Default to 0 for bulk add
          unitPrice: 0, // Keep for backward compatibility
          sellingUnitPrice: 0, // Default to 0 for bulk add
          sellingPrice: 0, // Keep for backward compatibility
          lowStockLevel: lowStockLevel,
          isActive: true, // Default to active
          createdAt: currentTime,
          isSynced: false
        };

        addedProducts.push(newProduct);

        // Add to state
        dispatch({ type: ActionTypes.ADD_PRODUCT, payload: newProduct });
      }

      if (addedProducts.length > 0) {
        // Add activity log
        dispatch({
          type: ActionTypes.ADD_ACTIVITY,
          payload: {
            id: Date.now().toString(),
            message: `${addedProducts.length} products added in bulk from Inventory`,
            timestamp: currentTime,
            type: 'bulk_product_added'
          }
        });

        // Trigger sync status update
        if (window.triggerSyncStatusUpdate) {
          window.triggerSyncStatusUpdate();
        }

        // Show success message
        if (window.showToast) {
          window.showToast(`${addedProducts.length} products added successfully!`, 'success');
        }

        // Close modal
        setShowBulkAddModal(false);
        return true;
      } else {
        if (window.showToast) {
          window.showToast('No valid products to add', 'warning');
        }
        return false;
      }
    } catch (error) {

      if (window.showToast) {
        window.showToast('Error adding products. Please try again.', 'error');
      }
      return false;
    }
  };

  // Filter and sort products
  const getProductQuantity = (product) => {
    // Calculate total stock from all batches if available
    const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
    // Use batch total if available, otherwise fallback to product quantity/stock
    return totalBatchStock || Number(product.quantity ?? product.stock ?? 0) || 0;
  };
  const getProductCostPrice = (product) => Number(product.costPrice ?? product.unitPrice ?? product.price ?? 0) || 0;
  const getProductSellingPrice = (product) => Number(product.sellingPrice ?? product.sellingUnitPrice ?? product.price ?? product.costPrice ?? product.unitPrice ?? 0) || 0;

  const getProductInventoryValue = (product) => {
    // For products with batches, calculate value as sum of (batch.quantity * batch.sellingUnitPrice)
    if (product.batches && product.batches.length > 0) {
      return product.batches.reduce((sum, batch) => {
        const batchPrice = Number(batch.sellingUnitPrice ?? batch.sellingPrice ?? product.sellingPrice ?? product.sellingUnitPrice ?? 0) || 0;
        const batchQuantity = Number(batch.quantity ?? 0) || 0;
        return sum + (batchQuantity * batchPrice);
      }, 0);
    }

    // For products without batches, use the standard calculation
    const quantity = getProductQuantity(product);
    const price = getProductSellingPrice(product);
    return quantity * price;
  };

  const filteredProducts = state.products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.barcode?.includes(searchTerm);

    const matchesCategory = !filterCategory || product.category === filterCategory;

    const productQuantity = getProductQuantity(product);
    const matchesStatus = !filterStatus || (
      filterStatus === 'low-stock' && productQuantity <= state.lowStockThreshold ||
      filterStatus === 'out-of-stock' && productQuantity === 0 ||
      filterStatus === 'expiring' && product.expiryDate && new Date(product.expiryDate) <= new Date(Date.now() + state.expiryDaysThreshold * 24 * 60 * 60 * 1000)
    );

    return matchesSearch && matchesCategory && matchesStatus;
  }).sort((a, b) => {
    let aValue = a[sortBy];
    let bValue = b[sortBy];

    if (sortBy === 'stock' || sortBy === 'quantity') {
      aValue = getProductQuantity(a);
      bValue = getProductQuantity(b);
    }

    if (sortBy === 'price') {
      aValue = getProductSellingPrice(a);
      bValue = getProductSellingPrice(b);
    }

    if (sortOrder === 'asc') {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  // Pagination
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + itemsPerPage);

  // Reset to page 1 when filters change or itemsPerPage changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterCategory, filterStatus, sortBy, sortOrder, itemsPerPage]);

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      // Show all pages if total pages is less than max visible
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show pages with ellipsis
      if (currentPage <= 3) {
        // Show first pages
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        // Show last pages
        pages.push(1);
        pages.push('ellipsis');
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Show middle pages
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

  // Calculate inventory metrics
  const totalProducts = state.products.length;
  const lowStockProducts = state.products.filter(p => getProductQuantity(p) <= state.lowStockThreshold && getProductQuantity(p) > 0).length;
  const outOfStockProducts = state.products.filter(p => getProductQuantity(p) === 0).length;
  const expiringProducts = state.products.filter(p => {
    if (!p.expiryDate) return false;
    return new Date(p.expiryDate) <= new Date(Date.now() + state.expiryDaysThreshold * 24 * 60 * 60 * 1000);
  }).length;
  const totalValue = state.products.reduce((sum, p) => sum + getProductInventoryValue(p), 0);

  // Get unique categories
  const categories = [...new Set(state.products.map(p => p.category).filter(Boolean))];

  const getStockStatus = (stock) => {
    if (stock === 0) return { label: 'Out of Stock', color: 'bg-red-100 text-red-800' };
    if (stock <= state.lowStockThreshold) return { label: 'Low Stock', color: 'bg-yellow-100 text-yellow-800' };
    return { label: 'In Stock', color: 'bg-green-100 text-green-800' };
  };

  const downloadFile = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportInventoryCSV = (withBatches = false) => {
    try {
      const headers = withBatches
        ? ['Name', 'Category', 'Quantity', 'Cost Price', 'Selling Price', 'Inventory Value', 'Barcode', 'Expiry']
        : ['Name', 'Category', 'Quantity', 'Cost Price', 'Selling Price', 'Inventory Value', 'Status', 'Barcode'];

      const escapeValue = (value) => {
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        if (stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        if (stringValue.includes(',') || stringValue.includes('\n')) {
          return `"${stringValue}"`;
        }
        return stringValue;
      };

      let rows = [];

      if (withBatches) {
        filteredProducts.forEach((product) => {
          if (product.batches && product.batches.length > 0) {
            product.batches.forEach(batch => {
              const quantity = batch.quantity || 0;
              const costPrice = batch.costPrice || product.costPrice || 0;
              const sellingPrice = batch.sellingUnitPrice || product.sellingPrice || product.price || costPrice;
              const value = quantity * Math.max(sellingPrice, costPrice);
              const unit = product.quantityUnit || product.unit || '';
              rows.push([
                escapeValue(product.name || ''),
                escapeValue(product.category || ''),
                escapeValue(`${quantity}${unit}`),
                escapeValue(costPrice.toFixed(2)),
                escapeValue(sellingPrice.toFixed(2)),
                escapeValue(value.toFixed(2)),
                escapeValue(product.barcode || ''),
                escapeValue(formatDate(batch.expiry))
              ]);
            });
          } else {
            const quantity = getProductQuantity(product);
            const costPrice = getProductCostPrice(product);
            const sellingPrice = getProductSellingPrice(product) || costPrice;
            const value = quantity * Math.max(sellingPrice, costPrice);
            const unit = product.quantityUnit || product.unit || '';
            rows.push([
              escapeValue(product.name || ''),
              escapeValue(product.category || ''),
              escapeValue(`${quantity}${unit}`),
              escapeValue(costPrice.toFixed(2)),
              escapeValue(sellingPrice.toFixed(2)),
              escapeValue(value.toFixed(2)),
              escapeValue(product.barcode || ''),
              escapeValue(formatDate(product.expiryDate))
            ]);
          }
        });
      } else {
        rows = filteredProducts.map((product) => {
          const quantity = getProductQuantity(product);
          const costPrice = getProductCostPrice(product);
          const sellingPrice = getProductSellingPrice(product) || costPrice;
          const value = quantity * Math.max(sellingPrice, costPrice);
          const status = getStockStatus(quantity).label;
          const unit = product.quantityUnit || product.unit || '';
          return [
            escapeValue(product.name || ''),
            escapeValue(product.category || ''),
            escapeValue(`${quantity}${unit}`),
            escapeValue(costPrice.toFixed(2)),
            escapeValue(sellingPrice.toFixed(2)),
            escapeValue(value.toFixed(2)),
            escapeValue(status),
            escapeValue(product.barcode || '')
          ];
        });
      }

      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      downloadFile(
        `inventory-${withBatches ? 'detailed-' : ''}${new Date().toISOString().split('T')[0]}.csv`,
        csvContent,
        'text/csv;charset=utf-8;'
      );
      if (window.showToast) {
        window.showToast(`Inventory exported as CSV (${withBatches ? 'Detailed' : 'Summary'}).`, 'success');
      }
    } catch (error) {
      console.error('CSV Export Error:', error);
      if (window.showToast) {
        window.showToast('Error exporting CSV. Please try again.', 'error');
      }
    }
  };

  const exportInventoryJSON = (withBatches = false) => {
    try {
      let data = [];

      if (withBatches) {
        filteredProducts.forEach((product) => {
          if (product.batches && product.batches.length > 0) {
            product.batches.forEach(batch => {
              const quantity = batch.quantity || 0;
              const costPrice = batch.costPrice || product.costPrice || 0;
              const sellingPrice = batch.sellingUnitPrice || product.sellingPrice || product.price || costPrice;
              const unit = product.quantityUnit || product.unit || '';
              data.push({
                id: product.id,
                name: product.name,
                category: product.category || '',
                quantity: `${quantity}${unit}`,
                costPrice,
                sellingPrice,
                inventoryValue: quantity * Math.max(sellingPrice, costPrice),
                barcode: product.barcode || '',
                expiry: batch.expiry || ''
              });
            });
          } else {
            const quantity = getProductQuantity(product);
            const costPrice = getProductCostPrice(product);
            const sellingPrice = getProductSellingPrice(product) || costPrice;
            const unit = product.quantityUnit || product.unit || '';
            data.push({
              id: product.id,
              name: product.name,
              category: product.category || '',
              quantity: `${quantity}${unit}`,
              costPrice,
              sellingPrice,
              inventoryValue: quantity * Math.max(sellingPrice, costPrice),
              barcode: product.barcode || '',
              expiry: product.expiryDate || ''
            });
          }
        });
      } else {
        data = filteredProducts.map((product) => {
          const quantity = getProductQuantity(product);
          const costPrice = getProductCostPrice(product);
          const sellingPrice = getProductSellingPrice(product) || costPrice;
          const unit = product.quantityUnit || product.unit || '';
          return {
            id: product.id,
            name: product.name,
            category: product.category || '',
            quantity: `${quantity}${unit}`,
            costPrice,
            sellingPrice,
            inventoryValue: getProductInventoryValue(product),
            status: getStockStatus(quantity).label,
            barcode: product.barcode || ''
          };
        });
      }

      downloadFile(
        `inventory-${withBatches ? 'detailed-' : ''}${new Date().toISOString().split('T')[0]}.json`,
        JSON.stringify(data, null, 2),
        'application/json'
      );
      if (window.showToast) {
        window.showToast(`Inventory exported as JSON (${withBatches ? 'Detailed' : 'Summary'}).`, 'success');
      }
    } catch (error) {
      console.error('JSON Export Error:', error);
      if (window.showToast) {
        window.showToast('Error exporting JSON. Please try again.', 'error');
      }
    }
  };

  const exportInventoryPDF = async (withBatches = false) => {
    try {
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      /* ================= CONFIG ================= */
      const margin = 15;
      const COLORS = {
        primary: [47, 60, 126],
        gray: [120, 120, 120],
        lightBg: [248, 249, 253],
        border: [230, 230, 230],
        black: [0, 0, 0],
        white: [255, 255, 255]
      };
      const formatCurrency = (v) => `Rs. ${(Number(v) || 0).toFixed(2)}`;

      /* ================= HEADER ================= */
      const headerHeight = 28;

      // White header
      pdf.setFillColor(...COLORS.white);
      pdf.rect(0, 0, pageWidth, headerHeight, 'F');

      // Bottom accent line
      pdf.setDrawColor(...COLORS.primary);
      pdf.setLineWidth(1.5);
      pdf.line(0, headerHeight - 1, pageWidth, headerHeight - 1);

      /* -------- LOGO -------- */
      const logoX = margin;
      const logoY = 6;
      const logoMax = 16;

      try {
        const publicUrl = process.env.PUBLIC_URL || '';
        const logoUrl = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;

        const res = await fetch(logoUrl);
        if (res.ok) {
          const blob = await res.blob();
          const base64 = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });

          const img = new Image();
          img.src = base64;
          await new Promise(resolve => (img.onload = resolve));

          let w = logoMax;
          let h = logoMax;
          const ratio = img.width / img.height;

          if (ratio > 1) h = w / ratio;
          else w = h * ratio;

          pdf.addImage(base64, 'PNG', logoX, logoY, w, h);
        }
      } catch (e) { }

      /* -------- APP NAME -------- */
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.setTextColor(...COLORS.primary);
      pdf.text('Drag & Drop', logoX + 22, 15);

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...COLORS.gray);
      pdf.text('Inventory Management', logoX + 22, 19);

      /* -------- RIGHT META -------- */
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(...COLORS.black);
      pdf.text(`Inventory Report (${withBatches ? 'Detailed' : 'Summary'})`, pageWidth - margin, 14, { align: 'right' });

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...COLORS.gray);
      pdf.text(
        formatDate(new Date()),
        pageWidth - margin,
        19,
        { align: 'right' }
      );

      /* ================= SUMMARY CARDS ================= */
      const startY = headerHeight + 10;
      const cardW = (pageWidth - margin * 2 - 8) / 3;
      const cardH = 22; // Slightly taller for better spacing

      const totalInventoryValue = filteredProducts.reduce((sum, product) => sum + getProductInventoryValue(product), 0);
      const lowStockItems = filteredProducts.filter(product => {
        const quantity = getProductQuantity(product);
        return quantity > 0 && quantity <= (state.lowStockThreshold || 10);
      }).length;

      const metrics = [
        { label: 'Total Value', value: formatCurrency(totalInventoryValue) },
        { label: 'Total Products', value: filteredProducts.length.toString() },
        { label: 'Low Stock Items', value: lowStockItems.toString() }
      ];

      metrics.forEach((m, i) => {
        const x = margin + i * (cardW + 4);

        // Card shadow
        pdf.setFillColor(235, 236, 240);
        pdf.rect(x + 1, startY + 1, cardW, cardH, 'F');

        // Card body
        pdf.setFillColor(...COLORS.white);
        pdf.rect(x, startY, cardW, cardH, 'F');

        pdf.setFontSize(9);
        pdf.setTextColor(...COLORS.gray);
        pdf.text(m.label.toUpperCase(), x + 4, startY + 7);

        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...COLORS.primary);
        pdf.text(m.value, x + 4, startY + 16);
      });

      /* ================= TABLE TITLE ================= */
      let y = startY + cardH + 14;

      pdf.setDrawColor(...COLORS.border);
      pdf.line(margin, y, pageWidth - margin, y);

      y += 8;
      pdf.setFontSize(15);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(...COLORS.primary);
      pdf.text(`Inventory Details - ${withBatches ? 'Detailed Batch List' : 'Product Summary'}`, margin, y);

      /* ================= TABLE ================= */
      const headers = withBatches
        ? ['Product Name', 'Category', 'Quantity', 'Cost', 'Price', 'Expiry', 'Total Value']
        : ['Product Name', 'Category', 'Quantity', 'Total Value'];

      const colW = withBatches
        ? [55, 30, 35, 30, 30, 35, 35] // Detailed
        : [80, 60, 60, 55]; // Summary

      const tableWidth = colW.reduce((a, b) => a + b, 0);

      y += 6;

      // Header row
      pdf.setFillColor(...COLORS.lightBg);
      pdf.rect(margin, y, tableWidth, 9, 'F');

      pdf.setFontSize(11);
      pdf.setTextColor(...COLORS.primary);

      headers.forEach((h, i) => {
        const x = margin + colW.slice(0, i).reduce((a, b) => a + b, 0);
        pdf.text(h, x + colW[i] / 2, y + 6, { align: 'center' });
      });

      y += 9;
      pdf.setFontSize(10);
      pdf.setTextColor(...COLORS.black);

      // Prepare items for display
      let itemsToRender = [];
      if (withBatches) {
        filteredProducts.forEach(product => {
          if (product.batches && product.batches.length > 0) {
            product.batches.forEach(batch => {
              const quantity = batch.quantity || 0;
              const costPrice = batch.costPrice || product.costPrice || 0;
              const sellingPrice = batch.sellingUnitPrice || product.sellingPrice || product.price || costPrice;
              const value = quantity * Math.max(sellingPrice, costPrice);

              const unit = product.quantityUnit || product.unit || '';
              itemsToRender.push({
                name: product.name.length > 30 ? product.name.substring(0, 27) + '...' : product.name,
                category: product.category || 'Uncategorized',
                quantity: `${quantity}${unit}`,
                cost: formatCurrency(costPrice),
                price: formatCurrency(sellingPrice),
                expiry: batch.expiry ? formatDate(batch.expiry) : '-',
                value: formatCurrency(value)
              });
            });
          } else {
            const quantity = getProductQuantity(product);
            const inventoryValue = getProductInventoryValue(product);
            const costPrice = getProductCostPrice(product);
            const sellingPrice = getProductSellingPrice(product) || costPrice;
            const unit = product.quantityUnit || product.unit || '';
            itemsToRender.push({
              name: product.name.length > 30 ? product.name.substring(0, 27) + '...' : product.name,
              category: product.category || 'Uncategorized',
              quantity: `${quantity}${unit}`,
              cost: formatCurrency(costPrice),
              price: formatCurrency(sellingPrice),
              expiry: product.expiryDate ? formatDate(product.expiryDate) : '-',
              value: formatCurrency(inventoryValue)
            });
          }
        });
      } else {
        itemsToRender = filteredProducts.map(product => {
          const quantity = getProductQuantity(product);
          const unit = product.quantityUnit || product.unit || '';
          return {
            name: product.name.length > 35 ? product.name.substring(0, 32) + '...' : product.name,
            category: product.category || 'Uncategorized',
            quantity: `${quantity}${unit}`,
            value: formatCurrency(getProductInventoryValue(product))
          };
        });
      }

      itemsToRender.forEach((item, index) => {
        const rowH = 8;
        if (y + rowH > pageHeight - 20) {
          pdf.addPage();
          y = 20;

          // Redraw headers on new page
          pdf.setFillColor(...COLORS.lightBg);
          pdf.rect(margin, y, tableWidth, 9, 'F');
          pdf.setFontSize(11);
          pdf.setTextColor(...COLORS.primary);
          headers.forEach((h, j) => {
            const x = margin + colW.slice(0, j).reduce((a, b) => a + b, 0);
            pdf.text(h, x + colW[j] / 2, y + 6, { align: 'center' });
          });
          y += 9;
          pdf.setFontSize(10);
          pdf.setTextColor(...COLORS.black);
        }

        if (index % 2 === 1) {
          pdf.setFillColor(...COLORS.lightBg);
          pdf.rect(margin, y, tableWidth, rowH, 'F');
        }

        const rowValues = Object.values(item);
        rowValues.forEach((val, j) => {
          const x = margin + colW.slice(0, j).reduce((a, b) => a + b, 0);
          pdf.text(String(val), x + colW[j] / 2, y + 5.5, { align: 'center' });
        });

        y += rowH;
      });


      /* ================= FOOTER ================= */
      const pageCount = pdf.internal.getNumberOfPages();

      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(...COLORS.gray);
        pdf.text(`Page ${i} of ${pageCount}`, margin, pageHeight - 10);
        pdf.text(
          state.currentUser?.shopName || 'Store',
          pageWidth - margin,
          pageHeight - 10,
          { align: 'right' }
        );
      }

      pdf.save(`inventory-${new Date().toISOString().split('T')[0]}.pdf`);
      if (window.showToast) {
        window.showToast('Inventory exported as PDF.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  };

  const handleEditClick = (product) => {
    dispatch({ type: 'SET_CURRENT_PRODUCT', payload: product });
    goToView('products');
  };

  const handleDeleteProduct = (productId, productName) => {
    setDeleteConfirm({ show: true, productId, productName: productName || 'this product' });
  };

  const confirmDeleteProduct = () => {
    if (deleteConfirm.productId) {
      dispatch({ type: 'DELETE_PRODUCT', payload: deleteConfirm.productId });
      if (window.showToast) {
        window.showToast(`"${deleteConfirm.productName}" has been deleted successfully`, 'success', 4000);
      }
      setDeleteConfirm({ show: false, productId: null, productName: null });
    }
  };

  const ExportOptionsModal = () => {
    if (!showExportOptions) return null;

    const handleSelectOption = (withBatches) => {
      setShowExportOptions(false);
      if (pendingExportType === 'csv') exportInventoryCSV(withBatches);
      else if (pendingExportType === 'json') exportInventoryJSON(withBatches);
      else if (pendingExportType === 'pdf') exportInventoryPDF(withBatches);
    };

    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4" onClick={() => setShowExportOptions(false)}>
        <div
          className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-slate-800"
          onClick={e => e.stopPropagation()}
        >
          <div className="p-6 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">Export Options</h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">Choose how you want to export your data</p>
              </div>
            </div>
            <button
              onClick={() => setShowExportOptions(false)}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            <button
              onClick={() => handleSelectOption(false)}
              className="w-full group p-4 rounded-2xl border-2 border-transparent hover:border-blue-500 bg-gray-50 dark:bg-slate-800/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-left"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-white dark:bg-slate-800 shadow-sm group-hover:bg-blue-500 group-hover:text-white transition-colors">
                  <Layout className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 dark:text-white">Summary Export</h4>
                  <p className="text-sm text-gray-500 dark:text-slate-400">One row per product with consolidated stock. Best for general reports.</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => handleSelectOption(true)}
              className="w-full group p-4 rounded-2xl border-2 border-transparent hover:border-purple-500 bg-gray-50 dark:bg-slate-800/50 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all text-left"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-white dark:bg-slate-800 shadow-sm group-hover:bg-purple-500 group-hover:text-white transition-colors">
                  <Layers className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 dark:text-white">Detailed Export</h4>
                  <p className="text-sm text-gray-500 dark:text-slate-400">One row per batch (Batch No, Mfg, Expiry). Best for inventory tracking.</p>
                </div>
              </div>
            </button>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-800 flex justify-end">
            <button
              onClick={() => setShowExportOptions(false)}
              className="px-6 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };


  return (
    <div className="fade-in-up max-w-6xl mx-auto space-y-8 pb-10">
      <ExportOptionsModal />
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Inventory Dashboard</h2>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">Monitor and manage your product inventory</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => goToView('products')}
            className="btn-primary flex items-center text-sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Product
          </button>
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(prev => !prev)}
              className="btn-secondary flex items-center text-sm"
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </button>
            {showExportMenu && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowExportMenu(false)}>
                <div
                  className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-slate-700"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Export Inventory</h3>
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
                        setPendingExportType('csv');
                        setShowExportOptions(true);
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-green-50 text-green-600 group-hover:bg-green-100 dark:bg-green-500/10 dark:text-green-500 dark:group-hover:bg-green-500/20 transition-colors">
                        <FileSpreadsheet className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">Export as CSV</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">Spreadsheet format (Excel)</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setPendingExportType('json');
                        setShowExportOptions(true);
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-500 dark:group-hover:bg-blue-500/20 transition-colors">
                        <FileJson className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">Export as JSON</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">Raw data format for backup</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setPendingExportType('pdf');
                        setShowExportOptions(true);
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-red-50 text-red-600 group-hover:bg-red-100 dark:bg-red-500/10 dark:text-red-500 dark:group-hover:bg-red-500/20 transition-colors">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">Export as PDF</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">Printable document format</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inventory Metrics */}
      < div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" >
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 dark:text-slate-400 mb-2">Total Products</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white leading-none">{totalProducts}</p>
            </div>
            <div className="flex-shrink-0 ml-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                <Package className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 dark:text-slate-400 mb-2">Low Stock</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white leading-none">{lowStockProducts}</p>
            </div>
            <div className="flex-shrink-0 ml-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-yellow-50 dark:bg-yellow-900/30 rounded-full flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-600 dark:text-yellow-400" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 dark:text-slate-400 mb-2">Out of Stock</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white leading-none">{outOfStockProducts}</p>
            </div>
            <div className="flex-shrink-0 ml-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-50 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <Minus className="h-5 w-5 sm:h-6 sm:w-6 text-red-600 dark:text-red-400" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 dark:text-slate-400 mb-2">Inventory Value</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white leading-none">₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="flex-shrink-0 ml-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-50 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
          </div>
        </div>
      </div >

      {/* Filters and Search */}
      < div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-5 space-y-4" >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field dark:bg-slate-700 dark:border-slate-600 dark:text-white dark:placeholder:text-slate-400"
            />
          </div>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="input-field dark:bg-slate-700 dark:border-slate-600 dark:text-white"
          >
            <option value="">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="input-field dark:bg-slate-700 dark:border-slate-600 dark:text-white"
          >
            <option value="">All Status</option>
            <option value="low-stock">Low Stock</option>
            <option value="out-of-stock">Out of Stock</option>
            <option value="expiring">Expiring Soon</option>
          </select>

          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-');
              setSortBy(field);
              setSortOrder(order);
            }}
            className="input-field dark:bg-slate-700 dark:border-slate-600 dark:text-white"
          >
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="stock-asc">Stock Low-High</option>
            <option value="stock-desc">Stock High-Low</option>
            <option value="price-asc">Price Low-High</option>
            <option value="price-desc">Price High-Low</option>
          </select>
        </div>
      </div >

      {/* Inventory Table - Desktop View */}
      < div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden hidden lg:block" >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-700/50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-center">Category</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
              {paginatedProducts.map((product) => {
                const quantity = getProductQuantity(product);
                const productStatus = getStockStatus(quantity);
                const price = getProductSellingPrice(product);
                const inventoryValue = getProductInventoryValue(product);

                return (
                  <tr key={product.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-4" style={{ maxWidth: '300px' }}>
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30 flex-shrink-0">
                          <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p
                            className="font-semibold text-slate-900 dark:text-white break-words line-clamp-2 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                            title={product.name}
                            onClick={() => handleBatchDetailsClick(product)}
                          >
                            {product.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 break-words line-clamp-1" title={product.barcode || 'No barcode'}>{product.barcode || 'No barcode'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className="inline-flex max-w-[160px] items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300 truncate" title={(product.category && product.category !== 'undefined') ? product.category : '-'}>
                        {(product.category && product.category !== 'undefined') ? product.category : '-'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <div className="relative group">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full cursor-help ${quantity <= state.lowStockThreshold
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                            : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                            }`}>
                            {quantity} {product.quantityUnit || product.unit || 'pcs'}
                          </span>
                          {/* Tooltip with batch details */}
                          {(product.batches?.length > 0) && (
                            <div className="absolute z-10 invisible group-hover:visible bg-gray-900 dark:bg-black text-white text-xs rounded-lg py-2 px-3 mt-1 whitespace-nowrap shadow-lg right-0 border border-gray-700">
                              <div className="font-semibold mb-1">Batch Details:</div>
                              {product.batches.map((batch, index) => (
                                <div key={batch.id || index} className="flex justify-between gap-4">
                                  <span>{batch.batchNumber || `Batch ${index + 1}`}:</span>
                                  <span>{batch.quantity || 0} {product.quantityUnit || product.unit || 'pcs'}</span>
                                </div>
                              ))}
                              <div className="border-t border-gray-600 mt-1 pt-1 font-semibold">
                                Total: {product.batches.reduce((sum, batch) => sum + (batch.quantity || 0), 0)} {product.quantityUnit || product.unit || 'pcs'}
                              </div>
                            </div>
                          )}
                        </div>
                        {(product.batches?.length > 0) && (
                          <span className="text-xs text-gray-500 dark:text-slate-500">
                            {product.batches.length} batch{product.batches.length !== 1 ? 'es' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right text-slate-900 dark:text-slate-300">₹{price.toFixed(2)}</td>
                    <td className="px-4 py-4 text-right font-semibold text-emerald-600 dark:text-emerald-400">₹{inventoryValue.toFixed(2)}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${productStatus.color}`}>
                        {productStatus.label}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => handleEditClick(product)}
                          className="rounded-md p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-800 dark:hover:text-blue-300 transition"
                          title="Edit Product"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(product.id, product.name)}
                          className="rounded-md p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                          title="Delete Product"
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

        {/* Empty State */}
        {
          paginatedProducts.length === 0 && (
            <div className="text-center py-12">
              <Package className="h-16 w-16 mx-auto text-gray-300 dark:text-slate-600 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Products Found</h3>
              <p className="text-gray-600 dark:text-slate-400 mb-6">Try adjusting your search or filters</p>
              <button
                onClick={() => goToView('products')}
                className="btn-primary inline-flex items-center justify-center text-sm px-4 py-2 touch-manipulation"
              >
                Add First Product
              </button>
            </div>
          )
        }

        {/* Pagination - Desktop */}
        {
          totalPages > 1 && (
            <div className="hidden lg:flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 px-4 py-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
              <div className="text-sm text-gray-700 dark:text-slate-300">
                Showing <span className="font-semibold">{startIndex + 1}</span> to <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredProducts.length)}</span> of <span className="font-semibold">{filteredProducts.length}</span> {filteredProducts.length === 1 ? 'result' : 'results'}
              </div>
              <div className="flex items-center gap-1">
                {/* First Page Button */}
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="First page"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>

                {/* Previous Page Button */}
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                {/* Page Number Buttons */}
                <div className="flex items-center gap-1 mx-2">
                  {getPageNumbers().map((page, index) => {
                    if (page === 'ellipsis') {
                      return (
                        <span key={`ellipsis-${index}`} className="px-2 text-gray-500 dark:text-slate-500">
                          ...
                        </span>
                      );
                    }
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`min-w-[36px] px-3 py-2 text-sm font-medium rounded-lg transition-colors ${currentPage === page
                          ? 'bg-[#2f3c7e] text-white shadow-sm'
                          : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
                          }`}
                      >
                        {page}
                      </button>
                    );
                  })}
                </div>

                {/* Next Page Button */}
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>

                {/* Last Page Button */}
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Last page"
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )
        }
      </div>

      {/* Inventory Cards - Mobile View */}
      < div className="lg:hidden space-y-4" >
        {
          paginatedProducts.map((product) => {
            const quantity = getProductQuantity(product);
            const productStatus = getStockStatus(quantity);
            const price = getProductSellingPrice(product);
            const inventoryValue = getProductInventoryValue(product);

            return (
              <div key={product.id} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start space-x-3 flex-1 min-w-0">
                    {/* Product Icon */}
                    <div className="flex-shrink-0 h-12 w-12">
                      <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                        <Package className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                      </div>
                    </div>

                    {/* Product Info */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <h3
                        className="text-base font-semibold text-gray-900 dark:text-white truncate mb-1 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                        onClick={() => handleBatchDetailsClick(product)}
                      >
                        {product.name}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-slate-400 truncate mb-2">
                        {product.barcode || 'No barcode'}
                      </p>

                      {/* Status and Category Badges */}
                      <div className="flex flex-wrap gap-2 mb-2">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 truncate max-w-[120px]" title={(product.category && product.category !== 'undefined') ? product.category : '-'}>
                          {(product.category && product.category !== 'undefined') ? product.category : '-'}
                        </span>
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${productStatus === 'out-of-stock' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' :
                          productStatus === 'low-stock' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' :
                            'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          }`}>
                          {productStatus === 'out-of-stock' ? 'Out of Stock' :
                            productStatus === 'low-stock' ? 'Low Stock' : 'In Stock'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col space-y-2 ml-2">
                    <button
                      onClick={() => {
                        // Navigate to products page for editing
                        const productsPath = getPathForView('products');
                        navigate(productsPath);
                      }}
                      className="p-2 text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-lg transition-colors touch-manipulation"
                      title="Edit Product"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm({ show: true, productId: product.id, productName: product.name })}
                      className="p-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors touch-manipulation"
                      title="Delete Product"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Product Details */}
                <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-100 dark:border-slate-700">
                  <div className="text-center">
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Stock</p>
                    <div className="flex flex-col items-center gap-1">
                      <div className="relative group">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full cursor-help ${quantity <= state.lowStockThreshold
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                          : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          }`}>
                          {quantity} {product.quantityUnit || product.unit || 'pcs'}
                        </span>
                        {/* Tooltip with batch details */}
                        {(product.batches?.length > 0) && (
                          <div className="absolute z-10 invisible group-hover:visible bg-gray-900 text-white text-xs rounded-lg py-2 px-3 mt-1 whitespace-nowrap shadow-lg left-1/2 transform -translate-x-1/2">
                            <div className="font-semibold mb-1">Batch Details:</div>
                            {product.batches.map((batch, index) => (
                              <div key={batch.id || index} className="flex justify-between gap-4">
                                <span>{batch.batchNumber || `Batch ${index + 1}`}:</span>
                                <span>{batch.quantity || 0} {product.quantityUnit || product.unit || 'pcs'}</span>
                              </div>
                            ))}
                            <div className="border-t border-gray-600 mt-1 pt-1 font-semibold">
                              Total: {product.batches.reduce((sum, batch) => sum + (batch.quantity || 0), 0)} {product.quantityUnit || product.unit || 'pcs'}
                            </div>
                          </div>
                        )}
                      </div>
                      {(product.batches?.length > 0) && (
                        <span className="text-xs text-gray-500 dark:text-slate-400">
                          {product.batches.length} batch{product.batches.length !== 1 ? 'es' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Price</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">₹{price.toFixed(2)}</p>
                  </div>
                  <div className="text-center col-span-2">
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Total Value</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">₹{inventoryValue.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            );
          })
        }

        {/* Mobile Pagination */}
        {
          totalPages > 1 && (
            <div className="flex flex-col items-center justify-between gap-4 pt-4 px-4 py-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
              <div className="text-sm text-gray-700 dark:text-slate-300 text-center">
                Showing <span className="font-semibold">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-semibold">{Math.min(currentPage * itemsPerPage, filteredProducts.length)}</span> of <span className="font-semibold">{filteredProducts.length}</span> products
              </div>
              <div className="flex items-center gap-2 w-full justify-center">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <span className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                  Page {currentPage} of {totalPages}
                </span>

                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )
        }
      </div >

      {/* Professional Delete Confirmation Modal */}
      {
        deleteConfirm.show && (
          <div className="fixed inset-0 z-[1001] flex items-center justify-center p-4" style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)' }}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border dark:border-slate-700" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center mb-4">
                <div className="p-3 rounded-xl mr-4 bg-rose-100 dark:bg-rose-900/30">
                  <AlertTriangle className="h-6 w-6 text-rose-600 dark:text-rose-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">Delete Product?</h3>
                  <p className="text-sm mt-1 text-gray-500 dark:text-slate-400">
                    This action cannot be undone
                  </p>
                </div>
              </div>
              <div className="mb-6 p-4 rounded-xl bg-gray-50 dark:bg-slate-700/50">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  Are you sure you want to delete <span className="font-bold">"{deleteConfirm.productName}"</span>?
                </p>
                <p className="text-xs mt-2 text-gray-500 dark:text-slate-400">
                  This product will be permanently removed from your inventory. All associated data will be lost.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm({ show: false, productId: null, productName: null })}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteProduct}
                  className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, #BE123C, #991F3D)',
                    boxShadow: '0 4px 14px 0 rgba(190, 18, 60, 0.25)'
                  }}
                >
                  Delete Product
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Product Batch Details Modal */}
      {
        showBatchDetailsModal && selectedProduct && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {selectedProduct.name} - Batch Details
                </h3>
                <button
                  onClick={() => {
                    setShowBatchDetailsModal(false);
                    setSelectedProduct(null);
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6">
                {/* Product Summary */}
                <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-4 mb-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-gray-600 dark:text-slate-400">Total Stock</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {(() => {
                          const totalBatchStock = selectedProduct.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                          const displayStock = totalBatchStock || selectedProduct.quantity || selectedProduct.stock || 0;
                          return `${displayStock} ${selectedProduct.quantityUnit || selectedProduct.unit || 'pcs'}`;
                        })()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 dark:text-slate-400">Number of Batches</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {selectedProduct.batches?.length || 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 dark:text-slate-400">Average per Batch</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {(() => {
                          const totalBatches = selectedProduct.batches?.length || 0;
                          if (totalBatches === 0) return '0';
                          const totalStock = selectedProduct.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                          const avg = Math.round(totalStock / totalBatches);
                          return `${avg} ${selectedProduct.quantityUnit || selectedProduct.unit || 'pcs'}`;
                        })()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Batch Details Table */}
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Batch Inventory</h4>

                  {selectedProduct.batches && selectedProduct.batches.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                        <thead className="bg-gray-50 dark:bg-slate-700/50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              Batch Number
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              Quantity
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              Cost Price
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              Selling Price
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              Mfg Date
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              Expiry Date
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                          {selectedProduct.batches.map((batch, index) => {
                            const isEditing = editingBatchId === (batch.id || batch._id);

                            return (
                              <tr key={batch.id || index} className={isEditing ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-slate-700/50"}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={editingBatchData.batchNumber}
                                      onChange={(e) => handleBatchInputChange('batchNumber', e.target.value)}
                                      className="w-full px-2 py-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      placeholder="Batch number"
                                    />
                                  ) : (
                                    batch.batchNumber || `Batch ${index + 1}`
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={editingBatchData.quantity}
                                      onChange={(e) => {
                                        const value = e.target.value.replace(/[^0-9.]/g, '');
                                        handleBatchInputChange('quantity', value);
                                      }}
                                      className="w-full px-2 py-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      placeholder="0.00"
                                      required
                                    />
                                  ) : (
                                    `${batch.quantity || 0} ${selectedProduct.quantityUnit || selectedProduct.unit || 'pcs'}`
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={editingBatchData.costPrice}
                                      onChange={(e) => {
                                        const value = e.target.value.replace(/[^0-9.]/g, '');
                                        handleBatchInputChange('costPrice', value);
                                      }}
                                      className="w-full px-2 py-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      placeholder="0.00"
                                      required
                                    />
                                  ) : (
                                    `₹${batch.costPrice ? batch.costPrice.toFixed(2) : '0.00'}`
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={editingBatchData.sellingUnitPrice}
                                      onChange={(e) => {
                                        const value = e.target.value.replace(/[^0-9.]/g, '');
                                        handleBatchInputChange('sellingUnitPrice', value);
                                      }}
                                      className="w-full px-2 py-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      placeholder="0.00"
                                      required
                                    />
                                  ) : (
                                    `₹${batch.sellingUnitPrice ? batch.sellingUnitPrice.toFixed(2) : '0.00'}`
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                                  {isEditing ? (
                                    <input
                                      type="date"
                                      value={editingBatchData.mfg}
                                      onChange={(e) => handleBatchInputChange('mfg', e.target.value)}
                                      className="w-full px-2 py-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                  ) : (
                                    batch.mfg ? formatDate(batch.mfg) : 'N/A'
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                                  {isEditing ? (
                                    <input
                                      type="date"
                                      value={editingBatchData.expiry}
                                      onChange={(e) => handleBatchInputChange('expiry', e.target.value)}
                                      className="w-full px-2 py-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                  ) : (
                                    batch.expiry ? formatDate(batch.expiry) : 'N/A'
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                  {isEditing ? (
                                    <div className="flex gap-2">
                                      <button
                                        onClick={handleConfirmBatchEdit}
                                        className="text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/30 px-2 py-1 rounded transition-colors text-xs font-medium"
                                        title="Confirm Edit"
                                      >
                                        ✓ Confirm
                                      </button>
                                      <button
                                        onClick={() => handleEditBatch(batch)}
                                        className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 px-2 py-1 rounded transition-colors text-xs font-medium"
                                        title="Cancel Edit"
                                      >
                                        ✕ Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => handleEditBatch(batch)}
                                      className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 px-3 py-1 rounded-md transition-colors"
                                      title="Edit Batch"
                                    >
                                      <Edit className="h-4 w-4" />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <Package className="mx-auto h-12 w-12 text-gray-400 dark:text-slate-600" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No batches found</h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                        This product doesn't have any batches yet.
                      </p>
                      <div className="mt-6">
                        <button
                          onClick={() => {
                            dispatch({ type: 'SET_CURRENT_PRODUCT', payload: selectedProduct });
                            goToView('products');
                          }}
                          className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Go to Products to Add Batch
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* Bulk Add Products Modal */}
      <Suspense fallback={<ModalLoadingSpinner />}>
        {showBulkAddModal && (
          <BulkAddProductsModal
            onClose={() => setShowBulkAddModal(false)}
            onSave={handleBulkAddProducts}
          />
        )}
      </Suspense>
    </div>
  );
};

export default Inventory;

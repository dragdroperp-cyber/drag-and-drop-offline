import React, { useState, useRef, useEffect, useCallback, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes, triggerSyncStatusUpdate } from '../../context/AppContext';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import jsPDF from 'jspdf';

import {
  Plus,
  Edit,
  Trash2,
  Package,
  AlertTriangle,
  Clock,
  Download,
  Upload,
  FileText,
  FileSpreadsheet,
  FileJson,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Layers,
  Layout
} from 'lucide-react';
import { PageSkeleton, SkeletonTable } from '../UI/SkeletonLoader';
import { getPlanLimits, canAddProduct } from '../../utils/planUtils';
import { getSellerIdFromAuth, syncData, apiRequest } from '../../utils/api';
import { updateItem, updateMultipleItems, deleteItem, STORES } from '../../utils/indexedDB';
import { formatDate } from '../../utils/dateUtils';

// Lazy load heavy components
const AddProductModal = lazy(() => import('./AddProductModal'));
const EditProductModal = lazy(() => import('./EditProductModal'));
const BulkAddProductsModal = lazy(() => import('./BulkAddProductsModal'));

// Loading component for modals
const ModalLoadingSpinner = () => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
  </div>
);

// Page skeleton for products
const ProductsPageSkeleton = () => (
  <div className="space-y-6">
    {/* Header skeleton */}
    <div className="flex justify-between items-center">
      <div className="h-8 bg-gray-200 rounded w-1/3 animate-pulse"></div>
      <div className="h-10 bg-gray-200 rounded w-32 animate-pulse"></div>
    </div>

    {/* Search and filters skeleton */}
    <div className="flex space-x-4">
      <div className="flex-1 h-10 bg-gray-200 rounded animate-pulse"></div>
      <div className="w-32 h-10 bg-gray-200 rounded animate-pulse"></div>
      <div className="w-32 h-10 bg-gray-200 rounded animate-pulse"></div>
    </div>

    {/* Table skeleton */}
    <div className="bg-white rounded-lg shadow-sm border">
      <div className="p-6">
        <SkeletonTable rows={8} columns={6} />
      </div>
    </div>
  </div>
);

const Products = () => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  const [showBatchDetailsModal, setShowBatchDetailsModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [planLimitMessage, setPlanLimitMessage] = useState('');
  const [productPendingDelete, setProductPendingDelete] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importProgress, setImportProgress] = useState({ total: 0, processed: 0, success: 0, errors: [] });
  const [importLimitExceeded, setImportLimitExceeded] = useState(false);
  const [parsedProducts, setParsedProducts] = useState([]);
  const [limitExceededInfo, setLimitExceededInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(() => {
    // Avoid loading flicker if data is already in state
    return !(state.products && Array.isArray(state.products) && state.products.length > 0) && state.dataFreshness === 'loading';
  });

  const [showAddBatchModal, setShowAddBatchModal] = useState(false);
  const [editingBatchId, setEditingBatchId] = useState(null);
  const [editingBatchData, setEditingBatchData] = useState(null);
  const [batchSearchTerm, setBatchSearchTerm] = useState('');
  const [batchSearchResults, setBatchSearchResults] = useState([]);
  const [selectedProductForBatch, setSelectedProductForBatch] = useState(null);
  const [showCreateProductModal, setShowCreateProductModal] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [pendingExportType, setPendingExportType] = useState(null); // 'pdf', 'csv', 'json'

  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);
  const exportMenuRef = useRef(null);

  // Manage loading state
  useEffect(() => {
    // Set loading to false when products data is available
    if (state.products && Array.isArray(state.products)) {
      setIsLoading(false);
    } else {
      // Fallback timeout
      const timer = setTimeout(() => setIsLoading(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [state.products, state.auth?.sellerId]);
  const fileInputRef = useRef(null);

  // Scanner input detection refs
  const scannerInputBufferRef = useRef('');
  const scannerInputTimerRef = useRef(null);
  const lastKeyTimeRef = useRef(0);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [isProcessingScan, setIsProcessingScan] = useState(false);

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

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && typeof exportMenuRef.current.contains === 'function' && event.target && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut: Shift + N to open add product modal
  useKeyboardShortcut('n', false, true, () => {

    setShowAddModal(true);
  });

  // Keyboard shortcut: Shift + M to open bulk add products modal
  useKeyboardShortcut('m', false, true, () => {

    setShowBulkAddModal(true);
  });

  // Auto-open edit modal if currentProduct is set (e.g., from Inventory page)
  useEffect(() => {
    if (state.currentProduct) {
      setSelectedProduct(state.currentProduct);
      setShowEditModal(true);
      // Clear currentProduct after opening modal
      dispatch({ type: 'SET_CURRENT_PRODUCT', payload: null });
    }
  }, [state.currentProduct, dispatch]);

  // Plan limits
  const activeProducts = state.products.filter(product => !product.isDeleted);
  const { maxProducts } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
  const totalProducts = activeProducts.length;
  const atProductLimit = !canAddProduct(totalProducts, state.currentPlan, state.currentPlanDetails);
  const productLimitLabel = maxProducts === Infinity ? 'Unlimited' : maxProducts;

  const planNameLabel = state.currentPlanDetails?.planName
    || (state.currentPlan ? `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}` : 'Current');

  const showProductLimitWarning = () => {
    const limitMessage = `You've reached the product limit (${productLimitLabel}) for the ${planNameLabel} plan. Upgrade to keep adding products.`;
    setPlanLimitMessage(limitMessage);
    if (window.showToast) {
      window.showToast(limitMessage, 'warning', 5000);
    }
  };

  // Filter products
  const sellerId = getSellerIdFromAuth();
  const categoryOptions = Array.from(
    new Set(
      state.categories
        .filter(cat => !cat.sellerId || (sellerId && cat.sellerId === sellerId))
        .map(cat => (cat.name || '').trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort();

  const filteredProducts = activeProducts.filter(product => {
    const matchesSearch =
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.barcode?.includes(searchTerm);

    const matchesCategory =
      !selectedCategoryFilter ||
      (product.category || '').toLowerCase() === selectedCategoryFilter;

    return matchesSearch && matchesCategory;
  });

  const openAddProductModal = (barcode = '') => {
    if (atProductLimit) {
      showProductLimitWarning();
      return;
    }
    setPlanLimitMessage('');
    setScannedBarcode(barcode);
    setShowAddModal(true);
  };

  // Handle scanner input - open add or edit product modal with barcode
  const handleBarcodeScan = useCallback((barcode) => {
    if (!barcode || typeof barcode !== 'string') {
      return;
    }

    const trimmedBarcode = barcode.trim();

    // Validate barcode length and content
    if (trimmedBarcode.length < 3 || trimmedBarcode.length > 50) {

      return;
    }

    // Validate barcode contains only valid characters
    if (!/^[a-zA-Z0-9\-_.]+$/.test(trimmedBarcode)) {

      return;
    }

    setIsProcessingScan(true);

    // Show processing feedback
    if (window.showToast) {
      window.showToast('Processing barcode...', 'info', 1000);
    }

    // Get fresh products data and ensure it's an array
    const products = Array.isArray(state.products) ? state.products : [];

    // If products aren't loaded yet, wait a bit and try again
    // But also allow processing if data is still loading from IndexedDB
    const isDataStillLoading = state.dataFreshness === 'loading' || state.systemStatus === 'loaded_from_cache';
    if (products.length === 0 && !isDataStillLoading) {

      setTimeout(() => {
        const retryProducts = Array.isArray(state.products) ? state.products : [];

        const existingProduct = retryProducts.find(p => {
          if (!p || !p.barcode || p.isDeleted) return false;
          const productBarcode = p.barcode.trim();
          return productBarcode === trimmedBarcode;
        });

        if (existingProduct) {
          //('📝 Opening edit modal for existing product (retry)');
          if (window.showToast) {
            window.showToast(`Found existing product: ${existingProduct.name || 'Unnamed'}`, 'success', 2000);
          }
          handleEditClick(existingProduct);
        } else {
          //('➕ Opening add modal for new barcode (retry)');
          if (window.showToast) {
            window.showToast('New barcode detected - adding new product', 'info', 2000);
          }
          openAddProductModal(trimmedBarcode);
        }
        setIsProcessingScan(false);
      }, 1000); // Wait 1 second for products to load
      return;
    }

    // If products are still loading from IndexedDB, treat as new product for now
    if (products.length === 0 && isDataStillLoading) {

      //('➕ Opening add modal for new barcode (during loading)');
      if (window.showToast) {
        window.showToast('New barcode detected - adding new product', 'info', 2000);
      }
      openAddProductModal(trimmedBarcode);
      setIsProcessingScan(false);
      return;
    }

    // Check if barcode already exists
    const existingProduct = products.find(p => {
      if (!p || !p.barcode || p.isDeleted) return false;
      const productBarcode = p.barcode.trim();

      return productBarcode === trimmedBarcode;
    });

    if (existingProduct) {
      // Barcode exists - open edit modal with existing product

      if (window.showToast) {
        window.showToast(`Found existing product: ${existingProduct.name || 'Unnamed'}`, 'success', 2000);
      }
      handleEditClick(existingProduct);
    } else {
      // Barcode doesn't exist - open add product modal with barcode pre-filled

      if (window.showToast) {
        window.showToast('New barcode detected - adding new product', 'info', 2000);
      }
      openAddProductModal(trimmedBarcode);
    }

    setIsProcessingScan(false);
  }, [state.products]);

  // Auto-detect scanner input when products page is open
  useEffect(() => {
    const handleScannerInput = (e) => {
      // Don't process scanner input if any modal is open
      if (showEditModal || showAddModal || isProcessingScan) {
        return;
      }

      // Allow scanner input if products are loaded OR if we're still in the loading phase
      const productsLoaded = Array.isArray(state.products) && state.products.length > 0;
      const isDataLoading = state.dataFreshness === 'loading' || state.systemStatus === 'loaded_from_cache';

      // Allow processing during loading OR when products are available
      const shouldProcess = productsLoaded || isDataLoading;

      if (!shouldProcess) {

        return;
      }

      // Ignore if user is typing in an input field
      const target = e.target;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // If typing in input fields, ignore
      if (isInputField) {
        return;
      }

      // Check if it's a printable character (exclude special keys and control combinations)
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const now = Date.now();
        const timeSinceLastKey = now - lastKeyTimeRef.current;

        // If keys are coming very fast (< 50ms apart), it's likely a scanner
        // Or if this is the first character in a sequence
        if (timeSinceLastKey < 50 || scannerInputBufferRef.current.length === 0) {
          // Filter out non-alphanumeric characters that might come from scanners
          if (/^[a-zA-Z0-9\-_.]$/.test(e.key)) {
            scannerInputBufferRef.current += e.key;
            lastKeyTimeRef.current = now;

            // Clear existing timer
            if (scannerInputTimerRef.current) {
              clearTimeout(scannerInputTimerRef.current);
            }

            // Set timer to process scanner input after a delay
            scannerInputTimerRef.current = setTimeout(() => {
              const scannedCode = scannerInputBufferRef.current.trim();

              // Only process if we have a reasonable barcode length (3-50 characters)
              if (scannedCode.length >= 3 && scannedCode.length <= 50) {
                handleBarcodeScan(scannedCode);
              }
              // Clear buffer
              scannerInputBufferRef.current = '';
            }, 700); // Increased to 700ms for more reliability
          }
        } else {
          // Reset if typing is slow (manual typing) - more than 100ms gap
          if (scannerInputBufferRef.current.length > 0) {
            scannerInputBufferRef.current = '';
          }
        }
      } else if (e.key === 'Enter' && scannerInputBufferRef.current.length > 0) {
        // Enter key pressed with buffer - process scanner input immediately
        e.preventDefault();
        const scannedCode = scannerInputBufferRef.current.trim();

        // Clear any pending timeout
        if (scannerInputTimerRef.current) {
          clearTimeout(scannerInputTimerRef.current);
          scannerInputTimerRef.current = null;
        }

        // Only process if we have a reasonable barcode length (3-50 characters)
        if (scannedCode.length >= 3 && scannedCode.length <= 50) {
          handleBarcodeScan(scannedCode);
        }
        scannerInputBufferRef.current = '';
      }
    };

    // Add event listener
    window.addEventListener('keydown', handleScannerInput);

    return () => {
      window.removeEventListener('keydown', handleScannerInput);
      if (scannerInputTimerRef.current) {
        clearTimeout(scannerInputTimerRef.current);
      }
    };
  }, [atProductLimit, showEditModal]);

  // Pagination
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + itemsPerPage);

  // Reset to page 1 when filters change or itemsPerPage changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategoryFilter, itemsPerPage]);

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

  // Stats
  const lowStockProducts = state.products.filter(product =>
    (product.quantity || product.stock || 0) <= state.lowStockThreshold
  ).length;

  const expiringProducts = state.products.filter(product => {
    if (!product.expiryDate) return false;
    const expiryDate = new Date(product.expiryDate);
    const today = new Date();
    const diffTime = expiryDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= state.expiryDaysThreshold && diffDays >= 0;
  }).length;

  // CRUD handlers
  const handleAddProduct = (productData) => {
    if (atProductLimit) {
      showProductLimitWarning();
      return false;
    }

    // Get sellerId from auth (already retrieved on line 77)
    const productSellerId = sellerId || getSellerIdFromAuth();

    // Ensure product has both quantity and stock fields (backend uses 'stock', frontend may use 'quantity')
    const quantity = productData.quantity || productData.stock || 0;
    const stock = productData.stock !== undefined ? productData.stock : quantity;

    // Ensure all required MongoDB fields are present
    // MongoDB requires: name, stock, unit, costPrice, sellingUnitPrice, description
    // mfg and expiryDate are optional - only include if provided
    const description = productData.description || productData.name || ''; // Description is optional, default to name if missing
    const unit = productData.unit || productData.quantityUnit || 'pcs';
    const costPrice = productData.costPrice !== undefined ? productData.costPrice : (productData.unitPrice || 0);
    const sellingUnitPrice = productData.sellingUnitPrice !== undefined ? productData.sellingUnitPrice : (productData.sellingPrice || 0);

    // Build product object, excluding mfg/expiryDate initially
    const { mfg, mfgDate, expiryDate, ...productDataWithoutDates } = productData;

    // Resolve category name from ID if provided
    let categoryName = productData.category || '';
    if (productData.categoryId && (!categoryName || categoryName === productData.categoryId)) {
      const categoryObj = state.categories.find(c => c.id === productData.categoryId || c._id === productData.categoryId);
      if (categoryObj) {
        categoryName = categoryObj.name;
      }
    }

    const newProduct = {
      id: Date.now().toString(),
      ...productDataWithoutDates,
      sellerId: productSellerId, // Add sellerId for sync consistency
      quantity: quantity, // Frontend field
      stock: stock, // Backend field (MongoDB uses 'stock')
      unit: unit, // Required by MongoDB
      costPrice: costPrice, // Required by MongoDB
      unitPrice: costPrice, // Keep for backward compatibility
      sellingUnitPrice: sellingUnitPrice, // Required by MongoDB
      sellingPrice: sellingUnitPrice, // Keep for backward compatibility
      description: description, // Required by MongoDB
      categoryId: productData.categoryId, // Ensure categoryId is preserved
      category: categoryName, // Ensure category name is set for UI display
      createdAt: new Date().toISOString(),
      isSynced: false // Explicitly mark as unsynced
    };

    // Explicitly timestamp mfg/expiry if present
    if ((productData.mfg && productData.mfg.trim()) || (productData.mfgDate && productData.mfgDate.trim())) {
      const mfgValue = (productData.mfg && productData.mfg.trim()) || (productData.mfgDate && productData.mfgDate.trim());
      if (mfgValue) {
        newProduct.mfg = mfgValue;
        newProduct.mfgDate = mfgValue; // Keep for backward compatibility
      }
    }
    if (productData.expiryDate && productData.expiryDate.trim()) {
      newProduct.expiryDate = productData.expiryDate.trim();
    }
    dispatch({ type: 'ADD_PRODUCT', payload: newProduct });
    dispatch({
      type: 'ADD_ACTIVITY',
      payload: {
        id: Date.now().toString(),
        message: `Product "${newProduct.name}" added`,
        timestamp: new Date().toISOString(),
        type: 'product_added'
      }
    });

    // Trigger sync status update to refresh the percentage in header
    triggerSyncStatusUpdate();

    setShowAddModal(false);
    setPlanLimitMessage('');
    return true;
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
      setPlanLimitMessage(message);
      if (window.showToast) {
        window.showToast(message, 'error', 5000);
      }
      return false;
    }

    // Get sellerId from auth
    const productSellerId = sellerId || getSellerIdFromAuth();
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

        // Get quantity/stock values
        const quantity = productData.quantity || productData.stock || 0;
        const stock = productData.stock !== undefined ? productData.stock : quantity;

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
        dispatch({ type: 'ADD_PRODUCT', payload: newProduct });
      }

      if (addedProducts.length > 0) {
        // Add activity log
        dispatch({
          type: 'ADD_ACTIVITY',
          payload: {
            id: Date.now().toString(),
            message: `${addedProducts.length} products added in bulk`,
            timestamp: currentTime,
            type: 'bulk_product_added'
          }
        });

        // Trigger sync status update
        triggerSyncStatusUpdate();

        // Show success message
        if (window.showToast) {
          window.showToast(`${addedProducts.length} products added successfully!`, 'success');
        }

        // Close modal
        setShowBulkAddModal(false);
        setPlanLimitMessage('');
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

  const handleEditProduct = async (productData) => {

    try {
      // Ensure the product has required fields for IndexedDB
      const updatedProduct = {
        ...productData,
        updatedAt: new Date().toISOString(),
        isSynced: false // Mark as unsynced to trigger sync
      };

      // Update in IndexedDB first
      const updateResult = await updateItem(STORES.products, updatedProduct);

      // Verify the update by reading back from IndexedDB
      const { getAllItems } = await import('../../utils/indexedDB');
      const allProducts = await getAllItems(STORES.products);
      const updatedProductInDB = allProducts.find(p => p.id === updatedProduct.id);

      if (updatedProductInDB) {

      }

      // Update in Redux state

      dispatch({ type: 'UPDATE_PRODUCT', payload: updatedProduct });

      // Add product update to sync queue for background sync to MongoDB
      const { addToSyncQueue } = await import('../../utils/dataFetcher');
      await addToSyncQueue('product_update', {
        productId: updatedProduct.id || updatedProduct._id,
        productData: updatedProduct,
        timestamp: new Date().toISOString()
      });

      // Attempt background sync if online
      const { isOnline, backgroundSyncWithBackend } = await import('../../utils/dataFetcher');
      if (isOnline()) {
        backgroundSyncWithBackend(dispatch, {}).catch(syncError => {
          //('⚠️ Background sync failed, but product is saved locally');
        });
      }

      // Check state immediately after dispatch
      setTimeout(() => {
        const updatedProductInState = state.products.find(p => p.id === updatedProduct.id);

        if (updatedProductInState) {

        } else {

        }
      }, 10);

      dispatch({
        type: 'ADD_ACTIVITY',
        payload: {
          id: Date.now().toString(),
          message: `Product "${updatedProduct.name}" updated`,
          timestamp: new Date().toISOString(),
          type: 'product_updated'
        }
      });

      // Close modal
      setShowEditModal(false);
      setSelectedProduct(null);

      // Trigger sync status update to refresh the percentage in header
      triggerSyncStatusUpdate();

      // Force a re-render by updating local state
      setTimeout(() => {
        //('🔄 Checking state after update:', state.products.find(p => p.id === updatedProduct.id));
      }, 100);

    } catch (error) {

      if (window.showToast) {
        window.showToast('Failed to update product. Please try again.', 'error');
      }
    }
  };

  // Batch management functions

  const handleAddBatch = () => {
    setShowAddBatchModal(true);
    setBatchSearchTerm('');
    setBatchSearchResults([]);
    setSelectedProductForBatch(null);
    setShowCreateProductModal(false);
  };

  const handleAddBatchForProduct = (product) => {
    setSelectedProductForBatch(product);
    setBatchSearchTerm(product.name);
    setBatchSearchResults([]);
    setShowCreateProductModal(false);
    setShowAddBatchModal(true);
  };

  const handleBatchSearch = async (searchTerm) => {
    if (!searchTerm.trim()) {
      setBatchSearchResults([]);
      return;
    }

    // Search through existing products
    const filteredProducts = state.products.filter(product =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.barcode && product.barcode.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    setBatchSearchResults(filteredProducts);
  };

  const handleSelectProductForBatch = (product) => {
    setSelectedProductForBatch(product);
    setBatchSearchTerm(product.name);
    setBatchSearchResults([]);
  };

  const handleCreateNewProductForBatch = () => {
    setShowCreateProductModal(true);
  };

  const handleBatchSubmit = async () => {
    if (isSubmittingBatch) return;

    try {
      if (!selectedProductForBatch) {
        if (window.showToast) {
          window.showToast('Please select a product first', 'error');
        }
        return;
      }

      // Get form values from the modal
      const modal = document.querySelector('[data-batch-modal]');
      if (!modal) {

        if (window.showToast) {
          window.showToast('Form not found', 'error');
        }
        return;
      }

      const batchNumberInput = modal.querySelector('input[placeholder="Optional batch number"]');
      const quantityInput = modal.querySelector('input[placeholder="Enter quantity"]');
      const costPriceInput = modal.querySelector('input[placeholder="Enter cost price"]');
      const sellingPriceInput = modal.querySelector('input[placeholder="Enter selling price"]');

      if (!quantityInput || !costPriceInput || !sellingPriceInput) {
        if (window.showToast) {
          window.showToast('Form inputs not found. Please try again.', 'error');
        }
        return;
      }

      // Get date inputs - they may not exist if product doesn't track expiry
      const dateInputs = modal.querySelectorAll('input[type="date"]');
      const mfgInput = selectedProductForBatch.trackExpiry ? dateInputs[0] : null;
      const expiryInput = selectedProductForBatch.trackExpiry ? dateInputs[1] : null;

      // Check required date inputs only if product tracks expiry
      if (selectedProductForBatch.trackExpiry && (!mfgInput || !expiryInput)) {
        if (window.showToast) {
          window.showToast('Form inputs not found. Please try again.', 'error');
        }
        return;
      }

      // Set submitting state
      setIsSubmittingBatch(true);

      const batchNumber = batchNumberInput ? batchNumberInput.value.trim() : `Batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const quantity = quantityInput.value;
      const mfg = mfgInput ? mfgInput.value : '';
      const expiry = expiryInput ? expiryInput.value : '';
      const costPrice = costPriceInput.value;
      const sellingUnitPrice = sellingPriceInput.value;

      // Validation
      // Check required fields based on trackExpiry setting
      const requiredFieldsMissing = [];
      if (!quantity) requiredFieldsMissing.push('quantity');
      if (!costPrice) requiredFieldsMissing.push('cost price');
      if (!sellingUnitPrice) requiredFieldsMissing.push('selling price');

      // Only require mfg and expiry if product tracks expiry
      if (selectedProductForBatch.trackExpiry) {
        if (!mfg || mfg.trim() === '') requiredFieldsMissing.push('manufacturing date');
        if (!expiry || expiry.trim() === '') requiredFieldsMissing.push('expiry date');
      }

      if (requiredFieldsMissing.length > 0) {
        if (window.showToast) {
          window.showToast(`Please fill in all required fields: ${requiredFieldsMissing.join(', ')}`, 'error');
        }
        return;
      }

      if (parseInt(quantity) <= 0 || parseFloat(costPrice) < 0 || parseFloat(sellingUnitPrice) < 0) {
        if (window.showToast) {
          window.showToast('Please enter valid positive values', 'error');
        }
        return;
      }

      // Additional validation for dates - only if product tracks expiry and dates are provided
      if (selectedProductForBatch.trackExpiry && mfg && expiry && mfg.trim() !== '' && expiry.trim() !== '') {
        const mfgDate = new Date(mfg);
        const expiryDate = new Date(expiry);
        if (expiryDate <= mfgDate) {
          if (window.showToast) {
            window.showToast('Expiry date must be after manufacturing date', 'error');
          }
          return;
        }
      }

      // Ensure productId is a string (MongoDB ObjectId string)
      const productId = typeof selectedProductForBatch._id === 'string'
        ? selectedProductForBatch._id
        : selectedProductForBatch.id;

      // STEP 1: Create batch object for offline-first storage
      const newBatch = {
        id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        _id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        productId: productId,
        batchNumber: batchNumber || '',
        quantity: parseInt(quantity),
        costPrice: parseFloat(costPrice),
        sellingUnitPrice: parseFloat(sellingUnitPrice),
        // Only include mfg and expiry if product tracks expiry
        ...(selectedProductForBatch.trackExpiry && mfg && { mfg }),
        ...(selectedProductForBatch.trackExpiry && expiry && { expiry }),
        sellerId: state.auth?.sellerId,
        createdAt: new Date().toISOString(),
        isSynced: false,
        lastModified: new Date().toISOString()
      };

      // STEP 2: Save batch to IndexedDB (offline-first)
      const { addItem, updateItem, STORES } = await import('../../utils/indexedDB');
      const savedBatchId = await addItem(STORES.productBatches, newBatch);

      // If addItem returned an existing ID (duplicate found), skip updating product stock
      if (savedBatchId !== newBatch.id && savedBatchId !== newBatch._id) {
        if (window.showToast) {
          window.showToast('Batch with this batch number already exists', 'error');
        }
        return;
      }

      // STEP 3: Update product with new batch - merge with existing batches
      const existingBatches = selectedProductForBatch.batches || [];
      const updatedBatches = [...existingBatches, newBatch];

      const updatedProduct = {
        ...selectedProductForBatch,
        batches: updatedBatches,
        // Update total quantity
        quantity: (selectedProductForBatch.quantity || 0) + parseInt(quantity),
        stock: (selectedProductForBatch.stock || 0) + parseInt(quantity),
        // Mark as not synced since we added a batch
        isSynced: false,
        lastModified: new Date().toISOString()
      };

      // Save updated product to IndexedDB
      await updateItem(STORES.products, updatedProduct);

      // STEP 4: Update UI state immediately
      dispatch({ type: ActionTypes.UPDATE_PRODUCT, payload: updatedProduct });
      dispatch({ type: ActionTypes.ADD_PRODUCT_BATCH, payload: newBatch });

      if (window.showToast) {
        window.showToast('Batch added successfully!', 'success');
      }

      setShowAddBatchModal(false);
      setSelectedProductForBatch(null);
      setBatchSearchTerm('');
      setBatchSearchResults([]);

    } catch (error) {
      console.error('Batch creation error:', error);
      if (window.showToast) {
        window.showToast('Failed to add batch. Please try again.', 'error');
      }
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  const handleDeleteProduct = (productId) => {
    const product = state.products.find(p => p.id === productId);
    if (product) {
      setProductPendingDelete(product);
    }
  };

  const handleEditClick = (product) => {
    if (!product || !product.id) {
      return;
    }

    setSelectedProduct(product);
    setShowEditModal(true);
  };

  const handleBatchDetailsClick = (product) => {
    if (!product || !product.id) {
      return;
    }

    setSelectedProductId(product.id);
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

  // Update selectedProduct when Redux state changes
  useEffect(() => {

    if (selectedProductId && showBatchDetailsModal) {
      const productWithBatches = state.products.find(p => p.id === selectedProductId || p._id === selectedProductId);

      //('🎯 BATCH MODAL EFFECT: Product has batches property:', productWithBatches?.hasOwnProperty('batches'));

      if (productWithBatches) {
        setSelectedProduct(productWithBatches);
      }
    }
  }, [selectedProductId, showBatchDetailsModal, state.products]);

  const downloadFile = (filename, content, contentType) => {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const escapeValue = (value) => {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  const exportProductsCSV = (withBatches = false) => {
    try {
      const headers = withBatches
        ? ['Name', 'Category', 'Stock', 'Cost Price', 'Selling Price', 'Barcode', 'Expiry Date', 'Description']
        : ['Name', 'Category', 'Stock', 'Cost Price', 'Selling Price', 'Barcode', 'Expiry Date', 'Description'];

      let rows = [];

      if (withBatches) {
        filteredProducts.forEach(product => {
          const unit = product.quantityUnit || product.unit || 'pcs';
          if (product.batches && product.batches.length > 0) {
            product.batches.forEach(batch => {
              rows.push([
                escapeValue(product.name || ''),
                escapeValue(product.category || ''),
                escapeValue(`${batch.quantity || 0} ${unit}`),
                escapeValue(batch.costPrice || 0),
                escapeValue(batch.sellingUnitPrice || product.sellingPrice || product.price || 0),
                escapeValue(product.barcode || ''),
                escapeValue(formatDate(batch.expiry)),
                escapeValue(product.description || '')
              ]);
            });
          } else {
            rows.push([
              escapeValue(product.name || ''),
              escapeValue(product.category || ''),
              escapeValue(`${product.quantity || product.stock || 0} ${unit}`),
              escapeValue(product.costPrice || 0),
              escapeValue(product.sellingPrice || product.price || 0),
              escapeValue(product.barcode || ''),
              escapeValue(formatDate(product.expiryDate)),
              escapeValue(product.description || '')
            ]);
          }
        });
      } else {
        rows = filteredProducts.map(product => {
          const totalStock = (product.batches && product.batches.length > 0)
            ? product.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)
            : (product.quantity || product.stock || 0);

          return [
            escapeValue(product.name || ''),
            escapeValue(product.category || ''),
            escapeValue(`${totalStock} ${product.quantityUnit || product.unit || 'pcs'}`),
            escapeValue(product.costPrice || 0),
            escapeValue(product.sellingPrice || product.price || 0),
            escapeValue(product.barcode || ''),
            escapeValue(formatDate(product.expiryDate)),
            escapeValue(product.description || '')
          ];
        });
      }

      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      downloadFile(
        `products-${withBatches ? 'detailed-' : ''}${new Date().toISOString().split('T')[0]}.csv`,
        csvContent,
        'text/csv;charset=utf-8;'
      );
      if (window.showToast) {
        window.showToast(`Products exported as CSV (${withBatches ? 'Detailed' : 'Summary'}).`, 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('CSV Export Error:', error);
      if (window.showToast) {
        window.showToast('Error exporting CSV. Please try again.', 'error');
      }
    }
  };

  const exportProductsJSON = (withBatches = false) => {
    try {
      let data = [];

      if (withBatches) {
        filteredProducts.forEach(product => {
          if (product.batches && product.batches.length > 0) {
            product.batches.forEach(batch => {
              data.push({
                id: product.id,
                name: product.name,
                category: product.category || '',
                unit: product.quantityUnit || product.unit || 'pcs',
                stock: batch.quantity || 0,
                costPrice: batch.costPrice || 0,
                sellingPrice: batch.sellingUnitPrice || product.sellingPrice || product.price || 0,
                barcode: product.barcode || '',
                expiryDate: batch.expiry || '',
                description: product.description || '',
                createdAt: product.createdAt || ''
              });
            });
          } else {
            data.push({
              id: product.id,
              name: product.name,
              category: product.category || '',
              unit: product.quantityUnit || product.unit || 'pcs',
              stock: product.quantity || product.stock || 0,
              costPrice: product.costPrice || 0,
              sellingPrice: product.sellingPrice || product.price || 0,
              barcode: product.barcode || '',
              expiryDate: product.expiryDate || '',
              description: product.description || '',
              createdAt: product.createdAt || ''
            });
          }
        });
      } else {
        data = filteredProducts.map((product) => {
          const totalStock = (product.batches && product.batches.length > 0)
            ? product.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)
            : (product.quantity || product.stock || 0);

          return {
            id: product.id,
            name: product.name,
            category: product.category || '',
            unit: product.quantityUnit || product.unit || 'pcs',
            stock: totalStock,
            costPrice: product.costPrice || 0,
            sellingPrice: product.sellingPrice || product.price || 0,
            barcode: product.barcode || '',
            expiryDate: product.expiryDate || '',
            description: product.description || '',
            createdAt: product.createdAt || ''
          };
        });
      }

      downloadFile(
        `products-${withBatches ? 'detailed-' : ''}${new Date().toISOString().split('T')[0]}.json`,
        JSON.stringify(data, null, 2),
        'application/json'
      );
      if (window.showToast) {
        window.showToast(`Products exported as JSON (${withBatches ? 'Detailed' : 'Summary'}).`, 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('JSON Export Error:', error);
      if (window.showToast) {
        window.showToast('Error exporting JSON. Please try again.', 'error');
      }
    }
  };

  // Parse CSV file
  const parseCSV = (csvText) => {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header row and one data row');
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const products = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const values = [];
      let currentValue = '';
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          if (inQuotes && line[j + 1] === '"') {
            currentValue += '"';
            j++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          values.push(currentValue.trim());
          currentValue = '';
        } else {
          currentValue += char;
        }
      }
      values.push(currentValue.trim());

      if (values.length > 0 && values.some(v => v)) {
        const product = {};
        headers.forEach((header, index) => {
          const value = values[index] || '';
          const headerLower = header.toLowerCase();

          if (headerLower.includes('name')) {
            product.name = value;
          } else if (headerLower.includes('category')) {
            product.category = value;
          } else if (headerLower.includes('unit')) {
            product.unit = value || 'pcs';
          } else if (headerLower.includes('stock') || headerLower.includes('quantity')) {
            product.stock = parseFloat(value) || 0;
          } else if (headerLower.includes('cost')) {
            product.costPrice = parseFloat(value) || 0;
          } else if (headerLower.includes('selling') || headerLower.includes('price')) {
            product.sellingPrice = parseFloat(value) || 0;
          } else if (headerLower.includes('barcode')) {
            product.barcode = value;
          } else if (headerLower.includes('expiry')) {
            product.expiryDate = value;
          } else if (headerLower.includes('description')) {
            product.description = value;
          }
        });
        products.push(product);
      }
    }

    return products;
  };

  // Parse JSON file
  const parseJSON = (jsonText) => {
    try {
      const data = JSON.parse(jsonText);
      if (!Array.isArray(data)) {
        throw new Error('JSON file must contain an array of products');
      }
      return data.map(item => ({
        name: item.name || item.Name || '',
        category: item.category || item.Category || '',
        unit: item.unit || item.Unit || item.quantityUnit || 'pcs',
        stock: parseFloat(item.stock || item.Stock || item.quantity || item.Quantity || 0) || 0,
        costPrice: parseFloat(item.costPrice || item.CostPrice || item.cost || item.Cost || 0) || 0,
        sellingPrice: parseFloat(item.sellingPrice || item.SellingPrice || item.price || item.Price || item.sellingUnitPrice || 0) || 0,
        barcode: item.barcode || item.Barcode || '',
        expiryDate: item.expiryDate || item.ExpiryDate || item.expiry || '',
        description: item.description || item.Description || ''
      }));
    } catch (error) {
      throw new Error(`Invalid JSON format: ${error.message}`);
    }
  };

  // Validate product data
  const validateProduct = (product, index) => {
    const errors = [];

    if (!product.name || !product.name.trim()) {
      errors.push(`Row ${index + 1}: Product name is required`);
    }

    if (!product.unit) {
      product.unit = 'pcs';
    }

    if (product.stock === undefined || product.stock === null || isNaN(product.stock)) {
      product.stock = 0;
    }

    if (product.costPrice === undefined || product.costPrice === null || isNaN(product.costPrice)) {
      product.costPrice = 0;
    }

    if (product.sellingPrice === undefined || product.sellingPrice === null || isNaN(product.sellingPrice)) {
      product.sellingPrice = 0;
    }

    return { product, errors };
  };

  // Import products from file
  const importProducts = async (file, productsToImport = null, limit = null) => {
    try {
      setImportProgress({ total: 0, processed: 0, success: 0, errors: [] });

      const fileExtension = file.name.split('.').pop().toLowerCase();
      let products = [];

      // Use provided products or parse file
      if (productsToImport && Array.isArray(productsToImport)) {
        products = productsToImport;
      } else {
        // Read file
        const fileText = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsText(file);
        });

        // Parse based on file type
        if (fileExtension === 'csv') {
          products = parseCSV(fileText);
        } else if (fileExtension === 'json') {
          products = parseJSON(fileText);
        } else {
          throw new Error('Unsupported file format. Please use CSV or JSON.');
        }
      }

      if (products.length === 0) {
        throw new Error('No products found in file');
      }

      // Apply limit if provided (for half data import)
      if (limit && limit > 0) {
        products = products.slice(0, limit);
      }

      setImportProgress(prev => ({ ...prev, total: products.length }));

      // Validate and add products
      const sellerId = getSellerIdFromAuth();
      const errors = [];
      let successCount = 0;

      for (let i = 0; i < products.length; i++) {
        const { product, errors: productErrors } = validateProduct(products[i], i);

        if (productErrors.length > 0) {
          errors.push(...productErrors);
          setImportProgress(prev => ({ ...prev, processed: i + 1, errors }));
          continue;
        }

        // Check product limit
        if (atProductLimit) {
          errors.push(`Row ${i + 1}: Product limit reached. Cannot add more products.`);
          setImportProgress(prev => ({ ...prev, processed: i + 1, errors }));
          break;
        }

        // Check for duplicate barcode
        if (product.barcode) {
          const existingProduct = state.products.find(
            p => p.barcode && p.barcode.trim() === product.barcode.trim() && !p.isDeleted
          );
          if (existingProduct) {
            errors.push(`Row ${i + 1}: Barcode "${product.barcode}" already exists for product "${existingProduct.name}"`);
            setImportProgress(prev => ({ ...prev, processed: i + 1, errors }));
            continue;
          }
        }

        // Create product object
        const newProduct = {
          id: `prod-${Date.now()}-${i}`,
          name: product.name.trim(),
          category: product.category || '',
          quantityUnit: product.unit || 'pcs',
          unit: product.unit || 'pcs',
          quantity: product.stock || 0,
          stock: product.stock || 0,
          costPrice: product.costPrice || 0,
          sellingPrice: product.sellingPrice || 0,
          price: product.sellingPrice || 0,
          barcode: product.barcode || '',
          expiryDate: product.expiryDate || '',
          description: product.description || '',
          isActive: true,
          isDeleted: false,
          createdAt: new Date().toISOString(),
          sellerId: sellerId
        };

        // Add product using dispatch
        dispatch({ type: 'ADD_PRODUCT', payload: newProduct });
        successCount++;
        setImportProgress(prev => ({ ...prev, processed: i + 1, success: successCount }));
      }

      // Show completion message
      if (successCount > 0) {
        if (window.showToast) {
          window.showToast(
            `Successfully imported ${successCount} product(s)${errors.length > 0 ? `. ${errors.length} error(s) occurred.` : ''}`,
            errors.length > 0 ? 'warning' : 'success'
          );
        }
      }

      if (errors.length > 0 && successCount === 0) {
        throw new Error(`Import failed: ${errors.join('; ')}`);
      }

      // Close modal after a delay
      setTimeout(() => {
        setShowImportModal(false);
        setImportFile(null);
        setImportProgress({ total: 0, processed: 0, success: 0, errors: [] });
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }, 2000);

    } catch (error) {

      if (window.showToast) {
        window.showToast(`Import error: ${error.message}`, 'error');
      }
      setImportProgress(prev => ({ ...prev, errors: [...prev.errors, error.message] }));
    }
  };

  // Handle file selection and check limit
  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const extension = file.name.split('.').pop().toLowerCase();
      if (extension !== 'csv' && extension !== 'json') {
        if (window.showToast) {
          window.showToast('Please select a CSV or JSON file', 'error');
        }
        return;
      }

      setImportFile(file);
      setImportProgress({ total: 0, processed: 0, success: 0, errors: [] });
      setImportLimitExceeded(false);
      setLimitExceededInfo(null);

      // Parse file to check limit
      try {
        const fileText = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsText(file);
        });

        let products = [];
        if (extension === 'csv') {
          products = parseCSV(fileText);
        } else if (extension === 'json') {
          products = parseJSON(fileText);
        }

        if (products.length > 0) {
          // Check product limit
          const { maxProducts } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
          const currentProductsCount = totalProducts;
          const productsToImport = products.length;
          const totalAfterImport = currentProductsCount + productsToImport;

          // Check if import would exceed limit (only if limit is not Infinity)
          if (maxProducts !== Infinity && totalAfterImport > maxProducts) {
            const availableSlots = maxProducts - currentProductsCount;

            setImportLimitExceeded(true);
            setParsedProducts(products);
            setLimitExceededInfo({
              currentProducts: currentProductsCount,
              productsToImport: productsToImport,
              maxProducts: maxProducts,
              availableSlots: availableSlots
            });
          } else {
            setImportLimitExceeded(false);
            setParsedProducts(products);
          }
        }
      } catch (error) {

        // Continue anyway, will be caught during import
      }
    }
  };

  // Start import
  const handleImport = () => {
    if (!importFile) {
      if (window.showToast) {
        window.showToast('Please select a file first', 'error');
      }
      return;
    }

    // If limit exceeded, don't proceed without user choice
    if (importLimitExceeded) {
      if (window.showToast) {
        window.showToast('Please choose an option: Cancel, Upload Half Data, or Upgrade Plan', 'warning');
      }
      return;
    }

    importProducts(importFile);
  };

  // Handle cancel import
  const handleCancelImport = () => {
    setShowImportModal(false);
    setImportFile(null);
    setImportProgress({ total: 0, processed: 0, success: 0, errors: [] });
    setImportLimitExceeded(false);
    setLimitExceededInfo(null);
    setParsedProducts([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle upgrade plan
  const handleUpgradePlan = () => {
    navigate('/upgrade');
    handleCancelImport();
  };

  const exportProductsPDF = async (withBatches = false) => {
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
      pdf.text(`Products Report (${withBatches ? 'Detailed' : 'Summary'})`, pageWidth - margin, 14, { align: 'right' });

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
      const cardW = (pageWidth - margin * 2 - 12) / 4;
      const cardH = 18;

      const totalValue = filteredProducts.reduce((s, p) => {
        const stock = (p.batches && p.batches.length > 0)
          ? p.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)
          : (p.quantity || p.stock || 0);
        return s + stock * (p.sellingPrice || p.price || 0);
      }, 0);

      const metrics = [
        { label: 'Total Products', value: filteredProducts.length },
        {
          label: 'Low Stock',
          value: filteredProducts.filter(p => {
            const stock = (p.batches && p.batches.length > 0)
              ? p.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)
              : (p.quantity || p.stock || 0);
            return stock > 0 && stock <= state.lowStockThreshold;
          }).length
        },
        {
          label: 'Out of Stock',
          value: filteredProducts.filter(p => {
            const stock = (p.batches && p.batches.length > 0)
              ? p.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)
              : (p.quantity || p.stock || 0);
            return stock === 0;
          }).length
        },
        { label: 'Total Value', value: formatCurrency(totalValue) }
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
        pdf.text(String(m.value), x + 4, startY + 14);
      });

      /* ================= TABLE TITLE ================= */
      let y = startY + cardH + 14;

      pdf.setDrawColor(...COLORS.border);
      pdf.line(margin, y, pageWidth - margin, y);

      y += 8;
      pdf.setFontSize(15);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(...COLORS.primary);
      pdf.text(`Product Inventory - ${withBatches ? 'Detailed Batch List' : 'Product Summary'}`, margin, y);

      /* ================= TABLE ================= */
      const headers = withBatches
        ? ['Name', 'Category', 'Stock', 'Cost', 'Price', 'Barcode', 'Expiry']
        : ['Name', 'Category', 'Stock', 'Cost', 'Price', 'Barcode', 'Expiry'];

      const colW = withBatches
        ? [60, 35, 35, 30, 30, 40, 30] // Detailed
        : [60, 40, 30, 30, 30, 40, 35]; // Summary

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
        filteredProducts.forEach(p => {
          if (p.batches && p.batches.length > 0) {
            p.batches.forEach(b => {
              itemsToRender.push({
                name: p.name || '-',
                category: p.category || '-',
                stock: `${b.quantity || 0} ${p.quantityUnit || p.unit || 'pcs'}`,
                cost: formatCurrency(b.costPrice || p.costPrice || 0),
                price: formatCurrency(b.sellingUnitPrice || p.sellingPrice || p.price || 0),
                barcode: p.barcode || '-',
                expiry: b.expiry ? formatDate(b.expiry) : '-'
              });
            });
          } else {
            itemsToRender.push({
              name: p.name || '-',
              category: p.category || '-',
              stock: `${p.quantity || p.stock || 0} ${p.quantityUnit || p.unit || 'pcs'}`,
              cost: formatCurrency(p.costPrice || 0),
              price: formatCurrency(p.sellingPrice || p.price || 0),
              barcode: p.barcode || '-',
              expiry: p.expiryDate ? formatDate(p.expiryDate) : '-'
            });
          }
        });
      } else {
        itemsToRender = filteredProducts.map(p => {
          const totalStock = (p.batches && p.batches.length > 0)
            ? p.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)
            : (p.quantity || p.stock || 0);

          return {
            name: p.name || '-',
            category: p.category || '-',
            stock: `${totalStock} ${p.quantityUnit || p.unit || 'pcs'}`,
            cost: formatCurrency(p.costPrice || 0),
            price: formatCurrency(p.sellingPrice || p.price || 0),
            barcode: p.barcode || '-',
            expiry: p.expiryDate ? formatDate(p.expiryDate) : '-'
          };
        });
      }

      itemsToRender.forEach((item, i) => {
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

        if (i % 2 === 1) {
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

      pdf.save(`products-${withBatches ? 'detailed-' : ''}${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('PDF Export Error:', err);
    }
  };


  const ExportOptionsModal = () => {
    if (!showExportOptions) return null;

    const handleSelectOption = (withBatches) => {
      setShowExportOptions(false);
      if (pendingExportType === 'csv') exportProductsCSV(withBatches);
      else if (pendingExportType === 'json') exportProductsJSON(withBatches);
      else if (pendingExportType === 'pdf') exportProductsPDF(withBatches);
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
    <PageSkeleton
      loading={isLoading}
      skeleton={<ProductsPageSkeleton />}
    >
      <div className="space-y-4 sm:space-y-6 pb-6">
        {/* Export Options Modal */}
        <ExportOptionsModal />

        {/* Header */}
        <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Products</h1>
            <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
              Manage your product inventory
              <span className="ml-2 text-blue-600 dark:text-blue-400 font-medium">
                (Used: {totalProducts} / {productLimitLabel})
              </span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (state.systemStatus === 'offline' || !navigator.onLine) {
                  if (window.showToast) {
                    window.showToast('Import is not available offline. Please connect to the internet to import products.', 'warning');
                  }
                  return;
                }
                setShowImportModal(true);
              }}
              disabled={state.systemStatus === 'offline' || !navigator.onLine}
              className="btn-secondary flex items-center text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50 dark:text-slate-200"
              title={state.systemStatus === 'offline' || !navigator.onLine ? 'Import is not available offline' : 'Import products from file'}
            >
              <Upload className="h-4 w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Import</span>
              <span className="sm:hidden">Import</span>
            </button>
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="btn-secondary flex items-center text-sm dark:text-slate-200"
              >
                <Download className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Export</span>
                <span className="sm:hidden">Export</span>
              </button>
              {showExportMenu && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowExportMenu(false)}>
                  <div
                    className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-slate-700"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
                      <h3 className="font-semibold text-gray-900 dark:text-white">Export Products</h3>
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
            <button
              onClick={openAddProductModal}
              className="btn-primary flex items-center text-sm"
            >
              <Plus className="h-4 w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Add Product</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>
        </div>

        {/* Product Content */}
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
              <div className="flex items-center p-4">
                <div className="p-2 sm:p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <Package className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="ml-3 sm:ml-4">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-slate-400">Total Products</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">{totalProducts}</p>
                </div>
              </div>
            </div>

            <div className="card bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
              <div className="flex items-center p-4">
                <div className="p-2 sm:p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
                  <AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6 text-red-600 dark:text-red-400" />
                </div>
                <div className="ml-3 sm:ml-4">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-slate-400">Low Stock</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">{lowStockProducts}</p>
                </div>
              </div>
            </div>

            <div className="card bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
              <div className="flex items-center p-4">
                <div className="p-2 sm:p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                  <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-600 dark:text-yellow-400" />
                </div>
                <div className="ml-3 sm:ml-4">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-slate-400">Expiring Soon</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">{expiringProducts}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="card bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="w-full sm:max-w-lg">
                <input
                  type="text"
                  placeholder="Search by name, category, or barcode"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-2.5 text-sm text-gray-700 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/30 transition"
                />
              </div>

              <div className="w-full sm:w-60">
                <select
                  value={selectedCategoryFilter}
                  onChange={(e) => {
                    setSelectedCategoryFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-2.5 text-sm text-gray-700 dark:text-white focus:border-blue-500 focus:bg-white dark:focus:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/30 transition"
                >
                  <option value="">All Categories</option>
                  {categoryOptions.map(cat => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Products Table - Desktop View */}
          <div className="card hidden md:block bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-700/50">
                  <tr>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Product</th>
                    <th className="px-4 sm:px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Category</th>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Stock</th>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Barcode</th>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                  {paginatedProducts.map((product) => {
                    const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                    const displayStock = totalBatchStock || product.quantity || product.stock || 0;

                    return (
                      <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                        <td className="px-4 sm:px-6 py-4" style={{ maxWidth: '300px' }}>
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10">
                              {product.imageUrl ? (
                                <img
                                  src={product.imageUrl}
                                  alt={product.name}
                                  className="h-10 w-10 rounded-lg object-cover border border-gray-200 dark:border-slate-600"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.nextSibling.style.display = 'flex';
                                  }}
                                />
                              ) : null}
                              <div
                                className={`h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center ${product.imageUrl ? 'hidden' : 'flex'}`}
                              >
                                <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                              </div>
                            </div>
                            <div className="ml-4 min-w-0 flex-1 overflow-hidden">
                              <div
                                className="text-sm font-medium text-gray-900 dark:text-white break-words line-clamp-2 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                                title={product.name}
                                onClick={() => handleBatchDetailsClick(product)}
                              >
                                {product.name}
                              </div>
                              <div className="text-sm text-gray-500 dark:text-slate-400 break-words line-clamp-2" title={product.description || 'No description'}>{product.description || 'No description'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-center">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 max-w-[150px] truncate" title={(product.category && product.category !== 'undefined') ? product.category : '-'}>
                            {(product.category && product.category !== 'undefined') ? product.category : '-'}
                          </span>
                        </td>
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1">
                            <div className="relative group">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full cursor-help ${(() => {
                                // Calculate total stock from all batches
                                const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                                // Use batch total if available, otherwise fallback to product quantity/stock
                                const displayStock = totalBatchStock || product.quantity || product.stock || 0;
                                const unit = product.quantityUnit || product.unit || 'pcs';
                                return displayStock <= state.lowStockThreshold;
                              })()
                                ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                                : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                }`}>
                                {(() => {
                                  // Calculate total stock from all batches
                                  const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                                  // Use batch total if available, otherwise fallback to product quantity/stock
                                  const displayStock = totalBatchStock || product.quantity || product.stock || 0;
                                  const unit = product.quantityUnit || product.unit || 'pcs';
                                  return `${displayStock}${unit}`;
                                })()}
                              </span>
                              {/* Tooltip with batch details */}
                              {(product.batches?.length > 0) && (
                                <div className="absolute z-10 invisible group-hover:visible bg-gray-900 text-white text-xs rounded-lg py-2 px-3 mt-1 whitespace-nowrap shadow-lg">
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
                        </td>
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                          <span className="truncate block max-w-[120px]" title={product.barcode || 'N/A'}>{product.barcode || 'N/A'}</span>
                        </td>
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleAddBatchForProduct(product)}
                              className="text-purple-600 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-300"
                              title="Create Batch"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleEditClick(product)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteProduct(product.id)}
                              className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 px-4 py-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
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
            )}
          </div>

          {/* Products Cards - Mobile View */}
          <div className="md:hidden space-y-3">
            {paginatedProducts.map((product) => (
              <div key={product.id} className="card bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700" style={{ maxWidth: '100%', overflow: 'hidden' }}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3 flex-1 min-w-0">
                    <div className="flex-shrink-0 h-12 w-12">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="h-12 w-12 rounded-lg object-cover border border-gray-200 dark:border-slate-600"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextSibling.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div
                        className={`h-12 w-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center ${product.imageUrl ? 'hidden' : 'flex'}`}
                      >
                        <Package className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div
                        className="text-sm font-medium text-gray-900 dark:text-white break-words line-clamp-2 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                        title={product.name}
                        onClick={() => handleBatchDetailsClick(product)}
                      >
                        {product.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-slate-400 line-clamp-2 break-words" title={product.description || 'No description'}>{product.description || 'No description'}</div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 truncate max-w-[150px]" title={(product.category && product.category !== 'undefined') ? product.category : '-'}>
                          {(product.category && product.category !== 'undefined') ? product.category : '-'}
                        </span>
                        <div className="flex flex-col gap-1">
                          <div className="relative group">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full cursor-help ${(() => {
                              // Calculate total stock from all batches
                              const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                              // Use batch total if available, otherwise fallback to product quantity/stock
                              const displayStock = totalBatchStock || product.quantity || product.stock || 0;
                              const unit = product.quantityUnit || product.unit || 'pcs';
                              return displayStock <= state.lowStockThreshold;
                            })()
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                              : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                              }`}>
                              {(() => {
                                // Calculate total stock from all batches
                                const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                                // Use batch total if available, otherwise fallback to product quantity/stock
                                const displayStock = totalBatchStock || product.quantity || product.stock || 0;
                                const unit = product.quantityUnit || product.unit || 'pcs';
                                return `${displayStock}${unit}`;
                              })()}
                            </span>
                            {/* Tooltip with batch details */}
                            {(product.batches?.length > 0) && (
                              <div className="absolute z-10 invisible group-hover:visible bg-gray-900 text-white text-xs rounded-lg py-2 px-3 mt-1 whitespace-nowrap shadow-lg">
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
                      <div className="mt-2 text-xs text-gray-600 dark:text-slate-500">
                        <div>Barcode: {product.barcode || 'N/A'}</div>
                        <div>Expiry: {product.expiryDate ? formatDate(product.expiryDate) : 'N/A'}</div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col space-y-2 ml-2">
                    <button
                      onClick={() => handleAddBatchForProduct(product)}
                      className="p-2 text-purple-600 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-lg transition"
                      title="Create Batch"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleEditClick(product)}
                      className="p-2 text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteProduct(product.id)}
                      className="p-2 text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Pagination - Mobile */}
            {totalPages > 1 && (
              <div className="flex flex-col items-center justify-between gap-4 pt-4 px-4 py-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
                <div className="text-sm text-gray-700 dark:text-slate-300 text-center">
                  Showing <span className="font-semibold">{startIndex + 1}</span> to <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredProducts.length)}</span> of <span className="font-semibold">{filteredProducts.length}</span> {filteredProducts.length === 1 ? 'result' : 'results'}
                </div>
                <div className="flex items-center gap-1 w-full">
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

                  {/* Page Number Buttons - Scrollable on mobile */}
                  <div className="flex items-center gap-1 mx-2 flex-1 justify-center overflow-x-auto">
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
            )}
          </div>

          {/* Modals */}
          <Suspense fallback={<ModalLoadingSpinner />}>
            {showAddModal && (
              <AddProductModal
                scannedBarcode={scannedBarcode}
                onClose={() => {
                  setShowAddModal(false);
                  setPlanLimitMessage('');
                  setScannedBarcode(''); // Clear scanned barcode when modal closes
                }}
                onSave={(data) => {
                  handleAddProduct(data);
                }}
                planLimitError={planLimitMessage}
                onClearPlanLimitError={() => setPlanLimitMessage('')}
              />
            )}

            {showEditModal && selectedProduct && (
              <EditProductModal
                product={selectedProduct}
                onClose={() => {
                  setShowEditModal(false);
                  setSelectedProduct(null);
                }}
                onSave={handleEditProduct}
              />
            )}

            {showBulkAddModal && (
              <BulkAddProductsModal
                onClose={() => {
                  setShowBulkAddModal(false);
                  setPlanLimitMessage('');
                }}
                onSave={(products) => {
                  handleBulkAddProducts(products);
                }}
                planLimitError={planLimitMessage}
                onClearPlanLimitError={() => setPlanLimitMessage('')}
              />
            )}
          </Suspense>

          {productPendingDelete && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
              <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-[0_32px_80px_-40px_rgba(15,23,42,0.55)] p-6 space-y-4">
                <div className="space-y-2 text-center">
                  <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Delete product?</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Removing <span className="font-semibold">{productPendingDelete.name}</span> will delete all related inventory details.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-end sm:gap-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setProductPendingDelete(null)}
                    className="btn-secondary w-full sm:w-auto dark:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {

                        // Soft delete: Mark as deleted in IndexedDB (same as Redux pattern)
                        const deletedProduct = {
                          ...productPendingDelete,
                          isDeleted: true,
                          deletedAt: new Date().toISOString(),
                          isSynced: false // Mark as unsynced so deletion syncs to backend
                        };

                        await updateItem(STORES.products, deletedProduct);

                        // Also soft-delete related batches in IndexedDB
                        const relatedBatches = (state.productBatches || []).filter(b =>
                          b.productId === productPendingDelete.id ||
                          (productPendingDelete._id && b.productId === productPendingDelete._id)
                        );

                        if (relatedBatches.length > 0) {
                          const deletedBatches = relatedBatches.map(batch => ({
                            ...batch,
                            isDeleted: true,
                            deletedAt: new Date().toISOString(),
                            isSynced: false
                          }));
                          await updateMultipleItems(STORES.productBatches, deletedBatches, true);
                        }

                        // Update Redux state
                        dispatch({ type: 'DELETE_PRODUCT', payload: productPendingDelete.id });
                        dispatch({
                          type: 'ADD_ACTIVITY',
                          payload: {
                            id: Date.now().toString(),
                            message: `Product "${productPendingDelete.name}" deleted`,
                            timestamp: new Date().toISOString(),
                            type: 'product_deleted'
                          }
                        });

                        setProductPendingDelete(null);

                        // Trigger sync status update to refresh the percentage in header
                        triggerSyncStatusUpdate();

                      } catch (error) {

                        if (window.showToast) {
                          window.showToast('Failed to delete product. Please try again.', 'error');
                        }
                      }
                    }}
                    className="btn-danger w-full sm:w-auto"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Import Modal */}
          {showImportModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Import Products</h3>
                  <button
                    onClick={handleCancelImport}
                    className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                      Select File (CSV or JSON)
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.json"
                      onChange={handleFileSelect}
                      className="block w-full text-sm text-gray-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:file:bg-blue-900/30 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50 cursor-pointer"
                    />
                    <p className="mt-2 text-xs text-gray-500 dark:text-slate-500">
                      CSV format: Name, Category, Stock, Cost Price, Selling Price, Barcode, Expiry Date, Description
                    </p>
                    <p className="text-xs text-gray-500 dark:text-slate-500">
                      JSON format: Array of objects with product fields
                    </p>
                  </div>

                  {importFile && (
                    <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-4">
                      <p className="text-sm font-medium text-gray-700 dark:text-slate-300">Selected file:</p>
                      <p className="text-sm text-gray-600 dark:text-slate-400">{importFile.name}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                        Size: {(importFile.size / 1024).toFixed(2)} KB
                      </p>
                      {parsedProducts.length > 0 && (
                        <p className="text-xs text-gray-600 dark:text-slate-400 mt-2">
                          Products found: {parsedProducts.length}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Limit Exceeded Warning */}
                  {importLimitExceeded && limitExceededInfo && (
                    <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <h4 className="text-sm font-semibold text-orange-900 dark:text-orange-200 mb-2">
                            Product Limit Exceeded
                          </h4>
                          <p className="text-xs text-orange-800 dark:text-orange-300 mb-3">
                            You are trying to import <strong>{limitExceededInfo.productsToImport} products</strong>, but your current plan allows only <strong>{limitExceededInfo.maxProducts} products</strong>.
                            <br />
                            You currently have <strong>{limitExceededInfo.currentProducts} products</strong> and can add <strong>{limitExceededInfo.availableSlots} more</strong>.
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2 mt-4">
                            <button
                              onClick={handleCancelImport}
                              className="flex-1 px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors text-sm"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleUpgradePlan}
                              className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 transition-colors text-sm"
                            >
                              Upgrade Plan
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {importProgress.total > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 dark:text-slate-300">Progress:</span>
                        <span className="text-gray-600 dark:text-slate-400">
                          {importProgress.processed} / {importProgress.total}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{
                            width: `${(importProgress.processed / importProgress.total) * 100}%`
                          }}
                        />
                      </div>
                      {importProgress.success > 0 && (
                        <p className="text-sm text-green-600 dark:text-green-400">
                          ✓ Successfully imported: {importProgress.success}
                        </p>
                      )}
                      {importProgress.errors.length > 0 && (
                        <div className="mt-2 max-h-32 overflow-y-auto">
                          <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">Errors:</p>
                          <ul className="text-xs text-red-600 dark:text-red-400 space-y-1">
                            {importProgress.errors.slice(0, 5).map((error, idx) => (
                              <li key={idx}>• {error}</li>
                            ))}
                            {importProgress.errors.length > 5 && (
                              <li>... and {importProgress.errors.length - 5} more</li>
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {!importLimitExceeded && (
                    <div className="flex gap-3 pt-4">
                      <button
                        onClick={handleCancelImport}
                        className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleImport}
                        disabled={!importFile || importProgress.total > 0}
                        className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {importProgress.total > 0 ? 'Importing...' : 'Import Products'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Add Batch Modal */}
          {showAddBatchModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" data-batch-modal>
                <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Add Product Batch</h3>
                  <button
                    onClick={() => setShowAddBatchModal(false)}
                    className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  {/* Product Selection - Only show if no product is pre-selected */}
                  {!selectedProductForBatch && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                        Select Product *
                      </label>
                      <div className="space-y-3">
                        <input
                          type="text"
                          placeholder="Search for product by name or barcode..."
                          value={batchSearchTerm}
                          onChange={(e) => {
                            setBatchSearchTerm(e.target.value);
                            handleBatchSearch(e.target.value);
                          }}
                          className="w-full rounded-xl border border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/30 transition"
                        />

                        {/* Search Results */}
                        {batchSearchResults.length > 0 && (
                          <div className="border border-gray-200 dark:border-slate-700 rounded-lg max-h-40 overflow-y-auto">
                            {batchSearchResults.map((product) => (
                              <button
                                key={product.id}
                                onClick={() => handleSelectProductForBatch(product)}
                                className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700 last:border-b-0 transition-colors"
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="font-medium text-gray-900 dark:text-white">{product.name}</p>
                                    <p className="text-sm text-gray-600 dark:text-slate-400">
                                      Stock: {(product.batches?.reduce((sum, b) => sum + (b.quantity || 0), 0) || 0) || product.quantity || product.stock || 0} {product.unit || 'pcs'} •
                                      Barcode: {product.barcode || 'N/A'}
                                    </p>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* No results - show create option */}
                        {batchSearchTerm.trim() && batchSearchResults.length === 0 && (
                          <div className="text-center py-4 border border-gray-200 dark:border-slate-700 rounded-lg">
                            <p className="text-gray-600 dark:text-slate-400 mb-3">Product not found</p>
                            <button
                              onClick={handleCreateNewProductForBatch}
                              className="btn-primary"
                            >
                              Create New Product
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Selected Product Display - Always show when product is selected */}
                  {selectedProductForBatch && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                        Selected Product
                      </label>
                      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-blue-900 dark:text-blue-100">{selectedProductForBatch.name}</p>
                            <p className="text-sm text-blue-700 dark:text-blue-300">
                              Stock: {(selectedProductForBatch.batches?.reduce((sum, b) => sum + (b.quantity || 0), 0) || 0) || selectedProductForBatch.quantity || selectedProductForBatch.stock || 0} {selectedProductForBatch.unit || 'pcs'} •
                              Barcode: {selectedProductForBatch.barcode || 'N/A'}
                            </p>
                            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                              {selectedProductForBatch.trackExpiry ? 'Tracks expiry dates' : 'Does not track expiry dates'}
                            </p>
                          </div>
                          {!selectedProductForBatch.id?.startsWith('preselected_') && (
                            <button
                              onClick={() => {
                                setSelectedProductForBatch(null);
                                setBatchSearchTerm('');
                              }}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Batch Form */}
                  {selectedProductForBatch && (
                    <div className="border-t border-gray-200 dark:border-slate-700 pt-6">
                      <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Batch Details</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          {/* <label className="block text-sm font-medium text-gray-700 mb-2">
                        Batch Number
                      </label> */}
                          {/* <input
                        type="text"
                        placeholder="Optional batch number"
                        className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 transition"
                      /> */}
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                            Quantity *
                          </label>
                          <input
                            type="number"
                            placeholder="Enter quantity"
                            min="1"
                            className="w-full rounded-xl border border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/30 transition"
                          />
                        </div>

                        {/* Manufacturing Date - Only show if product tracks expiry */}
                        {selectedProductForBatch.trackExpiry && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                              Manufacturing Date *
                            </label>
                            <input
                              type="date"
                              className="w-full rounded-xl border border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/30 transition"
                            />
                          </div>
                        )}

                        {/* Expiry Date - Only show if product tracks expiry */}
                        {selectedProductForBatch.trackExpiry && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                              Expiry Date *
                            </label>
                            <input
                              type="date"
                              className="w-full rounded-xl border border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/30 transition"
                            />
                          </div>
                        )}

                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                            Cost Price (₹) *
                          </label>
                          <input
                            type="number"
                            placeholder="Enter cost price"
                            min="0"
                            step="0.01"
                            className="w-full rounded-xl border border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/30 transition"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                            Selling Price (₹) *
                          </label>
                          <input
                            type="number"
                            placeholder="Enter selling price"
                            min="0"
                            step="0.01"
                            className="w-full rounded-xl border border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/30 transition"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Create Product Modal */}
                  {showCreateProductModal && (
                    <Suspense fallback={<ModalLoadingSpinner />}>
                      <AddProductModal
                        isOpen={showCreateProductModal}
                        onClose={() => setShowCreateProductModal(false)}
                        onSuccess={(newProduct) => {
                          setSelectedProductForBatch(newProduct);
                          setBatchSearchTerm(newProduct.name);
                          setShowCreateProductModal(false);
                          setBatchSearchResults([]);
                        }}
                      />
                    </Suspense>
                  )}
                </div>

                {/* Modal Footer */}
                {selectedProductForBatch && (
                  <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 px-6 py-4 rounded-b-2xl flex gap-3">
                    <button
                      onClick={() => setShowAddBatchModal(false)}
                      className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleBatchSubmit}
                      className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
                    >
                      Add Batch
                    </button>
                    {isSubmittingBatch && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/50 rounded-b-2xl cursor-not-allowed">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Product Batch Details Modal */}
          {showBatchDetailsModal && selectedProduct && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
                  <h3 className="text-xl font-semibold text-gray-900">
                    {selectedProduct.name} - Batch Details
                  </h3>
                  <button
                    onClick={() => {
                      setShowBatchDetailsModal(false);
                      setSelectedProduct(null);
                      setSelectedProductId(null);
                    }}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="p-6">
                  {/* Product Summary */}
                  <div className="bg-gray-50 rounded-lg p-4 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <p className="text-sm text-gray-600">Total Stock</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {(() => {
                            const totalBatchStock = selectedProduct.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                            const displayStock = totalBatchStock || selectedProduct.quantity || selectedProduct.stock || 0;
                            return `${displayStock} ${selectedProduct.quantityUnit || selectedProduct.unit || 'pcs'}`;
                          })()}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Number of Batches</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {selectedProduct.batches?.length || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Average per Batch</p>
                        <p className="text-2xl font-bold text-gray-900">
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
                    <h4 className="text-lg font-semibold text-gray-900">Batch Inventory</h4>

                    {selectedProduct.batches && selectedProduct.batches.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Batch Number
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Quantity
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Cost Price
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Selling Price
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Mfg Date
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Expiry Date
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {selectedProduct.batches.map((batch, index) => {
                              const isEditing = editingBatchId === (batch.id || batch._id);

                              return (
                                <tr key={batch.id || index} className={isEditing ? "bg-blue-50" : "hover:bg-gray-50"}>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    {isEditing ? (
                                      <input
                                        type="text"
                                        value={editingBatchData.batchNumber}
                                        onChange={(e) => handleBatchInputChange('batchNumber', e.target.value)}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="Batch number"
                                      />
                                    ) : (
                                      batch.batchNumber || `Batch ${index + 1}`
                                    )}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {isEditing ? (
                                      <input
                                        type="text"
                                        value={editingBatchData.quantity}
                                        onChange={(e) => {
                                          const value = e.target.value.replace(/[^0-9.]/g, '');
                                          handleBatchInputChange('quantity', value);
                                        }}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="0.00"
                                        required
                                      />
                                    ) : (
                                      `${batch.quantity || 0} ${selectedProduct.quantityUnit || selectedProduct.unit || 'pcs'}`
                                    )}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {isEditing ? (
                                      <input
                                        type="text"
                                        value={editingBatchData.costPrice}
                                        onChange={(e) => {
                                          const value = e.target.value.replace(/[^0-9.]/g, '');
                                          handleBatchInputChange('costPrice', value);
                                        }}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="0.00"
                                        required
                                      />
                                    ) : (
                                      `₹${batch.costPrice ? batch.costPrice.toFixed(2) : '0.00'}`
                                    )}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {isEditing ? (
                                      <input
                                        type="text"
                                        value={editingBatchData.sellingUnitPrice}
                                        onChange={(e) => {
                                          const value = e.target.value.replace(/[^0-9.]/g, '');
                                          handleBatchInputChange('sellingUnitPrice', value);
                                        }}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="0.00"
                                        required
                                      />
                                    ) : (
                                      `₹${batch.sellingUnitPrice ? batch.sellingUnitPrice.toFixed(2) : '0.00'}`
                                    )}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {isEditing ? (
                                      <input
                                        type="date"
                                        value={editingBatchData.mfg}
                                        onChange={(e) => handleBatchInputChange('mfg', e.target.value)}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      />
                                    ) : (
                                      batch.mfg ? formatDate(batch.mfg) : 'N/A'
                                    )}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {isEditing ? (
                                      <input
                                        type="date"
                                        value={editingBatchData.expiry}
                                        onChange={(e) => handleBatchInputChange('expiry', e.target.value)}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                                          className="text-green-600 hover:text-green-900 hover:bg-green-50 px-2 py-1 rounded transition-colors text-xs font-medium"
                                          title="Confirm Edit"
                                        >
                                          ✓ Confirm
                                        </button>
                                        <button
                                          onClick={() => handleEditBatch(batch)}
                                          className="text-red-600 hover:text-red-900 hover:bg-red-50 px-2 py-1 rounded transition-colors text-xs font-medium"
                                          title="Cancel Edit"
                                        >
                                          ✕ Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => handleEditBatch(batch)}
                                        className="text-blue-600 hover:text-blue-900 hover:bg-blue-50 px-3 py-1 rounded-md transition-colors"
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
                        <Package className="mx-auto h-12 w-12 text-gray-400" />
                        <h3 className="mt-2 text-sm font-medium text-gray-900">No batches found</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          This product doesn't have any batches yet.
                        </p>
                        <div className="mt-6">
                          <button
                            onClick={() => handleAddBatchForProduct(selectedProduct)}
                            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add First Batch
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        </>
      </div>
    </PageSkeleton >
  );
};

export default Products;

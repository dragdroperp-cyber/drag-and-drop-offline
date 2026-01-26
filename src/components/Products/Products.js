import React, { useState, useRef, useEffect, useCallback, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp, ActionTypes, triggerSyncStatusUpdate, isPlanExpired } from '../../context/AppContext';
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
  Layout,
  IndianRupee,
  CalendarX,
  RefreshCw,
  Search,
  Filter,
  ChevronDown,
  ScanLine,
  QrCode,
  Printer,
} from 'lucide-react';
import { PageSkeleton, SkeletonTable } from '../UI/SkeletonLoader';
import { getPlanLimits, canAddProduct, getDistributedPlanLimits, getRemainingCapacity, isUnlimited } from '../../utils/planUtils';
import { getSellerIdFromAuth, syncData, apiRequest } from '../../utils/api';
import { updateItem, updateMultipleItems, deleteItem, STORES } from '../../utils/indexedDB';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';
import { formatDate } from '../../utils/dateUtils';
import { getEffectivePrice } from '../../utils/productUtils';
import { getTotalStockQuantity } from '../../utils/unitConversion';
import syncService from '../../services/syncService';
import { addWatermarkToPDF } from '../../utils/pdfUtils';

// Lazy load heavy components
const AddProductModal = lazy(() => import('./AddProductModal'));
const EditProductModal = lazy(() => import('./EditProductModal'));
const BulkAddProductsModal = lazy(() => import('./BulkAddProductsModal'));
const BarcodePrintModal = lazy(() => import('./BarcodePrintModal'));
const ManageCategoriesModal = lazy(() => import('./ManageCategoriesModal'));

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
      <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-1/3 animate-pulse"></div>
      <div className="h-10 bg-gray-200 dark:bg-slate-700 rounded w-32 animate-pulse"></div>
    </div>

    {/* Search and filters skeleton */}
    <div className="flex space-x-4">
      <div className="flex-1 h-10 bg-gray-200 dark:bg-slate-700 rounded animate-pulse"></div>
      <div className="w-32 h-10 bg-gray-200 dark:bg-slate-700 rounded animate-pulse"></div>
      <div className="w-32 h-10 bg-gray-200 dark:bg-slate-700 rounded animate-pulse"></div>
    </div>

    {/* Table skeleton */}
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border dark:border-slate-700">
      <div className="p-6">
        <SkeletonTable rows={8} columns={6} />
      </div>
    </div>
  </div>
);

const Products = () => {
  const { state, dispatch } = useApp();

  const navigate = useNavigate();
  const location = useLocation();

  // Handle navigation from Dashboard for Add Batch
  useEffect(() => {
    if (location.state?.openAddBatch && location.state?.product) {
      // Find the full product object from state if needed, or use the passed one
      // It's safer to find it in the current products list to ensure we have the latest data/methods
      const foundProduct = state.products.find(p => (p.id || p._id) === (location.state.product.id || location.state.product._id));

      if (foundProduct) {
        setSelectedProductForBatch(foundProduct);
        setShowAddBatchModal(true);
        setBatchSearchTerm(foundProduct.name);
        setBatchSearchResults([]);
        // Clear state to prevent reopening on generic re-renders? 
        // location.state is persistent on the history stack, so we might want to replace it.
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [location.state, state.products, navigate]);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('');
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
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showManageCategoriesModal, setShowManageCategoriesModal] = useState(false);
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
  const [isClosingBatchModal, setIsClosingBatchModal] = useState(false);
  const [showBatchPromptModal, setShowBatchPromptModal] = useState(false);
  const [promptProduct, setPromptProduct] = useState(null);

  const handleCloseBatchModal = () => {
    setIsClosingBatchModal(true);
    setTimeout(() => {
      setShowAddBatchModal(false);
      setIsClosingBatchModal(false);
    }, 400);
  };

  const [editingBatchId, setEditingBatchId] = useState(null);
  const [editingBatchData, setEditingBatchData] = useState(null);
  const [showEditBatchModal, setShowEditBatchModal] = useState(false);
  const [batchSearchTerm, setBatchSearchTerm] = useState('');
  const [batchSearchResults, setBatchSearchResults] = useState([]);
  const [selectedProductForBatch, setSelectedProductForBatch] = useState(null);
  const [showCreateProductModal, setShowCreateProductModal] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [pendingExportType, setPendingExportType] = useState(null); // 'pdf', 'csv', 'json'

  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);
  const [newBatchData, setNewBatchData] = useState({
    batchNumber: '',
    quantity: '',
    costPrice: '',
    sellingUnitPrice: '',
    wholesalePrice: '',
    mfg: '',
    expiry: ''
  });

  const exportMenuRef = useRef(null);

  // Handle navigation from Notifications
  useEffect(() => {
    if (location.state?.filterStatus) {
      setSelectedStatusFilter(location.state.filterStatus);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate]);

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
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast(getTranslation('planExpiredAddProduct', state.currentLanguage), 'warning', 8000);
      }
      return;
    }
    setShowAddModal(true);
  });

  // Keyboard shortcut: Shift + M to open bulk add products modal
  useKeyboardShortcut('m', false, true, () => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast(getTranslation('planExpiredAddProduct', state.currentLanguage), 'warning', 8000);
      }
      return;
    }
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
  const { maxProducts } = getDistributedPlanLimits(state.aggregatedUsage, state.currentPlan, state.currentPlanDetails);
  const totalProducts = activeProducts.length;
  const remainingProducts = getRemainingCapacity(activeProducts.length, state.aggregatedUsage, 'products', state.currentPlan, state.currentPlanDetails);
  const atProductLimit = remainingProducts <= 0 && !isUnlimited(maxProducts);
  const productLimitLabel = isUnlimited(maxProducts) ? getTranslation('unlimited', state.currentLanguage) : maxProducts;

  const planNameLabel = state.currentPlanDetails?.planName
    || (state.currentPlan ? `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}` : 'Current');

  const showProductLimitWarning = () => {
    const limitMessage = getTranslation('productLimitReached', state.currentLanguage)
      .replace('{count}', String(productLimitLabel))
      .replace('{plan}', planNameLabel);
    setPlanLimitMessage(limitMessage);
    if (window.showToast) {
      window.showToast(limitMessage, 'warning', 5000);
    }
  };

  // Helper to determine product alert status
  const getProductAlertStatus = useCallback((product) => {
    // Check batches first
    if (product.batches && product.batches.length > 0) {
      // Critical: Any batch expired AND has quantity
      const hasCriticalBatch = product.batches.some(b => {
        const qty = Number(b.quantity) || 0;
        if (qty <= 0 || !b.expiry) return false;
        const expiryDate = new Date(b.expiry);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        expiryDate.setHours(0, 0, 0, 0);
        return expiryDate < today;
      });
      if (hasCriticalBatch) return 'critical';

      // Warning: Any batch expiring soon AND has quantity
      const hasWarningBatch = product.batches.some(b => {
        const qty = Number(b.quantity) || 0;
        if (qty <= 0 || !b.expiry) return false;
        const expiryDate = new Date(b.expiry);
        const today = new Date();
        const diffTime = expiryDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays <= state.expiryDaysThreshold;
      });
      if (hasWarningBatch) return 'warning';

    } else {
      // Fallback to product level expiry
      if (product.expiryDate) {
        const qty = Number(product.quantity) || Number(product.stock) || 0;
        if (qty > 0) {
          const expiryDate = new Date(product.expiryDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          expiryDate.setHours(0, 0, 0, 0);
          if (expiryDate < today) return 'critical';

          const diffTime = expiryDate - new Date();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays <= state.expiryDaysThreshold) return 'warning';
        }
      }
    }
    return 'safe';
  }, [state.expiryDaysThreshold]);

  // Helper to determine single batch alert status
  const getBatchAlertStatus = useCallback((batch) => {
    const qty = Number(batch.quantity) || 0;
    // Only flag if stock exists and expiry date is present
    if (qty <= 0 || !batch.expiry) return 'safe';

    const expiryDate = new Date(batch.expiry);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiryDate.setHours(0, 0, 0, 0);

    if (expiryDate < today) return 'critical';

    const diffTime = expiryDate - new Date();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays >= 0 && diffDays <= state.expiryDaysThreshold) return 'warning';

    return 'safe';
  }, [state.expiryDaysThreshold]);

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

    let matchesStatus = true;
    if (selectedStatusFilter) {
      const totalStock = (product.batches && product.batches.length > 0)
        ? product.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)
        : (Number(product.quantity) || Number(product.stock) || 0);

      switch (selectedStatusFilter) {
        case 'low_stock':
          matchesStatus = totalStock <= state.lowStockThreshold && totalStock > 0;
          break;
        case 'out_of_stock':
          matchesStatus = totalStock <= 0;
          break;
        case 'expiry_soon':
          matchesStatus = getProductAlertStatus(product) === 'warning';
          break;
        case 'expired':
          matchesStatus = getProductAlertStatus(product) === 'critical';
          break;
        default:
          matchesStatus = true;
      }
    }

    return matchesSearch && matchesCategory && matchesStatus;
  }).sort((a, b) => {
    const qA = getTotalStockQuantity(a);
    const qB = getTotalStockQuantity(b);

    if (qA > 0 && qB === 0) return -1;
    if (qA === 0 && qB > 0) return 1;

    return (a.name || '').localeCompare(b.name || '');
  });

  const openAddProductModal = (barcode = '') => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast(getTranslation('planExpiredProduct', state.currentLanguage), 'warning', 8000);
      }
      return;
    }
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
      window.showToast(getTranslation('processingBarcode', state.currentLanguage), 'info', 1000);
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
            window.showToast(getTranslation('foundExistingProduct', state.currentLanguage).replace('{name}', existingProduct.name || 'Unnamed'), 'success', 2000);
          }
          handleEditClick(existingProduct);
        } else {
          //('➕ Opening add modal for new barcode (retry)');
          if (window.showToast) {
            window.showToast(getTranslation('newBarcodeDetected', state.currentLanguage), 'info', 2000);
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
        window.showToast(getTranslation('foundExistingProduct', state.currentLanguage).replace('{name}', existingProduct.name || 'Unnamed'), 'success', 2000);
      }
      handleEditClick(existingProduct);
    } else {
      // Barcode doesn't exist - open add product modal with barcode pre-filled

      if (window.showToast) {
        window.showToast(getTranslation('newBarcodeDetected', state.currentLanguage), 'info', 2000);
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
        if (timeSinceLastKey < 200 || scannerInputBufferRef.current.length === 0) {
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
  }, [searchTerm, selectedCategoryFilter, selectedStatusFilter, itemsPerPage]);

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
  const lowStockProducts = activeProducts.filter(product => {
    const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (Number(batch.quantity) || 0), 0);
    const displayStock = (totalBatchStock !== undefined && totalBatchStock !== null) ? totalBatchStock : (Number(product.quantity) || Number(product.stock) || 0);
    return displayStock <= state.lowStockThreshold && displayStock > 0;
  }).length;

  const outOfStockProducts = activeProducts.filter(product => {
    const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (Number(batch.quantity) || 0), 0);
    const displayStock = (totalBatchStock !== undefined && totalBatchStock !== null) ? totalBatchStock : (Number(product.quantity) || Number(product.stock) || 0);
    return displayStock <= 0;
  }).length;

  const expiringProducts = activeProducts.filter(product =>
    getProductAlertStatus(product) === 'warning'
  ).length;

  const expiredProducts = activeProducts.filter(product =>
    getProductAlertStatus(product) === 'critical'
  ).length;

  // Calculate Total Inventory Value
  const totalInventoryValue = activeProducts.reduce((sum, product) => {
    // Calculate value from batches if they exist (more accurate)
    if (product.batches && product.batches.length > 0) {
      const batchValue = product.batches.reduce((bSum, batch) => {
        const qty = Number(batch.quantity) || 0;
        const cost = Number(batch.costPrice) || Number(product.costPrice) || 0;
        return bSum + (qty * cost);
      }, 0);
      return sum + batchValue;
    }

    // Fallback to product level fields
    const qty = Number(product.quantity) || Number(product.stock) || 0;
    const cost = Number(product.costPrice) || 0;
    return sum + (qty * cost);
  }, 0);

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
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
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
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        message: `Product "${newProduct.name}" added`,
        timestamp: new Date().toISOString(),
        type: 'product_added'
      }
    });

    // Trigger sync status update to refresh the percentage in header
    triggerSyncStatusUpdate();

    if (window.showToast) {
      window.showToast(getTranslation('productAddedSuccess', state.currentLanguage).replace('{name}', newProduct.name), 'success');
    }

    setShowAddModal(false);
    setPromptProduct(newProduct);
    setShowBatchPromptModal(true);
    setPlanLimitMessage('');
    return true;
  };

  const handleBulkAddProducts = (productsData) => {
    if (!productsData || productsData.length === 0) {
      if (window.showToast) {
        window.showToast(getTranslation('noProductsToAdd', state.currentLanguage), 'warning');
      }
      return false;
    }

    // Check if we have enough capacity for all products
    const activeProducts = state.products.filter(product => !product.isDeleted);
    const totalProducts = activeProducts.length;
    const remainingCapacity = state.aggregatedUsage?.products?.remaining || 0;

    if (remainingCapacity !== null && remainingCapacity !== undefined && remainingCapacity < productsData.length) {
      const message = getTranslation('insufficientSlots', state.currentLanguage)
        .replace('{count}', String(productsData.length))
        .replace('{remaining}', String(remainingCapacity));
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
          id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5) + '_' + i, // Unique ID for each product
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
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            message: `${addedProducts.length} products added in bulk`,
            timestamp: currentTime,
            type: 'bulk_product_added'
          }
        });

        // Trigger sync status update
        triggerSyncStatusUpdate();

        // Show success message
        if (window.showToast) {
          window.showToast(getTranslation('bulkAddSuccess', state.currentLanguage).replace('{count}', String(addedProducts.length)), 'success');
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
        window.showToast(getTranslation('errorAddingProducts', state.currentLanguage), 'error');
      }
      return false;
    }
  };

  const handleEditProduct = async (productData) => {

    try {
      // Resolve category name from ID if provided or if category currently matches ID
      let categoryName = productData.category || '';
      if (productData.categoryId && (!categoryName || categoryName === productData.categoryId || categoryName === 'undefined')) {
        const categoryObj = state.categories.find(c => (c.id === productData.categoryId || c._id === productData.categoryId));
        if (categoryObj) {
          categoryName = categoryObj.name;
        }
      }

      // Ensure the product has required fields for IndexedDB
      const updatedProduct = {
        ...productData,
        category: categoryName,
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

      // Schedule debounced sync
      if (syncService.isOnline()) {
        syncService.scheduleSync();
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
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
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
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to add stock batches.', 'warning', 8000);
      }
      return;
    }
    setShowAddBatchModal(true);
    setBatchSearchTerm('');
    setBatchSearchResults([]);
    setSelectedProductForBatch(null);
    setShowCreateProductModal(false);
  };

  const handleAddBatchForProduct = (product) => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to add stock batches.', 'warning', 8000);
      }
      return;
    }
    setSelectedProductForBatch(product);
    setBatchSearchTerm(product.name);
    setBatchSearchResults([]);
    setNewBatchData({
      batchNumber: '',
      quantity: '',
      costPrice: '',
      sellingUnitPrice: '',
      mfg: '',
      expiry: ''
    });
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

      // Check required fields based on trackExpiry setting
      const { quantity, costPrice, sellingUnitPrice, wholesalePrice, mfg, expiry, batchNumber } = newBatchData;

      const requiredFieldsMissing = [];
      if (!quantity) requiredFieldsMissing.push('quantity');
      if (!costPrice) requiredFieldsMissing.push('cost price');
      if (!sellingUnitPrice) requiredFieldsMissing.push('selling price');
      if (!wholesalePrice) requiredFieldsMissing.push('wholesale price');

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

      const qtyVal = parseInt(quantity.toString().replace(/,/g, ''));
      const costVal = parseFloat(costPrice.toString().replace(/,/g, ''));
      const sellVal = parseFloat(sellingUnitPrice.toString().replace(/,/g, ''));
      const wholesaleVal = parseFloat(wholesalePrice.toString().replace(/,/g, ''));

      if (qtyVal <= 0 || costVal < 0 || sellVal < 0 || wholesaleVal < 0) {
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

      // Set submitting state
      setIsSubmittingBatch(true);

      // Auto-generate unique batch number
      const finalBatchNumber = `Batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

      // Ensure productId is a string (MongoDB ObjectId string)
      const productId = typeof selectedProductForBatch._id === 'string'
        ? selectedProductForBatch._id
        : selectedProductForBatch.id;

      // STEP 1: Create batch object for offline-first storage
      const newBatch = {
        id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        _id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        productId: productId,
        batchNumber: finalBatchNumber,
        quantity: parseInt(quantity.toString().replace(/,/g, '')),
        costPrice: parseFloat(costPrice.toString().replace(/,/g, '')),
        unitPrice: parseFloat(costPrice.toString().replace(/,/g, '')), // Legacy field
        sellingUnitPrice: parseFloat(sellingUnitPrice.toString().replace(/,/g, '')),
        sellingPrice: parseFloat(sellingUnitPrice.toString().replace(/,/g, '')), // Legacy field
        wholesalePrice: parseFloat(wholesalePrice.toString().replace(/,/g, '')),
        // Only include mfg and expiry if product tracks expiry
        ...(selectedProductForBatch.trackExpiry && mfg && { mfg }),
        ...(selectedProductForBatch.trackExpiry && expiry && { expiry }),
        sellerId: state.auth?.sellerId || state.currentUser?.sellerId,
        createdAt: new Date().toISOString(),
        isSynced: false,
        lastModified: new Date().toISOString()
      };

      // STEP 2: Save batch to IndexedDB (offline-first)
      const { addItem, updateItem, STORES } = await import('../../utils/indexedDB');

      console.log('💾 Adding batch to DB:', newBatch);
      const savedBatchId = await addItem(STORES.productBatches, newBatch);
      console.log('✅ Batch saved result:', savedBatchId);

      if (!savedBatchId) {
        console.error('❌ Failed to save batch to IndexedDB: savedBatchId is null/undefined');
        if (window.showToast) {
          window.showToast('Database Error: Failed to save batch locally', 'error');
        }
        setIsSubmittingBatch(false);
        return;
      }

      // If addItem returned an existing ID (duplicate found), skip updating product stock
      if (savedBatchId !== newBatch.id && savedBatchId !== newBatch._id) {
        if (window.showToast) {
          window.showToast('Batch with this batch number already exists', 'error');
        }
        setIsSubmittingBatch(false);
        return;
      }

      // STEP 3: Update product with new batch - merge with existing batches
      const existingBatches = selectedProductForBatch.batches || [];
      const updatedBatches = [...existingBatches, newBatch];

      // Determine if we should update the base product price
      // Logic: Update if current price is 0 or missing
      const shouldUpdateBasePrice = !selectedProductForBatch.sellingUnitPrice || selectedProductForBatch.sellingUnitPrice === 0;
      const shouldUpdateCostPrice = !selectedProductForBatch.costPrice || selectedProductForBatch.costPrice === 0;

      const updatedProduct = {
        ...selectedProductForBatch,
        batches: updatedBatches,
        // Update total quantity
        quantity: (selectedProductForBatch.quantity || 0) + parseInt(quantity),
        stock: (selectedProductForBatch.stock || 0) + parseInt(quantity),

        // Update base prices if they were missing/zero
        costPrice: shouldUpdateCostPrice ? parseFloat(costPrice) : selectedProductForBatch.costPrice,
        unitPrice: shouldUpdateCostPrice ? parseFloat(costPrice) : selectedProductForBatch.unitPrice,
        sellingUnitPrice: shouldUpdateBasePrice ? parseFloat(sellingUnitPrice) : selectedProductForBatch.sellingUnitPrice,
        sellingPrice: shouldUpdateBasePrice ? parseFloat(sellingUnitPrice) : selectedProductForBatch.sellingPrice,
        wholesalePrice: shouldUpdateBasePrice && !selectedProductForBatch.wholesalePrice ? parseFloat(wholesalePrice) : selectedProductForBatch.wholesalePrice,


        // Preserve isSynced status (don't mark as unsynced for batch updates)
        isSynced: selectedProductForBatch.isSynced,
        lastModified: new Date().toISOString()
      };

      // Verify we are updating sync queue if price changed
      if (shouldUpdateBasePrice || shouldUpdateCostPrice) {
        updatedProduct.isSynced = false; // Mark as unsynced so the price update goes to backend

        // Also addToSyncQueue for product update
        const { addToSyncQueue } = await import('../../utils/dataFetcher');
        await addToSyncQueue('product_update', {
          ...updatedProduct,
          id: updatedProduct.id
        });
      }

      // Save updated product to IndexedDB
      await updateItem(STORES.products, updatedProduct);

      // STEP 4: Update UI state immediately
      dispatch({ type: ActionTypes.UPDATE_PRODUCT, payload: { ...updatedProduct, skipAutoSync: true, isBatchUpdate: true } });
      dispatch({ type: ActionTypes.ADD_PRODUCT_BATCH, payload: newBatch });

      // Schedule debounced sync
      if (syncService.isOnline()) {
        syncService.scheduleSync();
      }

      // Trigger sync status update
      triggerSyncStatusUpdate();

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
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to delete products.', 'warning', 8000);
      }
      return;
    }
    const product = state.products.find(p => p.id === productId);
    if (product) {
      setProductPendingDelete(product);
    }
  };

  const handleEditClick = (product) => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to edit product details.', 'warning', 8000);
      }
      return;
    }
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

    setSelectedProduct(product);
    setSelectedProductId(product.id);
    setShowBatchDetailsModal(true);
  };

  const handleEditBatch = (batch) => {
    // Start editing
    setEditingBatchId(batch.id || batch._id);
    setEditingBatchData({
      batchNumber: batch.batchNumber || '',
      quantity: batch.quantity || '',
      costPrice: batch.costPrice || '',
      sellingUnitPrice: batch.sellingUnitPrice || '',
      wholesalePrice: batch.wholesalePrice || '',
      mfg: batch.mfg ? new Date(batch.mfg).toISOString().split('T')[0] : '',
      expiry: batch.expiry ? new Date(batch.expiry).toISOString().split('T')[0] : ''
    });
    setShowEditBatchModal(true);
  };

  const handleBatchInputChange = (field, value) => {
    setEditingBatchData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleConfirmBatchEdit = async () => {
    try {
      const qtyVal = Number(editingBatchData.quantity.toString().replace(/,/g, ''));
      const costVal = Number(editingBatchData.costPrice.toString().replace(/,/g, ''));
      const sellVal = Number(editingBatchData.sellingUnitPrice.toString().replace(/,/g, ''));
      const wholesaleVal = Number(editingBatchData.wholesalePrice.toString().replace(/,/g, ''));

      // Validate inputs
      if (isNaN(qtyVal) || qtyVal < 0 ||
        isNaN(costVal) || costVal < 0 ||
        isNaN(sellVal) || sellVal < 0 ||
        isNaN(wholesaleVal) || wholesaleVal < 0) {

        if (window.showToast) {
          window.showToast('Please enter valid positive values.', 'error');
        }
        return;
      }

      const updateData = {
        batchNumber: editingBatchData.batchNumber,
        quantity: qtyVal,
        costPrice: costVal,
        sellingUnitPrice: sellVal,
        wholesalePrice: wholesaleVal,
        // If date is present, use it. If it's an empty string/cleared, set to null so it can be cleared in DB
        // Using || null ensures the field exists in updateData and overwrites the spread values
        mfg: editingBatchData.mfg || null,
        expiry: editingBatchData.expiry || null
      };

      console.log('[DEBUG] updateData for batch edit:', updateData);

      // Create the updated batch data for offline storage
      const currentBatch = selectedProduct.batches.find(b => (b.id || b._id) === editingBatchId);
      const updatedBatch = {
        ...currentBatch,
        ...updateData,
        id: editingBatchId,
        _id: editingBatchId,
        productId: selectedProduct.id || selectedProduct._id, // Ensure productId is present for validation
        sellerId: currentBatch?.sellerId || state.auth?.sellerId || state.currentUser?.sellerId, // Ensure sellerId is present
        isSynced: false, // Mark as not synced for offline-first approach
        lastModified: new Date().toISOString()
      };

      // Update the batch in the selected product
      const updatedBatches = selectedProduct.batches.map(b =>
        (b.id || b._id) === editingBatchId ? updatedBatch : b
      );

      // Recalculate total quantity/stock from batches
      const newTotalStock = updatedBatches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);

      const updatedProduct = {
        ...selectedProduct,
        batches: updatedBatches,
        quantity: newTotalStock,
        stock: newTotalStock,
        // CRITICAL: Always use localId as the primary 'id' key for IndexedDB if it exists.
        // This prevents ID swapping (UUID -> MongoID) which creates duplicates.
        id: selectedProduct.localId || selectedProduct.id,
        _id: selectedProduct._id, // Keep MongoDB ID in its own field
        localId: selectedProduct.localId || selectedProduct.id, // Ensure localId is preserved
        // Preserve isSynced status (don't mark as unsynced matches logic in handleBatchSubmit)
        isSynced: selectedProduct.isSynced,
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
        // Use standard ActionTypes for better consistency and to trigger sync status calculation
        dispatch({
          type: ActionTypes.UPDATE_PRODUCT_BATCH,
          payload: updatedBatch
        });

        // Also update the parent product in state to reflect total stock changes
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

        // Schedule debounced sync
        if (syncService.isOnline()) {
          syncService.scheduleSync();
        }

        // Trigger sync status update to refresh progress header
        triggerSyncStatusUpdate();

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
                escapeValue(formatCurrencySmart(batch.costPrice || 0, state.currencyFormat)),
                escapeValue(formatCurrencySmart(batch.sellingUnitPrice || product.sellingPrice || product.price || 0, state.currencyFormat)),
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
              escapeValue(formatCurrencySmart(product.costPrice || 0, state.currencyFormat)),
              escapeValue(formatCurrencySmart(product.sellingPrice || product.price || 0, state.currencyFormat)),
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
            escapeValue(formatCurrencySmart(product.costPrice || 0, state.currencyFormat)),
            escapeValue(formatCurrencySmart(product.sellingPrice || product.price || 0, state.currencyFormat)),
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
                id: Math.random().toString(36).substr(2, 9),
                name: product.name,
                category: product.category || '',
                unit: product.quantityUnit || product.unit || 'pcs',
                stock: batch.quantity || 0,
                costPrice: formatCurrencySmart(batch.costPrice || 0, state.currencyFormat),
                sellingPrice: formatCurrencySmart(batch.sellingUnitPrice || product.sellingPrice || product.price || 0, state.currencyFormat),
                barcode: product.barcode || '',
                expiryDate: batch.expiry || '',
                description: product.description || '',
                createdAt: product.createdAt || ''
              });
            });
          } else {
            data.push({
              id: Math.random().toString(36).substr(2, 9),
              name: product.name,
              category: product.category || '',
              unit: product.quantityUnit || product.unit || 'pcs',
              stock: product.quantity || product.stock || 0,
              costPrice: formatCurrencySmart(product.costPrice || 0, state.currencyFormat),
              sellingPrice: formatCurrencySmart(product.sellingPrice || product.price || 0, state.currencyFormat),
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
            id: Math.random().toString(36).substr(2, 9),
            name: product.name,
            category: product.category || '',
            unit: product.quantityUnit || product.unit || 'pcs',
            stock: totalStock,
            costPrice: formatCurrencySmart(product.costPrice || 0, state.currencyFormat),
            sellingPrice: formatCurrencySmart(product.sellingPrice || product.price || 0, state.currencyFormat),
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

  /* ================= MODERN PDF EXPORT (THEMED) ================= */
  const exportProductsPDF = async (withBatches = false) => {
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
          doc.addImage(logoBase64, 'PNG', logoX, logoY, logoSize, logoSize);
        }
      } catch (e) { }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(...COLORS.primary);
      doc.text('Grocery studio', logoX + logoSize + 4, logoY + 7);

      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.gray);
      doc.text('Advanced Billing & Inventory Solution', logoX + logoSize + 4, logoY + 11);

      /* -------- RIGHT META -------- */
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.black);
      safeDrawText(doc, `${getTranslation('productReport', state.currentLanguage)}`, pageWidth - margin, logoY + 5, { align: 'right', color: '#000000', fontSize: 14 });

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.gray);
      safeDrawText(doc, `Type: ${withBatches ? 'Detailed (Batches)' : 'Summary'}`, pageWidth - margin, logoY + 11, { align: 'right', color: '#787878', fontSize: 9 });

      const today = new Date();
      safeDrawText(doc, `Date: ${formatDate(today)}`, pageWidth - margin, logoY + 16, { align: 'right', color: '#787878', fontSize: 9 });

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

      const totalValue = filteredProducts.reduce((s, p) => {
        const stock = (p.batches && p.batches.length > 0)
          ? p.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)
          : (p.quantity || p.stock || 0);
        return s + stock * (p.sellingPrice || p.price || 0);
      }, 0);

      const metrics = [
        { label: getTranslation('totalProducts', state.currentLanguage), value: filteredProducts.length.toString(), color: COLORS.primary },
        {
          label: getTranslation('lowStock', state.currentLanguage),
          value: filteredProducts.filter(p => {
            const stock = (p.batches && p.batches.length > 0) ? p.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0) : (p.quantity || p.stock || 0);
            return stock > 0 && stock <= state.lowStockThreshold;
          }).length.toString(),
          color: COLORS.secondary
        },
        {
          label: getTranslation('outOfStock', state.currentLanguage),
          value: filteredProducts.filter(p => {
            const stock = (p.batches && p.batches.length > 0) ? p.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0) : (p.quantity || p.stock || 0);
            return stock === 0;
          }).length.toString(),
          color: COLORS.gray
        },
        { label: getTranslation('totalValue', state.currentLanguage), value: formatPDFCurrency(totalValue), color: COLORS.success }
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
      safeDrawText(doc, getTranslation('productInventory', state.currentLanguage), margin, y, { color: '#000000', fontSize: 10.5 });
      y += 6.5;

      const headers = [
        'S.No.',
        getTranslation('name', state.currentLanguage),
        getTranslation('categoryHeader', state.currentLanguage),
        { text: getTranslation('stockHeader', state.currentLanguage), align: 'center' },
        { text: getTranslation('priceHeader', state.currentLanguage), align: 'right' },
        withBatches ? getTranslation('expiryHeader', state.currentLanguage) : getTranslation('barcodeHeader', state.currentLanguage)
      ];

      // Portrait Weights (Total ~180mm + Margins)
      // S.No., Name, Category, Stock, Price, Barcode/Expiry
      const colWeights = [
        { w: 15, align: 'center' }, // S.No.
        { w: 55, align: 'center' }, // Name (Centered)
        { w: 30, align: 'center' }, // Category (Centered)
        { w: 25, align: 'center' }, // Stock
        { w: 25, align: 'center' }, // Price (Centered)
        { w: 30, align: 'center' }  // Barcode/Expiry (Centered)
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
        // Enforce center alignment
        let drawX = hX + (colWeights[i].w / 2);
        safeDrawText(doc, headerText, drawX, y + 6.5, { align: 'center', color: '#2F3C7E', fontSize: 9 });
        hX += colWeights[i].w;
      });

      y += 10;

      // Prepare items
      let itemsToRender = [];
      if (withBatches) {
        filteredProducts.forEach(p => {
          if (p.batches && p.batches.length > 0) {
            p.batches.forEach(b => {
              itemsToRender.push({
                name: p.name || '-',
                category: p.category || '-',
                stock: `${b.quantity || 0} ${p.quantityUnit || p.unit || 'pcs'}`,
                price: formatPDFCurrency(b.sellingUnitPrice || p.sellingPrice || 0),
                extra: b.expiry ? formatDate(b.expiry) : '-'
              });
            });
          } else {
            itemsToRender.push({
              name: p.name || '-',
              category: p.category || '-',
              stock: `${p.quantity || p.stock || 0} ${p.quantityUnit || p.unit || 'pcs'}`,
              price: formatPDFCurrency(p.sellingPrice || 0),
              extra: p.expiryDate ? formatDate(p.expiryDate) : '-'
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
            price: formatPDFCurrency(p.sellingPrice || 0),
            extra: p.barcode || '-'
          };
        });
      }

      // Rows
      itemsToRender.forEach((item, index) => {
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
            // Enforce center alignment
            let drawX = rHX + (colWeights[i].w / 2);
            safeDrawText(doc, headerText, drawX, y + 6.5, { align: 'center', color: '#2F3C7E', fontSize: 9 });
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

        let rowX = margin;

        // S.No.
        safeDrawText(doc, (index + 1).toString(), rowX + (colWeights[0].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        rowX += colWeights[0].w;

        // Name (Centered)
        safeDrawText(doc, item.name.substring(0, 30), rowX + (colWeights[1].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        rowX += colWeights[1].w;

        // Category (Centered)
        safeDrawText(doc, item.category.substring(0, 20), rowX + (colWeights[2].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        rowX += colWeights[2].w;

        // Stock (Center)
        safeDrawText(doc, item.stock, rowX + (colWeights[3].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        rowX += colWeights[3].w;

        // Price (Centered)
        doc.setFont('helvetica', 'bold');
        safeDrawText(doc, item.price, rowX + (colWeights[4].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        doc.setFont('helvetica', 'normal');
        rowX += colWeights[4].w;

        // Extra (Barcode/Expiry) - Center
        safeDrawText(doc, item.extra, rowX + (colWeights[5].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 8 });

        y += rowH;
      });

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
          doc.text('Grocery Studio', centerX + 0.5, gsY, { align: 'left' });
        }

        doc.setFontSize(8);
        doc.setTextColor(...COLORS.gray);
        doc.setFont('helvetica', 'normal');
        doc.text(
          state.currentUser?.shopName || 'Store',
          pageWidth - margin,
          pageHeight - 10,
          { align: 'right' }
        );
      }

      // Add watermark
      await addWatermarkToPDF(doc, sellerLogo || undefined);

      doc.save(`products-${withBatches ? 'detailed-' : ''}${new Date().toISOString().split('T')[0]}.pdf`);
      if (window.showToast) {
        window.showToast('Product report exported as PDF.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('Error in exportProductsPDF:', error);
      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  }; const handleSelectOption = (withBatches) => {
    setShowExportOptions(false);
    if (pendingExportType === 'csv') exportProductsCSV(withBatches);
    else if (pendingExportType === 'json') exportProductsJSON(withBatches);
    else if (pendingExportType === 'pdf') exportProductsPDF(withBatches);
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
      <div className="fixed inset-0 bg-black/60 z-[110] flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setShowExportOptions(false)}>
        <div
          className="bg-white dark:bg-slate-900 rounded-none md:rounded-3xl shadow-2xl w-full md:max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-slate-800 fixed inset-0 md:relative md:inset-auto h-full md:h-auto flex flex-col justify-center items-center"
          onClick={e => e.stopPropagation()}
        >
          <div className="p-6 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">{getTranslation('exportOptions', state.currentLanguage)}</h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('chooseHowToExport', state.currentLanguage)}</p>
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
                  <h4 className="font-bold text-gray-900 dark:text-white">{getTranslation('summaryExport', state.currentLanguage)}</h4>
                  <p className="text-sm text-gray-500 dark:text-slate-400">{getTranslation('summaryExportDesc', state.currentLanguage)}</p>
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
                  <h4 className="font-bold text-gray-900 dark:text-white">{getTranslation('detailedExport', state.currentLanguage)}</h4>
                  <p className="text-sm text-gray-500 dark:text-slate-400">{getTranslation('detailedExportDesc', state.currentLanguage)}</p>
                </div>
              </div>
            </button>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-800 flex justify-end">
            <button
              onClick={() => setShowExportOptions(false)}
              className="px-6 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              {getTranslation('cancel', state.currentLanguage)}
            </button>
          </div>
        </div>
      </div>
    );
  };


  return (
    <div className="space-y-4 sm:space-y-6 pb-6 animate-in fade-in duration-500">
      {/* Export Options Modal */}
      <ExportOptionsModal />

      {/* Header */}
      <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{getTranslation('products', state.currentLanguage)}</h1>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">

            {(!isUnlimited(maxProducts) && remainingProducts < 15) && (
              <span className="ml-2 text-red-600 dark:text-red-400 font-medium">
                ({getTranslation('productLimitLeft', state.currentLanguage)}: {remainingProducts})
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button
            onClick={() => {
              if (isPlanExpired(state)) {
                if (window.showToast) window.showToast('Plan expired. Upgrade to import products.', 'error');
                return;
              }
              if (state.systemStatus === 'offline' || !navigator.onLine) {
                if (window.showToast) {
                  window.showToast('Import is not available offline. Please connect to the internet to import products.', 'warning');
                }
                return;
              }
              setShowImportModal(true);
            }}
            disabled={isPlanExpired(state) || state.systemStatus === 'offline' || !navigator.onLine}
            className="btn-secondary flex-1 sm:flex-none justify-center flex items-center text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50 dark:text-slate-200"
            title={isPlanExpired(state) ? 'Plan expired' : (state.systemStatus === 'offline' || !navigator.onLine ? 'Import is not available offline' : 'Import products from file')}
          >
            <Upload className="h-4 w-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">{getTranslation('import', state.currentLanguage)}</span>
            <span className="sm:hidden">{getTranslation('import', state.currentLanguage)}</span>
          </button>
          <div className="relative flex-1 sm:flex-none" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="btn-secondary w-full justify-center flex items-center text-sm dark:text-slate-200"
            >
              <Download className="h-4 w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">{getTranslation('export', state.currentLanguage)}</span>
              <span className="sm:hidden">{getTranslation('export', state.currentLanguage)}</span>
            </button>
            {showExportMenu && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowExportMenu(false)}>
                <div
                  className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-slate-700"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{getTranslation('exportProducts', state.currentLanguage)}</h3>
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
                        <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsCSV', state.currentLanguage)}</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('spreadsheetFormat', state.currentLanguage)}</span>
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
                        <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsJSON', state.currentLanguage)}</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('rawDataFormat', state.currentLanguage)}</span>
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
                        <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsPDF', state.currentLanguage)}</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('printableDocumentFormat', state.currentLanguage)}</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowManageCategoriesModal(true)}
            className="btn-secondary flex-1 sm:flex-none justify-center flex items-center text-sm dark:text-slate-200"
          >
            <Layers className="h-4 w-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Categories</span>
            <span className="sm:hidden">Cats</span>
          </button>
          <button
            onClick={() => setShowBarcodeModal(true)}
            className="btn-secondary flex-1 sm:flex-none justify-center flex items-center text-sm dark:text-slate-200"
          >
            <Printer className="h-4 w-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Print Barcode</span>
            <span className="sm:hidden">Barcode</span>
          </button>
          <button
            onClick={() => {
              if (isPlanExpired(state)) {
                if (window.showToast) window.showToast('Your plan has expired. Upgrade to add products.', 'error');
                return;
              }
              openAddProductModal();
            }}
            className="btn-primary flex-1 sm:flex-none justify-center flex items-center text-sm"
            disabled={isPlanExpired(state)}
          >
            <Plus className="h-4 w-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">{getTranslation('addProduct', state.currentLanguage)}</span>
            <span className="sm:hidden">{getTranslation('add', state.currentLanguage)}</span>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {[
          { title: getTranslation('totalProducts', state.currentLanguage), value: totalProducts, color: 'blue', icon: <Package /> },
          { title: getTranslation('lowStock', state.currentLanguage), value: lowStockProducts, color: 'orange', icon: <AlertTriangle /> },
          { title: getTranslation('outOfStock', state.currentLanguage), value: outOfStockProducts, color: 'rose', icon: <AlertTriangle /> },
          { title: getTranslation('expiringSoon', state.currentLanguage), value: expiringProducts, color: 'amber', icon: <Clock /> },
          { title: getTranslation('expired', state.currentLanguage), value: expiredProducts, color: 'rose', icon: <CalendarX /> },
        ].map((card, idx) => {
          const getColorClasses = (c) => {
            switch (c) {
              case 'emerald': return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400';
              case 'rose': return 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400';
              case 'indigo': return 'bg-indigo-50 dark:bg-indigo-900/20 text-slate-900 dark:text-slate-100';
              case 'amber': return 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400';
              case 'blue': return 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400';
              case 'orange': return 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400';
              case 'purple': return 'bg-purple-50 dark:bg-purple-900/20 text-slate-900 dark:text-slate-100';
              default: return 'bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-slate-400';
            }
          };

          // Reusing the same text color logic or simplifying as products page doesn't need strict green/red for values, but we can match Financial if desired.
          // Financial page uses specific text colors for value. Here we will keep them standard dark/white for readability unless it's critical.
          const getTextClass = (c) => {
            if (c === 'rose') return 'text-rose-600 dark:text-rose-400';
            if (c === 'orange') return 'text-orange-600 dark:text-orange-400';
            return 'text-gray-900 dark:text-white';
          };

          return (
            <div key={idx} className="relative bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
              {/* Icon Top Right */}
              <div className={`absolute top-4 right-4 p-2.5 rounded-xl ${getColorClasses(card.color)}`}>
                {React.cloneElement(card.icon, { className: 'h-5 w-5' })}
              </div>
              <div className="mt-2">
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{card.title}</p>
                <p className={`text-2xl font-semibold whitespace-nowrap overflow-x-auto scrollbar-hide ${getTextClass(card.color)}`}>
                  {card.value}
                </p>
              </div>
            </div>
          );
        })}

        <div className="relative bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
            <IndianRupee className="h-5 w-5" />
          </div>
          <div className="mt-2">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('inventoryValue', state.currentLanguage)}</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-white whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrencySmart(totalInventoryValue, state.currencyFormat)}>
              {formatCurrencySmart(totalInventoryValue, state.currencyFormat)}
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="card bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-lg relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400 dark:text-slate-500" />
            </div>
            <input
              type="text"
              placeholder={getTranslation('searchByProductPlaceholder', state.currentLanguage)}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            <div className="w-full sm:w-48 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Filter className="h-4 w-4 text-gray-500 dark:text-slate-400" />
              </div>
              <select
                value={selectedStatusFilter}
                onChange={(e) => {
                  setSelectedStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 pl-10 pr-10 py-2.5 text-sm text-gray-700 dark:text-white focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm appearance-none cursor-pointer"
              >
                <option value="">{getTranslation('allStatus', state.currentLanguage) || 'All Status'}</option>
                <option value="low_stock">{getTranslation('lowStock', state.currentLanguage) || 'Low Stock'}</option>
                <option value="out_of_stock">{getTranslation('outOfStock', state.currentLanguage) || 'Out of Stock'}</option>
                <option value="expiry_soon">{getTranslation('expiringSoon', state.currentLanguage) || 'Expiring Soon'}</option>
                <option value="expired">{getTranslation('expired', state.currentLanguage) || 'Expired'}</option>
              </select>
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </div>
            </div>

            <div className="w-full sm:w-60 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Layers className="h-4 w-4 text-gray-500 dark:text-slate-400" />
              </div>
              <select
                value={selectedCategoryFilter}
                onChange={(e) => {
                  setSelectedCategoryFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 pl-10 pr-10 py-2.5 text-sm text-gray-700 dark:text-white focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm appearance-none cursor-pointer"
              >
                <option value="">{getTranslation('allCategories', state.currentLanguage)}</option>
                {categoryOptions.map(cat => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ')}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Products Table - Desktop View */}
      <div className="card hidden md:block bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          {isLoading ? (
            <div className="p-6">
              <SkeletonTable rows={10} columns={6} />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead className="bg-gray-50 dark:bg-slate-700/50">
                <tr>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('productHeader', state.currentLanguage)}</th>
                  <th className="px-4 sm:px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('categoryHeader', state.currentLanguage)}</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('stockHeader', state.currentLanguage)}</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('priceValueHeader', state.currentLanguage)}</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('barcodeHeader', state.currentLanguage)}</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('actionsHeader', state.currentLanguage)}</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                {paginatedProducts.map((product) => {
                  const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                  const displayStock = totalBatchStock || product.quantity || product.stock || 0;

                  return (
                    <tr
                      key={product.id}
                      className="hover:bg-gray-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
                      onClick={() => handleBatchDetailsClick(product)}
                    >
                      <td className="px-4 sm:px-6 py-4" style={{ maxWidth: '300px' }}>
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10">
                            {product.imageUrl || (product.images && product.images.length > 0) ? (
                              <img
                                src={product.imageUrl || product.images[0]}
                                alt={product.name}
                                className="h-10 w-10 rounded-lg object-cover border border-gray-200 dark:border-slate-600"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  e.currentTarget.nextSibling.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <div
                              className={`h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center ${(product.imageUrl || (product.images && product.images.length > 0)) ? 'hidden' : 'flex'}`}
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
                            {/* Product Status Badge */}
                            {(() => {
                              const status = getProductAlertStatus(product);
                              if (status === 'critical') {
                                return (
                                  <span className="mt-1 inline-flex w-fit items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                                    {getTranslation('expired', state.currentLanguage)}
                                  </span>
                                );
                              }
                              if (status === 'warning') {
                                return (
                                  <span className="mt-1 inline-flex w-fit items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                    {getTranslation('expiringSoon', state.currentLanguage)}
                                  </span>
                                );
                              }
                              return null;
                            })()}
                            <div className="text-sm text-gray-500 dark:text-slate-400 break-words line-clamp-2" title={product.description || getTranslation('noDescription', state.currentLanguage)}>{product.description || getTranslation('noDescription', state.currentLanguage)}</div>
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
                                <div className="font-semibold mb-1">{getTranslation('batchDetails', state.currentLanguage)}:</div>
                                {product.batches.map((batch, index) => (
                                  <div key={batch.id || index} className="flex justify-between gap-4">
                                    <span>{batch.batchNumber || `Batch ${index + 1}`}:</span>
                                    <span>{batch.quantity || 0} {product.quantityUnit || product.unit || 'pcs'}</span>
                                  </div>
                                ))}
                                <div className="border-t border-gray-600 mt-1 pt-1 font-semibold">
                                  {getTranslation('total', state.currentLanguage)}: {product.batches.reduce((sum, batch) => sum + (batch.quantity || 0), 0)} {product.quantityUnit || product.unit || 'pcs'}
                                </div>
                              </div>
                            )}
                          </div>
                          {(product.batches?.length > 0) && (
                            <span className="text-xs text-gray-500 dark:text-slate-400">
                              {product.batches.length} {product.batches.length !== 1 ? getTranslation('batches', state.currentLanguage) : getTranslation('batch', state.currentLanguage)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900 dark:text-white">
                            {formatCurrencySmart(getEffectivePrice(product), state.currencyFormat)}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-slate-400">
                            {getTranslation('val', state.currentLanguage)}: {(() => {
                              const totalVal = (product.batches?.length > 0)
                                ? product.batches.reduce((sum, b) => sum + ((Number(b.quantity) || 0) * (Number(b.costPrice) || Number(product.costPrice) || 0)), 0)
                                : (Number(product.quantity) || Number(product.stock) || 0) * (Number(product.costPrice) || 0);
                              return formatCurrencySmart(totalVal, state.currencyFormat);
                            })()}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                        <span className="truncate block max-w-[120px]" title={product.barcode || getTranslation('na', state.currentLanguage)}>{product.barcode || getTranslation('na', state.currentLanguage)}</span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isPlanExpired(state)) {
                                if (window.showToast) window.showToast('Plan expired. Upgrade to manage product.', 'error');
                                return;
                              }
                              handleAddBatchForProduct(product);
                            }}
                            className={`${isPlanExpired(state) ? 'text-gray-400 cursor-not-allowed opacity-50' : 'text-purple-600 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-300'}`}
                            title={getTranslation('createBatch', state.currentLanguage)}
                            disabled={isPlanExpired(state)}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isPlanExpired(state)) {
                                if (window.showToast) window.showToast('Plan expired. Upgrade to manage product.', 'error');
                                return;
                              }
                              handleEditClick(product);
                            }}
                            className={`${isPlanExpired(state) ? 'text-gray-400 cursor-not-allowed opacity-50' : 'text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300'}`}
                            disabled={isPlanExpired(state)}
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isPlanExpired(state)) {
                                if (window.showToast) window.showToast('Plan expired. Upgrade to manage product.', 'error');
                                return;
                              }
                              handleDeleteProduct(product.id);
                            }}
                            className={`${isPlanExpired(state) ? 'text-gray-400 cursor-not-allowed opacity-50' : 'text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300'}`}
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
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 px-4 py-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
            <div className="text-sm text-gray-700 dark:text-slate-300">
              {getTranslation('showing', state.currentLanguage)} <span className="font-semibold">{startIndex + 1}</span> {getTranslation('to', state.currentLanguage)} <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredProducts.length)}</span> {getTranslation('of', state.currentLanguage)} <span className="font-semibold">{filteredProducts.length}</span> {filteredProducts.length === 1 ? getTranslation('result', state.currentLanguage) : getTranslation('results', state.currentLanguage)}
            </div>
            <div className="flex items-center gap-1">
              {/* First Page Button */}
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={getTranslation('firstPage', state.currentLanguage)}
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>

              {/* Previous Page Button */}
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={getTranslation('previousPage', state.currentLanguage)}
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
                        ? 'bg-slate-900 text-white shadow-sm'
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
                title={getTranslation('nextPage', state.currentLanguage)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              {/* Last Page Button */}
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={getTranslation('lastPage', state.currentLanguage)}
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Products Cards - Mobile View */}
      <div className="md:hidden space-y-4">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-gray-200 dark:border-slate-700 animate-pulse">
                <div className="flex gap-4">
                  <div className="h-16 w-16 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                    <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
                  <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {paginatedProducts.map((product) => (
              <div
                key={product.id}
                className="group relative bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-gray-200 dark:border-slate-700 hover:shadow-md transition-all duration-200 cursor-pointer"
                onClick={() => handleBatchDetailsClick(product)}
              >

                {/* Header: Image & Name */}
                <div className="flex gap-4">
                  {/* Image */}
                  <div className="flex-shrink-0">
                    {product.imageUrl || (product.images && product.images.length > 0) ? (
                      <img
                        src={product.imageUrl || product.images[0]}
                        alt={product.name}
                        className="h-16 w-16 rounded-xl object-cover border border-gray-100 dark:border-slate-700 shadow-sm"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextSibling.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div
                      className={`h-16 w-16 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 flex items-center justify-center border border-blue-100 dark:border-blue-800/30 ${(product.imageUrl || (product.images && product.images.length > 0)) ? 'hidden' : 'flex'}`}
                    >
                      <Package className="h-8 w-8 text-blue-500 dark:text-blue-400" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <h3
                        className="text-base font-bold text-gray-900 dark:text-white leading-tight cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 line-clamp-2"
                        onClick={() => handleBatchDetailsClick(product)}
                      >
                        {product.name}
                      </h3>
                      {/* Product Status Badge Mobile */}
                      {(() => {
                        const status = getProductAlertStatus(product);
                        if (status === 'critical') {
                          return (
                            <span className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                              {getTranslation('expired', state.currentLanguage)}
                            </span>
                          );
                        }
                        if (status === 'warning') {
                          return (
                            <span className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                              {getTranslation('expiringSoon', state.currentLanguage)}
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>

                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{product.description || 'No description'}</p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300">
                        {product.category || 'Uncategorized'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div className="my-3 border-t border-gray-100 dark:border-slate-700/50"></div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Stock Section */}
                  <div className="p-2 rounded-xl bg-gray-50 dark:bg-slate-700/30 border border-gray-100 dark:border-slate-700/50">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 font-medium mb-1">{getTranslation('stockLevel', state.currentLanguage)}</p>
                    <div className={`flex items-center gap-1.5 ${(() => {
                      const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                      const displayStock = totalBatchStock || product.quantity || product.stock || 0;
                      return displayStock <= state.lowStockThreshold;
                    })() ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                      }`}>
                      <div className={`w-2 h-2 rounded-full ${(() => {
                        const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                        const displayStock = totalBatchStock || product.quantity || product.stock || 0;
                        return displayStock <= state.lowStockThreshold;
                      })() ? 'bg-red-500' : 'bg-green-500'
                        }`}></div>
                      <span className="text-sm font-bold">
                        {(() => {
                          const totalBatchStock = product.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                          const displayStock = totalBatchStock || product.quantity || product.stock || 0;
                          const unit = product.quantityUnit || product.unit || 'pcs';
                          return `${displayStock} ${unit}`;
                        })()}
                      </span>
                    </div>
                  </div>

                  {/* Price/Info Section */}
                  <div className="p-2 rounded-xl bg-gray-50 dark:bg-slate-700/30 border border-gray-100 dark:border-slate-700/50">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 font-medium mb-1">{getTranslation('priceValueHeader', state.currentLanguage)}</p>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">
                        {formatCurrencySmart(getEffectivePrice(product), state.currencyFormat)}
                      </span>
                      <span className="text-[10px] text-gray-500 dark:text-slate-400">
                        {getTranslation('val', state.currentLanguage)}: {(() => {
                          const totalVal = (product.batches?.length > 0)
                            ? product.batches.reduce((sum, b) => sum + ((Number(b.quantity) || 0) * (Number(b.costPrice) || Number(product.costPrice) || 0)), 0)
                            : (Number(product.quantity) || Number(product.stock) || 0) * (Number(product.costPrice) || 0);
                          return formatCurrencySmart(totalVal, state.currencyFormat);
                        })()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Info Row */}
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400 mb-4 px-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="flex-shrink-0">{getTranslation('barcode', state.currentLanguage)}:</span>
                    <span className="font-mono text-gray-700 dark:text-slate-300 truncate max-w-[100px] sm:max-w-[140px]" title={product.barcode || ''}>
                      {product.barcode || '---'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <span>{getTranslation('expires', state.currentLanguage)}:</span>
                    <span className={`${product.expiryDate ? 'text-gray-700 dark:text-slate-300' : ''}`}>
                      {product.expiryDate ? formatDate(product.expiryDate) : getTranslation('na', state.currentLanguage)}
                    </span>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddBatchForProduct(product);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium text-sm hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{getTranslation('batch', state.currentLanguage)}</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isPlanExpired(state)) {
                        if (window.showToast) window.showToast('Plan expired. Upgrade to edit products.', 'error');
                        return;
                      }
                      handleEditClick(product);
                    }}
                    disabled={isPlanExpired(state)}
                    className={`h-10 w-10 flex items-center justify-center rounded-xl bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors border border-gray-200 dark:border-slate-600 ${isPlanExpired(state) ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Edit className="h-4 w-4" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isPlanExpired(state)) {
                        if (window.showToast) window.showToast('Plan expired. Upgrade to delete products.', 'error');
                        return;
                      }
                      handleDeleteProduct(product.id);
                    }}
                    disabled={isPlanExpired(state)}
                    className={`h-10 w-10 flex items-center justify-center rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors border border-red-100 dark:border-red-900/30 ${isPlanExpired(state) ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

              </div>
            ))}
          </div>
        )}

        {/* Pagination - Mobile */}
        {totalPages > 1 && (
          <div className="flex flex-col items-center justify-between gap-4 pt-4 px-4 py-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
            <div className="text-sm text-gray-700 dark:text-slate-300 text-center">
              {getTranslation('showing', state.currentLanguage)} <span className="font-semibold">{startIndex + 1}</span> {getTranslation('to', state.currentLanguage)} <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredProducts.length)}</span> {getTranslation('of', state.currentLanguage)} <span className="font-semibold">{filteredProducts.length}</span> {filteredProducts.length === 1 ? getTranslation('result', state.currentLanguage) : getTranslation('results', state.currentLanguage)}
            </div>
            <div className="flex items-center gap-1 w-full">
              {/* First Page Button */}
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={getTranslation('firstPage', state.currentLanguage)}
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>

              {/* Previous Page Button */}
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={getTranslation('previousPage', state.currentLanguage)}
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
                        ? 'bg-slate-900 text-white shadow-sm'
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
                title={getTranslation('nextPage', state.currentLanguage)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              {/* Last Page Button */}
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={getTranslation('lastPage', state.currentLanguage)}
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
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/60 p-0 md:p-4" onClick={() => setProductPendingDelete(null)}>
          <div className="w-full md:max-w-sm rounded-none md:rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-[0_32px_80px_-40px_rgba(15,23,42,0.55)] p-6 space-y-4 h-full md:h-auto fixed inset-0 md:relative md:inset-auto flex flex-col justify-center items-center" onClick={e => e.stopPropagation()}>
            <div className="space-y-2 text-center">
              <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{getTranslation('deleteProductConfirmTitle', state.currentLanguage)}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {getTranslation('deleteProductConfirmText', state.currentLanguage).replace('{name}', productPendingDelete.name)}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-end sm:gap-3 gap-2">
              <button
                type="button"
                onClick={() => setProductPendingDelete(null)}
                className="btn-secondary w-full sm:w-auto dark:text-slate-200"
              >
                {getTranslation('cancel', state.currentLanguage)}
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
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
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
                      window.showToast(getTranslation('failedToDeleteProduct', state.currentLanguage), 'error');
                    }
                  }
                }}
                className="btn-danger w-full sm:w-auto"
              >
                {getTranslation('delete', state.currentLanguage)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center">
          <div className="bg-white dark:bg-slate-800 !rounded-none md:rounded-2xl shadow-xl w-full md:max-w-2xl fixed inset-0 md:relative md:inset-auto !h-full md:!h-auto md:max-h-[90vh] overflow-y-auto m-0">
            <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{getTranslation('importTitle', state.currentLanguage)}</h3>
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
                  {getTranslation('selectFileLabel', state.currentLanguage)}
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-gray-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:file:bg-blue-900/30 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50 cursor-pointer"
                />
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-500">
                  {getTranslation('csvFormatDesc', state.currentLanguage)}
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-500">
                  {getTranslation('jsonFormatDesc', state.currentLanguage)}
                </p>
              </div>

              {importFile && (
                <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-4">
                  <p className="text-sm font-medium text-gray-700 dark:text-slate-300">{getTranslation('selectedFileLabel', state.currentLanguage)}:</p>
                  <p className="text-sm text-gray-600 dark:text-slate-400">{importFile.name}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                    {getTranslation('sizeLabel', state.currentLanguage)}: {(importFile.size / 1024).toFixed(2)} KB
                  </p>
                  {parsedProducts.length > 0 && (
                    <p className="text-xs text-gray-600 dark:text-slate-400 mt-2">
                      {getTranslation('productsFoundLabel', state.currentLanguage)}: {parsedProducts.length}
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
                        {getTranslation('productLimitExceededTitle', state.currentLanguage)}
                      </h4>
                      <p className="text-xs text-orange-800 dark:text-orange-300 mb-3">
                        {getTranslation('productLimitExceededText', state.currentLanguage)
                          .replace('{toImport}', limitExceededInfo.productsToImport)
                          .replace('{max}', limitExceededInfo.maxProducts)
                          .replace('{current}', limitExceededInfo.currentProducts)
                          .replace('{available}', limitExceededInfo.availableSlots)}
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
                          {getTranslation('upgradePlan', state.currentLanguage)}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {importProgress.total > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-slate-300">{getTranslation('progressLabel', state.currentLanguage)}:</span>
                    <span className="text-gray-600 dark:text-slate-400">
                      {importProgress.processed} / {importProgress.total}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-slate-900 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${(importProgress.processed / importProgress.total) * 100}%`
                      }}
                    />
                  </div>
                  {importProgress.success > 0 && (
                    <p className="text-sm text-green-600 dark:text-green-400">
                      ✓ {getTranslation('importSuccessMsg', state.currentLanguage)}: {importProgress.success}
                    </p>
                  )}
                  {importProgress.errors.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-y-auto">
                      <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">{getTranslation('errorsLabel', state.currentLanguage)}:</p>
                      <ul className="text-xs text-red-600 dark:text-red-400 space-y-1">
                        {importProgress.errors.slice(0, 5).map((error, idx) => (
                          <li key={idx}>• {error}</li>
                        ))}
                        {importProgress.errors.length > 5 && (
                          <li>... {getTranslation('andXMore', state.currentLanguage).replace('{count}', importProgress.errors.length - 5)}</li>
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
                    {getTranslation('cancel', state.currentLanguage)}
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={!importFile || importProgress.total > 0}
                    className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-slate-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {importProgress.total > 0 ? getTranslation('importing', state.currentLanguage) : getTranslation('importTitle', state.currentLanguage)}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showEditBatchModal && editingBatchData && typeof document !== 'undefined' && createPortal(
        <div
          className={`fixed inset-0 bg-slate-900/40 z-[100000] flex items-end md:items-center justify-center transition-opacity duration-300 animate-fadeIn`}
          onClick={() => setShowEditBatchModal(false)}
        >
          <style>{`
                @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
                @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
              `}</style>
          <div
            key={isClosingBatchModal ? 'closing' : 'opening'}
            style={{ animation: `${isClosingBatchModal ? 'slideDown' : 'slideUp'} 0.3s ease-out forwards` }}
            className="bg-white dark:bg-black !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-2xl border border-gray-200 dark:border-white/10 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:h-auto m-0"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10">
              <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">
                {getTranslation('editBatch', state.currentLanguage) || 'Edit Batch'}
              </h3>
              <button
                onClick={() => setShowEditBatchModal(false)}
                className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              {/* Batch Number */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                  {getTranslation('batchNumHeader', state.currentLanguage)}
                </label>
                <input
                  type="text"
                  value={editingBatchData.batchNumber}
                  onChange={(e) => handleBatchInputChange('batchNumber', e.target.value)}
                  className="block w-full px-4 py-3 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                {/* Quantity */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                    {getTranslation('quantityHeader', state.currentLanguage)}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editingBatchData.quantity}
                    onChange={(e) => {
                      const val = e.target.value.replace(/,/g, '');
                      if (/^[0-9]*\.?[0-9]*$/.test(val)) {
                        const parts = val.split('.');
                        if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                        handleBatchInputChange('quantity', parts.join('.'));
                      }
                    }}
                    className="block w-full px-4 py-3 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all dark:text-white"
                  />
                </div>
                {/* Selling Price */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                    {getTranslation('priceHeader', state.currentLanguage)}
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <IndianRupee className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editingBatchData.sellingUnitPrice}
                      onChange={(e) => {
                        const val = e.target.value.replace(/,/g, '');
                        if (/^[0-9]*\.?[0-9]*$/.test(val)) {
                          const parts = val.split('.');
                          if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                          handleBatchInputChange('sellingUnitPrice', parts.join('.'));
                        }
                      }}
                      className="block w-full pl-10 pr-4 py-3 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all dark:text-white"
                    />
                  </div>
                </div>

                {/* Wholesale Price */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                    {getTranslation('wholesalePrice', state.currentLanguage)}
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <IndianRupee className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editingBatchData.wholesalePrice}
                      onChange={(e) => {
                        const val = e.target.value.replace(/,/g, '');
                        if (/^[0-9]*\.?[0-9]*$/.test(val)) {
                          const parts = val.split('.');
                          if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                          handleBatchInputChange('wholesalePrice', parts.join('.'));
                        }
                      }}
                      className="block w-full pl-10 pr-4 py-3 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all dark:text-white"
                    />
                  </div>
                </div>


                {/* Cost Price */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                    {getTranslation('costHeader', state.currentLanguage)}
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <IndianRupee className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editingBatchData.costPrice}
                      onChange={(e) => {
                        const val = e.target.value.replace(/,/g, '');
                        if (/^[0-9]*\.?[0-9]*$/.test(val)) {
                          const parts = val.split('.');
                          if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                          handleBatchInputChange('costPrice', parts.join('.'));
                        }
                      }}
                      className="block w-full pl-10 pr-4 py-3 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all dark:text-white"
                    />
                  </div>
                </div>

                <div className="md:grid md:grid-cols-2 md:col-span-2 gap-x-6 gap-y-5 flex flex-col space-y-5 md:space-y-0">
                  {selectedProduct?.trackExpiry && (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                          {getTranslation('mfgDateHeader', state.currentLanguage)}
                        </label>
                        <input
                          type="date"
                          value={editingBatchData.mfg}
                          onChange={(e) => handleBatchInputChange('mfg', e.target.value)}
                          className="block w-full px-4 py-3 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all dark:text-white [color-scheme:dark]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                          {getTranslation('expiryHeader', state.currentLanguage)}
                        </label>
                        <input
                          type="date"
                          value={editingBatchData.expiry}
                          onChange={(e) => handleBatchInputChange('expiry', e.target.value)}
                          className="block w-full px-4 py-3 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all dark:text-white [color-scheme:dark]"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="p-6 pt-0 pb-8 md:pb-6">
              <button
                onClick={handleConfirmBatchEdit}
                disabled={JSON.stringify({
                  batchNumber: editingBatchData.batchNumber,
                  quantity: Number(editingBatchData.quantity?.toString().replace(/,/g, '') || 0),
                  costPrice: Number(editingBatchData.costPrice?.toString().replace(/,/g, '') || 0),
                  sellingUnitPrice: Number(editingBatchData.sellingUnitPrice?.toString().replace(/,/g, '') || 0),
                  wholesalePrice: Number(editingBatchData.wholesalePrice?.toString().replace(/,/g, '') || 0),
                  mfg: editingBatchData.mfg,
                  expiry: editingBatchData.expiry
                }) === JSON.stringify({
                  batchNumber: selectedProduct.batches.find(b => (b.id || b._id) === editingBatchId)?.batchNumber || '',
                  quantity: Number(selectedProduct.batches.find(b => (b.id || b._id) === editingBatchId)?.quantity || 0),
                  costPrice: Number(selectedProduct.batches.find(b => (b.id || b._id) === editingBatchId)?.costPrice || 0),
                  sellingUnitPrice: Number(selectedProduct.batches.find(b => (b.id || b._id) === editingBatchId)?.sellingUnitPrice || 0),
                  wholesalePrice: Number(selectedProduct.batches.find(b => (b.id || b._id) === editingBatchId)?.wholesalePrice || 0),
                  mfg: selectedProduct.batches.find(b => (b.id || b._id) === editingBatchId)?.mfg ? new Date(selectedProduct.batches.find(b => (b.id || b._id) === editingBatchId).mfg).toISOString().split('T')[0] : '',
                  expiry: selectedProduct.batches.find(b => (b.id || b._id) === editingBatchId)?.expiry ? new Date(selectedProduct.batches.find(b => (b.id || b._id) === editingBatchId).expiry).toISOString().split('T')[0] : ''
                })}
                className="w-full py-3.5 rounded-lg font-bold text-sm text-white bg-slate-900 dark:bg-white dark:text-black hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {getTranslation('updateBatch', state.currentLanguage) || 'Update Batch'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add Batch Modal */}
      {showAddBatchModal && typeof document !== 'undefined' && createPortal(
        <div
          className={`fixed inset-0 bg-slate-900/40 z-[100001] flex items-end md:items-center justify-center transition-opacity duration-300 ${isClosingBatchModal ? 'opacity-0' : 'animate-fadeIn'}`}
          onClick={handleCloseBatchModal}
        >
          <style>{`
                @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
                @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
              `}</style>
          <div
            key={isClosingBatchModal ? 'closing' : 'opening'}
            style={{ animation: `${isClosingBatchModal ? 'slideDown' : 'slideUp'} 0.3s ease-out forwards` }}
            className="bg-white dark:bg-black !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-2xl border border-gray-200 dark:border-white/10 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:h-auto m-0"
            data-batch-modal
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10">
              <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight flex items-center gap-2">
                <Plus className="h-5 w-5 text-indigo-600" />
                {getTranslation('addProductBatch', state.currentLanguage)}
              </h3>
              <button onClick={handleCloseBatchModal} className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Product Selection */}
              {!selectedProductForBatch && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('selectProductLabel', state.currentLanguage)}</label>
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder={getTranslation('searchProductPlaceholder', state.currentLanguage)}
                      value={batchSearchTerm}
                      onChange={(e) => {
                        setBatchSearchTerm(e.target.value);
                        handleBatchSearch(e.target.value);
                      }}
                      className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                    />

                    {batchSearchResults.length > 0 && (
                      <div className="border border-gray-200 dark:border-slate-700 rounded-lg max-h-48 overflow-y-auto bg-gray-50/50 dark:bg-slate-800/30">
                        {batchSearchResults.map((product) => (
                          <button
                            key={product.id}
                            onClick={() => handleSelectProductForBatch(product)}
                            className="w-full px-4 py-3 text-left hover:bg-white dark:hover:bg-slate-800 border-b border-gray-100 dark:border-slate-700 last:border-b-0 transition-colors"
                          >
                            <p className="font-bold text-gray-900 dark:text-white text-sm">{product.name}</p>
                            <p className="text-[10px] text-gray-500 dark:text-slate-400 font-medium uppercase tracking-tighter mt-0.5">
                              {getTranslation('stockHeader', state.currentLanguage)}: {(product.batches?.reduce((sum, b) => sum + (b.quantity || 0), 0) || 0) || product.quantity || product.stock || 0} {product.unit || 'pcs'} •
                              Barcode: {product.barcode || 'N/A'}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}

                    {batchSearchTerm.trim() && batchSearchResults.length === 0 && (
                      <div className="p-6 text-center border-2 border-dashed border-gray-100 dark:border-slate-800 rounded-lg">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">{getTranslation('productNotFound', state.currentLanguage)}</p>
                        <button onClick={handleCreateNewProductForBatch} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all">
                          {getTranslation('createNewProduct', state.currentLanguage)}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedProductForBatch && (
                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/30 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-1">{getTranslation('selectedProduct', state.currentLanguage)}</p>
                      <p className="font-bold text-indigo-900 dark:text-indigo-100">{selectedProductForBatch.name}</p>
                      <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase mt-1">
                        {getTranslation('stockHeader', state.currentLanguage)}: {(selectedProductForBatch.batches?.reduce((sum, b) => sum + (b.quantity || 0), 0) || 0) || selectedProductForBatch.quantity || selectedProductForBatch.stock || 0} {selectedProductForBatch.unit}
                      </p>
                    </div>
                    {!selectedProductForBatch.id?.startsWith('preselected_') && (
                      <button onClick={() => { setSelectedProductForBatch(null); setBatchSearchTerm(''); }} className="p-2 text-indigo-400 hover:text-indigo-600 transition-colors">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {selectedProductForBatch && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('quantityLabel', state.currentLanguage)}</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={newBatchData.quantity}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/,/g, '');
                        if (raw === '' || /^[0-9]*\.?[0-9]*$/.test(raw)) {
                          const parts = raw.split('.');
                          if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                          setNewBatchData({ ...newBatchData, quantity: parts.join('.') });
                        }
                      }}
                      className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('costPriceRsLabel', state.currentLanguage)}</label>
                    <div className="relative">
                      <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={newBatchData.costPrice}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, '');
                          if (raw === '' || /^[0-9]*\.?[0-9]*$/.test(raw)) {
                            const parts = raw.split('.');
                            if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                            setNewBatchData({ ...newBatchData, costPrice: parts.join('.') });
                          }
                        }}
                        className="block w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('sellingPriceRsLabel', state.currentLanguage)}</label>
                    <div className="relative">
                      <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={newBatchData.sellingUnitPrice}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, '');
                          if (raw === '' || /^[0-9]*\.?[0-9]*$/.test(raw)) {
                            const parts = raw.split('.');
                            if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                            setNewBatchData({ ...newBatchData, sellingUnitPrice: parts.join('.') });
                          }
                        }}
                        className="block w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('wholesalePrice', state.currentLanguage)}</label>
                    <div className="relative">
                      <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={newBatchData.wholesalePrice}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, '');
                          if (raw === '' || /^[0-9]*\.?[0-9]*$/.test(raw)) {
                            const parts = raw.split('.');
                            if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                            setNewBatchData({ ...newBatchData, wholesalePrice: parts.join('.') });
                          }
                        }}
                        className="block w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                  </div>




                  {selectedProductForBatch.trackExpiry && (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('mfgDateLabel', state.currentLanguage)}</label>
                        <input
                          type="date"
                          value={newBatchData.mfg}
                          onChange={(e) => setNewBatchData({ ...newBatchData, mfg: e.target.value })}
                          className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('expiryDateLabel', state.currentLanguage)}</label>
                        <input
                          type="date"
                          value={newBatchData.expiry}
                          onChange={(e) => setNewBatchData({ ...newBatchData, expiry: e.target.value })}
                          className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-indigo-500 outline-none transition-all"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

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

            {selectedProductForBatch && (
              <div className="p-6 pt-0 pb-8 md:pb-6">
                <button
                  onClick={handleBatchSubmit}
                  disabled={isSubmittingBatch}
                  className="w-full py-3.5 rounded-lg font-bold text-sm text-white dark:text-slate-900 bg-gray-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2"
                >
                  {isSubmittingBatch ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {getTranslation('addBatch', state.currentLanguage)}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Product Batch Details Modal */}
      {showBatchDetailsModal && selectedProduct && typeof document !== 'undefined' && (
        createPortal(
          <div className="fixed inset-0 bg-white dark:bg-slate-800 z-[99999] flex flex-col overflow-hidden animate-fadeIn">
            <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-4 sm:px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                {selectedProduct.name} - {getTranslation('batchDetails', state.currentLanguage)}
              </h3>
              <button
                onClick={() => {
                  setShowBatchDetailsModal(false);
                  setSelectedProduct(null);
                  setSelectedProductId(null);
                }}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 no-scrollbar">
              {/* Product Summary */}
              <div className="bg-gray-50 dark:bg-slate-700/30 rounded-lg p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-slate-400">{getTranslation('totalStock', state.currentLanguage)}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {(() => {
                        const totalBatchStock = selectedProduct.batches?.reduce((sum, batch) => sum + (batch.quantity || 0), 0) || 0;
                        const displayStock = totalBatchStock || selectedProduct.quantity || selectedProduct.stock || 0;
                        return `${displayStock} ${selectedProduct.quantityUnit || selectedProduct.unit || 'pcs'}`;
                      })()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-slate-400">{getTranslation('numBatches', state.currentLanguage)}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {selectedProduct.batches?.length || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-slate-400">{getTranslation('avgPerBatch', state.currentLanguage)}</p>
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
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white">{getTranslation('batchInventory', state.currentLanguage)}</h4>

                {selectedProduct.batches && selectedProduct.batches.length > 0 ? (
                  <>
                    {/* Desktop View (Table) */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                        <thead className="bg-gray-50 dark:bg-slate-700/50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              {getTranslation('batchNumHeader', state.currentLanguage)}
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              {getTranslation('quantityHeader', state.currentLanguage)}
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              {getTranslation('costHeader', state.currentLanguage)}
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              {getTranslation('priceHeader', state.currentLanguage)}
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              {getTranslation('wholesalePrice', state.currentLanguage)}
                            </th>
                            {selectedProduct.trackExpiry && (
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                {getTranslation('mfgDateHeader', state.currentLanguage)}
                              </th>
                            )}
                            {selectedProduct.trackExpiry && (
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                {getTranslation('expiryHeader', state.currentLanguage)}
                              </th>
                            )}
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                              {getTranslation('actionsHeader', state.currentLanguage)}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                          {selectedProduct.batches.map((batch, index) => {
                            return (
                              <tr key={batch.id || index} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                  <div className="flex flex-col gap-1">
                                    <span>
                                      {batch.batchNumber || `${getTranslation('batch', state.currentLanguage)} ${index + 1}`}
                                    </span>
                                    {/* Status Badge */}
                                    {(() => {
                                      const status = getBatchAlertStatus(batch);
                                      if (status === 'critical') {
                                        return (
                                          <span className="inline-flex w-fit items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                                            {getTranslation('expired', state.currentLanguage)}
                                          </span>
                                        );
                                      }
                                      if (status === 'warning') {
                                        return (
                                          <span className="inline-flex w-fit items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                            {getTranslation('expiringSoon', state.currentLanguage)}
                                          </span>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                                  {`${batch.quantity || 0} ${selectedProduct.quantityUnit || selectedProduct.unit || 'pcs'}`}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                                  <span title={formatCurrency(batch.costPrice)}>{formatCurrencySmart(batch.costPrice || 0, state.currencyFormat)}</span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                                  <span title={formatCurrency(batch.sellingUnitPrice)}>{formatCurrencySmart(batch.sellingUnitPrice || 0, state.currencyFormat)}</span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                                  <span title={formatCurrency(batch.wholesalePrice)}>{formatCurrencySmart(batch.wholesalePrice || 0, state.currencyFormat)}</span>
                                </td>
                                {selectedProduct.trackExpiry && (
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                                    {batch.mfg ? formatDate(batch.mfg) : getTranslation('na', state.currentLanguage)}
                                  </td>
                                )}
                                {selectedProduct.trackExpiry && (
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-300">
                                    {batch.expiry ? formatDate(batch.expiry) : getTranslation('na', state.currentLanguage)}
                                  </td>
                                )}
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                  <button
                                    onClick={() => {
                                      if (isPlanExpired(state)) {
                                        if (window.showToast) window.showToast('Plan expired. Upgrade to edit batches.', 'error');
                                        return;
                                      }
                                      handleEditBatch(batch);
                                    }}
                                    disabled={isPlanExpired(state)}
                                    className={`text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 px-3 py-1 rounded-md transition-colors ${isPlanExpired(state) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    title={getTranslation('editBatch', state.currentLanguage)}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>


                    {/* Mobile View (Cards) */}
                    <div className="md:hidden space-y-4">
                      {selectedProduct.batches.map((batch, index) => {
                        return (
                          <div key={batch.id || index} className="bg-gray-50 dark:bg-slate-700/30 border border-gray-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
                            <div className="flex justify-between items-start mb-3">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <h5 className="font-bold text-gray-900 dark:text-white">{batch.batchNumber || `Batch ${index + 1}`}</h5>
                                  {/* Status Badge for Mobile */}
                                  {(() => {
                                    const status = getBatchAlertStatus(batch);
                                    if (status === 'critical') {
                                      return (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                                          {getTranslation('expired', state.currentLanguage)}
                                        </span>
                                      );
                                    }
                                    if (status === 'warning') {
                                      return (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                          {getTranslation('expiringSoon', state.currentLanguage)}
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                                {selectedProduct.trackExpiry && (
                                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                                    Mfg: {batch.mfg ? formatDate(batch.mfg) : 'N/A'} • Exp: {batch.expiry ? formatDate(batch.expiry) : 'N/A'}
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${(batch.quantity || 0) <= 0 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                                  }`}>
                                  {batch.quantity || 0} {selectedProduct.quantityUnit || selectedProduct.unit || 'pcs'}
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                              <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-gray-100 dark:border-slate-700">
                                <p className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('costHeader', state.currentLanguage)}</p>
                                <p className="font-semibold text-gray-900 dark:text-white" title={formatCurrency(batch.costPrice)}>{formatCurrencySmart(batch.costPrice || 0, state.currencyFormat)}</p>
                              </div>
                              <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-gray-100 dark:border-slate-700">
                                <p className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('priceHeader', state.currentLanguage)}</p>
                                <p className="font-semibold text-gray-900 dark:text-white" title={formatCurrency(batch.sellingUnitPrice)}>{formatCurrencySmart(batch.sellingUnitPrice || 0, state.currencyFormat)}</p>
                              </div>
                            </div>

                            <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-slate-700">
                              <button
                                onClick={() => handleEditBatch(batch)}
                                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                              >
                                <Edit className="h-4 w-4" />
                                {getTranslation('editDetails', state.currentLanguage)}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12">
                    <Package className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">{getTranslation('noBatchesFound', state.currentLanguage)}</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                      {getTranslation('noBatchesFoundDesc', state.currentLanguage)}
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
          </div>,
          document.body
        )
      )}

      {/* Batch Creation Prompt Modal */}
      {showBatchPromptModal && promptProduct && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[300] p-4 animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-sm border border-gray-200 dark:border-slate-800 overflow-hidden transform transition-all scale-100">
            <div className="p-6 text-center space-y-4">
              <div className="mx-auto w-12 h-12 bg-indigo-100 dark:bg-indigo-900/40 rounded-full flex items-center justify-center">
                <Layers className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {getTranslation('createBatch', state.currentLanguage)}
                </h3>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  {getTranslation('createBatchPrompt', state.currentLanguage).replace('{name}', promptProduct.name)}
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowBatchPromptModal(false);
                    setPromptProduct(null);
                  }}
                  className="flex-1 py-2.5 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  {getTranslation('skip', state.currentLanguage)}
                </button>
                <button
                  onClick={() => {
                    setShowBatchPromptModal(false);
                    // Open Add Batch Modal for this product
                    setSelectedProductForBatch(promptProduct);
                    setShowAddBatchModal(true);
                    setBatchSearchTerm(promptProduct.name);
                    setBatchSearchResults([]); // Clear any previous search
                    setPromptProduct(null);
                  }}
                  className="flex-1 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                >
                  {getTranslation('createBatch', state.currentLanguage)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBarcodeModal && (
        <Suspense fallback={<ModalLoadingSpinner />}>
          <BarcodePrintModal
            isOpen={showBarcodeModal}
            onClose={() => setShowBarcodeModal(false)}
            products={state.products}
          />
        </Suspense>
      )}

      {showManageCategoriesModal && (
        <Suspense fallback={<ModalLoadingSpinner />}>
          <ManageCategoriesModal
            onClose={() => setShowManageCategoriesModal(false)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default Products;

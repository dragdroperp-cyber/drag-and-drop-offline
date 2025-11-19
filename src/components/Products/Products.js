import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
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
  ChevronsRight
} from 'lucide-react';
import AddProductModal from './AddProductModal';
import EditProductModal from './EditProductModal';
import { getPlanLimits, canAddProduct } from '../../utils/planUtils';
import { getSellerIdFromAuth } from '../../utils/api';
import { updateItem, STORES } from '../../utils/indexedDB';
import { syncData } from '../../utils/api';

const Products = () => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
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
  const exportMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  
  // Scanner input detection refs
  const scannerInputBufferRef = useRef('');
  const scannerInputTimerRef = useRef(null);
  const lastKeyTimeRef = useRef(0);
  const [scannedBarcode, setScannedBarcode] = useState('');

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
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
  
  // Handle scanner input - open add product modal with barcode
  const handleBarcodeScan = (barcode) => {
    console.log('Barcode scanned on Products page:', barcode);
    if (barcode && barcode.trim().length > 0) {
      const trimmedBarcode = barcode.trim();
      
      // Check if barcode already exists
      const existingProduct = state.products.find(p => 
        p.barcode && p.barcode.trim() === trimmedBarcode && !p.isDeleted
      );
      
      if (existingProduct) {
        // Show toast and don't open the form
        const message = state.currentLanguage === 'hi'
          ? `बारकोड "${trimmedBarcode}" पहले से मौजूद है। उत्पाद: "${existingProduct.name}"`
          : `Barcode "${trimmedBarcode}" already exists for product "${existingProduct.name}".`;
        
        if (window.showToast) {
          window.showToast(message, 'error');
        } else {
          alert(message);
        }
        return; // Don't open the form
      }
      
      // Barcode doesn't exist, open the add product modal
      openAddProductModal(trimmedBarcode);
    }
  };
  
  // Auto-detect scanner input when products page is open
  useEffect(() => {
    const handleScannerInput = (e) => {
      // Don't process scanner input if Edit Product modal is open
      // The Edit Product modal will handle scanner input itself
      if (showEditModal) {
        return;
      }
      
      // Ignore if user is typing in an input field
      const target = e.target;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      
      // If typing in input fields, ignore
      if (isInputField) {
        return;
      }
      
      // Check if it's a printable character
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now();
        const timeSinceLastKey = now - lastKeyTimeRef.current;
        
        // If keys are coming very fast (< 100ms apart), it's likely a scanner (increased threshold)
        if (timeSinceLastKey < 100 || scannerInputBufferRef.current.length === 0) {
          scannerInputBufferRef.current += e.key;
          lastKeyTimeRef.current = now;
          
          // Clear existing timer
          if (scannerInputTimerRef.current) {
            clearTimeout(scannerInputTimerRef.current);
          }
          
          // Set timer to process scanner input after a delay (increased to capture complete barcode)
          scannerInputTimerRef.current = setTimeout(() => {
            const scannedCode = scannerInputBufferRef.current.trim();
            if (scannedCode.length > 0) {
              // Open add product modal with scanned barcode
              handleBarcodeScan(scannedCode);
              // Clear buffer
              scannerInputBufferRef.current = '';
            }
          }, 300); // Increased from 100ms to 300ms to ensure complete barcode capture
        } else {
          // Reset if typing is slow (manual typing)
          scannerInputBufferRef.current = '';
        }
      } else if (e.key === 'Enter' && scannerInputBufferRef.current.length > 0) {
        // Enter key pressed with buffer - process scanner input
        e.preventDefault();
        const scannedCode = scannerInputBufferRef.current.trim();
        if (scannedCode.length > 0) {
          handleBarcodeScan(scannedCode);
          scannerInputBufferRef.current = '';
        }
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
    const description = productData.description || productData.name || ''; // Description is required, default to name if missing
    const unit = productData.unit || productData.quantityUnit || 'pcs';
    const costPrice = productData.costPrice !== undefined ? productData.costPrice : (productData.unitPrice || 0);
    const sellingUnitPrice = productData.sellingUnitPrice !== undefined ? productData.sellingUnitPrice : (productData.sellingPrice || 0);

    // Build product object, excluding mfg/expiryDate initially
    const { mfg, mfgDate, expiryDate, ...productDataWithoutDates } = productData;

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
      createdAt: new Date().toISOString(),
      isSynced: false // Explicitly mark as unsynced
    };

    // Only include mfg and expiryDate if they were provided in productData (not empty strings)
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
    setShowAddModal(false);
    setPlanLimitMessage('');
    return true;
  };

  const handleEditProduct = (productData) => {
    dispatch({ type: 'UPDATE_PRODUCT', payload: productData });
    dispatch({ 
      type: 'ADD_ACTIVITY', 
      payload: {
        id: Date.now().toString(),
        message: `Product "${productData.name}" updated`,
        timestamp: new Date().toISOString(),
        type: 'product_updated'
      }
    });
    setShowEditModal(false);
    setSelectedProduct(null);
  };

  const handleDeleteProduct = (productId) => {
    const product = state.products.find(p => p.id === productId);
    if (product) {
      setProductPendingDelete(product);
    }
  };

  const handleEditClick = (product) => {
    setSelectedProduct(product);
    setShowEditModal(true);
  };

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

  const exportProductsCSV = () => {
    try {
      const headers = ['Name', 'Category', 'Unit', 'Stock', 'Cost Price', 'Selling Price', 'Barcode', 'Expiry Date', 'Description'];
      const rows = filteredProducts.map(product => {
        return [
          escapeValue(product.name || ''),
          escapeValue(product.category || ''),
          escapeValue(product.quantityUnit || product.unit || 'pcs'),
          escapeValue(product.quantity || product.stock || 0),
          escapeValue(product.costPrice || 0),
          escapeValue(product.sellingPrice || product.price || 0),
          escapeValue(product.barcode || ''),
          escapeValue(product.expiryDate || '')
        ];
      });

      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      downloadFile(
        `products-${new Date().toISOString().split('T')[0]}.csv`,
        csvContent,
        'text/csv;charset=utf-8;'
      );
      if (window.showToast) {
        window.showToast('Products exported as CSV.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('Error exporting products CSV:', error);
      if (window.showToast) {
        window.showToast('Error exporting CSV. Please try again.', 'error');
      }
    }
  };

  const exportProductsJSON = () => {
    try {
      const data = filteredProducts.map((product) => {
        return {
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
        };
      });

      downloadFile(
        `products-${new Date().toISOString().split('T')[0]}.json`,
        JSON.stringify(data, null, 2),
        'application/json'
      );
      if (window.showToast) {
        window.showToast('Products exported as JSON.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('Error exporting products JSON:', error);
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
      console.error('Error importing products:', error);
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
        console.error('Error parsing file:', error);
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


  const exportProductsPDF = () => {
    try {
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(18);
      pdf.text('Products Report', pageWidth / 2, 15, { align: 'center' });

      pdf.setFontSize(11);
      pdf.text(`${state.currentUser?.shopName || 'Store'}  |  Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 22, { align: 'center' });

      pdf.setDrawColor(230);
      pdf.setFillColor(245, 247, 250);
      pdf.rect(10, 28, pageWidth - 20, 18, 'F');
      pdf.setTextColor(60);
      pdf.setFontSize(10);

      const totalProductsMetric = filteredProducts.length;
      const lowStockMetric = filteredProducts.filter(product => {
        const quantity = product.quantity || product.stock || 0;
        return quantity > 0 && quantity <= state.lowStockThreshold;
      }).length;
      const outOfStockMetric = filteredProducts.filter(product => (product.quantity || product.stock || 0) === 0).length;
      const totalValueMetric = filteredProducts.reduce((sum, product) => {
        const quantity = product.quantity || product.stock || 0;
        const sellingPrice = product.sellingPrice || product.price || product.costPrice || 0;
        return sum + quantity * sellingPrice;
      }, 0);

      pdf.text(`Total Products: ${totalProductsMetric}`, 14, 40);
      pdf.text(`Low Stock: ${lowStockMetric}`, 70, 40);
      pdf.text(`Out of Stock: ${outOfStockMetric}`, 120, 40);
      pdf.text(`Total Value: ₹${totalValueMetric.toFixed(2)}`, 180, 40);

      const headers = ['#', 'Name', 'Category', 'Unit', 'Stock', 'Cost', 'Price', 'Barcode', 'Expiry'];
      const colWidths = [12, 70, 45, 22, 22, 28, 28, 45, 38];
      const columnPadding = 2.5;
      const leftMargin = 12;
      const topMargin = 52;
      const bottomMargin = 16;
      const lineHeight = 4;

      const colPositions = [];
      let currentX = leftMargin;
      headers.forEach((_, idx) => {
        colPositions[idx] = currentX;
        currentX += colWidths[idx];
      });
      const tableWidth = currentX - leftMargin;

      const drawTableHeader = (yPos) => {
        const headerHeight = 8;
        pdf.setFillColor(234, 238, 243);
        pdf.setDrawColor(210);
        pdf.rect(leftMargin, yPos - headerHeight, tableWidth, headerHeight, 'F');
        pdf.setTextColor(30);
        pdf.setFontSize(9.5);
        headers.forEach((header, idx) => {
          const align = idx >= headers.length - 3 ? 'right' : 'left';
          const textX = align === 'right'
            ? colPositions[idx] + colWidths[idx] - columnPadding
            : colPositions[idx] + columnPadding;
          pdf.text(header, textX, yPos - 2, { align });
        });
        pdf.setDrawColor(210);
        headers.forEach((_, idx) => {
          const x = colPositions[idx];
          pdf.line(x, yPos - headerHeight, x, pageHeight - bottomMargin);
        });
        pdf.line(leftMargin + tableWidth, yPos - headerHeight, leftMargin + tableWidth, pageHeight - bottomMargin);
        pdf.line(leftMargin, yPos, leftMargin + tableWidth, yPos);
        return yPos + 2;
      };

      let y = drawTableHeader(topMargin);

      filteredProducts.forEach((product, index) => {
        const quantity = product.quantity || product.stock || 0;
        const costPrice = product.costPrice || 0;
        const sellingPrice = product.sellingPrice || product.price || costPrice;
        const barcode = product.barcode || '—';
        const expiry = product.expiryDate ? new Date(product.expiryDate).toLocaleDateString() : '—';

        const rowValues = [
          index + 1,
          product.name || '',
          product.category || '',
          product.quantityUnit || product.unit || 'pcs',
          quantity,
          `₹${costPrice.toFixed(2)}`,
          `₹${sellingPrice.toFixed(2)}`,
          barcode,
          expiry
        ];

        const cellLines = rowValues.map((value, idx) => {
          let raw = typeof value === 'string' ? value : String(value);
          const maxWidth = colWidths[idx] - columnPadding * 2;
          const wrapped = pdf.splitTextToSize(raw, maxWidth);
          return wrapped.length ? wrapped : [''];
        });

        const rowLineCount = Math.max(...cellLines.map(lines => lines.length));
        const rowHeight = rowLineCount * lineHeight + columnPadding;

        if (y + rowHeight > pageHeight - bottomMargin) {
          pdf.addPage();
          y = drawTableHeader(topMargin);
        }

        const isAltRow = index % 2 === 1;
        const baseFill = isAltRow ? { r: 247, g: 249, b: 252 } : { r: 255, g: 255, b: 255 };
        pdf.setFillColor(baseFill.r, baseFill.g, baseFill.b);
        pdf.rect(leftMargin, y - lineHeight + 1, tableWidth, rowHeight, 'F');

        pdf.setDrawColor(220);
        headers.forEach((_, idx) => {
          const x = colPositions[idx];
          pdf.line(x, y - lineHeight + 1, x, y - lineHeight + 1 + rowHeight);
        });
        pdf.line(leftMargin + tableWidth, y - lineHeight + 1, leftMargin + tableWidth, y - lineHeight + 1 + rowHeight);
        pdf.line(leftMargin, y - lineHeight + 1 + rowHeight, leftMargin + tableWidth, y - lineHeight + 1 + rowHeight);

        pdf.setTextColor(40);
        pdf.setFontSize(8.5);
        cellLines.forEach((lines, idx) => {
          const align = idx >= headers.length - 3 ? 'right' : 'left';
          lines.forEach((line, lineIdx) => {
            const offsetY = y + lineIdx * lineHeight;
            const textX = align === 'right'
              ? colPositions[idx] + colWidths[idx] - columnPadding
              : colPositions[idx] + columnPadding;
            pdf.text(line, textX, offsetY, { align });
          });
        });

        y += rowHeight;
      });

      const pageCount = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(120);
        pdf.text(`Page ${i} of ${pageCount}`, 12, pageHeight - 8);
        pdf.text(`${state.currentUser?.shopName || 'Store'} • Products Report`, pageWidth - 12, pageHeight - 8, { align: 'right' });
      }

      pdf.save(`products-report-${new Date().toISOString().split('T')[0]}.pdf`);
      if (window.showToast) {
        window.showToast('Products exported as PDF.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('Error exporting products PDF:', error);
      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 pb-6">
      {/* Header */}
      <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Products</h2>
          <p className="text-sm text-gray-600">
            Manage your product inventory
            <span className="ml-2 text-blue-600 font-medium">
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
            className="btn-secondary flex items-center text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50"
            title={state.systemStatus === 'offline' || !navigator.onLine ? 'Import is not available offline' : 'Import products from file'}
          >
            <Upload className="h-4 w-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Import</span>
            <span className="sm:hidden">Import</span>
          </button>
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="btn-secondary flex items-center text-sm"
            >
              <Download className="h-4 w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Export</span>
              <span className="sm:hidden">Export</span>
            </button>
            {showExportMenu && (
              <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-48 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-gray-200 z-50 py-2">
                <button
                  onClick={exportProductsPDF}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 active:bg-gray-100 transition-colors flex items-center gap-3"
                >
                  <FileText className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <span className="truncate">Export as PDF</span>
                </button>
                <button
                  onClick={exportProductsJSON}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 active:bg-gray-100 transition-colors flex items-center gap-3"
                >
                  <FileJson className="h-4 w-4 text-yellow-600 flex-shrink-0" />
                  <span className="truncate">Export as JSON</span>
                </button>
                <button
                  onClick={exportProductsCSV}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 active:bg-gray-100 transition-colors flex items-center gap-3"
                >
                  <FileSpreadsheet className="h-4 w-4 text-green-600 flex-shrink-0" />
                  <span className="truncate">Export as CSV</span>
                </button>
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

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center">
            <div className="p-2 sm:p-3 bg-blue-100 rounded-lg">
              <Package className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
            </div>
            <div className="ml-3 sm:ml-4">
              <p className="text-xs sm:text-sm font-medium text-gray-600">Total Products</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{totalProducts}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 sm:p-3 bg-red-100 rounded-lg">
              <AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6 text-red-600" />
            </div>
            <div className="ml-3 sm:ml-4">
              <p className="text-xs sm:text-sm font-medium text-gray-600">Low Stock</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{lowStockProducts}</p>
            </div>
          </div>
        </div>

      <div className="card">
        <div className="flex items-center">
          <div className="p-2 sm:p-3 bg-yellow-100 rounded-lg">
            <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-600" />
          </div>
          <div className="ml-3 sm:ml-4">
            <p className="text-xs sm:text-sm font-medium text-gray-600">Expiring Soon</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900">{expiringProducts}</p>
          </div>
        </div>
      </div>
    </div>

    {/* Search */}
    <div className="card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-lg">
          <input
            type="text"
            placeholder="Search by name, category, or barcode"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-700 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 transition"
          />
        </div>
        
        <div className="w-full sm:w-60">
          <select
            value={selectedCategoryFilter}
            onChange={(e) => {
              setSelectedCategoryFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-700 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 transition"
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
      <div className="card hidden md:block">
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Barcode</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expiry</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedProducts.map((product) => (
                <tr key={product.id} className="hover:bg-gray-50">
                  <td className="px-4 sm:px-6 py-4" style={{ maxWidth: '300px' }}>
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10">
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            className="h-10 w-10 rounded-lg object-cover border border-gray-200"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              e.currentTarget.nextSibling.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div 
                          className={`h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center ${product.imageUrl ? 'hidden' : 'flex'}`}
                        >
                          <Package className="h-5 w-5 text-blue-600" />
                        </div>
                      </div>
                      <div className="ml-4 min-w-0 flex-1 overflow-hidden">
                        <div className="text-sm font-medium text-gray-900 break-words line-clamp-2" title={product.name}>{product.name}</div>
                        <div className="text-sm text-gray-500 break-words line-clamp-2" title={product.description || 'No description'}>{product.description || 'No description'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800 max-w-[150px] truncate" title={product.category || 'Uncategorized'}>
                      {product.category || 'Uncategorized'}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {product.quantityUnit || product.unit || 'pcs'}
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      (product.quantity || product.stock || 0) <= state.lowStockThreshold 
                        ? 'bg-red-100 text-red-800' 
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {product.quantity || product.stock || 0}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span className="truncate block max-w-[120px]" title={product.barcode || 'N/A'}>{product.barcode || 'N/A'}</span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {product.expiryDate ? new Date(product.expiryDate).toLocaleDateString() : 'N/A'}
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleEditClick(product)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteProduct(product.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 px-4 py-4 bg-gray-50 rounded-xl border border-gray-200">
            <div className="text-sm text-gray-700">
              Showing <span className="font-semibold">{startIndex + 1}</span> to <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredProducts.length)}</span> of <span className="font-semibold">{filteredProducts.length}</span> {filteredProducts.length === 1 ? 'result' : 'results'}
            </div>
            <div className="flex items-center gap-1">
              {/* First Page Button */}
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="First page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
              
              {/* Previous Page Button */}
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              
              {/* Page Number Buttons */}
              <div className="flex items-center gap-1 mx-2">
                {getPageNumbers().map((page, index) => {
                  if (page === 'ellipsis') {
                    return (
                      <span key={`ellipsis-${index}`} className="px-2 text-gray-500">
                        ...
                      </span>
                    );
                  }
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`min-w-[36px] px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                        currentPage === page
                          ? 'bg-[#2f3c7e] text-white shadow-sm'
                          : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
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
                className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              
              {/* Last Page Button */}
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          <div key={product.id} className="card" style={{ maxWidth: '100%', overflow: 'hidden' }}>
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3 flex-1 min-w-0">
                <div className="flex-shrink-0 h-12 w-12">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="h-12 w-12 rounded-lg object-cover border border-gray-200"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div 
                    className={`h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center ${product.imageUrl ? 'hidden' : 'flex'}`}
                  >
                    <Package className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="text-sm font-medium text-gray-900 break-words line-clamp-2" title={product.name}>{product.name}</div>
                  <div className="text-xs text-gray-500 line-clamp-2 break-words" title={product.description || 'No description'}>{product.description || 'No description'}</div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 truncate max-w-[150px]" title={product.category || 'Uncategorized'}>
                      {product.category || 'Uncategorized'}
                    </span>
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">
                      {product.quantityUnit || product.unit || 'pcs'}
                    </span>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      (product.quantity || product.stock || 0) <= state.lowStockThreshold 
                        ? 'bg-red-100 text-red-800' 
                        : 'bg-green-100 text-green-800'
                    }`}>
                      Quantity: {product.quantity || product.stock || 0}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-600">
                    <div>Barcode: {product.barcode || 'N/A'}</div>
                    <div>Expiry: {product.expiryDate ? new Date(product.expiryDate).toLocaleDateString() : 'N/A'}</div>
                  </div>
                </div>
              </div>
              <div className="flex flex-col space-y-2 ml-2">
                <button
                  onClick={() => handleEditClick(product)}
                  className="p-2 text-blue-600 hover:text-blue-900 hover:bg-blue-50 rounded-lg transition"
                >
                  <Edit className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDeleteProduct(product.id)}
                  className="p-2 text-red-600 hover:text-red-900 hover:bg-red-50 rounded-lg transition"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* Pagination - Mobile */}
        {totalPages > 1 && (
          <div className="flex flex-col items-center justify-between gap-4 pt-4 px-4 py-4 bg-gray-50 rounded-xl border border-gray-200">
            <div className="text-sm text-gray-700 text-center">
              Showing <span className="font-semibold">{startIndex + 1}</span> to <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredProducts.length)}</span> of <span className="font-semibold">{filteredProducts.length}</span> {filteredProducts.length === 1 ? 'result' : 'results'}
            </div>
            <div className="flex items-center gap-1 w-full">
              {/* First Page Button */}
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="First page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
              
              {/* Previous Page Button */}
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              
              {/* Page Number Buttons - Scrollable on mobile */}
              <div className="flex items-center gap-1 mx-2 flex-1 justify-center overflow-x-auto">
                {getPageNumbers().map((page, index) => {
                  if (page === 'ellipsis') {
                    return (
                      <span key={`ellipsis-${index}`} className="px-2 text-gray-500">
                        ...
                      </span>
                    );
                  }
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`min-w-[36px] px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                        currentPage === page
                          ? 'bg-[#2f3c7e] text-white shadow-sm'
                          : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
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
                className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              
              {/* Last Page Button */}
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Last page"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
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

      {productPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white border border-slate-200 shadow-[0_32px_80px_-40px_rgba(15,23,42,0.55)] p-6 space-y-4">
            <div className="space-y-2 text-center">
              <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
              <h3 className="text-lg font-semibold text-slate-900">Delete product?</h3>
              <p className="text-sm text-slate-600">
                Removing <span className="font-semibold">{productPendingDelete.name}</span> will delete all related inventory details.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-end sm:gap-3 gap-2">
              <button
                type="button"
                onClick={() => setProductPendingDelete(null)}
                className="btn-secondary w-full sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
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
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
              <h3 className="text-xl font-semibold text-gray-900">Import Products</h3>
              <button
                onClick={handleCancelImport}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select File (CSV or JSON)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
                <p className="mt-2 text-xs text-gray-500">
                  CSV format: Name, Category, Unit, Stock, Cost Price, Selling Price, Barcode, Expiry Date, Description
                </p>
                <p className="text-xs text-gray-500">
                  JSON format: Array of objects with product fields
                </p>
              </div>

              {importFile && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-gray-700">Selected file:</p>
                  <p className="text-sm text-gray-600">{importFile.name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Size: {(importFile.size / 1024).toFixed(2)} KB
                  </p>
                  {parsedProducts.length > 0 && (
                    <p className="text-xs text-gray-600 mt-2">
                      Products found: {parsedProducts.length}
                    </p>
                  )}
                </div>
              )}

              {/* Limit Exceeded Warning */}
              {importLimitExceeded && limitExceededInfo && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-orange-900 mb-2">
                        Product Limit Exceeded
                      </h4>
                      <p className="text-xs text-orange-800 mb-3">
                        You are trying to import <strong>{limitExceededInfo.productsToImport} products</strong>, but your current plan allows only <strong>{limitExceededInfo.maxProducts} products</strong>.
                        <br />
                        You currently have <strong>{limitExceededInfo.currentProducts} products</strong> and can add <strong>{limitExceededInfo.availableSlots} more</strong>.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2 mt-4">
                        <button
                          onClick={handleCancelImport}
                          className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors text-sm"
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
                    <span className="text-gray-700">Progress:</span>
                    <span className="text-gray-600">
                      {importProgress.processed} / {importProgress.total}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${(importProgress.processed / importProgress.total) * 100}%`
                      }}
                    />
                  </div>
                  {importProgress.success > 0 && (
                    <p className="text-sm text-green-600">
                      ✓ Successfully imported: {importProgress.success}
                    </p>
                  )}
                  {importProgress.errors.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-y-auto">
                      <p className="text-sm font-medium text-red-600 mb-1">Errors:</p>
                      <ul className="text-xs text-red-600 space-y-1">
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
                    className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
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

    </div>
  );
};

export default Products;

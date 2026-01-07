import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp, isPlanExpired, triggerSyncStatusUpdate } from '../../context/AppContext';
import { apiRequest } from '../../utils/api';
import { addToSyncQueue } from '../../utils/dataFetcher';
import syncService from '../../services/syncService';
import {
  X,
  Plus,
  Package,
  Truck,
  Calendar,
  User,
  Save,
  AlertCircle,
  Trash2,
  Minus
} from 'lucide-react';
import { formatCurrency, formatCurrencyCompact, formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';
import AddProductModal from '../Products/AddProductModal';
import { ActionTypes } from '../../context/AppContext';


const AddPurchaseOrderModal = ({ isOpen, onClose, onSave }) => {
  const { state, dispatch } = useApp();

  // Load saved draft if available
  const loadSavedPurchaseOrderData = () => {
    try {
      const saved = localStorage.getItem('addPurchaseOrder_saved');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      localStorage.removeItem('addPurchaseOrder_saved');
    }
    return {
      supplierName: '',
      orderDate: new Date().toISOString().split('T')[0],
      notes: '',
      status: 'pending',
      batchEntries: [{
        productId: '',
        productName: '',
        quantity: '',
        costPrice: '',
        sellingUnitPrice: '',
        expiry: '',
        mfg: '',
        trackExpiry: false
      }]
    };
  };

  const initialData = loadSavedPurchaseOrderData();

  // Form state
  const [supplierName, setSupplierName] = useState(initialData.supplierName);
  const [orderDate, setOrderDate] = useState(initialData.orderDate);
  const [notes, setNotes] = useState(initialData.notes);
  const [status, setStatus] = useState(initialData.status);

  // Batch management state - now using array of batch entries
  const [batchEntries, setBatchEntries] = useState(initialData.batchEntries);

  // State for adding new product from modal
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [activeBatchEntryIndex, setActiveBatchEntryIndex] = useState(null);


  // Loading and error states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      const saved = localStorage.getItem('addPurchaseOrder_saved');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setSupplierName(parsed.supplierName);
          setOrderDate(parsed.orderDate);
          setNotes(parsed.notes);
          setStatus(parsed.status);
          setBatchEntries(parsed.batchEntries);
        } catch (e) {
          localStorage.removeItem('addPurchaseOrder_saved');
        }
      } else {
        setSupplierName('');
        setOrderDate(new Date().toISOString().split('T')[0]);
        setNotes('');
        setStatus('pending');
        setBatchEntries([
          {
            productId: '',
            productName: '',
            quantity: '',
            costPrice: '',
            sellingUnitPrice: '',
            expiry: '',
            mfg: '',
            trackExpiry: false
          }
        ]);
      }
      setError('');
    }
  }, [isOpen]);

  // Calculate totals
  const calculateTotals = () => {
    let totalQuantity = 0;
    let totalCostValue = 0;
    let totalSellingValue = 0;
    let totalProfit = 0;

    batchEntries.forEach(entry => {
      const quantity = parseFloat((entry.quantity || 0).toString().replace(/,/g, '')) || 0;
      const costPrice = parseFloat((entry.costPrice || 0).toString().replace(/,/g, '')) || 0;
      const sellingPrice = parseFloat((entry.sellingUnitPrice || 0).toString().replace(/,/g, '')) || 0;

      if (quantity > 0 && entry.productName) {
        totalQuantity += quantity;
        totalCostValue += quantity * costPrice;
        totalSellingValue += quantity * sellingPrice;
        totalProfit += quantity * (sellingPrice - costPrice);
      }
    });

    return {
      totalQuantity,
      totalCostValue,
      totalSellingValue,
      totalProfit
    };
  };

  const { totalQuantity, totalCostValue, totalSellingValue, totalProfit } = calculateTotals();

  // Handle batch entry changes
  const handleBatchEntryChange = (index, field, value) => {
    setBatchEntries(prev => {
      const newEntries = [...prev];
      newEntries[index] = { ...newEntries[index], [field]: value };

      // Auto-fill product details when product is selected
      if (field === 'productId' && value) {
        const product = state.products.find(p => p.id === value || p._id === value);
        if (product) {
          newEntries[index].productName = product.name;
        }
      }

      return newEntries;
    });
  };

  // Open add product modal
  const handleOpenAddProductModal = (index) => {
    setActiveBatchEntryIndex(index);
    setIsAddProductModalOpen(true);
  };

  // Handle saving new product from modal
  const handleSaveNewProduct = async (productData) => {
    try {
      setLoading(true);
      const { addItem, STORES } = await import('../../utils/indexedDB');

      // Prepare new product object
      const newProduct = {
        ...productData,
        id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sellerId: state.user?.sellerId || state.user?.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isSynced: false,
        quantity: 0, // Initial quantity
        stock: 0
      };

      // Ensure _id is set for consistency
      newProduct._id = newProduct.id;

      // Save to IndexedDB
      await addItem(STORES.products, newProduct);

      // Add to context state
      dispatch({ type: ActionTypes.ADD_PRODUCT, payload: newProduct });

      // Add to sync queue
      await addToSyncQueue('product_create', {
        id: newProduct.id,
        ...newProduct
      });

      // Update the active batch entry with the new product
      if (activeBatchEntryIndex !== null) {
        setBatchEntries(prev => {
          const newEntries = [...prev];
          newEntries[activeBatchEntryIndex] = {
            ...newEntries[activeBatchEntryIndex],
            productId: newProduct.id,
            productName: newProduct.name
          };
          return newEntries;
        });
      }

      // Close modal
      setIsAddProductModalOpen(false);
      setActiveBatchEntryIndex(null);

      if (window.showToast) {
        window.showToast(getTranslation('productCreatedSuccess', state.currentLanguage) || 'Product created successfully', 'success');
      }

    } catch (err) {
      console.error('Failed to create product:', err);
      if (window.showToast) {
        window.showToast('Failed to create product', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // Add new batch entry row

  // Add new batch entry row - adds to TOP of list
  const addBatchEntry = () => {
    setBatchEntries(prev => [{
      productId: '',
      productName: '',
      quantity: '',
      costPrice: '',
      sellingUnitPrice: '',
      expiry: '',
      mfg: '',
      trackExpiry: false
    }, ...prev]);
  };

  // Remove batch entry row
  const removeBatchEntry = (index) => {
    if (batchEntries.length > 1) {
      setBatchEntries(prev => prev.filter((_, i) => i !== index));
    }
  };

  // Validate form
  const validateForm = () => {
    if (!supplierName.trim()) {
      setError(getTranslation('supplierNameRequired', state.currentLanguage));
      return false;
    }

    // Check if at least one batch entry has valid data
    const validEntries = batchEntries.filter(entry =>
      entry.productName && entry.quantity && parseFloat(entry.quantity.toString().replace(/,/g, '')) > 0
    );

    if (validEntries.length === 0) {
      setError(getTranslation('addAtLeastOneBatch', state.currentLanguage));
      return false;
    }

    // Validate each entry
    for (let i = 0; i < batchEntries.length; i++) {
      const entry = batchEntries[i];
      if (entry.productName || entry.quantity || entry.costPrice) {
        // If any field is filled, all required fields must be filled
        if (!entry.productName) {
          setError(`${getTranslation('entry', state.currentLanguage) || 'Entry'} ${i + 1}: ${getTranslation('entryProductRequired', state.currentLanguage)}`);
          return false;
        }
        if (!entry.quantity || parseFloat(entry.quantity.toString().replace(/,/g, '')) <= 0) {
          setError(`${getTranslation('entry', state.currentLanguage) || 'Entry'} ${i + 1}: ${getTranslation('validQuantityRequired', state.currentLanguage)}`);
          return false;
        }
        if (!entry.costPrice || parseFloat(entry.costPrice.toString().replace(/,/g, '')) < 0) {
          setError(`${getTranslation('entry', state.currentLanguage) || 'Entry'} ${i + 1}: ${getTranslation('validCostPriceRequired', state.currentLanguage)}`);
          return false;
        }
        if (!entry.sellingUnitPrice || parseFloat(entry.sellingUnitPrice.toString().replace(/,/g, '')) < 0) {
          setError(`${getTranslation('entry', state.currentLanguage) || 'Entry'} ${i + 1}: ${getTranslation('validSellingPriceRequired', state.currentLanguage)}`);
          return false;
        }
      }
    }

    return true;
  };

  // Submit purchase order
  // Create batches for purchase order
  const createBatchesForPurchaseOrder = async (order) => {
    try {
      const { addItem, updateItem, STORES } = await import('../../utils/indexedDB');
      const { addToSyncQueue } = await import('../../utils/dataFetcher');

      for (const batchData of order.batches) {
        // Find the product - get it from state since we don't have access to state here
        // We'll need to get products from somewhere
        const product = state.products.find(p =>
          p.id === batchData.productId ||
          p._id === batchData.productId ||
          p.name === batchData.productName
        );

        if (!product) {

          continue;
        }

        // Use MongoDB ObjectId if available, otherwise use frontend ID
        // This ensures batches can be synced even if products aren't synced yet
        const mongoProductId = product._id || product.id;

        // Create new batch object with all required fields for MongoDB
        const newBatch = {
          id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          _id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          productId: mongoProductId,
          batchNumber: batchData.batchNumber || '',
          quantity: batchData.quantity,
          costPrice: batchData.costPrice,
          sellingUnitPrice: batchData.sellingUnitPrice,
          // MongoDB requires mfg and expiry dates - ensure they're valid ISO strings
          mfg: batchData.mfg ? new Date(batchData.mfg).toISOString() : new Date().toISOString(),
          expiry: batchData.expiry ? new Date(batchData.expiry).toISOString() : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year from now if not provided
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

        // Update product with new batch
        const existingBatches = product.batches || [];
        const updatedBatches = [...existingBatches, newBatch];

        const updatedProduct = {
          ...product,
          batches: updatedBatches,
          // Update total quantity
          quantity: (product.quantity || 0) + batchData.quantity,
          stock: (product.stock || 0) + batchData.quantity,
          // Preserve isSynced status (don't mark as unsynced for batch updates)
          isSynced: product.isSynced,
          lastModified: new Date().toISOString()
        };

        // Save updated product to IndexedDB
        await updateItem(STORES.products, updatedProduct);

        // Update UI state
        dispatch({ type: 'UPDATE_PRODUCT', payload: { ...updatedProduct, isBatchUpdate: true } });

        // Add batch creation to sync queue
        await addToSyncQueue('batch_create_from_po', {
          batchId: newBatch.id,
          productId: product.id,
          batchData: newBatch,
          purchaseOrderId: order.id,
          timestamp: new Date().toISOString()
        });

      }

    } catch (error) {

    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to create purchase orders.', 'warning', 8000);
      }
      return;
    }

    if (!validateForm()) return;

    setLoading(true);
    setError('');

    try {
      // Create purchase order data from batch entries
      const validEntries = batchEntries.filter(entry =>
        entry.productName && entry.quantity && parseFloat(entry.quantity.toString().replace(/,/g, '')) > 0
      );

      // Create items array for backward compatibility with existing validation
      const items = validEntries.map(entry => ({
        productId: entry.productId,
        productName: entry.productName,
        quantity: parseFloat(entry.quantity.toString().replace(/,/g, '')),
        price: parseFloat(entry.costPrice.toString().replace(/,/g, '')), // Use cost price as the item price for validation
        unit: 'pcs', // Default unit, can be enhanced later
        subtotal: parseFloat(entry.quantity.toString().replace(/,/g, '')) * parseFloat(entry.costPrice.toString().replace(/,/g, ''))
      }));

      const orderData = {
        supplierName: supplierName.trim(),
        orderDate,
        status,
        notes: notes.trim(),
        items, // For backward compatibility with existing validation
        batches: validEntries.map(entry => ({
          productId: entry.productId,
          productName: entry.productName,
          batchNumber: `Batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          quantity: parseFloat(entry.quantity.toString().replace(/,/g, '')),
          costPrice: parseFloat(entry.costPrice.toString().replace(/,/g, '')),
          sellingUnitPrice: parseFloat(entry.sellingUnitPrice.toString().replace(/,/g, '')),
          expiry: entry.trackExpiry ? (entry.expiry || null) : null,
          mfg: entry.trackExpiry ? (entry.mfg || null) : null
        })),
        totalQuantity,
        totalCostValue,
        totalSellingValue,
        totalProfit,
        status, // Use the selected status from the form
        isSynced: false, // Mark as not synced for offline-first approach
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      };

      // Generate a unique ID for the purchase order
      const orderId = `PO_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      orderData.id = orderId;
      orderData._id = orderId;

      console.log('📦 Creating purchase order (offline-first):', {
        ...orderData,
        batches: orderData.batches, // Log batches specifically
        status: orderData.status // Log status specifically
      });

      // STEP 1: Save to IndexedDB FIRST (offline-first approach)
      const { addItem, STORES } = await import('../../utils/indexedDB');
      await addItem(STORES.purchaseOrders, orderData);

      // STEP 2: Update UI immediately
      dispatch({ type: 'ADD_PURCHASE_ORDER', payload: orderData });

      // STEP 3: Create batches only if order status is not pending
      if (status !== 'pending') {

        await createBatchesForPurchaseOrder(orderData);
      } else {

      }

      // STEP 4: Add to sync queue for background sync

      await addToSyncQueue('purchase_order_create', {
        orderId,
        orderData,
        timestamp: new Date().toISOString()
      });

      // STEP 4: Attempt background sync if online
      try {
        // Trigger instant sync status update
        triggerSyncStatusUpdate();

        if (syncService.isOnline()) {
          syncService.scheduleSync();
        }
      } catch (syncError) {
        // Ignore sync errors for offline mode
      }

      // Show success message
      if (window.showToast) {
        window.showToast(getTranslation('poCreatedLocally', state.currentLanguage) || 'Purchase order created locally! Syncing to server...', 'success');
      }

      // Reset form and close modal
      localStorage.removeItem('addPurchaseOrder_saved');
      onSave(orderData);
      onClose();

    } catch (error) {

      setError(getTranslation('failedToCreatePO', state.currentLanguage) || 'Failed to create purchase order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-white dark:bg-slate-800 z-[99999] flex flex-col overflow-hidden animate-fadeIn">
      <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-4 sm:px-6 py-4 flex items-center justify-between z-10 flex-shrink-0">
        <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
          {getTranslation('createPurchaseOrder', state.currentLanguage)}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (supplierName && supplierName.trim()) {
                const dataToSave = {
                  supplierName,
                  orderDate,
                  notes,
                  status,
                  batchEntries
                };
                localStorage.setItem('addPurchaseOrder_saved', JSON.stringify(dataToSave));
                if (window.showToast) window.showToast('Draft saved', 'info');
              }
              onClose();
            }}
            className="p-2 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
            title="Save draft & Minimize"
          >
            <Minus className="h-6 w-6" />
          </button>
          <button
            onClick={() => {
              localStorage.removeItem('addPurchaseOrder_saved');
              onClose();
            }}
            className="p-2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-6">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg p-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
              <p className="text-red-700 dark:text-red-300 text-sm font-medium">{error}</p>
            </div>
          )}

          {/* Basic Order Information */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                {getTranslation('supplierName', state.currentLanguage)} *
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
                <input
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white transition-all"
                  placeholder={getTranslation('supplierPlaceholder', state.currentLanguage)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                {getTranslation('date', state.currentLanguage)} *
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
                <input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white transition-all"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                {getTranslation('status', state.currentLanguage)}
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-4 py-3 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white transition-all"
              >
                <option value="pending">{getTranslation('pendingOrders', state.currentLanguage)}</option>
                <option value="completed">{getTranslation('completedOrders', state.currentLanguage)}</option>
                <option value="cancelled">{getTranslation('cancelledOrders', state.currentLanguage)}</option>
              </select>
            </div>
          </div>

          {/* Batch Entry Table */}
          <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
            <div className="bg-gray-50 dark:bg-slate-700/50 px-6 py-4 border-b border-gray-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Package className="h-5 w-5 text-slate-900 dark:text-slate-100" />
                  {getTranslation('batchEntries', state.currentLanguage)}
                </h4>
                <button
                  type="button"
                  onClick={addBatchEntry}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-slate-900 rounded-lg transition-all text-sm font-semibold active:scale-95 shadow-md shadow-slate-900/20"
                >
                  <Plus className="h-4 w-4" />
                  {getTranslation('addRow', state.currentLanguage)}
                </button>
              </div>
            </div>

            {/* Desktop View - Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-700/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                      {getTranslation('productHeader', state.currentLanguage)}
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                      {getTranslation('expiryHeader', state.currentLanguage)}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                      {getTranslation('qtyHeader', state.currentLanguage)}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                      {getTranslation('costHeader', state.currentLanguage)}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                      {getTranslation('priceHeader', state.currentLanguage)}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                      {getTranslation('mfg', state.currentLanguage)}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                      {getTranslation('expiry', state.currentLanguage)}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                      {getTranslation('expProfit', state.currentLanguage) || getTranslation('profit', state.currentLanguage)}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                      {getTranslation('actionsHeader', state.currentLanguage)}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                  {batchEntries.map((entry, index) => (
                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <select

                            value={entry.productId}
                            onChange={(e) => handleBatchEntryChange(index, 'productId', e.target.value)}
                            className="w-full min-w-[180px] px-3 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm"
                          >
                            <option value="">{getTranslation('selectProductLabel', state.currentLanguage)}</option>
                            {state.products.map(product => (
                              <option key={product.id || product._id} value={product.id || product._id}>
                                {product.name} {product.barcode ? `(${product.barcode})` : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleOpenAddProductModal(index)}
                            className="p-2 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg transition-colors ml-2"
                            title={getTranslation('addNewProduct', state.currentLanguage)}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>

                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={entry.trackExpiry}
                              onChange={(e) => handleBatchEntryChange(index, 'trackExpiry', e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-gray-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate-900"></div>
                          </label>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="text"
                          value={entry.quantity}
                          onChange={(e) => {
                            const rawValue = e.target.value.replace(/,/g, '');
                            if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                              const parts = rawValue.split('.');
                              if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                              handleBatchEntryChange(index, 'quantity', parts.join('.'));
                            }
                          }}
                          inputMode="decimal"
                          className="w-20 px-3 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm text-center"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="text"
                          value={entry.costPrice}
                          onChange={(e) => {
                            const rawValue = e.target.value.replace(/,/g, '');
                            if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                              const parts = rawValue.split('.');
                              if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                              handleBatchEntryChange(index, 'costPrice', parts.join('.'));
                            }
                          }}
                          inputMode="decimal"
                          className="w-24 px-3 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm text-center"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="text"
                          value={entry.sellingUnitPrice}
                          onChange={(e) => {
                            const rawValue = e.target.value.replace(/,/g, '');
                            if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                              const parts = rawValue.split('.');
                              if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                              handleBatchEntryChange(index, 'sellingUnitPrice', parts.join('.'));
                            }
                          }}
                          inputMode="decimal"
                          className="w-24 px-3 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm text-center"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-6 py-4">
                        {entry.trackExpiry ? (
                          <input
                            type="date"
                            value={entry.mfg}
                            onChange={(e) => handleBatchEntryChange(index, 'mfg', e.target.value)}
                            className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm"
                          />
                        ) : (
                          <span className="text-gray-400 dark:text-slate-500 text-xs italic">N/A</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {entry.trackExpiry ? (
                          <input
                            type="date"
                            value={entry.expiry}
                            onChange={(e) => handleBatchEntryChange(index, 'expiry', e.target.value)}
                            className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm"
                          />
                        ) : (
                          <span className="text-gray-400 dark:text-slate-500 text-xs italic">N/A</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className={`font-bold text-sm break-all ${(Number(entry.sellingUnitPrice) || 0) - (Number(entry.costPrice) || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} title={formatCurrency(((Number(entry.quantity) || 0) * ((Number(entry.sellingUnitPrice) || 0) - (Number(entry.costPrice) || 0))))}>
                          {formatCurrencySmart(((Number(entry.quantity) || 0) * ((Number(entry.sellingUnitPrice) || 0) - (Number(entry.costPrice) || 0))), state.currencyFormat)}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {batchEntries.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeBatchEntry(index)}
                            className="p-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                            title="Remove this batch entry"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile View - Cards */}
            <div className="md:hidden divide-y divide-gray-200 dark:divide-slate-700">
              {batchEntries.map((entry, index) => (
                <div key={index} className="p-4 space-y-4 bg-white dark:bg-slate-800">
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase mb-1">{getTranslation('product', state.currentLanguage)}</label>
                      <div className="flex items-center gap-2">
                        <select
                          value={entry.productId}

                          onChange={(e) => handleBatchEntryChange(index, 'productId', e.target.value)}
                          className="w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm"
                        >
                          <option value="">{getTranslation('selectProductLabel', state.currentLanguage)}</option>
                          {state.products.map(product => (
                            <option key={product.id || product._id} value={product.id || product._id}>
                              {product.name} {product.barcode ? `(${product.barcode})` : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleOpenAddProductModal(index)}
                          className="p-2.5 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg transition-colors flex-shrink-0"
                          title={getTranslation('addNewProduct', state.currentLanguage)}
                        >
                          <Plus className="h-5 w-5" />
                        </button>
                      </div>
                    </div>

                    {batchEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeBatchEntry(index)}
                        className="mt-6 p-2.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-lg transition-colors border border-red-100 dark:border-red-900/30"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase mb-1">{getTranslation('quantity', state.currentLanguage)}</label>
                      <input
                        type="text"
                        value={entry.quantity}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/,/g, '');
                          if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                            const parts = rawValue.split('.');
                            if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                            handleBatchEntryChange(index, 'quantity', parts.join('.'));
                          }
                        }}
                        inputMode="decimal"
                        className="w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm"
                        placeholder="0"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="block text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase mb-1">{getTranslation('trackExpiry', state.currentLanguage)}</label>
                      <div className="flex-1 flex items-center h-full">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={entry.trackExpiry}
                            onChange={(e) => handleBatchEntryChange(index, 'trackExpiry', e.target.checked)}
                          />
                          <div className="w-11 h-6 bg-gray-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-900"></div>
                        </label>
                        <span className="ml-3 text-sm text-gray-600 dark:text-slate-400">{entry.trackExpiry ? (getTranslation('yes', state.currentLanguage)) : (getTranslation('no', state.currentLanguage))}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase mb-1">{getTranslation('costPrice', state.currentLanguage)}</label>
                      <input
                        type="text"
                        value={entry.costPrice}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/,/g, '');
                          if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                            const parts = rawValue.split('.');
                            if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                            handleBatchEntryChange(index, 'costPrice', parts.join('.'));
                          }
                        }}
                        inputMode="decimal"
                        className="w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm font-medium"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase mb-1">{getTranslation('sellingPrice', state.currentLanguage)}</label>
                      <input
                        type="text"
                        value={entry.sellingUnitPrice}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/,/g, '');
                          if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                            const parts = rawValue.split('.');
                            if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                            handleBatchEntryChange(index, 'sellingUnitPrice', parts.join('.'));
                          }
                        }}
                        inputMode="decimal"
                        className="w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm font-medium"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  {entry.trackExpiry && (
                    <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-300">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase mb-1">{getTranslation('mfg', state.currentLanguage)}</label>
                        <input
                          type="date"
                          value={entry.mfg}
                          onChange={(e) => handleBatchEntryChange(index, 'mfg', e.target.value)}
                          className="w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase mb-1">{getTranslation('expiry', state.currentLanguage)}</label>
                        <input
                          type="date"
                          value={entry.expiry}
                          onChange={(e) => handleBatchEntryChange(index, 'expiry', e.target.value)}
                          className="w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white text-sm"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between items-center py-2 px-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-100 dark:border-slate-700">
                    <span className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{getTranslation('estimatedProfit', state.currentLanguage)}</span>
                    <span className={`font-black text-sm break-all ${(Number(entry.sellingUnitPrice) || 0) - (Number(entry.costPrice) || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} title={formatCurrency(((Number(entry.quantity) || 0) * ((Number(entry.sellingUnitPrice) || 0) - (Number(entry.costPrice) || 0))))}>
                      {formatCurrencySmart(((Number(entry.quantity) || 0) * ((Number(entry.sellingUnitPrice) || 0) - (Number(entry.costPrice) || 0))), state.currencyFormat)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

          </div>

          {/* Order Summary */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-700/50 dark:to-indigo-900/20 border border-blue-200 dark:border-slate-700 rounded-xl p-6 shadow-inner">
            <h6 className="text-lg font-bold text-blue-900 dark:text-indigo-300 mb-4 flex items-center gap-2">
              <Plus className="h-5 w-5" />
              {getTranslation('orderSummary', state.currentLanguage)}
            </h6>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="bg-white/50 dark:bg-slate-800/40 p-3 rounded-lg border border-blue-100 dark:border-slate-700 min-w-0">
                <p className="text-[10px] font-bold text-blue-700 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">{getTranslation('totalQuantityKey', state.currentLanguage)}</p>
                <p className="text-lg font-black text-blue-900 dark:text-white truncate" title={totalQuantity.toFixed(2)}>{totalQuantity.toFixed(2)}</p>
              </div>
              <div className="bg-white/50 dark:bg-slate-800/40 p-3 rounded-lg border border-blue-100 dark:border-slate-700 min-w-0">
                <p className="text-[10px] font-bold text-blue-700 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">{getTranslation('totalCost', state.currentLanguage)}</p>
                <p className="text-lg font-black text-red-600 dark:text-red-400 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(totalCostValue)}>
                  {formatCurrencySmart(totalCostValue, state.currencyFormat)}
                </p>
              </div>
              <div className="bg-white/50 dark:bg-slate-800/40 p-3 rounded-lg border border-blue-100 dark:border-slate-700 min-w-0">
                <p className="text-[10px] font-bold text-blue-700 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">{getTranslation('totalSelling', state.currentLanguage)}</p>
                <p className="text-lg font-black text-green-600 dark:text-green-400 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(totalSellingValue)}>
                  {formatCurrencySmart(totalSellingValue, state.currencyFormat)}
                </p>
              </div>
              <div className="bg-white/50 dark:bg-slate-800/40 p-3 rounded-lg border border-blue-100 dark:border-slate-700 min-w-0">
                <p className="text-[10px] font-bold text-blue-700 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">{getTranslation('expProfit', state.currentLanguage)}</p>
                <p className={`text-lg font-black whitespace-nowrap overflow-x-auto scrollbar-hide ${totalProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} title={formatCurrency(totalProfit)}>
                  {formatCurrencySmart(totalProfit, state.currencyFormat)}
                </p>
              </div>
              <div className="bg-white/50 dark:bg-slate-800/40 p-3 rounded-lg border border-blue-100 dark:border-slate-700 min-w-0">
                <p className="text-[10px] font-bold text-blue-700 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">{getTranslation('activeBatch', state.currentLanguage)}</p>
                <p className="text-lg font-black text-blue-900 dark:text-white truncate">{batchEntries.filter(e => e.productName && e.quantity).length}</p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              {getTranslation('notesOptional', state.currentLanguage)}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white transition-all resize-none"
              placeholder={getTranslation('notesPlaceholder', state.currentLanguage)}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-gray-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:flex-1 px-6 py-3 border border-gray-300 dark:border-slate-600 rounded-xl text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-all font-bold active:scale-95"
            >
              {getTranslation('cancel', state.currentLanguage)}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="w-full sm:flex-1 px-6 py-3 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-slate-900 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-bold active:scale-95 shadow-lg shadow-slate-900/20"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  {getTranslation('creatingOrder', state.currentLanguage) || 'Creating Order...'}
                </>
              ) : (
                <>
                  <Save className="h-5 w-5" />
                  {getTranslation('createPurchaseOrder', state.currentLanguage)}
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Add Product Modal */}
      {isAddProductModalOpen && (
        <AddProductModal
          onClose={() => {
            setIsAddProductModalOpen(false);
            setActiveBatchEntryIndex(null);
          }}
          onSave={handleSaveNewProduct}
        />
      )}
    </div>,
    document.body
  );
};

export default AddPurchaseOrderModal;

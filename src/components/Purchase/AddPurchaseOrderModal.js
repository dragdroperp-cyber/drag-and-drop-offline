import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  Minus,
  ChevronDown,
  Phone,
  Mail,
  IndianRupee
} from 'lucide-react';
import { formatCurrency, formatCurrencyCompact, formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';
import AddProductModal from '../Products/AddProductModal';
import AddSupplierModal from '../Suppliers/AddSupplierModal';
import SupplierSelectionModal from '../Suppliers/SupplierSelectionModal';
import AddBatchEntryModal from './AddBatchEntryModal';
import { ActionTypes } from '../../context/AppContext';
import { addToIndexedDB, updateInIndexedDB } from '../../utils/indexedDB';


const AddPurchaseOrderModal = ({ isOpen, onClose, onSave }) => {
  const { state, dispatch } = useApp();
  const parseVal = useCallback((val) => {
    if (!val) return 0;
    return parseFloat(val.toString().replace(/,/g, '')) || 0;
  }, []);

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
      batchEntries: []
    };
  };

  const initialData = loadSavedPurchaseOrderData();

  // Form state
  const [supplierName, setSupplierName] = useState(initialData.supplierName);
  const [orderDate, setOrderDate] = useState(initialData.orderDate);
  const [notes, setNotes] = useState(initialData.notes);
  const [status, setStatus] = useState(initialData.status);
  const [paymentMethod, setPaymentMethod] = useState('due');
  const [paidAmount, setPaidAmount] = useState('');

  // Batch management state - now using array of batch entries
  const [batchEntries, setBatchEntries] = useState(initialData.batchEntries);

  // State for adding new product from modal
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [activeBatchEntryIndex, setActiveBatchEntryIndex] = useState(null);
  const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);
  const [isSupplierSelectionModalOpen, setIsSupplierSelectionModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [isAddBatchEntryModalOpen, setIsAddBatchEntryModalOpen] = useState(false);
  const [editingBatchIndex, setEditingBatchIndex] = useState(null);


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
        setBatchEntries([]);
        setSupplierName(initialData.supplierName);
      }
      setError('');
    }
  }, [isOpen]);

  // Sync selected supplier object when supplierName changes (useful for drafts)
  useEffect(() => {
    if (supplierName && state.suppliers) {
      const found = state.suppliers.find(s => s.name === supplierName);
      if (found) setSelectedSupplier(found);
    } else {
      setSelectedSupplier(null);
    }
  }, [supplierName, state.suppliers]);

  // Calculate totals
  const calculateTotals = () => {
    let totalQuantity = 0;
    let totalCostValue = 0;
    let totalSellingValue = 0;
    let totalProfit = 0;
    let totalWholesaleProfit = 0;

    batchEntries.forEach(entry => {
      const quantity = parseVal(entry.quantity);
      const costPrice = parseVal(entry.costPrice);
      const sellingPrice = parseVal(entry.sellingUnitPrice);
      const wholesalePrice = parseFloat(entry.wholesalePrice?.toString().replace(/,/g, '') || 0);

      if (quantity > 0 && entry.productName) {
        totalQuantity += quantity;
        totalCostValue += quantity * costPrice;
        totalSellingValue += quantity * sellingPrice;
        totalProfit += quantity * (sellingPrice - costPrice);
        if (wholesalePrice > 0) {
          totalWholesaleProfit += quantity * (wholesalePrice - costPrice);
        }
      }
    });

    return {
      totalQuantity,
      totalCostValue,
      totalSellingValue,
      totalProfit,
      totalWholesaleProfit
    };
  };

  const { totalQuantity, totalCostValue, totalSellingValue, totalProfit, totalWholesaleProfit } = calculateTotals();
  const hasAnyExpiry = useMemo(() => batchEntries.some(entry => entry.trackExpiry), [batchEntries]);

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
          newEntries[index].wholesalePrice = product.wholesalePrice ? Number(product.wholesalePrice).toLocaleString('en-IN') : '';
          newEntries[index].wholesaleMOQ = product.wholesaleMOQ ? Number(product.wholesaleMOQ).toLocaleString('en-IN') : '';
          newEntries[index].sellingUnitPrice = product.sellingPrice ? Number(product.sellingPrice).toLocaleString('en-IN') : '';
          newEntries[index].costPrice = product.costPrice ? Number(product.costPrice).toLocaleString('en-IN') : '';
          newEntries[index].trackExpiry = product.trackExpiry || false;
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
            productName: newProduct.name,
            trackExpiry: newProduct.trackExpiry || false,
            wholesalePrice: newProduct.wholesalePrice || '',
            wholesaleMOQ: newProduct.wholesaleMOQ || ''
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

  // Handle saving new supplier from modal
  const handleSaveNewSupplier = async (supplierData) => {
    try {
      setLoading(true);
      const { addItem, STORES } = await import('../../utils/indexedDB');

      // Create a unique local ID
      const newSupplierId = `sup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const newSupplier = {
        ...supplierData,
        id: newSupplierId,
        _id: newSupplierId,
        sellerId: state.currentUser?.sellerId || state.currentUser?.uid || state.user?.sellerId || state.user?.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isSynced: false
      };

      // Ensure dueAmount is correctly set (AddSupplierModal already calculates it)
      newSupplier.dueAmount = Number(newSupplier.dueAmount || 0);
      newSupplier.balanceDue = Number(newSupplier.balanceDue || 0);

      // 1. Save to IndexedDB
      await addItem(STORES.suppliers, newSupplier);

      // 2. Dispatch to state
      dispatch({ type: ActionTypes.ADD_SUPPLIER, payload: newSupplier });

      // 3. Add to sync queue
      await addToSyncQueue('supplier_create', newSupplier);

      // 4. Create opening balance transaction if needed
      const initialBalance = parseFloat(newSupplier.dueAmount || 0);
      if (initialBalance !== 0) {
        const transactionId = `sup_tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const transaction = {
          id: transactionId,
          localId: transactionId,
          _id: transactionId,
          sellerId: newSupplier.sellerId,
          supplierId: newSupplier.id,
          type: initialBalance >= 0 ? 'opening_balance' : 'payment',
          amount: Math.abs(initialBalance),
          date: new Date().toISOString(),
          description: initialBalance >= 0 ? 'Opening Balance (Payable)' : 'Opening Advance',
          previousBalance: 0,
          currentBalance: initialBalance,
          isSynced: false,
          isDeleted: false,
          createdAt: new Date().toISOString(),
          userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
        };

        // Save transaction to IndexedDB
        await addItem(STORES.supplierTransactions, transaction);

        // Dispatch to state
        dispatch({ type: ActionTypes.ADD_SUPPLIER_TRANSACTION, payload: transaction });

        // Add to sync queue
        await addToSyncQueue('supplier_transaction_create', transaction);
      }

      // 5. Set as selected supplier
      setSupplierName(newSupplier.name);

      // 6. Close modal
      setIsAddSupplierModalOpen(false);

      if (window.showToast) {
        window.showToast(getTranslation('supplierAddedSuccess', state.currentLanguage) || 'Supplier added successfully', 'success');
      }

    } catch (err) {
      console.error('Failed to create supplier:', err);
      if (window.showToast) {
        window.showToast('Failed to create supplier', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle supplier selection from modal
  const handleSelectSupplier = (supplier) => {
    setSupplierName(supplier.name);
    setSelectedSupplier(supplier);
    setIsSupplierSelectionModalOpen(false);
  };

  // Add new batch entry row

  // Add new batch entry via modal
  const handleAddBatchEntry = () => {
    setEditingBatchIndex(null);
    setIsAddBatchEntryModalOpen(true);
  };

  // Edit existing batch entry
  const handleEditBatchEntry = (index) => {
    setEditingBatchIndex(index);
    setIsAddBatchEntryModalOpen(true);
  };

  // Save batch entry from modal
  const handleSaveBatchEntry = (entryData) => {
    if (editingBatchIndex !== null) {
      // Update existing entry
      setBatchEntries(prev => {
        const newEntries = [...prev];
        newEntries[editingBatchIndex] = entryData;
        return newEntries;
      });
    } else {
      // Add new entry
      setBatchEntries(prev => [...prev, entryData]);
    }
    setIsAddBatchEntryModalOpen(false);
    setEditingBatchIndex(null);
  };

  // Remove batch entry
  const removeBatchEntry = (index) => {
    setBatchEntries(prev => prev.filter((_, i) => i !== index));
  };

  // Validate form
  const validateForm = () => {
    if (!supplierName.trim()) {
      setError(getTranslation('supplierNameRequired', state.currentLanguage));
      return false;
    }

    // Check if at least one batch entry has valid data
    const validEntries = batchEntries.filter(entry =>
      entry.productName && entry.quantity && parseVal(entry.quantity) > 0
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
        if (!entry.quantity || parseVal(entry.quantity) <= 0) {
          setError(`${getTranslation('entry', state.currentLanguage) || 'Entry'} ${i + 1}: ${getTranslation('validQuantityRequired', state.currentLanguage)}`);
          return false;
        }
        if (!entry.costPrice || parseVal(entry.costPrice) < 0) {
          setError(`${getTranslation('entry', state.currentLanguage) || 'Entry'} ${i + 1}: ${getTranslation('validCostPriceRequired', state.currentLanguage)}`);
          return false;
        }
        if (!entry.sellingUnitPrice || parseVal(entry.sellingUnitPrice) < 0) {
          setError(`${getTranslation('entry', state.currentLanguage) || 'Entry'} ${i + 1}: ${getTranslation('validSellingPriceRequired', state.currentLanguage)}`);
          return false;
        }

        // Expiry tracking validation
        if (entry.trackExpiry) {
          if (!entry.mfg) {
            setError(`${getTranslation('entry', state.currentLanguage) || 'Entry'} ${i + 1}: MFG date is required for products with expiry tracking`);
            return false;
          }
          if (!entry.expiry) {
            setError(`${getTranslation('entry', state.currentLanguage) || 'Entry'} ${i + 1}: Expiry date is required for products with expiry tracking`);
            return false;
          }
          if (entry.mfg && entry.expiry && new Date(entry.expiry) <= new Date(entry.mfg)) {
            setError(`${getTranslation('entry', state.currentLanguage) || 'Entry'} ${i + 1}: Expiry date must be after MFG date`);
            return false;
          }
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
          wholesalePrice: batchData.wholesalePrice || 0,
          wholesaleMOQ: batchData.wholesaleMOQ || 1,
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
        quantity: parseVal(entry.quantity),
        price: parseVal(entry.costPrice), // Use cost price as the item price for validation
        unit: 'pcs', // Default unit, can be enhanced later
        subtotal: parseVal(entry.quantity) * parseVal(entry.costPrice)
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
          batchNumber: entry.batchNumber || `Batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          quantity: parseVal(entry.quantity),
          costPrice: parseVal(entry.costPrice),
          sellingUnitPrice: parseVal(entry.sellingUnitPrice),
          wholesalePrice: parseVal(entry.wholesalePrice),
          wholesaleMOQ: parseVal(entry.wholesaleMOQ || '1'),
          expiry: entry.trackExpiry ? (entry.expiry || null) : null,
          mfg: entry.trackExpiry ? (entry.mfg || null) : null
        })),
        totalQuantity,
        totalCostValue,
        total: totalCostValue, // Map totalCostValue to total for UI display compatibility
        totalSellingValue,
        totalProfit,
        status, // Use the selected status from the form
        // Payment Details
        paymentMethod,
        amountPaid: parseVal(paidAmount),
        balanceDue: Math.max(0, totalCostValue - parseVal(paidAmount)),
        paymentStatus: parseVal(paidAmount) >= totalCostValue ? 'paid' : (parseVal(paidAmount) > 0 ? 'partial' : 'unpaid'),
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
      const { addItem, updateItem, STORES } = await import('../../utils/indexedDB');

      // Update Supplier Due Amount and Create Transactions (Offline-first)
      if (selectedSupplier) {
        try {
          const purchaseAmount = parseVal(totalCostValue);
          const paid = parseVal(paidAmount);
          // Net balance change: +Purchase - Paid
          const balanceChange = purchaseAmount - paid;

          const currentDue = parseVal(selectedSupplier.dueAmount ?? selectedSupplier.balanceDue) || 0;
          const newDue = currentDue + balanceChange;

          // Update Supplier Object
          const updatedSupplier = {
            ...selectedSupplier,
            dueAmount: newDue,
            balanceDue: newDue,
            lastModified: new Date().toISOString(),
            isSynced: false
          };

          // Use updateItem to save to IndexedDB
          await updateItem(STORES.suppliers, updatedSupplier);
          // Update Redux State immediately
          dispatch({ type: ActionTypes.UPDATE_SUPPLIER, payload: updatedSupplier });

          // Create Purchase Transaction (Bill)
          const purchaseTx = {
            id: `tx_po_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            supplierId: selectedSupplier.id || selectedSupplier._id,
            orderId: orderId,
            type: 'purchase_order',
            amount: purchaseAmount,
            date: new Date().toISOString(),
            description: `Purchase Order`,
            paymentMethod: 'due',
            isSynced: false,
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString()
          };
          await addItem(STORES.supplierTransactions, purchaseTx);
          dispatch({ type: ActionTypes.ADD_SUPPLIER_TRANSACTION, payload: purchaseTx });

          // Create Payment Transaction (if paid > 0)
          if (paid > 0) {
            const paymentTx = {
              id: `tx_pay_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              supplierId: selectedSupplier.id || selectedSupplier._id,
              orderId: orderId,
              type: 'payment',
              amount: paid,
              date: new Date().toISOString(),
              description: `Payment for Purchase Order`,
              paymentMethod: paymentMethod,
              isSynced: false,
              createdAt: new Date().toISOString(),
              lastModified: new Date().toISOString()
            };
            await addItem(STORES.supplierTransactions, paymentTx);
            dispatch({ type: ActionTypes.ADD_SUPPLIER_TRANSACTION, payload: paymentTx });
          }
        } catch (suppErr) {
          console.error("Error updating supplier details:", suppErr);
        }
      }

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
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
                  <div
                    onClick={() => setIsSupplierSelectionModalOpen(true)}
                    className="w-full pl-10 pr-10 py-3 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white transition-all cursor-pointer flex items-center justify-between"
                  >
                    <span className={supplierName ? 'truncate' : 'text-gray-400'}>
                      {supplierName || getTranslation('selectSupplier', state.currentLanguage)}
                    </span>
                    <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  </div>
                  {supplierName && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSupplierName('');
                        setSelectedSupplier(null);
                      }}
                      className="absolute right-10 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddSupplierModalOpen(true)}
                  className="p-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all flex-shrink-0"
                  title={getTranslation('addSupplier', state.currentLanguage)}
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>

              {/* Selected Supplier Details */}
              {selectedSupplier && (
                <div className="mt-3 p-3 bg-gray-50/50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-700/50 rounded-xl flex flex-wrap gap-4 animate-fadeIn">
                  {selectedSupplier.mobileNumber && (
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
                      <Phone className="h-3 w-3 text-indigo-500" />
                      <span>{selectedSupplier.mobileNumber}</span>
                    </div>
                  )}
                  {selectedSupplier.email && (
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
                      <Mail className="h-3 w-3 text-indigo-500" />
                      <span className="truncate max-w-[150px]">{selectedSupplier.email}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 font-medium uppercase tracking-wider text-[10px]">Due:</span>
                    <span className={`font-bold ${selectedSupplier.dueAmount > 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {formatCurrencySmart(selectedSupplier.dueAmount || 0, state.currencyFormat)}
                    </span>
                  </div>
                </div>
              )}
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

          {/* Batch Entry Section */}
          <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
            <div className="bg-gray-50 dark:bg-slate-700/50 px-6 py-4 border-b border-gray-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Package className="h-5 w-5 text-slate-900 dark:text-slate-100" />
                  {getTranslation('batchEntries', state.currentLanguage)}
                </h4>
                <button
                  type="button"
                  onClick={handleAddBatchEntry}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-slate-900 rounded-lg transition-all text-sm font-semibold active:scale-95 shadow-md shadow-slate-900/20"
                >
                  <Plus className="h-4 w-4" />
                  Add Row
                </button>
              </div>
            </div>

            {/* Batch Entries List */}
            {batchEntries.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="h-16 w-16 text-gray-300 dark:text-slate-600 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-slate-400 font-medium">No batch entries added yet</p>
                <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">Click "Add Row" to add your first batch entry</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-slate-700">
                {batchEntries.map((entry, index) => {
                  const profit = parseVal(entry.quantity) * (parseVal(entry.sellingUnitPrice) - parseVal(entry.costPrice));
                  return (
                    <div key={index} className="p-4 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="flex-shrink-0 w-8 h-8 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center">
                              <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">#{index + 1}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h5 className="font-bold text-gray-900 dark:text-white truncate">{entry.productName || 'Unnamed Product'}</h5>
                              {entry.batchNumber && (
                                <p className="text-xs text-gray-500 dark:text-slate-400">Batch: {entry.batchNumber}</p>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Quantity</p>
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{entry.quantity || '0'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Cost Price</p>
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatCurrencySmart(parseVal(entry.costPrice), state.currencyFormat)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Selling Price</p>
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatCurrencySmart(parseVal(entry.sellingUnitPrice), state.currencyFormat)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Profit</p>
                              <p className={`text-sm font-bold ${profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {formatCurrencySmart(profit, state.currencyFormat)}
                              </p>
                            </div>
                          </div>

                          {entry.trackExpiry && (entry.mfg || entry.expiry) && (
                            <div className="mt-3 flex gap-4 text-xs">
                              {entry.mfg && (
                                <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                  <Calendar className="h-3 w-3" />
                                  <span>MFG: {new Date(entry.mfg).toLocaleDateString()}</span>
                                </div>
                              )}
                              {entry.expiry && (
                                <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                  <AlertCircle className="h-3 w-3" />
                                  <span>Exp: {new Date(entry.expiry).toLocaleDateString()}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditBatchEntry(index)}
                            className="p-2 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                            title="Edit entry"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeBatchEntry(index)}
                            className="p-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                            title="Remove entry"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Order Summary */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-700/50 dark:to-indigo-900/20 border border-blue-200 dark:border-slate-700 rounded-xl p-6 shadow-inner">
            <h6 className="text-lg font-bold text-blue-900 dark:text-indigo-300 mb-4 flex items-center gap-2">
              <Plus className="h-5 w-5" />
              {getTranslation('orderSummary', state.currentLanguage)}
            </h6>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
                <p className="text-[10px] font-bold text-blue-700 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">Retail Profit</p>
                <p className={`text-lg font-black whitespace-nowrap overflow-x-auto scrollbar-hide ${totalProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} title={formatCurrency(totalProfit)}>
                  {formatCurrencySmart(totalProfit, state.currencyFormat)}
                </p>
              </div>
              <div className="bg-white/50 dark:bg-slate-800/40 p-3 rounded-lg border border-blue-100 dark:border-slate-700 min-w-0">
                <p className="text-[10px] font-bold text-blue-700 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">Wholesale Profit</p>
                <p className={`text-lg font-black whitespace-nowrap overflow-x-auto scrollbar-hide ${totalWholesaleProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} title={formatCurrency(totalWholesaleProfit)}>
                  {totalWholesaleProfit !== 0 ? formatCurrencySmart(totalWholesaleProfit, state.currencyFormat) : '-'}
                </p>
              </div>
              <div className="bg-white/50 dark:bg-slate-800/40 p-3 rounded-lg border border-blue-100 dark:border-slate-700 min-w-0">
                <p className="text-[10px] font-bold text-blue-700 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">{getTranslation('activeBatch', state.currentLanguage)}</p>
                <p className="text-lg font-black text-blue-900 dark:text-white truncate">{batchEntries.filter(e => e.productName && e.quantity).length}</p>
              </div>
            </div>
          </div>

          {/* Payment Details */}
          <div className="space-y-4 mb-6">
            <h6 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <IndianRupee className="h-4 w-4" />
              {getTranslation('paymentDetails', state.currentLanguage) || 'Payment Details'}
            </h6>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                  {getTranslation('paymentMethod', state.currentLanguage) || 'Payment Method'}
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => {
                    const method = e.target.value;
                    setPaymentMethod(method);
                    if (method === 'cash' || method === 'online' || method === 'upi') {
                      setPaidAmount(totalCostValue.toString());
                    } else if (method === 'due') {
                      setPaidAmount('0');
                    }
                  }}
                  className="w-full px-4 py-3 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white transition-all appearance-none"
                >
                  <option value="due">{getTranslation('due', state.currentLanguage) || 'Due (Unpaid)'}</option>
                  <option value="cash">{getTranslation('cash', state.currentLanguage) || 'Cash'}</option>
                  <option value="online">{getTranslation('online', state.currentLanguage) || 'Online / Bank Transfer'}</option>
                  <option value="upi">UPI</option>
                </select>
              </div>

              {paymentMethod !== 'due' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                    {getTranslation('amountPaid', state.currentLanguage) || 'Amount Paid'}
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <IndianRupee className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      value={paidAmount}
                      onChange={(e) => {
                        const val = e.target.value.replace(/,/g, '');
                        if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                          if (val === '' || val === '.') {
                            setPaidAmount(val);
                            return;
                          }
                          const numVal = parseFloat(val);
                          if (numVal > totalCostValue) {
                            if (window.showToast) window.showToast('Amount paid cannot exceed total bill amount', 'warning');
                          } else {
                            setPaidAmount(val);
                          }
                        }
                      }}
                      className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-indigo-400 text-gray-900 dark:text-white transition-all font-bold"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              )}
            </div>

            {paymentMethod !== 'due' && (
              <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded-xl flex justify-between items-center border border-gray-200 dark:border-slate-600">
                <span className="text-sm font-medium text-gray-600 dark:text-slate-400">Balance Due</span>
                <span className={`text-xl font-black ${(totalCostValue - (parseFloat(paidAmount) || 0)) > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-green-600 dark:text-green-400'
                  }`}>
                  {formatCurrencySmart(Math.max(0, totalCostValue - (parseFloat(paidAmount) || 0)), state.currencyFormat)}
                </span>
              </div>
            )}
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

      {/* Add Supplier Modal */}
      {isAddSupplierModalOpen && (
        <AddSupplierModal
          onClose={() => setIsAddSupplierModalOpen(false)}
          onSubmit={handleSaveNewSupplier}
          existingSuppliers={state.suppliers}
        />
      )}

      {/* Supplier Selection Modal */}
      {isSupplierSelectionModalOpen && (
        <SupplierSelectionModal
          isOpen={isSupplierSelectionModalOpen}
          onClose={() => setIsSupplierSelectionModalOpen(false)}
          onSelect={handleSelectSupplier}
          suppliers={state.suppliers}
        />
      )}

      {/* Add/Edit Batch Entry Modal */}
      <AddBatchEntryModal
        isOpen={isAddBatchEntryModalOpen}
        onClose={() => {
          setIsAddBatchEntryModalOpen(false);
          setEditingBatchIndex(null);
        }}
        onSave={handleSaveBatchEntry}
        existingEntry={editingBatchIndex !== null ? batchEntries[editingBatchIndex] : null}
      />
    </div>,
    document.body
  );
};

export default AddPurchaseOrderModal;

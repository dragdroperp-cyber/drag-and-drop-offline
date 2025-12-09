import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { apiRequest } from '../../utils/api';
import { addToSyncQueue } from '../../utils/dataFetcher';
import {
  X,
  Plus,
  Package,
  Truck,
  Calendar,
  User,
  Save,
  AlertCircle,
  Trash2
} from 'lucide-react';

const AddPurchaseOrderModal = ({ isOpen, onClose, onSave }) => {
  const { state, dispatch } = useApp();

  // Form state
  const [supplierName, setSupplierName] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('pending');

  // Batch management state - now using array of batch entries
  const [batchEntries, setBatchEntries] = useState([
    {
      productId: '',
      productName: '',
      quantity: '',
      costPrice: '',
      sellingUnitPrice: '',
      expiry: '',
      mfg: '',
      trackExpiry: false // Per-batch expiry tracking
    }
  ]);

  // Loading and error states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
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
      const quantity = Number(entry.quantity || 0);
      const costPrice = Number(entry.costPrice || 0);
      const sellingPrice = Number(entry.sellingUnitPrice || 0);

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

  // Add new batch entry row
  const addBatchEntry = () => {
    setBatchEntries(prev => [...prev, {
      productId: '',
      productName: '',
      quantity: '',
      costPrice: '',
      sellingUnitPrice: '',
      expiry: '',
      mfg: '',
      trackExpiry: false
    }]);
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
      setError('Supplier name is required');
      return false;
    }

    // Check if at least one batch entry has valid data
    const validEntries = batchEntries.filter(entry =>
      entry.productName && entry.quantity && Number(entry.quantity) > 0
    );

    if (validEntries.length === 0) {
      setError('Please add at least one batch entry with product, quantity, and cost price');
      return false;
    }

    // Validate each entry
    for (let i = 0; i < batchEntries.length; i++) {
      const entry = batchEntries[i];
      if (entry.productName || entry.quantity || entry.costPrice) {
        // If any field is filled, all required fields must be filled
        if (!entry.productName) {
          setError(`Entry ${i + 1}: Product is required`);
          return false;
        }
        if (!entry.quantity || Number(entry.quantity) <= 0) {
          setError(`Entry ${i + 1}: Valid quantity is required`);
          return false;
        }
        if (!entry.costPrice || Number(entry.costPrice) < 0) {
          setError(`Entry ${i + 1}: Valid cost price is required`);
          return false;
        }
        if (!entry.sellingUnitPrice || Number(entry.sellingUnitPrice) < 0) {
          setError(`Entry ${i + 1}: Valid selling unit price is required`);
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
          // Mark as not synced since we added a batch
          isSynced: false,
          lastModified: new Date().toISOString()
        };

        // Save updated product to IndexedDB
        await updateItem(STORES.products, updatedProduct);

        // Update UI state
        dispatch({ type: 'UPDATE_PRODUCT', payload: updatedProduct });

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

    if (!validateForm()) return;

    setLoading(true);
    setError('');

    try {
      // Create purchase order data from batch entries
      const validEntries = batchEntries.filter(entry =>
        entry.productName && entry.quantity && Number(entry.quantity) > 0
      );

      // Create items array for backward compatibility with existing validation
      const items = validEntries.map(entry => ({
        productId: entry.productId,
        productName: entry.productName,
        quantity: Number(entry.quantity),
        price: Number(entry.costPrice), // Use cost price as the item price for validation
        unit: 'pcs', // Default unit, can be enhanced later
        subtotal: Number(entry.quantity) * Number(entry.costPrice)
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
          quantity: Number(entry.quantity),
          costPrice: Number(entry.costPrice),
          sellingUnitPrice: Number(entry.sellingUnitPrice),
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

      ('📦 Creating purchase order (offline-first):', {
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

      // STEP 4: Attempt background sync if online (only process sync queue, don't fetch data to avoid duplicates)
      const { isOnline, backgroundSyncWithBackend } = await import('../../utils/dataFetcher');
      if (isOnline()) {
        //('🌐 Online - triggering sync queue processing for purchase order (skipping data fetch to avoid duplicates)');
        backgroundSyncWithBackend(dispatch, {}, { skipDataFetch: true }).catch(syncError => {

        });
      } else {

      }

      // Show success message
      if (window.showToast) {
        window.showToast('Purchase order created locally! Syncing to server...', 'success');
      }

      // Reset form and close modal
      onSave(orderData);
      onClose();

    } catch (error) {

      setError('Failed to create purchase order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-2">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-7xl max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
          <h3 className="text-2xl font-semibold text-gray-900">
            Create Purchase Order - Batch Entry
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {/* Basic Order Information */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Supplier Name *
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter supplier name"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Order Date *
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Batch Entry Table */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-medium text-gray-900">Batch Entries</h4>
                <button
                  type="button"
                  onClick={addBatchEntry}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                >
                  <Plus className="h-4 w-4" />
                  Add Batch Entry
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Product
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Track Expiry
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Quantity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Cost Price (₹)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Selling Price (₹)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      MFG Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Expiry Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Profit (₹)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {batchEntries.map((entry, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <select
                          value={entry.productId}
                          onChange={(e) => handleBatchEntryChange(index, 'productId', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                        >
                          <option value="">Select Product</option>
                          {state.products.map(product => (
                            <option key={product.id || product._id} value={product.id || product._id}>
                              {product.name} {product.barcode ? `(${product.barcode})` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={entry.trackExpiry}
                              onChange={(e) => handleBatchEntryChange(index, 'trackExpiry', e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                          </label>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="text"
                          value={entry.quantity}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^0-9.]/g, '');
                            handleBatchEntryChange(index, 'quantity', value);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="text"
                          value={entry.costPrice}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^0-9.]/g, '');
                            handleBatchEntryChange(index, 'costPrice', value);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="text"
                          value={entry.sellingUnitPrice}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^0-9.]/g, '');
                            handleBatchEntryChange(index, 'sellingUnitPrice', value);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-6 py-4">
                        {entry.trackExpiry ? (
                          <input
                            type="date"
                            value={entry.mfg}
                            onChange={(e) => handleBatchEntryChange(index, 'mfg', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                          />
                        ) : (
                          <span className="text-gray-400 text-sm">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {entry.trackExpiry ? (
                          <input
                            type="date"
                            value={entry.expiry}
                            onChange={(e) => handleBatchEntryChange(index, 'expiry', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                          />
                        ) : (
                          <span className="text-gray-400 text-sm">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className={`font-medium ${(Number(entry.sellingUnitPrice) || 0) - (Number(entry.costPrice) || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ₹{((Number(entry.quantity) || 0) * ((Number(entry.sellingUnitPrice) || 0) - (Number(entry.costPrice) || 0))).toFixed(2)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {batchEntries.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeBatchEntry(index)}
                            className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
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
          </div>

          {/* Order Summary */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
            <h6 className="text-lg font-medium text-blue-900 mb-4">Order Summary</h6>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
              <div>
                <p className="text-sm text-blue-700 mb-1">Total Quantity</p>
                <p className="text-2xl font-bold text-blue-900">{totalQuantity.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm text-blue-700 mb-1">Total Cost</p>
                <p className="text-2xl font-bold text-red-600">₹{totalCostValue.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm text-blue-700 mb-1">Total Selling</p>
                <p className="text-2xl font-bold text-green-600">₹{totalSellingValue.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm text-blue-700 mb-1">Expected Profit</p>
                <p className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ₹{totalProfit.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-sm text-blue-700 mb-1">Batch Entries</p>
                <p className="text-2xl font-bold text-blue-900">{batchEntries.filter(e => e.productName && e.quantity).length}</p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Add any additional notes..."
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Creating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Create Order
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddPurchaseOrderModal;

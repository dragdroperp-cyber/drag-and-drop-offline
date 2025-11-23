import React, { useState, useRef, useEffect } from 'react';
import { useApp, ActionTypes } from '../../context/AppContext';
import { getSellerIdFromAuth } from '../../utils/api';
import { X, Package, Camera, QrCode } from 'lucide-react';
import BarcodeScanner from '../BarcodeScanner/BarcodeScanner';

const EditProductModal = ({ product, onClose, onSave }) => {
  const formatDateForInput = (d) => {
    if (!d) return '';
    try {
      const date = new Date(d);
      if (Number.isNaN(date.getTime())) return '';
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch { return ''; }
  };
  const { state, dispatch } = useApp();
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [formData, setFormData] = useState({
    id: product.id,
    name: product.name || '',
    description: product.description || '',
    category: product.category || '',
    quantity: (product.quantity ?? product.stock ?? '').toString(),
    barcode: product.barcode || '',
    expiryDate: formatDateForInput(product.expiryDate || product.expiry || ''),
    mfgDate: formatDateForInput(product.mfgDate || product.mfg || ''),
    costPrice: (product.costPrice ?? '').toString(),
    sellingPrice: (product.sellingPrice ?? '').toString(),
    quantityUnit: product.quantityUnit || product.unit || 'pcs'
  });
  const [trackExpiry, setTrackExpiry] = useState(Boolean(product.expiryDate || product.expiry || product.mfgDate || product.mfg));

  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [barcodeError, setBarcodeError] = useState('');
  
  // Scanner input detection refs (like Billing page)
  const scannerInputBufferRef = useRef('');
  const scannerInputTimerRef = useRef(null);
  const lastKeyTimeRef = useRef(0);
  const barcodeInputRef = useRef(null);

  // Create new category inline and select it
  const handleCreateCategory = () => {
    const name = (newCategoryName || '').trim().toLowerCase();
    if (!name) {
      if (window.showToast) window.showToast('Please enter a category name', 'error');
      return;
    }

    const sellerId = getSellerIdFromAuth();
    const exists = state.categories
      .filter(cat => !cat.sellerId || (sellerId && cat.sellerId === sellerId))
      .some(cat => (cat.name || '').toLowerCase() === name);
    if (exists) {
      if (window.showToast) window.showToast('Category already exists', 'warning');
      return;
    }

    const newCategory = {
      id: `cat-${Date.now()}`,
      name,
      createdAt: new Date().toISOString()
    };
    // Dispatch so reducer adds sellerId and persists
    dispatch({ type: ActionTypes.ADD_CATEGORY, payload: newCategory });
    setFormData(prev => ({ ...prev, category: name }));
    setNewCategoryName('');
    setShowCreateCategory(false);
    if (window.showToast) window.showToast(`Category "${name}" created and selected`, 'success');
  };

  const handleChange = (e) => {
    const { name } = e.target;
    let { value } = e.target;

    if (name === 'quantity') {
      const numericValue = value.replace(/,/g, '.');
      const isFractionalUnit = ['kg', 'gm', 'liters', 'ml'].includes((formData.quantityUnit || '').toLowerCase());
      const pattern = isFractionalUnit ? /^[0-9]*\.?[0-9]*$/ : /^[0-9]*$/;
      if (!pattern.test(numericValue)) {
        return;
      }
      value = numericValue;
    }
    
    // Price handling - preserve exact input, allow decimals
    if (name === 'costPrice' || name === 'sellingPrice') {
      // Allow numbers, single decimal point, and up to 2 decimal places
      const pattern = /^[0-9]*\.?[0-9]{0,2}$/;
      if (value === '' || pattern.test(value)) {
        // Allow empty or valid decimal input
      } else {
        return; // Reject invalid input
      }
    }

    setFormData(prev => {
      const next = { ...prev, [name]: value };
      // Preserve exact input - no automatic rounding
      if (name === 'quantity' && (value === '' || value === null)) {
        next.quantity = '';
      }
      return next;
    });
    
    // Check for duplicate barcode when barcode changes
    if (name === 'barcode' && value.trim()) {
      checkBarcodeUniqueness(value);
    } else if (name === 'barcode' && !value.trim()) {
      // Clear error if barcode is empty
      setBarcodeError('');
    }
  };
  
  // Check if barcode is unique (except for current product)
  const checkBarcodeUniqueness = (barcode) => {
    if (!barcode || !barcode.trim()) {
      setBarcodeError('');
      return;
    }
    
    const trimmedBarcode = barcode.trim();
    
    // Normalize IDs for comparison (handle string/number mismatches)
    const currentProductId = String(product.id || '');
    const currentProductMongoId = String(product._id || '');
    
    const existingProduct = state.products.find(p => {
      if (!p.barcode || p.isDeleted) return false;
      
      // Check if barcode matches
      if (p.barcode.trim() !== trimmedBarcode) return false;
      
      // Check if it's the same product (by id or _id)
      const pId = String(p.id || '');
      const pMongoId = String(p._id || '');
      
      // If IDs match, it's the same product - allow it
      if (currentProductId && pId && currentProductId === pId) return false;
      if (currentProductMongoId && pMongoId && currentProductMongoId === pMongoId) return false;
      
      // If both have no IDs but names match, might be the same product
      if (!currentProductId && !pId && product.name === p.name) return false;
      
      // Otherwise, it's a different product with the same barcode - conflict!
      return true;
    });
    
    if (existingProduct) {
      setBarcodeError(`Barcode already exists for product "${existingProduct.name}"`);
    } else {
      setBarcodeError('');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validation according to backend model requirements
    const errors = [];
    
    // Required fields from backend: name, quantity, unit, unitPrice, sellingUnitPrice, mfg, expiryDate, description
    if (!formData.name || !formData.name.trim()) {
      errors.push('Product name is required');
    }
    
    if (!formData.quantityUnit || !formData.quantityUnit.trim()) {
      errors.push('Quantity unit is required');
    }
    
    // Check if quantity is provided (backend requires quantity)
    // Preserve exact input - validate but don't round
    const quantityValue = formData.quantity ? Number(formData.quantity) : 0;
    if (!Number.isFinite(quantityValue) || quantityValue < 0) {
      errors.push('Quantity must be a valid number and 0 or greater');
    }
    
    // For count-based units, validate that it's a whole number (but don't auto-round)
    const isCountBased = ['pcs', 'pieces', 'piece', 'packet', 'packets', 'box', 'boxes'].includes((formData.quantityUnit || '').toLowerCase());
    if (isCountBased && !Number.isInteger(quantityValue)) {
      errors.push('Quantity must be a whole number for pieces, packets, and boxes');
    }
    
    const quantity = quantityValue;
    
    // Backend requires unitPrice (costPrice) and sellingUnitPrice (sellingPrice)
    const costPrice = parseFloat(formData.costPrice) || 0;
    const sellingPrice = parseFloat(formData.sellingPrice) || 0;
    
    if (costPrice < 0) {
      errors.push('Cost price must be 0 or greater');
    }
    
    if (sellingPrice < 0) {
      errors.push('Selling price must be 0 or greater');
    }
    
    // Optional expiry tracking
    if (trackExpiry) {
      if (!formData.mfgDate) {
        errors.push('Manufacturing date (MFG Date) is required');
      }
      
      if (!formData.expiryDate) {
        errors.push('Expiry date is required');
      }
    }
    
    // Backend requires description
    if (!formData.description || !formData.description.trim()) {
      errors.push('Product description is required');
    }
    
    // Validate barcode uniqueness - no duplicate barcodes allowed (except for current product)
    if (formData.barcode && formData.barcode.trim()) {
      const trimmedBarcode = formData.barcode.trim();
      
      // Normalize IDs for comparison (handle string/number mismatches)
      const currentProductId = String(product.id || '');
      const currentProductMongoId = String(product._id || '');
      
      const existingProduct = state.products.find(p => {
        if (!p.barcode || p.isDeleted) return false;
        
        // Check if barcode matches
        if (p.barcode.trim() !== trimmedBarcode) return false;
        
        // Check if it's the same product (by id or _id)
        const pId = String(p.id || '');
        const pMongoId = String(p._id || '');
        
        // If IDs match, it's the same product - allow it
        if (currentProductId && pId && currentProductId === pId) return false;
        if (currentProductMongoId && pMongoId && currentProductMongoId === pMongoId) return false;
        
        // If both have no IDs but names match, might be the same product
        if (!currentProductId && !pId && product.name === p.name) return false;
        
        // Otherwise, it's a different product with the same barcode - conflict!
        return true;
      });
      
      if (existingProduct) {
        errors.push(`Barcode "${trimmedBarcode}" already exists for product "${existingProduct.name}". Each product must have a unique barcode.`);
      }
    }
    
    // Validate dates
    if (trackExpiry && formData.mfgDate && formData.expiryDate) {
      const mfgDate = new Date(formData.mfgDate);
      const expiryDate = new Date(formData.expiryDate);
      if (expiryDate < mfgDate) {
        errors.push('Expiry date must be after manufacturing date');
      }
    }
    
    if (errors.length > 0) {
      const errorMessage = errors.join('\n');
      if (window.showToast) {
        window.showToast(errorMessage, 'error');
      } else {
        alert(errorMessage);
      }
      return;
    }

    // Build productData object - start with original product to preserve all fields
    // Then override only the fields that were changed in the form
    const productData = {
      ...product, // Preserve all original fields (id, _id, createdAt, sellerId, etc.)
      // Update only the fields from form
      name: formData.name.trim(),
      description: formData.description.trim(),
      category: formData.category || '',
      quantity: quantity,
      barcode: formData.barcode || '',
      costPrice: costPrice,
      unitPrice: costPrice, // Backend uses 'unitPrice' field
      sellingPrice: sellingPrice,
      sellingUnitPrice: sellingPrice, // Backend uses 'sellingUnitPrice' field
      quantityUnit: formData.quantityUnit || 'pcs',
      unit: formData.quantityUnit || 'pcs', // Backend uses 'unit' field
      updatedAt: new Date().toISOString()
    };
    
    // Only include mfg and expiryDate if trackExpiry is enabled and dates are provided
    if (trackExpiry && formData.mfgDate && formData.mfgDate.trim() && formData.expiryDate && formData.expiryDate.trim()) {
      productData.mfg = formData.mfgDate.trim();
      productData.mfgDate = formData.mfgDate.trim();
      productData.expiryDate = formData.expiryDate.trim();
    } else {
      // Remove expiry fields if trackExpiry is disabled
      delete productData.mfg;
      delete productData.mfgDate;
      delete productData.expiryDate;
      delete productData.expiry;
    }
    
    // Remove stock field if it exists (use quantity instead)
    delete productData.stock;
    
    // CRITICAL: Ensure id and _id are preserved EXACTLY as they are (don't change type!)
    // IndexedDB uses id as keyPath, so the type must match exactly
    // DO NOT convert to string - preserve the exact type from original product
    productData.id = product.id; // Preserve exact type (string or number)
    if (product._id) {
      productData._id = product._id;
    }
    
    // Ensure sellerId is preserved
    if (product.sellerId) {
      productData.sellerId = product.sellerId;
    }
    
    // Ensure createdAt is preserved
    if (product.createdAt) {
      productData.createdAt = product.createdAt;
    }
    
    console.log('📤 [EditProductModal] Sending product update:', {
      id: productData.id,
      idType: typeof productData.id,
      _id: productData._id,
      name: productData.name,
      originalId: product.id,
      originalIdType: typeof product.id
    });

    onSave(productData);
    if (window.showToast) {
      window.showToast(`Product "${formData.name}" updated successfully.`, 'success');
    }
  };

  const handleScanResult = (result) => {
    if (result && result.trim()) {
      const trimmedBarcode = result.trim();
      setFormData(prev => ({
        ...prev,
        barcode: trimmedBarcode
      }));
      checkBarcodeUniqueness(trimmedBarcode);
      setShowBarcodeScanner(false);
    }
  };
  
  // Handle scanner input - update barcode field (like Billing page)
  const handleBarcodeScan = (barcode) => {
    console.log('Barcode scanned on Edit Product modal:', barcode);
    if (barcode && barcode.trim().length > 0) {
      const trimmedBarcode = barcode.trim();
      setFormData(prev => ({
        ...prev,
        barcode: trimmedBarcode
      }));
      // Check for duplicate barcode
      checkBarcodeUniqueness(trimmedBarcode);
      // Focus on barcode input field
      if (barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    }
  };
  
  // Auto-detect scanner input when edit modal is open (like Billing page)
  useEffect(() => {
    const handleScannerInput = (e) => {
      // Ignore if user is typing in an input field (except barcode input)
      const target = e.target;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const isBarcodeInput = target === barcodeInputRef.current;
      
      // If typing in other input fields, ignore
      if (isInputField && !isBarcodeInput) {
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
              // Focus on barcode input
              if (barcodeInputRef.current) {
                barcodeInputRef.current.focus();
              }
              // Update barcode field
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
          if (barcodeInputRef.current) {
            barcodeInputRef.current.focus();
          }
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
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 sticky top-0 bg-white rounded-t-xl">
          <div className="flex items-center">
            <div className="p-1.5 sm:p-2 bg-blue-100 rounded-lg mr-2 sm:mr-3">
              <Package className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Edit Product</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Product Name *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="input-field"
                placeholder="Enter product name"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category
              </label>
            <div className="flex gap-2">
              <select
                name="category"
                value={formData.category}
                onChange={handleChange}
                className="input-field flex-1"
              >
                <option value="">Select Category</option>
                {state.categories
                  .filter(cat => {
                    const sellerId = getSellerIdFromAuth();
                    return !cat.sellerId || (sellerId && cat.sellerId === sellerId);
                  })
                  .map(cat => (cat.name || '').toLowerCase())
                  .filter(Boolean)
                  .sort()
                  .map(cat => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ')}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={() => setShowCreateCategory(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2 whitespace-nowrap"
                title="Create New Category"
              >
                New
              </button>
            </div>
            </div>
          </div>

          <div className="space-y-4 sm:space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description *
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                className="input-field"
                rows={3}
                placeholder="Enter product description"
                required
              />
            </div>
            <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 select-none">
              <input
                id="trackExpiry"
                type="checkbox"
                checked={trackExpiry}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setTrackExpiry(checked);
                  if (!checked) {
                    setFormData(prev => ({
                      ...prev,
                      mfgDate: '',
                      expiryDate: ''
                    }));
                  }
                }}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Track product expiry
            </label>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cost Price (₹) *
              </label>
              <input
                type="text"
                name="costPrice"
                value={formData.costPrice}
                onChange={handleChange}
                className="input-field"
                placeholder="0.00"
                inputMode="decimal"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selling Price (₹) *
              </label>
              <input
                type="text"
                name="sellingPrice"
                value={formData.sellingPrice}
                onChange={handleChange}
                className="input-field"
                placeholder="0.00"
                inputMode="decimal"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quantity Unit *
              </label>
              <select
                name="quantityUnit"
                value={formData.quantityUnit || 'pcs'}
                onChange={handleChange}
                className="input-field"
                required
              >
                <option value="pcs">Pieces (pcs)</option>
                <option value="kg">Kilograms (kg)</option>
                <option value="gm">Grams (gm)</option>
                <option value="liters">Liters (L)</option>
                <option value="ml">Milliliters (mL)</option>
                <option value="boxes">Boxes</option>
                <option value="packets">Packets</option>
                <option value="bottles">Bottles</option>
              </select>
            </div>
          </div>

          {/* Inventory */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quantity *
              </label>
              <input
                type="text"
                name="quantity"
                value={formData.quantity}
                onChange={handleChange}
                onWheel={(e) => e.currentTarget.blur()}
                className="input-field"
                placeholder="0"
                inputMode="decimal"
                required
              />
            </div>

            {trackExpiry && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Manufacturing Date (MFG) *
                  </label>
                  <input
                    type="date"
                    name="mfgDate"
                    value={formData.mfgDate}
                    onChange={handleChange}
                    className="input-field"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Expiry Date *
                  </label>
                  <input
                    type="date"
                    name="expiryDate"
                    value={formData.expiryDate}
                    onChange={handleChange}
                    className="input-field"
                    required
                  />
                </div>
              </>
            )}
          </div>

          {/* Barcode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Barcode
            </label>
            <div className="relative">
              <input
                ref={barcodeInputRef}
                type="text"
                name="barcode"
                value={formData.barcode}
                onChange={handleChange}
                className={`input-field w-full pr-12 ${barcodeError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                placeholder="Enter barcode or scan"
              />
              <button
                type="button"
                onClick={() => setShowBarcodeScanner(true)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white border border-primary-500 text-primary-600 rounded-lg hover:bg-primary-50 transition-colors"
                title="Scan with camera"
              >
                <QrCode className="h-4 w-4" />
              </button>
            </div>
            {barcodeError && (
              <p className="mt-1 text-sm text-red-600">{barcodeError}</p>
            )}
          </div>

        {/* Camera Barcode Scanner */}
        {showBarcodeScanner && (
          <BarcodeScanner
            onScan={(barcode) => {
              if (barcode && barcode.trim()) {
                const trimmedBarcode = barcode.trim();
                setFormData(prev => ({ ...prev, barcode: trimmedBarcode }));
                checkBarcodeUniqueness(trimmedBarcode);
                // Focus on barcode input field
                if (barcodeInputRef.current) {
                  barcodeInputRef.current.focus();
                }
              }
              setShowBarcodeScanner(false);
            }}
            onClose={() => setShowBarcodeScanner(false)}
          />
        )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-4 sm:pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary w-full sm:w-auto order-2 sm:order-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary w-full sm:w-auto order-1 sm:order-2"
            >
              Update Product
            </button>
          </div>
        </form>
        {/* Create Category Modal */}
        {showCreateCategory && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <div className="flex items-center">
                  <div className="p-2 bg-blue-100 rounded-lg mr-3">
                    {/* reuse Camera icon space, keep simple */}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Create New Category</h3>
                </div>
                <button
                  onClick={() => { setShowCreateCategory(false); setNewCategoryName(''); }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Close modal"
                >
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Category Name *</label>
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    className="input-field w-full"
                    placeholder="Enter category name"
                    onKeyPress={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory(); } }}
                    autoFocus
                  />
                </div>
                <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                  <button type="button" onClick={() => { setShowCreateCategory(false); setNewCategoryName(''); }} className="btn-secondary">Cancel</button>
                  <button type="button" onClick={handleCreateCategory} className="btn-primary">Create & Select</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditProductModal;


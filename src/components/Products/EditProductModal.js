import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Package, Camera, QrCode, Plus, ScanLine, RefreshCw } from 'lucide-react';
import { useApp, isPlanExpired, ActionTypes } from '../../context/AppContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getSellerIdFromAuth } from '../../utils/api';
import BarcodeScanner from '../BarcodeScanner/BarcodeScanner';
import { getTranslation } from '../../utils/translations';

const EditProductModal = ({ product, onClose, onSave }) => {
  const { state, dispatch } = useApp();

  // Last line of defense: close modal if plan is restricted
  useEffect(() => {
    if (isPlanExpired(state)) {
      if (onClose) onClose();
      if (window.showToast) {
        window.showToast('Access Restricted: A base subscription plan is required.', 'warning');
      }
    }
  }, [state, onClose]);

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

  const [formData, setFormData] = useState({
    name: product.name || '',
    description: product.description || '',
    category: product.categoryId || product.category || '', // Use categoryId if available, fallback to category
    barcode: product.barcode || '',
    unit: product.unit || 'pcs',
    lowStockLevel: product.lowStockLevel || 10,
    trackExpiry: Boolean(product.trackExpiry),
    isActive: Boolean(product.isActive)
  });
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Handle closing animation
  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };

  // Focus trap for accessibility
  const { containerRef } = useFocusTrap();
  const [barcodeError, setBarcodeError] = useState('');

  // Filter categories by current seller
  const currentSellerId = getSellerIdFromAuth();
  const allCategories = state.categories
    .filter(cat => !cat.sellerId || (currentSellerId && cat.sellerId === currentSellerId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Scanner input detection refs (like Billing page)
  const scannerInputBufferRef = useRef('');
  const scannerInputTimerRef = useRef(null);
  const lastKeyTimeRef = useRef(0);
  const barcodeInputRef = useRef(null);
  const scannerRef = useRef(null);

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
    setFormData(prev => ({ ...prev, category: newCategory.id }));
    setNewCategoryName('');
    setShowCreateCategory(false);
    if (window.showToast) window.showToast(`Category "${name}" created and selected`, 'success');
  };

  const handleChange = (e) => {
    const { name } = e.target;
    let { value } = e.target;

    // Validation for lowStockLevel
    if (name === 'lowStockLevel') {
      const numericValue = Number(value);
      if (value !== '' && (!Number.isFinite(numericValue) || numericValue < 0)) {
        return; // Reject invalid input
      }
      value = numericValue;
    }

    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    // Search for product by barcode when barcode changes
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

    // Validation according to Product schema requirements
    const errors = [];

    // Required fields from Product schema: name, unit
    if (!formData.name || !formData.name.trim()) {
      errors.push('Product name is required');
    }

    if (!formData.unit || !formData.unit.trim()) {
      errors.push('Unit is required');
    }

    // Validate lowStockLevel if provided
    if (formData.lowStockLevel !== undefined && formData.lowStockLevel !== null) {
      const lowStockValue = Number(formData.lowStockLevel);
      if (!Number.isFinite(lowStockValue) || lowStockValue < 0) {
        errors.push('Low stock level must be a valid number and 0 or greater');
      }
    }

    // Note: Date validation is not needed at product level - dates are only required when creating batches

    // Description is now optional

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
    // Note: Date validation is not needed at product level - dates are only required when creating batches

    if (errors.length > 0) {
      const errorMessage = errors.join('\n');
      if (window.showToast) {
        window.showToast(errorMessage, 'error');
      } else {
        alert(errorMessage);
      }
      return;
    }

    // Build productData object with only Product schema fields
    const productData = {
      name: formData.name.trim(),
      barcode: formData.barcode ? formData.barcode.trim() : '',
      categoryId: formData.category || null, // Already contains the category ObjectId
      unit: formData.unit,
      lowStockLevel: Number(formData.lowStockLevel) || 10,
      trackExpiry: Boolean(formData.trackExpiry),
      description: formData.description ? formData.description.trim() : '',
      isActive: Boolean(formData.isActive)
    };

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
    }
  };

  // Handle scanner input - update barcode field (like Billing page)
  const handleBarcodeScan = (barcode) => {

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
      // Only process scanner input when NOT actively typing in the barcode field
      const target = e.target;
      const isBarcodeInput = target === barcodeInputRef.current;

      // If user is actively typing in the barcode input (has focus and cursor), don't treat as scanner input
      if (isBarcodeInput && target === document.activeElement) {
        // User is manually typing in barcode field - don't interfere
        scannerInputBufferRef.current = ''; // Clear any buffered input
        return;
      }

      // Ignore if user is typing in any other input field
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (isInputField) {
        return;
      }

      // Check if it's a printable character
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now();
        const timeSinceLastKey = now - lastKeyTimeRef.current;

        // If keys are coming very fast (< 50ms apart), it's likely a scanner
        if (timeSinceLastKey < 50 || scannerInputBufferRef.current.length === 0) {
          scannerInputBufferRef.current += e.key;
          lastKeyTimeRef.current = now;

          // Clear existing timer
          if (scannerInputTimerRef.current) {
            clearTimeout(scannerInputTimerRef.current);
          }

          // Set timer to process scanner input after a delay
          scannerInputTimerRef.current = setTimeout(() => {
            const scannedCode = scannerInputBufferRef.current.trim();
            if (scannedCode.length > 0) {

              // Update barcode field
              handleBarcodeScan(scannedCode);
              // Clear buffer
              scannerInputBufferRef.current = '';
            }
          }, 200);
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

  // Handle null product case
  if (!product) {

    return null;
  }

  return (
    <div
      className={`fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
      onClick={handleCloseModal}
    >
      <style>{`
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
        ref={containerRef}
        key={isClosing ? 'closing' : 'opening'}
        style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.4s ease-out forwards` }}
        className="bg-white dark:bg-slate-800 rounded-none sm:rounded-xl shadow-xl w-full max-w-2xl h-auto max-h-[95vh] sm:h-auto sm:max-h-[95vh] overflow-y-auto relative"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-product-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 rounded-t-xl z-10 transition-colors">
          <div className="flex items-center">
            <div className="p-1.5 sm:p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg mr-2 sm:mr-3">
              <Package className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 id="edit-product-title" className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">{getTranslation('editProduct', state.currentLanguage)}</h2>
          </div>
          <button
            onClick={handleCloseModal}
            data-modal-close
            className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5 text-gray-500 dark:text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                {getTranslation('productNameLabel', state.currentLanguage)}
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="input-field"
                placeholder={getTranslation('enterProductName', state.currentLanguage)}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                {getTranslation('categoryHeader', state.currentLanguage)}
              </label>
              <div className="flex gap-2">
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  className="input-field flex-1"
                >
                  <option value="">
                    {allCategories.length === 0 ? getTranslation('noCategoriesYet', state.currentLanguage) : getTranslation('selectCategory', state.currentLanguage)}
                  </option>
                  {allCategories.map((cat) => (
                    <option key={cat.id || cat._id} value={cat.id || cat._id}>
                      {cat.name || ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowCreateCategory(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2 whitespace-nowrap"
                  title={getTranslation('createNewCategory', state.currentLanguage)}
                >
                  {getTranslation('new', state.currentLanguage)}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4 sm:space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                {getTranslation('descriptionHeader', state.currentLanguage)}
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                className="input-field"
                rows={3}
                placeholder={getTranslation('enterProductDescription', state.currentLanguage)}
              />
            </div>
            <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50 px-3 py-2 text-sm text-gray-600 dark:text-slate-300 select-none">
              <input
                id="trackExpiry"
                type="checkbox"
                checked={formData.trackExpiry}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setFormData(prev => ({
                    ...prev,
                    trackExpiry: checked
                  }));
                }}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              {getTranslation('trackProductExpiry', state.currentLanguage)}
            </label>
          </div>

          {/* Product Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                {getTranslation('unitLabel', state.currentLanguage)}
              </label>
              <select
                name="unit"
                value={formData.unit || 'pcs'}
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

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                {getTranslation('lowStockLevelLabel', state.currentLanguage)}
              </label>
              <input
                type="text"
                inputMode="decimal"
                name="lowStockLevel"
                value={formData.lowStockLevel}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '' || /^[0-9]*\.?[0-9]*$/.test(value)) {
                    handleChange(e);
                  }
                }}
                className="input-field"
                placeholder="10"
              />
            </div>
          </div>

          {/* Barcode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              {getTranslation('barcodeHeader', state.currentLanguage)}
            </label>
            <div className="relative">
              <input
                ref={barcodeInputRef}
                type="text"
                name="barcode"
                value={formData.barcode}
                onChange={handleChange}
                className={`input-field w-full pr-12 ${barcodeError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                placeholder={getTranslation('enterOrScanBarcode', state.currentLanguage)}
              />
              <button
                type="button"
                onClick={() => setShowBarcodeScanner(true)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white dark:bg-slate-800 border border-primary-500 text-primary-600 rounded-lg hover:bg-primary-50 dark:hover:bg-slate-700 transition-colors"
                title={getTranslation('scanWithCamera', state.currentLanguage)}
              >
                <QrCode className="h-4 w-4" />
              </button>
            </div>
            {barcodeError && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{barcodeError}</p>
            )}
          </div>

          {showBarcodeScanner && ReactDOM.createPortal(
            <div className="fixed inset-0 z-[99999] bg-black overflow-y-auto">
              <div className="min-h-screen flex flex-col items-center justify-between p-4 py-8">
                {/* Header with Close */}
                <div className="w-full max-w-md flex items-center justify-between mb-6">
                  <h2 className="text-white font-bold text-lg flex items-center gap-2">
                    <ScanLine className="h-5 w-5 text-indigo-400" />
                    {getTranslation('scanProduct', state.currentLanguage) || 'Scan Product'}
                  </h2>
                  <button
                    onClick={() => setShowBarcodeScanner(false)}
                    className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-all backdrop-blur-sm"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>

                {/* Scanner Area - Centered Square like Billing */}
                <div className="w-full max-w-md aspect-square bg-black relative shrink-0 rounded-2xl overflow-hidden shadow-2xl border border-white/10">
                  <BarcodeScanner
                    ref={scannerRef}
                    onScan={(barcode) => {
                      if (barcode && barcode.trim()) {
                        const trimmedBarcode = barcode.trim();
                        setFormData(prev => ({ ...prev, barcode: trimmedBarcode }));
                        checkBarcodeUniqueness(trimmedBarcode);
                        // Focus on barcode input field
                        if (barcodeInputRef.current) {
                          barcodeInputRef.current.focus();
                        }
                        // Close scanner after successful scan in product forms
                        setShowBarcodeScanner(false);
                      }
                    }}
                    onClose={() => setShowBarcodeScanner(false)}
                    inline={true}
                    keepOpen={false}
                    enableTorch={false} // Disable flash
                    hideControls={true}
                  />

                  {/* Laser Overlay - Centered and Responsive */}
                  {/* Laser Overlay - Simple Full Frame */}
                  <div className="absolute inset-0 pointer-events-none border-2 border-indigo-500/50 rounded-xl z-10 m-0">
                    <div className="w-full h-0.5 bg-red-500 absolute top-1/2 -translate-y-1/2 animate-laser shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div>

                    {/* Corner Markers - Optional if border-2 is enough, but keeping for style */}
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-indigo-500 -mt-1 -ml-1 rounded-tl-sm"></div>
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-indigo-500 -mt-1 -mr-1 rounded-tr-sm"></div>
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-indigo-500 -mb-1 -ml-1 rounded-bl-sm"></div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-indigo-500 -mb-1 -mr-1 rounded-br-sm"></div>
                  </div>

                  {/* Bottom Hint */}
                  <div className="absolute top-12 left-0 right-0 text-center z-20 pointer-events-none">
                    <p className="text-white/90 text-sm font-semibold drop-shadow-md bg-black/40 backdrop-blur-sm px-4 py-1.5 rounded-full inline-block">
                      Align barcode within the frame
                    </p>
                  </div>
                </div>

                {/* Bottom Controls */}
                <div className="w-full max-w-md flex flex-col items-center gap-6">
                  <div className="text-white/50 text-sm text-center max-w-xs">
                    Scanning will automatically fill the barcode field.
                  </div>

                  <button
                    onClick={() => scannerRef.current?.switchCamera()}
                    className="flex items-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-full border border-white/10 backdrop-blur-md transition-all shadow-lg"
                  >
                    <RefreshCw className="h-5 w-5" />
                    <span className="font-semibold text-sm">Switch Camera</span>
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-4 sm:pt-6 border-t border-gray-200 dark:border-slate-700">
            <button
              type="button"
              onClick={handleCloseModal}
              className="btn-secondary w-full sm:w-auto order-2 sm:order-1"
            >
              {getTranslation('cancel', state.currentLanguage)}
            </button>
            <button
              type="submit"
              className="btn-primary w-full sm:w-auto order-1 sm:order-2"
            >
              {getTranslation('updateProduct', state.currentLanguage)}
            </button>
          </div>
        </form>
        {/* Create Category Modal */}
        {
          showCreateCategory && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4 transition-opacity">
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md transition-all">
                <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
                  <div className="flex items-center">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg mr-3">
                      <Plus className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{getTranslation('createNewCategory', state.currentLanguage)}</h3>
                  </div>
                  <button
                    onClick={() => { setShowCreateCategory(false); setNewCategoryName(''); }}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    aria-label="Close modal"
                  >
                    <X className="h-5 w-5 text-gray-500 dark:text-slate-400" />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">{getTranslation('categoryNameLabel', state.currentLanguage)}</label>
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      className="input-field w-full"
                      placeholder={getTranslation('categoryPlaceholder', state.currentLanguage)}
                      onKeyPress={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory(); } }}
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-slate-700">
                    <button type="button" onClick={() => { setShowCreateCategory(false); setNewCategoryName(''); }} className="btn-secondary">{getTranslation('cancel', state.currentLanguage)}</button>
                    <button type="button" onClick={handleCreateCategory} className="btn-primary">{getTranslation('createSelect', state.currentLanguage)}</button>
                  </div>
                </div>
              </div>
            </div>
          )
        }
      </div >
    </div >
  );
};

export default EditProductModal;

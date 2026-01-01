import React, { useState, useEffect, useRef } from 'react';
import { X, Package, Plus, AlertTriangle, QrCode, Minimize2, Save, Minus } from 'lucide-react';
import { useApp, isPlanExpired, ActionTypes } from '../../context/AppContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getSellerIdFromAuth } from '../../utils/api';
import BarcodeScanner from '../BarcodeScanner/BarcodeScanner';
import { getTranslation } from '../../utils/translations';
import { canAddData, getLimitErrorMessage, DataCreationManager, getPlanLimits } from '../../utils/planUtils';

const AddProductModal = ({
  onClose,
  onSave,
  scannedBarcode = '',
  planLimitError = '',
  onClearPlanLimitError
}) => {
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

  // Ensure scannedBarcode is always a string (not an object)
  // Handle case where scannedBarcode might be an object or invalid value
  const getBarcodeValue = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    // If it's an object, try to extract a meaningful value or return empty string
    if (typeof value === 'object') {
      // Check common object properties that might contain barcode
      if (value.barcode && typeof value.barcode === 'string') return value.barcode.trim();
      if (value.code && typeof value.code === 'string') return value.code.trim();
      // If no valid property found, return empty string instead of [object Object]
      return '';
    }
    return '';
  };

  const normalizedScannedBarcode = getBarcodeValue(scannedBarcode);

  // Load saved product data from localStorage
  const loadSavedProductData = () => {
    try {
      const saved = localStorage.getItem('addProduct_saved');
      if (saved) {
        const parsedData = JSON.parse(saved);
        // Validate that we have a product object with required structure
        if (parsedData && typeof parsedData === 'object') {

          return {
            ...parsedData,
            // Only override barcode if there's a new scanned barcode, otherwise keep saved barcode
            barcode: normalizedScannedBarcode || parsedData.barcode || ''
          };
        }
      }
    } catch (error) {

      // Clear corrupted data
      localStorage.removeItem('addProduct_saved');
    }
    // Return default data

    return {
      name: '',
      description: '',
      category: '',
      barcode: normalizedScannedBarcode || '', // Use scanned barcode if provided
      unit: 'pcs',
      lowStockLevel: 10,
      trackExpiry: false,
      isActive: true
    };
  };

  const [formData, setFormData] = useState(loadSavedProductData());

  // Focus trap for accessibility
  const { containerRef } = useFocusTrap();
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [trackExpiry, setTrackExpiry] = useState(false);
  const [barcodeError, setBarcodeError] = useState('');
  const [limitError, setLimitError] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  // Handle closing animation
  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };

  // Scanner input handling refs
  const scannerInputBufferRef = useRef('');
  const scannerInputTimerRef = useRef(null);
  const lastKeyTimeRef = useRef(0);
  const barcodeInputRef = useRef(null);

  // Update barcode when scannedBarcode prop changes (only if there's an actual barcode)
  useEffect(() => {
    const barcodeValue = getBarcodeValue(scannedBarcode);
    if (barcodeValue) {
      setFormData(prev => ({ ...prev, barcode: barcodeValue }));
    }
  }, [scannedBarcode]);

  // Handle scanner input - update barcode field
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

  // Auto-detect scanner input when add modal is open
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

  // Filter categories by current seller
  const currentSellerId = getSellerIdFromAuth();
  const allCategories = state.categories
    .filter(cat => !cat.sellerId || (currentSellerId && cat.sellerId === currentSellerId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) {
      if (window.showToast) {
        window.showToast('Please enter a category name', 'error');
      } else {
        alert('Please enter a category name');
      }
      return;
    }

    const trimmedName = newCategoryName.trim().toLowerCase();

    // Check if category already exists
    if (allCategories.some(cat => (cat.name || '').toLowerCase() === trimmedName)) {
      if (window.showToast) {
        window.showToast('Category already exists', 'warning');
      } else {
        alert('Category already exists');
      }
      return;
    }

    // Create category object and save to IndexedDB
    const newCategory = {
      id: `cat-${Date.now()}`,
      name: trimmedName,
      createdAt: new Date().toISOString(),
      sellerId: currentSellerId
    };

    // Dispatch to save category to IndexedDB
    dispatch({ type: ActionTypes.ADD_CATEGORY, payload: newCategory });

    // Set the new category and close the modal
    setFormData(prev => ({ ...prev, category: newCategory.id }));
    setNewCategoryName('');
    setShowCreateCategory(false);

    if (window.showToast) {
      window.showToast(`Category "${trimmedName}" created and selected`, 'success');
    }
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

    if (planLimitError && onClearPlanLimitError) {
      onClearPlanLimitError();
    }
    // Clear limit error when user types
    if (limitError) {
      setLimitError('');
    }

    // Search for product by barcode when barcode changes
    if (name === 'barcode' && value.trim()) {
      searchProductByBarcode(value);
      // Check for duplicate barcode
      checkBarcodeUniqueness(value);
    } else if (name === 'barcode' && !value.trim()) {
      // Clear error if barcode is empty
      setBarcodeError('');
    }
  };

  // Check if barcode is unique
  const checkBarcodeUniqueness = (barcode) => {
    if (!barcode || !barcode.trim()) {
      setBarcodeError('');
      return;
    }

    const trimmedBarcode = barcode.trim();
    const existingProduct = state.products.find(p =>
      p.barcode && p.barcode.trim() === trimmedBarcode && !p.isDeleted
    );

    if (existingProduct) {
      setBarcodeError(`Barcode already exists for product "${existingProduct.name}"`);
    } else {
      setBarcodeError('');
    }
  };

  // Search for existing product by barcode
  const searchProductByBarcode = (barcode) => {
    if (!barcode.trim()) return;

    // Search in existing products
    const existingProduct = state.products.find(p => p.barcode === barcode);

    if (existingProduct) {
      // Auto-fill product details if found
      setFormData(prev => ({
        ...prev,
        name: existingProduct.name,
        description: existingProduct.description || '',
        category: existingProduct.category || '',
        costPrice: existingProduct.costPrice || '',
        sellingPrice: existingProduct.sellingPrice || '',
        quantityUnit: existingProduct.quantityUnit || existingProduct.unit || 'pcs'
      }));
      setTrackExpiry(Boolean(existingProduct.trackExpiry));

      // Show notification
      if (window.showToast) {
        window.showToast(`Product "${existingProduct.name}" found! Details auto-filled.`, 'success');
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Check distributed plan limit BEFORE validation
    const activeProducts = state.products.filter(product => !product.isDeleted);
    const totalProducts = activeProducts.length;
    const canAdd = await canAddData(totalProducts, 'products', state.aggregatedUsage, state.currentPlan, state.currentPlanDetails);

    if (!canAdd) {
      const limitMessage = getLimitErrorMessage('products', state.aggregatedUsage);

      setLimitError(limitMessage);
      if (window.showToast) {
        window.showToast(limitMessage, 'error', 5000);
      }
      return;
    }

    // Clear limit error if we can add
    setLimitError('');

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

    // Description is now optional

    // Validate barcode uniqueness - no duplicate barcodes allowed
    if (formData.barcode && formData.barcode.trim()) {
      const trimmedBarcode = formData.barcode.trim();
      const existingProduct = state.products.find(p =>
        p.barcode && p.barcode.trim() === trimmedBarcode && !p.isDeleted
      );

      if (existingProduct) {
        errors.push(`Barcode "${trimmedBarcode}" already exists for product "${existingProduct.name}". Each product must have a unique barcode.`);
      }
    }

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

    onSave(productData);
    // Clear saved data on successful save (similar to bulk modal)
    localStorage.removeItem('addProduct_saved');
    if (window.showToast) {
      window.showToast(`Product "${formData.name}" added successfully.`, 'success');
    }
  };

  // Save current form data to localStorage and close modal
  const handleMinimize = () => {
    try {
      // Check if there's any meaningful data to save
      const hasData = formData.name?.trim() ||
        formData.description?.trim() ||
        formData.category?.trim() ||
        (formData.barcode && formData.barcode.trim()) ||
        formData.unit !== 'pcs' ||
        formData.lowStockLevel !== 10 ||
        formData.trackExpiry;

      if (hasData) {
        // Save current form data - preserve all fields as-is
        const dataToSave = {
          ...formData
        };
        localStorage.setItem('addProduct_saved', JSON.stringify(dataToSave));

      } else {
        // No meaningful data, remove any existing saved data
        localStorage.removeItem('addProduct_saved');

      }

      onClose(); // Close the modal (this line was effectively replaced by handleMinimize logic, but kept for clarity in diff)
      // Actually within handleMinimize we should use handleCloseModal now if we want animation there too.
      // But handleMinimize calls onClose directly in original code... let's update handleMinimize to call handleCloseModal?
      // Wait, handleMinimize is above. The previous replacement chunk handled the catch block. This is inside try block.
      handleCloseModal();
    } catch (error) {

      // Still close the modal even if save fails
      handleCloseModal();
    }
  };

  const handleScanResult = (result) => {
    if (result && result.trim()) {
      const trimmedBarcode = result.trim();
      setFormData(prev => ({
        ...prev,
        barcode: trimmedBarcode
      }));
      // Check for duplicate barcode
      checkBarcodeUniqueness(trimmedBarcode);
      // Also search for existing product
      searchProductByBarcode(trimmedBarcode);
    }
  };

  // Note: Scanner integration would be implemented here
  // For now, this is a placeholder for future barcode scanning functionality

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
        aria-labelledby="add-product-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 rounded-t-xl z-10 transition-colors">
          <div className="flex items-center">
            <div className="p-1.5 sm:p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg mr-2 sm:mr-3">
              <Package className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 id="add-product-title" className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">{getTranslation('addNewProduct', state.currentLanguage)}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMinimize}
              className="p-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 transition-colors rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700"
              aria-label="Save and close modal"
              title={getTranslation('minimizeDesc', state.currentLanguage)}
            >
              <Minus className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('addProduct_saved');
                handleCloseModal();
              }}
              data-modal-close
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors rounded-lg hover:bg-white dark:hover:bg-slate-700"
              aria-label="Close without saving"
              title={getTranslation('closeWithoutSaving', state.currentLanguage)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Real-time limit display */}
          {(() => {
            const activeProducts = state.products.filter(product => !product.isDeleted);
            const totalProducts = activeProducts.length;
            const { maxProducts } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
            const remaining = maxProducts === Infinity ? Infinity : Math.max(0, maxProducts - totalProducts);

            if (remaining >= 15 || maxProducts === Infinity) return null;

            return (
              <div className="text-sm font-medium text-center p-2 rounded-lg bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border border-red-100 dark:border-red-800">
                ({getTranslation('productLimitLeft', state.currentLanguage)}: {remaining} left)
              </div>
            );
          })()}

          {(planLimitError || limitError) && (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-gradient-to-r from-red-50 via-red-100 to-red-50 dark:from-red-900/20 dark:via-red-900/30 dark:to-red-900/20 p-4 shadow-md">
              <div className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10 dark:bg-red-500/20 text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">{getTranslation('limitFull', state.currentLanguage)}</p>
                  <p className="mt-1 text-xs text-red-700 dark:text-red-400 leading-relaxed">
                    {limitError || planLimitError}
                  </p>
                </div>
              </div>
            </div>
          )}
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
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">{getTranslation('new', state.currentLanguage)}</span>
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
                checked={trackExpiry}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setTrackExpiry(checked);
                  // No need to clear dates since they're not part of product form
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
              {getTranslation('addProduct', state.currentLanguage)}
            </button>
          </div>
        </form>

        {/* Camera Barcode Scanner */}
        {showBarcodeScanner && (
          <BarcodeScanner
            onScan={(barcode) => {
              if (barcode && barcode.trim()) {
                const trimmedBarcode = barcode.trim();
                setFormData(prev => ({ ...prev, barcode: trimmedBarcode }));
                checkBarcodeUniqueness(trimmedBarcode);
                searchProductByBarcode(trimmedBarcode);
                // Close scanner after successful scan in product forms
                setShowBarcodeScanner(false);
              }
            }}
            onClose={() => setShowBarcodeScanner(false)}
            keepOpen={false}
          />
        )}

        {/* Create Category Modal */}
        {showCreateCategory && (
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
                  onClick={() => {
                    setShowCreateCategory(false);
                    setNewCategoryName('');
                  }}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  aria-label="Close modal"
                >
                  <X className="h-5 w-5 text-gray-500 dark:text-slate-400" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                    {getTranslation('categoryNameLabel', state.currentLanguage)}
                  </label>
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    className="input-field w-full"
                    placeholder={getTranslation('categoryPlaceholder', state.currentLanguage)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateCategory();
                      }
                    }}
                    autoFocus
                  />
                  <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                    Category will be saved and can be used for future products
                  </p>
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateCategory(false);
                      setNewCategoryName('');
                    }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateCategory}
                    className="btn-primary"
                  >
                    Create & Select
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AddProductModal;

import React, { useState, useRef, useEffect } from 'react';
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
  FileText,
  FileSpreadsheet,
  FileJson
} from 'lucide-react';
import AddProductModal from './AddProductModal';
import EditProductModal from './EditProductModal';
import { getPlanLimits, canAddProduct } from '../../utils/planUtils';
import { getSellerIdFromAuth } from '../../utils/api';

const Products = () => {
  const { state, dispatch } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [planLimitMessage, setPlanLimitMessage] = useState('');
  const [productPendingDelete, setProductPendingDelete] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef(null);

  const itemsPerPage = 10;

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

  const openAddProductModal = () => {
    if (atProductLimit) {
      showProductLimitWarning();
      return;
    }
    setPlanLimitMessage('');
    setShowAddModal(true);
  };

  // Pagination
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + itemsPerPage);

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

    const newProduct = {
      id: Date.now().toString(),
      ...productData,
      createdAt: new Date().toISOString()
    };
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
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 z-50 py-2">
                <button
                  onClick={exportProductsPDF}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <FileText className="h-4 w-4 text-red-600" />
                  <span>Export as PDF</span>
                </button>
                <button
                  onClick={exportProductsJSON}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <FileJson className="h-4 w-4 text-yellow-600" />
                  <span>Export as JSON</span>
                </button>
                <button
                  onClick={exportProductsCSV}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <FileSpreadsheet className="h-4 w-4 text-green-600" />
                  <span>Export as CSV</span>
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
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
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
                      <div className="ml-4 min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 break-words">{product.name}</div>
                        <div className="text-sm text-gray-500 break-words">{product.description || 'No description'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
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
                    {product.barcode || 'N/A'}
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
          <div className="flex flex-col sm:flex-row items-center justify-between mt-6 space-y-3 sm:space-y-0 px-2 sm:px-0">
            <div className="text-xs sm:text-sm text-gray-700 text-center sm:text-left">
              Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, filteredProducts.length)} of {filteredProducts.length} results
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 text-xs sm:text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="px-3 py-2 text-xs sm:text-sm font-medium text-gray-700">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 text-xs sm:text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Products Cards - Mobile View */}
      <div className="md:hidden space-y-3">
        {paginatedProducts.map((product) => (
          <div key={product.id} className="card">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3 flex-1">
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
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 break-words">{product.name}</div>
                  <div className="text-xs text-gray-500 line-clamp-2 break-words">{product.description || 'No description'}</div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
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
          <div className="flex flex-col items-center justify-between space-y-3 pt-2">
            <div className="text-xs text-gray-700 text-center">
              Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, filteredProducts.length)} of {filteredProducts.length} results
            </div>
            <div className="flex items-center space-x-2 w-full">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="flex-1 px-4 py-2 text-xs font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="px-3 py-2 text-xs font-medium text-gray-700 whitespace-nowrap">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="flex-1 px-4 py-2 text-xs font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddModal && (
        <AddProductModal
          onClose={() => {
            setShowAddModal(false);
            setPlanLimitMessage('');
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
    </div>
  );
};

export default Products;

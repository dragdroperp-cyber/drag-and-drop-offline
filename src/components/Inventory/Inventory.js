import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import jsPDF from 'jspdf';
import { 
  Package, 
  Filter,
  Download,
  Upload,
  AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Eye,
  Minus,
  Edit,
  Trash2,
  RotateCcw,
  FileText,
  FileSpreadsheet,
  FileJson
} from 'lucide-react';
import { getPathForView } from '../../utils/navigation';

const Inventory = () => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, productId: null, productName: null });
  const exportMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const itemsPerPage = 10;

  const goToView = (view) => {
    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
    navigate(getPathForView(view));
  };

  // Filter and sort products
  const getProductQuantity = (product) => Number(product.quantity ?? product.stock ?? 0) || 0;
  const getProductCostPrice = (product) => Number(product.costPrice ?? product.unitPrice ?? product.price ?? 0) || 0;
  const getProductSellingPrice = (product) => Number(product.sellingPrice ?? product.sellingUnitPrice ?? product.price ?? product.costPrice ?? product.unitPrice ?? 0) || 0;

  const filteredProducts = state.products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         product.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         product.barcode?.includes(searchTerm);
    
    const matchesCategory = !filterCategory || product.category === filterCategory;
    
    const productQuantity = getProductQuantity(product);
    const matchesStatus = !filterStatus || (
      filterStatus === 'low-stock' && productQuantity <= state.lowStockThreshold ||
      filterStatus === 'out-of-stock' && productQuantity === 0 ||
      filterStatus === 'expiring' && product.expiryDate && new Date(product.expiryDate) <= new Date(Date.now() + state.expiryDaysThreshold * 24 * 60 * 60 * 1000)
    );
    
    return matchesSearch && matchesCategory && matchesStatus;
  }).sort((a, b) => {
    let aValue = a[sortBy];
    let bValue = b[sortBy];
    
    if (sortBy === 'stock' || sortBy === 'quantity') {
      aValue = getProductQuantity(a);
      bValue = getProductQuantity(b);
    }

    if (sortBy === 'price') {
      aValue = getProductSellingPrice(a);
      bValue = getProductSellingPrice(b);
    }
    
    if (sortOrder === 'asc') {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  // Pagination
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + itemsPerPage);

  // Calculate inventory metrics
  const totalProducts = state.products.length;
  const lowStockProducts = state.products.filter(p => getProductQuantity(p) <= state.lowStockThreshold && getProductQuantity(p) > 0).length;
  const outOfStockProducts = state.products.filter(p => getProductQuantity(p) === 0).length;
  const expiringProducts = state.products.filter(p => {
    if (!p.expiryDate) return false;
    return new Date(p.expiryDate) <= new Date(Date.now() + state.expiryDaysThreshold * 24 * 60 * 60 * 1000);
  }).length;
  const totalValue = state.products.reduce((sum, p) => sum + (getProductQuantity(p) * getProductSellingPrice(p)), 0);

  // Get unique categories
  const categories = [...new Set(state.products.map(p => p.category).filter(Boolean))];

  const getStockStatus = (stock) => {
    if (stock === 0) return { label: 'Out of Stock', color: 'bg-red-100 text-red-800' };
    if (stock <= state.lowStockThreshold) return { label: 'Low Stock', color: 'bg-yellow-100 text-yellow-800' };
    return { label: 'In Stock', color: 'bg-green-100 text-green-800' };
  };

  const downloadFile = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportInventoryCSV = () => {
    try {
      const headers = ['Name', 'Category', 'Quantity', 'Cost Price', 'Selling Price', 'Inventory Value', 'Status', 'Barcode', 'Expiry Date'];
      const escapeValue = (value) => {
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        if (stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        if (stringValue.includes(',') || stringValue.includes('\n')) {
          return `"${stringValue}"`;
        }
        return stringValue;
      };

      const rows = state.products.map((product) => {
        const quantity = getProductQuantity(product);
        const costPrice = getProductCostPrice(product);
        const sellingPrice = getProductSellingPrice(product) || costPrice;
        const value = quantity * sellingPrice;
        const status = getStockStatus(quantity).label;
        return [
          escapeValue(product.name || ''),
          escapeValue(product.category || ''),
          escapeValue(quantity),
          escapeValue(costPrice.toFixed(2)),
          escapeValue(sellingPrice.toFixed(2)),
          escapeValue(value.toFixed(2)),
          escapeValue(status),
          escapeValue(product.barcode || ''),
          escapeValue(product.expiryDate || '')
        ];
      });

      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      downloadFile(
        `inventory-${new Date().toISOString().split('T')[0]}.csv`,
        csvContent,
        'text/csv;charset=utf-8;'
      );
      if (window.showToast) {
        window.showToast('Inventory exported as CSV.', 'success');
      }
    } catch (error) {
      console.error('Error exporting inventory CSV:', error);
      if (window.showToast) {
        window.showToast('Error exporting CSV. Please try again.', 'error');
      }
    }
  };

  const exportInventoryJSON = () => {
    try {
      const data = state.products.map((product) => {
        const quantity = getProductQuantity(product);
        const costPrice = getProductCostPrice(product);
        const sellingPrice = getProductSellingPrice(product) || costPrice;
        return {
          id: product.id,
          name: product.name,
          category: product.category || '',
          quantity,
          costPrice,
          sellingPrice,
          inventoryValue: quantity * sellingPrice,
          status: getStockStatus(quantity).label,
          barcode: product.barcode || '',
          expiryDate: product.expiryDate || ''
        };
      });

      downloadFile(
        `inventory-${new Date().toISOString().split('T')[0]}.json`,
        JSON.stringify(data, null, 2),
        'application/json'
      );
      if (window.showToast) {
        window.showToast('Inventory exported as JSON.', 'success');
      }
    } catch (error) {
      console.error('Error exporting inventory JSON:', error);
      if (window.showToast) {
        window.showToast('Error exporting JSON. Please try again.', 'error');
      }
    }
  };

  const exportInventoryPDF = () => {
    try {
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(18);
      pdf.text('Inventory Report', pageWidth / 2, 15, { align: 'center' });

      pdf.setFontSize(11);
      pdf.text(`${state.username || 'Grocery Store'}  |  Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 22, { align: 'center' });

      pdf.setDrawColor(230);
      pdf.setFillColor(245, 247, 250);
      pdf.rect(10, 28, pageWidth - 20, 18, 'F');
      pdf.setTextColor(60);
      pdf.setFontSize(10);

      const totalProductsMetric = state.products.length;
      const lowStockMetric = state.products.filter(product => {
        const quantity = getProductQuantity(product);
        return quantity > 0 && quantity <= state.lowStockThreshold;
      }).length;
      const outOfStockMetric = state.products.filter(product => getProductQuantity(product) === 0).length;
      const totalValueMetric = state.products.reduce((sum, product) => {
        const quantity = getProductQuantity(product);
        const sellingPrice = getProductSellingPrice(product);
        return sum + quantity * sellingPrice;
      }, 0);

      pdf.text(`Total Products: ${totalProductsMetric}`, 14, 40);
      pdf.text(`Low Stock: ${lowStockMetric}`, 70, 40);
      pdf.text(`Out of Stock: ${outOfStockMetric}`, 120, 40);
      pdf.text(`Inventory Value: ₹${totalValueMetric.toFixed(2)}`, 180, 40);

      const headers = ['#', 'Name', 'Category', 'Qty', 'Cost', 'Price', 'Value', 'Status', 'Barcode', 'Expiry'];
      const colWidths = [12, 68, 42, 20, 26, 26, 32, 30, 40, 38];
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
      const statusColumnIndex = headers.indexOf('Status');

      const drawTableHeader = (yPos) => {
        const headerHeight = 8;
        pdf.setFillColor(234, 238, 243);
        pdf.setDrawColor(210);
        pdf.rect(leftMargin, yPos - headerHeight, tableWidth, headerHeight, 'F');
        pdf.setTextColor(30);
        pdf.setFontSize(9.5);
        headers.forEach((header, idx) => {
          const align = idx >= headers.length - 4 ? 'right' : 'left';
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

      state.products.forEach((product, index) => {
        const quantity = getProductQuantity(product);
        const costPrice = getProductCostPrice(product);
        const sellingPrice = getProductSellingPrice(product) || costPrice;
        const value = quantity * sellingPrice;
        const status = getStockStatus(quantity).label;
        const barcode = product.barcode || '—';
        const expiry = product.expiryDate ? new Date(product.expiryDate).toLocaleDateString() : '—';

        const rowValues = [
          index + 1,
          product.name || '',
          product.category || '',
          quantity,
          `₹${costPrice.toFixed(2)}`,
          `₹${sellingPrice.toFixed(2)}`,
          `₹${value.toFixed(2)}`,
          status,
          barcode,
          expiry
        ];

        const cellLines = rowValues.map((value, idx) => {
        let raw = typeof value === 'string' ? value : String(value);
        raw = raw.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, match => {
          const superscriptDigits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
          return String(superscriptDigits.indexOf(match));
        });
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

        const statusColors = {
          'Out of Stock': { r: 254, g: 226, b: 226 },
          'Low Stock': { r: 255, g: 247, b: 237 },
          'In Stock': { r: 237, g: 247, b: 237 }
        };
        const statusColor = statusColors[status] || baseFill;
        if (statusColumnIndex !== -1) {
          pdf.setFillColor(statusColor.r, statusColor.g, statusColor.b);
          pdf.rect(
            colPositions[statusColumnIndex],
            y - lineHeight + 1,
            colWidths[statusColumnIndex],
            rowHeight,
            'F'
          );
        }

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
          const align = idx >= headers.length - 4 ? 'right' : 'left';
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
        pdf.text(`${state.username || 'Grocery Store'} • Inventory Report`, pageWidth - 12, pageHeight - 8, { align: 'right' });
      }

      pdf.setPage(pageCount);
      pdf.setFontSize(8);
      pdf.setTextColor(100);
      pdf.text('Status legend: In Stock = adequate quantity • Low Stock = below threshold • Out of Stock = zero quantity', 12, pageHeight - 14);

      pdf.save(`inventory-report-${new Date().toISOString().split('T')[0]}.pdf`);
      if (window.showToast) {
        window.showToast('Inventory exported as PDF.', 'success');
      }
    } catch (error) {
      console.error('Error exporting inventory PDF:', error);
      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  };

  const handleEditClick = (product) => {
    dispatch({ type: 'SET_CURRENT_PRODUCT', payload: product });
    goToView('products');
  };

  const handleDeleteProduct = (productId, productName) => {
    setDeleteConfirm({ show: true, productId, productName: productName || 'this product' });
  };

  const confirmDeleteProduct = () => {
    if (deleteConfirm.productId) {
      dispatch({ type: 'DELETE_PRODUCT', payload: deleteConfirm.productId });
      if (window.showToast) {
        window.showToast(`"${deleteConfirm.productName}" has been deleted successfully`, 'success', 4000);
      }
      setDeleteConfirm({ show: false, productId: null, productName: null });
    }
  };

  return (
    <div className="fade-in-up max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Inventory Management</h2>
          <p className="text-gray-600 mt-2">Monitor and manage your product inventory</p>
        </div>
        
        <div className="flex flex-wrap gap-3">
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(prev => !prev)}
              className="btn-secondary flex items-center"
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-slate-200 bg-white/90 shadow-xl backdrop-blur-sm ring-1 ring-black/5 overflow-hidden z-10">
                <button
                  onClick={() => {
                    setShowExportMenu(false);
                    exportInventoryPDF();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-gradient-to-r hover:from-indigo-50 hover:via-sky-50 hover:to-blue-50 transition"
                >
                  <FileText className="h-4 w-4 text-indigo-500" />
                  PDF Report
                </button>
                <button
                  onClick={() => {
                    setShowExportMenu(false);
                    exportInventoryCSV();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-gradient-to-r hover:from-emerald-50 hover:via-teal-50 hover:to-cyan-50 transition"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
                  CSV Spreadsheet
                </button>
                <button
                  onClick={() => {
                    setShowExportMenu(false);
                    exportInventoryJSON();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-gradient-to-r hover:from-amber-50 hover:via-orange-50 hover:to-yellow-50 transition"
                >
                  <FileJson className="h-4 w-4 text-amber-500" />
                  JSON Dataset
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inventory Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="stat-card flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-blue-100 p-3">
              <Package className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Total Products</p>
              <p className="text-2xl font-bold text-gray-900">{totalProducts}</p>
            </div>
          </div>
        </div>

        <div className="stat-card flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-yellow-100 p-3">
              <AlertTriangle className="h-6 w-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Low Stock</p>
              <p className="text-2xl font-bold text-gray-900">{lowStockProducts}</p>
            </div>
          </div>
        </div>

        <div className="stat-card flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-red-100 p-3">
              <Minus className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Out of Stock</p>
              <p className="text-2xl font-bold text-gray-900">{outOfStockProducts}</p>
            </div>
          </div>
        </div>

        <div className="stat-card flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-emerald-100 p-3">
              <TrendingUp className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Inventory Value</p>
              <p className="text-2xl font-bold text-gray-900">₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field"
            />
          </div>
          
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="input-field"
          >
            <option value="">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="input-field"
          >
            <option value="">All Status</option>
            <option value="low-stock">Low Stock</option>
            <option value="out-of-stock">Out of Stock</option>
            <option value="expiring">Expiring Soon</option>
          </select>

          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-');
              setSortBy(field);
              setSortOrder(order);
            }}
            className="input-field"
          >
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="stock-asc">Stock Low-High</option>
            <option value="stock-desc">Stock High-Low</option>
            <option value="price-asc">Price Low-High</option>
            <option value="price-desc">Price High-Low</option>
          </select>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {paginatedProducts.map((product) => {
                const quantity = getProductQuantity(product);
                const productStatus = getStockStatus(quantity);
                const price = getProductSellingPrice(product);
                const totalValue = quantity * price;

                return (
                  <tr key={product.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                          <Package className="h-5 w-5 text-blue-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{product.name}</p>
                          <p className="text-xs text-slate-500">{product.barcode || 'No barcode'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex max-w-[160px] items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 truncate">
                        {product.category || 'Uncategorized'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right font-semibold text-slate-900">{quantity}</td>
                    <td className="px-4 py-4 text-right text-slate-900">₹{price.toFixed(2)}</td>
                    <td className="px-4 py-4 text-right font-semibold text-emerald-600">₹{totalValue.toFixed(2)}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${productStatus.color}`}>
                        {productStatus.label}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {product.expiryDate ? new Date(product.expiryDate).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => handleEditClick(product)}
                          className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50 hover:text-blue-800 transition"
                          title="Edit Product"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(product.id, product.name)}
                          className="rounded-md p-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
                          title="Delete Product"
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

        {/* Empty State */}
        {paginatedProducts.length === 0 && (
          <div className="text-center py-12">
            <Package className="h-16 w-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Products Found</h3>
            <p className="text-gray-600 mb-6">Try adjusting your search or filters</p>
            <button
              onClick={() => goToView('products')}
              className="btn-primary"
            >
              Add First Product
            </button>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6">
            <div className="text-sm text-gray-700">
              Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, filteredProducts.length)} of {filteredProducts.length} results
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="px-3 py-2 text-sm font-medium text-gray-700">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Professional Delete Confirmation Modal */}
      {deleteConfirm.show && (
        <div className="fixed inset-0 z-[1001] flex items-center justify-center p-4" style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center mb-4">
              <div className="p-3 rounded-xl mr-4" style={{ background: 'rgba(251, 113, 133, 0.16)' }}>
                <AlertTriangle className="h-6 w-6" style={{ color: '#BE123C' }} />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Delete Product?</h3>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                  This action cannot be undone
                </p>
              </div>
            </div>
            <div className="mb-6 p-4 rounded-xl" style={{ background: 'var(--surface-alt)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Are you sure you want to delete <span className="font-bold">"{deleteConfirm.productName}"</span>?
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                This product will be permanently removed from your inventory. All associated data will be lost.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm({ show: false, productId: null, productName: null })}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteProduct}
                className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{ 
                  background: 'linear-gradient(135deg, #BE123C, #991F3D)',
                  boxShadow: '0 4px 14px 0 rgba(190, 18, 60, 0.25)'
                }}
              >
                Delete Product
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;




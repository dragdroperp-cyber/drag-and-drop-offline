import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { BarChart3, TrendingUp, Package, Users } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const Reports = () => {
  const { state } = useApp();
  const [reportType, setReportType] = useState('sales');

  const sanitizeNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };

  const normalizeOrderItems = (order) => Array.isArray(order?.items) ? order.items : [];

  const calculateOrderRevenue = (order) => {
    const explicitTotal = sanitizeNumber(order?.totalAmount ?? order?.total);
    if (explicitTotal > 0) return explicitTotal;
    return normalizeOrderItems(order).reduce((sum, item) => {
      const quantity = sanitizeNumber(item?.quantity);
      const sellingPrice = sanitizeNumber(item?.sellingPrice ?? item?.price ?? item?.unitPrice);
      return sum + quantity * sellingPrice;
    }, 0);
  };

  const calculateOrderCost = (order) => {
    return normalizeOrderItems(order).reduce((sum, item) => {
      const quantity = sanitizeNumber(item?.quantity);
      const costPrice = sanitizeNumber(item?.costPrice ?? item?.purchasePrice ?? item?.unitCost ?? item?.basePrice);
      return sum + quantity * costPrice;
    }, 0);
  };

  const completedOrders = (state.orders || []).filter(order => order && order.isDeleted !== true);
  const totalRevenue = completedOrders.reduce((sum, order) => sum + calculateOrderRevenue(order), 0);
  const totalCost = completedOrders.reduce((sum, order) => sum + calculateOrderCost(order), 0);
  const totalProfit = totalRevenue - totalCost;

  // Generate real sales chart data from orders
  const generateSalesChart = () => {
    if (completedOrders.length === 0) {
      return {
        labels: ['No Data'],
        datasets: [
          {
            label: 'Sales',
            data: [0],
            backgroundColor: 'rgba(156, 163, 175, 0.8)',
            borderColor: 'rgba(156, 163, 175, 1)',
            borderWidth: 2,
            borderRadius: 8,
            borderSkipped: false,
          },
        ],
      };
    }

    // Get last 6 months of orders
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    
    const monthlySales = {};
    for (let i = 0; i < 6; i++) {
      const month = new Date(sixMonthsAgo);
      month.setMonth(month.getMonth() + i);
      const monthKey = month.toLocaleDateString('en-US', { month: 'short' });
      monthlySales[monthKey] = 0;
    }

    completedOrders.forEach(order => {
      const orderDate = new Date(order?.createdAt ?? order?.date);
      if (!Number.isNaN(orderDate.getTime()) && orderDate >= sixMonthsAgo) {
        const monthKey = orderDate.toLocaleDateString('en-US', { month: 'short' });
        monthlySales[monthKey] = (monthlySales[monthKey] || 0) + calculateOrderRevenue(order);
      }
    });

    const labels = Object.keys(monthlySales);
    const salesData = Object.values(monthlySales);

    return {
      labels,
      datasets: [
        {
          label: 'Sales (₹)',
          data: salesData,
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderColor: 'rgba(16, 185, 129, 1)',
          borderWidth: 2,
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    };
  };

  const generateInventoryChart = () => {
    if (state.products.length === 0) {
      return {
        labels: ['No Data'],
        datasets: [
          {
            label: 'Stock Quantity',
            data: [0],
            backgroundColor: 'rgba(156, 163, 175, 0.8)',
            borderColor: 'rgba(156, 163, 175, 1)',
            borderWidth: 2,
            borderRadius: 8,
            borderSkipped: false,
          },
        ],
      };
    }

    // Get real product data (top 10 by stock)
    const sortedProducts = [...state.products]
      .sort((a, b) => (b.quantity || 0) - (a.quantity || 0))
      .slice(0, 10);

    const labels = sortedProducts.map(p => p.name);
    const stockData = sortedProducts.map(p => p.quantity || 0);

    return {
      labels,
      datasets: [
        {
          label: 'Stock Quantity',
          data: stockData,
          backgroundColor: 'rgba(59, 130, 246, 0.8)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 2,
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    };
  };

  const generateCustomerChart = () => {
    if (state.customers.length === 0) {
      return {
        labels: ['No Data'],
        datasets: [
          {
            label: 'Customers',
            data: [0],
            backgroundColor: ['rgba(156, 163, 175, 0.8)'],
            borderColor: ['rgba(156, 163, 175, 1)'],
            borderWidth: 2,
            borderRadius: 8,
            borderSkipped: false,
          },
        ],
      };
    }

    // Categorize customers by balance
    const newCustomers = state.customers.filter(c => {
      const balance = c.balanceDue || 0;
      return balance === 0;
    }).length;

    const withDue = state.customers.filter(c => {
      const balance = c.balanceDue || 0;
      return balance > 0;
    }).length;

    const withCredit = state.customers.filter(c => {
      const balance = c.balanceDue || 0;
      return balance < 0;
    }).length;

    const labels = ['No Due', 'Has Due', 'Has Credit'];
    const customerData = [newCustomers, withDue, withCredit];

    return {
      labels,
      datasets: [
        {
          label: 'Customers',
          data: customerData,
          backgroundColor: [
            'rgba(34, 197, 94, 0.8)',
            'rgba(249, 115, 22, 0.8)',
            'rgba(59, 130, 246, 0.8)',
          ],
          borderColor: [
            'rgba(34, 197, 94, 1)',
            'rgba(249, 115, 22, 1)',
            'rgba(59, 130, 246, 1)',
          ],
          borderWidth: 2,
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    };
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          usePointStyle: true,
          padding: 15,
          font: {
            size: 13,
            weight: '500',
          },
          color: '#374151',
        },
      },
      title: {
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 12,
        titleFont: {
          size: 14,
          weight: 'bold',
        },
        bodyFont: {
          size: 13,
        },
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        displayColors: true,
        callbacks: {
          label: function(context) {
            if (reportType === 'sales') {
              return `Sales: ₹${context.parsed.y.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            } else if (reportType === 'inventory') {
              return `Stock: ${context.parsed.y} units`;
            } else {
              return `Customers: ${context.parsed.y}`;
            }
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          font: {
            size: 12,
          },
          color: '#6B7280',
        },
        border: {
          color: '#E5E7EB',
        },
      },
      y: {
        grid: {
          color: 'rgba(0, 0, 0, 0.05)',
          drawBorder: false,
        },
        ticks: {
          font: {
            size: 12,
          },
          color: '#6B7280',
          callback: function(value) {
            if (reportType === 'sales') {
              return '₹' + value.toLocaleString('en-IN');
            }
            return value;
          },
        },
        border: {
          color: '#E5E7EB',
        },
      },
    },
  };

  const getChartData = () => {
    switch (reportType) {
      case 'sales':
        return generateSalesChart();
      case 'inventory':
        return generateInventoryChart();
      case 'customers':
        return generateCustomerChart();
      default:
        return generateSalesChart();
    }
  };

  const getTopSellingProducts = () => {
    if (completedOrders.length === 0) return [];
    const productSalesMap = new Map();

    completedOrders.forEach(order => {
      normalizeOrderItems(order).forEach(item => {
        const name = item?.name || 'Unnamed Product';
        const quantity = sanitizeNumber(item?.quantity);
        const revenue = quantity * sanitizeNumber(item?.sellingPrice ?? item?.price ?? item?.unitPrice);

        if (!productSalesMap.has(name)) {
          productSalesMap.set(name, { name, quantity: 0, revenue: 0 });
        }

        const record = productSalesMap.get(name);
        record.quantity += quantity;
        record.revenue += revenue;
      });
    });

    return Array.from(productSalesMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  };

  const topSellingProducts = getTopSellingProducts();

  return (
    <div className="space-y-6">
      {/* Report Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Reports & Analytics</h2>
          <p className="text-gray-600">View detailed reports and analytics</p>
        </div>
        
        <div className="mt-4 sm:mt-0">
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            className="input-field"
          >
            <option value="sales">Sales Report</option>
            <option value="inventory">Inventory Report</option>
            <option value="customers">Customer Report</option>
          </select>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center">
            <div className="p-3 bg-orange-100 rounded-lg">
              <BarChart3 className="h-6 w-6 text-orange-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Sales</p>
              <p className="text-2xl font-bold text-gray-900">
                ₹{totalRevenue.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-3 bg-green-100 rounded-lg">
              <TrendingUp className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Profit</p>
              <p className="text-2xl font-bold text-gray-900">
                ₹{Math.max(0, totalProfit).toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Package className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Products</p>
              <p className="text-2xl font-bold text-gray-900">{state.products.length}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Users className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Customers</p>
              <p className="text-2xl font-bold text-gray-900">{state.customers.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="card p-6">
        <div className="mb-6">
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            {reportType === 'sales' ? 'Sales & Profit Report' : 
             reportType === 'inventory' ? 'Inventory Report' : 'Customer Report'}
          </h3>
          <p className="text-sm text-gray-600">
            {reportType === 'sales' ? 'Monthly sales performance over the last 6 months' : 
             reportType === 'inventory' ? 'Top 10 products by stock quantity' : 
             'Customer distribution by payment status'}
          </p>
        </div>
        <div className="h-[400px] sm:h-[450px] lg:h-[500px]">
          <Bar data={getChartData()} options={chartOptions} />
        </div>
      </div>

      {/* Report Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Selling Products</h3>
          {topSellingProducts.length === 0 ? (
            <p className="text-sm text-gray-500">No sales data available yet.</p>
          ) : (
            <div className="space-y-3">
              {topSellingProducts.map((product, index) => (
                <div key={product.name} className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
                      <span className="text-sm font-medium text-orange-600">{index + 1}</span>
                    </div>
                    <div className="ml-3">
                      <span className="text-sm font-medium text-gray-900">{product.name}</span>
                      <p className="text-xs text-gray-500">₹{product.revenue.toFixed(2)} revenue</p>
                    </div>
                  </div>
                  <span className="text-sm text-gray-600">{product.quantity} units</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Reports;

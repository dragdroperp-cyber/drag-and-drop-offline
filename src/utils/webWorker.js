// Web Worker utilities for heavy computations
// Prevents blocking the main thread during intensive operations
// Worker for data processing (CSV parsing, calculations, etc.)
const createDataProcessingWorker = () => `
  self.onmessage = function(e) {
    const { type, data } = e.data;
    try {
      switch (type) {
        case 'PARSE_CSV':
          const parsedData = parseCSV(data.content, data.options);
          self.postMessage({ success: true, data: parsedData });
          break;
        case 'CALCULATE_STATS':
          const stats = calculateStats(data.items, data.fields);
          self.postMessage({ success: true, data: stats });
          break;
        case 'FILTER_DATA':
          const filteredData = filterData(data.items, data.filters);
          self.postMessage({ success: true, data: filteredData });
          break;
        case 'SORT_DATA':
          const sortedData = sortData(data.items, data.sortBy, data.sortOrder);
          self.postMessage({ success: true, data: sortedData });
          break;
        default:
          self.postMessage({ success: false, error: 'Unknown operation type' });
      }
    } catch (error) {
      self.postMessage({ success: false, error: error.message });
    }
  };
  function parseCSV(content, options = {}) {
    const lines = content.split('\\n').filter(line => line.trim());
    if (lines.length === 0) return [];
    const delimiter = options.delimiter || ',';
    const hasHeaders = options.hasHeaders !== false;
    const rows = lines.map(line => {
      // Simple CSV parser - handles basic quoted fields
      const fields = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          fields.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      fields.push(current.trim());
      return fields;
    });
    if (!hasHeaders) {
      return rows.map(row => {
        const obj = {};
        row.forEach((value, index) => {
          obj['col_' + index] = value;
        });
        return obj;
      });
    }
    const headers = rows[0];
    return rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });
  }
  function calculateStats(items, fields) {
    if (!items || items.length === 0) return {};
    const stats = {};
    fields.forEach(field => {
      const values = items
        .map(item => {
          const value = item[field];
          return typeof value === 'number' ? value : parseFloat(value);
        })
        .filter(val => !isNaN(val));
      if (values.length > 0) {
        stats[field] = {
          count: values.length,
          sum: values.reduce((a, b) => a + b, 0),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values)
        };
      }
    });
    return stats;
  }
  function filterData(items, filters) {
    return items.filter(item => {
      return filters.every(filter => {
        const value = item[filter.field];
        switch (filter.operator) {
          case 'equals':
            return value == filter.value;
          case 'contains':
            return String(value).toLowerCase().includes(filter.value.toLowerCase());
          case 'startsWith':
            return String(value).toLowerCase().startsWith(filter.value.toLowerCase());
          case 'greaterThan':
            return Number(value) > Number(filter.value);
          case 'lessThan':
            return Number(value) < Number(filter.value);
          default:
            return true;
        }
      });
    });
  }
  function sortData(items, sortBy, sortOrder = 'asc') {
    return [...items].sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      let result = 0;
      if (aVal < bVal) result = -1;
      if (aVal > bVal) result = 1;
      return sortOrder === 'desc' ? -result : result;
    });
  }
`;
// Worker management utilities
class WebWorkerManager {
  constructor() {
    this.workers = new Map();
    this.workerId = 0;
  }
  createWorker(workerFunction) {
    const blob = new Blob([workerFunction], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    const id = ++this.workerId;
    this.workers.set(id, worker);
    return { id, worker };
  }
  runTask(workerFunction, data) {
    return new Promise((resolve, reject) => {
      const { id, worker } = this.createWorker(workerFunction);
      const timeout = setTimeout(() => {
        worker.terminate();
        this.workers.delete(id);
        reject(new Error('Worker task timeout'));
      }, 30000); // 30 second timeout
      worker.onmessage = (e) => {
        clearTimeout(timeout);
        worker.terminate();
        this.workers.delete(id);
        if (e.data.success) {
          resolve(e.data.data);
        } else {
          reject(new Error(e.data.error));
        }
      };
      worker.onerror = (error) => {
        clearTimeout(timeout);
        worker.terminate();
        this.workers.delete(id);
        reject(error);
      };
      worker.postMessage(data);
    });
  }
  terminateAll() {
    this.workers.forEach(worker => worker.terminate());
    this.workers.clear();
  }
}
// Singleton instance
const workerManager = new WebWorkerManager();
// Public API
export const runInWorker = (taskType, data) => {
  return workerManager.runTask(createDataProcessingWorker(), { type: taskType, data });
};
export const parseCSVInWorker = (content, options = {}) => {
  return runInWorker('PARSE_CSV', { content, options });
};
export const calculateStatsInWorker = (items, fields) => {
  return runInWorker('CALCULATE_STATS', { items, fields });
};
export const filterDataInWorker = (items, filters) => {
  return runInWorker('FILTER_DATA', { items, filters });
};
export const sortDataInWorker = (items, sortBy, sortOrder) => {
  return runInWorker('SORT_DATA', { items, sortBy, sortOrder });
};
// Utility to check if Web Workers are supported
export const isWebWorkerSupported = () => {
  return typeof Worker !== 'undefined';
};
// Cleanup function
export const cleanupWorkers = () => {
  workerManager.terminateAll();
};
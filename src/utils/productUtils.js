
import { getTotalStockQuantity } from './unitConversion';

/**
 * Product Utility Functions
 * Shared logic for product management, batch handling, and pricing
 */

/**
 * Sort batches based on consumption logic
 * @param {Array} batches - Array of batch objects
 * @param {boolean} trackExpiry - Whether to track expiry
 * @returns {Array} Sorted batches
 */
export const sortBatches = (batches, trackExpiry = false) => {
    if (!batches || !Array.isArray(batches)) return [];

    return [...batches].sort((a, b) => {
        const isTrackingExpiry = trackExpiry === true || trackExpiry === 'true';
        if (isTrackingExpiry) {
            // Sort by expiry date (earliest first)
            // If no expiry, treat as far future (put at end)
            const dateA = a.expiry ? new Date(a.expiry).getTime() : Number.MAX_SAFE_INTEGER;
            const dateB = b.expiry ? new Date(b.expiry).getTime() : Number.MAX_SAFE_INTEGER;

            if (dateA !== dateB) return dateA - dateB;

            // Secondary sort by creation date if expiry is same
            const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return createdA - createdB;
        } else {
            // Sort by creation date (oldest first - FIFO)
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateA - dateB;
        }
    });
};

/**
 * Get the effective selling price for a product based on its batches and expiry tracking
 * @param {Object} product - Product object
 * @param {string} mode - 'retail' or 'wholesale'
 * @returns {number} Effective selling price
 */
export const getEffectivePrice = (product, mode = 'retail') => {
    if (!product) return 0;

    const isWholesale = mode === 'wholesale';

    // Default to product price
    let price = isWholesale
        ? Number(product.wholesalePrice || product.sellingPrice || product.price || 0)
        : Number(product.sellingUnitPrice || product.sellingPrice || product.price || 0);

    if (product.batches && product.batches.length > 0) {
        // Filter for batches with quantity > 0 to show price of *item to be sold*
        let availableBatches = product.batches.filter(b => (Number(b.quantity) || 0) > 0);

        // If no available batches, fall back to all batches to show *last known/next* pricing intent
        if (availableBatches.length === 0) {
            availableBatches = product.batches;
        }

        const sortedBatches = sortBatches(availableBatches, product.trackExpiry);

        if (sortedBatches.length > 0) {
            const firstBatch = sortedBatches[0];
            // Use batch selling price if available
            const batchPrice = isWholesale
                ? Number(firstBatch.wholesalePrice || product.wholesalePrice || firstBatch.sellingUnitPrice || firstBatch.sellingPrice || 0)
                : Number(firstBatch.sellingUnitPrice || firstBatch.sellingPrice || 0);

            if (batchPrice > 0) {
                price = batchPrice;
            }
        }
    }

    return price;
};

/**
 * Get the effective wholesale minimum order quantity for a product based on its batches
 * @param {Object} product - Product object
 * @returns {number} Effective wholesale MOQ
 */
export const getEffectiveWholesaleMOQ = (product) => {
    if (!product) return 1;

    // Use ONLY product-level MOQ as requested
    return Number(product.wholesaleMOQ || 1);
};




/**
 * Calculate product alerts (low stock, expired, expiring)
 * @param {Array} products - List of products
 * @param {number} lowStockThreshold 
 * @param {number} expiryDaysThreshold 
 * @returns {Object} { lowStockProducts, expiryAlerts, totalAlerts }
 */
export const calculateProductAlerts = (products, lowStockThreshold, expiryDaysThreshold) => {
    if (!products || !Array.isArray(products)) {
        return {
            lowStockProducts: [],
            expiryAlerts: [],
            totalAlerts: 0
        };
    }

    // Helper to calculate days until expiry
    const getDaysUntilExpiry = (expiryDate) => {
        if (!expiryDate) return null;
        const date = new Date(expiryDate);
        const now = new Date();
        date.setHours(0, 0, 0, 0);
        now.setHours(0, 0, 0, 0);
        const diffTime = date - now;
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    };

    // Calculate Low Stock
    const lowStockProducts = products.filter(p => getTotalStockQuantity(p) <= lowStockThreshold);

    // Calculate expiry alerts including batches
    const expiryAlerts = products.reduce((acc, product) => {
        const dates = [];
        if (product.expiryDate) dates.push(product.expiryDate);
        if (product.batches && Array.isArray(product.batches)) {
            product.batches.forEach(b => {
                const date = b.expiry || b.expiryDate;
                if (date) dates.push(date);
            });
        }

        if (dates.length === 0) return acc;

        // Requirement: Skip expiry alerts if the product has no stock (quantity <= 0)
        const totalStock = getTotalStockQuantity(product);
        if (totalStock <= 0) return acc;

        const expiredDiffs = [];
        const expiringDiffs = [];

        // Also check individual batches for quantity if available
        if (product.batches && Array.isArray(product.batches)) {
            product.batches.forEach(b => {
                if ((Number(b.quantity) || 0) <= 0) return; // Skip zero quantity batches
                const date = b.expiry || b.expiryDate;
                const days = getDaysUntilExpiry(date);
                if (days === null) return;
                if (days < 0) expiredDiffs.push(days);
                else if (days <= expiryDaysThreshold) expiringDiffs.push(days);
            });
        } else if (product.expiryDate) {
            // For product-level expiry (legacy/direct)
            const days = getDaysUntilExpiry(product.expiryDate);
            if (days !== null) {
                if (days < 0) expiredDiffs.push(days);
                else if (days <= expiryDaysThreshold) expiringDiffs.push(days);
            }
        }

        if (expiredDiffs.length > 0) {
            const worstDay = Math.min(...expiredDiffs);
            acc.push({
                type: 'expired',
                product,
                days: worstDay,
                count: expiredDiffs.length
            });
        }

        if (expiringDiffs.length > 0) {
            const worstDay = Math.min(...expiringDiffs);
            acc.push({
                type: 'expiring',
                product,
                days: worstDay,
                count: expiringDiffs.length
            });
        }

        return acc;
    }, []);

    return {
        lowStockProducts,
        expiryAlerts,
        totalAlerts: lowStockProducts.length + expiryAlerts.length
    };
};

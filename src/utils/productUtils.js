
import { getTotalStockQuantity, convertToBaseUnit, convertFromBaseUnit } from './unitConversion';

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
    const lowStockProducts = products.filter(p => {
        const threshold = (p.lowStockLevel !== undefined && p.lowStockLevel !== null)
            ? Number(p.lowStockLevel)
            : (lowStockThreshold || 10);
        return getTotalStockQuantity(p) <= threshold;
    });

    // Calculate expiry alerts including batches
    const expiryAlerts = products.reduce((acc, product) => {
        // Determine threshold: use product specific if available, else global
        const threshold = (product.expiryThreshold !== undefined && product.expiryThreshold !== null)
            ? Number(product.expiryThreshold)
            : (expiryDaysThreshold || 30);

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
                else if (days <= threshold) expiringDiffs.push(days);
            });
        } else if (product.expiryDate) {
            // For product-level expiry (legacy/direct)
            const days = getDaysUntilExpiry(product.expiryDate);
            if (days !== null) {
                if (days < 0) expiredDiffs.push(days);
                else if (days <= threshold) expiringDiffs.push(days);
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

/**
 * Helper function to calculate batch-aware pricing using FIFO (First In, First Out)
 */
export const calculateBatchPricing = (product, requestedQuantity, unit, saleMode = 'retail', selectedBatchId = null) => {
    const productUnit = product.quantityUnit || product.unit || 'pcs';
    const requestedQuantityInBase = convertToBaseUnit(requestedQuantity, unit);
    const productUnitInBase = convertToBaseUnit(1, productUnit) || 1;
    const requestedQuantityInProductUnits = requestedQuantityInBase / productUnitInBase;

    // If product has batches, use standard logic with FEFO for wholesale
    if (product.batches && product.batches.length > 0) {
        const availableBatches = product.batches.filter(b => (Number(b.quantity) || 0) > 0);
        let sortedBatches;
        if (selectedBatchId) {
            sortedBatches = product.batches.filter(b => b.id === selectedBatchId || b._id === selectedBatchId);
        } else {
            sortedBatches = saleMode === 'wholesale'
                ? sortBatches(availableBatches, true) // Force Expiry ASC (FEFO) sort for Wholesale
                : sortBatches(product.batches, product.trackExpiry);
        }

        let remainingQuantity = requestedQuantityInProductUnits;
        let totalSellingPrice = 0;
        let totalCostPrice = 0;
        const usedBatches = [];

        // Pre-calculate threshold for near-expiry check (30 days from today)
        const nearExpiryThreshold = new Date();
        nearExpiryThreshold.setDate(nearExpiryThreshold.getDate() + 30);

        // Step 3: Allocate requested quantity batch-wise using FEFO (Wholesale) or FIFO (Retail)
        for (const batch of sortedBatches) {
            if (remainingQuantity <= 0) break;

            const availableQuantity = Number(batch.quantity ?? 0) || 0;
            if (availableQuantity > 0) {
                const quantityFromBatch = Math.min(remainingQuantity, availableQuantity);

                let batchSellingPrice;
                if (saleMode === 'wholesale') {
                    // Step 4: Rule - Apply batch wholesale price IF total product quantity >= product MOQ OR batch is near expiry
                    const batchMOQ = Number(product.wholesaleMOQ || 1);
                    const expiryDate = batch.expiry ? new Date(batch.expiry) : null;
                    const isNearExpiry = expiryDate && expiryDate <= nearExpiryThreshold;

                    if (requestedQuantityInProductUnits >= batchMOQ || isNearExpiry) {
                        // Apply batch wholesale price if MOQ met or expiring soon (within 30 days)
                        batchSellingPrice = Number(batch.wholesalePrice ?? product.wholesalePrice ?? batch.sellingUnitPrice ?? batch.sellingPrice ?? product.sellingPrice ?? 0);
                    } else {
                        // Otherwise use fallback wholesale price (product-level wholesale or retail)
                        batchSellingPrice = Number(product.wholesalePrice ?? batch.sellingUnitPrice ?? batch.sellingPrice ?? product.sellingPrice ?? 0);
                    }
                } else {
                    // Default pricing for retail mode
                    batchSellingPrice = Number(batch.sellingUnitPrice ?? batch.sellingPrice ?? product.sellingPrice ?? 0);
                }

                const batchCostPrice = Number(batch.costPrice ?? product.costPrice ?? 0) || 0;

                // Step 8: Total amount calculation (sum of batchQty * appliedPrice)
                totalSellingPrice += quantityFromBatch * batchSellingPrice;
                totalCostPrice += quantityFromBatch * batchCostPrice;

                usedBatches.push({
                    batchId: batch.id,
                    batchNumber: batch.batchNumber,
                    quantity: quantityFromBatch,
                    sellingPrice: batchSellingPrice,
                    costPrice: batchCostPrice
                });

                remainingQuantity -= quantityFromBatch;
            }
        }

        // If we still have remaining quantity but no more batches, use product default price
        if (remainingQuantity > 0) {
            const defaultSellingPrice = saleMode === 'wholesale'
                ? (Number(product.wholesalePrice ?? 0) || 0)
                : (Number(product.sellingPrice ?? product.costPrice ?? 0) || 0);

            const defaultCostPrice = Number(product.costPrice ?? product.unitPrice ?? 0) || 0;

            totalSellingPrice += remainingQuantity * defaultSellingPrice;
            totalCostPrice += remainingQuantity * defaultCostPrice;
        }

        return {
            totalSellingPrice: Math.floor(totalSellingPrice * 100) / 100,
            totalCostPrice: Math.floor(totalCostPrice * 100) / 100,
            usedBatches,
            averageSellingPrice: requestedQuantityInProductUnits > 0 ? totalSellingPrice / requestedQuantityInProductUnits : 0
        };
    } else {
        // No batches, use product default pricing
        const sellingPricePerProductUnit = saleMode === 'wholesale'
            ? (Number(product.wholesalePrice ?? 0) || 0)
            : Number(product.sellingPrice || product.costPrice || 0);

        const costPricePerProductUnit = Number(product.costPrice || product.unitPrice || 0);

        return {
            totalSellingPrice: Math.floor((sellingPricePerProductUnit * requestedQuantityInProductUnits) * 100) / 100,
            totalCostPrice: Math.floor((costPricePerProductUnit * requestedQuantityInProductUnits) * 100) / 100,
            usedBatches: [],
            averageSellingPrice: sellingPricePerProductUnit
        };
    }
};

/**
 * Helper function to calculate quantity from a given total amount across batches
 */
export const calculateQuantityFromAmount = (product, targetAmount, unit, saleMode = 'retail', selectedBatchId = null) => {
    const productUnit = product.quantityUnit || product.unit || 'pcs';
    const productUnitInBase = convertToBaseUnit(1, productUnit) || 1;
    const targetAmt = Number(targetAmount) || 0;

    if (targetAmt <= 0) return 0;

    // If product has batches
    if (product.batches && product.batches.length > 0) {
        const availableBatches = product.batches.filter(b => (Number(b.quantity) || 0) > 0);
        let sortedBatches;
        if (selectedBatchId) {
            sortedBatches = product.batches.filter(b => b.id === selectedBatchId || b._id === selectedBatchId);
        } else {
            sortedBatches = saleMode === 'wholesale'
                ? sortBatches(availableBatches, true)
                : sortBatches(product.batches, product.trackExpiry);
        }

        let remainingAmount = targetAmt;
        let totalQuantityInProductUnits = 0;

        const nearExpiryThreshold = new Date();
        nearExpiryThreshold.setDate(nearExpiryThreshold.getDate() + 30);

        for (const batch of sortedBatches) {
            if (remainingAmount <= 0) break;

            const availableQuantity = Number(batch.quantity ?? 0) || 0;
            if (availableQuantity > 0) {
                let batchSellingPrice;
                if (saleMode === 'wholesale') {
                    batchSellingPrice = Number(batch.wholesalePrice ?? product.wholesalePrice ?? batch.sellingUnitPrice ?? batch.sellingPrice ?? product.sellingPrice ?? 0);
                } else {
                    batchSellingPrice = Number(batch.sellingUnitPrice ?? batch.sellingPrice ?? product.sellingPrice ?? 0);
                }

                if (batchSellingPrice <= 0) continue;

                const batchValue = availableQuantity * batchSellingPrice;
                const amtFromThisBatch = Math.min(remainingAmount, batchValue);
                const quantityFromThisBatch = amtFromThisBatch / batchSellingPrice;

                totalQuantityInProductUnits += quantityFromThisBatch;
                remainingAmount -= amtFromThisBatch;
            }
        }

        // If amount still remaining, use default price for the rest
        if (remainingAmount > 0) {
            const defaultSellingPrice = saleMode === 'wholesale'
                ? (Number(product.wholesalePrice ?? 0) || 0)
                : (Number(product.sellingPrice ?? product.costPrice ?? 0) || 0);

            if (defaultSellingPrice > 0) {
                totalQuantityInProductUnits += remainingAmount / defaultSellingPrice;
            }
        }

        // Convert product units back to the requested unit
        const totalInBase = totalQuantityInProductUnits * productUnitInBase;
        return convertFromBaseUnit(totalInBase, unit);
    } else {
        // No batches, use default price
        const sellingPricePerProductUnit = saleMode === 'wholesale'
            ? (Number(product.wholesalePrice ?? 0) || 0)
            : Number(product.sellingPrice || product.costPrice || 0);

        if (sellingPricePerProductUnit <= 0) return 0;

        const totalQuantityInProductUnits = targetAmt / sellingPricePerProductUnit;
        const totalInBase = totalQuantityInProductUnits * productUnitInBase;
        return convertFromBaseUnit(totalInBase, unit);
    }
};


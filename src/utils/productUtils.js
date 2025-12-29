
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
 * @returns {number} Effective selling price
 */
export const getEffectivePrice = (product) => {
    if (!product) return 0;

    // Default to product price
    let price = Number(product.sellingUnitPrice || product.sellingPrice || product.price || 0);

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
            const batchPrice = Number(firstBatch.sellingUnitPrice || firstBatch.sellingPrice || 0);
            if (batchPrice > 0) {
                price = batchPrice;
            }
        }
    }

    return price;
};

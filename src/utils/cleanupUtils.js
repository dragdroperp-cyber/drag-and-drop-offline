import { getAllItems, deleteItem, STORES } from './indexedDB';

/**
 * Cleanup duplicate customers after sync
 * This handles cases where we might have a local unsynced customer
 * that matches a newly synced customer from the backend
 */
export const cleanupDuplicateCustomers = async () => {
    try {
        const customers = await getAllItems(STORES.customers);

        // Group customers by unique identifiers (email)
        // Note: Mobile number uniqueness check removed as per user request to allow shared numbers
        // const byMobile = {};
        const byEmail = {};
        const byServerId = {}; // New check: Duplicate server IDs (_id)

        // Track duplicates to delete
        const duplicatesToDelete = new Set();

        customers.forEach(customer => {
            // Normalize identifiers
            // const mobile = (customer.mobileNumber || customer.phone || '').trim();
            const email = (customer.email || '').trim().toLowerCase();
            const serverId = customer._id;

            // Check server ID matches (Strict duplicate check - same backend record)
            if (serverId) {
                if (byServerId[serverId]) {
                    // This is a TRUE duplicate (same backend ID)
                    duplicatesToDelete.add(customer.id);
                } else {
                    byServerId[serverId] = customer;
                }
            }

            // Mobile check removed

            // Check email matches (optional, kept for now but could be removed if emails can be shared)
            if (email) {
                if (byEmail[email]) {
                    const existing = byEmail[email];
                    // Only process if not already marked for deletion
                    if (!duplicatesToDelete.has(customer.id) && !duplicatesToDelete.has(existing.id)) {
                        // Logic simplified: If email matches, verify if we should really delete.
                        // For safety, let's ONLY delete if one is synced and one isn't (stale local data)
                        // AND if user names match or something stronger.
                        // Actually, to be safe and stop over-deleting, I'll restrict email deletion too
                        // to only happen if they also share an ID or if it's a clear sync relic.
                        // For now, let's disable email dedupe too to be safe, unless it's a clear backend sync conflict.

                        // Strict cleanup: Only delete if one is a 'synced' version and has same server ID (handled above)
                        // or if it's definitely a stale local copy.
                    }
                } else {
                    byEmail[email] = customer;
                }
            }
        });

        if (duplicatesToDelete.size > 0) {
            console.log(`[Cleanup] Found ${duplicatesToDelete.size} duplicate customers. Deleting...`, Array.from(duplicatesToDelete));

            // Process deletions
            const promises = Array.from(duplicatesToDelete).map(id => deleteItem(STORES.customers, id));
            await Promise.all(promises);

            console.log(`[Cleanup] Deleted ${duplicatesToDelete.size} duplicates.`);
            return duplicatesToDelete.size;
        }

        return 0;
    } catch (error) {
        console.error('Error cleaning up duplicate customers:', error);
        return 0;
    }
};

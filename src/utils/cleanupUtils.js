import { getAllItems, deleteItem, STORES } from './indexedDB';

/**
 * Cleanup duplicate customers after sync
 * This handles cases where we might have a local unsynced customer
 * that matches a newly synced customer from the backend
 */
export const cleanupDuplicateCustomers = async () => {
    try {
        const customers = await getAllItems(STORES.customers);

        // Group customers by unique identifiers (mobile, email)
        const byMobile = {};
        const byEmail = {};

        // Track duplicates to delete
        const duplicatesToDelete = new Set();

        customers.forEach(customer => {
            // Normalize identifiers
            const mobile = (customer.mobileNumber || customer.phone || '').trim();
            const email = (customer.email || '').trim().toLowerCase();

            // Check mobile matches
            if (mobile) {
                if (byMobile[mobile]) {
                    // Found duplicate by mobile
                    const existing = byMobile[mobile];

                    // Prioritize: 
                    // 1. Synced record (isSynced: true)
                    // 2. Newer record (if both synced or both unsynced)
                    // Actually, we usually want to KEEP the synced one and DELETE the unsynced one

                    if (existing.isSynced && !customer.isSynced) {
                        // Keep existing (synced), delete current (unsynced)
                        duplicatesToDelete.add(customer.id);
                    } else if (!existing.isSynced && customer.isSynced) {
                        // Keep current (synced), delete existing (unsynced)
                        duplicatesToDelete.add(existing.id);
                        byMobile[mobile] = customer; // Update reference
                    } else {
                        // Both synced or both unsynced - keep the one with _id (backend ID) if possible
                        if (existing._id && !customer._id) {
                            duplicatesToDelete.add(customer.id);
                        } else if (!existing._id && customer._id) {
                            duplicatesToDelete.add(existing.id);
                            byMobile[mobile] = customer;
                        } else {
                            // Tie-breaker: keep the one with most generic 'id' if one looks temp?
                            // Or simply keep the latest one?
                            // Let's keep existing to be safe and delete duplicate
                            duplicatesToDelete.add(customer.id);
                        }
                    }
                } else {
                    byMobile[mobile] = customer;
                }
            }

            // Check email matches (similar logic)
            if (email) {
                if (byEmail[email]) {
                    const existing = byEmail[email];
                    // Only process if not already marked for deletion
                    if (!duplicatesToDelete.has(customer.id) && !duplicatesToDelete.has(existing.id)) {
                        if (existing.isSynced && !customer.isSynced) {
                            duplicatesToDelete.add(customer.id);
                        } else if (!existing.isSynced && customer.isSynced) {
                            duplicatesToDelete.add(existing.id);
                            byEmail[email] = customer;
                        } else {
                            if (existing._id && !customer._id) {
                                duplicatesToDelete.add(customer.id);
                            } else if (!existing._id && customer._id) {
                                duplicatesToDelete.add(existing.id);
                                byEmail[email] = customer;
                            } else {
                                duplicatesToDelete.add(customer.id);
                            }
                        }
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

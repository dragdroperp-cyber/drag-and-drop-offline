/**
 * Profile Utilities
 * Helpers for checking user profile completion status
 */

/**
 * Check if a user's profile is considered complete
 * @param {Object} user - The user object (currentUser)
 * @returns {boolean} - True if profile is complete, false otherwise
 */
export const isProfileComplete = (user) => {
    if (!user) return false;

    // 1. Explicit flag check (most authoritative)
    if (user.profileCompleted === true || user.profileCompleted === 'true') {
        return true;
    }

    if (user.profileCompleted === false || user.profileCompleted === 'false') {
        return false;
    }

    // 2. Required fields check - Must have basic shop identity
    const hasRequiredFields = !!(
        user.shopName &&
        user.businessType &&
        user.shopAddress
    );

    // 3. Backup: check if they have substantial other info (excluding phone which comes from login)
    const hasOtherInfo = !!(
        user.city &&
        user.state &&
        user.pincode
    );

    // Profile is complete if it has explicit flag OR all required shop fields
    // or at least shopName + other location info
    return hasRequiredFields || (!!user.shopName && hasOtherInfo);
};

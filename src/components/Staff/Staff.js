import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  UserCheck,
  Plus,
  Settings,
  Users,
  X,
  CheckCircle,
  AlertCircle,
  Copy,
  Eye,
  Mail,
  Shield,
  MoreVertical,
  Edit,
  UserPlus,
  Search,
  Filter,
  ChevronDown,
  Clock,
  Phone,
  MapPin,
  History,
  ExternalLink,
  Ban,
  Calendar,
  XCircle
} from 'lucide-react';
import { apiRequest } from '../../utils/api';
import {
  saveStaffMembers,
  getStaffMembers,
  updateStaffMember,
  STORES
} from '../../utils/indexedDB';
import { syncService } from '../../services/syncService';

const Staff = () => {
  const { state } = useApp();
  const isStaffUser = state.currentUser?.userType === 'staff';

  const [activeTab, setActiveTab] = useState(isStaffUser ? 'permissions' : 'list');
  const [staff, setStaff] = useState([]);
  const [invites, setInvites] = useState([]);
  const [inviteHistory, setInviteHistory] = useState([]);
  const [inviteHistoryStats, setInviteHistoryStats] = useState({});
  const [loadingInviteHistory, setLoadingInviteHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ permissions: {} });
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [staffActionMenu, setStaffActionMenu] = useState(null);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showStaffDetailsModal, setShowStaffDetailsModal] = useState(false);
  const [showInviteHistoryModal, setShowInviteHistoryModal] = useState(false);
  const [latestInviteUrl, setLatestInviteUrl] = useState(null);
  const [latestInviteToken, setLatestInviteToken] = useState(null);
  const [showResignModal, setShowResignModal] = useState(false);
  const [resignationReason, setResignationReason] = useState('');
  const [isResigning, setIsResigning] = useState(false);

  // Permission groups configuration
  const permissionGroups = {
    dashboard: {
      title: 'Dashboard',
      permissions: {
        dashboard: 'Dashboard Access'
      }
    },
    products: {
      title: 'Products',
      permissions: {
        products: 'Product Management'
      }
    },
    inventory: {
      title: 'Inventory',
      permissions: {
        inventory: 'Inventory Management'
      }
    },
    billing: {
      title: 'Billing & Sales',
      permissions: {
        billing: 'Billing & Sales',
        salesOrderHistory: 'Sales Order History'
      }
    },
    refunds: {
      title: 'Refunds',
      permissions: {
        refunds: 'Refund Management'
      }
    },
    financial: {
      title: 'Financial',
      permissions: {
        financial: 'Financial Reports'
      }
    },
    reports: {
      title: 'Reports',
      permissions: {
        reports: 'Reports Access'
      }
    },
    settings: {
      title: 'Settings',
      permissions: {
        settings: 'Settings Access'
      }
    }
  };

  // Load staff and invites on component mount
  useEffect(() => {
    loadStaffAndInvites();
    // Set up background sync for staff data
    setupStaffSync();
  }, []);

  // Set up background sync for staff data
  const setupStaffSync = () => {
    // Register staff store for background sync
    if (syncService && typeof syncService.registerStoreForSync === 'function') {
      syncService.registerStoreForSync(STORES.staff, {
        loadFromAPI: async () => {
          const response = await apiRequest('/staff').catch(err => ({ success: false, error: err.message }));
          return response.success ? response.data?.data || [] : [];
        },
        saveToIndexedDB: saveStaffMembers,
        getSyncMetadata: () => ({ collection: 'staff' })
      });
    }
  };

  const loadStaffAndInvites = async () => {
    setLoading(true);
    try {
      const sellerId = state.currentUser?.sellerId;

      // Try to load staff from IndexedDB first for instant loading
      let cachedStaff = [];
      if (sellerId) {
        try {
          cachedStaff = await getStaffMembers(sellerId);
          if (cachedStaff && cachedStaff.length > 0) {
            setStaff([...cachedStaff]);
            console.log('⚡ Loaded staff from IndexedDB cache:', cachedStaff.length, 'members');
          }
        } catch (cacheError) {
          console.warn('Failed to load staff from IndexedDB:', cacheError);
        }
      }

      // Load from API in background
      const [staffResponse, invitesResponse] = await Promise.all([
        apiRequest('/staff').catch(err => ({ success: false, error: err.message })),
        apiRequest('/staff/invites').catch(err => ({ success: false, error: err.message }))
      ]);

      if (staffResponse.success && staffResponse.data && Array.isArray(staffResponse.data.data)) {
        const staffData = staffResponse.data.data;
        setStaff([...staffData]); // Update state with fresh data

        // Save to IndexedDB for future use
        if (sellerId && staffData.length > 0) {
          try {
            await saveStaffMembers(staffData);
            console.log('💾 Saved staff data to IndexedDB:', staffData.length, 'members');
          } catch (saveError) {
            console.warn('Failed to save staff data to IndexedDB:', saveError);
          }
        }

        // Debug logging
        console.log('🔍 Staff data loaded from API:', {
          total: staffData.length,
          active: staffData.filter(s => s.isActive).length,
          inactive: staffData.filter(s => !s.isActive).length,
          resigned: staffData.filter(s => !s.isActive && s.resignedAt).length,
          samples: staffData.slice(0, 3).map(s => ({
            name: s.name,
            isActive: s.isActive,
            resignedAt: s.resignedAt,
            accessRevoked: s.accessRevoked
          }))
        });
      } else if (cachedStaff.length === 0) {
        // Only set empty array if we don't have cached data
        setStaff([]);
      }

      if (invitesResponse.success && invitesResponse.data && Array.isArray(invitesResponse.data.data)) {
        // Filter out revoked invites from pending invites list
        const activeInvites = invitesResponse.data.data.filter(invite => {
          const isRevoked = invite.revokedAt || invite.isRevoked || invite.revoked || invite.deletedAt;
          // Also consider accepted invites with null usedBy/usedAt as revoked
          const isAcceptedButRevoked = invite.status === 'accepted' && (!invite.usedBy || !invite.usedAt);
          return !isRevoked && !isAcceptedButRevoked && (invite.status === 'pending' || !invite.status);
        });
        setInvites(activeInvites);
      } else {
        setInvites([]);
      }
    } catch (error) {
      console.error('Error loading staff data:', error);
      setStaff([]);
      setInvites([]);
      if (window.showToast) {
        window.showToast('Failed to load staff data', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadInviteHistory = async () => {
    console.log('🔍 loadInviteHistory called');
    setLoadingInviteHistory(true);
    try {
      console.log('📡 Making API request to /staff/invite-history');
      const response = await apiRequest('/staff/invite-history');
      console.log('📋 Invite History API Response:', response);
      if (response.success && response.data) {
        const inviteData = response.data.data || [];
        const statsData = response.data.stats || {};
        console.log('✅ Invite history loaded:', inviteData.length, 'invites');
        console.log('📊 Stats:', statsData);
        console.log('📋 First invite sample:', inviteData[0]);

        setInviteHistory(inviteData);

        // Calculate stats from the invite data if backend stats are missing or incorrect
        let calculatedStats = statsData || {};
        if (!calculatedStats.revoked || calculatedStats.revoked === 0) {
          // Calculate revoked count from invite data
          const revokedCount = inviteData.filter(invite => {
            let status = invite.status || 'pending';
            if (invite.revokedAt || invite.isRevoked || invite.revoked || invite.deletedAt) {
              return true;
            }
            if (status === 'accepted' && (!invite.usedBy || !invite.usedAt)) {
              return true;
            }
            return false;
          }).length;

          calculatedStats = {
            ...calculatedStats,
            revoked: revokedCount
          };
        }

        setInviteHistoryStats(calculatedStats);

        // Force a re-render check
        console.log('🔄 State updated - inviteHistory length:', inviteData.length);
        console.log('📊 Invite stats:', calculatedStats);
      } else {
        console.log('❌ No invite history data received');
        setInviteHistory([]);
        setInviteHistoryStats({});
      }
    } catch (error) {
      console.error('❌ Error loading invite history:', error);
      setInviteHistory([]);
      setInviteHistoryStats({});
      if (window.showToast) {
        window.showToast('Failed to load invite history', 'error');
      }
    } finally {
      setLoadingInviteHistory(false);
    }
  };

  const handlePermissionChange = (permKey, checked) => {
    setInviteForm(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [permKey]: checked
      }
    }));
  };

  const handleCreateInvite = async () => {
    try {
      const response = await apiRequest('/staff/invite', {
        method: 'POST',
        body: { permissions: inviteForm.permissions }
      });

      if (response.success) {
        setLatestInviteUrl(response.data.inviteUrl);
        setLatestInviteToken(response.data.token);
        setShowInviteModal(false);
        setInviteForm({ permissions: {} });
        if (window.showToast) {
          window.showToast('Invite link created successfully!', 'success');
        }
        // Reload invites
        loadStaffAndInvites();
      } else {
        if (window.showToast) {
          window.showToast('Failed to create invite', 'error');
        }
      }
    } catch (error) {
      console.error('Error creating invite:', error);
      if (window.showToast) {
        window.showToast('Failed to create invite', 'error');
      }
    }
  };

  const handleUpdatePermissions = async (staffId, permissions) => {
    try {
      const response = await apiRequest(`/staff/${staffId}/permissions`, {
        method: 'PUT',
        body: { permissions }
      });

      if (response.success) {
        setShowPermissionsModal(false);
        setSelectedStaff(null);
        setInviteForm({ permissions: {} });

        // Update IndexedDB cache
        try {
          const sellerId = state.currentUser?.sellerId;
          if (sellerId) {
            await updateStaffMember(staffId, { permissions, updatedAt: new Date().toISOString() });
            console.log('💾 Updated staff permissions in IndexedDB');
          }
        } catch (dbError) {
          console.warn('Failed to update staff permissions in IndexedDB:', dbError);
        }

        if (window.showToast) {
          window.showToast('Permissions updated successfully!', 'success');
        }
        // Reload staff data
        loadStaffAndInvites();
      } else {
        if (window.showToast) {
          window.showToast('Failed to update permissions', 'error');
        }
      }
    } catch (error) {
      console.error('Error updating permissions:', error);
      if (window.showToast) {
        window.showToast('Failed to update permissions', 'error');
      }
    }
  };

  const handleToggleStaffStatus = async (staffId, isActive) => {
    try {
      const response = await apiRequest(`/staff/${staffId}/status`, {
        method: 'PUT',
        body: { isActive: !isActive }
      });

      if (response.success) {
        // Update IndexedDB cache
        try {
          const sellerId = state.currentUser?.sellerId;
          if (sellerId) {
            await updateStaffMember(staffId, { isActive: !isActive, updatedAt: new Date().toISOString() });
            console.log('💾 Updated staff status in IndexedDB');
          }
        } catch (dbError) {
          console.warn('Failed to update staff status in IndexedDB:', dbError);
        }

        if (window.showToast) {
          window.showToast(`Staff member ${!isActive ? 'activated' : 'deactivated'} successfully!`, 'success');
        }
        // Reload staff data
        loadStaffAndInvites();
      } else {
        if (window.showToast) {
          window.showToast('Failed to update staff status', 'error');
        }
      }
    } catch (error) {
      console.error('Error updating staff status:', error);
      if (window.showToast) {
        window.showToast('Failed to update staff status', 'error');
      }
    }
  };

  const handleSuspendStaff = async (staffId, isSuspend) => {
    try {
      // First, save to IndexedDB for instant UI update
      const sellerId = state.currentUser?.sellerId;
      if (sellerId) {
        try {
          const updates = {
            isActive: !isSuspend, // Set active when unsuspending, inactive when suspending
            isSuspend: isSuspend,
            permissions: isSuspend ? {} : undefined, // Clear permissions when suspending
            updatedAt: new Date().toISOString()
          };
          await updateStaffMember(staffId, updates);
          console.log('💾 Updated staff suspension status in IndexedDB');

          // Update local state immediately for instant feedback
          setStaff(prevStaff =>
            prevStaff.map(member =>
              member._id === staffId
                ? {
                    ...member,
                    isActive: !isSuspend,
                    isSuspend: isSuspend,
                    permissions: isSuspend ? {} : member.permissions,
                    updatedAt: new Date().toISOString()
                  }
                : member
            )
          );
        } catch (dbError) {
          console.warn('Failed to update staff suspension in IndexedDB:', dbError);
        }
      }

      // Then sync to MongoDB in background
      const response = await apiRequest(`/staff/${staffId}/suspend`, {
        method: 'PUT',
        body: { isSuspend }
      });

      if (response.success) {
        console.log('☁️ Staff suspension status synced to MongoDB');

        // Update with fresh data from server
        if (response.data) {
          setStaff(prevStaff =>
            prevStaff.map(member =>
              member._id === staffId ? response.data : member
            )
          );
        }

        if (window.showToast) {
          window.showToast(`Staff member ${isSuspend ? 'suspended' : 'unsuspended'} successfully!`, 'success');
        }
        // Reload staff data to ensure consistency
        loadStaffAndInvites();
      } else {
        if (window.showToast) {
          window.showToast('Failed to update staff suspension status', 'error');
        }
        // Revert IndexedDB changes on failure
        if (sellerId) {
          try {
            await updateStaffMember(staffId, {
              isActive: isSuspend,
              isSuspend: !isSuspend,
              updatedAt: new Date().toISOString()
            });
          } catch (revertError) {
            console.warn('Failed to revert IndexedDB changes:', revertError);
          }
        }
      }
    } catch (error) {
      console.error('Error updating staff suspension status:', error);
      if (window.showToast) {
        window.showToast('Failed to update staff suspension status', 'error');
      }
      // Revert IndexedDB changes on error
      const sellerId = state.currentUser?.sellerId;
      if (sellerId) {
        try {
          await updateStaffMember(staffId, {
            isActive: isSuspend,
            isSuspend: !isSuspend,
            updatedAt: new Date().toISOString()
          });
        } catch (revertError) {
          console.warn('Failed to revert IndexedDB changes:', revertError);
        }
      }
    }
  };

  const handleRevokeInvite = async (inviteId) => {
    if (!window.confirm('Are you sure you want to revoke this invite? This action cannot be undone.')) return;

    try {
      const response = await apiRequest(`/staff/invites/${inviteId}`, {
        method: 'DELETE'
      });

      if (response.success) {
        if (window.showToast) {
          window.showToast('Invite revoked successfully', 'success');
        }
        // Reload invites
        loadStaffAndInvites();
      } else {
        if (window.showToast) {
          window.showToast('Failed to revoke invite', 'error');
        }
      }
    } catch (error) {
      console.error('Error revoking invite:', error);
      if (window.showToast) {
        window.showToast('Failed to revoke invite', 'error');
      }
    }
  };

  const handleResign = async () => {
    if (!resignationReason.trim()) {
      if (window.showToast) {
        window.showToast('Please provide a reason for resignation', 'warning');
      }
      return;
    }

    setIsResigning(true);
    try {
      const response = await apiRequest(`/staff/${state.currentUser._id}/resign`, {
        method: 'PATCH',
        body: {
          reason: resignationReason.trim()
        }
      });

      if (response.success) {
        if (window.showToast) {
          window.showToast('You have successfully resigned. Your account has been deactivated.', 'success');
        }
        // Logout immediately
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
      } else {
        if (window.showToast) {
          window.showToast(response.message || 'Failed to process resignation', 'error');
        }
      }
    } catch (error) {
      console.error('Resignation error:', error);
      if (window.showToast) {
        window.showToast('Failed to process resignation', 'error');
      }
    } finally {
      setIsResigning(false);
      setShowResignModal(false);
      setResignationReason('');
    }
  };

  // Filter staff based on search and status
  const filteredStaff = useMemo(() => {
    if (!Array.isArray(staff)) return [];

    return staff.filter(member => {
      if (!member || typeof member !== 'object') return false;

      const name = member.name || '';
      const email = member.email || '';
      const isActive = member.isActive;

      const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' ||
                           (statusFilter === 'active' && isActive && !member.isSuspend) ||
                           (statusFilter === 'resigned' && !isActive && !member.isSuspend) ||
                           (statusFilter === 'suspended' && member.isSuspend);

      return matchesSearch && matchesStatus;
    });
  }, [staff, searchTerm, statusFilter]);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getPermissionCount = (permissions) => {
    if (!permissions || typeof permissions !== 'object') return 0;
    try {
      return Object.values(permissions).filter(Boolean).length;
    } catch (error) {
      console.warn('Error counting permissions:', error);
      return 0;
    }
  };

  try {
    return (
      <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="bg-white/20 backdrop-blur-sm p-3 rounded-xl shadow-lg">
                <Users className="h-8 w-8" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">Staff Management</h1>
                <p className="text-indigo-100 mt-1">Manage your team members and their access permissions</p>
              </div>
            </div>
            {!isStaffUser && (
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => {
                    console.log('🎯 Invite History button clicked');
                    setShowInviteHistoryModal(true);
                    console.log('🔄 Modal state set to true');
                    loadInviteHistory();
                  }}
                  className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors duration-200 flex items-center space-x-2 shadow-lg"
                >
                  <History className="h-5 w-5" />
                  <span>Invite History</span>
                </button>
                <button
                  onClick={() => {
                    setInviteForm({ permissions: {} }); // Reset form for new invites
                    setShowInviteModal(true);
                  }}
                  className="bg-white text-indigo-600 px-6 py-3 rounded-xl font-semibold hover:bg-indigo-50 transition-colors duration-200 flex items-center space-x-2 shadow-lg"
                >
                  <UserPlus className="h-5 w-5" />
                  <span>Invite Staff</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium">Total Staff</p>
                <p className="text-2xl font-bold text-gray-900">{staff.length}</p>
                <p className="text-xs text-gray-500 mt-1">All time | Raw: {staff.length}</p>
              </div>
              <div className="bg-blue-100 p-2 rounded-lg">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium">Active Staff</p>
                <p className="text-2xl font-bold text-green-600">{staff.filter(s => s.isActive).length}</p>
                <p className="text-xs text-gray-500 mt-1">Working | Raw: {staff.filter(s => s.isActive).length}</p>
              </div>
              <div className="bg-green-100 p-2 rounded-lg">
                <UserCheck className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium">Inactive Staff</p>
                <p className="text-2xl font-bold text-red-600">{staff.filter(s => !s.isActive && !s.isSuspend).length}</p>
                <p className="text-xs text-gray-500 mt-1">Inactive | Raw: {staff.filter(s => !s.isActive && !s.isSuspend).length}</p>
              </div>
              <div className="bg-red-100 p-2 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium">Suspended Staff</p>
                <p className="text-2xl font-bold text-orange-600">{staff.filter(s => s.isSuspend).length}</p>
                <p className="text-xs text-gray-500 mt-1">Suspended | Raw: {staff.filter(s => s.isSuspend).length}</p>
              </div>
              <div className="bg-orange-100 p-2 rounded-lg">
                <Ban className="h-5 w-5 text-orange-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium">Pending</p>
                <p className="text-2xl font-bold text-amber-600">{invites.length}</p>
              </div>
              <div className="bg-amber-100 p-2 rounded-lg">
                <Mail className="h-5 w-5 text-amber-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Filters and Search */}
        <div className="sticky top-4 z-10 bg-white/90 backdrop-blur-md rounded-2xl border border-white/20 shadow-xl ring-1 ring-gray-200/50 p-6 mb-8 transition-all duration-200 ease-in-out">
          <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Search Input */}
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Search className="h-5 w-6 text-slate-400" />
                </div>
                <input
                  type="text"
                  placeholder="Search by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="block w-full min-w-[400px] pl-12 pr-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 focus:bg-white transition-all duration-200 ease-in-out text-sm font-medium"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Dashboard-Style Status Filters */}
              <div className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm ${
                    statusFilter === 'all'
                      ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow'
                      : 'text-slate-600 hover:text-[#2f3c7e] hover:bg-white'
                  }`}
                >
                  All ({staff.length})
                </button>
                <button
                  onClick={() => setStatusFilter('active')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm ${
                    statusFilter === 'active'
                      ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow'
                      : 'text-slate-600 hover:text-[#2f3c7e] hover:bg-white'
                  }`}
                >
                  Active ({staff.filter(s => s.isActive).length})
                </button>
                <button
                  onClick={() => setStatusFilter('resigned')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm ${
                    statusFilter === 'resigned'
                      ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow'
                      : 'text-slate-600 hover:text-[#2f3c7e] hover:bg-white'
                  }`}
                >
                  Resigned ({staff.filter(s => !s.isActive && !s.isSuspend).length})
                </button>
                <button
                  onClick={() => setStatusFilter('suspended')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm ${
                    statusFilter === 'suspended'
                      ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow'
                      : 'text-slate-600 hover:text-[#2f3c7e] hover:bg-white'
                  }`}
                >
                  Suspended ({staff.filter(s => s.isSuspend).length})
                </button>
              </div>

              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="px-3 py-1.5 rounded-full font-medium text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors border border-slate-200 hover:border-slate-300 flex items-center gap-1.5"
                >
                  <X className="h-3 w-3" />
                  <span>Clear search</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Pending Invites Section */}
        {invites.length > 0 && (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/20 shadow-lg ring-1 ring-gray-200/50 p-6 mb-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-3 rounded-xl shadow-lg">
                  <Mail className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900 bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">Pending Invites</h3>
                  <p className="text-slate-600 text-sm mt-1">Invitations sent but not yet accepted</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm text-amber-600 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-2 rounded-xl border border-amber-100">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
                <span className="font-semibold">{invites.length} pending invites</span>
              </div>
            </div>

            <div className="space-y-3">
              {invites.map((invite) => (
                <div
                  key={invite._id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <Mail className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Invite sent to: {invite.email || 'Unknown'}</p>
                      <p className="text-sm text-gray-600">
                        Sent on {new Date(invite.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <div className="text-right">
                      <p className="text-sm text-gray-600">
                        Expires: {new Date(invite.expiryTime).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric'
                        })}
                      </p>
                      <p className="text-xs text-gray-500">
                        {(() => {
                          const now = new Date();
                          const expiry = new Date(invite.expiryTime);
                          const hoursLeft = Math.max(0, Math.floor((expiry - now) / (1000 * 60 * 60)));
                          if (hoursLeft < 24) {
                            return `${hoursLeft}h left`;
                          }
                          return `${Math.floor(hoursLeft / 24)}d left`;
                        })()}
                      </p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full">
                        Pending
                      </span>

                      {!isStaffUser && (
                        <button
                          onClick={() => handleRevokeInvite(invite._id)}
                          className="text-red-600 hover:text-red-800 p-1 rounded-full hover:bg-red-50 transition-colors"
                          title="Revoke invite"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Staff Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
              <p className="text-gray-600 font-medium">Loading staff members...</p>
            </div>
          </div>
        ) : filteredStaff.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="max-w-md mx-auto">
              <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
                <Users className="h-10 w-10 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {staff.length === 0 ? 'No staff members yet' : 'No matching staff found'}
              </h3>
              <p className="text-gray-600 mb-6">
                {staff.length === 0
                  ? 'Get started by inviting your first team member to help manage your business.'
                  : 'Try adjusting your search or filter criteria.'
                }
              </p>
              {staff.length === 0 && !isStaffUser && (
                <button
                  onClick={() => {
                    setInviteForm({ permissions: {} }); // Reset form for new invites
                    setShowInviteModal(true);
                  }}
                  className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors flex items-center space-x-2 mx-auto"
                >
                  <UserPlus className="h-5 w-5" />
                  <span>Invite First Staff Member</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Staff Table - Desktop View */}
            <div className="card hidden lg:block">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Staff Member</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700">Status</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700">Permissions</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700">Last Active</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700">Joined</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredStaff.length > 0 ? (
                      filteredStaff.map((member) => (
                        <tr key={member._id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="relative flex-shrink-0">
                                <div className="w-10 h-10 rounded-lg overflow-hidden ring-2 ring-gray-200">
                                  {member.profilePicture ? (
                                    <img
                                      src={member.profilePicture}
                                      alt={member.name}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        e.target.style.display = 'none';
                                        const fallback = e.target.parentElement.querySelector('.fallback-avatar');
                                        if (fallback) fallback.style.display = 'flex';
                                      }}
                                    />
                                  ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                                      <UserCheck className="h-5 w-5 text-white" />
                                    </div>
                                  )}
                                  <div className="fallback-avatar w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center" style={{ display: 'none' }}>
                                    <UserCheck className="h-5 w-5 text-white" />
                                  </div>
                                </div>
                                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                                  member.isActive ? 'bg-emerald-500' : 'bg-red-500'
                                }`} />
                              </div>
                              <div className="ml-3 min-w-0 flex-1">
                                <div className="text-sm font-semibold text-gray-900 truncate">
                                  {member.name || 'Unknown'}
                                </div>
                                <div className="text-sm text-gray-600 truncate">
                                  {member.email || 'No email'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-center">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              member.isSuspend
                                ? 'bg-orange-50 text-orange-700 border border-orange-200'
                                : member.isActive
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}>
                              <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                                member.isSuspend ? 'bg-orange-500' : member.isActive ? 'bg-emerald-500' : 'bg-red-500'
                              }`} />
                              {member.isSuspend ? 'Suspended' : member.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-center">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                              <Shield className="h-3 w-3 mr-1" />
                              {getPermissionCount(member.permissions)}
                            </span>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 text-center">
                            {formatDate(member.lastActivityDate)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 text-center">
                            {formatDate(member.createdAt)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center space-x-1">
                              <button
                                onClick={() => {
                                  setSelectedStaff(member);
                                  setShowStaffDetailsModal(true);
                                }}
                                className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all duration-200"
                                title="View Details"
                              >
                                <Eye className="h-4 w-4" />
                              </button>

                              {!isStaffUser && (
                                <>
                                  <button
                                    onClick={() => {
                                      setSelectedStaff(member);
                                      setInviteForm({ permissions: { ...member.permissions } });
                                      setShowPermissionsModal(true);
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-all duration-200"
                                    title="Edit Permissions"
                                  >
                                    <Shield className="h-4 w-4" />
                                  </button>

                                  <button
                                    onClick={() => handleSuspendStaff(member._id, !member.isSuspend)}
                                    className={`p-1.5 rounded-md transition-all duration-200 ${
                                      member.isSuspend
                                        ? 'text-green-600 hover:text-green-800 hover:bg-green-50'
                                        : 'text-orange-600 hover:text-orange-800 hover:bg-orange-50'
                                    }`}
                                    title={member.isSuspend ? 'Unsuspend Staff' : 'Suspend Staff'}
                                  >
                                    <Ban className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className="px-4 py-8 text-center text-sm text-gray-500">
                          No staff members found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Staff Cards - Mobile View */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:hidden gap-4">
              {filteredStaff.map((member) => (
                <div
                  key={member._id}
                  className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start space-x-3">
                    <div className="relative flex-shrink-0">
                      <div className="w-12 h-12 rounded-lg overflow-hidden ring-2 ring-gray-200">
                        {member.profilePicture ? (
                          <img
                            src={member.profilePicture}
                            alt={member.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              const fallback = e.target.parentElement.querySelector('.fallback-avatar');
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                            <UserCheck className="h-5 w-5 text-white" />
                          </div>
                        )}
                        <div className="fallback-avatar w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center" style={{ display: 'none' }}>
                          <UserCheck className="h-5 w-5 text-white" />
                        </div>
                      </div>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                        member.isActive ? 'bg-emerald-500' : 'bg-red-500'
                      }`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold text-gray-900 truncate">
                            {member.name || 'Unknown'}
                          </h3>
                          <p className="text-sm text-gray-600 truncate">
                            {member.email || 'No email'}
                          </p>
                        </div>

                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => {
                              setSelectedStaff(member);
                              setShowStaffDetailsModal(true);
                            }}
                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all duration-200"
                            title="View Details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>

                          {!isStaffUser && (
                            <>
                              <button
                                onClick={() => {
                                  setSelectedStaff(member);
                                  setInviteForm({ permissions: { ...member.permissions } });
                                  setShowPermissionsModal(true);
                                }}
                                className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-all duration-200"
                                title="Edit Permissions"
                              >
                                <Shield className="h-4 w-4" />
                              </button>

                              <button
                                onClick={() => handleSuspendStaff(member._id, !member.isSuspend)}
                                className={`p-1.5 rounded-md transition-all duration-200 ${
                                  member.isSuspend
                                    ? 'text-green-600 hover:text-green-800 hover:bg-green-50'
                                    : 'text-orange-600 hover:text-orange-800 hover:bg-orange-50'
                                }`}
                                title={member.isSuspend ? 'Unsuspend Staff' : 'Suspend Staff'}
                              >
                                <Ban className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            member.isSuspend
                              ? 'bg-orange-50 text-orange-700 border border-orange-200'
                              : member.isActive
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}>
                            <div className={`w-1.5 h-1.5 rounded-full mr-1 ${
                              member.isSuspend ? 'bg-orange-500' : member.isActive ? 'bg-emerald-500' : 'bg-red-500'
                            }`} />
                            {member.isSuspend ? 'Suspended' : member.isActive ? 'Active' : 'Inactive'}
                          </span>

                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                            <Shield className="h-3 w-3 mr-1" />
                            {getPermissionCount(member.permissions)}
                          </span>
                        </div>

                        <div className="text-xs text-gray-500">
                          Joined {formatDate(member.createdAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Staff Permissions Section (for staff users only) */}
        {isStaffUser && (
          <div className="space-y-8">
            {/* Staff Permissions View */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center space-x-3 mb-6">
                <div className="bg-indigo-100 rounded-full p-2">
                  <Shield className="h-6 w-6 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Your Permissions</h3>
                  <p className="text-gray-600 text-sm">Current access permissions granted by your seller</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {state.currentUser?.permissions && Object.entries(state.currentUser.permissions).map(([key, value]) => (
                  <div
                    key={key}
                    className={`p-4 rounded-lg border ${
                      value
                        ? 'bg-green-50 border-green-200'
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-3 h-3 rounded-full ${
                        value ? 'bg-green-500' : 'bg-gray-400'
                      }`}></div>
                      <div>
                        <p className="font-medium text-sm text-gray-900 capitalize">
                          {key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                        <p className={`text-xs ${
                          value ? 'text-green-600' : 'text-gray-500'
                        }`}>
                          {value ? 'Enabled' : 'Disabled'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900">Permission Changes</p>
                    <p className="text-sm text-blue-700 mt-1">
                      If you need additional permissions or believe your current permissions are incorrect,
                      please contact your seller directly.
                    </p>
                  </div>
                </div>
              </div>

              {/* Resignation Section for Staff */}
              <div className="mt-8 pt-6 border-t border-gray-200">
                <div className="bg-red-50 rounded-lg p-6 border border-red-200">
                  <div className="flex items-start space-x-3">
                    <AlertCircle className="h-6 w-6 text-red-600 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-red-900 mb-2">Resign from Position</h4>
                      <p className="text-red-700 text-sm mb-4">
                        If you wish to leave your current position, you can resign. This action cannot be undone
                        and will permanently deactivate your account and revoke all access.
                      </p>
                      <button
                        onClick={() => setShowResignModal(true)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium flex items-center space-x-2 transition-colors"
                      >
                        <AlertCircle className="h-4 w-4" />
                        <span>Resign</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Invite Modal */}
        {showInviteModal && !isStaffUser && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
              <div className="bg-gradient-to-r from-[#2f3c7e] to-[#18224f] px-6 py-4 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                  <UserPlus className="h-6 w-6" />
                  <span>Invite New Staff Member</span>
                </h3>
                <button
                  onClick={() => setShowInviteModal(false)}
                  className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="p-6 max-h-96 overflow-y-auto">
                <div className="space-y-6">
                  <div className="text-center">
                    <p className="text-gray-600">Configure permissions for the new staff member and generate an invite link.</p>
                  </div>

                  {/* Permission Groups */}
                  <div className="space-y-4">
                    {Object.entries(permissionGroups).map(([groupKey, group]) => (
                      <div key={groupKey} className="bg-gray-50 rounded-xl p-4">
                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center space-x-2">
                          <Shield className="h-4 w-4 text-indigo-600" />
                          <span>{group.title}</span>
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {Object.entries(group.permissions).map(([permKey, permLabel]) => (
                            <label key={permKey} className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={inviteForm.permissions[permKey] || false}
                                onChange={(e) => handlePermissionChange(permKey, e.target.checked)}
                                className="w-4 h-4 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500"
                              />
                              <span className="text-sm text-gray-700">{permLabel}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-200 p-6 flex justify-end space-x-3">
                <button
                  onClick={() => setShowInviteModal(false)}
                  className="px-6 py-3 rounded-xl font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateInvite}
                  className="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#2f3c7e] to-[#18224f] hover:from-[#243168] hover:to-[#111c44] transition-colors"
                >
                  Generate Invite Link
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Staff Details Modal */}
        {showStaffDetailsModal && selectedStaff && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
              <div className="bg-gradient-to-r from-[#2f3c7e] to-[#18224f] px-6 py-4 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                  <Eye className="h-6 w-6" />
                  <span>{selectedStaff.name}</span>
                </h3>
                <button
                  onClick={() => setShowStaffDetailsModal(false)}
                  className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="p-6 max-h-96 overflow-y-auto">
                <div className="space-y-6">
                  {/* Basic Info */}
                  <div className="flex items-center space-x-4">
                    <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-gray-200">
                      {selectedStaff.profilePicture ? (
                        <>
                          <img
                            src={selectedStaff.profilePicture}
                            alt={selectedStaff.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.parentElement.querySelector('.fallback-avatar').style.display = 'flex';
                            }}
                          />
                          <div className="fallback-avatar w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center" style={{ display: 'none' }}>
                            <UserCheck className="h-8 w-8 text-white" />
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                          <UserCheck className="h-8 w-8 text-white" />
                        </div>
                      )}
                    </div>
                    <div>
                      <h4 className="text-xl font-semibold text-gray-900">{selectedStaff.name}</h4>
                      <p className="text-gray-600">{selectedStaff.email}</p>
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium mt-2 ${
                        selectedStaff.isSuspend
                          ? 'bg-orange-100 text-orange-800'
                          : selectedStaff.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {selectedStaff.isSuspend ? 'Suspended' : selectedStaff.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h5 className="font-semibold text-gray-900 flex items-center space-x-2">
                        <Mail className="h-4 w-4" />
                        <span>Contact Information</span>
                      </h5>
                      <div className="space-y-2 text-sm">
                        <p><strong>Email:</strong> {selectedStaff.email}</p>
                        <p><strong>Joined:</strong> {formatDate(selectedStaff.createdAt)}</p>
                        <p><strong>Last Active:</strong> {formatDate(selectedStaff.lastActivityDate)}</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h5 className="font-semibold text-gray-900 flex items-center space-x-2">
                        <Shield className="h-4 w-4" />
                        <span>Permissions ({getPermissionCount(selectedStaff.permissions)})</span>
                      </h5>
                      <div className="space-y-2">
                        {Object.entries(permissionGroups).map(([groupKey, group]) => {
                          const groupPerms = Object.keys(group.permissions).filter(
                            perm => selectedStaff.permissions[perm]
                          );
                          if (groupPerms.length === 0) return null;

                          return (
                            <div key={groupKey}>
                              <h6 className="text-sm font-medium text-gray-700 mb-1">{group.title}</h6>
                              <div className="flex flex-wrap gap-1">
                                {groupPerms.map(permKey => (
                                  <span
                                    key={permKey}
                                    className="px-2 py-1 bg-indigo-100 text-indigo-800 text-xs rounded-full"
                                  >
                                    {group.permissions[permKey]}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        {getPermissionCount(selectedStaff.permissions) === 0 && (
                          <p className="text-sm text-gray-500 italic">No permissions assigned</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Invited By */}
                  {selectedStaff.invitedBy && (
                    <div className="bg-gray-50 rounded-xl p-4">
                      <h5 className="font-semibold text-gray-900 mb-2">Invitation Details</h5>
                      <p className="text-sm text-gray-600">
                        Invited by <strong>{selectedStaff.invitedBy.name}</strong> ({selectedStaff.invitedBy.email})
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Token: {selectedStaff.inviteToken}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-200 p-6 flex justify-end">
                <button
                  onClick={() => setShowStaffDetailsModal(false)}
                  className="px-6 py-3 rounded-xl font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Permissions Modal */}
        {showPermissionsModal && selectedStaff && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
              <div className="bg-gradient-to-r from-[#2f3c7e] to-[#18224f] px-6 py-4 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                  <Shield className="h-6 w-6" />
                  <span>Edit Permissions - {selectedStaff.name}</span>
                </h3>
                <button
                  onClick={() => setShowPermissionsModal(false)}
                  className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="p-6 max-h-96 overflow-y-auto">
                <div className="space-y-6">
                  {Object.entries(permissionGroups).map(([groupKey, group]) => (
                    <div key={groupKey} className="bg-gray-50 rounded-xl p-4">
                      <h4 className="font-semibold text-gray-900 mb-3 flex items-center space-x-2">
                        <Shield className="h-4 w-4 text-indigo-600" />
                        <span>{group.title}</span>
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Object.entries(group.permissions).map(([permKey, permLabel]) => (
                          <label key={permKey} className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={inviteForm.permissions[permKey] || false}
                              onChange={(e) => handlePermissionChange(permKey, e.target.checked)}
                              className="w-4 h-4 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500"
                            />
                            <span className="text-sm text-gray-700">{permLabel}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-gray-200 p-6 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowPermissionsModal(false);
                    // Reset form when canceling edit
                    setInviteForm({ permissions: {} });
                    setSelectedStaff(null);
                  }}
                  className="px-6 py-3 rounded-xl font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleUpdatePermissions(selectedStaff._id, inviteForm.permissions)}
                  className="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#2f3c7e] to-[#18224f] hover:from-[#243168] hover:to-[#111c44] transition-colors"
                >
                  Update Permissions
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Latest Invite Modal */}
        {latestInviteUrl && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
              <div className="bg-gradient-to-r from-[#2f3c7e] to-[#18224f] px-6 py-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <CheckCircle className="h-5 w-5" />
                  <span>Invite Link Created!</span>
                </h3>
                <button
                  onClick={() => setLatestInviteUrl(null)}
                  className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6">
                <p className="text-gray-600 mb-4">Share this link with your new staff member:</p>
                <div className="bg-gray-50 rounded-xl p-4 mb-4">
                  <p className="text-sm font-mono break-all text-gray-800">{latestInviteUrl}</p>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(latestInviteUrl);
                    if (window.showToast) window.showToast('Link copied to clipboard!', 'success');
                  }}
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center space-x-2"
                >
                  <Copy className="h-5 w-5" />
                  <span>Copy Link</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Invite History Modal */}
        {showInviteHistoryModal && !isStaffUser && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
              <div className="bg-gradient-to-r from-[#2f3c7e] to-[#18224f] px-6 py-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <History className="h-5 w-5" />
                  <span>All Invites History</span>
                </h3>
                <button
                  onClick={() => setShowInviteHistoryModal(false)}
                  className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900">Complete Invite History</h4>
                      <p className="text-gray-600 text-sm">All invitation links: pending, expired, and accepted</p>
                    </div>
                    <div className="flex items-center space-x-4 text-sm">
                      <span className="flex items-center space-x-1">
                        <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                        <span>Pending ({inviteHistoryStats.pending || 0})</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                        <span>Accepted ({inviteHistoryStats.accepted || 0})</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                        <span>Expired ({inviteHistoryStats.expired || 0})</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                        <span>Revoked ({inviteHistoryStats.revoked || 0})</span>
                      </span>
                    </div>
                  </div>
                </div>

                {loadingInviteHistory ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    <span className="ml-3 text-gray-600">Loading invite history...</span>
                  </div>
                ) : inviteHistory.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="bg-gray-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                      <Mail className="h-8 w-8 text-gray-400" />
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">No Invites Yet</h4>
                    <p className="text-gray-600">Start inviting team members to see their history here.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Array.isArray(inviteHistory) && inviteHistory.map((invite, index) => {
                      try {
                        // Safety check for invite object
                        if (!invite || typeof invite !== 'object') {
                          console.error('❌ Invalid invite object at index', index, ':', invite);
                          return (
                            <div key={`error-${index}`} className="bg-red-50 border border-red-200 rounded-xl p-4">
                              <div className="flex items-center space-x-2">
                                <AlertCircle className="h-5 w-5 text-red-500" />
                                <span className="text-red-700 font-medium">Error loading invite</span>
                              </div>
                              <p className="text-red-600 text-sm mt-1">Invalid invite data received.</p>
                            </div>
                          );
                        }

                        // Determine status and styling
                        // Check if invite was revoked (takes precedence over other statuses)
                        let status = invite.status || 'pending';

                        // Check for various revocation indicators
                        if (invite.revokedAt || invite.isRevoked || invite.revoked || invite.deletedAt) {
                          status = 'revoked';
                        }
                        // Also check if accepted invite has null usedBy/usedAt (indicates revocation)
                        else if (status === 'accepted' && (!invite.usedBy || !invite.usedAt)) {
                          status = 'revoked';
                        }

                        let statusColor, statusText, statusIcon;

                        switch (status) {
                          case 'accepted':
                            statusColor = 'green';
                            statusText = 'Accepted';
                            statusIcon = <CheckCircle className="h-4 w-4" />;
                            break;
                          case 'expired':
                            statusColor = 'red';
                            statusText = 'Expired';
                            statusIcon = <XCircle className="h-4 w-4" />;
                            break;
                          case 'revoked':
                            statusColor = 'red';
                            statusText = 'Revoked';
                            statusIcon = <Ban className="h-4 w-4" />;
                            break;
                          default:
                            statusColor = 'yellow';
                            statusText = 'Pending';
                            statusIcon = <Clock className="h-4 w-4" />;
                        }

                        return (
                        <div
                          key={invite._id}
                          className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex items-start space-x-4">
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                                statusColor === 'green' ? 'bg-green-100' :
                                statusColor === 'red' ? 'bg-red-100' : 'bg-yellow-100'
                              }`}>
                                {statusColor === 'green' ? (
                                  <CheckCircle className={`h-6 w-6 text-green-600`} />
                                ) : statusColor === 'red' ? (
                                  <X className={`h-6 w-6 text-red-600`} />
                                ) : (
                                  <Clock className={`h-6 w-6 text-yellow-600`} />
                                )}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center space-x-3 mb-2">
                                  <h4 className="font-semibold text-gray-900">{invite?.email || 'Unknown Email'}</h4>
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    statusColor === 'green' ? 'bg-green-100 text-green-800' :
                                    statusColor === 'red' ? 'bg-red-100 text-red-800' :
                                    'bg-yellow-100 text-yellow-800'
                                  }`}>
                                    {statusIcon}
                                    <span className="ml-1">{statusText}</span>
                                  </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                                  <div>
                                    <span className="font-medium">Sent:</span>{' '}
                                    {invite?.createdAt ? new Date(invite.createdAt).toLocaleDateString('en-US', {
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    }) : 'Unknown'}
                                  </div>
                                  <div>
                                    <span className="font-medium">Expires:</span>{' '}
                                    <span className={status === 'expired' ? 'text-red-600' : status === 'revoked' ? 'text-red-600' : status === 'pending' ? 'text-yellow-600' : 'text-gray-600'}>
                                      {invite?.expiryTime ? new Date(invite.expiryTime).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      }) : 'Unknown'}
                                    </span>
                                  </div>
                                  {status === 'accepted' && invite.usedBy && (
                                    <>
                                      <div>
                                        <span className="font-medium">Accepted by:</span>{' '}
                                        <div className="flex items-center space-x-2 mt-1">
                                          {invite.usedBy.profilePicture && (
                                            <img
                                              src={invite.usedBy.profilePicture}
                                              alt={invite.usedBy.name}
                                              className="w-6 h-6 rounded-full"
                                            />
                                          )}
                                          <span>{invite.usedBy.name}</span>
                                          <span className="text-gray-500">({invite.usedBy.email})</span>
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Accepted on:</span>{' '}
                                        {invite.usedAt ? new Date(invite.usedAt).toLocaleDateString('en-US', {
                                          month: 'short',
                                          day: 'numeric',
                                          year: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit'
                                        }) : 'Unknown'}
                                      </div>
                                    </>
                                  )}
                                  {status === 'revoked' && (
                                    <div>
                                      <span className="font-medium text-gray-600">Revoked:</span>{' '}
                                      <span className="text-gray-500">This invite was revoked by the seller</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center space-x-2">
                              {/* Copy Link Button */}
                              {status === 'pending' && (
                                <button
                                  onClick={() => {
                                    const inviteUrl = `${window.location.origin}/staff/signup?token=${invite.token}`;
                                    navigator.clipboard.writeText(inviteUrl);
                                    if (window.showToast) window.showToast('Invite link copied!', 'success');
                                  }}
                                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                                  title="Copy invite link"
                                >
                                  <Copy className="h-4 w-4" />
                                </button>
                              )}

                              {/* View Link Button */}
                              {status === 'pending' && (
                                <button
                                  onClick={() => {
                                    const inviteUrl = `${window.location.origin}/staff/signup?token=${invite.token}`;
                                    window.open(inviteUrl, '_blank');
                                  }}
                                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                                  title="Open invite link"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </button>
                              )}

                              {/* Revoke Button */}
                              {status === 'pending' && (
                                <button
                                  onClick={() => handleRevokeInvite(invite._id)}
                                  className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-lg transition-colors"
                                  title="Revoke invite"
                                >
                                  <Ban className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Permissions */}
                          <div className="border-t pt-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <Shield className="h-4 w-4 text-gray-400" />
                                <span className="text-sm font-medium text-gray-700">Permissions:</span>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {invite?.permissions && typeof invite.permissions === 'object' ?
                                  Object.entries(invite.permissions).filter(([_, value]) => value === true).map(([key, _]) => (
                                  <span
                                    key={key}
                                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                                  >
                                    {key.replace(/_/g, ' ')}
                                  </span>
                                )) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                      } catch (inviteError) {
                        console.error('❌ Error rendering invite at index', index, ':', inviteError, invite);
                        return (
                          <div key={`error-${index}`} className="bg-red-50 border border-red-200 rounded-xl p-4">
                            <div className="flex items-center space-x-2">
                              <AlertCircle className="h-5 w-5 text-red-500" />
                              <span className="text-red-700 font-medium">Error loading invite</span>
                            </div>
                            <p className="text-red-600 text-sm mt-1">There was a problem displaying this invitation.</p>
                          </div>
                        );
                      }
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  } catch (error) {
    console.error('Error rendering Staff component:', error);
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="bg-red-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Component Error</h2>
          <p className="text-gray-600 mb-4">There was an error loading the staff page.</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
          >
            Reload Page
          </button>
        </div>
      </div>
    );

    {/* Resignation Modal */}
    {showResignModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Confirm Resignation</h3>
            <button
              onClick={() => {
                if (!isResigning) {
                  setShowResignModal(false);
                  setResignationReason('');
                }
              }}
              className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              disabled={isResigning}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-4">
            <p className="text-gray-600 text-sm mb-4">
              Are you sure you want to resign from your staff position? This action cannot be undone and will:
            </p>
            <ul className="text-sm text-gray-600 space-y-1 mb-4">
              <li>• Immediately deactivate your account</li>
              <li>• Revoke all your permissions</li>
              <li>• Remove access from all devices</li>
              <li>• Notify your seller about your resignation</li>
            </ul>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reason for resignation (optional)
            </label>
            <textarea
              value={resignationReason}
              onChange={(e) => setResignationReason(e.target.value)}
              placeholder="Please provide a reason for your resignation..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
              rows={3}
              disabled={isResigning}
              maxLength={500}
            />
            <p className="text-xs text-gray-500 mt-1">
              {resignationReason.length}/500 characters
            </p>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={() => {
                if (!isResigning) {
                  setShowResignModal(false);
                  setResignationReason('');
                }
              }}
              className="flex-1 btn-secondary"
              disabled={isResigning}
            >
              Cancel
            </button>
            <button
              onClick={handleResign}
              disabled={isResigning}
              className="flex-1 btn-primary bg-red-600 hover:bg-red-700 disabled:bg-red-400"
            >
              {isResigning ? (
                <>
                  <AlertCircle className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                'Confirm Resignation'
              )}
            </button>
          </div>
        </div>
      </div>
    )}
  }
};

export default Staff;


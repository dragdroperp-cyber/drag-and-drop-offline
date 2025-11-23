import React, { useState, useEffect } from 'react';
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
  Trash2,
  UserPlus,
  Search,
  Filter,
  ChevronDown,
  Clock,
  Phone,
  MapPin
} from 'lucide-react';
import { apiRequest } from '../../utils/api';

const Staff = () => {
  const { state } = useApp();
  const isStaffUser = state.userType === 'staff';
  const [activeTab, setActiveTab] = useState(isStaffUser ? 'permissions' : 'list');
  const [staff, setStaff] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ permissions: {} });
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showStaffDetailsModal, setShowStaffDetailsModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [latestInviteUrl, setLatestInviteUrl] = useState(null);
  const [latestInviteToken, setLatestInviteToken] = useState(null);

  // Permission groups configuration
  const permissionGroups = {
    dashboard: {
      title: 'Dashboard & Analytics',
      permissions: {
        dashboard: 'Dashboard Access',
        reports: 'View Reports',
        financial: 'Financial Data'
      }
    },
    products: {
      title: 'Product Management',
      permissions: {
        products: 'Product Management',
        products_view: 'View Products',
        products_add: 'Add Products',
        products_edit: 'Edit Products',
        products_delete: 'Delete Products'
      }
    },
    inventory: {
      title: 'Inventory Management',
      permissions: {
        inventory: 'Inventory Management',
        inventory_view: 'View Inventory',
        inventory_edit: 'Edit Inventory'
      }
    },
    billing: {
      title: 'Billing & Sales',
      permissions: {
        billing: 'Billing & Sales',
        billing_view: 'View Orders',
        billing_create: 'Create Orders',
        billing_edit: 'Edit Orders'
      }
    },
    settings: {
      title: 'Settings',
      permissions: {
        settings: 'Settings Access',
        settings_basic: 'Basic Settings'
      }
    }
  };

  // Load staff and invites on component mount
  useEffect(() => {
    loadStaffAndInvites();
  }, []);

  const loadStaffAndInvites = async () => {
    setLoading(true);
    try {
      const [staffResponse, invitesResponse] = await Promise.all([
        apiRequest('/staff').catch(err => ({ success: false, error: err.message })),
        apiRequest('/staff/invites').catch(err => ({ success: false, error: err.message }))
      ]);

      if (staffResponse.success && Array.isArray(staffResponse.data)) {
        setStaff(staffResponse.data);
      } else {
        console.error('Staff API failed or returned invalid data:', staffResponse);
        setStaff([]);
      }

      if (invitesResponse.success && Array.isArray(invitesResponse.data)) {
        setInvites(invitesResponse.data);
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

  // Filter staff based on search and status
  const filteredStaff = staff.filter(member => {
    const matchesSearch = member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         member.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' ||
                         (statusFilter === 'active' && member.isActive) ||
                         (statusFilter === 'inactive' && !member.isActive);
    return matchesSearch && matchesStatus;
  });

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getPermissionCount = (permissions) => {
    if (!permissions) return 0;
    return Object.values(permissions).filter(Boolean).length;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="bg-white/20 backdrop-blur-sm p-3 rounded-xl">
                <Users className="h-8 w-8" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">Staff Management</h1>
                <p className="text-indigo-100 mt-1">Manage your team members and their access permissions</p>
              </div>
            </div>
            {!isStaffUser && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="bg-white text-indigo-600 px-6 py-3 rounded-xl font-semibold hover:bg-indigo-50 transition-colors duration-200 flex items-center space-x-2 shadow-lg"
              >
                <UserPlus className="h-5 w-5" />
                <span>Invite Staff</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters and Search */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div className="flex flex-col sm:flex-row gap-4 flex-1">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="text"
                  placeholder="Search staff members..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                />
              </div>

              {/* Status Filter */}
              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="appearance-none bg-white border border-gray-300 rounded-xl px-4 py-3 pr-10 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Inactive Only</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5 pointer-events-none" />
              </div>
            </div>

            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>Total: {filteredStaff.length}</span>
              <span className="text-green-600">Active: {filteredStaff.filter(s => s.isActive).length}</span>
            </div>
          </div>
        </div>

        {/* Staff Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
              <p className="text-gray-600 font-medium">Loading staff members...</p>
            </div>
          </div>
        ) : filteredStaff.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
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
                  onClick={() => setShowInviteModal(true)}
                  className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors flex items-center space-x-2 mx-auto"
                >
                  <UserPlus className="h-5 w-5" />
                  <span>Invite First Staff Member</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredStaff.map((member) => (
              <div
                key={member._id}
                className="bg-white rounded-2xl shadow-sm border border-gray-200 hover:shadow-lg transition-shadow duration-200 overflow-hidden"
              >
                {/* Card Header */}
                <div className="p-6 pb-4">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        {member.profilePicture ? (
                          <img
                            src={member.profilePicture}
                            alt={member.name}
                            className="w-12 h-12 rounded-full object-cover border-2 border-gray-200"
                          />
                        ) : (
                          <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center border-2 border-gray-200">
                            <UserCheck className="h-6 w-6 text-white" />
                          </div>
                        )}
                        <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${
                          member.isActive ? 'bg-green-500' : 'bg-gray-400'
                        }`} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 text-lg">{member.name}</h3>
                        <p className="text-gray-600 text-sm">{member.email}</p>
                      </div>
                    </div>

                    <div className="relative">
                      <button
                        onClick={() => setSelectedStaff(selectedStaff?.id === member._id ? null : member)}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        <MoreVertical className="h-5 w-5 text-gray-400" />
                      </button>

                      {selectedStaff?.id === member._id && (
                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-10">
                          <button
                            onClick={() => {
                              setSelectedStaff(member);
                              setShowStaffDetailsModal(true);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                          >
                            <Eye className="h-4 w-4" />
                            <span>View Details</span>
                          </button>
                          {!isStaffUser && (
                            <>
                              <button
                                onClick={() => {
                                  setSelectedStaff(member);
                                  setShowPermissionsModal(true);
                                }}
                                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                              >
                                <Shield className="h-4 w-4" />
                                <span>Edit Permissions</span>
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedStaff(member);
                                  setShowDeleteModal(true);
                                }}
                                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2"
                              >
                                <Trash2 className="h-4 w-4" />
                                <span>Remove Staff</span>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status and Permissions */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        member.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {member.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <span className="text-sm text-gray-600">
                        {getPermissionCount(member.permissions)} permissions
                      </span>
                    </div>

                    {/* Last Activity */}
                    <div className="flex items-center text-sm text-gray-600">
                      <Clock className="h-4 w-4 mr-2" />
                      <span>Last active: {formatDate(member.lastActivityDate)}</span>
                    </div>

                    {/* Invited By */}
                    {member.invitedBy && (
                      <div className="flex items-center text-sm text-gray-600">
                        <UserCheck className="h-4 w-4 mr-2" />
                        <span>Invited by: {member.invitedBy.name}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Footer */}
                <div className="px-6 pb-6">
                  <div className="text-xs text-gray-500">
                    Joined {formatDate(member.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Invite Modal */}
        {showInviteModal && !isStaffUser && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
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
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
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
                    {selectedStaff.profilePicture ? (
                      <img
                        src={selectedStaff.profilePicture}
                        alt={selectedStaff.name}
                        className="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center border-2 border-gray-200">
                        <UserCheck className="h-8 w-8 text-white" />
                      </div>
                    )}
                    <div>
                      <h4 className="text-xl font-semibold text-gray-900">{selectedStaff.name}</h4>
                      <p className="text-gray-600">{selectedStaff.email}</p>
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium mt-2 ${
                        selectedStaff.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {selectedStaff.isActive ? 'Active' : 'Inactive'}
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
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
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
                  onClick={() => setShowPermissionsModal(false)}
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
      </div>
    </div>
  );
};

export default Staff;

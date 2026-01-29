import React, { useState } from 'react';
import { X, Search, Edit2, Trash2, Check, Image as ImageIcon, Save, Plus, Layers } from 'lucide-react';
import { useApp, ActionTypes } from '../../context/AppContext';
import { getSellerIdFromAuth } from '../../utils/api';

import ReactDOM from 'react-dom';

const ManageCategoriesModal = ({ onClose }) => {
    const { state, dispatch } = useApp();
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [editForm, setEditForm] = useState({ name: '', description: '', image: '', onlineSale: true });
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);

    const currentSellerId = getSellerIdFromAuth();

    // Filter categories
    const filteredCategories = state.categories
        .filter(c => !c.isDeleted)
        .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const resetForm = () => {
        setEditForm({ name: '', description: '', image: '', onlineSale: true });
        setEditingId(null);
        setIsAddingCategory(false);
        setDeleteConfirmId(null);
    };

    const handleEditClick = (category) => {
        setIsAddingCategory(false);
        setEditingId(category.id || category._id);
        setEditForm({
            name: category.name || '',
            description: category.description || '',
            image: category.image || '',
            onlineSale: category.onlineSale !== false
        });
        setDeleteConfirmId(null);
    };

    const originalCategory = editingId ? state.categories.find(c => (c.id || c._id) === editingId) : null;

    const hasChanges = isAddingCategory
        ? editForm.name.trim().length > 0
        : editingId && originalCategory && (
            editForm.name.trim() !== (originalCategory.name || '') ||
            (editForm.description || '') !== (originalCategory.description || '') ||
            (editForm.image || '') !== (originalCategory.image || '') ||
            (editForm.onlineSale !== false) !== (originalCategory.onlineSale !== false)
        );

    const handleSave = () => {
        if (!editForm.name.trim()) return;
        if (!hasChanges) {
            if (window.showToast) window.showToast('No changes detected', 'info');
            return;
        }

        if (isAddingCategory) {
            const catObj = {
                id: `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: editForm.name.trim(),
                createdAt: new Date().toISOString(),
                sellerId: currentSellerId,
                image: editForm.image || '',
                description: editForm.description || '',
                onlineSale: editForm.onlineSale !== false
            };
            dispatch({ type: ActionTypes.ADD_CATEGORY, payload: catObj });
            if (window.showToast) window.showToast('Category created', 'success');
        } else {
            if (!originalCategory) return;

            const updatedCategory = {
                ...originalCategory,
                name: editForm.name.trim(),
                description: editForm.description || '',
                image: editForm.image || '',
                onlineSale: editForm.onlineSale !== false,
                updatedAt: new Date().toISOString()
            };
            dispatch({ type: ActionTypes.UPDATE_CATEGORY, payload: updatedCategory });
            if (window.showToast) window.showToast('Category updated', 'success');
        }

        resetForm();
    };

    const handleDelete = (id) => {
        if (deleteConfirmId === id) {
            dispatch({ type: ActionTypes.DELETE_CATEGORY, payload: id });
            resetForm();
        } else {
            setDeleteConfirmId(id);
            setTimeout(() => setDeleteConfirmId(null), 3000);
        }
    };

    const modalContent = (
        <div className="fixed inset-0 bg-white dark:bg-slate-900 z-[99999] flex flex-col animate-fadeIn overflow-hidden">

            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-20">
                <div className="flex items-center gap-4">
                    <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                        <Layers className="h-5 w-5 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-gray-900 dark:text-white uppercase tracking-tight">
                            Manage Categories
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg text-gray-400 hover:text-gray-900 transition-all"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden">
                <div className="max-w-5xl mx-auto h-full flex flex-col">
                    <div className="p-6 border-b border-gray-50 dark:border-slate-800/50 flex flex-col md:flex-row gap-4 items-center justify-between bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
                        <div className="relative w-full md:w-96 group">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-slate-900 dark:group-focus-within:text-white transition-colors" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search categories..."
                                className="w-full pl-11 pr-4 h-[52px] bg-slate-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 rounded-xl text-sm font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white transition-all shadow-inner"
                            />
                        </div>
                        <button
                            onClick={() => {
                                setIsAddingCategory(true);
                                setEditingId(null);
                                setEditForm({ name: '', description: '', image: '', onlineSale: true });
                            }}
                            className="w-full md:w-auto flex items-center justify-center gap-2 px-8 py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg hover:shadow-xl active:scale-[0.98] hover:opacity-90 shrink-0"
                        >
                            <Plus className="h-5 w-5" />
                            Add New Category
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredCategories.map(cat => (
                                <div
                                    key={cat.id || cat._id}
                                    onClick={() => handleEditClick(cat)}
                                    className="group p-4 bg-white dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800 rounded-2xl cursor-pointer transition-all hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-xl hover:-translate-y-1 flex items-center gap-4 relative overflow-hidden"
                                >
                                    <div className="h-16 w-16 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden border border-gray-100 dark:border-slate-700 shadow-inner group-hover:scale-105 transition-transform duration-300">
                                        {cat.image ? (
                                            <img src={cat.image} className="w-full h-full object-cover" alt={cat.name} />
                                        ) : (
                                            <div className="flex flex-col items-center">
                                                <Layers className="h-6 w-6 text-slate-200" />
                                                <span className="text-[10px] font-bold text-slate-300 mt-1 uppercase">
                                                    {cat.name.substring(0, 2)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                                            {cat.name}
                                        </h3>
                                        <p className="text-xs text-gray-400 dark:text-slate-500 line-clamp-1 mt-1 font-medium">
                                            {cat.description || "No description provided"}
                                        </p>
                                        <div className="flex items-center gap-2 mt-2">
                                            <span className={`h-1.5 w-1.5 rounded-full ${cat.onlineSale !== false ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">
                                                {cat.onlineSale !== false ? 'Visible Online' : 'Hidden'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="absolute right-4 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                                        <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                                            <Edit2 className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {filteredCategories.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-center py-20 animate-in fade-in zoom-in duration-500">
                                <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-full mb-6">
                                    <Layers className="h-16 w-16 text-slate-200" />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900 dark:text-white">No categories found</h3>
                                <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">
                                    Try adjusting your search or add a new category to get started.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Edit Category Popup Modal */}
            {editingId && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100000] flex items-center justify-center p-0 md:p-4 animate-fadeIn">
                    <div className="bg-white dark:bg-slate-900 shadow-2xl w-full h-full md:h-auto md:max-h-[85vh] md:max-w-xl md:rounded-xl rounded-none border-none md:border md:border-white/20 dark:md:border-slate-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                                    <Edit2 className="h-5 w-5 text-slate-900 dark:text-white" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white uppercase tracking-tight">Edit Category</h3>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handleDelete(editingId)}
                                    className={`p-2 rounded-lg transition-all flex items-center gap-2 group ${deleteConfirmId === editingId
                                        ? 'bg-red-600 text-white'
                                        : 'hover:bg-red-50 text-gray-400 hover:text-red-500'
                                        }`}
                                >
                                    <Trash2 className="h-5 w-5" />
                                    {deleteConfirmId === editingId && <span className="text-xs font-bold uppercase">Confirm?</span>}
                                </button>
                                <button onClick={resetForm} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-400 transition-colors">
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        <div className="p-8 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                <div className="md:col-span-1">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Preview</label>
                                    <div className="w-24 h-24 md:w-full md:aspect-square bg-slate-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 flex items-center justify-center overflow-hidden relative shadow-inner mt-2">
                                        {editForm.image ? (
                                            <img src={editForm.image} className="w-full h-full object-cover" alt="Preview" />
                                        ) : (
                                            <ImageIcon className="h-8 w-8 text-gray-300" />
                                        )}
                                    </div>
                                </div>
                                <div className="md:col-span-3 space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Name</label>
                                        <input
                                            type="text"
                                            value={editForm.name}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                            className="w-full h-[52px] px-5 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-base font-bold text-gray-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none transition-all"
                                            placeholder="Category Name"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Image URL</label>
                                        <input
                                            type="text"
                                            value={editForm.image}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, image: e.target.value }))}
                                            className="w-full h-[52px] px-5 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none transition-all"
                                            placeholder="https://..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Description</label>
                                <textarea
                                    value={editForm.description}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                    className="w-full h-[100px] px-5 py-4 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none resize-none transition-all"
                                    placeholder="Add a short description..."
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Visibility</label>
                                <label className="flex items-center gap-4 h-[52px] px-5 bg-slate-50 dark:bg-slate-800 border-none rounded-xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-all select-none">
                                    <input
                                        type="checkbox"
                                        checked={editForm.onlineSale !== false}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, onlineSale: e.target.checked }))}
                                        className="h-5 w-5 rounded-lg border-gray-300 text-slate-900 focus:ring-slate-900"
                                    />
                                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-tight">Display on online store</span>
                                </label>
                            </div>
                        </div>

                        <div className="p-6 border-t border-gray-50 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                            <button
                                onClick={handleSave}
                                disabled={!editForm.name.trim() || !hasChanges}
                                className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-sm font-bold uppercase tracking-widest transition-all shadow-xl active:scale-[0.98] disabled:opacity-50"
                            >
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Category Popup Modal */}
            {isAddingCategory && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100000] flex items-center justify-center p-0 md:p-4 animate-fadeIn">
                    <div className="bg-white dark:bg-slate-900 shadow-2xl w-full h-full md:h-auto md:max-h-[85vh] md:max-w-xl md:rounded-xl rounded-none border-none md:border md:border-white/20 dark:md:border-slate-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                                    <Plus className="h-5 w-5 text-slate-900 dark:text-white" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white uppercase tracking-tight">Create New Category</h3>
                            </div>
                            <button onClick={resetForm} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-400 transition-colors">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-8 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                <div className="md:col-span-1">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Preview</label>
                                    <div className="w-24 h-24 md:w-full md:aspect-square bg-slate-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 flex items-center justify-center overflow-hidden relative shadow-inner mt-2">
                                        {editForm.image ? (
                                            <img src={editForm.image} className="w-full h-full object-cover" alt="Preview" />
                                        ) : (
                                            <ImageIcon className="h-8 w-8 text-gray-300" />
                                        )}
                                    </div>
                                </div>
                                <div className="md:col-span-3 space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Name</label>
                                        <input
                                            type="text"
                                            value={editForm.name}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                            className="w-full h-[52px] px-5 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-base font-bold text-gray-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none transition-all"
                                            placeholder="e.g. Fresh Fruits"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Image URL</label>
                                        <input
                                            type="text"
                                            value={editForm.image}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, image: e.target.value }))}
                                            className="w-full h-[52px] px-5 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none transition-all"
                                            placeholder="https://..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Description</label>
                                <textarea
                                    value={editForm.description}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                    className="w-full h-[100px] px-5 py-4 bg-slate-50 dark:bg-slate-800 border-none rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none resize-none transition-all"
                                    placeholder="Add a short description..."
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Visibility</label>
                                <label className="flex items-center gap-4 h-[52px] px-5 bg-slate-50 dark:bg-slate-800 border-none rounded-xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-all select-none">
                                    <input
                                        type="checkbox"
                                        checked={editForm.onlineSale !== false}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, onlineSale: e.target.checked }))}
                                        className="h-5 w-5 rounded-lg border-gray-300 text-slate-900 focus:ring-slate-900"
                                    />
                                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-tight">Display on online store</span>
                                </label>
                            </div>
                        </div>

                        <div className="p-6 border-t border-gray-50 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                            <button
                                onClick={handleSave}
                                disabled={!editForm.name.trim()}
                                className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-sm font-bold uppercase tracking-widest transition-all shadow-xl active:scale-[0.98] disabled:opacity-50"
                            >
                                Create Category
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    return ReactDOM.createPortal(modalContent, document.body);
};

export default ManageCategoriesModal;

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
            <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-20 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white shadow-sm">
                        <Layers className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                            Category Management
                        </h1>
                        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">Organize your inventory</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all active:scale-90"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden">
                <div className="max-w-6xl mx-auto h-full flex flex-col">
                    <div className="p-6 flex flex-col md:flex-row gap-4 items-center justify-between bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10 border-b border-gray-50 dark:border-slate-800/50">
                        <div className="relative w-full md:w-[450px] group">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-slate-900 dark:group-focus-within:text-white transition-colors" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search all categories..."
                                className="w-full pl-12 pr-4 h-[56px] bg-slate-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-700/50 rounded-2xl text-base font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white transition-all shadow-inner placeholder:text-gray-400 placeholder:font-medium"
                            />
                        </div>
                        <button
                            onClick={() => {
                                setIsAddingCategory(true);
                                setEditingId(null);
                                setEditForm({ name: '', description: '', image: '', onlineSale: true });
                            }}
                            className="w-full md:w-auto flex items-center justify-center gap-3 px-8 py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl text-sm font-bold uppercase tracking-widest transition-all shadow-xl hover:shadow-2xl active:scale-95 hover:opacity-95 shrink-0"
                        >
                            <Plus className="h-5 w-5" />
                            Create Category
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
                        {filteredCategories.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {filteredCategories.map(cat => (
                                    <div
                                        key={cat.id || cat._id}
                                        onClick={() => handleEditClick(cat)}
                                        className="group relative p-5 bg-white dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800/60 rounded-[24px] cursor-pointer transition-all hover:border-slate-400 dark:hover:border-slate-500 hover:shadow-2xl hover:-translate-y-1.5 flex flex-col gap-4 overflow-hidden"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="h-20 w-20 rounded-[20px] bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden border-2 border-white dark:border-slate-700 shadow-lg group-hover:scale-110 transition-transform duration-500">
                                                {cat.image ? (
                                                    <img src={cat.image} className="w-full h-full object-cover" alt={cat.name} />
                                                ) : (
                                                    <div className="flex flex-col items-center">
                                                        <Layers className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                                                        <span className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-tighter">
                                                            {cat.name.substring(0, 2)}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${cat.onlineSale !== false ? 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'}`}>
                                                {cat.onlineSale !== false ? 'Active' : 'Private'}
                                            </div>
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <h3 className="text-lg font-extrabold text-gray-900 dark:text-white truncate group-hover:text-slate-900 dark:group-hover:text-amber-400 transition-colors">
                                                {cat.name}
                                            </h3>
                                            <p className="text-sm text-gray-500 dark:text-slate-400 line-clamp-2 mt-1.5 font-medium leading-relaxed">
                                                {cat.description || "Establish order by adding descriptive category details."}
                                            </p>
                                        </div>

                                        <div className="pt-2 flex items-center justify-between border-t border-gray-50 dark:border-slate-800/50">
                                            <div className="flex items-center gap-1.5">
                                                <div className={`h-2 w-2 rounded-full ${cat.onlineSale !== false ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`}></div>
                                                <span className="text-[11px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-tight">
                                                    {cat.onlineSale !== false ? 'Store Visible' : 'Admin Only'}
                                                </span>
                                            </div>
                                            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-xl group-hover:bg-slate-900 dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-slate-900 transition-all duration-300 transform group-hover:rotate-12">
                                                <Edit2 className="h-4 w-4" />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="h-[60vh] flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-700">
                                <div className="relative mb-8">
                                    <div className="absolute inset-0 bg-slate-100 dark:bg-slate-800 rounded-full blur-3xl opacity-50"></div>
                                    <div className="relative p-10 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-full shadow-2xl">
                                        <Layers className="h-20 w-20 text-slate-200 dark:text-slate-700" />
                                    </div>
                                    <div className="absolute -bottom-2 -right-2 bg-slate-900 dark:bg-white p-2 rounded-full text-white dark:text-slate-900 shadow-lg">
                                        <Plus className="h-6 w-6" />
                                    </div>
                                </div>
                                <h3 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">No Categories Found</h3>
                                <p className="text-gray-500 dark:text-slate-400 mt-3 max-w-sm mx-auto font-medium leading-relaxed">
                                    {searchTerm ? `We couldn't find any categories matching "${searchTerm}". Try a different term or clear filters.` : "Your inventory needs organization. Start by creating categories to group your products."}
                                </p>
                                {!searchTerm && (
                                    <button
                                        onClick={() => setIsAddingCategory(true)}
                                        className="mt-8 px-8 py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl text-xs font-bold uppercase tracking-widest shadow-xl hover:shadow-2xl transition-all"
                                    >
                                        Get Started Now
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Edit Category Popup Modal */}
            {editingId && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100000] flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-slate-900 shadow-2xl w-full max-w-4xl max-h-[85vh] rounded-[32px] border border-white/20 dark:border-slate-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-8 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-2xl text-slate-900 dark:text-white shadow-sm">
                                    <Edit2 className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Edit Category</h3>
                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">Update identity and details</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handleDelete(editingId)}
                                    className={`p-2.5 rounded-xl transition-all flex items-center gap-2 group ${deleteConfirmId === editingId
                                        ? 'bg-red-600 text-white shadow-lg shadow-red-500/30'
                                        : 'hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors'
                                        }`}
                                >
                                    <Trash2 className="h-5 w-5" />
                                    {deleteConfirmId === editingId && <span className="text-[10px] font-black uppercase tracking-widest">Confirm?</span>}
                                </button>
                                <button onClick={resetForm} className="p-2.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-400 transition-colors">
                                    <X className="h-6 w-6" />
                                </button>
                            </div>
                        </div>

                        <div className="p-8 space-y-8 overflow-y-auto flex-1 custom-scrollbar">
                            <div className="flex flex-col md:flex-row gap-8">
                                <div className="shrink-0 flex flex-col items-center">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 block w-full text-left">Brand Avatar</label>
                                    <div className="w-32 h-32 bg-slate-50 dark:bg-slate-800/50 rounded-[28px] border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden relative shadow-inner group/preview">
                                        {editForm.image ? (
                                            <>
                                                <img src={editForm.image} className="w-full h-full object-cover group-hover/preview:scale-110 transition-transform duration-500" alt="Preview" />
                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center">
                                                    <ImageIcon className="h-8 w-8 text-white" />
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-center">
                                                <ImageIcon className="h-10 w-10 text-slate-200 dark:text-slate-700 mx-auto" />
                                                <p className="text-[9px] font-bold text-slate-300 dark:text-slate-600 mt-2 uppercase">No Image</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1 space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-1">Display Name</label>
                                        <input
                                            type="text"
                                            value={editForm.name}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                            className="w-full h-[56px] px-5 bg-slate-50 dark:bg-slate-800/50 border border-transparent rounded-2xl text-base font-bold text-gray-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none transition-all shadow-inner placeholder:text-gray-300"
                                            placeholder="e.g. Premium Groceries"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-1">Visual Asset URL</label>
                                        <input
                                            type="text"
                                            value={editForm.image}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, image: e.target.value }))}
                                            className="w-full h-[56px] px-5 bg-slate-50 dark:bg-slate-800/50 border border-transparent rounded-2xl text-sm font-semibold text-gray-600 dark:text-gray-400 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none transition-all shadow-inner placeholder:text-gray-300"
                                            placeholder="https://images.unsplash.com/..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-1">Contextual Description</label>
                                <textarea
                                    value={editForm.description}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                    className="w-full h-[120px] px-5 py-4 bg-slate-50 dark:bg-slate-800/50 border border-transparent rounded-2xl text-sm font-medium text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none resize-none transition-all shadow-inner placeholder:text-gray-300 leading-relaxed"
                                    placeholder="Describe what kind of products belong in this category..."
                                />
                            </div>

                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-1">Visibility Status</label>
                                <label className="flex items-center gap-4 p-5 bg-slate-50 dark:bg-slate-800/50 border border-transparent rounded-[24px] cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-all select-none shadow-inner group/check">
                                    <div className={`h-6 w-6 rounded-lg border-2 flex items-center justify-center transition-all ${editForm.onlineSale !== false ? 'bg-slate-900 border-slate-900 dark:bg-white dark:border-white' : 'border-slate-200 dark:border-slate-700'}`}>
                                        <Check className={`h-4 w-4 transition-opacity ${editForm.onlineSale !== false ? 'opacity-100 text-white dark:text-slate-900' : 'opacity-0'}`} />
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={editForm.onlineSale !== false}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, onlineSale: e.target.checked }))}
                                        className="hidden"
                                    />
                                    <div className="flex-1">
                                        <span className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight block">Display in Online Catalog</span>
                                        <p className="text-[11px] font-bold text-gray-400 dark:text-slate-500 mt-0.5">Customers can browse this category in your web store.</p>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div className="p-8 border-t border-gray-50 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                            <button
                                onClick={handleSave}
                                disabled={!editForm.name.trim() || !hasChanges}
                                className="w-full py-5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-[20px] text-sm font-black uppercase tracking-[0.2em] transition-all shadow-xl hover:shadow-2xl active:scale-[0.98] disabled:opacity-30 disabled:grayscale"
                            >
                                Commit Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Category Popup Modal */}
            {isAddingCategory && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100000] flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-slate-900 shadow-2xl w-full max-w-4xl max-h-[85vh] rounded-[32px] border border-white/20 dark:border-slate-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-8 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-2xl text-slate-900 dark:text-white shadow-sm">
                                    <Plus className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">New Category</h3>
                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">Expand your catalog range</p>
                                </div>
                            </div>
                            <button onClick={resetForm} className="p-2.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-400 transition-colors">
                                <X className="h-6 w-6" />
                            </button>
                        </div>

                        <div className="p-8 space-y-8 overflow-y-auto flex-1 custom-scrollbar">
                            <div className="flex flex-col md:flex-row gap-8">
                                <div className="shrink-0 flex flex-col items-center">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 block w-full text-left">Brand Avatar</label>
                                    <div className="w-32 h-32 bg-slate-50 dark:bg-slate-800/50 rounded-[28px] border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden relative shadow-inner group/preview">
                                        {editForm.image ? (
                                            <>
                                                <img src={editForm.image} className="w-full h-full object-cover group-hover/preview:scale-110 transition-transform duration-500" alt="Preview" />
                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center">
                                                    <ImageIcon className="h-8 w-8 text-white" />
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-center">
                                                <ImageIcon className="h-10 w-10 text-slate-200 dark:text-slate-700 mx-auto" />
                                                <p className="text-[9px] font-bold text-slate-300 dark:text-slate-600 mt-2 uppercase">No Image</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1 space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-1">Display Name</label>
                                        <input
                                            type="text"
                                            value={editForm.name}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                            className="w-full h-[56px] px-5 bg-slate-50 dark:bg-slate-800/50 border border-transparent rounded-2xl text-base font-bold text-gray-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none transition-all shadow-inner placeholder:text-gray-300"
                                            placeholder="e.g. Fresh Garden Produce"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-1">Visual Asset URL</label>
                                        <input
                                            type="text"
                                            value={editForm.image}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, image: e.target.value }))}
                                            className="w-full h-[56px] px-5 bg-slate-50 dark:bg-slate-800/50 border border-transparent rounded-2xl text-sm font-semibold text-gray-600 dark:text-gray-400 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none transition-all shadow-inner placeholder:text-gray-300"
                                            placeholder="https://images.unsplash.com/..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-1">Contextual Description</label>
                                <textarea
                                    value={editForm.description}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                    className="w-full h-[120px] px-5 py-4 bg-slate-50 dark:bg-slate-800/50 border border-transparent rounded-2xl text-sm font-medium text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none resize-none transition-all shadow-inner placeholder:text-gray-300 leading-relaxed"
                                    placeholder="Briefly explain what this category represents..."
                                />
                            </div>

                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-1">Visibility Status</label>
                                <label className="flex items-center gap-4 p-5 bg-slate-50 dark:bg-slate-800/50 border border-transparent rounded-[24px] cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-all select-none shadow-inner group/check">
                                    <div className={`h-6 w-6 rounded-lg border-2 flex items-center justify-center transition-all ${editForm.onlineSale !== false ? 'bg-slate-900 border-slate-900 dark:bg-white dark:border-white' : 'border-slate-200 dark:border-slate-700'}`}>
                                        <Check className={`h-4 w-4 transition-opacity ${editForm.onlineSale !== false ? 'opacity-100 text-white dark:text-slate-900' : 'opacity-0'}`} />
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={editForm.onlineSale !== false}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, onlineSale: e.target.checked }))}
                                        className="hidden"
                                    />
                                    <div className="flex-1">
                                        <span className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight block">Active in Web Store</span>
                                        <p className="text-[11px] font-bold text-gray-400 dark:text-slate-500 mt-0.5">Determine if this category should be live for customers.</p>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div className="p-8 border-t border-gray-50 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                            <button
                                onClick={handleSave}
                                disabled={!editForm.name.trim()}
                                className="w-full py-5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-[20px] text-sm font-black uppercase tracking-[0.2em] transition-all shadow-xl hover:shadow-2xl active:scale-[0.98] disabled:opacity-30 disabled:grayscale"
                            >
                                Launch Category
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

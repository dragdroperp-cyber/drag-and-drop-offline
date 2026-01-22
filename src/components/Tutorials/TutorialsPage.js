import React, { useState } from 'react';
import {
    Play,
    Search,
    Package,
    Users,
    CreditCard,
    BarChart3,
    FileText,
    Truck,
    ArrowLeft,
    ChevronRight,
    ExternalLink,
    BookOpen,
    HelpCircle,
    Zap
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';

const TUTORIALS = [
    {
        id: 'products',
        title: 'How to Manage Products',
        description: 'Learn how to add, edit, and keep track of your inventory effectively.',
        icon: Package,
        color: 'bg-blue-500',
        videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', // Placeholder
        category: 'Inventory',
        duration: '5:20'
    },
    {
        id: 'billing',
        title: 'Managing Billing & Sales',
        description: 'Master the point of sale system and process transactions quickly.',
        icon: CreditCard,
        color: 'bg-emerald-500',
        videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', // Placeholder
        category: 'Sales',
        duration: '4:15'
    },
    {
        id: 'customers',
        title: 'Customer Management',
        description: 'Learn to manage customer profiles, debts, and purchase history.',
        icon: Users,
        color: 'bg-indigo-500',
        videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', // Placeholder
        category: 'CRM',
        duration: '3:45'
    },
    {
        id: 'reports',
        title: 'Understanding Reports',
        description: 'Analyze your business performance with detailed sales and profit reports.',
        icon: BarChart3,
        color: 'bg-amber-500',
        videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', // Placeholder
        category: 'Analytics',
        duration: '6:10'
    },
    {
        id: 'gst',
        title: 'GST & Tax Filings',
        description: 'Everything you need to know about generating GST compliant reports.',
        icon: FileText,
        color: 'bg-rose-500',
        videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', // Placeholder
        category: 'Compliance',
        duration: '4:50'
    },
    {
        id: 'purchase',
        title: 'Purchase Order System',
        description: 'Manage your supplier orders and track incoming stock.',
        icon: Truck,
        color: 'bg-cyan-500',
        videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', // Placeholder
        category: 'Supply Chain',
        duration: '3:30'
    }
];

const TutorialsPage = () => {
    const { state, dispatch } = useApp();
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState('');

    const filteredTutorials = TUTORIALS.filter(t =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleBack = () => {
        dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: 'dashboard' });
        navigate('/dashboard');
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-12">
            {/* Header section */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={handleBack}
                                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                                title="Back to Dashboard"
                            >
                                <ArrowLeft className="h-6 w-6 text-slate-600 dark:text-slate-400" />
                            </button>
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    <Play className="h-6 w-6 text-indigo-600 fill-current" />
                                    Video Tutorials
                                </h1>
                                <p className="text-sm text-slate-500 dark:text-slate-400">Master every feature of Grocery Studio</p>
                            </div>
                        </div>

                        <div className="relative w-full md:w-80">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search tutorials..."
                                className="w-full pl-10 pr-4 py-2.5 bg-slate-100 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 dark:text-white transition-all shadow-inner"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 mt-4 sm:mt-8">
                {/* Featured Section */}
                {!searchQuery && (
                    <div className="mb-8 sm:mb-12 relative overflow-hidden rounded-none sm:rounded-3xl bg-indigo-600 p-6 sm:p-12 text-white">
                        <div className="relative z-10 max-w-2xl">
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 rounded-full text-xs font-bold uppercase tracking-wider mb-4 border border-white/30 backdrop-blur-sm">
                                <Zap className="h-3 w-3 fill-current" />
                                Featured Guide
                            </div>
                            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Master Your Entire Business in 10 Minutes</h2>
                            <p className="text-indigo-100 text-lg mb-8 leading-relaxed">
                                Take a complete tour of Grocery Studio and learn the easiest workflow to grow your sales and manage inventory like a pro.
                            </p>
                            <button
                                onClick={() => window.open('https://www.youtube.com/@DragDroper', '_blank')}
                                className="inline-flex items-center justify-center gap-2 bg-white text-indigo-600 px-8 py-3 rounded-xl font-bold hover:bg-indigo-50 transition-all shadow-xl shadow-indigo-900/20"
                            >
                                <Play className="h-5 w-5 fill-current" />
                                Watch Full Tour
                            </button>
                        </div>
                        {/* Background elements */}
                        <div className="absolute top-0 right-0 -mr-20 -mt-20 h-96 w-96 rounded-full bg-indigo-500/30 blur-3xl"></div>
                        <div className="absolute bottom-0 right-0 mr-20 mb-10 h-64 w-64 rounded-full bg-blue-500/20 blur-2xl"></div>
                    </div>
                )}

                {/* Tutorial Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 sm:gap-8 bg-white dark:bg-slate-900 sm:bg-transparent sm:dark:bg-transparent">
                    {filteredTutorials.map((tutorial, idx) => (
                        <div
                            key={tutorial.id}
                            className="group bg-white dark:bg-slate-900 rounded-none sm:rounded-3xl overflow-hidden border-b sm:border border-slate-100 dark:border-slate-800 sm:hover:border-indigo-300 sm:dark:hover:border-indigo-500/30 transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/10 flex flex-col h-full"
                            style={{ animationDelay: `${idx * 0.1}s` }}
                        >
                            {/* Thumbnail Placeholder */}
                            <div className="relative aspect-video bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                <div className={`absolute inset-0 opacity-10 ${tutorial.color}`}></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className={`p-4 rounded-2xl ${tutorial.color} text-white shadow-lg shadow-black/10 transition-transform duration-300 group-hover:scale-110`}>
                                        <tutorial.icon className="h-8 w-8" />
                                    </div>
                                </div>
                                <div className="absolute bottom-3 right-3 px-2 py-1 bg-black/70 backdrop-blur-md rounded text-[10px] font-bold text-white uppercase tracking-wider">
                                    {tutorial.duration}
                                </div>
                            </div>

                            {/* Content */}
                            <div className="p-6 flex flex-col flex-1">
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                                        {tutorial.category}
                                    </span>
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                    {tutorial.title}
                                </h3>
                                <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 flex-1 line-clamp-2">
                                    {tutorial.description}
                                </p>
                                <button
                                    onClick={() => window.open('https://www.youtube.com/@DragDroper', '_blank')}
                                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-2xl font-bold hover:bg-slate-900 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition-all transform group-active:scale-95 border border-slate-200 dark:border-slate-700 group-hover:border-transparent"
                                >
                                    <Play className="h-4 w-4 fill-current" />
                                    Watch Video
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {filteredTutorials.length === 0 && (
                    <div className="text-center py-20">
                        <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 mb-6">
                            <Search className="h-10 w-10" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">No tutorials found</h3>
                        <p className="text-slate-500 dark:text-slate-400">Try searching for different keywords or browse all guides below.</p>
                        <button
                            onClick={() => setSearchQuery('')}
                            className="mt-6 text-indigo-600 font-bold hover:underline"
                        >
                            Clear Search
                        </button>
                    </div>
                )}

                {/* Support Section */}
                <div className="mt-12 sm:mt-20 p-8 sm:p-12 rounded-none sm:rounded-3xl bg-slate-900 text-white relative overflow-hidden">
                    <div className="relative z-10 flex flex-col md:flex-row items-center gap-8 justify-between">
                        <div className="text-center md:text-left">
                            <h2 className="text-2xl sm:text-3xl font-bold mb-4">Still need help?</h2>
                            <p className="text-slate-400 text-lg max-w-xl">
                                Our support team is available 24/7 to help you with any questions or technical difficulties.
                            </p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                            <button
                                onClick={() => window.open('https://wa.me/917898488935', '_blank')}
                                className="px-8 py-3 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all flex items-center justify-center gap-2"
                            >
                                Contact Support
                            </button>
                        </div>
                    </div>
                    <div className="absolute top-0 left-0 -ml-16 -mt-16 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl"></div>
                    <div className="absolute bottom-0 right-0 -mr-16 -mb-16 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl"></div>
                </div>
            </div>

            {/* Video Modal removed - redirecting to YouTube */}

            {/* Styles for animation */}
            <style dangerouslySetInnerHTML={{
                __html: `
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-float-up {
          animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}} />
        </div>
    );
};

export default TutorialsPage;

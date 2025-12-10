import React from 'react';
// Generic skeleton loader components
export const SkeletonCard = ({ className = "" }) => (
  <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`}></div>
);
export const SkeletonText = ({ lines = 1, className = "" }) => (
  <div className={`space-y-2 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <SkeletonCard
        key={i}
        className={`h-4 ${i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full'}`}
      />
    ))}
  </div>
);
export const SkeletonTable = ({ rows = 5, columns = 4 }) => (
  <div className="animate-pulse">
    {/* Table Header */}
    <div className="flex space-x-4 mb-4">
      {Array.from({ length: columns }).map((_, i) => (
        <SkeletonCard key={i} className="h-8 flex-1" />
      ))}
    </div>
    {/* Table Rows */}
    {Array.from({ length: rows }).map((_, rowIndex) => (
      <div key={rowIndex} className="flex space-x-4 mb-3">
        {Array.from({ length: columns }).map((_, colIndex) => (
          <SkeletonCard
            key={colIndex}
            className={`h-12 flex-1 ${colIndex === 0 ? 'w-1/4' : 'w-full'}`}
          />
        ))}
      </div>
    ))}
  </div>
);
export const SkeletonStats = ({ count = 4 }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="bg-white p-6 rounded-lg shadow-sm border">
        <div className="animate-pulse">
          <SkeletonCard className="h-4 w-20 mb-2" />
          <SkeletonCard className="h-8 w-16 mb-4" />
          <SkeletonCard className="h-3 w-24" />
        </div>
      </div>
    ))}
  </div>
);
export const SkeletonForm = ({ fields = 6 }) => (
  <div className="space-y-6 animate-pulse">
    {Array.from({ length: fields }).map((_, i) => (
      <div key={i} className="space-y-2">
        <SkeletonCard className="h-4 w-24" />
        <SkeletonCard className="h-10 w-full" />
      </div>
    ))}
    <div className="flex space-x-4 pt-4">
      <SkeletonCard className="h-10 w-24" />
      <SkeletonCard className="h-10 w-20" />
    </div>
  </div>
);
// Full page skeleton for app navigation loading (without sidebar)
export const PageNavigationSkeleton = () => (
  <div className="min-h-screen bg-gray-50">
    {/* Header Skeleton */}
    <div className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <SkeletonCard className="h-8 w-8" />
          <SkeletonCard className="h-6 w-32" />
        </div>
        <div className="flex items-center space-x-4">
          <SkeletonCard className="h-8 w-8 rounded-full" />
          <SkeletonCard className="h-6 w-24" />
          <SkeletonCard className="h-8 w-8 rounded-full" />
        </div>
      </div>
    </div>
    {/* Main Content Skeleton (Full Width - No Sidebar) */}
    <div className="p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <SkeletonCard className="h-8 w-48 mb-2" />
            <SkeletonCard className="h-4 w-64" />
          </div>
          <div className="flex space-x-3">
            <SkeletonCard className="h-10 w-24" />
            <SkeletonCard className="h-10 w-32" />
          </div>
        </div>
        {/* Stats Cards */}
        <SkeletonStats count={4} />
        {/* Content Area */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="space-y-4">
            {/* Table Header */}
            <div className="flex justify-between items-center">
              <SkeletonCard className="h-6 w-32" />
              <SkeletonCard className="h-8 w-24" />
            </div>
            {/* Table */}
            <SkeletonTable rows={8} columns={5} />
          </div>
        </div>
      </div>
    </div>
  </div>
);
export const PageSkeleton = ({ children, loading, skeleton }) => {
  if (loading) {
    return skeleton;
  }
  return children;
};
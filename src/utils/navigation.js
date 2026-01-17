const VIEW_TO_PATH = {
  dashboard: '/dashboard',
  customers: '/customers',
  suppliers: '/suppliers',
  products: '/products',
  dProducts: '/d-products',
  onlineStore: '/online-store',
  inventory: '/inventory',
  billing: '/billing',
  purchase: '/purchase',
  financial: '/financial',
  reports: '/reports',
  salesOrderHistory: '/sales-order-history',
  refunds: '/refunds',
  upgrade: '/upgrade',
  settings: '/settings',
  planHistory: '/plan-history',
  gst: '/gst',
  customization: '/customization',
  productPerformance: '/product-performance',
  'complete-profile': '/complete-profile',


};

const normalizePath = (path) => {
  if (!path) return '/';
  if (path === '/') return '/';
  return path.replace(/\/+$/, '');
};

const PATH_TO_VIEW = Object.entries(VIEW_TO_PATH).reduce((acc, [view, path]) => {
  acc[normalizePath(path)] = view;
  return acc;
}, { '/': 'dashboard' });

export const getPathForView = (view) => VIEW_TO_PATH[view] || VIEW_TO_PATH.dashboard;

export const getViewFromPath = (pathname) => {
  const normalized = normalizePath(pathname);
  return PATH_TO_VIEW[normalized] || 'dashboard';
};

export const getAllViewPaths = () => ({ ...VIEW_TO_PATH });

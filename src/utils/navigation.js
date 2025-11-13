const VIEW_TO_PATH = {
  dashboard: '/dashboard',
  customers: '/customers',
  products: '/products',
  inventory: '/inventory',
  billing: '/billing',
  purchase: '/purchase',
  financial: '/financial',
  reports: '/reports',
  upgrade: '/upgrade',
  settings: '/settings',
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



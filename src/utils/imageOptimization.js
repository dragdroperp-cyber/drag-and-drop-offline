import { useState, useEffect } from 'react';
// Image optimization utilities for slow 3G networks
// Convert image to WebP if supported, fallback to original format
export const getOptimizedImageSrc = (src, options = {}) => {
  if (!src) return src;
  const {
    webp = true,
    sizes = ['small', 'medium', 'large'],
    lazy = true
  } = options;
  // For now, return the original src since we don't have WebP versions
  // In production, you would have WebP versions alongside original formats
  return src;
};
// Image lazy loading hook
export const useLazyImage = (src, placeholder = '') => {
  const [imageSrc, setImageSrc] = useState(placeholder);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  useEffect(() => {
    if (!src) return;
    // Check if browser supports Intersection Observer for lazy loading
    if ('IntersectionObserver' in window) {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        setImageSrc(src);
        setIsLoaded(true);
      };
      img.onerror = () => {
        setHasError(true);
      };
    } else {
      // Fallback for browsers without Intersection Observer
      setImageSrc(src);
      setIsLoaded(true);
    }
  }, [src]);
  return { imageSrc, isLoaded, hasError };
};
// Responsive image component with WebP support
export const OptimizedImage = ({
  src,
  alt,
  className = '',
  webpSrc = null,
  sizes = null,
  loading = 'lazy',
  ...props
}) => {
  // Check if WebP is supported
  const supportsWebP = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  };
  const useWebP = webpSrc && supportsWebP();
  return (
    <img
      src={useWebP ? webpSrc : src}
      alt={alt}
      className={className}
      loading={loading}
      sizes={sizes}
      {...props}
    />
  );
};
// Image preloader for critical images
export const preloadImage = (src) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = reject;
    img.src = src;
  });
};
// Preload critical images on app start
export const preloadCriticalImages = () => {
  const criticalImages = [
    `${process.env.PUBLIC_URL || ''}/assets/inventory-studio-logo.png`,
    // Add other critical images here
  ];
  // Only preload on fast connections
  const isSlow = navigator.connection &&
    (navigator.connection.effectiveType === 'slow-2g' ||
      navigator.connection.effectiveType === '2g');
  if (!isSlow) {
    criticalImages.forEach(src => {
      preloadImage(src).catch(() => {
        // Silently fail for preloads
      });
    });
  }
};

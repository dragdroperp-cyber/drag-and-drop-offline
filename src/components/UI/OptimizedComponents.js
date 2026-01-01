import React, { useCallback } from 'react';

/**
 * Optimized Button Component
 * Prevents re-renders when props haven't changed
 */
export const OptimizedButton = React.memo(({
    onClick,
    children,
    className = '',
    disabled = false,
    type = 'button',
    ...props
}) => {
    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={className}
            {...props}
        >
            {children}
        </button>
    );
});

OptimizedButton.displayName = 'OptimizedButton';

/**
 * Optimized List Item Component
 * Use this for rendering list items to prevent unnecessary re-renders
 */
export const OptimizedListItem = React.memo(({
    item,
    onSelect,
    renderContent,
    className = ''
}) => {
    const handleClick = useCallback(() => {
        if (onSelect) {
            onSelect(item);
        }
    }, [item, onSelect]);

    return (
        <div onClick={handleClick} className={className}>
            {renderContent ? renderContent(item) : JSON.stringify(item)}
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison function
    // Only re-render if item or onSelect changed
    return (
        prevProps.item === nextProps.item &&
        prevProps.onSelect === nextProps.onSelect &&
        prevProps.className === nextProps.className
    );
});

OptimizedListItem.displayName = 'OptimizedListItem';

/**
 * Optimized Input Component
 * Prevents re-renders when parent re-renders
 */
export const OptimizedInput = React.memo(({
    value,
    onChange,
    placeholder = '',
    type = 'text',
    className = '',
    ...props
}) => {
    return (
        <input
            type={type}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            className={className}
            {...props}
        />
    );
});

OptimizedInput.displayName = 'OptimizedInput';

/**
 * Optimized Modal Component
 * Only re-renders when isOpen or children change
 */
export const OptimizedModal = React.memo(({
    isOpen,
    onClose,
    children,
    className = ''
}) => {
    const handleBackdropClick = useCallback((e) => {
        if (e.target === e.currentTarget && onClose) {
            onClose();
        }
    }, [onClose]);

    if (!isOpen) return null;

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 ${className}`}
            onClick={handleBackdropClick}
        >
            <div className="relative bg-white dark:bg-slate-800 rounded-lg shadow-xl">
                {children}
            </div>
        </div>
    );
});

OptimizedModal.displayName = 'OptimizedModal';

/**
 * Optimized Card Component
 * Prevents re-renders when props haven't changed
 */
export const OptimizedCard = React.memo(({
    children,
    className = '',
    onClick,
    ...props
}) => {
    return (
        <div
            className={`bg-white dark:bg-slate-800 rounded-lg shadow-md p-4 ${className}`}
            onClick={onClick}
            {...props}
        >
            {children}
        </div>
    );
});

OptimizedCard.displayName = 'OptimizedCard';

/**
 * Optimized Image Component
 * Handles loading states and errors efficiently
 */
export const OptimizedImage = React.memo(({
    src,
    alt = '',
    fallbackSrc,
    className = '',
    ...props
}) => {
    const [imgSrc, setImgSrc] = React.useState(src);
    const [isLoading, setIsLoading] = React.useState(true);

    const handleError = useCallback(() => {
        if (fallbackSrc && imgSrc !== fallbackSrc) {
            setImgSrc(fallbackSrc);
        }
        setIsLoading(false);
    }, [fallbackSrc, imgSrc]);

    const handleLoad = useCallback(() => {
        setIsLoading(false);
    }, []);

    React.useEffect(() => {
        setImgSrc(src);
        setIsLoading(true);
    }, [src]);

    return (
        <>
            {isLoading && (
                <div className={`animate-pulse bg-gray-200 dark:bg-slate-700 ${className}`} />
            )}
            <img
                src={imgSrc}
                alt={alt}
                onError={handleError}
                onLoad={handleLoad}
                className={`${className} ${isLoading ? 'hidden' : ''}`}
                {...props}
            />
        </>
    );
});

OptimizedImage.displayName = 'OptimizedImage';

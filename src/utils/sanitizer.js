import DOMPurify from 'dompurify';

/**
 * Sanitize HTML content to prevent XSS
 * @param {string} html - Unsafe HTML string
 * @returns {string} - Safe HTML string
 */
export const sanitizeHTML = (html) => {
    if (!html) return '';
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'span', 'ul', 'ol', 'li'],
        ALLOWED_ATTR: ['href', 'target', 'class', 'style'],
        ADD_ATTR: ['target'],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'button'],
        FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover']
    });
};

/**
 * Sanitize and return as object for dangerouslySetInnerHTML
 */
export const createSafeHTML = (html) => {
    return { __html: sanitizeHTML(html) };
};

export default sanitizeHTML;

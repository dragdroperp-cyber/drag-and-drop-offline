import { jsPDF } from 'jspdf';

/**
 * Adds a watermark to all pages of the provided jsPDF document.
 * @param {jsPDF} doc - The jsPDF document instance.
 * @param {string} [watermarkUrl] - Optional URL for the watermark image. Defaults to the logo.
 */
export const addWatermarkToPDF = async (doc, watermarkUrl = '/assets/inventory-studio-logo-removebg.png') => {
    try {
        const imgData = await fetchImage(watermarkUrl);
        const totalPages = doc.getNumberOfPages();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        // Add watermark to each page
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);

            // Save current graphics state
            doc.saveGraphicsState();

            // Set transparency
            // We use GState object. In newer jsPDF versions, it's available via the API or imported.
            // We act defensively here.
            try {
                const gState = new doc.GState({ opacity: 0.1 });
                doc.setGState(gState);
            } catch (e) {
                // Fallback for older versions or if doc.GState is not found
                // Try accessing via the global/import if needed, but doc.GState is standard in recent versions.
                console.warn("GState not supported or found on doc instance", e);
            }

            // Calculate dimensions to center the image
            // Make it 50% of the page width
            const imgWidth = pageWidth * 0.5;
            const imgHeight = imgWidth; // Assuming square aspect ratio or we can calculate if we had dimensions
            const x = (pageWidth - imgWidth) / 2;
            const y = (pageHeight - imgHeight) / 2;

            doc.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight, undefined, 'FAST');

            // Restore graphics state
            doc.restoreGraphicsState();
        }
    } catch (error) {
        console.error('Error adding watermark to PDF:', error);
        // Do not throw, so the report can still be generated without watermark
    }
};

const fetchImage = (url) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = (e) => reject(new Error(`Failed to load image at ${url}`));
        img.src = url;
    });
};

const downloadFile = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

/* ================= MODERN PDF EXPORT (THEMED) ================= */
const exportSuppliersPDF = async () => {
    try {
        const doc = new jsPDF('p', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;
        const contentWidth = pageWidth - margin * 2;

        /* ================= CONFIG ================= */
        const COLORS = {
            primary: [47, 60, 126], // #2F3C7E
            secondary: [236, 72, 153], // #EC4899 (Pink)
            success: [16, 185, 129], // #10B981
            gray: [100, 116, 139],
            lightBg: [248, 250, 252],
            border: [226, 232, 240],
            black: [15, 23, 42], // #0F172A
            white: [255, 255, 255]
        };

        const formatPDFCurrency = (val) => {
            const amount = Number(val || 0);
            const isWhole = amount % 1 === 0;
            return `Rs. ${amount.toLocaleString('en-IN', {
                minimumFractionDigits: isWhole ? 0 : 2,
                maximumFractionDigits: 2
            })}`;
        };

        // Add Watermark
        const addWatermark = (pdfDoc) => {
            const totalPages = pdfDoc.internal.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                pdfDoc.setPage(i);
                pdfDoc.saveGraphicsState();
                pdfDoc.setGState(new pdfDoc.GState({ opacity: 0.03 }));
                pdfDoc.setFontSize(60);
                pdfDoc.setFont('helvetica', 'bold');
                pdfDoc.setTextColor(...COLORS.primary);
                pdfDoc.text('SUPPLIER REPORT', pageWidth / 2, pageHeight / 2, {
                    align: 'center',
                    angle: 45
                });
                pdfDoc.restoreGraphicsState();
            }
        };

        /* -------- HELPERS -------- */
        const safeDrawText = (pdf, text, x, y, options = {}) => {
            const isHindi = /[\u0900-\u097F\u20B9]/.test(text);
            if (isHindi) {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const fontSize = options.fontSize || 10;
                    ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
                    const metrics = ctx.measureText(text);
                    canvas.width = metrics.width * 2;
                    canvas.height = fontSize * 2.5;
                    ctx.scale(2, 2);
                    ctx.fillStyle = options.color || '#000000';
                    ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
                    ctx.fillText(text, 0, fontSize);
                    const dataUrl = canvas.toDataURL('image/png');
                    const w = metrics.width / 3.78;
                    const h = fontSize * 1.5 / 3.78;
                    let drawX = x;
                    if (options.align === 'right') drawX -= w;
                    else if (options.align === 'center') drawX -= w / 2;
                    pdf.addImage(dataUrl, 'PNG', drawX, y - (fontSize / 2.5), w, h);
                } catch (e) {
                    pdf.text(text, x, y, options); // Fallback
                }
            } else {
                pdf.text(text, x, y, options);
            }
        };

        /* ================= HEADER ================= */
        const headerHeight = 28;
        doc.setFillColor(...COLORS.white);
        doc.rect(0, 0, pageWidth, headerHeight, 'F');
        doc.setDrawColor(...COLORS.primary);
        doc.setLineWidth(1.5);
        doc.line(0, headerHeight - 1, pageWidth, headerHeight - 1);

        /* -------- LOGO & APP NAME -------- */
        const logoX = margin;
        const logoY = 10;
        const logoSize = 16;

        try {
            const publicUrl = process.env.PUBLIC_URL || '';
            const logoUrl = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
            const res = await fetch(logoUrl);
            if (res.ok) {
                const blob = await res.blob();
                const base64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
                doc.addImage(base64, 'PNG', logoX, logoY, logoSize, logoSize);
            }
        } catch (e) { }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.setTextColor(...COLORS.primary);
        doc.text('Grocery studio', logoX + logoSize + 4, logoY + 7);

        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COLORS.gray);
        doc.text('Advanced Billing & Inventory Solution', logoX + logoSize + 4, logoY + 11);

        /* -------- RIGHT META -------- */
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.black);
        safeDrawText(doc, 'Supplier Report', pageWidth - margin, logoY + 5, { align: 'right', color: '#000000', fontSize: 14 });

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COLORS.gray);
        safeDrawText(doc, `Type: Full List`, pageWidth - margin, logoY + 11, { align: 'right', color: '#787878', fontSize: 9 });

        const today = new Date();
        safeDrawText(doc, `Date: ${formatDate(today)}`, pageWidth - margin, logoY + 16, { align: 'right', color: '#787878', fontSize: 9 });

        /* -------- CENTER SHOP INFO -------- */
        let currentY = headerHeight + 10;

        // Shop Name (Big & Bold)
        if (state.storeName) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(22);
            doc.setTextColor(...COLORS.black);
            doc.text(state.storeName, pageWidth / 2, currentY, { align: 'center' });
            currentY += 7;
        }

        // Address & other info (Smaller, Centered)
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...COLORS.gray);

        const details = [];
        if (state.storeAddress) details.push(state.storeAddress);
        if (state.storePhone) details.push(`Contact: ${state.storePhone}`);
        if (state.storeGstin) details.push(`GSTIN: ${state.storeGstin}`);

        if (details.length > 0) {
            doc.text(details.join(' | '), pageWidth / 2, currentY, { align: 'center' });
            currentY += 8;
        } else {
            currentY += 5;
        }

        /* ================= SUMMARY CARDS ================= */
        let y = currentY + 2;
        const cardW = (contentWidth - 6) / 3;
        const cardH = 22;

        const total = state.suppliers.length;
        const dueCount = state.suppliers.filter(c => (c.balanceDue || 0) > 0).length;
        const dueSum = state.suppliers.reduce((sum, c) => sum + (c.balanceDue || 0), 0);

        const metrics = [
            { label: 'Total Suppliers', value: total.toString(), color: COLORS.primary },
            { label: 'With Balance Due', value: dueCount.toString(), color: COLORS.secondary },
            { label: 'Total Outstanding', value: formatPDFCurrency(dueSum), color: COLORS.gray }
        ];

        metrics.forEach((m, i) => {
            const x = margin + i * (cardW + 3);
            doc.setFillColor(255, 255, 255);
            doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'F');
            doc.setDrawColor(...COLORS.border);
            doc.setLineWidth(0.1);
            doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'S');

            doc.setFontSize(7.5);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...COLORS.gray);
            safeDrawText(doc, m.label, x + 4, y + 8, { color: '#787878', fontSize: 7.5 });

            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(i === 2 && dueSum > 0 ? 220 : COLORS.primary[0], i === 2 && dueSum > 0 ? 38 : COLORS.primary[1], i === 2 && dueSum > 0 ? 38 : COLORS.primary[2]); // Red for due if > 0
            safeDrawText(doc, m.value, x + 4, y + 16, { color: i === 2 && dueSum > 0 ? '#DC2626' : '#2F3C7E', fontSize: 16 });
        });

        y += cardH + 15;

        /* ================= TABLE ================= */
        doc.setFontSize(10.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.black);
        safeDrawText(doc, 'Supplier List', margin, y, { color: '#000000', fontSize: 10.5 });
        y += 6.5;

        const headers = [
            'S.No.',
            'Supplier Name',
            'Mobile',
            'Email',
            { text: 'Balance Due', align: 'right' }
        ];

        // Portrait Weights (Total ~180mm)
        const colWeights = [
            { w: 15, align: 'center' }, // S.No.
            { w: 55, align: 'center' }, // Name
            { w: 35, align: 'center' }, // Mobile
            { w: 45, align: 'center' }, // Email
            { w: 30, align: 'right' } // Balance
        ];

        const tableWidth = colWeights.reduce((a, b) => a + b.w, 0);

        // Header row
        doc.setFillColor(245, 247, 255);
        doc.rect(margin, y, tableWidth, 10, 'F');

        // Header Outline
        doc.setDrawColor(...COLORS.border);
        doc.setLineWidth(0.1);
        doc.rect(margin, y, tableWidth, 10, 'S');

        // Header Vertical Lines
        let vHeaderX = margin;
        colWeights.forEach((col, i) => {
            if (i < colWeights.length - 1) {
                vHeaderX += col.w;
                doc.line(vHeaderX, y, vHeaderX, y + 10);
            }
        });

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.primary);

        let hX = margin;
        headers.forEach((h, i) => {
            const headerText = typeof h === 'object' ? h.text : h;
            const align = (typeof h === 'object' ? h.align : colWeights[i].align) || 'left';
            let drawX = hX + 2;
            if (align === 'center') drawX = hX + (colWeights[i].w / 2);
            if (align === 'right') drawX = hX + colWeights[i].w - 2;

            safeDrawText(doc, headerText, drawX, y + 6.5, { align, color: '#2F3C7E', fontSize: 9 });
            hX += colWeights[i].w;
        });

        y += 10;

        doc.setFontSize(9);
        doc.setTextColor(...COLORS.black);

        state.suppliers.forEach((supplier, index) => {
            const rowH = 10;
            if (y + rowH > pageHeight - 20) {
                doc.addPage();
                y = 20;

                // Redraw Header
                doc.setFillColor(245, 247, 255);
                doc.rect(margin, y, tableWidth, 10, 'F');

                // Header Outline
                doc.setDrawColor(...COLORS.border);
                doc.setLineWidth(0.1);
                doc.rect(margin, y, tableWidth, 10, 'S');

                // Header Vertical Lines
                let vHeaderRepeatX = margin;
                colWeights.forEach((col, i) => {
                    if (i < colWeights.length - 1) {
                        vHeaderRepeatX += col.w;
                        doc.line(vHeaderRepeatX, y, vHeaderRepeatX, y + 10);
                    }
                });

                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...COLORS.primary);

                let rHX = margin;
                headers.forEach((h, i) => {
                    const headerText = typeof h === 'object' ? h.text : h;
                    // Enforce center alignment
                    let drawX = rHX + (colWeights[i].w / 2);
                    safeDrawText(doc, headerText, drawX, y + 6.5, { align: 'center', color: '#2F3C7E', fontSize: 9 });
                    rHX += colWeights[i].w;
                });
                y += 10;
            }

            if (index % 2 === 1) {
                doc.setFillColor(252, 253, 255);
                doc.rect(margin, y, tableWidth, rowH, 'F');
            }

            // Row Outline
            doc.setDrawColor(...COLORS.border);
            doc.setLineWidth(0.1);
            doc.rect(margin, y, tableWidth, rowH, 'S');

            // Row Vertical Lines
            let vRowX = margin;
            colWeights.forEach((col, i) => {
                if (i < colWeights.length - 1) {
                    vRowX += col.w;
                    doc.line(vRowX, y, vRowX, y + rowH);
                }
            });

            doc.setTextColor(...COLORS.black);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);

            let rowX = margin;

            // S.No. (Centered)
            safeDrawText(doc, (index + 1).toString(), rowX + (colWeights[0].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
            rowX += colWeights[0].w;

            // Name (Centered)
            safeDrawText(doc, supplier.name.substring(0, 30), rowX + (colWeights[1].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
            rowX += colWeights[1].w;

            // Mobile (Centered)
            safeDrawText(doc, supplier.mobileNumber || supplier.phone || '-', rowX + (colWeights[2].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
            rowX += colWeights[2].w;

            // Email (Centered)
            safeDrawText(doc, supplier.email || '-', rowX + (colWeights[3].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
            rowX += colWeights[3].w;

            // Balance (Centered)
            const balance = supplier.balanceDue || 0;
            if (balance > 0) doc.setTextColor(220, 38, 38); // Red for debt
            else if (balance < 0) doc.setTextColor(16, 185, 129); // Green for credit
            else doc.setTextColor(...COLORS.black);

            doc.setFont('helvetica', 'bold');
            safeDrawText(doc, formatPDFCurrency(balance), rowX + (colWeights[4].w / 2), y + 6.5, { align: 'center', fontSize: 9 });
            doc.setFont('helvetica', 'normal');

            y += rowH;
        });

        /* ================= FOOTER ================= */
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(...COLORS.gray);
            doc.text(`Page ${i} of ${totalPages}`, margin, pageHeight - 10);
            doc.text(`${state.storeName || 'Store'} - Supplier Report`, pageWidth - margin, pageHeight - 10, { align: 'right' });
        }

        addWatermark(doc);

        doc.save(`suppliers-report-${formatDate(new Date()).replace(/\//g, '-')}.pdf`);
        if (window.showToast) {
            window.showToast('Export successful!', 'success');
        }
        setShowExportMenu(false);
    } catch (error) {
        console.error('PDF Export Error: ', error);
        if (window.showToast) {
            window.showToast('Export failed', 'error');
        }
    }
};

const exportSuppliersJSON = () => {
    try {
        const data = state.suppliers.map((supplier) => ({
            id: Math.random().toString(36).substr(2, 9),
            name: supplier.name,
            mobileNumber: supplier.mobileNumber || supplier.phone || '',
            email: supplier.email || '',
            address: supplier.address || '',
            balanceDue: Number(supplier.balanceDue ?? supplier.dueAmount ?? 0) || 0,
            createdAt: supplier.createdAt,
            updatedAt: supplier.updatedAt
        }));

        downloadFile(
            `suppliers-${new Date().toISOString().split('T')[0]}.json`,
            JSON.stringify(data, null, 2),
            'application/json'
        );

        if (window.showToast) {
            window.showToast('Export successful!', 'success');
        }
    } catch (error) {
        if (window.showToast) {
            window.showToast('Export failed', 'error');
        }
    }
};

const exportSuppliersCSV = () => {
    try {
        const headers = [
            'Supplier Name',
            'Mobile',
            'Email',
            'Address',
            'Balance Due'
        ];
        const escapeValue = (value) => {
            if (value === null || value === undefined) return '';
            const stringValue = String(value);
            if (stringValue.includes('"')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }
            if (stringValue.includes(',') || stringValue.includes('\n')) {
                return `"${stringValue}"`;
            }
            return stringValue;
        };

        const rows = state.suppliers.map((supplier) => [
            escapeValue(supplier.name || ''),
            escapeValue(supplier.mobileNumber || supplier.phone || ''),
            escapeValue(supplier.email || ''),
            escapeValue(supplier.address || ''),
            escapeValue((Number(supplier.balanceDue ?? supplier.dueAmount ?? 0) || 0).toFixed(2))
        ]);

        const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

        downloadFile(
            `suppliers-${new Date().toISOString().split('T')[0]}.csv`,
            csvContent,
            'text/csv;charset=utf-8;'
        );

        if (window.showToast) {
            window.showToast('Export successful!', 'success');
        }
    } catch (error) {
        if (window.showToast) {
            window.showToast('Export failed', 'error');
        }
    }
};

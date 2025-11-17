// Working HTML5-QRCode Scanner Implementation
class WorkingBarcodeScanner {
    constructor() {
        this.html5QrCode = null;
        this.isScanning = false;
    }

    async initializeScanner(containerId, onSuccess, onError) {
        try {
            // Check if camera is available
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Camera not supported');
            }

            // Request camera permission explicitly
            await navigator.mediaDevices.getUserMedia({ video: true });
            console.log("Camera access granted.");

            const container = document.getElementById(containerId);
            if (!container) {
                throw new Error('Scanner container not found');
            }

            // Clear container
            container.innerHTML = '';

            // Initialize HTML5-QRCode
            this.html5QrCode = new Html5Qrcode(containerId);
            
            // Start scanning
            await this.html5QrCode.start(
                { facingMode: "environment" },  // Use rear camera for better scanning
                { fps: 10, qrbox: 250 },
                (decodedText, decodedResult) => {
                    console.log('Barcode scanned:', decodedText);
                    if (onSuccess) onSuccess(decodedText);
                    this.stop();
                },
                (error) => {
                    // Ignore scanning errors, they're normal
                    console.log('Scanning...');
                }
            );

            this.isScanning = true;
            return true;

        } catch (error) {
            console.error('Scanner initialization failed:', error);
            if (onError) onError(error);
            return false;
        }
    }

    stop() {
        if (this.isScanning && this.html5QrCode) {
            this.html5QrCode.stop().then(() => {
                console.log("QR Code scanning stopped.");
                this.isScanning = false;
            }).catch((err) => {
                console.error("Error stopping scanner:", err);
            });
        }
    }

    destroy() {
        this.stop();
        this.html5QrCode = null;
    }
}

// Global scanner instance
window.workingBarcodeScanner = new WorkingBarcodeScanner();

// Legacy compatibility functions
async function requestCameraPermission() {
    try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        console.log("Camera access granted.");
        return true;
    } catch (error) {
        alert("Camera access denied. Please enable it in browser settings.");
        return false;
    }
}

function startQRScanner() {
    // This function is kept for compatibility but the new scanner should be used
    console.log("Legacy QR scanner called - please use the new WorkingBarcodeScanner class");
}
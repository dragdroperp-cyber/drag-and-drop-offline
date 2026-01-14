import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, RefreshCw, Zap, ZapOff, Camera } from 'lucide-react';
import { getAudioContext } from '../../utils/audioUtils';

const BarcodeScanner = React.forwardRef(({ onScan, onClose, inline = false, keepOpen = false, containerWidth, containerHeight, enableTorch = true, hideControls = false, className = '', children }, ref) => {
  const scannerRef = useRef(null);
  const qrReaderRef = useRef(null);
  const containerIdRef = useRef(`qr-reader-${Math.random().toString(36).slice(2, 10)}`);
  const [error, setError] = useState('');
  const [cameras, setCameras] = useState([]);
  const [activeCameraIndex, setActiveCameraIndex] = useState(0);
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const [isTorchSupported, setIsTorchSupported] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const isRunningRef = useRef(false);
  const scanProcessedRef = useRef(false);
  const lastContainerSizeRef = useRef({ width: 0, height: 0 });

  React.useImperativeHandle(ref, () => ({
    switchCamera: handleSwitchCamera,
    toggleTorch: toggleTorch,
    stop: stopScanner,
    start: () => startScanner(cameras[activeCameraIndex]?.id)
  }));

  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
  }, [onScan, onClose]);

  // Restart camera when container size changes significantly
  useEffect(() => {
    if (!inline || !containerWidth || !containerHeight) return;

    const sizeChanged = Math.abs(containerWidth - lastContainerSizeRef.current.width) > 50 ||
      Math.abs(containerHeight - lastContainerSizeRef.current.height) > 50;

    if (sizeChanged && isRunningRef.current) {

      // Stop current camera
      stopScanner().then(() => {
        // Start with new size after a brief delay
        setTimeout(() => {
          if (cameras.length > 0) {
            startScanner(cameras[activeCameraIndex].id);
          } else {
            startScanner();
          }
        }, 200);
      });
    }

    lastContainerSizeRef.current = { width: containerWidth, height: containerHeight };
  }, [containerWidth, containerHeight, inline]);

  const playBeep = () => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.error('Barcode scanner beep error:', e);
    }
  };

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      const state = scanner.getState?.();
      if (state === 2) {
        await scanner.stop();
      }
    } catch (err) {

    }
    try {
      const mediaStream = scanner._localMediaStream;
      if (mediaStream && typeof mediaStream.getTracks === 'function') {
        mediaStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (trackErr) {

          }
        });
      }
    } catch (streamErr) {

    }
    try {
      await scanner.clear();
    } catch (err) {

    }
    scannerRef.current = null;
    isRunningRef.current = false;
  };

  const checkTorchSupport = (attempts = 0) => {
    try {
      if (scannerRef.current && typeof scannerRef.current.getRunningTrack === 'function') {
        const track = scannerRef.current.getRunningTrack();
        if (track) {
          const capabilities = track.getCapabilities();
          if (capabilities && capabilities.torch !== undefined) {
            setIsTorchSupported(true);
            return;
          }
        }
      }
    } catch (e) {
      console.warn("Torch detection failed:", e);
    }

    // Retry up to 5 times if track isn't ready
    if (attempts < 5) {
      setTimeout(() => checkTorchSupport(attempts + 1), 800);
    } else {
      // If still not detected, we'll try one last time after a longer delay
      // Some devices take time to expose capabilities
      setTimeout(() => {
        try {
          if (scannerRef.current && typeof scannerRef.current.getRunningTrack === 'function') {
            const track = scannerRef.current.getRunningTrack();
            if (track?.getCapabilities()?.torch !== undefined) {
              setIsTorchSupported(true);
            }
          }
        } catch (e) { }
      }, 3000);
    }
  };

  const startScanner = async (cameraId) => {
    setError('');
    const scannerElement = qrReaderRef.current;
    if (!scannerElement || !scannerElement.isConnected) {

      setError('Camera preview is not ready. Please close and reopen the scanner.');
      return;
    }
    scanProcessedRef.current = false;

    await stopScanner();

    const html5QrCode = new Html5Qrcode(containerIdRef.current);
    scannerRef.current = html5QrCode;

    // config for full-frame scanning
    // We do NOT define qrbox or aspectRatio to allow the scanner to use the 
    // full native resolution and field of view of the camera.
    // This solves the 'small frame' issue by scanning the entire video feed.

    const config = {
      fps: 15,
      supportedScanTypes: [Html5Qrcode.SCAN_TYPE_CAMERA],
      useBarCodeDetectorIfSupported: true, // Critical for "any angle" support
      verbose: false,
      disableFlip: false,
      showTorchButtonIfSupported: true, // Enable torch for better lighting
      showZoomSliderIfSupported: true, // Enable zoom for distant codes
      tryHarder: true, // Critical for robust detection
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.AZTEC,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
        Html5QrcodeSupportedFormats.MAXICODE,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.PDF_417,
        Html5QrcodeSupportedFormats.RSS_14,
        Html5QrcodeSupportedFormats.RSS_EXPANDED,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION
      ]
    };

    const cameraConfig = cameraId
      ? { deviceId: { exact: cameraId } }
      : { facingMode: 'environment' };

    const handleScanSuccess = (decodedText, decodedResult) => {
      if (scanProcessedRef.current) {
        return;
      }
      if (decodedText && decodedText.trim()) {
        scanProcessedRef.current = true;
        playBeep();
        onScanRef.current(decodedText.trim());

        // Only auto-close if keepOpen is false
        if (!keepOpen) {
          stopScanner().finally(() => {
            setTimeout(() => onCloseRef.current(), 500);
          });
        } else {
          // Reset scanProcessedRef after a short delay to allow next scan
          setTimeout(() => {
            scanProcessedRef.current = false;
          }, 1000);
        }
      }
    };



    const handleScanFailure = (errorMessage) => {
      if (
        errorMessage.includes('NotFound') ||
        errorMessage.includes('parse error') ||
        errorMessage.includes('No MultiFormat Readers') ||
        errorMessage.includes('continuous scanning')
      ) {
        return;
      }

    };

    try {
      await html5QrCode.start(cameraConfig, config, handleScanSuccess, handleScanFailure);
      isRunningRef.current = true;
      // Brief delay to allow track to start before checking capabilities
      setTimeout(checkTorchSupport, 500);
    } catch (err) {

      try {
        await html5QrCode.clear().catch(() => { });
        const fallbackScanner = new Html5Qrcode(containerIdRef.current);
        scannerRef.current = fallbackScanner;
        // Use full container area for fallback scanner in inline mode
        const fallbackQrbox = inline && containerWidth && containerHeight
          ? { width: containerWidth - 10, height: containerHeight - 10 }
          : { width: 320, height: 150 };

        await fallbackScanner.start(
          cameraConfig,
          { fps: 10, qrbox: fallbackQrbox },
          handleScanSuccess,
          () => { }
        );
        isRunningRef.current = true;
      } catch (fallbackErr) {

        let errorMsg = 'Camera not available. ';
        if (fallbackErr?.message?.includes('Permission')) {
          errorMsg += 'Please allow camera access in your browser settings.';
        } else if (fallbackErr?.message?.includes('NotFound')) {
          errorMsg += 'No camera found. Check if a camera is connected and free.';
        } else if (fallbackErr?.message?.includes('NotAllowed')) {
          errorMsg += 'Camera access denied. Grant permission and refresh the page.';
        } else {
          errorMsg += fallbackErr?.message || 'Unknown error';
        }
        setError(errorMsg);
        isRunningRef.current = false;
        await stopScanner();
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    const setupScanner = async () => {
      try {
        const devices = await Html5Qrcode.getCameras();
        if (!isMounted) return;
        setCameras(devices || []);
        if (devices && devices.length > 0) {
          // Find back camera first
          // Priority: label contains 'back', 'rear', or 'environment' (case-insensitive)
          // If no back camera found, use first camera as fallback
          let backCameraIndex = 0;
          const foundIndex = devices.findIndex((device) => {
            const label = (device.label || '').toLowerCase();
            // Check label for back/rear/environment indicators
            return label.includes('back') ||
              label.includes('rear') ||
              label.includes('environment') ||
              label.includes('facing back') ||
              label.includes('facing: back');
          });

          if (foundIndex !== -1) {
            backCameraIndex = foundIndex;
          }

          setActiveCameraIndex(backCameraIndex);
          await startScanner(devices[backCameraIndex].id);
        } else {
          // No devices found, use environment facing mode as fallback
          await startScanner();
        }
      } catch (err) {

        // Fallback to environment facing mode (back camera)
        await startScanner();
      }
    };

    setupScanner();

    return () => {
      isMounted = false;
      stopScanner();
    };
  }, []);

  const handleSwitchCamera = async () => {
    if (cameras.length < 2 || isSwitchingCamera) return;
    const nextIndex = (activeCameraIndex + 1) % cameras.length;
    setIsSwitchingCamera(true);
    try {
      await startScanner(cameras[nextIndex].id);
      setActiveCameraIndex(nextIndex);
    } catch (err) {
      console.error("Error switching camera:", err);
    } finally {
      setIsSwitchingCamera(false);
    }
  };

  const toggleTorch = async () => {
    if (!scannerRef.current || !isRunningRef.current || !isTorchSupported) return;

    try {
      if (typeof scannerRef.current.getRunningTrack === 'function') {
        const track = scannerRef.current.getRunningTrack();
        if (track) {
          const newState = !isTorchOn;
          await track.applyConstraints({
            advanced: [{ torch: newState }]
          });
          setIsTorchOn(newState);
        }
      }
    } catch (err) {
      console.error("Error toggling torch:", err);
    }
  };

  const handleClose = async () => {
    await stopScanner();
    onCloseRef.current();
  };

  /* New Fullscreen UI Logic */
  const [isBatchMode, setIsBatchMode] = useState(keepOpen);
  const fileInputRef = useRef(null);

  // Sync internal batch mode with prop if needed, or just default
  useEffect(() => {
    setIsBatchMode(keepOpen);
  }, [keepOpen]);

  // Handle file upload for Gallery
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!scannerRef.current) return;

    scannerRef.current.scanFile(file, true)
      .then(decodedText => {
        onScanRef.current(decodedText);
        if (!isBatchMode) handleClose();
        else {
          // If batch mode, maybe show a toast?
          // alerting just to be safe or rely on parent
        }
      })
      .catch(err => {
        setError("Could not scan barcode from image. Please try another.");
      });
  };

  if (inline) {
    return (
      <div className={`relative w-full h-full bg-black rounded-lg overflow-hidden ${className}`}>
        <div
          id={containerIdRef.current}
          ref={qrReaderRef}
          className="w-full h-full"
          style={{
            minHeight: '100%',
            minWidth: '100%'
          }}
        />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-90">
            <div className="text-red-600 text-center p-2">
              <p className="text-xs font-medium">{error}</p>
            </div>
          </div>
        )}

        {/* Floating Controls for Inline Mode */}
        {!hideControls && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-black/60 backdrop-blur-lg rounded-2xl border border-white/10 p-1.5 shadow-2xl">
            {cameras.length > 1 && (
              <button
                onClick={handleSwitchCamera}
                disabled={isSwitchingCamera}
                className="px-4 py-2.5 flex items-center gap-2 text-white hover:bg-white/10 rounded-xl transition-all active:scale-95 disabled:opacity-50"
                title="Switch Camera"
              >
                <RefreshCw className={`h-5 w-5 ${isSwitchingCamera ? 'animate-spin' : ''}`} />
                <span className="text-[11px] font-bold uppercase tracking-wider">Switch</span>
              </button>
            )}

            {(cameras.length > 1 && isTorchSupported) && <div className="w-px h-6 bg-white/20 mx-1"></div>}

            {isTorchSupported && enableTorch && (
              <button
                onClick={toggleTorch}
                className={`px-4 py-2.5 flex items-center gap-2 rounded-xl transition-all active:scale-95 ${isTorchOn ? 'bg-yellow-400 text-black shadow-[0_0_15px_rgba(250,204,21,0.4)]' : 'text-white hover:bg-white/10'}`}
                title={isTorchOn ? "Turn Flash Off" : "Turn Flash On"}
              >
                {isTorchOn ? <ZapOff className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
                <span className="text-[11px] font-bold uppercase tracking-wider">{isTorchOn ? 'Off' : 'Flash'}</span>
              </button>
            )}
          </div>
        )}
        <style dangerouslySetInnerHTML={{
          __html: `
            #${containerIdRef.current} video {
              width: 100% !important;
              height: 100% !important;
              object-fit: cover !important;
              border-radius: 0.5rem;
            }
          `
        }} />
      </div>
    );
  }

  // Premium Fullscreen UI
  return (
    <div className="fixed inset-0 bg-black z-[1000] flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between p-4 bg-black/40 backdrop-blur-sm absolute top-0 left-0 right-0 z-30">
        <button
          onClick={handleClose}
          className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
        </button>
        <span className="text-white font-medium text-lg tracking-wide">Barcode Scanner</span>
        <div className="flex items-center gap-4">
          {isTorchSupported && (
            <button onClick={toggleTorch} className={`p-2 rounded-full transition-colors ${isTorchOn ? 'text-yellow-400' : 'text-white'}`}>
              {isTorchOn ? <ZapOff className="w-6 h-6" /> : <Zap className="w-6 h-6" />}
            </button>
          )}
          {cameras.length > 1 && (
            <button
              onClick={handleSwitchCamera}
              disabled={isSwitchingCamera}
              className="p-2 text-white opacity-80 hover:opacity-100 hover:bg-white/10 rounded-full transition-all disabled:opacity-40"
            >
              <RefreshCw className={`w-6 h-6 ${isSwitchingCamera ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Main Camera Area */}
      <div className="flex-1 relative overflow-hidden bg-black flex items-center justify-center">
        {error ? (
          <div className="text-center p-8 max-w-sm">
            <p className="text-red-400 font-medium mb-4">{error}</p>
            <button onClick={() => startScanner(cameras[activeCameraIndex]?.id)} className="px-6 py-2 bg-white text-black rounded-full font-bold">Retry</button>
          </div>
        ) : (
          <>
            <div id={containerIdRef.current} ref={qrReaderRef} className="absolute inset-0 w-full h-full object-cover"></div>
            {/* Bracket Overlay */}
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
              <div className="relative w-64 h-64 sm:w-80 sm:h-80 border-2 border-transparent">
                {/* Corners */}
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-3xl shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-3xl shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-3xl shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-3xl shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>

                {/* Laser Line */}
                <div className="absolute left-2 right-2 h-0.5 bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.8)] animate-scan-laser z-20">
                  <div className="absolute inset-0 bg-red-400 blur-[2px]"></div>
                </div>
              </div>
              <p className="text-white/80 text-sm mt-8 font-medium tracking-wide">Point camera at barcode</p>
            </div>
          </>
        )}
      </div>

      {/* Bottom Controls */}
      {(!hideControls || children) && (
        <div className={children ? "absolute bottom-0 left-0 right-0 z-50 w-full" : "bg-black p-6 pb-8 flex items-center justify-between px-8 sm:px-12 relative z-30"}>
          {children ? (
            /* Custom Bottom Content (e.g. Cart View) */
            <div className="w-full">{children}</div>
          ) : (
            /* Default Scanner Controls */
            <>
              {/* Gallery Button */}
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-12 h-12 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all active:scale-95"
                >
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handleFileUpload}
                />
              </div>

              {/* Shutter Button (Visual or Trigger) */}
              <button className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center relative active:scale-95 transition-transform" onClick={() => {
                // Trigger auto-focus or just visual feedback
                checkTorchSupport();
              }}>
                <div className="w-16 h-16 bg-white rounded-full"></div>
              </button>

              {/* Batch Scan Toggle */}
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => setIsBatchMode(!isBatchMode)}
                  className={`w-14 h-8 rounded-full flex items-center p-1 transition-colors ${isBatchMode ? 'bg-white' : 'bg-white/20'}`}
                >
                  <div className={`w-6 h-6 rounded-full bg-black shadow-sm transition-transform ${isBatchMode ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
                <span className="text-white/70 text-xs font-medium">Batch Scan</span>
              </div>
            </>
          )}
        </div>
      )}

      <style dangerouslySetInnerHTML={{
        __html: `
            #${containerIdRef.current} video {
              width: 100% !important;
              height: 100% !important;
              object-fit: cover !important;
            }
            @keyframes scan-laser {
              0% { top: 2%; opacity: 0.5; }
              50% { top: 98%; opacity: 1; }
              100% { top: 2%; opacity: 0.5; }
            }
            .animate-scan-laser {
              animation: scan-laser 2s ease-in-out infinite;
            }
          `
      }} />
    </div>
  );
});

BarcodeScanner.displayName = 'BarcodeScanner';

export default BarcodeScanner;
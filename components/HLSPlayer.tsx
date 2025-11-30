'use client';

import { useEffect, useRef } from 'react';
import Hls from 'hls.js';

interface HLSPlayerProps {
  src: string;
  className?: string;
}

export default function HLSPlayer({ src, className = '' }: HLSPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Cleanup previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (Hls.isSupported()) {
      // Chrome, Firefox, Edge - use hls.js with LOW LATENCY settings
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        // Aggressive low-latency settings to prevent delays
        liveSyncDurationCount: 1,        // Sync to 1 segment behind live
        liveMaxLatencyDurationCount: 3,  // Max 3 segments behind before seeking
        liveDurationInfinity: true,      // Treat as infinite live stream
        highBufferWatchdogPeriod: 1,     // Check buffer every 1 second
        backBufferLength: 10,            // Only keep 10 seconds of back buffer
        maxBufferLength: 10,             // Max 10 seconds forward buffer
        maxMaxBufferLength: 20,          // Hard max 20 seconds
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Jump to live edge on start
        if (hls.liveSyncPosition) {
          video.currentTime = hls.liveSyncPosition;
        }
        video.play().catch((err) => {
          console.log('[HLSPlayer] Autoplay blocked:', err.message);
        });
      });

      // Periodically check if we're too far behind live and catch up
      intervalRef.current = setInterval(() => {
        if (hls.liveSyncPosition && video.currentTime < hls.liveSyncPosition - 5) {
          console.log('[HLSPlayer] Catching up to live edge');
          video.currentTime = hls.liveSyncPosition;
        }
      }, 5000);

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error('[HLSPlayer] Fatal error:', data.type, data.details);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('[HLSPlayer] Network error, attempting recovery...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('[HLSPlayer] Media error, attempting recovery...');
              hls.recoverMediaError();
              break;
            default:
              console.error('[HLSPlayer] Unrecoverable error');
              hls.destroy();
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari - native HLS support
      video.src = src;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch((err) => {
          console.log('[HLSPlayer] Autoplay blocked:', err.message);
        });
      });
    } else {
      console.error('[HLSPlayer] HLS not supported in this browser');
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      className={`w-full h-full object-contain bg-black ${className}`}
      autoPlay
      muted
      playsInline
    />
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface HLSPlayerProps {
  src: string;
  className?: string;
}

export default function HLSPlayer({ src, className = '' }: HLSPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    retryCountRef.current = 0;
    setIsLoading(true);

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
        setIsLoading(false);
        retryCountRef.current = 0; // Reset retry count on success
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
          const maxRetries = 10;

          if (retryCountRef.current < maxRetries) {
            retryCountRef.current++;
            const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current - 1), 10000);

            // Only log first few retries to avoid console spam
            if (retryCountRef.current <= 3) {
              console.log(`[HLSPlayer] ${data.details} - retry ${retryCountRef.current}/${maxRetries} in ${Math.round(delay/1000)}s`);
            }

            retryTimeoutRef.current = setTimeout(() => {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  hls.recoverMediaError();
                  break;
                default:
                  // Reload from scratch
                  hls.loadSource(src);
                  break;
              }
            }, delay);
          } else {
            console.error('[HLSPlayer] Max retries reached, stream unavailable');
            setIsLoading(false);
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
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
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

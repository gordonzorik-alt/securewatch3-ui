'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useSecurityStore } from '@/lib/store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

// Module-level singleton to survive React Strict Mode double-mount
let globalSocket: Socket | null = null;
let connectionCount = 0;

export default function SocketManager() {
  const setupComplete = useRef(false);

  useEffect(() => {
    connectionCount++;
    const thisConnection = connectionCount;
    console.log(`[SocketManager] Mount #${thisConnection}`);

    // If socket already exists and is connected, just return
    if (globalSocket?.connected) {
      console.log('[SocketManager] Already connected, reusing socket');
      return;
    }

    // If socket exists but not connected, wait for it
    if (globalSocket) {
      console.log('[SocketManager] Socket exists, waiting for connection...');
      return;
    }

    console.log('[SocketManager] Creating new connection to:', API_BASE);
    globalSocket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    globalSocket.on('connect', () => {
      console.log('[SocketManager] ✅ Connected! Socket ID:', globalSocket?.id);
      useSecurityStore.getState().setSocketConnected(true);
    });

    globalSocket.on('disconnect', (reason) => {
      console.log('[SocketManager] ❌ Disconnected:', reason);
      useSecurityStore.getState().setSocketConnected(false);
    });

    globalSocket.on('connect_error', (error) => {
      console.error('[SocketManager] Connection error:', error.message);
    });

    // 1. v2 Raw Detections (The Ticker)
    globalSocket.on('detection:v2', (data) => {
      console.log('[Socket] 📸 Detection:', data.camera, data.class);
      useSecurityStore.getState().addDetection(data);
    });

    // 2. New Episodes (The List)
    globalSocket.on('episode:new', (data) => {
      console.log('[Socket] 🎬 New Episode:', data.id);
      useSecurityStore.getState().addEpisode(data);
    });

    // 3. Analysis Results (The Updates) - Receives full episode with analysis merged
    globalSocket.on('episode:analyzed', (data) => {
      const episodeId = data.id || data.episode_id;
      console.log('[Socket] 🧠 Analysis Received:', episodeId, 'threat:', data.threat_assessment?.code);
      useSecurityStore.getState().updateEpisode(episodeId, {
        threat_assessment: data.threat_assessment,
        analysis: data.analysis,
        frames_analyzed: data.frames_analyzed,
        analysis_time_ms: data.analysis_time_ms,
        model: data.model
      });
    });

    setupComplete.current = true;

    // Cleanup: In Strict Mode, this runs after first mount
    // We do NOT disconnect - let the socket persist
    return () => {
      console.log(`[SocketManager] Cleanup #${thisConnection} (socket preserved)`);
      // Don't disconnect - the socket is a singleton
    };
  }, []);

  return null;
}

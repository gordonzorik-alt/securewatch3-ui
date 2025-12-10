'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

// Types
interface Device {
  ip: string;
  mac?: string;
  vendor?: string;
  ports?: number[];
  unlocked?: boolean;
  rtspUrl?: string;
  snapshotOk?: boolean;
  snapshotData?: string;
  name?: string;
  mode?: 'priority' | 'standard';
  priority?: number;
  confidenceOverride?: number | null;
  enabled?: boolean;
}

interface ScoutState {
  step: 'welcome' | 'scan' | 'unlock' | 'verify' | 'configure' | 'finalize' | 'troubleshoot';
  scan: { running: boolean; subnetCidr?: string };
  devices: Device[];
  lastError: string | null;
}

interface ScoutAction {
  type: string;
  args?: Record<string, unknown>;
}

interface ScoutResponse {
  say: string;
  actions: ScoutAction[];
  quick_replies: string[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'scout' | 'system';
  content: string;
  timestamp: Date;
  actions?: ScoutAction[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function ScoutChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<ScoutState>({
    step: 'welcome',
    scan: { running: false },
    devices: [],
    lastError: null,
  });
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [configJson, setConfigJson] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize Socket.IO
  useEffect(() => {
    const s = io(API_BASE, { transports: ['websocket', 'polling'] });

    s.on('connect', () => {
      console.log('[Scout] Socket connected');
      addSystemMessage('Connected to SecureWatch server');
    });

    s.on('discovery:progress', (data) => {
      addSystemMessage(`Scanning... Found ${data.found || 0} devices`);
    });

    s.on('discovery:complete', (data) => {
      const devices = data.devices || [];
      setState((prev) => ({
        ...prev,
        scan: { ...prev.scan, running: false },
        devices,
        step: devices.length > 0 ? 'unlock' : 'troubleshoot',
      }));
      processToolResult({ type: 'START_SCAN', ok: devices.length > 0, devices });
    });

    s.on('discovery:error', (data) => {
      setState((prev) => ({
        ...prev,
        scan: { ...prev.scan, running: false },
        lastError: data.error,
      }));
      addSystemMessage(`Scan error: ${data.error}`);
    });

    s.on('discovery:unlock:progress', (data) => {
      addSystemMessage(`Testing credentials... ${data.tested}/${data.total}`);
    });

    s.on('discovery:unlock:complete', (data) => {
      const devices = data.devices || [];
      const unlocked = devices.filter((d: Device) => d.unlocked).length;
      setState((prev) => ({
        ...prev,
        devices,
        step: unlocked > 0 ? 'verify' : 'unlock',
      }));
      processToolResult({
        type: 'BULK_UNLOCK',
        ok: unlocked > 0,
        devices,
        summary: `${unlocked}/${devices.length} unlocked`,
      });
    });

    s.on('discovery:snapshot:complete', (data) => {
      if (data.ip) {
        setState((prev) => ({
          ...prev,
          devices: prev.devices.map((d) =>
            d.ip === data.ip ? { ...d, snapshotOk: true, snapshotData: data.frame } : d
          ),
        }));
      }
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  // Start welcome message
  useEffect(() => {
    const timer = setTimeout(() => {
      sendToScout('Hello, I need to set up cameras.');
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const addMessage = (role: ChatMessage['role'], content: string, actions?: ScoutAction[]) => {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role,
      content,
      timestamp: new Date(),
      actions,
    };
    setMessages((prev) => [...prev, msg]);
  };

  const addSystemMessage = (content: string) => addMessage('system', content);

  // Send message to Scout API
  const sendToScout = async (userMessage: string, toolResult?: unknown) => {
    setLoading(true);

    if (userMessage && !toolResult) {
      addMessage('user', userMessage);
    }

    try {
      const res = await fetch(`${API_BASE}/api/scout/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: messages.slice(-20).map((m) => ({
            role: m.role === 'scout' ? 'assistant' : m.role,
            content: m.content,
          })),
        }),
      });

      const data = await res.json();

      // Handle response - existing endpoint returns {success, response, fallbackResponse}
      const responseText = data.success
        ? data.response
        : (data.fallbackResponse || data.say || 'I encountered an issue. Please try again.');

      // Try to parse as JSON action format or use as plain text
      let actions: ScoutAction[] = [];
      if (data.actions) {
        actions = data.actions;
      }

      addMessage('scout', responseText, actions);

      // Execute actions if any
      for (const action of actions) {
        await executeAction(action);
      }
    } catch (err) {
      console.error('[Scout] API error:', err);
      addMessage('scout', 'Connection error. Please check your network and try again.');
    } finally {
      setLoading(false);
    }
  };

  const processToolResult = (result: unknown) => {
    sendToScout('', result);
  };

  // Execute Scout actions
  const executeAction = async (action: ScoutAction) => {
    const { type, args = {} } = action;

    switch (type) {
      case 'START_SCAN':
        setState((prev) => ({ ...prev, scan: { ...prev.scan, running: true } }));
        socket?.emit('discovery:start', { subnetCidr: args.subnetCidr || null }, (ack: unknown) => {
          console.log('[Scout] Scan started:', ack);
        });
        addSystemMessage('Starting network scan...');
        break;

      case 'ADD_MANUAL':
        if (args.ip) {
          setState((prev) => ({
            ...prev,
            devices: [
              ...prev.devices,
              { ip: args.ip as string, vendor: 'Manual', unlocked: false },
            ],
          }));
          addSystemMessage(`Added manual camera: ${args.ip}`);
        }
        break;

      case 'BULK_UNLOCK':
        if (args.username && args.password) {
          setCredentials({ username: args.username as string, password: args.password as string });
          socket?.emit(
            'discovery:unlockAll',
            {
              devices: state.devices,
              username: args.username,
              password: args.password,
            },
            (ack: unknown) => console.log('[Scout] Unlock started:', ack)
          );
          addSystemMessage('Testing credentials on all cameras...');
        } else {
          setShowCredentialModal(true);
        }
        break;

      case 'SNAPSHOT_ALL':
        const ips = (args.ips as string[]) || state.devices.filter((d) => d.unlocked).map((d) => d.ip);
        for (const ip of ips) {
          const device = state.devices.find((d) => d.ip === ip);
          if (device?.rtspUrl) {
            socket?.emit('discovery:snapshot', { rtspUrl: device.rtspUrl });
          }
        }
        addSystemMessage(`Capturing snapshots from ${ips.length} cameras...`);
        break;

      case 'SET_CAMERA':
        if (args.ip && args.patch) {
          setState((prev) => ({
            ...prev,
            devices: prev.devices.map((d) =>
              d.ip === args.ip ? { ...d, ...(args.patch as Partial<Device>) } : d
            ),
          }));
        }
        break;

      case 'GENERATE_CONFIG':
        const config = generateConfig();
        setConfigJson(config);
        processToolResult({ type: 'GENERATE_CONFIG', ok: true, configJson: config });
        break;

      case 'DOWNLOAD_CONFIG':
        if (configJson) {
          downloadConfig(args.filename as string);
        }
        break;

      default:
        console.warn('[Scout] Unknown action:', type);
    }
  };

  // Generate detection.json config
  const generateConfig = () => {
    const cameras: Record<string, unknown> = {};
    const enabledDevices = state.devices.filter((d) => d.enabled !== false && d.unlocked);

    enabledDevices.forEach((d, idx) => {
      const key = d.name || `camera_${idx + 1}`;
      cameras[key] = {
        enabled: true,
        rtsp_url: d.rtspUrl || `rtsp://127.0.0.1:8554/${key}`,
        priority: d.priority || idx + 1,
        ...(d.confidenceOverride != null && { confidence_override: d.confidenceOverride }),
      };
    });

    const config = {
      version: '2.0.0',
      description: 'Generated by Scout Setup Wizard',
      detection: {
        confidence_threshold: 0.5,
        iou_threshold: 0.5,
        allowed_classes: ['person'],
        cooldown_seconds: 20,
        frame_skip: 15,
        yolo_classes: [0],
      },
      worker: {
        type: 'vision_worker_v4.py',
        python_path: './venv/bin/python',
        health_check_interval_ms: 5000,
        restart_delay_ms: 5000,
        max_restarts: 10,
        model: 'yolo11n.pt',
      },
      cameras,
      redis: {
        host: 'localhost',
        port: 6379,
        worker_registry_key: 'securewatch:workers',
        heartbeat_ttl_seconds: 30,
      },
    };

    return JSON.stringify(config, null, 2);
  };

  const downloadConfig = (filename = 'detection.json') => {
    if (!configJson) return;
    const blob = new Blob([configJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    sendToScout(msg);
  };

  const handleQuickReply = (reply: string) => {
    sendToScout(reply);
  };

  const handleCredentialSubmit = () => {
    if (credentials.username && credentials.password) {
      setShowCredentialModal(false);
      executeAction({
        type: 'BULK_UNLOCK',
        args: { username: credentials.username, password: credentials.password },
      });
    }
  };

  // Get last Scout message for quick replies
  const lastScoutMessage = [...messages].reverse().find((m) => m.role === 'scout');
  const quickReplies = lastScoutMessage?.actions?.length
    ? []
    : ['Scan Network', 'Manual Add', 'Help'];

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700 bg-gray-800">
        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center font-bold">
          S
        </div>
        <div>
          <h2 className="font-semibold">Scout</h2>
          <p className="text-xs text-gray-400">Camera Setup Assistant</p>
        </div>
        <div className="ml-auto text-xs text-gray-500">
          Step: <span className="text-blue-400">{state.step}</span>
          {state.devices.length > 0 && (
            <span className="ml-2">
              {state.devices.length} camera{state.devices.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-blue-600'
                  : msg.role === 'system'
                  ? 'bg-gray-700 text-gray-300 text-sm italic'
                  : 'bg-gray-800'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              <p className="text-xs text-gray-400 mt-1">
                {msg.timestamp.toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-lg px-4 py-2">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Device preview (when devices exist) */}
      {state.devices.length > 0 && state.step !== 'welcome' && (
        <div className="px-4 py-2 border-t border-gray-700 bg-gray-800">
          <p className="text-xs text-gray-400 mb-2">Discovered Cameras:</p>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {state.devices.map((d) => (
              <div
                key={d.ip}
                className={`flex-shrink-0 px-3 py-2 rounded text-xs ${
                  d.unlocked ? 'bg-green-900' : 'bg-gray-700'
                }`}
              >
                <p className="font-mono">{d.ip}</p>
                <p className="text-gray-400">{d.vendor || 'Unknown'}</p>
                {d.name && <p className="text-blue-400">{d.name}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick replies */}
      {quickReplies.length > 0 && !loading && (
        <div className="px-4 py-2 flex gap-2 flex-wrap">
          {quickReplies.map((reply) => (
            <button
              key={reply}
              onClick={() => handleQuickReply(reply)}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-full text-sm transition-colors"
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-gray-800 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Send
          </button>
        </div>
      </form>

      {/* Credential Modal */}
      {showCredentialModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96 max-w-[90%]">
            <h3 className="text-lg font-semibold mb-4">Enter Site Credentials</h3>
            <p className="text-sm text-gray-400 mb-4">
              These credentials will be tested on all discovered cameras.
            </p>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Username (e.g., admin)"
                value={credentials.username}
                onChange={(e) => setCredentials((prev) => ({ ...prev, username: e.target.value }))}
                className="w-full bg-gray-700 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="password"
                placeholder="Password"
                value={credentials.password}
                onChange={(e) => setCredentials((prev) => ({ ...prev, password: e.target.value }))}
                className="w-full bg-gray-700 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowCredentialModal(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCredentialSubmit}
                disabled={!credentials.username || !credentials.password}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded transition-colors"
              >
                Test Credentials
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config Preview Modal */}
      {configJson && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-[600px] max-w-[90%] max-h-[80vh] overflow-hidden flex flex-col">
            <h3 className="text-lg font-semibold mb-4">Generated Configuration</h3>
            <pre className="flex-1 overflow-auto bg-gray-900 rounded p-4 text-sm font-mono">
              {configJson}
            </pre>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setConfigJson(null)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => downloadConfig()}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded transition-colors"
              >
                Download detection.json
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

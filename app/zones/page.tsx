'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Zone } from '@/lib/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

type DrawingMode = 'none' | 'polygon' | 'tripwire';
type Point = [number, number];

const ZONE_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  restricted: { fill: 'rgba(239, 68, 68, 0.3)', stroke: '#ef4444', label: 'Restricted' },
  monitored: { fill: 'rgba(59, 130, 246, 0.3)', stroke: '#3b82f6', label: 'Monitored' },
  tripwire: { fill: 'rgba(168, 85, 247, 0.3)', stroke: '#a855f7', label: 'Tripwire' },
  package_zone: { fill: 'rgba(34, 197, 94, 0.3)', stroke: '#22c55e', label: 'Package Zone' },
};

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>('none');
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [newZoneType, setNewZoneType] = useState<Zone['type']>('restricted');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneCameraId, setNewZoneCameraId] = useState('camera_front');
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 600;

  // Fetch zones
  useEffect(() => {
    fetchZones();
  }, []);

  const fetchZones = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/zones`);
      const data = await res.json();
      if (data.success) {
        setZones(data.zones || []);
      }
    } catch (err) {
      setError('Failed to fetch zones');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Draw canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw background
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw grid
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_WIDTH; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // Draw existing zones
    zones.forEach(zone => {
      const colors = ZONE_COLORS[zone.type] || ZONE_COLORS.monitored;
      const isSelected = selectedZone?.id === zone.id;

      if (zone.type === 'tripwire' && zone.line) {
        // Draw tripwire line
        ctx.beginPath();
        ctx.moveTo(zone.line[0][0], zone.line[0][1]);
        ctx.lineTo(zone.line[1][0], zone.line[1][1]);
        ctx.strokeStyle = isSelected ? '#ffffff' : colors.stroke;
        ctx.lineWidth = isSelected ? 4 : 3;
        ctx.stroke();

        // Draw direction arrow
        const midX = (zone.line[0][0] + zone.line[1][0]) / 2;
        const midY = (zone.line[0][1] + zone.line[1][1]) / 2;
        ctx.fillStyle = colors.stroke;
        ctx.beginPath();
        ctx.arc(midX, midY, 8, 0, Math.PI * 2);
        ctx.fill();
      } else if (zone.polygon) {
        // Draw polygon
        ctx.beginPath();
        ctx.moveTo(zone.polygon[0][0], zone.polygon[0][1]);
        for (let i = 1; i < zone.polygon.length; i++) {
          ctx.lineTo(zone.polygon[i][0], zone.polygon[i][1]);
        }
        ctx.closePath();
        ctx.fillStyle = isSelected ? colors.fill.replace('0.3', '0.5') : colors.fill;
        ctx.fill();
        ctx.strokeStyle = isSelected ? '#ffffff' : colors.stroke;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
      }

      // Draw zone label
      if (zone.polygon?.[0] || zone.line?.[0]) {
        const labelX = zone.polygon?.[0]?.[0] || zone.line?.[0]?.[0] || 0;
        const labelY = (zone.polygon?.[0]?.[1] || zone.line?.[0]?.[1] || 0) - 10;

        ctx.font = 'bold 12px system-ui';
        const textWidth = ctx.measureText(zone.name).width;
        ctx.fillStyle = colors.stroke;
        ctx.fillRect(labelX - 4, labelY - 14, textWidth + 8, 18);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(zone.name, labelX, labelY);
      }
    });

    // Draw current drawing
    if (currentPoints.length > 0) {
      const colors = ZONE_COLORS[newZoneType] || ZONE_COLORS.monitored;

      if (drawingMode === 'tripwire') {
        ctx.beginPath();
        ctx.moveTo(currentPoints[0][0], currentPoints[0][1]);
        if (currentPoints.length > 1) {
          ctx.lineTo(currentPoints[1][0], currentPoints[1][1]);
        }
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.beginPath();
        ctx.moveTo(currentPoints[0][0], currentPoints[0][1]);
        for (let i = 1; i < currentPoints.length; i++) {
          ctx.lineTo(currentPoints[i][0], currentPoints[i][1]);
        }
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw points
      currentPoints.forEach((point, idx) => {
        ctx.beginPath();
        ctx.arc(point[0], point[1], 6, 0, Math.PI * 2);
        ctx.fillStyle = idx === 0 ? '#22c55e' : colors.stroke;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }
  }, [zones, selectedZone, currentPoints, drawingMode, newZoneType]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Handle canvas click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawingMode === 'none') {
      // Check if clicked on a zone
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Simple point-in-polygon check for selection
      for (const zone of zones) {
        if (zone.polygon && isPointInPolygon([x, y], zone.polygon)) {
          setSelectedZone(zone);
          return;
        }
        if (zone.line && isPointNearLine([x, y], zone.line, 10)) {
          setSelectedZone(zone);
          return;
        }
      }
      setSelectedZone(null);
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);

    if (drawingMode === 'tripwire') {
      if (currentPoints.length < 2) {
        setCurrentPoints([...currentPoints, [x, y]]);
        if (currentPoints.length === 1) {
          // Tripwire complete
          setShowCreateModal(true);
        }
      }
    } else if (drawingMode === 'polygon') {
      // Check if clicking near first point to close polygon
      if (currentPoints.length >= 3) {
        const firstPoint = currentPoints[0];
        const distance = Math.sqrt((x - firstPoint[0]) ** 2 + (y - firstPoint[1]) ** 2);
        if (distance < 15) {
          // Close polygon
          setShowCreateModal(true);
          return;
        }
      }
      setCurrentPoints([...currentPoints, [x, y]]);
    }
  };

  // Point in polygon check
  const isPointInPolygon = (point: Point, polygon: number[][]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      if (((yi > point[1]) !== (yj > point[1])) &&
          (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  };

  // Point near line check
  const isPointNearLine = (point: Point, line: number[][], threshold: number): boolean => {
    const [x1, y1] = line[0];
    const [x2, y2] = line[1];
    const [px, py] = point;

    const lineLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const dist = Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1) / lineLen;
    return dist < threshold;
  };

  // Save zone
  const saveZone = async () => {
    if (!newZoneName.trim()) {
      alert('Please enter a zone name');
      return;
    }

    const zoneId = newZoneName.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();

    const newZone: Partial<Zone> = {
      id: zoneId,
      camera_id: newZoneCameraId,
      name: newZoneName,
      type: newZoneType,
      rules: {
        loitering_threshold_sec: 60,
        allowed_classes: [],
        alert_on_entry: true,
        direction: 'both',
      },
      active: true,
    };

    if (newZoneType === 'tripwire') {
      newZone.line = currentPoints;
    } else {
      newZone.polygon = currentPoints;
    }

    try {
      const res = await fetch(`${API_BASE}/api/zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newZone),
      });
      const data = await res.json();

      if (data.success) {
        setZones([...zones, data.zone]);
        resetDrawing();
        setShowCreateModal(false);
      } else {
        alert(data.error || 'Failed to create zone');
      }
    } catch (err) {
      alert('Failed to save zone');
      console.error(err);
    }
  };

  // Delete zone
  const deleteZone = async (zoneId: string) => {
    if (!confirm('Delete this zone?')) return;

    try {
      const res = await fetch(`${API_BASE}/api/zones/${zoneId}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.success) {
        setZones(zones.filter(z => z.id !== zoneId));
        if (selectedZone?.id === zoneId) {
          setSelectedZone(null);
        }
      }
    } catch (err) {
      alert('Failed to delete zone');
      console.error(err);
    }
  };

  // Toggle zone active
  const toggleZoneActive = async (zone: Zone) => {
    try {
      const res = await fetch(`${API_BASE}/api/zones/${zone.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !zone.active }),
      });
      const data = await res.json();

      if (data.success) {
        setZones(zones.map(z => z.id === zone.id ? data.zone : z));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Reset drawing
  const resetDrawing = () => {
    setDrawingMode('none');
    setCurrentPoints([]);
    setNewZoneName('');
  };

  // Start drawing
  const startDrawing = (mode: DrawingMode, type: Zone['type']) => {
    setDrawingMode(mode);
    setNewZoneType(type);
    setCurrentPoints([]);
    setSelectedZone(null);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-gray-200/50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <a href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <span className="font-semibold text-[17px] text-gray-900">SecureWatch</span>
            </a>
            <div className="flex items-center gap-1">
              <a href="/dispatch" className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100/80 transition-all">Dispatch</a>
              <a href="/zones" className="px-4 py-2 text-sm font-medium text-gray-900 bg-gray-100 rounded-lg transition-all">Zones</a>
              <a href="/analytics" className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100/80 transition-all">Analytics</a>
              <a href="/threats" className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100/80 transition-all">Threats</a>
            </div>
          </div>
        </div>
      </nav>

      {/* Header */}
      <div className="pt-12 pb-8 px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">Zone Configuration</h1>
          <p className="text-gray-500">Draw detection zones and tripwires on your camera views</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Canvas Area */}
          <div className="lg:col-span-2">
            {/* Drawing Tools */}
            <div className="bg-white rounded-2xl p-4 mb-4 border border-gray-200/60 shadow-sm">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => startDrawing('polygon', 'restricted')}
                  className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
                    drawingMode === 'polygon' && newZoneType === 'restricted'
                      ? 'bg-red-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                  Restricted Zone
                </button>
                <button
                  onClick={() => startDrawing('polygon', 'monitored')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                    drawingMode === 'polygon' && newZoneType === 'monitored'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span className="w-3 h-3 rounded bg-blue-500"></span>
                  Monitored Zone
                </button>
                <button
                  onClick={() => startDrawing('polygon', 'package_zone')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                    drawingMode === 'polygon' && newZoneType === 'package_zone'
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span className="w-3 h-3 rounded bg-green-500"></span>
                  Package Zone
                </button>
                <button
                  onClick={() => startDrawing('tripwire', 'tripwire')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                    drawingMode === 'tripwire'
                      ? 'bg-purple-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span className="w-3 h-0.5 bg-purple-500"></span>
                  Tripwire
                </button>
                {drawingMode !== 'none' && (
                  <button
                    onClick={resetDrawing}
                    className="px-4 py-2 rounded-xl font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 transition-all ml-auto"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {drawingMode !== 'none' && (
                <p className="text-sm text-slate-400 mt-3">
                  {drawingMode === 'tripwire'
                    ? 'Click two points to create a tripwire line'
                    : 'Click to add points. Click near the first point (green) to close the polygon.'}
                </p>
              )}
            </div>

            {/* Canvas */}
            <div
              ref={containerRef}
              className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-200/60 shadow-sm"
              style={{ cursor: drawingMode !== 'none' ? 'crosshair' : 'default' }}
            >
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                onClick={handleCanvasClick}
                className="block w-full"
              />
            </div>

            {/* Legend */}
            <div className="bg-white rounded-2xl p-4 mt-4 border border-gray-200/60 shadow-sm">
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Zone Types</h3>
              <div className="flex flex-wrap gap-4">
                {Object.entries(ZONE_COLORS).map(([type, colors]) => (
                  <div key={type} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: colors.stroke }}
                    ></div>
                    <span className="text-sm text-gray-600">{colors.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Zones List */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Configured Zones</h2>
                <p className="text-sm text-gray-500">{zones.length} zones defined</p>
              </div>

              {loading ? (
                <div className="p-8 text-center text-gray-400">Loading...</div>
              ) : zones.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  <p>No zones configured</p>
                  <p className="text-sm mt-2">Use the tools above to draw zones</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                  {zones.map(zone => {
                    const colors = ZONE_COLORS[zone.type] || ZONE_COLORS.monitored;
                    return (
                      <div
                        key={zone.id}
                        className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                          selectedZone?.id === zone.id ? 'bg-gray-50' : ''
                        }`}
                        onClick={() => setSelectedZone(zone)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: colors.stroke }}
                            ></div>
                            <div>
                              <h3 className="font-medium text-gray-900">{zone.name}</h3>
                              <p className="text-xs text-gray-500">
                                {colors.label} · {zone.camera_id}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleZoneActive(zone); }}
                              className={`px-2 py-1 text-xs rounded-md font-medium ${
                                zone.active
                                  ? 'bg-green-50 text-green-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {zone.active ? 'Active' : 'Inactive'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteZone(zone.id); }}
                              className="p-1 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Zone Rules */}
                        {selectedZone?.id === zone.id && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <p className="text-xs text-gray-400 mb-2">Rules</p>
                            <div className="space-y-1 text-xs text-gray-600">
                              {zone.rules.loitering_threshold_sec && (
                                <p>Loitering: {zone.rules.loitering_threshold_sec}s</p>
                              )}
                              {(zone.rules.allowed_classes?.length ?? 0) > 0 && (
                                <p>Allowed: {zone.rules.allowed_classes?.join(', ')}</p>
                              )}
                              {zone.rules.direction && (
                                <p>Direction: {zone.rules.direction}</p>
                              )}
                              {zone.rules.alert_on_entry !== undefined && (
                                <p>Alert on entry: {zone.rules.alert_on_entry ? 'Yes' : 'No'}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create Zone Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Save Zone</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Zone Name</label>
                <input
                  type="text"
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  placeholder="e.g., Front Gate Entry"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Camera ID</label>
                <input
                  type="text"
                  value={newZoneCameraId}
                  onChange={(e) => setNewZoneCameraId(e.target.value)}
                  placeholder="e.g., camera_front"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-all"
                />
              </div>

              <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: ZONE_COLORS[newZoneType].stroke }}
                ></div>
                <span className="text-gray-700 text-sm font-medium">{ZONE_COLORS[newZoneType].label}</span>
                <span className="text-gray-400 text-sm">· {currentPoints.length} points</span>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowCreateModal(false); resetDrawing(); }}
                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all font-medium"
              >
                Cancel
              </button>
              <button
                onClick={saveZone}
                className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-all font-medium"
              >
                Save Zone
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

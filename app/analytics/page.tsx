'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AnalyticsEvent } from '@/lib/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

interface Video {
  id: number;
  filename: string;
  status: string;
}

export default function AnalyticsPage() {
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<AnalyticsEvent[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchVideos();
    fetchEvents();
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [selectedVideoId]);

  useEffect(() => {
    applyFilters();
  }, [activeFilter, searchQuery, events]);

  const fetchVideos = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/videos`);
      const data = await res.json();
      if (data.success) {
        setVideos(data.videos || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchEvents = async () => {
    try {
      setLoading(true);
      const url = selectedVideoId
        ? `${API_BASE}/api/analytics/events?video_id=${selectedVideoId}&limit=0`
        : `${API_BASE}/api/analytics/events?limit=0`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...events];
    if (activeFilter !== 'all') {
      filtered = filtered.filter(e => e.severity === activeFilter);
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(e =>
        e.description.toLowerCase().includes(query) ||
        e.event_type.toLowerCase().includes(query) ||
        e.object_class.toLowerCase().includes(query)
      );
    }
    setFilteredEvents(filtered);
  };

  const stats = {
    total: events.length,
    critical: events.filter(e => e.severity === 'critical').length,
    high: events.filter(e => e.severity === 'high').length,
    medium: events.filter(e => e.severity === 'medium').length,
    low: events.filter(e => e.severity === 'low').length,
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-gray-200/50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <span className="font-semibold text-[17px] text-gray-900">SecureWatch</span>
            </Link>
            <div className="flex items-center gap-1">
              <NavLink href="/dispatch">Dispatch</NavLink>
              <NavLink href="/zones">Zones</NavLink>
              <NavLink href="/analytics" active>Analytics</NavLink>
              <NavLink href="/threats">Threats</NavLink>
            </div>
          </div>
        </div>
      </nav>

      {/* Header */}
      <div className="pt-12 pb-8 px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">Analytics</h1>
          <p className="text-gray-500">Zone intrusions, loitering, and behavioral analysis</p>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 pb-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap items-center gap-3">
            <FilterPill active={activeFilter === 'all'} onClick={() => setActiveFilter('all')} count={stats.total}>
              All
            </FilterPill>
            <FilterPill active={activeFilter === 'critical'} onClick={() => setActiveFilter('critical')} count={stats.critical} color="red">
              Critical
            </FilterPill>
            <FilterPill active={activeFilter === 'high'} onClick={() => setActiveFilter('high')} count={stats.high} color="orange">
              High
            </FilterPill>
            <FilterPill active={activeFilter === 'medium'} onClick={() => setActiveFilter('medium')} count={stats.medium} color="yellow">
              Medium
            </FilterPill>
            <FilterPill active={activeFilter === 'low'} onClick={() => setActiveFilter('low')} count={stats.low}>
              Low
            </FilterPill>

            <div className="h-6 w-px bg-gray-200 mx-2" />

            <select
              value={selectedVideoId ?? ''}
              onChange={(e) => setSelectedVideoId(e.target.value ? parseInt(e.target.value) : null)}
              className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-all text-gray-700"
            >
              <option value="">All Videos</option>
              {videos.map((video) => (
                <option key={video.id} value={video.id}>
                  Video {video.id} - {video.filename}
                </option>
              ))}
            </select>

            <div className="flex-1" />

            <div className="relative">
              <input
                type="text"
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-all"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Events List */}
      <div className="px-6 pb-16">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
            {loading ? (
              <div className="p-16 text-center">
                <div className="inline-block w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="p-16 text-center">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-gray-500 text-sm">No events found</p>
                <p className="text-gray-400 text-xs mt-1">
                  {searchQuery || activeFilter !== 'all' ? 'Try adjusting your filters' : 'Upload and analyze videos to see events'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredEvents.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
            )}
          </div>

          {filteredEvents.length > 0 && (
            <p className="text-center text-sm text-gray-400 mt-4">
              Showing {filteredEvents.length} of {events.length} events
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function NavLink({ href, children, active }: { href: string; children: React.ReactNode; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
        active ? 'text-gray-900 bg-gray-100' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
      }`}
    >
      {children}
    </Link>
  );
}

function FilterPill({ active, onClick, count, color, children }: {
  active: boolean;
  onClick: () => void;
  count: number;
  color?: string;
  children: React.ReactNode
}) {
  const colorStyles: Record<string, string> = {
    red: active ? 'bg-red-600 text-white' : 'text-red-600',
    orange: active ? 'bg-orange-500 text-white' : 'text-orange-600',
    yellow: active ? 'bg-yellow-500 text-white' : 'text-yellow-600',
  };

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
        active
          ? color ? colorStyles[color] : 'bg-gray-900 text-white'
          : `bg-white border border-gray-200 ${color ? colorStyles[color] : 'text-gray-600'} hover:border-gray-300`
      }`}
    >
      {children}
      <span className={`text-xs ${active ? 'opacity-80' : 'opacity-60'}`}>{count}</span>
    </button>
  );
}

function EventCard({ event }: { event: AnalyticsEvent }) {
  const [expanded, setExpanded] = useState(false);

  const severityStyles: Record<string, { bg: string; text: string; dot: string }> = {
    critical: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
    high: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
    medium: { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
    low: { bg: 'bg-gray-50', text: 'text-gray-600', dot: 'bg-gray-400' },
  };

  const style = severityStyles[event.severity] || severityStyles.low;

  return (
    <div
      className={`px-6 py-5 hover:bg-gray-50/50 transition-colors cursor-pointer ${expanded ? 'bg-gray-50/50' : ''}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-4">
        <div className={`w-2 h-2 rounded-full mt-2 ${style.dot}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-gray-900">{event.description}</p>
              <p className="text-sm text-gray-500 mt-1">
                {event.object_class} · Video {event.video_id} · {new Date(event.created_at).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${style.bg} ${style.text}`}>
                {event.severity}
              </span>
              <span className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-md text-xs font-medium">
                {event.event_type.replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          {expanded && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Detail label="Camera" value={event.camera_id} />
                <Detail label="Track ID" value={event.track_id || 'N/A'} />
                <Detail label="Confidence" value={`${(event.confidence * 100).toFixed(0)}%`} />
                <Detail label="Duration" value={`${event.duration_sec.toFixed(1)}s`} />
              </div>
              {event.zone_id && (
                <div className="mt-3">
                  <Detail label="Zone" value={event.zone_id} />
                </div>
              )}
            </div>
          )}
        </div>

        <svg
          className={`w-5 h-5 text-gray-400 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}

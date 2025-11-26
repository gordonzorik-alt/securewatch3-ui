'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AnalyticsEvent } from '@/lib/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

export default function Home() {
  const [recentEvents, setRecentEvents] = useState<AnalyticsEvent[]>([]);
  const [stats, setStats] = useState({ total: 0, critical: 0, high: 0, today: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/analytics/events?limit=10`);
      const data = await res.json();
      if (data.success && data.events) {
        setRecentEvents(data.events);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        setStats({
          total: data.events.length,
          critical: data.events.filter((e: AnalyticsEvent) => e.severity === 'critical').length,
          high: data.events.filter((e: AnalyticsEvent) => e.severity === 'high').length,
          today: data.events.filter((e: AnalyticsEvent) => new Date(e.created_at) >= today).length
        });
      }
    } catch (err) {
      console.error('Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-gray-200/50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <span className="font-semibold text-[17px] text-gray-900">SecureWatch</span>
            </div>
            <div className="flex items-center gap-1">
              <NavLink href="/dispatch">Dispatch</NavLink>
              <NavLink href="/zones">Zones</NavLink>
              <NavLink href="/analytics">Analytics</NavLink>
              <NavLink href="/threats">Threats</NavLink>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="pt-16 pb-12 px-6">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-5xl font-semibold tracking-tight text-gray-900 mb-4">
            Intelligent Surveillance
          </h1>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto font-normal">
            AI-powered video analytics that keeps you informed with real-time threat detection and behavioral analysis.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="px-6 pb-12">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard value={stats.total} label="Total Events" />
            <StatCard value={stats.critical} label="Critical" accent />
            <StatCard value={stats.high} label="High Priority" />
            <StatCard value={stats.today} label="Today" />
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-6 pb-12">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <ActionCard
              href="/dispatch"
              icon={<VideoIcon />}
              title="Upload Video"
              description="Process new footage"
            />
            <ActionCard
              href="/zones"
              icon={<ZoneIcon />}
              title="Configure Zones"
              description="Define detection areas"
            />
            <ActionCard
              href="/analytics"
              icon={<ChartIcon />}
              title="View Analytics"
              description="Behavioral insights"
            />
            <ActionCard
              href="/threats"
              icon={<ShieldIcon />}
              title="Review Threats"
              description="AI assessments"
            />
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="px-6 pb-16">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Recent Activity</h2>
            <Link href="/analytics" className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors">
              View All
            </Link>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
            {loading ? (
              <div className="p-12 text-center">
                <div className="inline-block w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              </div>
            ) : recentEvents.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-gray-500 text-sm">No events yet</p>
                <p className="text-gray-400 text-xs mt-1">Upload a video to get started</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {recentEvents.slice(0, 6).map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100/80 transition-all"
    >
      {children}
    </Link>
  );
}

function StatCard({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/60">
      <div className={`text-4xl font-semibold tracking-tight mb-1 ${accent && value > 0 ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
      </div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}

function ActionCard({ href, icon, title, description }: { href: string; icon: React.ReactNode; title: string; description: string }) {
  return (
    <Link href={href}>
      <div className="group bg-white rounded-2xl p-6 shadow-sm border border-gray-200/60 hover:shadow-md hover:border-gray-300/60 transition-all cursor-pointer">
        <div className="w-10 h-10 rounded-xl bg-gray-100 group-hover:bg-gray-900 flex items-center justify-center mb-4 transition-colors">
          <div className="text-gray-600 group-hover:text-white transition-colors">
            {icon}
          </div>
        </div>
        <h3 className="font-medium text-gray-900 mb-1">{title}</h3>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
    </Link>
  );
}

function EventRow({ event }: { event: AnalyticsEvent }) {
  const severityStyles: Record<string, string> = {
    critical: 'bg-red-50 text-red-700',
    high: 'bg-orange-50 text-orange-700',
    medium: 'bg-yellow-50 text-yellow-700',
    low: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors">
      <div className={`px-2.5 py-1 rounded-md text-xs font-medium ${severityStyles[event.severity]}`}>
        {event.severity}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{event.description}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {event.object_class} · {new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      <div className="text-xs text-gray-400 font-mono">
        {event.event_type.replace(/_/g, ' ')}
      </div>
    </div>
  );
}

// Icons
function VideoIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function ZoneIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

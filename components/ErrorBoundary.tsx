'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 text-white p-6">
          <div className="max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold text-red-500 mb-4">Something went wrong</h1>
            <div className="bg-gray-800 rounded-lg p-4 mb-4">
              <h2 className="font-mono text-sm text-red-400 mb-2">Error:</h2>
              <pre className="text-xs text-gray-300 overflow-auto whitespace-pre-wrap">
                {this.state.error?.message || 'Unknown error'}
              </pre>
            </div>
            {this.state.error?.stack && (
              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                <h2 className="font-mono text-sm text-red-400 mb-2">Stack trace:</h2>
                <pre className="text-xs text-gray-400 overflow-auto whitespace-pre-wrap">
                  {this.state.error.stack}
                </pre>
              </div>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

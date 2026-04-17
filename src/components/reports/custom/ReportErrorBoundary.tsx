'use client';

/**
 * ReportErrorBoundary — Catches runtime errors in custom report components.
 * When a custom report crashes, renders a clean fallback message instead of
 * breaking the entire page. The parent (TabbedReport) can optionally render
 * the default report as the fallback.
 *
 * CANNOT: Recover from the error — it only catches and displays.
 * CANNOT: Log to external services — it only renders UI.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  clientName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ReportErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[CustomReport] Runtime error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      // If a fallback (default report) is provided, render it
      if (this.props.fallback) {
        return (
          <div>
            <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="bg-amber-50 text-amber-800 p-3 rounded-lg border border-amber-200 text-sm">
                Custom report encountered an error — showing default report instead.
              </div>
            </div>
            {this.props.fallback}
          </div>
        );
      }

      return (
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-red-50 text-red-700 p-6 rounded-xl border border-red-200 text-center">
            <h2 className="text-lg font-semibold">Report Error</h2>
            <p className="text-sm mt-2 text-red-600">
              {this.props.clientName ? `The custom report for ${this.props.clientName}` : 'This custom report'} encountered an error.
              Please contact Creekside Marketing.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AIInterviewPanel } from './AIInterviewPanel';

type ToolMode = 'free-tool' | 'ai-interview';

interface ToolModeToggleProps {
  tool: 'roas-calculator' | 'ad-budget-calculator' | 'negative-keywords';
  toolLabel: string;
  toolContext?: Record<string, unknown>;
  children: React.ReactNode;
}

export function ToolModeToggle({ tool, toolLabel, toolContext, children }: ToolModeToggleProps) {
  const [mode, setMode] = useState<ToolMode>('free-tool');

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col">
      {/* Mode Toggle Bar */}
      <div className="bg-[var(--bg-secondary)] border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2 mr-4">
            <div className="w-6 h-6 rounded-md bg-[var(--accent)] flex items-center justify-center">
              <span className="text-white font-bold text-[10px]">CM</span>
            </div>
            <span className="text-[var(--text-primary)] text-sm font-medium hidden sm:inline">Creekside</span>
          </Link>
          <div className="flex bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg overflow-hidden">
            <button
              onClick={() => setMode('free-tool')}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                mode === 'free-tool'
                  ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              Free Tool
            </button>
            <button
              onClick={() => setMode('ai-interview')}
              className={`px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                mode === 'ai-interview'
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Custom AI Analysis
            </button>
          </div>
        </div>
        {mode === 'free-tool' && (
          <button
            onClick={() => setMode('ai-interview')}
            className="text-xs text-[var(--accent)] hover:text-[var(--accent-light)] font-medium transition-colors hidden sm:block"
          >
            Want personalized advice? Try the AI interview →
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col">
        {mode === 'free-tool' ? (
          <>{children}</>
        ) : (
          <AIInterviewPanel
            tool={tool}
            toolLabel={toolLabel}
            toolContext={toolContext}
          />
        )}
      </div>
    </div>
  );
}

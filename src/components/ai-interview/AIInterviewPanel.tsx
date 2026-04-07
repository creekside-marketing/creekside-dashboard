'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AIInterviewPanelProps {
  tool: 'roas-calculator' | 'ad-budget-calculator' | 'negative-keywords';
  toolContext?: Record<string, unknown>;
  toolLabel: string;
}

function generateSessionId() {
  return `interview_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function AIInterviewPanel({ tool, toolContext, toolLabel }: AIInterviewPanelProps) {
  const [stage, setStage] = useState<'gate' | 'interview'>('gate');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [gateError, setGateError] = useState('');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [sessionId] = useState(generateSessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Start the interview by sending the first message
  const startInterview = async () => {
    if (!email) {
      setGateError('Email is required');
      return;
    }
    setGateError('');
    setStage('interview');
    setLoading(true);

    // Save lead
    fetch('/api/tools/ai-interview/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, businessName, tool }),
    }).catch(() => {});

    // Kick off the conversation with a greeting from the user
    const openingMessage: Message = {
      role: 'user',
      content: businessName
        ? `Hi, I'm ${name || 'here'} from ${businessName}. I'd like a custom analysis for my business.`
        : `Hi, I'd like a custom analysis for my business.`,
    };

    try {
      const res = await fetch('/api/tools/ai-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [openingMessage],
          tool,
          toolContext,
          sessionId,
          email,
        }),
      });
      const data = await res.json();
      if (data.limitReached) {
        setLimitReached(true);
        setMessages([openingMessage, { role: 'assistant', content: data.error }]);
      } else {
        setMessages([openingMessage, { role: 'assistant', content: data.message }]);
      }
    } catch {
      setMessages([openingMessage, { role: 'assistant', content: "Thanks for your interest! Let's get started — tell me about your business and what's working and what's not." }]);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading || limitReached) return;

    const userMessage: Message = { role: 'user', content: input.trim().slice(0, 5000) };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/tools/ai-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          tool,
          toolContext,
          sessionId,
          email,
        }),
      });
      const data = await res.json();
      if (data.limitReached) {
        setLimitReached(true);
        setMessages([...newMessages, { role: 'assistant', content: data.error }]);
      } else if (data.error && res.status === 429) {
        setMessages([...newMessages, { role: 'assistant', content: data.error }]);
      } else {
        setMessages([...newMessages, { role: 'assistant', content: data.message }]);
      }
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: "I'm sorry, I had trouble processing that. Could you try again?" }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Gate Screen
  if (stage === 'gate') {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)] p-6">
        <div className="max-w-md w-full">
          <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl p-8">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/20 mb-4">
                <svg className="w-6 h-6 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">
                Get a Custom AI Analysis
              </h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Our AI strategist will interview you about your business and deliver a personalized {toolLabel} — tailored to your industry, goals, and current situation.
              </p>
            </div>

            <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 mb-6">
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">What you get</p>
              <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
                <li className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  5-minute diagnostic interview about your business
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Personalized recommendations (not generic advice)
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Specific numbers for your industry and budget
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  90-day action plan you can implement immediately
                </li>
              </ul>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); startInterview(); }} className="space-y-3">
              <div>
                <label className="block text-[var(--text-secondary)] text-xs font-medium mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[var(--text-secondary)] text-xs font-medium mb-1">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[var(--text-secondary)] text-xs font-medium mb-1">Business</label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Your business"
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
              </div>

              {gateError && <p className="text-red-400 text-sm">{gateError}</p>}

              <button
                type="submit"
                className="w-full py-3 rounded-lg font-semibold text-sm transition-all bg-[var(--accent)] text-white hover:brightness-110"
              >
                Start My Custom Analysis
              </button>
            </form>

            <p className="text-center text-xs text-[var(--text-muted)] mt-4">
              Takes ~5 minutes. No credit card required.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Interview Chat
  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-primary)] h-screen">
      {/* Chat Header */}
      <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center">
            <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI Strategy Interview</h3>
            <p className="text-xs text-[var(--text-muted)]">Custom {toolLabel} for {businessName || 'your business'}</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-[var(--accent)] text-white rounded-br-md'
                : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] rounded-bl-md'
            }`}>
              {msg.role === 'assistant' ? (
                <div
                  className="prose prose-invert prose-sm max-w-none [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_ul]:space-y-1 [&_li]:text-[var(--text-secondary)] [&_strong]:text-[var(--text-primary)] [&_p]:text-[var(--text-secondary)] [&_p]:mb-2"
                  dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }}
                />
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
        {limitReached ? (
          <div className="text-center py-2">
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              You&apos;ve reached the analysis limit. Ready to go deeper?
            </p>
            <a
              href="https://calendar.app.google/4ierPN3nNxLMMTAz7"
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-[var(--accent)] rounded-lg hover:brightness-110 transition-all"
            >
              Book a Free Strategy Call
            </a>
          </div>
        ) : (
          <>
            <div className="flex gap-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your response..."
                rows={1}
                className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="px-4 py-3 bg-[var(--accent)] text-white rounded-xl font-medium text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2 text-center">
              Press Enter to send. The more detail you share, the better your custom analysis.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// Simple markdown-to-HTML converter for the assistant messages
function formatMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(.+)$/gm, (match) => {
      if (match.startsWith('<')) return match;
      return match;
    });
}

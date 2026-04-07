import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Free ROAS Calculator & Predictor',
  description:
    'See your real return before you spend a dollar. The only free calculator that supports both product and service businesses with 3-scenario modeling and AI-powered insights.',
  openGraph: {
    title: 'Free ROAS Calculator & Predictor | Creekside Marketing',
    description:
      'See your real return before you spend a dollar. 3-scenario modeling, AI insights, and industry benchmarks.',
  },
};

export default function RoasCalculatorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

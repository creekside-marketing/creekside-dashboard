'use client';

import { createContext, useContext, useReducer, useMemo, useState, useCallback, type ReactNode } from 'react';
import type { CalculatorInputs, CalculatorResults } from '@/lib/engine';
import { runScenarios } from '@/lib/engine';
import { calculatorReducer, initialState, type CalculatorState } from './calculator-reducer';
import type { CalculatorAction } from './calculator-actions';

export interface SavedScenario {
  label: string;
  state: CalculatorState;
  results: CalculatorResults;
}

interface CalculatorContextValue {
  state: CalculatorState;
  dispatch: React.Dispatch<CalculatorAction>;
  results: CalculatorResults | null;
  savedScenario: SavedScenario | null;
  saveCurrentScenario: () => void;
  clearSavedScenario: () => void;
}

const CalculatorContext = createContext<CalculatorContextValue | null>(null);

export function CalculatorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(calculatorReducer, initialState);
  const [savedScenario, setSavedScenario] = useState<SavedScenario | null>(null);

  const results = useMemo(() => {
    const inputs: CalculatorInputs = {
      businessType: state.businessType,
      industry: state.industry,
      productInputs: state.businessType === 'product' ? state.productInputs : undefined,
      serviceInputs: state.businessType === 'service' ? state.serviceInputs : undefined,
      totalBudget: state.totalBudget,
      duration: state.duration,
      spendModel: state.spendModel,
      customSpendAllocation: state.customSpendAllocation.length > 0 ? state.customSpendAllocation : undefined,
      roasAssumptions: state.roasAssumptions,
      ltvMultipliers: state.ltvMultipliers,
    };
    try {
      return runScenarios(inputs);
    } catch {
      return null;
    }
  }, [state]);

  const saveCurrentScenario = useCallback(() => {
    if (!results) return;
    setSavedScenario({
      label: 'Scenario A',
      state: { ...state },
      results,
    });
  }, [state, results]);

  const clearSavedScenario = useCallback(() => {
    setSavedScenario(null);
  }, []);

  return (
    <CalculatorContext.Provider
      value={{ state, dispatch, results, savedScenario, saveCurrentScenario, clearSavedScenario }}
    >
      {children}
    </CalculatorContext.Provider>
  );
}

export function useCalculator(): CalculatorContextValue {
  const ctx = useContext(CalculatorContext);
  if (!ctx) throw new Error('useCalculator must be used within CalculatorProvider');
  return ctx;
}

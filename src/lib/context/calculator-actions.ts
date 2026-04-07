import type {
  BusinessType,
  Industry,
  ProductInputs,
  ServiceInputs,
  SpendModel,
  RoasAssumptions,
  LtvVariants,
} from '@/lib/engine';

export type CalculatorAction =
  | { type: 'SET_BUSINESS_TYPE'; payload: BusinessType }
  | { type: 'SET_INDUSTRY'; payload: Industry }
  | { type: 'UPDATE_PRODUCT_INPUTS'; payload: Partial<ProductInputs> }
  | { type: 'UPDATE_SERVICE_INPUTS'; payload: Partial<ServiceInputs> }
  | { type: 'SET_TOTAL_BUDGET'; payload: number }
  | { type: 'SET_DURATION'; payload: number }
  | { type: 'SET_SPEND_MODEL'; payload: SpendModel }
  | { type: 'SET_CUSTOM_SPEND'; payload: number[] }
  | { type: 'UPDATE_ROAS_ASSUMPTIONS'; payload: Partial<RoasAssumptions> }
  | { type: 'UPDATE_LTV_MULTIPLIERS'; payload: Partial<LtvVariants> }
  | { type: 'RESET' };

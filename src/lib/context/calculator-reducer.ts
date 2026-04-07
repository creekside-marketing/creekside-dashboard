import type {
  BusinessType,
  Industry,
  ProductInputs,
  ServiceInputs,
  SpendModel,
  RoasAssumptions,
  LtvVariants,
} from '@/lib/engine';
import { getDefaultRoasAssumptions } from '@/lib/engine';
import type { CalculatorAction } from './calculator-actions';

export interface CalculatorState {
  businessType: BusinessType;
  industry: Industry;
  productInputs: ProductInputs;
  serviceInputs: ServiceInputs;
  totalBudget: number;
  duration: number;
  spendModel: SpendModel;
  customSpendAllocation: number[];
  roasAssumptions: RoasAssumptions;
  ltvMultipliers: LtvVariants;
}

export const initialState: CalculatorState = {
  businessType: 'product',
  industry: 'other',
  totalBudget: 5000,
  duration: 6,
  spendModel: 'uniform',
  customSpendAllocation: [],
  productInputs: {
    price: 100,
    cogs: 30,
    aov: 100,
    estimatedLtv: 300,
    grossMargin: 70,
  },
  serviceInputs: {
    avgContractValue: 2000,
    closeRateFromLead: 0.25,
    clientRetentionMonths: 12,
    monthlyRecurringValue: 500,
  },
  roasAssumptions: getDefaultRoasAssumptions('other'),
  ltvMultipliers: {
    conservative: 0.7,
    base: 1.0,
    optimistic: 1.4,
  },
};

export function calculatorReducer(
  state: CalculatorState,
  action: CalculatorAction
): CalculatorState {
  switch (action.type) {
    case 'SET_BUSINESS_TYPE':
      return { ...state, businessType: action.payload };

    case 'SET_INDUSTRY':
      return {
        ...state,
        industry: action.payload,
        roasAssumptions: getDefaultRoasAssumptions(action.payload),
      };

    case 'UPDATE_PRODUCT_INPUTS':
      return {
        ...state,
        productInputs: { ...state.productInputs, ...action.payload },
      };

    case 'UPDATE_SERVICE_INPUTS':
      return {
        ...state,
        serviceInputs: { ...state.serviceInputs, ...action.payload },
      };

    case 'SET_TOTAL_BUDGET':
      return { ...state, totalBudget: action.payload };

    case 'SET_DURATION':
      return { ...state, duration: action.payload };

    case 'SET_SPEND_MODEL':
      return { ...state, spendModel: action.payload };

    case 'SET_CUSTOM_SPEND':
      return { ...state, customSpendAllocation: action.payload };

    case 'UPDATE_ROAS_ASSUMPTIONS':
      return {
        ...state,
        roasAssumptions: { ...state.roasAssumptions, ...action.payload },
      };

    case 'UPDATE_LTV_MULTIPLIERS':
      return {
        ...state,
        ltvMultipliers: { ...state.ltvMultipliers, ...action.payload },
      };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

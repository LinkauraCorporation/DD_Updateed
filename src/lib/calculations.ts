import { ProfitabilityMetrics } from '../types/domain.types.ts';

export interface LoadFinancialInput {
  rate: number;
  loadedMiles: number;
  deadheadMiles: number;
  fuelExpense?: number;
  driverPay?: number;
  otherExpenses?: number;
}

/**
 * Pure deterministic profitability calculator for trucking loads.
 * Does NOT rely on AI or floating point drift.
 */
export function calculateProfitability(input: LoadFinancialInput): ProfitabilityMetrics {
  const grossRate = Math.max(0, Number(input.rate) || 0);
  const loadedMiles = Math.max(0, Number(input.loadedMiles) || 0);
  const deadheadMiles = Math.max(0, Number(input.deadheadMiles) || 0);
  
  // Total miles = loaded miles + deadhead miles
  const totalMiles = Number((loadedMiles + deadheadMiles).toFixed(2));
  
  // Rate Per Mile (RPM) = Gross Rate / Total Miles
  const rpm = totalMiles > 0 ? Number((grossRate / totalMiles).toFixed(3)) : 0;
  
  const fuelExpense = Math.max(0, Number(input.fuelExpense) || 0);
  const driverPay = Math.max(0, Number(input.driverPay) || 0);
  const otherExpenses = Math.max(0, Number(input.otherExpenses) || 0);
  
  // Total estimated cost = fuel + driver pay + other expenses
  const totalEstimatedCost = Number((fuelExpense + driverPay + otherExpenses).toFixed(2));
  
  // Estimated profit = gross rate - total estimated cost
  const estimatedProfit = Number((grossRate - totalEstimatedCost).toFixed(2));
  
  // Profit margin = (estimated profit / gross rate) * 100
  const profitMargin = grossRate > 0 
    ? Number(((estimatedProfit / grossRate) * 100).toFixed(2))
    : 0;

  return {
    grossRate,
    loadedMiles,
    deadheadMiles,
    totalMiles,
    rpm,
    fuelExpense,
    driverPay,
    otherExpenses,
    totalEstimatedCost,
    estimatedProfit,
    profitMargin,
  };
}

/**
 * Deterministic helper to estimate driver pay based on driver contract terms.
 */
export function estimateDriverPay(
  payType: 'percentage_gross' | 'per_mile' | 'flat_rate',
  payRate: number,
  grossRate: number,
  loadedMiles: number,
  deadheadMiles: number
): number {
  const rate = Math.max(0, Number(payRate) || 0);
  const gross = Math.max(0, Number(grossRate) || 0);
  const totalMiles = Math.max(0, Number(loadedMiles) || 0) + Math.max(0, Number(deadheadMiles) || 0);

  if (payType === 'percentage_gross') {
    return Number(((gross * rate) / 100).toFixed(2));
  }
  if (payType === 'per_mile') {
    return Number((totalMiles * rate).toFixed(2));
  }
  if (payType === 'flat_rate') {
    return Number(rate.toFixed(2));
  }
  return 0;
}

/**
 * Deterministic helper to estimate fuel cost based on average MPG and fuel price.
 */
export function estimateFuelCost(
  totalMiles: number,
  averageMpg = 6.5,
  dieselPricePerGallon = 3.85
): number {
  if (totalMiles <= 0 || averageMpg <= 0 || dieselPricePerGallon <= 0) return 0;
  const gallonsNeeded = totalMiles / averageMpg;
  return Number((gallonsNeeded * dieselPricePerGallon).toFixed(2));
}

/**
 * Formats a currency value cleanly as $1,234.56 or $0.00
 */
export function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

/**
 * Formats mileage with commas (e.g. 1,250 mi)
 */
export function formatMiles(miles: number | null | undefined): string {
  if (miles === null || miles === undefined || isNaN(miles)) return '0 mi';
  return `${new Intl.NumberFormat('en-US').format(Math.round(miles))} mi`;
}

/**
 * Formats RPM (e.g. $2.85/mi)
 */
export function formatRPM(rpm: number | null | undefined): string {
  if (rpm === null || rpm === undefined || isNaN(rpm)) return '$0.00/mi';
  return `$${rpm.toFixed(2)}/mi`;
}

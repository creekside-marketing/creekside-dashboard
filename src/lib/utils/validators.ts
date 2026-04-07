export function validateBudget(n: number): boolean {
  return n > 0;
}

export function validateDuration(n: number): boolean {
  return n >= 1 && n <= 36;
}

export function validateRoas(n: number): boolean {
  return n > 0;
}

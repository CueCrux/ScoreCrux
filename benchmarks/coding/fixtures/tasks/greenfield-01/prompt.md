# Cron Expression Parser

Implement a TypeScript module that parses and validates standard 5-field cron expressions.

## Requirements

Export a function `parseCron(expression: string): CronSchedule` that:

1. Parses a 5-field cron expression: `minute hour day-of-month month day-of-week`
2. Supports these syntaxes per field:
   - `*` — all values
   - `N` — single value (e.g., `5`)
   - `N,M` — list (e.g., `1,15`)
   - `N-M` — range (e.g., `1-5`)
   - `*/N` — step (e.g., `*/15`)
   - `N-M/S` — range with step (e.g., `1-30/5`)
3. Validates field ranges:
   - minute: 0-59
   - hour: 0-23
   - day-of-month: 1-31
   - month: 1-12
   - day-of-week: 0-6 (0 = Sunday)
4. Throws `CronParseError` for invalid expressions

## Interface

```typescript
export interface CronSchedule {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  original: string;
}

export class CronParseError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'CronParseError';
  }
}

export function parseCron(expression: string): CronSchedule;
```

## Output

Write your solution to `solution.ts`. Export all types and the `parseCron` function.

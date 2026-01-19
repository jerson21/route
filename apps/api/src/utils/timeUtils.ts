/**
 * Time utilities for ETA calculations
 */

const TEN_MINUTES_MS = 10 * 60 * 1000;

/**
 * Round a date to the nearest 10 minutes
 * @param date - The date to round
 * @param direction - 'down' rounds to earlier time, 'up' rounds to later time
 * @returns Rounded date
 *
 * Examples:
 * - roundTimeToNearest10(16:03, 'down') => 16:00
 * - roundTimeToNearest10(16:03, 'up') => 16:10
 * - roundTimeToNearest10(16:10, 'down') => 16:10 (already rounded)
 * - roundTimeToNearest10(16:10, 'up') => 16:10 (already rounded)
 */
export function roundTimeToNearest10(date: Date, direction: 'down' | 'up'): Date {
  const ms = date.getTime();

  if (direction === 'down') {
    return new Date(Math.floor(ms / TEN_MINUTES_MS) * TEN_MINUTES_MS);
  } else {
    return new Date(Math.ceil(ms / TEN_MINUTES_MS) * TEN_MINUTES_MS);
  }
}

/**
 * Calculate ETA window with rounded times
 * @param estimatedArrival - The estimated arrival time
 * @param windowBefore - Minutes before ETA for window start
 * @param windowAfter - Minutes after ETA for window end
 * @returns Object with rounded window start and end times
 */
export function calculateEtaWindow(
  estimatedArrival: Date,
  windowBefore: number = 30,
  windowAfter: number = 30
): { etaWindowStart: Date; etaWindowEnd: Date } {
  const etaMs = estimatedArrival.getTime();

  const rawStart = new Date(etaMs - windowBefore * 60 * 1000);
  const rawEnd = new Date(etaMs + windowAfter * 60 * 1000);

  return {
    etaWindowStart: roundTimeToNearest10(rawStart, 'down'),
    etaWindowEnd: roundTimeToNearest10(rawEnd, 'up')
  };
}

/**
 * Format time for display (HH:mm)
 * @param date - Date to format
 * @returns Formatted time string
 */
export function formatTimeHHMM(date: Date): string {
  return date.toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

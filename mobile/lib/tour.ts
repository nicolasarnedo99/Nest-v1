// The first-run walkthrough's hints, and what moves it on (screens/Tour.tsx draws them).
export const TOUR = ['Double-tap to upload a receipt', 'Tap outside the box to cancel it', 'Swipe left to see your portfolio', 'Swipe right to see your activity'] as const;

// Which page or sheet event moves the tour on, from step `step`. Pages: 0 portfolio, 1 chat, 2 activity.
export function nextTourStep(step: number, event: { receipt: boolean } | { page: number }): number {
  if (step === 0 && 'receipt' in event && event.receipt) return 1;
  if (step === 1 && 'receipt' in event && !event.receipt) return 2;
  if (step === 2 && 'page' in event && event.page === 0) return 3;
  if (step === 3 && 'page' in event && event.page === 2) return TOUR.length;
  return step;
}

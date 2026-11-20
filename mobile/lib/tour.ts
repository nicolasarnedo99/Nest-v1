// The first-run walkthrough, shown once after setup (screens/Tour.tsx draws it). Each hint waits for you to do what it says.
// Pages: 0 portfolio, 1 chat, 2 activity. Step 1's hint is drawn inside the receipt sheet, which covers the app.
export const TOUR = ['Double-tap to upload a receipt', 'Tap outside the box to cancel it', 'Swipe left to see your portfolio',
  'Swipe right to go back to the main menu', 'Swipe right to see your activity', 'Swipe left to go back to the main menu'] as const;

// What each step waits for.
const UNTIL: readonly ({ receipt: boolean } | { page: number })[] = [{ receipt: true }, { receipt: false }, { page: 0 }, { page: 1 }, { page: 2 }, { page: 1 }];

export function nextTourStep(step: number, event: { receipt: boolean } | { page: number }): number {
  const want = UNTIL[step];
  if (!want) return step;
  const met = 'receipt' in want ? 'receipt' in event && event.receipt === want.receipt : 'page' in event && event.page === want.page;
  return met ? step + 1 : step;
}

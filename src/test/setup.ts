import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { installMatchMedia, setWideScreen } from './viewport.ts';

installMatchMedia();

// Testing Library only knows how to move Jest's fake clock forward while it
// waits for React. Point it at Vitest's fake clock instead.
(globalThis as { jest?: unknown }).jest = {
  advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
};

afterEach(() => {
  cleanup();
  setWideScreen(false);
});

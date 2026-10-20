import { createContext, useContext } from 'react';
import type { FormatOptions } from './lib/dates.ts';

/**
 * Locale and timezone for every date shown. Empty by default, which means the
 * viewer's own browser settings. Tests set them explicitly.
 */
export const FormatContext = createContext<FormatOptions>({});

export function useFormat(): FormatOptions {
  return useContext(FormatContext);
}

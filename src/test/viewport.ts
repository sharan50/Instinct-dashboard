/** jsdom has no matchMedia: this fake reports a narrow (phone) screen unless told otherwise. */
let wide = false;

export function setWideScreen(value: boolean): void {
  wide = value;
}

export function installMatchMedia(): void {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: wide && query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

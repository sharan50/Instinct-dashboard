/*
 * Stand-in for Google's sign-in library (https://accounts.google.com/gsi/client)
 * in browser tests. It never contacts Google. Tests choose what "Google"
 * answers by setting window.__FAKE_GIS__ = { mode: 'grant' | 'deny' | 'close' | 'blocked' | 'no-scope' }.
 */
(() => {
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
  const settings = () => window.__FAKE_GIS__ || { mode: 'grant' };
  window.__FAKE_GIS_REQUESTS__ = [];

  window.google = {
    accounts: {
      oauth2: {
        initTokenClient(config) {
          return {
            requestAccessToken(overrides = {}) {
              window.__FAKE_GIS_REQUESTS__.push({
                prompt: overrides.prompt,
                login_hint: config.login_hint,
                scope: config.scope,
                include_granted_scopes: config.include_granted_scopes,
              });
              const s = settings();
              setTimeout(() => {
                if (s.mode === 'deny') config.callback({ error: 'access_denied' });
                else if (s.mode === 'close') config.error_callback?.({ type: 'popup_closed', message: 'Popup window closed' });
                else if (s.mode === 'blocked') config.error_callback?.({ type: 'popup_failed_to_open', message: 'Failed to open popup window' });
                else if (s.mode === 'no-scope') config.callback({ access_token: 'fake-token', expires_in: 3599, scope: 'email', token_type: 'Bearer' });
                else config.callback({ access_token: s.token || 'fake-token', expires_in: s.expiresIn ?? 3599, scope: SCOPE, token_type: 'Bearer' });
              }, 30);
            },
          };
        },
        hasGrantedAllScopes(response, ...scopes) {
          const granted = (response.scope || '').split(' ');
          return scopes.every((scope) => granted.includes(scope));
        },
        revoke(token, done) {
          window.__FAKE_GIS_REVOKED__ = token;
          setTimeout(() => done && done({ successful: true }), 10);
        },
      },
    },
  };
})();

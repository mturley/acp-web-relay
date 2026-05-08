# Web Authentication for ACP Web Relay

## Context

The relay exposes Claude Code sessions over HTTPS on the network. Currently, anyone who can reach the port can view and interact with sessions. When accessing via an external tunnel, this is a security gap. This design adds password-based authentication so only authorized users can access the web UI and WebSocket connections.

Single-user system — one shared password, no user accounts.

## Password Management

### Storage

- Password hashed with **bcrypt** via `bcryptjs` (pure JS, no native deps)
- Stored in `~/.acp-web-relay/auth.json`:
  ```json
  { "passwordHash": "$2a$...", "jwtSecret": "a1b2c3..." }
  ```
- JWT signing secret: auto-generated 256-bit random hex string

### Setup Flow

1. **First run (no `auth.json`, no env var):** Relay prompts interactively: "Enter a password for web access:" (masked input). Hashes and stores it alongside a new JWT secret. If `auth.json` exists but is corrupted or missing the password hash, re-prompts.
2. **CLI flag `--set-password <password>`** on `serve` command: Sets/updates the persisted password hash, regenerates the JWT secret (invalidating existing sessions), then starts normally.
3. **Env var `ACP_RELAY_PASSWORD`:** If set, the relay accepts this password for login instead of the persisted hash. The persisted hash is not overwritten. Allows per-session password override without modifying the stored config.

### Password Change Behavior

When the password is changed via `--set-password`, the JWT secret is regenerated. This invalidates all existing browser sessions, forcing re-login.

## Authentication Flow

### Login

- `POST /api/login` with body `{ "password": "..." }`
- Server validates using `bcrypt.compare(submitted, activeHash)` where `activeHash` is either the env-var-derived hash (if `ACP_RELAY_PASSWORD` is set) or the persisted hash from `auth.json`
- On success: signs a JWT (`{ iat, exp }`, 7-day expiry) and sets it as a cookie:
  ```
  Set-Cookie: acp_relay_token=<jwt>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/
  ```
- Returns `{ "ok": true }` response body
- On failure: returns 401 with `{ "error": "Invalid password" }`

### Request Validation

- **HTTP requests:** Middleware checks the `acp_relay_token` cookie on every request. If missing or invalid JWT, redirects to `/login`.
- **WebSocket upgrades:** The `upgrade` event handler parses the cookie from the request headers and validates the JWT. Rejects with 401 if invalid.
- **Exempt routes:** `GET /login`, `GET /login/*` (login page assets), and `POST /api/login` are accessible without authentication. All other routes require a valid cookie.
- **Already authenticated on `/login`:** If a request to `GET /login` has a valid JWT cookie, the server returns a 302 redirect to `/`.

### Logout

- `POST /api/logout` clears the cookie:
  ```
  Set-Cookie: acp_relay_token=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/
  ```
- Returns `{ "ok": true }`
- Client-side: logout button in session picker header redirects to `/login` after calling this endpoint.

## Login Page

- **Route:** `GET /login`
- **File:** `ui/login/index.html` (+ `style.css`, `script.js`)
- **Design:** Centered card with password field and submit button. Dark theme matching session picker. Inline error message on failed login.
- **Behavior:** On submit, POST to `/api/login`. On success (cookie set by response), redirect to `/`. If already authenticated, `GET /login` redirects to `/`.

## Session Picker Changes

- **Logout button** in the top-right header area
- On click: POST to `/api/logout`, then redirect to `/login`
- No other changes — the session picker and ACP UI iframe work as before; the browser sends the auth cookie automatically on all requests including WebSocket upgrades.

## ACP UI Fork

**No changes required.** The auth cookie is an HttpOnly, Secure, SameSite=Strict cookie on the same origin. The browser sends it automatically on:
- HTTP requests for ACP UI static assets
- The WebSocket upgrade request (`wss://` to the same host)

ACP UI is unaware of auth. This was a key design goal — minimizing fork divergence.

## Files to Create/Modify

### New Files
- `src/auth.ts` — password hashing, JWT signing/verification, cookie parsing, auth middleware
- `ui/login/index.html` — login page markup
- `ui/login/style.css` — login page styles
- `ui/login/script.js` — login form submission logic

### Modified Files
- `src/cli.ts` — add `--set-password` option to `serve`, add interactive password prompt on first run
- `src/http-server.ts` — add auth middleware, login/logout endpoints, serve login page
- `src/ws-server.ts` — add cookie validation on WebSocket upgrade
- `src/relay.ts` — pass auth config through to HTTP and WS servers
- `ui/session-picker/index.html` — add logout button to header
- `ui/session-picker/script.js` — add logout handler
- `ui/session-picker/style.css` — style logout button
- `package.json` — add `bcryptjs` and `jsonwebtoken` dependencies

## New Dependencies

- `bcryptjs` — pure JS bcrypt implementation for password hashing
- `jsonwebtoken` — JWT signing and verification

## Security Considerations

- **HttpOnly cookie** prevents XSS from reading the token
- **Secure flag** ensures cookie only sent over HTTPS (already enforced by TLS)
- **SameSite=Strict** prevents CSRF
- **bcrypt** for password storage resists brute-force on the hash
- **JWT expiry** (7 days) limits window if a token is compromised
- **JWT secret regeneration** on password change invalidates all sessions
- Editor/daemon connections over Unix socket are not affected by web auth

## Env Var Override Details

When `ACP_RELAY_PASSWORD` is set:
- At startup, the env var value is hashed with bcrypt and held in memory. This hash is used for login comparison instead of the persisted one. This ensures consistent timing behavior (no timing side-channel from plaintext comparison).
- The persisted `auth.json` hash is ignored but not deleted.
- The persisted JWT secret is still used for signing — tokens remain valid across restarts as long as the same `auth.json` exists.
- If `auth.json` doesn't exist yet and the env var is set, the relay still creates `auth.json` with a JWT secret (but no password hash, since the env var is the source of truth). The interactive prompt is skipped.

## Verification

- Start relay without `auth.json` → prompted for password
- Open browser → redirected to `/login`
- Enter wrong password → error shown
- Enter correct password → redirected to session picker, cookie set
- Refresh page → still authenticated (cookie persists)
- Open ACP UI via session click → iframe loads, WebSocket connects (cookie sent automatically)
- Click logout → redirected to `/login`, cookie cleared
- Try to access `/` directly → redirected to `/login`
- Restart relay with `--set-password newpass` → existing browser sessions invalidated
- Restart relay with `ACP_RELAY_PASSWORD=override` → override password works, persisted one doesn't

# android-app

This directory is the Android shell project for ChatTrade.

## Boundary (important)
- `android-app/` should only contain Android container code (WebView, permissions, packaging, signing config).
- Business logic remains in the web root (`index.html`, `app.js`, `styles.css`, `server.js`).
- Do **not** duplicate web business code into `android-app/assets/www` unless you also update sync automation.

## Recommended mode
Load the deployed HTTPS web app URL in WebView so web and Android share one source of truth.

## Release checklist
1. Build Android shell.
2. Verify Android-specific behaviors (upload/camera/mic/IME/background-resume).
3. Record mapping: git commit -> Android versionCode/versionName.

# ChatTrade Android Native Shell

Android WebView wrapper for the ChatTrade web app, with native capabilities for:
- **Incoming call overlay** (WeChat-style full-screen call UI on lock screen)
- **EMAS push notifications** (Alibaba Cloud push for offline message/call delivery)
- **Foreground call service** (keeps app alive during active calls)
- **Native permissions** (camera, mic, location, file upload)
- **JS bridge** (H5 - Android native communication)

## Architecture

```
+---------------------------------------------+
|              Android Native Shell            |
|                                              |
|  +----------+  +-----------+  +----------+  |
|  | EMAS Push|  | Call      |  | WebView  |  |
|  | Receiver |  | Service   |  | + Bridge |  |
|  +----+-----+  +-----+-----+  +----+-----+  |
|       |              |              |        |
|  +----v--------------v--------------v-----+  |
|  |           NativeBridge (JS - Java)     |  |
|  +-----------------------------------------+ |
|                    |                          |
+--------------------+--------------------------+
                     |
         +-----------v------------+
         |    H5 Web App          |
         |  (index.html + app.js) |
         +------------------------+
```

## Boundary (important)
- `android-app/` should only contain Android container code (WebView, permissions, packaging, signing config).
- Business logic remains in the web root (`index.html`, `app.js`, `styles.css`, `server.js`).
- Do **not** duplicate web business code into `android-app/assets/www` unless you also update sync automation.

## Recommended mode
Load the deployed HTTPS web app URL in WebView so web and Android share one source of truth.

## Setup

### 1. Prerequisites
- Android Studio Hedgehog (2023.1.1) or newer
- JDK 11+
- Android SDK 34

### 2. Configure EMAS
Edit `app/build.gradle`, replace:
```groovy
manifestPlaceholders = [
    EMAS_APP_KEY   : "335676357",
    EMAS_APP_SECRET: "YOUR_APP_SECRET_HERE"
]
```

### 3. Configure Server URL
Edit `MainActivity.java`, set your server URL:
```java
private static final String WEB_URL = "https://your-server.com";
```

### 4. Build and Run
```bash
cd android-app
./gradlew assembleDebug
# APK at app/build/outputs/apk/debug/app-debug.apk
```

## JS Bridge API

H5 can call native methods via `window.NativeBridge`:

| Method | Description |
|--------|-------------|
| `bindPushAlias(userId)` | Bind push to current user (call after login) |
| `unbindPushAlias(userId)` | Unbind push (call on logout) |
| `startCallService(name, mode)` | Start foreground service during call |
| `stopCallService()` | Stop foreground service |
| `dismissCallNotification()` | Dismiss incoming call notification |
| `vibrate(ms)` | Trigger device vibration |
| `copyToClipboard(text)` | Copy text to clipboard |
| `getDeviceInfo()` | Get device info JSON |
| `hasOverlayPermission()` | Check overlay permission |
| `openSystemSettings()` | Open app settings |
| `getPushDeviceId()` | Get EMAS device ID |

### Detection
```javascript
if (window.__NATIVE_ANDROID__ && window.NativeBridge) {
  window.NativeBridge.vibrate(100);
}
```

## Server Push Integration

Set environment variables for EMAS push:
```
EMAS_APP_KEY=335676357
EMAS_APP_SECRET=your_secret
EMAS_REGION=cn-hangzhou
```

Push is sent automatically as fallback when `broadcastToUser()` finds no active SSE clients.

## Permissions

| Permission | Purpose |
|-----------|---------|
| INTERNET | WebView + API |
| CAMERA | Video calls + QR scan |
| RECORD_AUDIO | Voice/video calls |
| SYSTEM_ALERT_WINDOW | Incoming call overlay |
| USE_FULL_SCREEN_INTENT | Lock screen call display |
| FOREGROUND_SERVICE | Active call persistence |
| POST_NOTIFICATIONS | Push notifications |
| ACCESS_FINE_LOCATION | Nearby mall feature |
| VIBRATE | Incoming call vibration |

## Release checklist
1. Build Android shell.
2. Replace WEB_URL with production server.
3. Replace EMAS_APP_SECRET with real value.
4. Verify Android-specific behaviors (upload/camera/mic/IME/background-resume).
5. Test incoming call on lock screen and from background.
6. Record mapping: git commit -> Android versionCode/versionName.

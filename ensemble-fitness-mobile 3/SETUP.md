# Ensemble Fitness — iOS & Android app shell

This is Phase 1 of the mobile roadmap: the existing member-app pages wrapped
with Capacitor so they can be submitted to the App Store and Google Play as
a real, installable app — not a website.

## What's already done in this folder

- `www/` — a full copy of the member-app pages (feed, profile, music
  library, upload, journey, gear, fitness+, etc.), unchanged. Left out on
  purpose: `admin.html` (an internal tool, not something a consumer app
  should ship with — you can still reach it from a browser at
  app.ensemblefitness.com/admin.html exactly as today), and two dead/test
  pages (`community-preview.html`, `music-library-contain-test.html`) that
  nothing links to.
- `capacitor.config.json` — app ID (`com.ensemblefitness.app`), app name
  ("Ensemble Fitness"), and the dark splash/status-bar colors matching your
  site's own navy (#05070d).
- `resources/icon.png` — your 1024×1024 logo, exactly as you sent it.
- `resources/splash.png` / `resources/splash-dark.png` — a launch screen
  generated from your logo, centered on that same navy background.
- `package.json` — every Capacitor package this needs, pinned to version 7.

## What you need to run this (on your Mac, not in this chat)

Building and submitting an iOS app has always required a Mac with Xcode —
that's an Apple rule, not a limitation of this chat. Since you'll need
Xcode for the App Store submission either way, that's also the machine to
run these setup commands on. Android's half can be done from the same Mac
with Android Studio, or from any machine.

Install once: [Node.js](https://nodejs.org) (this project was built against
v22), [Xcode](https://apps.apple.com/us/app/xcode/id497799835) from the Mac
App Store, and [Android Studio](https://developer.android.com/studio).

Then, from inside this project folder:

```bash
npm install
npx cap add ios
npx cap add android
npx cap sync
```

`cap add` generates the real `ios/` and `android/` native project folders
(they're not included here since they're large, machine-generated, and
`cap add` needs to run where the Xcode/Android command-line tools actually
live).

### Generate every icon and splash size

```bash
npx @capacitor/assets generate --iconBackgroundColor '#05070d' --iconBackgroundColorDark '#05070d' --splashBackgroundColor '#05070d' --splashBackgroundColorDark '#05070d'
```

This reads `resources/icon.png` and `resources/splash*.png` and writes
every size both stores require (all the iOS `AppIcon.appiconset` slots, all
the Android `mipmap-*` densities) straight into the native projects.

### Open each project

```bash
npx cap open ios       # opens Xcode
npx cap open android   # opens Android Studio
```

From there it's a normal Xcode/Android Studio project — set your team/
signing in Xcode (your Apple Developer account is already active), and
you're ready for a TestFlight build.

## Permissions (Phase 1 checklist item)

The Upload page uses the camera, microphone (for the voice-narration
recorder), and photo library. Each store requires a plain-English reason
string, shown to the member the first time the app asks. Suggested wording
— matches Ensemble Fitness's own voice, adjust freely:

**iOS** — add to `ios/App/App/Info.plist` after `cap add ios` runs (or ask
me and I'll hand you the exact XML to paste in):

| Key | Suggested string |
|---|---|
| `NSCameraUsageDescription` | "Ensemble Fitness uses your camera so you can post photos and videos of your workouts and progress." |
| `NSMicrophoneUsageDescription` | "Ensemble Fitness uses your microphone so you can record a voice narration for your posts and tracks." |
| `NSPhotoLibraryUsageDescription` | "Ensemble Fitness needs access to your photos so you can choose one to post or use as your profile picture." |
| `NSPhotoLibraryAddUsageDescription` | "Ensemble Fitness can save photos and videos you create in the app back to your library." |

**Android** — add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
```

(Android 13+ uses the granular `READ_MEDIA_*` permissions above instead of
the old broad storage permission — nothing else to add.)

## What's next (Phase 2 of the roadmap)

- Swap the plain HTML file input on the Upload page for Capacitor's native
  Camera plugin (already listed in `package.json`), so choosing a photo
  feels native instead of opening the browser's file picker.
- Smooth over the brief reload when switching bottom-tab pages (feed →
  profile → music library are separate HTML documents, so each tab switch
  is a real page load right now). A cheap first pass: turn on the native
  splash screen's fade and keep it just long enough to mask the first
  load; a fuller fix later would mean rebuilding the shell as a true
  single-page app.
- Add the Fitness+ badge near Profile / the Stories rail.

Everything above is tracked in the roadmap page I published earlier:
https://claude.ai/artifact/DiV4KVQKWw9yLqUyw4sann

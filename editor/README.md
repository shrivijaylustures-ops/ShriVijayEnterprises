# SVE Website Editor

Adds and edits colours, photos, product categories and contact details without touching code. It saves
straight to GitHub, and the website rebuilds itself from there in about 2 minutes.

**One editor, three ways to open it.** It is a web page (`editor/ui`), published with the website at
**https://www.shrivijayenterprises.in/editor/**:

| Where | How |
| --- | --- |
| Windows (dad's computer) | Edge, installed as an app: own window, desktop icon, no .exe |
| Android phone | The **SVE Editor** app (APK, section 4) |
| Linux (Kartik) | `./editor/run-linux.sh`, or install it from Chrome like on Windows |

There is no Windows .exe any more. Microsoft Defender reported the old unsigned .exe as a virus. That was a
false alarm, but signing it costs money every year, and a web page installed from Edge needs no signing.

What it changes:

| In the editor | File |
| --- | --- |
| One list per category (Liquid gold, Lustre colours, ...) | `src/data/<category>.json` + photos in `src/assets/resources/<folder>/` |
| Categories and groups | `src/data/categories.json`: names, groups and their order, temperatures, texts, types, tile photo, shown or hidden |
| Gallery photos | `src/data/gallery.json` + photos in `src/assets/resources/gallery/` |
| Contact details | `src/data/site.json` |

A new category gets its own page at `/<id>` (for example `/glass-lined-pigments`), and appears in the Products
menu, on the Products page, on the home page, in the firing guide (if it has temperatures), in the sitemap and in
`llms.txt`. No code changes are needed. The home page hero and the page layouts are not editable.

## 1. Make a GitHub key (once)

The repository belongs to the personal account `shrivijaylustures-ops`. Fine-grained keys only work for
repositories of the account that makes them, so make it **while signed in as `shrivijaylustures-ops`**:

1. **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. Name: `SVE Website Editor`. Expiration: the longest allowed (set a reminder to renew it).
3. Resource owner: `shrivijaylustures-ops`. Repository access: **Only select repositories** > `ShriVijayEnterprises`.
4. Repository permissions: **Contents: Read and write**.
5. Generate, and copy the key. It is shown only once.

## 2. Windows: install it on dad's computer (once)

1. Open **Microsoft Edge** and go to `https://www.shrivijayenterprises.in/editor/`.
2. Paste the key and press **Check and save**. (Under *Website settings*: repository
   `shrivijaylustures-ops/ShriVijayEnterprises`, branch `redesign` while the site deploys from `redesign`, later `main`.)
3. Edge menu (**⋯**) > **Apps** > **Install this site as an app** > **Install**. Tick **Create desktop shortcut**
   (or use the **Install** button on the editor's *How to use* page).

From then on he opens **SVE Website Editor** from the desktop or the Start menu. It always loads the newest editor.
The key stays in that app's storage on his computer and is only sent to GitHub.

## 3. Using it

- Choose a category in the menu, press **Add a colour** (or click a colour to change it), fill in the form, add a photo, **Save**.
- **Categories and groups** (under *Set up*): add a category, rename or reorder groups, move categories with ↑ ↓,
  edit a category's name, short name, group, temperatures, texts, types and tile photo, or hide it from the website.
  A category can only be deleted while it has no products; the four original ones cannot be deleted.
- Press **Publish**, check the list, press **Publish now**. Every publish is one commit, so anything can be undone on GitHub.
- Unpublished changes stay on the device if the editor is closed. **Undo all** throws them away.
- **Practice mode** (link on the *How to use* page, or add `?practice` to the address) reads the real website and
  never changes it. Good for learning.
- Photos are only resized (to at most 2000 px) and saved as JPEG. Their colours are never adjusted: the photo's own
  colour profile is kept, and the editor tests check that the pixels come out the same.

## 4. Android app

### Install on dad's phone

1. Send him `SVE-Editor.apk` (WhatsApp as a *document*, Google Drive, or a cable).
2. He taps it. Android asks to allow installing from that app (WhatsApp, Files, ...): **Settings > Allow from this source**, then back, **Install**.
   Play Protect may say it does not recognise the app: **More details > Install anyway**. It is not from the Play Store, which is normal for a private app.
3. Open **SVE Editor**, paste the GitHub key once (send it separately, and delete the message after).

To update, send a newer APK and he taps **Update**. His key and unpublished changes stay.

### Build the APK (Kartik, on Linux)

Needs Node and the Android SDK (`ANDROID_HOME`), JDK 21. From `editor/android`:

```bash
npm install
npm run apk
```

The signed APK is copied to **`editor/android/SVE-Editor.apk`** (git-ignored). Before giving out a new
version, raise `versionCode` (and `versionName`) in `android/app/build.gradle`.

**The signing key** is in `editor/android/signing/` (`release.jks` and `keystore.properties`; git-ignored, never
committed), with a copy in `~/.config/sve-editor-android/`. Also back it up off this laptop (a private drive or USB). Android only installs an update if it is signed with the
same key: if the key is lost, dad has to uninstall the app and set it up again.

The app shows the same `editor/ui` files, bundled inside the APK (Capacitor). Edits to the editor reach the Android
app only with a new APK; the website's content does not need one.

## Problems

- **"Could not reach GitHub"**: no internet, or GitHub is down. Try again later; nothing is lost.
- **"GitHub did not accept the key"**: the key expired or was deleted. Make a new one (section 1), then press the
  gear icon (top right) > paste the new key > **Check and save**.
- **"The website was changed from somewhere else"**: press **Get latest and keep my changes**, check, publish again.
- **A photo will not load** (for example HEIC from an iPhone): save or share it as JPG first.

## For developers

```bash
./editor/run-linux.sh --practice        # the editor in a window, practice mode
node editor/tests/e2e.mjs               # full test against a fake GitHub (needs Playwright; PLAYWRIGHT_CORE=<path> if not installed)
```

- `ui/index.html`, `ui/app.css`, `ui/app.js`: the screens. `ui/backend.js`: GitHub API (one commit per publish via
  the Git Data API, conflict check by file version), photo preparation, checks before publishing, drafts
  (localStorage) and new photos (IndexedDB).
- `astro.config.mjs` copies `editor/ui` to `dist/editor/` on every build. `public/_headers` gives `/editor/*` a strict
  Content-Security-Policy (only GitHub may be contacted) and `noindex`; `robots.txt` disallows it.
- `tests/fake_github.py`: a stand-in for the GitHub API that serves and writes a folder.
- `android/`: the Capacitor project (`npm run sync` copies `ui/` into it).

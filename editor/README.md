# SVE Website Editor

A small Windows app for adding and editing colours, photos and a few website texts, without touching code.
It saves changes straight to GitHub (no git, no cloning), and the website rebuilds itself from there.

What it can change:

| Section in the app | File it edits |
| --- | --- |
| Ceramic & glass, Lustres, Gold & platinum, In-glaze | `src/data/{ceramic,luster,gold,inglaze}.json` + photos in `src/assets/resources/` |
| Gallery photos | `src/data/gallery.json` + photos in `src/assets/resources/gallery/` |
| Contact details | `src/data/site.json` (phones, WhatsApp, emails, hours, address) |
| Range descriptions | `src/data/ranges.json` (names, firing temperatures, descriptions, points, notes) |

The home page hero, page layouts and everything else stay as they are.

## 1. Get the .exe

GitHub builds it automatically whenever anything in `editor/` changes:

1. Open the repository on GitHub, go to **Actions**, then **Build website editor**.
2. Open the latest green run and download **SVE-Website-Editor** under *Artifacts*.
3. Unzip it. Inside is `SVE Website Editor.exe`.

## 2. Make a GitHub key (once)

1. On GitHub, signed in as an account that can push to the repository, go to
   **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. Name: `SVE Website Editor`. Expiration: the longest allowed (set a reminder to renew it).
3. Resource owner: the owner of the repository (`shrivijaylustures-ops`).
4. Repository access: **Only select repositories** > `ShriVijayEnterprises`.
5. Permissions > Repository permissions: **Contents: Read and write**. (Metadata: Read is added automatically.)
6. Generate, and copy the key. It is shown only once.

Which account should own the key?

- **On Cloudflare Pages** (recommended, see section 5): any account with write access, for example `shrivijaylustures-ops`.
- **While the site is still on Vercel's free plan**: it must be the account that owns the Vercel project, otherwise Vercel refuses to deploy the change.

## 3. Set it up on your dad's computer (once)

1. Copy `SVE Website Editor.exe` to his computer, for example into `Documents`.
2. Double-click it. Windows may say *"Windows protected your PC"* because the app is not signed:
   click **More info** > **Run anyway**. This happens once.
3. The setup screen opens. Paste the key. Under *Website settings*, check:
   - Repository: `shrivijaylustures-ops/ShriVijayEnterprises`
   - Branch: `main` (use `redesign` to try it out on the preview first)
   - Website address: `https://www.shrivijayenterprises.in`
4. Leave **Put an icon for the editor on the desktop** ticked and press **Check and save**.

From then on he double-clicks the desktop icon and the editor opens straight away. The key is encrypted with
his Windows login and never leaves his computer except to talk to GitHub.

## 4. How he uses it

- Pick a section on the left, press **Add a colour** (or click a colour to change it), fill in the form, add a photo, **Save**.
- Press **Publish changes**, check the list, press **Publish now**. The website updates in about 2 minutes,
  and the editor says when it is done.
- Unpublished changes are kept if the window is closed. **Undo all changes** throws them away.
- Photos are only resized (to at most 2000 px) and saved as JPEG. Colours are never adjusted.
- Every publish is one commit on GitHub, so any change can be undone from the commit history.

## 5. Moving hosting to Cloudflare Pages (free, no card)

Vercel's free plan only deploys commits made by the project owner, and is meant for non-commercial use.
Cloudflare Pages has neither limit. The site needs no changes for it (`_headers`, `.node-version` are already in the repo).

1. Create a free account at <https://dash.cloudflare.com/sign-up> (email and password; no card needed).
2. **Workers & Pages > Create > Pages > Connect to Git**, allow access to `ShriVijayEnterprises`.
3. Production branch: `main`. Framework preset: **Astro**. Build command: `npm run build`. Output directory: `dist`.
4. Save and deploy. Check the site at the `*.pages.dev` address it gives you.
5. Custom domain: in the Pages project, **Custom domains > Set up a domain** > `shrivijayenterprises.in` and
   `www.shrivijayenterprises.in`. Cloudflare asks to move the domain's nameservers to Cloudflare: change them
   at the place the domain was bought (it currently uses Vercel's nameservers, `ns1/ns2.vercel-dns.com`).
6. Once the site loads from Cloudflare, remove the domain from the Vercel project.

## Problems

- **"Could not reach GitHub"**: no internet, or GitHub is down. Try again later; nothing is lost.
- **"GitHub did not accept the key"**: the key expired or was deleted. Make a new one (section 2), then in the editor
  press the gear icon (top right) > paste the new key > **Check and save**.
- **"The website was changed from somewhere else"**: press **Get latest and keep my changes**, check, publish again.
- Log file: `%APPDATA%\SVE Website Editor\editor.log`. Unpublished draft: `%APPDATA%\SVE Website Editor\draft\`.

## For developers

```bash
pip install -r editor/requirements.txt
python editor/main.py                        # normal use (GitHub)
python editor/main.py --local . --no-window  # edit this folder instead of GitHub, print the address
python editor/main.py --self-test            # quick check used by the build
```

The app is a small Python web server bound to `127.0.0.1`, shown in an Edge app window. Every request needs the
random key in the window's address, so other web pages cannot use it. Code: `main.py` (start-up), `sve/server.py`
(API, publishing, validation), `sve/store.py` (GitHub and local folder), `sve/images.py`, `sve/config.py`, `ui/`.

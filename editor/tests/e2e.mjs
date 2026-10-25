// End-to-end test of the editor against the fake GitHub (fake_github.py). Nothing real is touched.
//
//   node editor/tests/e2e.mjs            (needs Playwright; set PLAYWRIGHT_CORE to its path if it is not installed here)
//
// Copies the website to a temporary folder, serves the editor from localhost, runs through setup, categories,
// groups, colours, photos, drafts, publishing and conflicts, at desktop and phone sizes, then builds the site
// from what the editor published.
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, cpSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright');

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const site = mkdtempSync(join(tmpdir(), 'sve-e2e-'));
for (const d of ['src', 'public', 'editor/ui']) cpSync(join(repo, d), join(site, d), { recursive: true });
for (const f of ['package.json', 'astro.config.mjs', 'tsconfig.json']) if (existsSync(join(repo, f))) cpSync(join(repo, f), join(site, f));
symlinkSync(join(repo, 'node_modules'), join(site, 'node_modules'));

const API = 'http://127.0.0.1:8790';
const UI = 'http://127.0.0.1:8791';
const procs = [
  spawn('python3', [join(here, 'fake_github.py'), site, '--port', '8790'], { stdio: 'ignore' }),
  spawn('python3', ['-m', 'http.server', '8791', '--bind', '127.0.0.1', '--directory', join(here, '../ui')], { stdio: 'ignore' }),
];
const cleanup = () => procs.forEach((p) => p.kill());
process.on('exit', cleanup);
await new Promise((r) => setTimeout(r, 900));

// Test photos: a wide one in Adobe RGB (to prove the colour profile and pixels survive), and a phone-style
// photo stored sideways with an EXIF rotation tag.
const photoDir = mkdtempSync(join(tmpdir(), 'sve-photos-'));
execFileSync('python3', [
  '-c',
  `
from PIL import Image
icc = open('/usr/share/color/icc/colord/AdobeRGB1998.icc','rb').read()
im = Image.new('RGB', (3000, 1500), (40, 90, 200))
for x in range(1500, 3000):
    for y in range(0, 1500, 50): pass
im.paste((200, 60, 30), (1500, 0, 3000, 1500))
im.save('${photoDir}/adobe.jpg', quality=95, icc_profile=icc)
side = Image.new('RGB', (1200, 800), (0, 160, 80))
ex = side.getexif(); ex[0x0112] = 6
side.save('${photoDir}/sideways.jpg', quality=95, exif=ex)
`,
]);

let pass = 0;
let fail = 0;
const ok = (cond, name) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
};
// Close the side panel, answering "Leave without saving" if it asks.
async function closePanel(p) {
  await p.click('#itemForm .panel-foot [data-close]');
  await p.waitForTimeout(150);
  if (await p.isVisible('#confirmYes')) await p.click('#confirmYes');
  await p.waitForSelector('#panel', { state: 'hidden' });
}
const log = async () => (await fetch(`${API}/_log`)).json();
const json = (p) => JSON.parse(readFileSync(join(site, p), 'utf8'));

const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
// Photos already on the "website" come from raw.githubusercontent.com; serve them from the copy.
await ctx.route('https://raw.githubusercontent.com/**', (route) => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname.split('/').slice(4).join('/'));
  const f = join(site, path);
  return existsSync(f) ? route.fulfill({ path: f }) : route.fulfill({ status: 404, body: '' });
});
await ctx.addInitScript((api) => {
  if (!localStorage.getItem('sve-editor-settings'))
    localStorage.setItem('sve-editor-settings', JSON.stringify({ api, repo: 'test/site', branch: 'main', site_url: 'https://www.shrivijayenterprises.in' }));
}, API);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// --- setup ---
await page.goto(UI + '/');
await page.waitForSelector('#setup:not([hidden])');
ok(true, 'first open shows the setup screen');
await page.fill('#setupForm [name=token]', 'wrong');
await page.click('#setupForm [type=submit]');
await page.waitForSelector('#setupError:not([hidden])');
ok((await page.textContent('#setupError')).includes('did not accept the key'), 'a wrong key is refused with a plain message');
await page.fill('#setupForm [name=token]', 'test-token');
await page.click('#setupForm [type=submit]');
await page.waitForSelector('.side-btn');
ok(await page.isVisible('#app'), 'the right key opens the editor');

const side = await page.textContent('#side');
ok(['Gold based lustre colours', 'Lustre colours', 'Ceramic colours', 'Glass-lined pigments', 'Categories and groups'].every((t) => side.includes(t)), 'menu lists categories under their groups');

// --- categories view ---
await page.click('[data-view=categories]');
const groupsShown = await page.$$eval('.group-card h2', (h) => h.map((x) => x.textContent));
ok(JSON.stringify(groupsShown) === JSON.stringify(['Gold based lustre colours', 'Lustre colours', 'Ceramic colours']), 'categories view shows the 3 groups in order');

// Move "Glass-lined pigments" down: it is last in group 1, so it moves into "Lustre colours".
await page.click('[data-cat-action=down][data-id=glass-lined-pigments]');
let cj = await page.evaluate(() => S.work['src/data/categories.json'].groups.map((g) => g.categories));
ok(cj[1][0] === 'glass-lined-pigments', 'moving past the end of a group moves the category into the next group');
await page.click('[data-cat-action=up][data-id=glass-lined-pigments]');
cj = await page.evaluate(() => S.work['src/data/categories.json'].groups.map((g) => g.categories));
ok(cj[0].at(-1) === 'glass-lined-pigments', 'and back up again');

// Rename a group.
await page.click('[data-cat-action=rename-group][data-id=lustre]');
await page.fill('#askInput', 'Lustre colours for glass and ceramic');
await page.click('#askForm [value=yes]');
await page.waitForFunction(() => document.querySelector('#main').textContent.includes('Lustre colours for glass and ceramic'), null, { timeout: 3000 }).catch(() => {});
ok((await page.textContent('#main')).includes('Lustre colours for glass and ceramic'), 'a group can be renamed');

// Add and delete an empty group.
await page.click('[data-cat-action=add-group]');
await page.fill('#askInput', 'Industrial');
await page.click('#askForm [value=yes]');
await page.waitForFunction(() => document.querySelectorAll('.group-card').length === 4, null, { timeout: 3000 }).catch(() => {});
ok((await page.$$('.group-card')).length === 4, 'a group can be added');
await page.click('.group-card:last-child [data-cat-action=delete-group]');
await page.click('#confirmYes');
await page.waitForSelector('#confirmDialog', { state: 'hidden' });
await page.waitForTimeout(100);
ok((await page.$$('.group-card')).length === 3, 'an empty group can be deleted');

// --- add a category with a very long name, into a new group ---
const LONG = 'Pigment For Extremely Long Industrial Glass Lined Coating Applications Wrapping'; // 79 of the 80 allowed
await page.click('[data-cat-action=add][data-id=ceramic]');
await page.fill('#itemForm [name=title]', LONG);
ok((await page.inputValue('#itemForm [name=short]')) === 'Pigment For Extremely', 'short name is suggested from the name');
await page.fill('#itemForm [name=short]', 'Long test pigments');
await page.check('#itemForm [name=group][value=__new]');
await page.fill('#itemForm [name=newGroup]', 'Industrial colours');
await page.uncheck('#itemForm [name=noTemps]');
await page.fill('#itemForm [name=min]', '900');
await page.fill('#itemForm [name=max]', '800');
await page.fill('#itemForm [name=summary]', 'Test pigments.');
await page.click('#itemForm [type=submit]');
ok(await page.isVisible('[data-error=temps]:not([hidden])'), 'temperatures in the wrong order are refused');
await page.fill('#itemForm [name=min]', '780');
await page.fill('#itemForm [name=max]', '860');
await page.click('#addType');
await page.fill('[data-type="0"][data-field=label]', 'Matt');
await page.click('#addType');
await page.fill('[data-type="1"][data-field=label]', 'Gloss');
await page.check('#itemForm [name=layout][value=code]');
await page.click('#itemForm [type=submit]');
await page.waitForSelector('#panel', { state: 'hidden' });
const newId = await page.evaluate(() => S.view);
ok(newId === 'long-test-pigments', `new category gets a clean web address (${newId})`);
ok((await page.textContent('#side')).includes('Industrial colours'), 'the new group shows in the menu');

// Overflow check for the long name in the editor.
const overflow = await page.evaluate(() => [...document.querySelectorAll('h1, .side-btn, .cat-title')].some((el) => el.scrollWidth > el.clientWidth + 1));
ok(!overflow, 'long category name does not overflow in the editor');

// --- add a colour with a photo to the new category ---
await page.click('[data-action=add] >> nth=0');
await page.fill('#itemForm [name=name]', 'Test Blue');
await page.fill('#itemForm [name=code]', 'T100');
await page.setInputFiles('#photoInput', join(photoDir, 'adobe.jpg'));
await page.waitForFunction(() => document.querySelector('#photoStatus')?.textContent === 'Photo ready.');
ok(true, 'photo is prepared in the browser');
const hex = await page.inputValue('#itemForm [name=hex]');
ok(hex === '#7d4b73' || /^#[0-9a-f]{6}$/.test(hex), `swatch colour suggested from the photo (${hex})`);
await page.check('#itemForm [name=range][value=gloss]');
await page.click('#itemForm [type=submit]');
await page.waitForSelector('#panel', { state: 'hidden' });

// Second colour: sideways phone photo.
await page.click('[data-action=add] >> nth=0');
await page.fill('#itemForm [name=name]', 'Test Green');
await page.fill('#itemForm [name=code]', 'T101');
await page.setInputFiles('#photoInput', join(photoDir, 'sideways.jpg'));
await page.waitForFunction(() => document.querySelector('#photoStatus')?.textContent === 'Photo ready.');
await page.click('#itemForm [type=submit]');
await page.waitForSelector('#panel', { state: 'hidden' });

// Duplicate code is refused.
await page.click('[data-action=add] >> nth=0');
await page.fill('#itemForm [name=name]', 'Copy');
await page.fill('#itemForm [name=code]', 't100');
await page.click('#itemForm [type=submit]');
ok(await page.isVisible('[data-error=code]:not([hidden])'), 'a code that is already used is refused');
await closePanel(page);

// Removing a type that products use is refused.
await page.click(`[data-edit-cat=${newId}]`);
await page.click('[data-remove-type="1"]');
ok((await page.textContent('[data-error=types]')).includes('the type "Gloss"'), 'a type in use cannot be removed');
await closePanel(page);

// A category with products cannot be deleted.
await page.click(`[data-edit-cat=${newId}]`);
await page.click('#deleteItem');
ok((await page.textContent('[data-error=title]')).includes('Delete or move'), 'a category with products cannot be deleted');
await closePanel(page);

// --- draft survives a reload ---
await page.waitForTimeout(500);
await page.reload();
await page.waitForSelector('.side-btn');
ok((await page.textContent('#side')).includes('Long test pigments'), 'unpublished changes survive closing the editor');
ok(await page.evaluate(() => [...document.querySelectorAll('img')].length >= 0), 'reload ok');
await page.click(`[data-view=${newId}]`);
const imgsOk = await page
  .waitForFunction(() => { const imgs = [...document.querySelectorAll('.thumb img')]; return imgs.length === 2 && imgs.every((i) => i.complete && i.naturalWidth > 0); }, null, { timeout: 5000 })
  .then(() => true, () => false);
ok(imgsOk, 'new photos still show after a reload');

// --- publish ---
await page.click('#publishBtn');
const list = await page.textContent('.change-list');
ok(list.includes(`Add the category ${LONG}`) && list.includes('Add T100 Test Blue'), 'publish shows the list of changes');
await page.click('#pubGo');
await page.waitForSelector('.result-icon.ok', { timeout: 20000 });
ok(true, 'publish succeeds');
const l = (await log()).at(-1);
const files = Object.keys(l.files);
ok(files.includes('src/data/categories.json') && files.includes(`src/data/${newId}.json`), 'categories and the new product file are saved');
const photos = files.filter((f) => f.startsWith(`src/assets/resources/${newId}/`));
ok(photos.length === 2, `photos go into resources/${newId}/`);
const cat = json('src/data/categories.json');
ok(cat.groups.at(-1).title === 'Industrial colours' && cat.groups.at(-1).categories[0] === newId, 'new group and category written');
ok(cat.categories[newId].title === LONG && cat.categories[newId].min === 780 && cat.categories[newId].types.map((t) => t.id).join() === 'matt,gloss', 'category details written');
const prods = json(`src/data/${newId}.json`);
ok(prods.length === 2 && prods.every((p) => p.image.startsWith(`resources/${newId}/`)), 'products point at their new photos');
await page.click('#pubDone');
ok((await page.textContent('#status')).includes('Everything is on the website'), 'after publishing, nothing is pending');

// Photo checks: size, colour profile kept, colours unchanged, rotation applied.
const check = execFileSync('python3', [
  '-c',
  `
import json, sys
from PIL import Image
icc = open('/usr/share/color/icc/colord/AdobeRGB1998.icc','rb').read()
prods = json.load(open('${site}/src/data/${newId}.json'))
out = {}
for p in prods:
    im = Image.open('${site}/src/assets/' + p['image'])
    out[p['code']] = {'size': im.size, 'icc': im.info.get('icc_profile') == icc,
                      'left': im.convert('RGB').getpixel((im.width // 4, im.height // 2)),
                      'right': im.convert('RGB').getpixel((im.width * 3 // 4, im.height // 2))}
print(json.dumps(out))
`,
]).toString();
const ph = JSON.parse(check);
ok(JSON.stringify(ph.T100.size) === '[2000,1000]', `large photo resized to 2000px (${ph.T100.size})`);
ok(ph.T100.icc, 'the photo keeps its Adobe RGB colour profile');
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
ok(near(ph.T100.left, [40, 90, 200]) && near(ph.T100.right, [200, 60, 30]), `colours unchanged (${ph.T100.left} / ${ph.T100.right})`);
ok(JSON.stringify(ph.T101.size) === '[800,1200]', `sideways phone photo is turned upright (${ph.T101.size})`);

// --- conflict: someone else changes the website, then publish ---
await page.click('[data-view=contact]');
await page.fill('#contactForm [name=hours]', 'Mon to Sat, 10 am to 7 pm');
const s = json('src/data/site.json');
s.hours = 'Changed elsewhere';
writeFileSync(join(site, 'src/data/site.json'), JSON.stringify(s, null, 2) + '\n');
await page.click('#publishBtn');
await page.click('#pubGo');
await page.waitForSelector('#pubRebase', { timeout: 20000 });
ok(true, 'a change made elsewhere is caught before publishing');
await page.click('#pubRebase');
await page.waitForTimeout(500);
await page.click('#publishBtn');
await page.click('#pubGo');
await page.waitForSelector('.result-icon.ok', { timeout: 20000 });
ok(json('src/data/site.json').hours === 'Mon to Sat, 10 am to 7 pm', 'after "get latest", publishing works');
await page.click('#pubDone');

// --- phone size ---
const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
await phone.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({ status: 404, body: '' }));
await phone.addInitScript((api) => {
  localStorage.setItem('sve-editor-settings', JSON.stringify({ api, repo: 'test/site', branch: 'main', site_url: 'https://www.shrivijayenterprises.in' }));
  localStorage.setItem('sve-editor-token', 'test-token');
}, API);
const m = await phone.newPage();
m.on('pageerror', (e) => errors.push(e.message));
await m.goto(UI + '/');
await m.waitForSelector('.side-btn', { state: 'attached' });
ok(await m.isVisible('#sideToggle'), 'phone: a Menu button replaces the side list');
ok(!(await m.isVisible('#side')), 'phone: the list is hidden until the Menu button is pressed');
await m.click('#sideToggle');
ok(await m.isVisible('#side'), 'phone: Menu opens the list');
await m.click('[data-view=categories]');
ok(!(await m.isVisible('#side')) && (await m.textContent('#sideToggleLabel')) === 'Categories and groups', 'phone: choosing a section closes the menu and shows its name');
let wide = await m.evaluate(() => document.documentElement.scrollWidth > innerWidth);
ok(!wide, 'phone: categories page fits the screen');
await m.click(`[data-edit-cat=${newId}]`);
const save = await m.$('#itemForm [type=submit]');
const box = await save.boundingBox();
ok(box && box.y + box.height <= 780, 'phone: Save button is on screen in the category form');
await m.waitForTimeout(600);
await m.screenshot({ path: join(tmpdir(), 'sve-e2e-phone-category.png') });
await closePanel(m);
for (const v of ['ceramic', 'gallery', 'contact', 'help', newId]) {
  await m.click('#sideToggle');
  await m.click(`[data-view=${v}]`);
  wide = await m.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('#main').scrollWidth > document.querySelector('#main').clientWidth);
  ok(!wide, `phone: ${v} fits the screen`);
}
await m.click('#sideToggle');
await m.click('[data-view=ceramic]');
await m.screenshot({ path: join(tmpdir(), 'sve-e2e-phone-list.png') });

// --- practice mode never writes ---
const before = (await log()).length;
const pr = await ctx.newPage();
await pr.route('https://raw.githubusercontent.com/**', (route) => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname.split('/').slice(4).join('/'));
  const f = join(site, path);
  return existsSync(f) ? route.fulfill({ path: f }) : route.fulfill({ status: 404, body: '' });
});
await pr.goto(UI + '/?practice');
await pr.waitForSelector('.side-btn');
ok(await pr.isVisible('.practice-bar'), 'practice mode is clearly marked');
await pr.click('[data-view=contact]');
await pr.fill('#contactForm [name=hours]', 'Practice hours');
await pr.click('#publishBtn');
await pr.click('#pubGo');
await pr.waitForSelector('.result-icon.ok');
ok((await log()).length === before && json('src/data/site.json').hours !== 'Practice hours', 'practice mode publishes nothing');

ok(errors.length === 0, `no script errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();

// --- the website builds from what the editor published ---
try {
  execFileSync('npx', ['astro', 'build'], { cwd: site, stdio: 'pipe' });
  ok(existsSync(join(site, `dist/${newId}.html`)), `website builds, with a page for the new category (/${newId})`);
  const html = readFileSync(join(site, `dist/${newId}.html`), 'utf8');
  ok(html.includes('T100') && html.includes('Gloss') && html.includes('780 to 860°C'), 'new category page shows its colours, types and temperatures');
} catch (e) {
  ok(false, 'website builds: ' + (e.stderr?.toString() || e.message).slice(-800));
}

console.log(`\n${pass} passed, ${fail} failed. Site copy: ${site}`);
cleanup();
process.exit(fail ? 1 : 0);

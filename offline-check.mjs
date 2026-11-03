import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

// 1. online: login, load app so the service worker installs
await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
await page.type('input[autocomplete="username"]', 'operator');
await page.type('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await new Promise(r => setTimeout(r, 2500)); // SW install + ref-data cache
await page.goto('http://localhost:3000/operator/entry', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1200));

// 2. kill the network completely
const cdp = await page.createCDPSession();
await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });

// 3. reload while offline - app shell must come from the service worker cache
await page.reload({ waitUntil: 'domcontentloaded' }).catch(e => console.log('reload err', e.message));
await new Promise(r => setTimeout(r, 1500));
const offlineText = await page.evaluate(() => document.body.innerText.slice(0, 200));
console.log('OFFLINE PAGE LOADS:', offlineText.includes('शेतकरी') ? 'YES' : 'NO -> ' + JSON.stringify(offlineText));

// 4. complete an entry fully offline
await page.goto('http://localhost:3000/operator/entry', { waitUntil: 'domcontentloaded' }).catch(() => {});
await new Promise(r => setTimeout(r, 1500));
await page.type('.field input', 'Mohan');
await new Promise(r => setTimeout(r, 400));
const found = await page.$('.list-item');
console.log('FARMER CACHE OFFLINE:', found ? 'YES' : 'NO');
if (found) {
  await found.click();
  await new Promise(r => setTimeout(r, 400));
  const choices = await page.$$('.choice');
  await choices[1].click(); // tur
  await new Promise(r => setTimeout(r, 600));
  let btns = await page.$$('.btn.primary');
  await btns[btns.length - 1].click();
  await new Promise(r => setTimeout(r, 400));
  const inputs = await page.$$('.field input');
  await inputs[0].type('640.0'); await inputs[1].type('10.0'); await inputs[2].type('10.0');
  await new Promise(r => setTimeout(r, 400));
  btns = await page.$$('.btn.primary');
  await btns[btns.length - 1].click();
  await new Promise(r => setTimeout(r, 400));
  btns = await page.$$('.btn.primary');
  await btns[btns.length - 1].click();
  await new Promise(r => setTimeout(r, 2000));
  const doneText = await page.evaluate(() => document.body.innerText);
  console.log('OFFLINE SAVE:', doneText.includes('फोनवर सेव्ह झाले') || doneText.includes('Saved on the phone') ? 'YES - queued offline' : 'UNEXPECTED: ' + doneText.slice(0, 150));
  globalThis.savedUuid = await page.evaluate(() => new Promise((res) => {
    const rq = indexedDB.open('fpc-offline', 1);
    rq.onsuccess = () => {
      const db = rq.result;
      const tx = db.transaction('outbox').objectStore('outbox').getAll();
      tx.onsuccess = () => { const all = tx.result; res(all.length ? all[all.length-1].uuid : null); };
    };
  }));
  console.log('OFFLINE ENTRY UUID:', globalThis.savedUuid);
  await page.screenshot({ path: '/tmp/shots/12-offline-save.png' });
}

// 5. back online: entry must sync and get an official slip number
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await page.goto('http://localhost:3000/operator/outbox', { waitUntil: 'networkidle0' }).catch(() => {});
await new Promise(r => setTimeout(r, 1200));
const syncBtn = await page.$('.big-btn');
if (syncBtn) { await syncBtn.click(); }
await new Promise(r => setTimeout(r, 2500));
const outText = await page.evaluate(() => document.body.innerText);
const sentInfo = await page.evaluate(() => new Promise((res) => {
  const rq = indexedDB.open('fpc-offline', 1);
  rq.onsuccess = () => {
    const db = rq.result;
    const tx = db.transaction('sent').objectStore('sent').getAll();
    tx.onsuccess = () => { const all = tx.result; const e = all[all.length-1]; res(e ? { uuid: e.uuid, slipNo: e.slipNo, status: e.status } : null); };
  };
}));
console.log('SENT ENTRY:', JSON.stringify(sentInfo));
console.log('SAME UUID ROUNDTRIP:', sentInfo && sentInfo.uuid === globalThis.savedUuid ? 'YES' : 'NO');
const m = outText.match(/C\d\d-\d{5}/);
console.log('SYNCED SLIP NO:', m ? m[0] : 'NONE');
console.log('OUTBOX CARD SHOWS NET+AMOUNT:', outText.includes('630.0') && outText.includes('45,360.00') ? 'YES' : 'NO -> ' + outText.slice(0, 300));
await page.screenshot({ path: '/tmp/shots/13-after-sync.png' });
await browser.close();

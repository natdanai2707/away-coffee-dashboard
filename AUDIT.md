# Full Codebase Audit — Away Coffee & Co. Dashboard (สาขา 5)

**วันที่ audit:** 2026-07-16
**ขอบเขต:** ทั้ง repository — มีไฟล์เดียวคือ `index.html` (932 บรรทัด) เป็น static dashboard ที่ใช้ Chart.js + SheetJS จาก CDN, ข้อมูล hardcode ใน JS และมีปุ่ม Refresh ที่ fetch ข้อมูลจริงจาก `http://systemenu.com/away/rp.php`

> หมายเหตุ: โปรเจกต์นี้ไม่มี React, Supabase, database หรือ API route ของตัวเอง ดังนั้นหัวข้อ SQL injection, RLS, useEffect dependency ฯลฯ ไม่ apply — ประเด็นที่เทียบเคียงได้ (XSS, data validation, race condition, async) ตรวจครบแล้ว

---

## 1. Bugs และ Correctness

### 1.1 [High] `XLSX` อาจยังไม่ถูกโหลดตอนกด Refresh — `index.html:868`, `index.html:925-927`
SheetJS ถูกโหลดแบบ async ด้วยการ append `<script>` ตอน boot โดยไม่มีการเช็คว่าโหลดเสร็จหรือโหลดพัง ถ้าผู้ใช้กด Refresh ก่อนสคริปต์มา (หรือ CDN ล่ม) จะได้ `ReferenceError: XLSX is not defined` ทันที
**วิธีแก้:** เช็คก่อนใช้ และดัก error ตอนโหลด:
```js
const sheetJsReady = new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload = resolve;
  s.onerror = () => reject(new Error('โหลด SheetJS ไม่สำเร็จ'));
  document.head.appendChild(s);
});
// ใน refreshData(): await sheetJsReady;
```

### 1.2 [High] Race condition ในการดึงรายงาน — `index.html:858-864`
Flow คือ POST ไป `rp.php` (ไม่เช็คผลลัพธ์เลยว่าสำเร็จไหม) → รอ 900ms แบบ fix → GET `rp.xlsx` ปัญหา:
- ถ้า server generate ไฟล์ช้ากว่า 900ms จะได้ **ไฟล์เก่าของเดือนก่อนหน้า** มาแสดงเป็นเดือนปัจจุบันแบบเงียบๆ (ข้อมูลผิดโดยไม่มี error)
- `rp.xlsx` เป็นไฟล์เดียวใช้ร่วมกันบน server → ถ้ามีผู้ใช้ 2 คนกด Refresh พร้อมกัน ไฟล์จะถูกเขียนทับสลับกัน ได้ข้อมูลมั่ว
- ถ้า POST fail (`!res.ok`) โค้ดยังเดินต่อไปอ่านไฟล์เก่าอยู่ดี

**วิธีแก้ระยะสั้น:** เช็ค `res.ok` ของ POST, poll จนกว่าไฟล์จะอัปเดตจริง (เทียบ timestamp/ETag) แทน sleep คงที่ **วิธีแก้ที่ถูกต้อง:** ให้ server ตอบ JSON กลับมาจาก request เดียวเลย (ดูข้อ 6.2)

### 1.3 [High] Heuristic `findB` ทำข้อมูลหายเงียบๆ ถ้ายอดต่ำกว่า ฿10,000 — `index.html:871`
```js
const findB = l => { const r=rows.find(r=>r[0]===l&&typeof r[1]==='number'&&r[1]>10000); ... };
```
ใช้เงื่อนไข "มูลค่า > 10000" แยกแถวบาทออกจากแถวจำนวนชิ้น ถ้าเดือนไหนหมวดใดขายได้ ≤ ฿10,000 (เช่น ของฝากหรือ delivery เดือนเงียบ) จะได้ `null` → ยอดหายจากกราฟและตารางรวม โดยไม่มี warning ใดๆ
**วิธีแก้:** อย่าแยกด้วยขนาดตัวเลข ให้แยกด้วยคอลัมน์หน่วย (`r[2]==='บาท'`) แบบเดียวกับที่ทำกับ `beverages_qty` (`r[2]==='แก้ว'`) อยู่แล้ว

### 1.4 [High] `Object.assign` เอา `null` ทับข้อมูลดีๆ — `index.html:900-906`
`find()`/`findB()` คืน `null` ได้บ่อย (parse ไม่เจอ) แล้ว `Object.assign(DATA[key], fresh)` จะเอา `null` ไปทับค่า hardcode ที่ถูกต้องอยู่แล้ว ทำให้กด Refresh แล้วข้อมูลบางช่องกลายเป็น `—` หรือกราฟหาย
**วิธีแก้:** กรอง null ก่อน merge:
```js
const clean = Object.fromEntries(Object.entries(fresh).filter(([,v]) => v != null));
Object.assign(DATA[key], clean);
```

### 1.5 [Medium] ไม่เช็ค `res.ok` และไม่เช็คว่า sheet มีจริง — `index.html:864-869`
ถ้า `rp.xlsx` ตอบ 404/500 (ได้ HTML error page) `XLSX.read` จะ throw ด้วย error ที่อ่านไม่รู้เรื่อง และ `wb.Sheets['รายได้ต่อวัน']` อาจเป็น `undefined` → `sheet_to_json` crash
**วิธีแก้:** `if (!res.ok) throw new Error(...)` และ `if (!wb.Sheets['รายได้ต่อวัน']) throw new Error('ไม่พบชีท รายได้ต่อวัน')`

### 1.6 [Medium] `Math.round(null)` ได้ `0` — avgBill ผิดแบบเงียบ — `index.html:874`
`Math.round(find('ยอดใช้จ่ายเฉลี่ยต่อบิลที่สำเร็จ'))` — ถ้า `find` คืน `null` ผลคือ `0` (ไม่ใช่ `null`) แล้ว 0 จะถูก merge ทับค่าจริง (หลุดตัวกรองข้อ 1.4 ด้วยเพราะไม่ใช่ null)
**วิธีแก้:** `const v = find(...); avgBill: v == null ? null : Math.round(v)`

### 1.7 [Medium] KPI "เฉลี่ย/บิล" คำนวณผิดหลักคณิตศาสตร์ — `index.html:408`
```js
const avgAvg = Math.round(MONTHS.reduce((s,m)=>s+(DATA[m].avgBill||0),0)/MONTHS.length);
```
เป็น "ค่าเฉลี่ยของค่าเฉลี่ย" ไม่ได้ถ่วงน้ำหนักตามจำนวนบิล (แต่ละเดือนบิลไม่เท่ากัน + เม.ย. เป็นครึ่งเดือน) ค่าเฉลี่ยต่อบิล YTD ที่ถูกต้องคือ:
```js
const avgAvg = Math.round(ytdRev / ytdBill);
```

### 1.8 [Medium] ข้อมูล `refund` เท่ากับ `male` ทุกเดือน — น่าจะ parse ผิดแถว — `index.html:346,356,366,376`
Jan: refund=909=male, Feb: 660=660, Mar: 863=863, Apr: 492=492 — ตรงกัน 4/4 เดือนไม่น่าใช่บังเอิญ แปลว่า `find('Refund / Error')` (บรรทัด 889) น่าจะ match ผิดแถวใน xlsx แล้วค่า hardcode ก็สืบทอดบั๊กนี้มา (ตอนนี้ `refund` ยังไม่ถูกแสดงผล เลยยังไม่เห็นผลกระทบ แต่เป็นระเบิดเวลา)
**วิธีแก้:** เปิดไฟล์ xlsx จริงตรวจ label ของแถว Refund แล้วแก้เงื่อนไข match

### 1.9 [Medium] วันที่ "วันนี้" ใช้ UTC ไม่ใช่เวลาไทย — `index.html:896`
`new Date().toISOString().split('T')[0]` ให้วันที่ตาม UTC — ช่วง 00:00–07:00 น. เวลาไทยจะได้วันที่ของ "เมื่อวาน" ทำให้ขอบเขตข้อมูลเดือนปัจจุบันขาดไป 1 วัน
**วิธีแก้:**
```js
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
```

### 1.10 [Medium] ถ้า Chart.js CDN ล่ม ทั้งหน้าพังเงียบ — `index.html:7`, `index.html:929`
`renderDashboard()` ตอน boot ไม่มี try/catch — ถ้า `Chart` undefined จะ throw กลาง `buildRevenueChart()` ทำให้กราฟและตารางทั้งหมดไม่ render โดยผู้ใช้เห็นแค่หน้าโล่งๆ
**วิธีแก้:** เช็ค `typeof Chart !== 'undefined'` ก่อน หรือมี local fallback + แสดงข้อความ error ให้ผู้ใช้เห็น

### 1.11 [Low] Delivery doughnut ไม่กัน null ฝั่ง `grab_thb` — `index.html:621`
`DATA[m].grab_thb + (DATA[m].lineman_thb||0)` — กัน null เฉพาะ lineman ถ้า grab_thb เป็น null (หลัง refresh ที่ parse พลาด) จะได้ `NaN` ในกราฟ ควรเป็น `(DATA[m].grab_thb||0) + (DATA[m].lineman_thb||0)`

### 1.12 [Low] Tooltip crash ได้ถ้า data เป็น null — `index.html:480,518,549` และจุดอื่น
`ctx.raw.toLocaleString('th-TH')` — ถ้าค่าใน dataset เป็น null (เกิดได้จากข้อ 1.3/1.4) การ hover จะ throw ควรใช้ `(ctx.raw ?? 0).toLocaleString(...)` หรือ format helper กลาง

### 1.13 [Low] หารศูนย์ในแถวรวม Ice Cream — `index.html:816`
`Math.round(tThb/tQty)` — ถ้า `tQty` เป็น 0 ได้ `NaN`/`Infinity` (แถวรายเดือนกันไว้แล้วที่บรรทัด 800 แต่แถวรวมไม่ได้กัน)

### 1.14 [Low] ใช้ truthiness เช็คตัวเลข ทำให้รายได้ 0 ถูกมองว่า "ไม่มีข้อมูล" — `index.html:414-415`
`febRev && janRev ? ... : null` — ถ้าเดือนไหนรายได้เป็น 0 จริงๆ MoM% จะไม่แสดงทั้งที่ควรแสดง -100% ควรเช็ค `!= null` แทน

### 1.15 [Low] Label ปีพุทธศักราชผิดและไม่สอดคล้อง — `index.html:339` เทียบ `349,359,369`
Jan เขียน `"ม.ค. 66"` เดือนอื่นเขียน `"69"` — ปี ค.ศ. 2026 คือ พ.ศ. **2569** ทั้งหมด (field นี้เป็น dead code ด้วย — ดูข้อ 5.3)

---

## 2. Security

### 2.1 [Critical] Endpoint ข้อมูลยอดขายไม่มี authentication เลย — `index.html:858,864`
`http://systemenu.com/away/rp.php` รับแค่ `posid` + ช่วงวันที่ ไม่มี token/credential ใดๆ — **ใครก็ตามที่เห็น repo นี้ (หรือ view-source หน้า dashboard) สามารถดึงข้อมูลรายได้จริงของทุกสาขาได้** (เปลี่ยน posid เป็นเลขอื่นได้ด้วย) นี่คือช่องโหว่ authorization ที่ร้ายแรงที่สุดในระบบ
**วิธีแก้:** ใส่ authentication ที่ฝั่ง server (API key/session) และให้ dashboard เรียกผ่าน backend proxy ที่เก็บ credential ไว้ server-side (ดูข้อ 6.2) — แก้ที่ client อย่างเดียวไม่ได้

### 2.2 [High] ใช้ HTTP ไม่ใช่ HTTPS — ข้อมูลธุรกิจวิ่ง plaintext + Refresh พังบน HTTPS hosting — `index.html:858,864`
- ข้อมูลรายได้ถูกส่งผ่าน HTTP ไม่เข้ารหัส ดักฟัง/แก้ไขกลางทางได้
- ถ้า deploy dashboard บน HTTPS (เช่น GitHub Pages) browser จะ **block mixed content ทันที** — ปุ่ม Refresh จะไม่มีวันทำงาน และถึงเป็น HTTP ก็ยังติด CORS ถ้า server ไม่ส่ง `Access-Control-Allow-Origin`
**วิธีแก้:** เปิด HTTPS ที่ systemenu.com หรือ (ดีกว่า) proxy ผ่าน backend ของตัวเอง

### 2.3 [Medium] ความเสี่ยง XSS จากข้อมูลภายนอกที่ยัดเข้า `innerHTML` — `index.html:437-443,699-712,796-805`
ค่าที่ parse จาก xlsx (มาจาก server ภายนอก) ถูก interpolate เข้า template string แล้วเซ็ตด้วย `innerHTML` โดยไม่ escape — `find()` คืนค่า `r[1]` ได้ทุก type รวมถึง string ถ้า server ถูก compromise หรือมี cell เป็นข้อความ จะฉีด HTML/script เข้าหน้าได้
**วิธีแก้:** บังคับ type ตอน parse (`typeof v === 'number' ? v : null`) และ/หรือใช้ escape helper ก่อนใส่ innerHTML

### 2.4 [Medium] โหลดสคริปต์จาก CDN โดยไม่มี Subresource Integrity — `index.html:7,926`
ถ้า cdnjs ถูก compromise สคริปต์อันตรายจะรันในหน้าทันที ควรใส่ `integrity="sha384-..." crossorigin="anonymous"` ทั้ง Chart.js และ SheetJS

### 2.5 [Medium] ข้อมูลรายได้จริงถูก hardcode ใน source code — `index.html:337-386`
ตัวเลขรายได้/จำนวนลูกค้ารายเดือนอยู่ใน repo — ถ้า repo เป็น public เท่ากับเปิดเผยข้อมูลธุรกิจภายในสู่สาธารณะ ควรตรวจ visibility ของ repo และย้ายข้อมูลไปโหลดจาก endpoint ที่มี auth แทน

*(SQL injection / Supabase RLS / server-side env — ไม่ apply: ไม่มี database, backend หรือ env variable ในโปรเจกต์)*

---

## 3. Performance

### 3.1 [Medium] แปลง binary → string → base64 → parse โดยไม่จำเป็น — `index.html:866-868`
```js
let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
const wb = XLSX.read(btoa(bin),{type:'base64'});
```
String concat ทีละ byte เป็น O(n²) ในบาง engine และ btoa/base64 เพิ่มงานอีกชั้นฟรีๆ — SheetJS อ่าน ArrayBuffer ตรงๆ ได้:
```js
const wb = XLSX.read(buf, {type:'array'});
```

### 3.2 [Medium] Refresh ใช้เวลา 6-7 วินาทีขึ้นไปเพราะ fetch ทีละเดือน + sleep 900ms×4 — `index.html:893-897`
4 เดือน = 8 requests + 3.6s sleep ขั้นต่ำ ที่ parallel ไม่ได้เพราะ server ใช้ไฟล์ `rp.xlsx` ไฟล์เดียวร่วมกัน (ข้อ 1.2) — ต้องแก้ฝั่ง API ให้ตอบ JSON ต่อ request แล้วค่อยยิง `Promise.all` ทั้ง 4 เดือนพร้อมกัน

### 3.3 [Low] SheetJS full bundle (~900KB) ถูกโหลดทุกครั้งที่เปิดหน้า — `index.html:926`
ทั้งที่ใช้เฉพาะตอนกด Refresh ควร lazy-load ตอนกดปุ่มครั้งแรกแทน (ยิ่งจำเป็นเมื่อ Refresh ใช้งานจริงไม่ได้อยู่แล้วจากข้อ 2.2)

### 3.4 [Low] Chart.js ใน `<head>` แบบ blocking — `index.html:7`
ไม่มี `defer` ทำให้ block การ render หน้าแรก ควรใส่ `defer` แล้วเรียก `renderDashboard()` หลัง `DOMContentLoaded`

### 3.5 [Low] Refresh destroy/สร้างกราฟใหม่ทั้งหมด — `index.html:398-401,828-840`
ใช้ `chart.data.datasets[..].data = ...; chart.update()` จะลื่นกว่าและไม่กระพริบ (ที่ scale นี้ยอมรับได้ แต่เป็น pattern ที่ควรรู้)

---

## 4. Design และ UX

### 4.1 [Medium] แจ้ง error ด้วย `alert()` — `index.html:910`
Alert หยุดทั้งหน้าและดูไม่เป็นมิตร ควรแสดง error banner/toast ในหน้า พร้อมปุ่ม retry และเก็บ `console.error(e)` ไว้ debug

### 4.2 [Medium] ปุ่ม Refresh กดซ้ำได้ระหว่างโหลด — `index.html:222,851-914`
ไม่มีการ disable ปุ่มตอนกำลัง fetch — กดรัวๆ จะยิง refresh ซ้อนกันหลายชุด (ซ้ำเติม race condition ข้อ 1.2) ควร `btn.disabled = true` + เปลี่ยน label เป็น "กำลังโหลด..." ใน try และคืนค่าใน finally

### 4.3 [Medium] ตาราง Ice Cream ไม่มี wrapper `overflow-x` — ล้นจอมือถือ — `index.html:314-317`
ตาราง detail มี `<div style="overflow-x:auto">` ครอบ (บรรทัด 322) แต่ตาราง Ice Cream 8 คอลัมน์ไม่มี → บนมือถือตารางจะดันความกว้างทั้งหน้าจนเลย์เอาต์พัง ควรครอบด้วย wrapper แบบเดียวกัน

### 4.4 [Medium] Accessibility หลายจุด
- `index.html:239` และ canvas ทุกตัว: ไม่มี `role="img"` + `aria-label` — screen reader ไม่รู้เลยว่ากราฟแสดงอะไร
- `index.html:600-603` แถบสัดส่วนชาย/หญิงแยกกันด้วยสีล้วนๆ (ฟ้า/ชมพู) — ผู้ใช้ตาบอดสีแยกไม่ได้ (มี % เป็น text ช่วยอยู่ ควรคง pattern/ขอบไว้ด้วย)
- `index.html:201` loading overlay ไม่มี `role="status"` / `aria-live="polite"` — screen reader ไม่รู้ว่ากำลังโหลด
- `index.html:53-64` ปุ่ม Refresh ไม่มี `:focus-visible` style — ผู้ใช้คีย์บอร์ดมองไม่เห็น focus

### 4.5 [Low] Doughnut chart ใช้แสดงข้อมูลรายเดือน (time series) — `index.html:614-635`
"Delivery Revenue รายเดือน" เป็นข้อมูลตามเวลา ใช้ donut แล้วอ่านแนวโน้มไม่ได้ ควรเป็น bar/line ให้สอดคล้องกับกราฟอื่นในหน้า

### 4.6 [Low] เครื่องหมาย `*` ของ เม.ย. ไม่มีคำอธิบายใกล้กราฟ — `index.html:389`
มีอธิบายแค่ใน KPI badge ("ข้อมูลบางส่วน") ควรมี footnote "* ข้อมูล 1–15 เม.ย." ใต้กราฟ/ตารางที่ใช้ label นี้ด้วย

### 4.7 [Low] ตัวอักษร .7rem uppercase สี `--subtext` บนพื้น cream — `index.html:69-73,96-99`
ขนาดเล็กมากและ contrast อยู่แถวๆ เส้น 4.5:1 พอดี ควรขยับขึ้นเป็น ≥ .75rem หรือเข้มสีขึ้นเล็กน้อย

*(จุดที่ทำได้ดีอยู่แล้ว: มี loading overlay, มี `lang="th"`, responsive breakpoint 900px ใช้งานได้, ค่า null แสดง '—' แทนที่จะพัง)*

---

## 5. Code Quality และ Maintainability

### 5.1 [Medium] Magic numbers/strings กระจายทั่ว
- `900` (ms sleep) — `index.html:863`
- `10000` (threshold แยกแถวบาท) — `index.html:871`
- `'5'` (posid สาขา) — `index.html:857`
- `'http://systemenu.com/away/...'` ซ้ำ 2 จุด — `index.html:858,864`
ควรรวมเป็น config block เดียว: `const CONFIG = { POS_ID:'5', API_BASE:'...', REPORT_DELAY_MS:900 }`

### 5.2 [Low] โค้ดซ้ำหลายจุด
- `tagClass`/`tagLabel` ประกาศซ้ำ 2 ที่ — `index.html:694-695` และ `791-792`
- Logic เติม `totalBills` จากผลรวมซ้ำ 2 ที่ — `index.html:902-905` และ `918-922`
- Options ของ Chart (tooltip callback, scales, legend) copy-paste ทุกกราฟ — ควรมี `baseChartOptions()` + format helper กลาง

### 5.3 [Low] Dead code / ข้อมูลที่ไม่ถูกใช้
- `DATA[m].period`, `DATA[m].label` ไม่ถูกอ่านที่ไหนเลย (ใช้ `LABELS` แทน) — `index.html:339` เป็นต้น
- `memberTopup`, `refund` ถูก fetch และเก็บแต่ไม่เคยแสดงผล — `index.html:889`
- `MONTHS.map(m=>LABELS[MONTHS.indexOf(m)])` = แค่ `LABELS` เฉยๆ — `index.html:619`
- ฟิลด์ `delivery` ใน `ICE_CREAM` เป็น 0 ทุกเดือนและไม่ถูกแสดง — `index.html:382-385`

### 5.4 [Low] Comment ชวนเข้าใจผิด — `index.html:335`
`// DATA (fetched live — update via Refresh btn)` — จริงๆ เป็น snapshot hardcode และปุ่ม Refresh ใช้งานจริงไม่ได้จากข้อ 2.2 ควรระบุวันที่ของ snapshot ไว้แทน

### 5.5 [Low] Error handling บางเบา — `index.html:909-911`
catch เดียวครอบทั้ง 4 เดือน (เดือนแรก fail = ทิ้งหมด), ไม่มี `console.error`, ผล POST ถูกทิ้งโดยไม่ตรวจ ควรแยก per-month error + log

### 5.6 [Low] ไฟล์เดียว 932 บรรทัดรวม CSS/HTML/JS
ที่ scale ปัจจุบันยังจัดการได้ แต่ถ้าจะโตต่อ (หลายสาขา หลายหน้า) ควรแยกเป็น `styles.css` / `app.js` / `data.js` เป็นอย่างน้อย

---

## 6. Architecture และ Improvement

### 6.1 [High] Dashboard ค้างอยู่ที่ ม.ค.–เม.ย. 2026 ทั้งที่ตอนนี้ ก.ค. 2026 แล้ว
`MONTHS`, `LABELS`, `DATA`, และ `fetchMonth(...)` ทั้ง 4 ครั้ง hardcode เดือนไว้ตายตัว (`index.html:388-389,893-897`) — พ.ค./มิ.ย./ก.ค. ไม่มีทางโผล่ในหน้าเลยไม่ว่ากด Refresh กี่ครั้ง ควร generate รายการเดือนจากวันที่ปัจจุบัน:
```js
function monthsOfYear(year) {
  const now = new Date();
  return Array.from({length: now.getMonth()+1}, (_, i) => ({
    from: `${year}-${String(i+1).padStart(2,'0')}-01`,
    to:   /* วันสุดท้ายของเดือน หรือวันนี้ถ้าเป็นเดือนปัจจุบัน */
  }));
}
```

### 6.2 [High] ควรมี backend proxy เล็กๆ คั่นกลาง (แก้ปัญหา 5 ข้อในครั้งเดียว)
ทำ serverless function (Cloudflare Worker / Vercel function) ที่: เรียก systemenu ด้วย credential ที่เก็บ server-side → parse xlsx ฝั่ง server → cache → ตอบ JSON ผ่าน HTTPS
สิ่งที่หายไปทันที: ปัญหา no-auth (2.1), HTTP/mixed content/CORS (2.2), ความเสี่ยง XSS จาก xlsx (2.3), race condition ไฟล์ร่วม (1.2), และ refresh ช้า (3.2)

### 6.3 [Medium] สัญญา (contract) กับ server ผูกกับ display string ภาษาไทยเป๊ะๆ — `index.html:870-890`
Parsing match ข้อความอย่าง `'เบเกอร์รี่ (Bakeries)'`, `'ซื้อผ่าน Application (delivery)'` ตรงตัวอักษร — server แก้ typo คำเดียว dashboard พังเงียบทั้งแผง ควรขอ structured export (JSON/CSV ที่มี key คงที่) หรืออย่างน้อยรวม label ทั้งหมดเป็น constant เดียวพร้อม validation ที่ fail ดังๆ ("ไม่พบแถว X")

### 6.4 [Medium] ไม่มี test เลยแม้แต่ไฟล์เดียว
จุดที่คุ้มค่าที่สุดที่ควรมี unit test:
1. Logic parse xlsx (`find`, `findB`, การ map แถว) — พัง = ข้อมูลผิดทั้ง dashboard และเป็นจุดที่มีบั๊กจริงอยู่แล้ว (ข้อ 1.3, 1.8)
2. Logic merge ข้อมูล (`Object.assign` + null filter — ข้อ 1.4)
3. การคำนวณ KPI (YTD, MoM%, weighted average — ข้อ 1.7)
ทำได้โดยแยกฟังก์ชันเหล่านี้เป็น pure function ในไฟล์ JS แยก แล้วใช้ Vitest + fixture xlsx จริงสัก 1 ไฟล์

### 6.5 [Low] เก็บผล fetch ล่าสุดลง `localStorage` พร้อม timestamp
ตอนนี้ refresh เสร็จ ปิดหน้า = ข้อมูลหาย กลับไปเป็น snapshot hardcode — ควร persist และแสดง "ข้อมูล ณ วันที่..." ให้ชัด

### 6.6 [Low] ตรึง dependency ด้วย npm + bundler แทน CDN
ย้ายไป Vite เล็กๆ จะได้ pin เวอร์ชัน Chart.js/SheetJS, ได้ tree-shaking, ตัดความเสี่ยง CDN ล่ม/SRI ไปในตัว

---

## สรุปภาพรวม

| หมวด | Critical | High | Medium | Low |
|---|---|---|---|---|
| 1. Bugs & Correctness | – | 4 | 6 | 5 |
| 2. Security | 1 | 1 | 3 | – |
| 3. Performance | – | – | 2 | 3 |
| 4. Design & UX | – | – | 4 | 3 |
| 5. Code Quality | – | – | 1 | 5 |
| 6. Architecture | – | 2 | 2 | 2 |

**3 เรื่องที่ควรทำก่อนเพื่อน:**
1. **ปิดช่องโหว่ endpoint ไม่มี auth (2.1)** — ข้อมูลรายได้ทุกสาขาเปิดให้ใครก็ดึงได้อยู่ตอนนี้
2. **ทำ backend proxy + HTTPS (6.2)** — เพราะปุ่ม Refresh ในสภาพปัจจุบันใช้งานจริงบน HTTPS ไม่ได้เลย และแก้ปัญหา security/race หลายข้อพร้อมกัน
3. **ทำเดือนให้ dynamic (6.1)** — dashboard ขาดข้อมูล 3 เดือนล่าสุดอยู่ ณ วันนี้

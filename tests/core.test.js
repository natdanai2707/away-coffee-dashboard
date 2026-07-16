// Unit tests สำหรับ core.js — รันด้วย `npm test` (node --test, ไม่ต้องติดตั้ง dependency)
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

// fixture เลียนแบบชีท 'รายได้ต่อวัน' — แถวเป็น [label, value, unit]
const ROWS = [
  ['รายได้', 855895],
  ['จำนวนบิลทั้งหมด', 4600],
  ['ยอดใช้จ่ายเฉลี่ยต่อบิลที่สำเร็จ', 186.4],
  ['ลูกค้าชาย', 909],
  ['ลูกค้าหญิง', 3691],
  ['เครื่องดื่ม (Beverages)', 7267, 'แก้ว'],
  ['เครื่องดื่ม (Beverages)', 578545, 'บาท'],
  ['เบเกอร์รี่ (Bakeries)', 1926, 'ชิ้น'],
  ['เบเกอร์รี่ (Bakeries)', 232265, 'บาท'],
  ['สินค้าซื้อฝาก (Sourvenirs)', 4555, 'บาท'],        // ต่ำกว่า 10,000 — heuristic เดิม (findB) จะทำค่านี้หาย
  ['กินในร้าน (Dine-in)', 1598, 'บิล'],
  ['กินในร้าน (Dine-in)', 349287, 'บาท'],
  ['ซื้อกลับ (take-away)', 2747, 'บิล'],
  ['ซื้อกลับ (take-away)', 454358, 'บาท'],
  ['ซื้อผ่าน Application (delivery)', 255, 'บิล'],
  ['ซื้อผ่าน Application (delivery)', 9500, 'บาท'],   // ต่ำกว่า 10,000 เช่นกัน
  ['- Grab', 9350],
  ['- Line Man', 150]
];

test('parseMonthRows: อ่านค่าบาทจากคอลัมน์หน่วย แม้ยอดต่ำกว่า 10,000', () => {
  const { data, missing } = C.parseMonthRows(ROWS);
  assert.equal(data.souvenirs_thb, 4555);
  assert.equal(data.delivery_thb, 9500);
  assert.equal(data.beverages_thb, 578545);
  assert.equal(data.beverages_qty, 7267);
  assert.equal(data.dineIn_bills, 1598);
  assert.equal(data.totalRevenue, 855895);
  assert.equal(data.avgBill, 186); // ปัดเศษจาก 186.4
  assert.deepEqual(missing, []);
});

test('parseMonthRows: แถวที่หาไม่เจอถูกรายงานใน missing และค่าเป็น null (ไม่ใช่ 0)', () => {
  const { data, missing } = C.parseMonthRows([['รายได้', 1000]]);
  assert.equal(data.totalRevenue, 1000);
  assert.equal(data.male, null);
  assert.equal(data.avgBill, null); // เดิม Math.round(null) ให้ 0 แบบเงียบๆ
  assert.ok(missing.includes('ลูกค้าชาย'));
});

test('parseMonthRows: ค่า string จากภายนอก (อาจถูกฉีดมา) ถูกทิ้งเป็น null', () => {
  const { data } = C.parseMonthRows([['รายได้', '<img src=x onerror=alert(1)>']]);
  assert.equal(data.totalRevenue, null);
});

test('mergeMonthData: null ไม่ทับค่าเดิม และเติม totalBills จากผลรวมช่องทาง', () => {
  const merged = C.mergeMonthData(
    { totalRevenue: 500, avgBill: 100 },
    { totalRevenue: null, avgBill: 120, dineIn_bills: 10, takeaway_bills: 5, delivery_bills: 1, totalBills: null }
  );
  assert.equal(merged.totalRevenue, 500); // null จากการ parse พลาด ต้องไม่ลบข้อมูลดี
  assert.equal(merged.avgBill, 120);
  assert.equal(merged.totalBills, 16);
});

test('computeKpis: เฉลี่ย/บิลเป็น weighted average และทนเดือนที่ไม่มีข้อมูล', () => {
  const DATA = {
    Jan: { totalRevenue: 1000, totalBills: 10, male: 3, female: 7 },
    Feb: { totalRevenue: 3000, totalBills: 10, male: 4, female: 6 }
  };
  const k = C.computeKpis(DATA, ['Jan', 'Feb', 'Mar']); // Mar ไม่มีข้อมูล ต้องไม่พัง
  assert.equal(k.ytdRev, 4000);
  assert.equal(k.ytdBill, 20);
  assert.equal(k.ytdCust, 20);
  assert.equal(k.avgPerBill, 200); // ไม่ใช่ average-of-averages (100+300)/2 = 200 โดยบังเอิญ? ไม่ — (1000+3000)/20
});

test('computeKpis: ไม่มีบิลเลย → avgPerBill เป็น null ไม่ใช่ Infinity', () => {
  assert.equal(C.computeKpis({}, ['Jan']).avgPerBill, null);
});

test('momPercent: เช็ค null ตรงๆ — รายได้ 0 ให้ -100%, ฐานเป็น 0/null ให้ null', () => {
  assert.equal(C.momPercent(100, 0), -100);
  assert.equal(C.momPercent(100, 150), 50);
  assert.equal(C.momPercent(null, 100), null);
  assert.equal(C.momPercent(100, null), null);
  assert.equal(C.momPercent(0, 100), null);
});

test('monthsUpTo: กลางเดือน = เดือนปัจจุบัน partial, to = วันนี้, label มี *', () => {
  const months = C.monthsUpTo(2026, '2026-07-16');
  assert.equal(months.length, 7);
  const jul = months[6];
  assert.equal(jul.key, 'Jul');
  assert.equal(jul.partial, true);
  assert.equal(jul.to, '2026-07-16');
  assert.equal(jul.label, 'ก.ค.*');
  assert.equal(months[0].from, '2026-01-01');
  assert.equal(months[0].to, '2026-01-31');
  assert.equal(months[1].to, '2026-02-28'); // 2026 ไม่ใช่ปีอธิกสุรทิน
  assert.equal(months[3].partial, false);
});

test('monthsUpTo: วันสิ้นเดือนพอดีไม่นับ partial / ปีอื่นให้ 12 หรือ 0 เดือน', () => {
  const months = C.monthsUpTo(2026, '2026-01-31');
  assert.equal(months.length, 1);
  assert.equal(months[0].partial, false);
  assert.equal(months[0].label, 'ม.ค.');
  assert.equal(C.monthsUpTo(2026, '2027-03-01').length, 12);
  assert.equal(C.monthsUpTo(2026, '2025-12-31').length, 0);
});

test('fmt/fmtB: กัน null / undefined / NaN — แสดง — แทนการ crash', () => {
  assert.equal(C.fmt(null), '—');
  assert.equal(C.fmt(undefined), '—');
  assert.equal(C.fmt(NaN), '—');
  assert.equal(C.fmtB(null), '—');
  assert.equal(C.fmtB(1234), '฿' + (1234).toLocaleString('th-TH'));
});

test('escapeHtml: escape อักขระอันตรายครบ', () => {
  assert.equal(
    C.escapeHtml('<b>"x" & \'y\'</b>'),
    '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;'
  );
});

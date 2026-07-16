/*
 * core.js — pure logic ของ dashboard (ไม่แตะ DOM)
 * โหลดใน browser ผ่าน <script> (expose เป็น window.DashboardCore)
 * และโหลดใน Node สำหรับ unit test ผ่าน require('./core.js')
 */
(function (global) {
  'use strict';

  const MONTH_KEYS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

  // label ของแถวในชีท 'รายได้ต่อวัน' — รวมไว้ที่เดียว ถ้า server เปลี่ยนข้อความให้แก้ที่นี่
  const ROW_LABELS = {
    totalBills: 'จำนวนบิลทั้งหมด',
    avgBill:    'ยอดใช้จ่ายเฉลี่ยต่อบิลที่สำเร็จ',
    male:       'ลูกค้าชาย',
    female:     'ลูกค้าหญิง',
    beverages:  'เครื่องดื่ม (Beverages)',
    bakeries:   'เบเกอร์รี่ (Bakeries)',
    souvenirs:  'สินค้าซื้อฝาก (Sourvenirs)',
    dineIn:     'กินในร้าน (Dine-in)',
    takeaway:   'ซื้อกลับ (take-away)',
    delivery:   'ซื้อผ่าน Application (delivery)',
    revenue:    'รายได้',
    grab:       '- Grab',
    lineman:    '- Line Man'
  };

  const QTY_UNITS = ['แก้ว', 'ชิ้น', 'บิล'];

  // รับเฉพาะตัวเลขจริงจากข้อมูลภายนอก — string/อ็อบเจกต์ถูกทิ้งตั้งแต่ชั้น parse
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;

  const escapeHtml = v => String(v).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmt  = n => (typeof n === 'number' && isFinite(n)) ? n.toLocaleString('th-TH') : '—';
  const fmtB = n => (typeof n === 'number' && isFinite(n)) ? '฿' + n.toLocaleString('th-TH') : '—';

  /**
   * แปลง rows (array-of-arrays จาก sheet_to_json {header:1}) เป็นข้อมูลรายเดือน
   * แถวมูลค่าเงินแยกด้วยคอลัมน์หน่วย (r[2] === 'บาท') ไม่ใช่ขนาดตัวเลข
   * คืน { data, missing } — missing คือรายชื่อแถวที่หาไม่เจอ เพื่อให้ fail แบบมีเสียง
   */
  function parseMonthRows(rows) {
    const missing = [];
    const rowsOf = label => rows.filter(r => Array.isArray(r) && r[0] === label);
    const track = (name, v) => { if (v == null) missing.push(name); return v; };

    const plain = label => {
      const r = rowsOf(label).find(r => num(r[1]) != null);
      return track(label, r ? num(r[1]) : null);
    };
    const baht = label => {
      const candidates = rowsOf(label);
      const r = candidates.find(r => r[2] === 'บาท')
        || candidates.find(r => !QTY_UNITS.includes(r[2]) && num(r[1]) != null);
      return track(label + ' (บาท)', r ? num(r[1]) : null);
    };
    const withUnit = (label, unit) => {
      const r = rowsOf(label).find(r => r[2] === unit);
      return track(label + ' (' + unit + ')', r ? num(r[1]) : null);
    };

    const avgRaw = plain(ROW_LABELS.avgBill);
    const data = {
      totalBills:     plain(ROW_LABELS.totalBills),
      avgBill:        avgRaw == null ? null : Math.round(avgRaw),
      male:           plain(ROW_LABELS.male),
      female:         plain(ROW_LABELS.female),
      beverages_qty:  withUnit(ROW_LABELS.beverages, 'แก้ว'),
      bakeries_qty:   withUnit(ROW_LABELS.bakeries, 'ชิ้น'),
      beverages_thb:  baht(ROW_LABELS.beverages),
      bakeries_thb:   baht(ROW_LABELS.bakeries),
      souvenirs_thb:  baht(ROW_LABELS.souvenirs),
      dineIn_bills:   withUnit(ROW_LABELS.dineIn, 'บิล'),
      takeaway_bills: withUnit(ROW_LABELS.takeaway, 'บิล'),
      delivery_bills: withUnit(ROW_LABELS.delivery, 'บิล'),
      dineIn_thb:     baht(ROW_LABELS.dineIn),
      takeaway_thb:   baht(ROW_LABELS.takeaway),
      delivery_thb:   baht(ROW_LABELS.delivery),
      totalRevenue:   plain(ROW_LABELS.revenue),
      grab_thb:       plain(ROW_LABELS.grab),
      lineman_thb:    plain(ROW_LABELS.lineman)
    };
    return { data, missing: [...new Set(missing)] };
  }

  /**
   * merge ข้อมูลที่ดึงมาใหม่ทับของเดิม โดยไม่ให้ null (parse ไม่เจอ) ทับค่าที่มีอยู่
   * และเติม totalBills จากผลรวมช่องทางถ้ายังไม่มี
   */
  function mergeMonthData(existing, fresh) {
    const merged = Object.assign({}, existing);
    for (const [k, v] of Object.entries(fresh || {})) {
      if (v != null) merged[k] = v;
    }
    return fillTotalBills(merged);
  }

  function fillTotalBills(d) {
    if (!d.totalBills) {
      const sum = (d.dineIn_bills || 0) + (d.takeaway_bills || 0) + (d.delivery_bills || 0);
      if (sum > 0) d.totalBills = sum;
    }
    return d;
  }

  /** KPI รวม YTD — ค่าเฉลี่ย/บิลเป็น weighted average (รายได้รวม ÷ บิลรวม) */
  function computeKpis(DATA, monthKeys) {
    const sum = k => monthKeys.reduce(
      (s, m) => s + ((DATA[m] && typeof DATA[m][k] === 'number') ? DATA[m][k] : 0), 0);
    const ytdRev  = sum('totalRevenue');
    const ytdBill = sum('totalBills');
    return {
      ytdRev,
      ytdBill,
      ytdCust: sum('male') + sum('female'),
      avgPerBill: ytdBill > 0 ? Math.round(ytdRev / ytdBill) : null
    };
  }

  /** % เปลี่ยนแปลงเทียบเดือนก่อน — เช็ค null ตรงๆ ไม่ใช้ truthiness (รายได้ 0 = -100% ไม่ใช่ "ไม่มีข้อมูล") */
  function momPercent(prev, curr) {
    if (prev == null || curr == null || prev === 0) return null;
    return (curr - prev) / prev * 100;
  }

  /**
   * สร้างรายการเดือนของปีที่กำหนด ตั้งแต่ ม.ค. จนถึงเดือนของ todayStr ('YYYY-MM-DD' เวลาไทย)
   * เดือนปัจจุบันที่ยังไม่จบเดือนจะติดธง partial และ label มีเครื่องหมาย *
   */
  function monthsUpTo(year, todayStr) {
    const [ty, tm, td] = String(todayStr).split('-').map(Number);
    const count = ty > year ? 12 : (ty < year ? 0 : tm);
    const out = [];
    for (let i = 1; i <= count; i++) {
      const lastDay = new Date(Date.UTC(year, i, 0)).getUTCDate();
      const isCurrent = ty === year && i === tm;
      const partial = isCurrent && td < lastDay;
      const mm = String(i).padStart(2, '0');
      out.push({
        key: MONTH_KEYS[i - 1],
        thaiName: THAI_MONTHS[i - 1],
        label: THAI_MONTHS[i - 1] + (partial ? '*' : ''),
        from: year + '-' + mm + '-01',
        to: isCurrent ? String(todayStr) : year + '-' + mm + '-' + String(lastDay).padStart(2, '0'),
        partial
      });
    }
    return out;
  }

  const DashboardCore = {
    MONTH_KEYS, THAI_MONTHS, ROW_LABELS,
    num, escapeHtml, fmt, fmtB,
    parseMonthRows, mergeMonthData, fillTotalBills,
    computeKpis, momPercent, monthsUpTo
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DashboardCore;
  global.DashboardCore = DashboardCore;
})(typeof window !== 'undefined' ? window : globalThis);

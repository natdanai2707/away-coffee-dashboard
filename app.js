/*
 * app.js — การ render DOM, กราฟ และ flow การ Refresh
 * logic ที่ไม่แตะ DOM ทั้งหมดอยู่ใน core.js (มี unit test ใน tests/)
 */
(function () {
  'use strict';

  const C = window.DashboardCore;
  const { fmt, fmtB, escapeHtml } = C;

  // ── CONFIG ────────────────────────────────────
  // หมายเหตุความปลอดภัย (AUDIT.md ข้อ 2.1, 2.2): endpoint นี้เป็น HTTP และไม่มี authentication
  // ต้องแก้ที่ฝั่ง server — ทางที่แนะนำคือ backend proxy ที่ parse xlsx แล้วตอบ JSON ผ่าน HTTPS (ข้อ 6.2)
  // ตราบใดที่หน้านี้ถูก host บน HTTPS ปุ่ม Refresh จะถูก browser block (mixed content)
  const CONFIG = {
    POS_ID: '5',
    API_BASE: 'http://systemenu.com/away',
    SHEET_NAME: 'รายได้ต่อวัน',
    REPORT_WAIT_MS: 900,   // เวลารอ server สร้างไฟล์รายงานต่อรอบ ก่อนลองอ่าน
    REPORT_RETRIES: 3,     // จำนวนรอบที่ลองอ่านไฟล์รายงานก่อนยอมแพ้
    YEAR: 2026,
    SHEETJS_URL: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  };

  const SNAPSHOT_LABEL = 'ข้อมูล snapshot ณ 15 เม.ย. 2569 — กด Refresh เพื่ออัปเดต';

  // ── DATA: snapshot จาก systemenu.com ณ 15 เม.ย. 2026 ──
  // ใช้เป็นค่าเริ่มต้นก่อนกด Refresh — เดือนที่ไม่มีในนี้จะแสดง '—' จนกว่าจะ refresh สำเร็จ
  // (ฟิลด์ memberTopup/refund เดิมถูกตัดออก: ไม่ถูกแสดงผล และค่า refund เดิม parse ผิดแถว — AUDIT.md ข้อ 1.8)
  const DATA = {
    Jan: {
      totalBills: 4600, avgBill: 186, male: 909, female: 3691,
      beverages_qty: 7267, bakeries_qty: 1926,
      beverages_thb: 578545, bakeries_thb: 232265, souvenirs_thb: 44555,
      dineIn_bills: 1598, takeaway_bills: 2747, delivery_bills: 255,
      dineIn_thb: 349287, takeaway_thb: 454358, delivery_thb: 52250,
      totalRevenue: 855895, grab_thb: 52100, lineman_thb: 150
    },
    Feb: {
      totalBills: 3919, avgBill: 185, male: 660, female: 3259,
      beverages_qty: 6165, bakeries_qty: 1703,
      beverages_thb: 490310, bakeries_thb: 201760, souvenirs_thb: 33383,
      dineIn_bills: 1320, takeaway_bills: 2339, delivery_bills: 260,
      dineIn_thb: 291044, takeaway_thb: 382914, delivery_thb: 51930,
      totalRevenue: 725888, grab_thb: 51930, lineman_thb: 0
    },
    Mar: {
      totalBills: 4221, avgBill: 179, male: 863, female: 3356,
      beverages_qty: 6657, bakeries_qty: 1585,
      beverages_thb: 524190, bakeries_thb: 190620, souvenirs_thb: 42315,
      dineIn_bills: 1193, takeaway_bills: 2611, delivery_bills: 417,
      dineIn_thb: 261938, takeaway_thb: 414717, delivery_thb: 79975,
      totalRevenue: 756630, grab_thb: 79975, lineman_thb: 0
    },
    Apr: {
      totalBills: 2317, avgBill: 185, male: 492, female: 1825,
      beverages_qty: 3770, bakeries_qty: 882,
      beverages_thb: 296490, bakeries_thb: 104460, souvenirs_thb: 28993,
      dineIn_bills: 607, takeaway_bills: 1395, delivery_bills: 315,
      dineIn_thb: 144322, takeaway_thb: 224371, delivery_thb: 60075,
      totalRevenue: 428768, grab_thb: 60075, lineman_thb: 0
    }
  };

  // Ice Cream Studio Scoop — snapshot ณ 15 เม.ย. 2026
  // (report อัตโนมัติยังไม่มีข้อมูลส่วนนี้ — ต้องอัปเดตด้วยมือ, มี footnote แจ้งในหน้า)
  const ICE_CREAM = {
    Jan: { qty: 505, thb: 39895, dineIn: 165, takeaway: 219, male: 320, female: 64 },
    Feb: { qty: 377, thb: 29783, dineIn: 127, takeaway: 148, male: 239, female: 36 },
    Mar: { qty: 395, thb: 31205, dineIn: 125, takeaway: 175, male: 254, female: 46 },
    Apr: { qty: 277, thb: 21883, dineIn: 68,  takeaway: 144, male: 176, female: 36 }
  };

  // ── สี (วนซ้ำตาม index เดือน รองรับครบ 12 เดือน) ──
  const MONTH_ACCENTS = ['#E65100','#1B5E20','#0D47A1','#4A148C','#B26A00','#006064','#BF360C','#33691E','#880E4F','#4E342E','#01579B','#311B92'];
  const TAG_STYLES = [
    { bg: '#FFF3E0', fg: '#E65100' }, { bg: '#E8F5E9', fg: '#1B5E20' },
    { bg: '#E3F2FD', fg: '#0D47A1' }, { bg: '#F3E5F5', fg: '#4A148C' },
    { bg: '#FFF8E1', fg: '#B26A00' }, { bg: '#E0F7FA', fg: '#006064' },
    { bg: '#FBE9E7', fg: '#BF360C' }, { bg: '#F1F8E9', fg: '#33691E' },
    { bg: '#FCE4EC', fg: '#880E4F' }, { bg: '#EFEBE9', fg: '#4E342E' },
    { bg: '#E1F5FE', fg: '#01579B' }, { bg: '#EDE7F6', fg: '#311B92' }
  ];
  const BAR_COLORS = ['#7B4F2E','#C49A6C','#42A5F5','#AB47BC','#FFA726','#26C6DA','#EF5350','#66BB6A','#EC407A','#8D6E63','#29B6F6','#7E57C2'];

  const colorAt = (arr, i) => arr[i % arr.length];
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  };

  // ── STATE ─────────────────────────────────────
  // ใช้เวลาไทย (Asia/Bangkok) เสมอ ไม่ใช่ UTC — ก่อน 7 โมงเช้า UTC ยังเป็นเมื่อวาน
  const bangkokToday = () =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  let months = C.monthsUpTo(CONFIG.YEAR, bangkokToday());
  const charts = {};

  const monthData = m => DATA[m.key] || {};
  const seriesOf = k => months.map(m => {
    const v = monthData(m)[k];
    return typeof v === 'number' ? v : null;
  });
  const iceSeriesOf = k => months.map(m => {
    const v = (ICE_CREAM[m.key] || {})[k];
    return typeof v === 'number' ? v : null;
  });
  const chartLabels = () => months.map(m => m.label);

  // ── ตัวช่วยตั้งค่ากราฟที่ใช้ร่วมกัน ──
  const GRID = '#F0E8DC';
  const moneyTip = { callbacks: { label: c => ' ' + fmtB(c.raw) } };
  const countTip = unit => ({ callbacks: { label: c => ' ' + fmt(c.raw) + ' ' + unit } });
  const bahtTicks = {
    callback: v => '฿' + (v >= 1000000 ? (v / 1000000).toFixed(1) + 'M'
      : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v)
  };
  const bottomLegend = { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } };
  const baseOpts = extra => Object.assign({ responsive: true, maintainAspectRatio: false }, extra);

  /** อัปเดตข้อมูลกราฟเดิมด้วย chart.update() ถ้ามีอยู่แล้ว — ไม่ destroy/สร้างใหม่ทุกรอบ */
  function upsertChart(key, canvasId, config) {
    const existing = charts[key];
    if (existing) {
      existing.data.labels = config.data.labels;
      config.data.datasets.forEach((src, i) => {
        const dst = existing.data.datasets[i];
        if (!dst) { existing.data.datasets.push(src); return; }
        dst.data = src.data;
        if (src.backgroundColor) dst.backgroundColor = src.backgroundColor;
        if (src.borderColor) dst.borderColor = src.borderColor;
      });
      existing.data.datasets.length = config.data.datasets.length;
      existing.update();
      return;
    }
    const el = document.getElementById(canvasId);
    charts[key] = new Chart(el.getContext('2d'), config);
  }

  // ── ERROR BANNER (แทน alert) ──────────────────
  function showError(msg) {
    const banner = document.getElementById('errorBanner');
    banner.querySelector('.msg').textContent = msg;
    banner.hidden = false;
  }
  function hideError() {
    document.getElementById('errorBanner').hidden = true;
  }

  // ── KPI GRID ──────────────────────────────────
  function buildKPI() {
    const k = C.computeKpis(DATA, months.map(m => m.key));
    const cards = [
      { label: 'รายได้รวม YTD', value: fmtB(k.ytdRev), unit: 'บาท', accent: '#7B4F2E' },
      { label: 'บิลรวม YTD', value: fmt(k.ytdBill), unit: 'บิล', accent: '#4CAF50' },
      { label: 'ลูกค้ารวม YTD', value: fmt(k.ytdCust), unit: 'ราย', accent: '#42A5F5' },
      { label: 'เฉลี่ย/บิล YTD', value: fmtB(k.avgPerBill), unit: 'บาท/บิล', accent: '#FFA726' }
    ];
    months.forEach((m, i) => {
      const rev = monthData(m).totalRevenue;
      const hasData = typeof rev === 'number';
      const prevRev = i > 0 ? monthData(months[i - 1]).totalRevenue : null;
      const mom = C.momPercent(
        typeof prevRev === 'number' ? prevRev : null,
        hasData ? rev : null
      );
      let badge = null;
      if (!hasData) {
        badge = { text: 'ยังไม่มีข้อมูล', cls: 'neu' };
      } else if (m.partial) {
        badge = { text: 'ข้อมูลบางส่วน (1–' + Number(m.to.slice(8)) + ' ' + m.thaiName + ')', cls: 'neu' };
      } else if (mom != null) {
        badge = { text: (mom >= 0 ? '+' : '') + mom.toFixed(1) + '%', cls: mom >= 0 ? 'up' : 'down' };
      }
      cards.push({
        label: 'รายได้ ' + m.thaiName,
        value: fmtB(hasData ? rev : null),
        unit: 'บาท',
        accent: colorAt(MONTH_ACCENTS, i),
        badge
      });
    });
    document.getElementById('kpiGrid').innerHTML = cards.map(card => `
      <div class="kpi-card" style="--accent:${card.accent}">
        <div class="label">${escapeHtml(card.label)}</div>
        <div class="value">${escapeHtml(card.value)}</div>
        <div class="unit">${escapeHtml(card.unit)}</div>
        ${card.badge ? `<div class="badge ${card.badge.cls}">${escapeHtml(card.badge.text)}</div>` : ''}
      </div>`).join('');
  }

  // ── FOOTNOTE เดือนที่ข้อมูลบางส่วน ──
  function buildFootnotes() {
    const partial = months.find(m => m.partial);
    const note = partial
      ? '* ' + partial.thaiName + ' = ข้อมูลบางส่วน (1–' + Number(partial.to.slice(8)) + ' ' + partial.thaiName + ')'
      : '';
    document.querySelectorAll('.partial-note').forEach(el => {
      el.textContent = note;
      el.hidden = !note;
    });
  }

  // ── CHARTS ────────────────────────────────────
  function buildRevenueChart() {
    upsertChart('revenue', 'revenueChart', {
      type: 'bar',
      data: {
        labels: chartLabels(),
        datasets: [{
          label: 'รายได้ (บาท)',
          data: seriesOf('totalRevenue'),
          backgroundColor: months.map((_, i) => rgba(colorAt(BAR_COLORS, i), .8)),
          borderColor: months.map((_, i) => colorAt(BAR_COLORS, i)),
          borderWidth: 2, borderRadius: 8, borderSkipped: false
        }, {
          type: 'line', label: 'แนวโน้ม',
          data: seriesOf('totalRevenue'),
          borderColor: '#5C3317', borderWidth: 2.5,
          pointBackgroundColor: '#5C3317', pointRadius: 5,
          fill: false, tension: .35
        }]
      },
      options: baseOpts({
        plugins: { legend: { display: false }, tooltip: moneyTip },
        scales: {
          y: { beginAtZero: true, grid: { color: GRID }, ticks: bahtTicks },
          x: { grid: { display: false } }
        }
      })
    });
  }

  function stackedBahtChart(key, canvasId, datasets) {
    upsertChart(key, canvasId, {
      type: 'bar',
      data: { labels: chartLabels(), datasets },
      options: baseOpts({
        plugins: { legend: bottomLegend, tooltip: moneyTip },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: GRID }, ticks: bahtTicks }
        }
      })
    });
  }

  function buildCategoryChart() {
    stackedBahtChart('category', 'categoryChart', [
      { label: 'เครื่องดื่ม', data: seriesOf('beverages_thb'), backgroundColor: 'rgba(123,79,46,.85)', borderRadius: 4 },
      { label: 'เบเกอรี่', data: seriesOf('bakeries_thb'), backgroundColor: 'rgba(196,154,108,.85)', borderRadius: 4 },
      { label: 'ของฝาก', data: seriesOf('souvenirs_thb'), backgroundColor: 'rgba(255,167,38,.85)', borderRadius: 4 }
    ]);
  }

  function buildChannelChart() {
    stackedBahtChart('channel', 'channelChart', [
      { label: 'กินในร้าน', data: seriesOf('dineIn_thb'), backgroundColor: 'rgba(66,165,245,.85)', borderRadius: 4 },
      { label: 'Take Away', data: seriesOf('takeaway_thb'), backgroundColor: 'rgba(41,182,246,.7)', borderRadius: 4 },
      { label: 'Delivery', data: seriesOf('delivery_thb'), backgroundColor: 'rgba(38,198,218,.85)', borderRadius: 4 }
    ]);
  }

  function buildBillsChart() {
    upsertChart('bills', 'billsChart', {
      type: 'line',
      data: {
        labels: chartLabels(),
        datasets: [{
          label: 'จำนวนบิล',
          data: seriesOf('totalBills'),
          borderColor: '#4CAF50', backgroundColor: 'rgba(76,175,80,.12)',
          borderWidth: 2.5, pointRadius: 6, pointBackgroundColor: '#4CAF50',
          fill: true, tension: .35
        }]
      },
      options: baseOpts({
        plugins: { legend: { display: false }, tooltip: countTip('บิล') },
        scales: {
          y: { beginAtZero: false, grid: { color: GRID } },
          x: { grid: { display: false } }
        }
      })
    });
  }

  // เปลี่ยนจาก doughnut เป็น bar — ข้อมูลรายเดือนเป็น time series อ่านแนวโน้มจาก donut ไม่ได้
  function buildDeliveryChart() {
    const data = months.map(m => {
      const d = monthData(m);
      if (d.grab_thb == null && d.lineman_thb == null) return null;
      return (d.grab_thb || 0) + (d.lineman_thb || 0);
    });
    upsertChart('delivery', 'deliveryChart', {
      type: 'bar',
      data: {
        labels: chartLabels(),
        datasets: [{
          label: 'Delivery (Grab + Line Man)',
          data,
          backgroundColor: rgba('#FFA726', .85), borderRadius: 4
        }]
      },
      options: baseOpts({
        plugins: { legend: { display: false }, tooltip: moneyTip },
        scales: {
          y: { beginAtZero: true, grid: { color: GRID }, ticks: bahtTicks },
          x: { grid: { display: false } }
        }
      })
    });
  }

  function buildQtyChart() {
    upsertChart('qty', 'qtyChart', {
      type: 'bar',
      data: {
        labels: chartLabels(),
        datasets: [
          { label: 'เครื่องดื่ม (แก้ว)', data: seriesOf('beverages_qty'), backgroundColor: 'rgba(123,79,46,.85)', borderRadius: 4 },
          { label: 'เบเกอรี่ (ชิ้น)', data: seriesOf('bakeries_qty'), backgroundColor: 'rgba(196,154,108,.85)', borderRadius: 4 }
        ]
      },
      options: baseOpts({
        plugins: { legend: bottomLegend, tooltip: countTip('ชิ้น') },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: GRID } }
        }
      })
    });
  }

  function buildAvgBillChart() {
    upsertChart('avgBill', 'avgBillChart', {
      type: 'line',
      data: {
        labels: chartLabels(),
        datasets: [{
          label: 'เฉลี่ย/บิล',
          data: seriesOf('avgBill'),
          borderColor: '#26C6DA', backgroundColor: 'rgba(38,198,218,.1)',
          borderWidth: 2.5, pointRadius: 6, pointBackgroundColor: '#26C6DA',
          fill: true, tension: .35
        }]
      },
      options: baseOpts({
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmtB(c.raw) + ' /บิล' } } },
        scales: {
          y: { beginAtZero: false, grid: { color: GRID }, ticks: { callback: v => '฿' + v } },
          x: { grid: { display: false } }
        }
      })
    });
  }

  function buildIceCreamCharts() {
    upsertChart('iceCreamQty', 'iceCreamQtyChart', {
      type: 'bar',
      data: {
        labels: chartLabels(),
        datasets: [{
          label: 'สกู๊ป',
          data: iceSeriesOf('qty'),
          backgroundColor: months.map((_, i) => i % 2 === 0 ? 'rgba(240,98,146,.85)' : 'rgba(206,147,216,.85)'),
          borderRadius: 8, borderSkipped: false
        }]
      },
      options: baseOpts({
        plugins: { legend: { display: false }, tooltip: countTip('สกู๊ป') },
        scales: {
          y: { beginAtZero: true, grid: { color: GRID } },
          x: { grid: { display: false } }
        }
      })
    });
    upsertChart('iceCreamRev', 'iceCreamRevChart', {
      type: 'line',
      data: {
        labels: chartLabels(),
        datasets: [{
          label: 'รายได้ (บาท)',
          data: iceSeriesOf('thb'),
          borderColor: '#CE93D8', backgroundColor: 'rgba(206,147,216,.15)',
          borderWidth: 2.5, pointRadius: 6, pointBackgroundColor: '#CE93D8',
          fill: true, tension: .35
        }]
      },
      options: baseOpts({
        plugins: { legend: { display: false }, tooltip: moneyTip },
        scales: {
          y: { beginAtZero: false, grid: { color: GRID }, ticks: bahtTicks },
          x: { grid: { display: false } }
        }
      })
    });
  }

  // ── GENDER BARS ───────────────────────────────
  // ใช้สี + ลาย (pattern) แยกชาย/หญิง เพื่อผู้ใช้ตาบอดสี และมี % เป็นข้อความกำกับเสมอ
  function buildGenderBars() {
    const rows = months.map(m => {
      const d = monthData(m);
      const total = (d.male || 0) + (d.female || 0);
      if (!total) {
        return `<div class="prog-row">
          <div class="prog-label">
            <span class="name">${escapeHtml(m.label)}</span>
            <span class="val">ยังไม่มีข้อมูล</span>
          </div>
        </div>`;
      }
      const femalePct = Math.round((d.female || 0) / total * 100);
      const malePct = 100 - femalePct;
      return `<div class="prog-row">
        <div class="prog-label">
          <span class="name">${escapeHtml(m.label)}</span>
          <span class="val">ชาย ${malePct}% · หญิง ${femalePct}%</span>
        </div>
        <div class="gender-track" role="img" aria-label="${escapeHtml(m.thaiName)}: ลูกค้าชาย ${malePct}% หญิง ${femalePct}%">
          <div class="gender-male" style="width:${malePct}%"></div>
          <div class="gender-female" style="width:${femalePct}%"></div>
        </div>
      </div>`;
    }).join('');
    document.getElementById('genderBars').innerHTML = rows + `
      <div class="gender-legend">
        <span><span class="swatch gender-male"></span>ชาย</span>
        <span><span class="swatch gender-female"></span>หญิง</span>
      </div>`;
  }

  // ── TABLES ────────────────────────────────────
  const monthTag = (m, i) => {
    const t = colorAt(TAG_STYLES, i);
    return `<span class="month-tag" style="background:${t.bg};color:${t.fg}">${escapeHtml(m.label)}</span>`;
  };

  function buildTable() {
    const headers = ['เดือน','รายได้รวม','จำนวนบิล','เฉลี่ย/บิล','เครื่องดื่ม','เบเกอรี่','ของฝาก','Dine-in','Take Away','Delivery','ลูกค้าชาย','ลูกค้าหญิง'];
    const rows = months.map((m, i) => {
      const d = monthData(m);
      return `<tr>
        <td>${monthTag(m, i)}</td>
        <td class="num rev">${fmtB(d.totalRevenue)}</td>
        <td class="num">${fmt(d.totalBills)}</td>
        <td class="num">${fmtB(d.avgBill)}</td>
        <td class="num">${fmtB(d.beverages_thb)}</td>
        <td class="num">${fmtB(d.bakeries_thb)}</td>
        <td class="num">${fmtB(d.souvenirs_thb)}</td>
        <td class="num">${fmtB(d.dineIn_thb)}</td>
        <td class="num">${fmtB(d.takeaway_thb)}</td>
        <td class="num">${fmtB(d.delivery_thb)}</td>
        <td class="num">${fmt(d.male)}</td>
        <td class="num">${fmt(d.female)}</td>
      </tr>`;
    });

    const total = k => months.reduce((s, m) => {
      const v = monthData(m)[k];
      return s + (typeof v === 'number' ? v : 0);
    }, 0);
    rows.push(`<tr class="total-row">
      <td><strong>รวม YTD</strong></td>
      <td class="num rev">${fmtB(total('totalRevenue'))}</td>
      <td class="num">${fmt(total('totalBills'))}</td>
      <td class="num">—</td>
      <td class="num">${fmtB(total('beverages_thb'))}</td>
      <td class="num">${fmtB(total('bakeries_thb'))}</td>
      <td class="num">${fmtB(total('souvenirs_thb'))}</td>
      <td class="num">${fmtB(total('dineIn_thb'))}</td>
      <td class="num">${fmtB(total('takeaway_thb'))}</td>
      <td class="num">${fmtB(total('delivery_thb'))}</td>
      <td class="num">${fmt(total('male'))}</td>
      <td class="num">${fmt(total('female'))}</td>
    </tr>`);

    document.getElementById('detailTable').innerHTML = `
      <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>`;
  }

  function buildIceCreamTable() {
    const rows = months.map((m, i) => {
      const d = ICE_CREAM[m.key];
      if (!d) {
        return `<tr>
          <td>${monthTag(m, i)}</td>
          <td class="num ice">—</td><td class="num rev">—</td><td class="num">—</td>
          <td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>
        </tr>`;
      }
      const total = (d.male || 0) + (d.female || 0);
      return `<tr>
        <td>${monthTag(m, i)}</td>
        <td class="num ice">${fmt(d.qty)} สกู๊ป</td>
        <td class="num rev">${fmtB(d.thb)}</td>
        <td class="num">${(d.qty && d.thb) ? fmtB(Math.round(d.thb / d.qty)) : '—'}</td>
        <td class="num">${fmt(d.dineIn)}</td>
        <td class="num">${fmt(d.takeaway)}</td>
        <td class="num">${fmt(d.male)} (${total ? Math.round((d.male || 0) / total * 100) : 0}%)</td>
        <td class="num">${fmt(d.female)} (${total ? Math.round((d.female || 0) / total * 100) : 0}%)</td>
      </tr>`;
    });

    const sum = k => months.reduce((s, m) => s + ((ICE_CREAM[m.key] || {})[k] || 0), 0);
    const tQty = sum('qty'), tThb = sum('thb');
    rows.push(`<tr class="total-row">
      <td><strong>รวม YTD</strong></td>
      <td class="num ice">${fmt(tQty)} สกู๊ป</td>
      <td class="num rev">${fmtB(tThb)}</td>
      <td class="num">${tQty > 0 ? fmtB(Math.round(tThb / tQty)) : '—'}</td>
      <td class="num">—</td><td class="num">—</td>
      <td class="num">${fmt(sum('male'))}</td>
      <td class="num">${fmt(sum('female'))}</td>
    </tr>`);

    document.getElementById('iceCreamTable').innerHTML = `
      <thead><tr>
        <th>เดือน</th><th>จำนวน</th><th>รายได้</th><th>ราคา/สกู๊ป</th>
        <th>Dine-in</th><th>Take Away</th><th>ชาย</th><th>หญิง</th>
      </tr></thead><tbody>${rows.join('')}</tbody>`;
  }

  // ── RENDER ALL ────────────────────────────────
  function renderDashboard() {
    buildKPI();
    buildFootnotes();
    buildGenderBars();
    buildTable();
    buildIceCreamTable();
    if (typeof Chart !== 'undefined') {
      buildRevenueChart();
      buildCategoryChart();
      buildChannelChart();
      buildBillsChart();
      buildDeliveryChart();
      buildQtyChart();
      buildAvgBillChart();
      buildIceCreamCharts();
    } else {
      showError('โหลดไลบรารีกราฟ (Chart.js) ไม่สำเร็จ — แสดงได้เฉพาะตัวเลขและตาราง ลองรีโหลดหน้าอีกครั้ง');
    }
  }

  // ── SheetJS: lazy-load เฉพาะตอนกด Refresh ครั้งแรก (~900KB ไม่โหลดฟรีทุก pageview) ──
  let sheetJsPromise = null;
  function ensureSheetJS() {
    if (window.XLSX) return Promise.resolve();
    if (!sheetJsPromise) {
      sheetJsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = CONFIG.SHEETJS_URL;
        s.crossOrigin = 'anonymous';
        s.onload = resolve;
        s.onerror = () => {
          sheetJsPromise = null; // ให้ลองโหลดใหม่ได้ในการกดครั้งถัดไป
          reject(new Error('โหลดไลบรารีอ่านไฟล์ Excel (SheetJS) ไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต'));
        };
        document.head.appendChild(s);
      });
    }
    return sheetJsPromise;
  }

  const delay = ms => new Promise(r => setTimeout(r, ms));

  // ── REFRESH ───────────────────────────────────
  async function fetchMonthReport(from, to) {
    const body = new URLSearchParams({ posid: CONFIG.POS_ID, date: from, todate: to });
    const res = await fetch(CONFIG.API_BASE + '/rp.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!res.ok) throw new Error('สั่งสร้างรายงานไม่สำเร็จ (HTTP ' + res.status + ')');

    // server เขียนรายงานลงไฟล์ rp.xlsx ไฟล์เดียวร่วมกัน — รอแล้วลองอ่านซ้ำหลายรอบแทน sleep ครั้งเดียว
    // (ยังเสี่ยงข้อมูลทับกันถ้าหลายคนกดพร้อมกัน — แก้ขาดต้องให้ server ตอบ JSON ต่อ request, AUDIT.md ข้อ 6.2)
    let lastError = new Error('อ่านไฟล์รายงานไม่สำเร็จ');
    for (let attempt = 1; attempt <= CONFIG.REPORT_RETRIES; attempt++) {
      await delay(CONFIG.REPORT_WAIT_MS);
      try {
        const fileRes = await fetch(CONFIG.API_BASE + '/rp.xlsx?t=' + Date.now());
        if (!fileRes.ok) throw new Error('ดาวน์โหลดรายงานไม่สำเร็จ (HTTP ' + fileRes.status + ')');
        const buf = await fileRes.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' }); // อ่าน ArrayBuffer ตรงๆ ไม่ต้องแปลงเป็น base64
        const sheet = wb.Sheets[CONFIG.SHEET_NAME];
        if (!sheet) throw new Error("ไม่พบชีท '" + CONFIG.SHEET_NAME + "' ในไฟล์รายงาน");
        const { data, missing } = C.parseMonthRows(XLSX.utils.sheet_to_json(sheet, { header: 1 }));
        if (missing.length) console.warn('parse ' + from + ' → ' + to + ': ไม่พบแถวข้อมูล:', missing);
        return data;
      } catch (e) {
        lastError = e;
        console.warn('อ่านรายงาน (' + from + ') รอบที่ ' + attempt + '/' + CONFIG.REPORT_RETRIES + ' ไม่สำเร็จ:', e.message);
      }
    }
    throw lastError;
  }

  async function refreshData() {
    const btn = document.getElementById('refreshBtn');
    if (btn.disabled) return; // กันกดซ้ำระหว่างโหลด
    const overlay = document.getElementById('loadingOverlay');
    const btnLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'กำลังโหลด...';
    overlay.classList.add('show');
    hideError();

    months = C.monthsUpTo(CONFIG.YEAR, bangkokToday());
    const failed = [];
    try {
      await ensureSheetJS();
      // ต้องดึงทีละเดือน — server ใช้ไฟล์รายงานร่วมกันไฟล์เดียว ยิงพร้อมกันข้อมูลจะทับกัน
      for (const m of months) {
        try {
          const fresh = await fetchMonthReport(m.from, m.to);
          DATA[m.key] = C.mergeMonthData(DATA[m.key] || {}, fresh);
        } catch (e) {
          console.error('ดึงข้อมูลเดือน ' + m.thaiName + ' ไม่สำเร็จ:', e);
          failed.push(m.thaiName);
        }
      }

      renderDashboard();

      if (failed.length === months.length) {
        showError('ไม่สามารถโหลดข้อมูลได้เลย — ตรวจการเชื่อมต่อ (endpoint เป็น HTTP อาจถูก browser block บนหน้า HTTPS) แล้วลองใหม่');
      } else {
        document.getElementById('lastUpdated').textContent =
          'อัปเดตล่าสุด: ' + new Date().toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          });
        if (failed.length) {
          showError('โหลดไม่สำเร็จบางเดือน: ' + failed.join(', ') + ' — เดือนเหล่านั้นแสดงข้อมูลเดิม/ว่างแทน (รายละเอียดใน console)');
        }
      }
    } catch (e) {
      console.error(e);
      showError('ไม่สามารถโหลดข้อมูลได้: ' + e.message);
    } finally {
      overlay.classList.remove('show');
      btn.disabled = false;
      btn.textContent = btnLabel;
    }
  }

  // ── BOOT ──────────────────────────────────────
  document.getElementById('refreshBtn').addEventListener('click', refreshData);
  document.getElementById('errorDismiss').addEventListener('click', hideError);
  document.getElementById('lastUpdated').textContent = SNAPSHOT_LABEL;
  renderDashboard();
})();

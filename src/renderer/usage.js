// Data usage page.
const PERIODS = [
  ['today', t('النهارده')],
  ['yesterday', t('امبارح')],
  ['7d', t('آخر 7 أيام')],
  ['30d', t('آخر 30 يوم')],
  ['month', t('الشهر الحالي')],
  ['all', t('الكل')],
  ['custom', t('فترة مخصصة')],
];

function periodRange(period, from, to) {
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  const DAY = 86_400_000;
  const end = d0.getTime() + DAY;
  switch (period) {
    case 'today': return [d0.getTime(), end];
    case 'yesterday': return [d0.getTime() - DAY, d0.getTime()];
    case '7d': return [d0.getTime() - 6 * DAY, end];
    case '30d': return [d0.getTime() - 29 * DAY, end];
    case 'month': return [new Date(d0.getFullYear(), d0.getMonth(), 1).getTime(), end];
    case 'custom': {
      const a = from ? new Date(from + 'T00:00:00').getTime() : 0;
      const b = to ? new Date(to + 'T00:00:00').getTime() + DAY : end;
      return [a, b];
    }
    default: return [0, end];
  }
}

const KIND_LABEL = { live: t('مباشر'), movie: t('فيلم'), series: t('حلقة') };

async function usageView(root, params, ctx) {
  root.append(loading());
  const data = await window.api.usage();
  if (!ctx.alive()) return;
  let period = params.period || '7d';
  let from = params.from || dayKey(Date.now() - 6 * 86_400_000);
  let to = params.to || dayKey();

  const select = h('select.input.focusable', { 'data-autofocus': true },
    ...PERIODS.map(([v, l]) => h('option', { value: v, selected: v === period }, l)));
  const fromIn = h('input.input.focusable', { type: 'date', value: from });
  const toIn = h('input.input.focusable', { type: 'date', value: to });
  const customBox = h('div.row.custom', h('label', t('من')), fromIn, h('label', t('إلى')), toIn);
  const body = h('div');

  function update() {
    period = select.value;
    from = fromIn.value;
    to = toIn.value;
    Router.update({ period, from, to });
    customBox.hidden = period !== 'custom';
    const [a, b] = periodRange(period, from, to);

    const dayKeys = Object.keys(data.days).filter((k) => {
      const t = new Date(k + 'T12:00:00').getTime();
      return t >= a && t < b;
    }).sort();
    let video = 0;
    let other = 0;
    for (const k of dayKeys) {
      video += data.days[k].video || 0;
      other += data.days[k].other || 0;
    }
    const sessions = data.sessions.filter((s) => s.start >= a && s.start < b);
    const watchMs = sessions.reduce((t, s) => t + (s.end - s.start), 0);
    const perHour = watchMs > 60_000 ? (video / watchMs) * 3_600_000 : 0;

    // Chart covers the full range of days (empty days show as gaps), max 62 bars.
    const firstDay = period === 'all' ? (dayKeys[0] ? new Date(dayKeys[0] + 'T00:00:00').getTime() : Date.now()) : a;
    const chartDays = [];
    for (let t = Math.max(firstDay, b - 62 * 86_400_000); t < b; t += 86_400_000) chartDays.push(dayKey(t + 3_600_000 * 12));
    const uniq = [...new Set(chartDays)];

    fill(body, 
      h('div.stats',
        stat(t('إجمالي الاستهلاك'), fmtBytes(video + other)),
        stat(t('مشاهدة (فيديو)'), fmtBytes(video)),
        stat(t('تصفح (قوائم وصور)'), fmtBytes(other)),
        stat(t('وقت المشاهدة'), fmtDuration(watchMs)),
        stat(t('متوسط الساعة'), perHour ? fmtBytes(perHour) : '—'),
      ),
      uniq.length > 1 ? usageChart(uniq, data.days) : null,
      h('h2', t('جلسات المشاهدة ({0})', [sessions.length])),
      sessions.length
        ? h('div.table-wrap', { 'data-scroll': 'table' },
          h('table.table',
            h('thead', h('tr', h('th', t('المحتوى')), h('th', t('النوع')), h('th', t('البداية')), h('th', t('المدة')), h('th', t('الاستهلاك')), h('th', t('متوسط السرعة')))),
            h('tbody', ...sessions.map((s) => {
              const dur = s.end - s.start;
              const live = data.activeIds.includes(s.id);
              return h('tr',
                h('td', s.title, live ? h('span.live-dot', t(' ● الآن')) : null),
                h('td', KIND_LABEL[s.kind] || s.kind),
                h('td', { dir: 'ltr' }, fmtDateTime(s.start)),
                h('td', { dir: 'ltr' }, fmtDuration(dur)),
                h('td', { dir: 'ltr' }, fmtBytes(s.bytes)),
                h('td', { dir: 'ltr' }, dur > 1000 ? fmtMbps(s.bytes / (dur / 1000)) : '—'),
              );
            })),
          ))
        : emptyBox(t('مفيش مشاهدات في الفترة دي')),
    );
  }

  function stat(label, value) {
    return h('div.stat', h('div.stat-value', { dir: 'ltr' }, value), h('div.stat-label', label));
  }

  let armed = false;
  const clearBtn = h('button.btn.btn-outline.focusable', {
    onclick: async () => {
      if (!armed) {
        armed = true;
        clearBtn.textContent = t('اضغط تاني للتأكيد');
        setTimeout(() => { armed = false; clearBtn.textContent = t('مسح السجل'); }, 3000);
        return;
      }
      await window.api.clearUsage();
      refreshTopUsage();
      Router.render();
    },
  }, t('مسح السجل'));

  select.addEventListener('change', update);
  fromIn.addEventListener('change', update);
  toIn.addEventListener('change', update);
  root.replaceChildren(
    h('div.page',
      h('div.page-head', h('h1', t('استهلاك الإنترنت')), h('span.device-chip', { title: t('الاستهلاك بيتحسب لكل جهاز لوحده') }, icon('tv'), S.settings.deviceName || t('الجهاز ده')), h('div.row', h('label', t('الفترة')), select, customBox, h('div.spacer'), clearBtn)),
      body,
    ),
  );
  update();
}

// Stacked daily bars: video (series-1) + browsing (series-2), with hover tooltip.
function usageChart(days, data) {
  const max = Math.max(1, ...days.map((k) => (data[k] ? data[k].video + data[k].other : 0)));
  const tip = h('div.chart-tip');
  tip.hidden = true;
  const bars = days.map((k) => {
    const d = data[k] || { video: 0, other: 0 };
    const total = d.video + d.other;
    const col = h('div.bar-col',
      h('div.bar-stack', { style: { height: `${(total / max) * 100}%` } },
        d.other ? h('div.seg.other', { style: { flexGrow: d.other } }) : null,
        d.video ? h('div.seg.video', { style: { flexGrow: d.video } }) : null,
      ),
      h('div.bar-label', k.slice(8)),
    );
    col.addEventListener('mouseenter', () => {
      tip.hidden = false;
      tip.replaceChildren(
        h('b', new Date(k + 'T12:00:00').toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })),
        h('div', h('span.sw.video'), t('مشاهدة: {0}', [fmtBytes(d.video)])),
        h('div', h('span.sw.other'), t('تصفح: {0}', [fmtBytes(d.other)])),
        h('div', t('الإجمالي: {0}', [fmtBytes(total)])),
      );
      const r = col.getBoundingClientRect();
      const pr = col.parentElement.getBoundingClientRect();
      tip.style.left = `${Math.min(pr.width - 180, Math.max(0, r.left - pr.left + r.width / 2 - 90))}px`;
    });
    col.addEventListener('mouseleave', () => (tip.hidden = true));
    return col;
  });
  return h('div.chart-card',
    h('div.chart-head', h('h2', t('الاستهلاك اليومي')),
      h('div.legend', h('span', h('span.sw.video'), t('مشاهدة')), h('span', h('span.sw.other'), t('تصفح')), h('span.muted', t('أعلى يوم: {0}', [fmtBytes(max)])))),
    h('div.chart', { dir: 'ltr' }, ...bars, tip),
  );
}

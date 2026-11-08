/* Turnos · app de turnos para Mari Luz
   Datos: hoja de Google a través de un script (config.js → TURNOS_BACKEND). */
(function () {
  'use strict';

  /* ───────── utilidades ───────── */
  const $ = (s, el = document) => el.querySelector(s);
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, def) { try { const v = localStorage.getItem('turnos.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem('turnos.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem('turnos.' + k); } catch (e) { /* nada */ } }
  };
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; };
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const DIAS_C = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtH = (n) => (Math.round(n * 10) / 10).toLocaleString('es-ES');
  const fmtE = (n) => (Math.round(n * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';
  const fechaLarga = (d) => cap(DIAS[d.getDay()]) + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()];

  /* ───────── estado ───────── */
  const S = {
    url: (window.TURNOS_BACKEND || '').trim() || store.get('url', ''),
    key: store.get('key', ''),
    demo: store.get('demo', false),
    data: store.get('data', null),
    pending: store.get('pending', {}),
    view: 'hoy',
    layer: 'real',
    month: null,
    brush: null, brushOn: false,
    resYear: new Date().getFullYear(),
    camYear: new Date().getFullYear(),
    camQ: '',
    lastFetch: 0,
    status: 'ok'
  };
  let MAP = {};          // fecha → día
  let CODES = {};        // código base → info
  let FEST = {};         // fecha → nombre

  /* ───────── modelo de códigos ───────── */
  // "MF-N" → [{base:'M',f:true},{base:'N',f:false}]; admite códigos antiguos Md, Ti, Td/Ni…
  function parts(code) {
    return String(code || '').split(/[-\/]/).map(t => t.trim()).filter(Boolean).map(t => {
      const m = t.match(/^([MTN])[di]?(F?)$/);
      return m ? { base: m[1], f: m[2] === 'F' } : { base: t.toUpperCase(), f: false };
    });
  }
  const compose = (ps) => ps.map(p => p.base + (p.f && isWorkBase(p.base) ? 'F' : '')).join('-');
  const info = (base) => CODES[base] || { codigo: base, nombre: base, horas: 0, color: '#8590A0', tipo: 'libre' };
  const isWorkBase = (b) => info(b).tipo === 'turno';
  // «La casa»: el hospital o la supervisora, para cambios impuestos y formaciones
  const CASA = 'La casa';
  const isCasa = (c) => String(c || '').trim().toLowerCase() === 'la casa';
  const ICON_CASA = '<svg class="ic-casa" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V8l8-5 8 5v13z"/><path d="M12 8v6M9 11h6" stroke-linecap="round"/><path d="M10 21v-4h4v4"/></svg>';
  const hoursOf = (code) => parts(code).reduce((s, p) => s + (Number(info(p.base).horas) || 0), 0);
  const worked = (code) => parts(code).some(p => isWorkBase(p.base));
  const shortName = (b) => ({ M: 'Mañana', T: 'Tarde', N: 'Noche', D: 'Libre', V: 'Vacaciones' }[b] || info(b).nombre);
  function bg(code) {
    const ps = parts(code);
    if (!ps.length) return 'transparent';
    if (ps.length === 1) return info(ps[0].base).color;
    const step = 100 / ps.length;
    return 'linear-gradient(90deg,' + ps.map((p, i) => info(p.base).color + ' ' + (i * step) + '% ' + ((i + 1) * step) + '%').join(',') + ')';
  }
  const pill = (code, cls = 'pill') => code ? `<span class="${cls}" style="background:${bg(code)}">${esc(code)}</span>` : `<span class="${cls}" style="background:var(--line);color:var(--ink-3)">—</span>`;

  const day = (f) => MAP[f] || { f };
  const real = (d) => d.r || d.o || '';
  const codeIn = (d, layer) => layer === 'orig' ? (d.o || '') : real(d);
  const isFest = (f) => !!FEST[f] || !!(MAP[f] && MAP[f].fe);
  const isSunOrFest = (f) => parseISO(f).getDay() === 0 || isFest(f);
  const cfg = () => (S.data && S.data.config) || {};
  const num = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) ? n : null; };

  function index() {
    MAP = {}; CODES = {}; FEST = {};
    if (!S.data) return;
    (S.data.codigos || []).forEach(c => { CODES[c.codigo.toUpperCase()] = c; });
    // Formación: si la hoja aún no tiene el código, la app lo añade con 7 h
    if (!CODES.FOR) CODES.FOR = { codigo: 'FOR', nombre: 'Formación', horas: 7, color: '#E64980', tipo: 'turno', inicio: '', fin: '' };
    (S.data.festivos || []).forEach(x => { FEST[x.f] = x.nombre; });
    (S.data.dias || []).forEach(d => { MAP[d.f] = Object.assign({}, d); });
    Object.keys(S.pending).forEach(f => { MAP[f] = Object.assign({}, MAP[f] || { f }, S.pending[f]); clean(MAP[f]); });
  }
  function clean(d) { ['r', 'o', 'n', 'c', 'pm', 'sw', 'vj'].forEach(k => { if (d[k] === '') delete d[k]; }); ['fb', 'fe', 'im', 'pd', 'eu'].forEach(k => { if (!d[k]) delete d[k]; }); }

  /* ───────── horarios ───────── */
  function intervals(fromDate, days) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const dt = addDays(fromDate, i), f = iso(dt), d = day(f);
      parts(real(d)).forEach(p => {
        const c = info(p.base);
        if (c.tipo !== 'turno' || !c.inicio || !c.fin) return;
        out.push(mkInt(dt, c.inicio, c.fin, shortName(p.base), p.base, f));
      });
      if (d.fb) out.push(mkInt(dt, cfg().fibao_inicio || '08:00', cfg().fibao_fin || '14:00', 'Fibao', 'FB', f));
    }
    return out.sort((a, b) => a.start - b.start);
  }
  function mkInt(dt, ini, fin, name, base, f) {
    const [a, b] = ini.split(':').map(Number), [c, e] = fin.split(':').map(Number);
    const start = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), a, b);
    let end = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), c, e);
    if (end <= start) end = addDays(end, 1);
    return { start, end, name, base, f, ini, fin };
  }
  function rel(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return m + ' min';
    const hh = Math.floor(m / 60), mm = m % 60;
    if (hh < 24) return hh + ' h' + (mm ? ' ' + mm + ' min' : '');
    const dd = Math.round(hh / 24);
    return dd === 1 ? '1 día' : dd + ' días';
  }
  function whenLabel(it, now) {
    const d0 = iso(now), d1 = iso(addDays(now, 1)), df = iso(it.start);
    const hora = pad(it.start.getHours()) + ':' + pad(it.start.getMinutes());
    if (df === d0) return 'hoy, ' + hora;
    if (df === d1) return 'el ' + DIAS[it.start.getDay()] + ', ' + hora;
    return 'el ' + DIAS[it.start.getDay()] + ' ' + it.start.getDate() + ', ' + hora;
  }

  /* ───────── cielo ───────── */
  const SKIES = {
    M: { sky: 'linear-gradient(170deg,#FFD9A0 0%,#7CCAD8 48%,#1B8EA6 100%)', orb: 'radial-gradient(circle at 40% 40%,#FFF7DE,#FFC970)', glow: 'rgba(255,205,120,.6)', stars: 0 },
    T: { sky: 'linear-gradient(170deg,#FFE28A 0%,#7CC36E 50%,#2A7C47 100%)', orb: 'radial-gradient(circle at 40% 40%,#FFF3C4,#FFB547)', glow: 'rgba(255,190,80,.55)', stars: 0 },
    N: { sky: 'linear-gradient(170deg,#3B2A7A 0%,#21194F 55%,#0E0B26 100%)', orb: 'radial-gradient(circle at 35% 35%,#FFFFFF,#D9D4FF)', glow: 'rgba(200,190,255,.35)', stars: 1 },
    libre: { sky: 'linear-gradient(170deg,#FFE7BF 0%,#F4B860 50%,#D98324 100%)', orb: 'radial-gradient(circle at 40% 40%,#FFFBEA,#FFD66B)', glow: 'rgba(255,220,120,.6)', stars: 0 },
    V: { sky: 'linear-gradient(170deg,#D6EEFF 0%,#7DB9F0 50%,#2F6FC4 100%)', orb: 'radial-gradient(circle at 40% 40%,#FFFBEA,#FFE07A)', glow: 'rgba(255,240,170,.6)', stars: 0 },
    comp: { sky: 'linear-gradient(170deg,#FFF3B8 0%,#E8C547 52%,#B38A12 100%)', orb: 'radial-gradient(circle at 40% 40%,#FFFDF0,#FFE680)', glow: 'rgba(255,235,140,.6)', stars: 0 },
    otro: { sky: 'linear-gradient(170deg,#E3E7EE 0%,#9AA6B8 55%,#5B6678 100%)', orb: 'radial-gradient(circle at 40% 40%,#FFFFFF,#E5E9F0)', glow: 'rgba(255,255,255,.4)', stars: 0 }
  };
  function skyFor(code) {
    const ps = parts(code);
    const w = ps.find(p => isWorkBase(p.base));
    if (w) return SKIES[w.base] || SKIES.otro;
    if (!ps.length) return SKIES.otro;
    const b = ps[0].base, t = info(b).tipo;
    if (b === 'V') return SKIES.V;
    if (t === 'compensacion') return SKIES.comp;
    if (t === 'libre') return SKIES.libre;
    return SKIES.otro;
  }
  const skyStyle = (k) => `--sky:${k.sky};--orb:${k.orb};--glow:${k.glow};--stars:${k.stars}`;

  /* ───────── Hoy ───────── */
  function renderHoy() {
    const now = new Date(), f = iso(now), d = day(f), code = real(d);
    const nombre = cfg().nombre || '';
    const hr = now.getHours();
    $('#greet').textContent = (hr < 13 ? 'Buenos días' : hr < 21 ? 'Buenas tardes' : 'Buenas noches') + (nombre ? ', ' + nombre : '');
    const ps = parts(code);
    const sky = skyFor(code);
    const ints = intervals(addDays(now, -1), 40);
    const cur = ints.find(i => i.start <= now && now < i.end);
    const next = ints.find(i => i.start > now);
    let title = ps.length ? ps.map(p => shortName(p.base)).join(' + ') : 'Sin apuntar';
    let hoursTxt = '';
    const todayWork = ps.filter(p => isWorkBase(p.base) && info(p.base).inicio);
    if (todayWork.length) hoursTxt = todayWork.map(p => info(p.base).inicio + '–' + info(p.base).fin).join(' · ');
    else if (ps.length) hoursTxt = info(ps[0].base).nombre;
    else hoursTxt = 'Toca para apuntar el turno de hoy';
    let when = '';
    if (cur && cur.f !== f) when = 'Saliendo de ' + cur.name.toLowerCase() + ' · termina a las ' + cur.fin;
    else if (cur) when = 'En turno · termina a las ' + cur.fin;
    else if (next && iso(next.start) === f) when = cur ? '' : 'Empieza en ' + rel(next.start - now);
    else if (next) when = 'Próximo: ' + next.name + ' ' + whenLabel(next, now);
    const tags = [];
    if (isSunOrFest(f) && worked(code)) tags.push('<span class="tag">' + (FEST[f] ? esc(FEST[f]) : 'Domingo') + '</span>');
    else if (FEST[f]) tags.push('<span class="tag">' + esc(FEST[f]) + '</span>');
    if (d.fb) tags.push('<span class="tag fibao">Fibao ' + esc(cfg().fibao_inicio || '') + '–' + esc(cfg().fibao_fin || '') + '</span>');
    if (d.c) tags.push('<span class="tag">Cambio con ' + esc(d.c) + '</span>');
    if (d.im) tags.push('<span class="tag">★ ' + esc(d.n || 'Importante') + '</span>');
    if (d.pd) tags.push('<span class="tag pend">⇄ Por cambiar' + (d.pm ? ': ' + esc(d.pm) : '') + '</span>');
    const el = $('#hoy-sky');
    el.innerHTML = `<div class="sky" style="${skyStyle(sky)}"><div class="stars"></div><div class="orb"></div>
      <div><div class="date">${fechaLarga(now)}</div><div class="shift">${esc(title)}</div><div class="hours">${esc(hoursTxt)}</div>
      ${tags.length ? '<div class="tags">' + tags.join('') + '</div>' : ''}</div>
      <div class="foot">${when ? '<div class="when">' + esc(when) + '</div>' : '<span></span>'}<button class="edit" data-edit="${f}">Editar</button></div></div>`;

    // tira
    const strip = $('#strip'); strip.innerHTML = '';
    for (let i = 0; i < 21; i++) {
      const dt = addDays(now, i), ff = iso(dt), dd = day(ff), c = real(dd);
      strip.appendChild(h(`<button class="daypill${i === 0 ? ' today' : ''}${dd.fb ? ' fbday' : ''}${dd.pd ? ' pendday' : ''}${dd.vj ? ' tripday' : ''}${isSunOrFest(ff) ? ' fest' : ''}" data-edit="${ff}" aria-label="${fechaLarga(dt)}: ${esc(c || 'sin turno')}">
        <div class="wd">${i === 0 ? 'hoy' : DIAS[dt.getDay()].slice(0, 3)}</div><div class="dn">${dt.getDate()}</div>
        <div class="cd" style="background:${c ? bg(c) : 'var(--line)'};${c ? '' : 'color:var(--ink-3)'}">${esc(c || '—')}</div></button>`));
    }

    // datos rápidos
    const nextOf = (pred) => { for (let i = 1; i < 120; i++) { const dt = addDays(now, i); if (pred(real(day(iso(dt))), day(iso(dt)))) return dt; } return null; };
    const nN = nextOf(c => parts(c).some(p => p.base === 'N'));
    const nL = nextOf(c => c && !worked(c));
    const nFb = nextOf((c, dd) => !!dd.fb);
    const wk0 = addDays(now, -((now.getDay() + 6) % 7));
    let wkH = 0; for (let i = 0; i < 7; i++) wkH += hoursOf(real(day(iso(addDays(wk0, i)))));
    const inDays = (dt) => { const n = Math.round((dt - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5); return n === 1 ? 'mañana' : 'en ' + n + ' días'; };
    const fact = (k, v, s) => `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`;
    const sal = saldos();
    $('#hoy-debe').innerHTML = sal.length ? `<h3>Horas pendientes de devolver</h3><button type="button" class="card debe" data-s="cam">` + sal.slice(0, 5).map(([n, h]) =>
      `<span class="saldo${isCasa(n) ? ' casa' : ''}"><span class="who">${isCasa(n) ? ICON_CASA : ''}${esc(n)}</span><span class="h ${h > 0 ? 'pos' : 'neg'}">${h > 0 ? 'te debe ' : 'le debes '}${fmtH(Math.abs(h))} h</span></span>`).join('') + '</button>' : '';
    $('#facts').innerHTML =
      fact('Próxima noche', nN ? cap(DIAS[nN.getDay()]) + ' ' + nN.getDate() : '—', nN ? inDays(nN) : 'sin noches a la vista') +
      fact('Próximo día libre', nL ? cap(DIAS[nL.getDay()]) + ' ' + nL.getDate() : '—', nL ? inDays(nL) : '') +
      fact('Esta semana', fmtH(wkH) + ' h', 'de lunes a domingo') +
      fact('Próximo Fibao', nFb ? cap(DIAS[nFb.getDay()]) + ' ' + nFb.getDate() : '—', nFb ? inDays(nFb) : 'sin mañanas apuntadas');

    // año
    const st = stats(now.getFullYear());
    const jor = num(cfg().jornada_anual);
    const y0 = new Date(now.getFullYear(), 0, 1), y1 = new Date(now.getFullYear() + 1, 0, 1);
    const frac = (now - y0) / (y1 - y0);
    let yearHtml = `<div class="card"><h3>${now.getFullYear()} hasta hoy</h3>`;
    if (jor) {
      const pct = Math.min(100, st.hoursToDate / jor * 100), ritmo = st.hoursToDate - jor * frac;
      yearHtml += `<div class="meter"><b style="width:${pct}%"></b><u style="left:${Math.min(100, frac * 100)}%"></u></div>
        <div style="display:flex;justify-content:space-between;font-size:.9rem"><span><b>${fmtH(st.hoursToDate)} h</b> de ${fmtH(jor)} h</span>
        <span class="${ritmo >= 0 ? 'pos' : 'neg'}">${ritmo >= 0 ? '+' : '−'}${fmtH(Math.abs(ritmo))} h sobre el ritmo</span></div>
        <p class="muted" style="margin:6px 0 0;font-size:.82rem">La raya marca dónde deberías ir a fecha de hoy.</p>`;
    } else {
      yearHtml += `<p style="margin:6px 0 0"><b>${fmtH(st.hoursToDate)} h</b> trabajadas en el SAS hasta hoy · ${fmtH(st.hours)} h con lo ya planificado.</p>
        <p class="muted" style="margin:6px 0 0;font-size:.88rem">Pon tu jornada anual en Ajustes para ver si vas por encima o por debajo.</p>`;
    }
    const hF = num(cfg().horas_fibao);
    if (st.fbToDate) yearHtml += `<p style="margin:10px 0 0;padding-top:10px;border-top:1px solid var(--line)"><b style="color:var(--fibao)">Fibao:</b> ${st.fbToDate} ${st.fbToDate === 1 ? 'mañana' : 'mañanas'}${hF ? ' · ' + fmtH(st.fbToDate * hF) + ' h' : ''} hasta hoy, aparte del SAS.</p>`;
    $('#hoy-year').innerHTML = yearHtml + '</div>';

    // cambios por negociar
    const pends = [];
    for (let i = 0; i < 400 && pends.length < 4; i++) { const dt = addDays(now, i), dd = day(iso(dt)); if (dd.pd) pends.push([dt, dd]); }
    const pendHtml = pends.length ? '<h3>Cambios por negociar</h3><div class="card" style="margin-bottom:26px">' + pends.map(([dt, dd]) =>
      `<button class="saldo" style="width:100%;text-align:left" data-edit="${iso(dt)}" data-focus="c"><span><span class="who">${fechaLarga(dt)}</span><br><span class="muted">${esc(dd.pm || 'Sin motivo apuntado')} · tiene ${esc(real(dd) || 'sin turno')}</span></span><span class="muted">${iso(dt) === iso(now) ? 'hoy' : inDays(dt)}</span></button>`).join('') + '</div>' : '';

    // importantes
    const imps = [];
    for (let i = 0; i < 90 && imps.length < 4; i++) { const dt = addDays(now, i), dd = day(iso(dt)); if (dd.im) imps.push([dt, dd]); }
    $('#hoy-imp').innerHTML = pendHtml + (imps.length ? '<h3>Fechas a tener en cuenta</h3><div class="card">' + imps.map(([dt, dd]) =>
      `<button class="saldo" style="width:100%;text-align:left" data-edit="${iso(dt)}"><span><span class="who">${esc(dd.n || 'Fecha importante')}</span><br><span class="muted">${fechaLarga(dt)}</span></span><span class="muted">${inDays(dt) === 'en 0 días' ? 'hoy' : inDays(dt)}</span></button>`).join('') + '</div>' : '');
  }

  /* ───────── estadísticas ───────── */
  function stats(year) {
    const out = { hours: 0, hoursOrig: 0, hoursToDate: 0, M: 0, T: 0, N: 0, fest: 0, dom: 0, sab: 0, fb: 0, fbToDate: 0, por: { cob: [0, 0], pag: [0, 0], dia: [0, 0], casa: [0, 0], pend: [0, 0], sin: [0, 0] }, V: 0, comp: {}, IL: 0, cambios: 0, months: Array.from({ length: 12 }, () => ({ r: 0, o: 0 })), any: false };
    const today = iso(new Date());
    for (let dt = new Date(year, 0, 1); dt.getFullYear() === year; dt = addDays(dt, 1)) {
      const f = iso(dt), d = MAP[f];
      if (!d) continue;
      const c = real(d), o = d.o || '';
      if (c || o) out.any = true;
      const hr = hoursOf(c), ho = hoursOf(o);
      out.hours += hr; out.hoursOrig += ho;
      if (f <= today) out.hoursToDate += hr;
      out.months[dt.getMonth()].r += hr; out.months[dt.getMonth()].o += ho;
      parts(c).forEach(p => {
        if (p.base === 'M' || p.base === 'T' || p.base === 'N') out[p.base]++;
        if (p.f) out.fest++;
        if (p.base === 'V') out.V++;
        if (p.base === 'IL') out.IL++;
        if (info(p.base).tipo === 'compensacion') out.comp[p.base] = (out.comp[p.base] || 0) + 1;
      });
      if (dt.getDay() === 0 && worked(c)) out.dom++;
      if (dt.getDay() === 6 && worked(c)) out.sab++;
      if (d.fb) { out.fb++; if (f <= today) out.fbToDate++; }
      if (o && c !== o) out.cambios++;
      // de dónde sale la diferencia con el cuadrante: [horas, número de cambios] por tipo de compensación
      if ((o && c !== o) || d.eu) {
        const dh = o ? hoursOf(c) - hoursOf(o) : 0;
        const k = d.eu > 0 ? 'cob' : d.eu < 0 ? 'pag' : d.sw ? 'dia' : isCasa(d.c) ? 'casa' : d.c ? 'pend' : 'sin';
        out.por[k][0] += dh; out.por[k][1]++;
      }
      if (d.eu > 0) out.cobrado = (out.cobrado || 0) + d.eu;
      if (d.eu < 0) out.pagado = (out.pagado || 0) - d.eu;
    }
    return out;
  }

  /* ───────── Calendario ───────── */
  function renderCal() {
    if (!S.month) { const n = new Date(); S.month = new Date(n.getFullYear(), n.getMonth(), 1); }
    const m0 = S.month, y = m0.getFullYear(), m = m0.getMonth();
    $('#cal-title').textContent = cap(MESES[m]) + ' ' + y;
    $('#lay-real').setAttribute('aria-pressed', S.layer === 'real');
    $('#lay-orig').setAttribute('aria-pressed', S.layer === 'orig');
    $('#cal-wd').innerHTML = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(x => `<div class="wdh">${x}</div>`).join('');
    const grid = $('#cal-grid'); grid.innerHTML = '';
    const lead = (m0.getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) grid.appendChild(h('<div class="cell out" aria-hidden="true"></div>'));
    const today = iso(new Date());
    for (let dt = new Date(y, m, 1); dt.getMonth() === m; dt = addDays(dt, 1)) {
      const f = iso(dt), d = day(f), c = codeIn(d, S.layer);
      const diff = S.layer === 'real' && d.o && real(d) !== d.o;
      grid.appendChild(h(`<button class="cell${d.fb ? ' fbday' : ''}${d.pd ? ' pendday' : ''}${d.vj ? ' tripday' : ''}${isSunOrFest(f) ? ' fest' : ''}${f === today ? ' today' : ''}${S.brushOn ? ' paintable' : ''}" data-day="${f}" aria-label="${fechaLarga(dt)}: ${esc(c || 'sin turno')}${diff ? ', cambiado, en el cuadrante ' + esc(d.o) : ''}${d.pd ? ', por cambiar' : ''}${d.vj ? ', ' + esc(d.vj) : ''}${d.fb ? ', Fibao' : ''}">
        ${d.im ? '<span class="badges"><span class="star">★</span></span>' : ''}
        <span class="n">${dt.getDate()}</span><span class="was">${diff ? esc(d.o) : ''}</span><span class="c${c ? '' : ' empty'}" style="${c ? 'background:' + bg(c) : ''}">${esc(c) || '&nbsp;'}</span></button>`));
    }
    // leyenda
    const used = new Set();
    for (let dt = new Date(y, m, 1); dt.getMonth() === m; dt = addDays(dt, 1)) parts(codeIn(day(iso(dt)), S.layer)).forEach(p => used.add(p.base));
    const leg = [...used].filter(b => CODES[b]).map(b => `<span><i style="background:${info(b).color}"></i>${esc(b)} ${esc(info(b).nombre)}</span>`);
    leg.push('<span><i style="background:transparent;box-shadow:inset 0 0 0 2px var(--fibao)"></i>Fibao</span>');
    leg.push('<span><i class="leg-pend"></i>Por cambiar</span>');
    leg.push('<span><i class="leg-trip"></i>Viaje</span>');
    leg.push('<span><b style="color:var(--fest);font-size:.9rem">★</b>Fecha a tener en cuenta</span>');
    if (S.layer === 'real') leg.push('<span><s class="muted" style="font-size:.78rem">M</s>Ya cambiado: tachado, lo que ponía el cuadrante</span>');
    $('#legend').innerHTML = leg.join('');
    // fechas a tener en cuenta del mes, con su nota
    const notas = [];
    for (let dt = new Date(y, m, 1); dt.getMonth() === m; dt = addDays(dt, 1)) { const dd = day(iso(dt)); if (dd.im) notas.push([dt, dd]); }
    const viajes = [];
    for (let dt = new Date(y, m, 1); dt.getMonth() === m; dt = addDays(dt, 1)) { const f = iso(dt), dd = day(f); if (dd.vj && day(iso(addDays(dt, -1))).vj !== dd.vj || dd.vj && dt.getDate() === 1) viajes.push(tripRun(f)); }
    const trips = viajes.map(run => { const a = parseISO(run[0]), b = parseISO(run[run.length - 1]);
      return `<button type="button" class="cn" data-edit="${iso(a)}"><span class="d">${a.getDate()}<small>${DIAS[a.getDay()]}</small></span><span class="t"><span class="tripdot"></span>${esc(day(run[0]).vj)} · ${run.length === 1 ? '1 día' : 'hasta el ' + b.getDate() + (b.getMonth() !== a.getMonth() ? ' de ' + MESES[b.getMonth()] : '') + ' · ' + run.length + ' días'}</span></button>`; });
    $('#cal-notes').innerHTML = (notas.length || trips.length) ? `<div class="cal-notes"><h3>Fechas a tener en cuenta</h3><div class="card" style="padding:2px 16px">` + trips.join('') + notas.map(([dt, dd]) =>
      `<button type="button" class="cn" data-edit="${iso(dt)}"><span class="d">${dt.getDate()}<small>${DIAS[dt.getDay()]}</small></span><span class="t"><span class="star">★</span>${esc(dd.n || 'Sin descripción. Toca para añadirla.')}</span></button>`).join('') + '</div></div>' : '';
    // pincel
    $('#brushbar').hidden = !S.brushOn;
    $('#brush-toggle').innerHTML = S.brushOn ? ICON_OK + 'Listo' : ICON_EDIT + 'Editar';
    $('#brush-toggle').setAttribute('aria-pressed', S.brushOn);
    if (S.brushOn) {
      const opts = Object.keys(CODES).map(b => ({ code: b, color: info(b).color }));
      $('#brush-codes').innerHTML = opts.map(o => `<button class="code-btn" aria-pressed="${S.brush === o.code}" data-brush="${o.code}" style="background:${o.color};--cc:${o.color}">${esc(o.code)}</button>`).join('') +
        `<button class="code-btn" aria-pressed="${S.brush === '__fb'}" data-brush="__fb" style="background:var(--fibao);--cc:var(--fibao)">Fibao</button>` +
        `<button class="code-btn" aria-pressed="${S.brush === ''}" data-brush="" style="background:var(--ink-3);--cc:var(--ink-3)">Borrar</button>`;
      $('#brush-pat').hidden = S.layer !== 'orig';
      $('#brush-msg').textContent = S.brush == null ? 'Elige un turno y toca los días a los que se lo quieres poner en el ' + (S.layer === 'orig' ? 'cuadrante.' : 'calendario real.')
        : S.brush === '__fb' ? 'Toca los días para poner o quitar Fibao.' : (S.brush ? 'Poniendo ' + S.brush : 'Vaciando días') + ' en el ' + (S.layer === 'orig' ? 'cuadrante' : 'calendario real') + '. Domingos y festivos llevan la F solos.';
    }
  }
  function paint(f) {
    if (S.brush == null) { toast('Elige primero un turno'); return; }
    const d = day(f);
    if (S.brush === '__fb') { save(f, { fb: d.fb ? 0 : 1 }); return; }
    let code = S.brush;
    if (code && isWorkBase(code) && isSunOrFest(f)) code += 'F';
    setLayer(f, S.layer, code);
  }
  /* ───────── saldos con compañeras y la casa (todos los años) ───────── */
  function saldos() {
    const s = {};
    Object.values(MAP).forEach(d => {
      if (!d.c || d.eu || !d.o || real(d) === d.o) return;
      s[d.c] = (s[d.c] || 0) + hoursOf(real(d)) - hoursOf(d.o);
    });
    return Object.keys(s).filter(n => Math.abs(s[n]) > 0.01).sort((a, b) => (isCasa(b) - isCasa(a)) || Math.abs(s[b]) - Math.abs(s[a])).map(n => [n, s[n]]);
  }
  // días libres cercanos a una fecha (para ofrecerlos a cambio)
  function libresCerca(f, max) {
    const base = parseISO(f), hoy = iso(new Date()), out = [];
    for (let k = 1; k <= 21 && out.length < max * 2; k++) {
      [k, -k].forEach(s => {
        const dt = addDays(base, s), ff = iso(dt), d = day(ff), c = real(d);
        if (ff >= hoy && c && !worked(c) && !d.pd && !parts(c).some(p => p.base === 'V' || p.base === 'IL')) out.push(dt);
      });
    }
    return out.slice(0, max).sort((a, b) => a - b);
  }
  const diaTxt = (dt, ref) => DIAS[dt.getDay()] + ' ' + dt.getDate() + (!ref || dt.getMonth() !== ref.getMonth() ? ' de ' + MESES[dt.getMonth()] : '');
  function mensajeCambio(f) {
    const d = day(f), dt = parseISO(f), c = real(d);
    const turno = parts(c).filter(p => isWorkBase(p.base)).map(p => shortName(p.base).toLowerCase()).join(' y ') || 'turno';
    const lib = libresCerca(f, 4);
    let t = '¡Hola! ¿Me podrías cambiar la ' + turno + ' del ' + diaTxt(dt) + '?';
    if (lib.length) t += ' Yo te puedo hacer un turno el ' + lib.map(x => diaTxt(x, dt)).join(', ').replace(/, ([^,]*)$/, ' o $1') + ', que los tengo libres.';
    return t + ' ¡Gracias!';
  }

  /* ───────── planificar un viaje ───────── */
  let TRIP = null;
  function openTrip() {
    const hoy = new Date();
    TRIP = { desde: iso(addDays(hoy, 30)), hasta: iso(addDays(hoy, 37)), motivo: 'Viaje' };
    PAT = null; MP = null; ED = null;
    $('#sheet').innerHTML = `<div class="grab"></div><h2>Planificar un viaje</h2>
      <p class="muted" style="margin:6px 0 0">Elige las fechas y verás qué turnos te caen. El viaje se pinta en rosa en el calendario y los días que trabajes pasan a «Por negociar».</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span>Desde</span><input type="date" id="trip-from" value="${TRIP.desde}"></label>
        <label class="field"><span>Hasta</span><input type="date" id="trip-to" value="${TRIP.hasta}"></label></div>
      <label class="field"><span>Motivo</span><input id="trip-why" value="${TRIP.motivo}" placeholder="Ej.: viaje a Japón"></label>
      <div class="field"><span>Turnos en esas fechas</span><div id="trip-prev"></div></div>
      <div class="actions"><button type="button" class="btn ghost" id="ed-back">Volver</button><button type="button" class="btn" id="trip-apply">Marcar</button></div>`;
    drawTrip();
    $('#sheet').classList.add('on'); $('#scrim').classList.add('on');
  }
  function tripDays() {
    const out = [], a = parseISO(TRIP.desde), b = parseISO(TRIP.hasta);
    if (!(a <= b)) return out;
    for (let dt = a, n = 0; dt <= b && n < 120; dt = addDays(dt, 1), n++) out.push({ f: iso(dt), dt, d: day(iso(dt)) });
    return out;
  }
  function drawTrip() {
    const ds = tripDays(), trab = ds.filter(x => worked(real(x.d)));
    $('#trip-prev').innerHTML = ds.length ? `<div class="pat-prev">${ds.map(x => `<span class="pp${worked(real(x.d)) ? ' work' : ''}"><i>${x.dt.getDate()}</i>${pill(real(x.d))}</span>`).join('')}</div>
      <p style="margin:10px 0 0"><b>${trab.length} ${trab.length === 1 ? 'turno' : 'turnos'} que cambiar</b> · ${ds.length - trab.length} días libres o de vacaciones</p>` : '<p class="muted">Revisa las fechas: «Hasta» tiene que ser igual o posterior a «Desde».</p>';
    $('#trip-apply').textContent = !ds.length ? 'Revisa las fechas' : trab.length ? 'Apuntar y marcar ' + trab.length : 'Apuntar el viaje';
    $('#trip-apply').disabled = !ds.length;
  }
  function applyTrip() {
    const motivo = ($('#trip-why').value || 'Viaje').trim();
    const ds = tripDays(), trab = ds.filter(x => worked(real(x.d)));
    ds.forEach(x => save(x.f, worked(real(x.d)) ? { vj: motivo, pd: 1, pm: motivo } : { vj: motivo }));
    TRIP = null; closeEditor();
    S.camYear = trab.length ? trab[0].dt.getFullYear() : S.camYear;
    toast(trab.length ? trab.length + ' días marcados para negociar' : 'Viaje apuntado en el calendario'); show(trab.length ? 'cam' : 'cal');
  }

  function tripRun(f) {
    const name = day(f).vj, out = [];
    if (!name) return out;
    for (let dt = parseISO(f); day(iso(dt)).vj === name; dt = addDays(dt, -1)) out.unshift(iso(dt));
    for (let dt = addDays(parseISO(f), 1); day(iso(dt)).vj === name; dt = addDays(dt, 1)) out.push(iso(dt));
    return out;
  }
  function deleteTrip(f) {
    const name = day(f).vj, run = tripRun(f);
    run.forEach(x => { const d = day(x); save(x, d.pd && d.pm === name && !d.c ? { vj: '', pd: 0, pm: '' } : { vj: '' }); });
    closeEditor(); toast('Viaje borrado (' + run.length + ' días)');
  }

  /* ───────── buscar en las notas ───────── */
  let FIND = null;
  function openFind() {
    PAT = null; MP = null; ED = null; TRIP = null; FIND = { q: '' };
    $('#sheet').innerHTML = `<div class="grab"></div><h2>Buscar en las notas</h2>
      <div class="search" style="margin-top:12px"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="find-q" type="text" enterkeyhint="search" placeholder="Formación, médico, viaje…" autocomplete="off" aria-label="Buscar en las notas"></div>
      <div id="find-res"></div>
      <div class="actions"><button type="button" class="btn ghost" id="ed-back">Volver</button></div>`;
    drawFind();
    $('#sheet').classList.add('on'); $('#scrim').classList.add('on');
    setTimeout(() => $('#find-q').focus(), 280);
  }
  function drawFind() {
    const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const q = norm(FIND.q).trim();
    if (q.length < 2) { $('#find-res').innerHTML = '<p class="muted">Escribe al menos dos letras. Busca en las notas, en los motivos de los cambios y en los nombres de las compañeras.</p>'; return; }
    const hits = Object.values(MAP).filter(d => norm(d.n).includes(q) || norm(d.pm).includes(q) || norm(d.c).includes(q) || norm(d.vj).includes(q)).sort((a, b) => a.f < b.f ? 1 : -1).slice(0, 100);
    $('#find-res').innerHTML = hits.length ? `<p class="muted" style="margin:0 0 4px">${hits.length === 100 ? 'Los 100 más recientes' : hits.length + (hits.length === 1 ? ' día' : ' días')}</p><div class="card" style="padding:2px 16px">` + hits.map(d => {
      const dt = parseISO(d.f), txt = [d.vj && ('Viaje: ' + d.vj), d.n, d.pm && d.pm !== d.vj && ('Por negociar: ' + d.pm), d.c && ('Con ' + d.c)].filter(Boolean).join(' · ');
      return `<button type="button" class="cn" data-goday="${d.f}"><span class="d">${dt.getDate()} ${MESES_C[dt.getMonth()]}<small>${dt.getFullYear()}</small></span><span class="t">${pill(real(d))} ${esc(txt)}</span></button>`;
    }).join('') + '</div>' : '<p class="muted">No hay ningún día con eso.</p>';
  }

  /* ───────── elegir mes y año ───────── */
  let MP = null;
  function openMonthPicker() {
    PAT = null; ED = null;
    MP = { y: S.month.getFullYear() };
    $('#sheet').innerHTML = '<div class="grab"></div><h2>Ir a un mes</h2><div id="mp"></div><div class="actions"><button type="button" class="btn ghost" id="mp-today">Hoy</button><button type="button" class="btn ghost" id="ed-back">Volver</button></div>';
    drawMonthPicker();
    $('#sheet').classList.add('on'); $('#scrim').classList.add('on');
  }
  function drawMonthPicker() {
    const ys = years(), min = ys[0], max = Math.max(ys[ys.length - 1], new Date().getFullYear() + 1);
    const now = new Date();
    $('#mp').innerHTML = `<div class="mp-year"><button type="button" class="icon-btn" data-mpy="-1" aria-label="Año anterior" ${MP.y <= min ? 'disabled' : ''}>‹</button><b>${MP.y}</b><button type="button" class="icon-btn" data-mpy="1" aria-label="Año siguiente" ${MP.y >= max ? 'disabled' : ''}>›</button></div>
      <div class="mp-grid">${MESES.map((m, i) => `<button type="button" data-mpm="${i}" aria-current="${MP.y === S.month.getFullYear() && i === S.month.getMonth()}" class="${MP.y === now.getFullYear() && i === now.getMonth() ? 'now' : ''}">${cap(m)}</button>`).join('')}</div>`;
  }

  /* ───────── relleno del cuadrante con un patrón ───────── */
  const baseCode = (c) => parts(c).map(p => p.base).join('-');
  const daysBetween = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
  // Busca el ciclo que se repite en el cuadrante de los últimos meses (por ejemplo, D D D D T T M M-N cada 8 días)
  function detectPattern() {
    const fechas = Object.keys(MAP).filter(f => MAP[f].o).sort();
    if (fechas.length < 60) return null;
    const last = parseISO(fechas[fechas.length - 1]);
    const N = 365, seq = [];
    for (let i = N - 1; i >= 0; i--) { const dt = addDays(last, -i); seq.push({ dt, c: baseCode(day(iso(dt)).o) }); }
    const ok = (c) => c && parts(c).every(p => isWorkBase(p.base) || p.base === 'D');
    // el bloque de L días que más veces se repite tal cual (con al menos un turno de trabajo)
    let best = null;
    for (let L = 4; L <= 16; L++) {
      const cnt = {};
      for (let i = 0; i + L <= seq.length; i++) {
        const w = seq.slice(i, i + L).map(x => x.c);
        // solo bloques completos: empiezan con libres justo después de trabajar y acaban en turno justo antes de librar
        const prev = i > 0 ? seq[i - 1].c : null, next = i + L < seq.length ? seq[i + L].c : null;
        if (!w.every(ok) || w[0] !== 'D' || w[L - 1] === 'D' || !prev || prev === 'D' || !ok(prev) || next !== 'D') continue;
        const k = w.join(' ');
        cnt[k] = (cnt[k] || 0) + 1;
      }
      Object.keys(cnt).forEach(k => {
        const cov = cnt[k] * L;
        if (cnt[k] >= 3 && (!best || cov > best.cov * 1.05)) best = { codes: k.split(' '), n: cnt[k], cov, L };
      });
    }
    if (!best) return null;
    // que empiece por el primer día libre después de trabajar
    const L = best.L, c = best.codes;
    let r = c.findIndex((x, i) => x === 'D' && c[(i - 1 + L) % L] !== 'D');
    if (r < 0) r = 0;
    const codes = c.slice(r).concat(c.slice(0, r));
    // fase que mejor encaja con las últimas semanas del cuadrante
    let shift = 0, bm = -1;
    for (let s = 0; s < L; s++) {
      let m = 0;
      for (let i = seq.length - 2 * L; i < seq.length; i++) if (codes[(((daysBetween(last, seq[i].dt) + s) % L) + L) % L] === seq[i].c) m++;
      if (m > bm) { bm = m; shift = s; }
    }
    return { codes, anchor: last, shift, n: best.n, fit: bm / (2 * L) };
  }
  let PAT = null;
  function openPattern() {
    const det = detectPattern();
    const fechas = Object.keys(MAP).filter(f => MAP[f].o).sort();
    const desde = fechas.length ? addDays(parseISO(fechas[fechas.length - 1]), 1) : new Date();
    const hasta = new Date(desde.getFullYear(), desde.getMonth() + 1, 0);
    PAT = { codes: det ? det.codes.slice() : [], anchor: det ? det.anchor : desde, det, shift: det ? det.shift : 0, desde: iso(desde), hasta: iso(hasta), over: false };
    ED = null;
    $('#sheet').innerHTML = `<div class="grab"></div><h2>Rellenar el cuadrante con un patrón</h2>
      <p class="muted" id="pat-det" style="margin:6px 0 0"></p>
      <div class="field"><span>Patrón que se repite</span><div class="pat-seq" id="pat-seq"></div></div>
      <div class="codes" style="margin:8px 0" id="pat-add"></div>
      <div style="display:flex;gap:8px"><button type="button" class="btn ghost" id="pat-del" style="min-height:40px">⌫ Quitar el último</button><button type="button" class="btn ghost" id="pat-clear" style="min-height:40px">Empezar de cero</button></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span>Desde</span><input type="date" id="pat-from" value="${PAT.desde}"></label>
        <label class="field"><span>Hasta</span><input type="date" id="pat-to" value="${PAT.hasta}"></label></div>
      <div class="swrow" style="margin-top:12px"><span id="pat-phase"></span><span class="pat-arrows"><button type="button" class="icon-btn" data-patshift="-1" aria-label="Empezar una posición antes">‹</button><button type="button" class="icon-btn" data-patshift="1" aria-label="Empezar una posición después">›</button></span></div>
      <div class="row-toggle"><label for="pat-over">Sustituir días ya rellenos<small>Si está apagado, solo rellena los días vacíos del cuadrante</small></label><input type="checkbox" class="switch" id="pat-over"></div>
      <div class="field"><span>Vista previa</span><div class="pat-prev" id="pat-prev"></div></div>
      <p class="muted" style="font-size:.85rem">Se apunta en el cuadrante y en el real a la vez. Domingos y festivos llevan la F solos.</p>
      <div class="actions"><button type="button" class="btn ghost" id="ed-back">Volver</button><button type="button" class="btn" id="pat-apply">Rellenar</button></div>`;
    $('#pat-add').innerHTML = [...Object.keys(CODES).filter(b => isWorkBase(b) || b === 'D'), 'M-N', 'T-N', 'M-T'].map(c => `<button type="button" class="code-btn" data-patadd="${c}" style="background:${bg(c)}">${esc(c)}</button>`).join('');
    drawPattern();
    $('#sheet').classList.add('on'); $('#scrim').classList.add('on');
  }
  function patCode(dt) {
    const L = PAT.codes.length; if (!L) return '';
    const i = (((daysBetween(PAT.anchor, dt) + PAT.shift) % L) + L) % L;
    return PAT.codes[i];
  }
  function patDays() {
    const out = [], a = parseISO(PAT.desde), b = parseISO(PAT.hasta);
    if (!PAT.codes.length || !(a <= b)) return out;
    for (let dt = a, n = 0; dt <= b && n < 400; dt = addDays(dt, 1), n++) {
      const f = iso(dt);
      if (!PAT.over && day(f).o) continue;
      out.push({ f, dt, code: compose(parts(patCode(dt)).map(p => ({ base: p.base, f: isSunOrFest(f) }))) });
    }
    return out;
  }
  function drawPattern() {
    const det = PAT.det;
    $('#pat-det').textContent = det ? 'Este bloque de ' + det.codes.length + ' días se repite ' + det.n + ' veces en tu cuadrante del último año. Revisa por qué turno empieza enero con las flechas, o cambia el patrón.' : 'No he encontrado un ciclo claro. Crea el patrón tocando los turnos en orden.';
    $('#pat-seq').innerHTML = PAT.codes.length ? PAT.codes.map((c, i) => `<span class="pill" style="background:${bg(c)}">${esc(c)}</span>`).join('') : '<span class="muted">Toca los turnos de abajo en orden</span>';
    const a = parseISO(PAT.desde);
    const c0 = patCode(a);
    $('#pat-phase').innerHTML = c0 ? `El ${a.getDate()} de ${MESES[a.getMonth()]} empieza por ${pill(c0)}` : '';
    const dias = patDays();
    $('#pat-prev').innerHTML = dias.length ? dias.slice(0, 21).map(x => `<span class="pp"><i>${x.dt.getDate()}</i>${pill(x.code)}</span>`).join('') + (dias.length > 21 ? `<span class="muted" style="align-self:center">… y ${dias.length - 21} más</span>` : '') : '<span class="muted">No hay días que rellenar con estas fechas.</span>';
    $('#pat-apply').textContent = dias.length ? 'Rellenar ' + dias.length + (dias.length === 1 ? ' día' : ' días') : 'Rellenar';
    $('#pat-apply').disabled = !dias.length;
  }
  function applyPattern() {
    const dias = patDays();
    dias.forEach(x => setLayer(x.f, 'orig', x.code));
    const first = dias[0];
    PAT = null; closeEditor();
    if (first) { S.month = new Date(first.dt.getFullYear(), first.dt.getMonth(), 1); renderCal(); }
    toast('Cuadrante rellenado: ' + dias.length + ' días');
  }

  // Guarda un código en una capa; si toca el cuadrante y el real no se había cambiado, el real le sigue.
  function setLayer(f, layer, code, extra) {
    const d = day(f), patch = Object.assign({}, extra || {});
    if (layer === 'orig') {
      patch.o = code;
      if (!d.r || d.r === d.o) patch.r = code;
    } else patch.r = code;
    save(f, patch);
  }

  const ICON_EDIT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
  const ICON_OK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

  const MODE_HELP = {
    nada: 'El cambio ya está hecho, pero falta devolverlo: las horas quedan en el saldo con esa compañera.',
    dia: 'Se compensa con otro día concreto: elige cuál y se actualizan los dos.',
    dinero: 'Se paga o se cobra: no deja horas de deuda.'
  };

  /* ───────── editor ───────── */
  let ED = null;
  function openEditor(f, focus) {
    const d = day(f), dt = parseISO(f);
    const layer = S.view === 'cal' ? S.layer : 'real';
    ED = { prevF: Object.fromEntries(parts(codeIn(d, layer)).map(p => [p.base, p.f])), f, layer, sel: parts(codeIn(d, layer)).map(p => p.base), fest: parts(codeIn(d, layer)).some(p => p.f) || (!codeIn(d, layer) && isSunOrFest(f)), fb: !!d.fb, im: !!d.im, n: d.n || '', c: d.c || '', pd: !!d.pd, pm: d.pm || '', vj: d.vj || '', eu: d.eu || 0, sw: d.sw || '', mode: d.sw ? 'dia' : d.eu ? 'dinero' : 'nada' };
    const names = [...new Set(Object.values(MAP).map(x => x.c).filter(Boolean))].sort();
    const sh = $('#sheet');
    sh.innerHTML = `<div class="ed-head"><div class="grab"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div><h2 id="ed-title">${fechaLarga(dt)} ${dt.getFullYear()}</h2><div class="muted">${FEST[f] ? esc(FEST[f]) + ' · ' : ''}${d.o ? 'Cuadrante: ' + esc(d.o) : 'Sin cuadrante'}</div></div>
        <div class="seg" role="group" aria-label="Qué guardar"><button data-ly="real" aria-pressed="${layer === 'real'}">Real</button><button data-ly="orig" aria-pressed="${layer === 'orig'}">Cuadrante</button></div>
      </div></div>
      <div class="codes" id="ed-codes"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span class="preview" id="ed-prev"></span><span class="muted" id="ed-hours"></span></div>
      <div class="row-toggle"><label for="ed-fest">Festivo<small>Añade la F a los turnos trabajados</small></label><input type="checkbox" class="switch" id="ed-fest" ${ED.fest ? 'checked' : ''}></div>
      <div class="row-toggle"><label for="ed-fb">Mañana en Fibao<small>${esc(cfg().fibao_inicio || '')}–${esc(cfg().fibao_fin || '')}</small></label><input type="checkbox" class="switch fb" id="ed-fb" ${ED.fb ? 'checked' : ''}></div>
      <div class="row-toggle"><label for="ed-im">Fecha a tener en cuenta<small>Sale en Hoy y en el calendario del iPhone</small></label><input type="checkbox" class="switch" id="ed-im" ${ED.im ? 'checked' : ''}></div>
      <label class="field"><span>Nota</span><textarea id="ed-n" rows="2" placeholder="Ej.: formación, médico, cumpleaños…">${esc(ED.n)}</textarea></label>
      ${ED.vj ? `<div class="trip-row"><span><b>${esc(ED.vj)}</b><small>${tripRun(ED.f).length} días en el calendario</small></span><button type="button" class="btn ghost" data-tripdel="${ED.f}">Borrar el viaje</button></div>` : ''}
      <h3 class="ed-group">Cambio de turno</h3>
      <div class="row-toggle"><label for="ed-pd">Necesito cambiar este día<small>Lo apunta en «Por negociar», en la pantalla Cambios</small></label><input type="checkbox" class="switch pd" id="ed-pd" ${ED.pd ? 'checked' : ''}></div>
      <label class="field" id="ed-pm-wrap" ${ED.pd ? '' : 'hidden'}><span>Para qué lo necesitas</span><input id="ed-pm" value="${esc(ED.pm)}" placeholder="Ej.: viaje, boda, médico…" autocomplete="off"></label>
      <label class="field"><span>Cambio con</span><input id="ed-c" list="ed-names" value="${esc(ED.c)}" placeholder="Nombre de la compañera" autocomplete="off"><datalist id="ed-names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist></label>
      <div class="quick"><button type="button" data-quickc="${CASA}">${ICON_CASA}La casa</button><small>Para cambios impuestos por la supervisora o por una formación</small></div>
      <div class="field"><span>Cómo se compensa</span><div class="seg wide" role="group" aria-label="Cómo se compensa">
        <button type="button" data-mode="nada" aria-pressed="${ED.mode === 'nada'}">Pendiente</button><button type="button" data-mode="dia" aria-pressed="${ED.mode === 'dia'}">Otro día</button><button type="button" data-mode="dinero" aria-pressed="${ED.mode === 'dinero'}">Dinero</button></div><small class="mode-help" id="ed-mode-help">${MODE_HELP[ED.mode]}</small></div>
      <div id="ed-mode-dia" ${ED.mode === 'dia' ? '' : 'hidden'}>
      <div class="field"><span>Toca el día en este calendario</span><input type="hidden" id="ed-sw" value="${esc(ED.sw)}"><div class="mini" id="ed-mini"></div></div>
      <div class="swbox" id="ed-sw-box" hidden></div></div>
      <div id="ed-mode-dinero" ${ED.mode === 'dinero' ? '' : 'hidden'}>
      <div class="field"><span>Importe</span><div class="money">
        <div class="seg" role="group" aria-label="Cobro o pago"><button data-eus="1" aria-pressed="${ED.eu >= 0}">Cobro</button><button data-eus="-1" aria-pressed="${ED.eu < 0}">Pago</button></div>
        <input id="ed-eu" inputmode="decimal" value="${ED.eu ? String(Math.abs(ED.eu)).replace('.', ',') : ''}" placeholder="0" aria-label="Importe en euros"><span class="muted">€</span></div></div></div>
      <div class="actions"><button class="btn danger" id="ed-clear">Vaciar</button><button class="btn ghost" id="ed-back">Volver</button><button class="btn" id="ed-save">Guardar</button></div>`;
    drawCodes(); drawSwap();
    sh.classList.add('on'); $('#scrim').classList.add('on');
    setTimeout(() => {
      if (focus === 'c') {
        // viene de «Añadir con quién»: lleva la ventana hasta el campo y lo resalta
        const c = $('#ed-c'); c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.focus({ preventScroll: true });
        c.classList.add('ask'); setTimeout(() => c.classList.remove('ask'), 1600);
      } else $('#ed-save').focus({ preventScroll: true });
    }, 280);
  }
  function drawCodes() {
    $('#ed-codes').innerHTML = Object.keys(CODES).map(b => {
      const i = ED.sel.indexOf(b);
      return `<button class="code-btn" data-code="${b}" aria-pressed="${i >= 0}" style="background:${info(b).color};--cc:${info(b).color}" title="${esc(info(b).nombre)}">${esc(b)}${i >= 0 && ED.sel.length > 1 ? '<span class="ord">' + (i + 1) + '</span>' : ''}</button>`;
    }).join('');
    const code = edCode();
    $('#ed-prev').innerHTML = code ? pill(code, 'pill') + ' <span style="font-size:1rem;color:var(--ink-2)">' + esc(parts(code).map(p => info(p.base).nombre).join(' + ')) + '</span>' : '<span class="muted" style="font-size:1rem">Sin turno</span>';
    $('#ed-hours').textContent = code ? fmtH(hoursOf(code)) + ' h' : '';
  }
  // Otro día del intercambio: calendario pequeño con los turnos de cada día y el turno que hará ese día
  function drawMini() {
    if (!ED.miniM) { const b = parseISO($('#ed-sw').value || ED.f); ED.miniM = new Date(b.getFullYear(), b.getMonth(), 1); }
    const m0 = ED.miniM, y = m0.getFullYear(), m = m0.getMonth(), sel = $('#ed-sw').value;
    let html = `<div class="mini-head"><button type="button" class="icon-btn" data-mini="-1" aria-label="Mes anterior">‹</button><b>${cap(MESES[m])} ${y}</b><button type="button" class="icon-btn" data-mini="1" aria-label="Mes siguiente">›</button></div><div class="mini-grid">`;
    html += ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(x => `<span class="mini-wd">${x}</span>`).join('');
    for (let i = 0; i < (m0.getDay() + 6) % 7; i++) html += '<span></span>';
    for (let dt = new Date(y, m, 1); dt.getMonth() === m; dt = addDays(dt, 1)) {
      const f = iso(dt), d = day(f), c = real(d), self = f === ED.f;
      html += `<button type="button" class="mini-d${f === sel ? ' sel' : ''}${self ? ' self' : ''}${d.pd ? ' pendday' : ''}${isSunOrFest(f) ? ' fest' : ''}" ${self ? 'disabled' : `data-pick="${f}"`} aria-label="${fechaLarga(dt)}: ${esc(c || 'sin turno')}">
        <i>${dt.getDate()}</i><b style="${c ? 'background:' + bg(c) : ''}">${esc(c) || '·'}</b></button>`;
    }
    $('#ed-mini').innerHTML = html + '</div>';
  }
  function drawSwap() {
    drawMini();
    const box = $('#ed-sw-box'), f2 = $('#ed-sw').value;
    if (!f2 || f2 === ED.f) { box.hidden = true; box.innerHTML = ''; return; }
    const d2 = day(f2), dt2 = parseISO(f2), d1 = day(ED.f);
    if (ED.swFor !== f2) {
      // turno propuesto para ese día: si ya estaba enlazado, el que tiene; si no, el que cede en el día original
      // si en este día hace turnos de más, el otro día libra (D); si cede turnos, el otro día los hace ella
      const ow = parts(d1.o || '').filter(p => isWorkBase(p.base)).map(p => p.base), nw = ED.sel.filter(isWorkBase);
      const gana = nw.filter(b => !ow.includes(b)), cede = ow.filter(b => !nw.includes(b));
      ED.swc = d2.sw === ED.f ? parts(real(d2)).map(p => p.base).join('-') : (gana.length && !cede.length ? 'D' : cede.length ? cede.join('-') : (ow.length ? ow.join('-') : 'D'));
      ED.swFor = f2;
    }
    const opts = [...new Set([ED.swc, ...Object.keys(CODES).filter(isWorkBase), 'M-N', 'T-N', 'M-T', ...Object.keys(CODES).filter(b => !isWorkBase(b))])].filter(Boolean);
    box.hidden = false;
    box.innerHTML = `<div class="swrow"><span><b>${fechaLarga(dt2)}</b><br><span class="muted">ahora tienes</span> ${pill(real(d2))}</span><button type="button" class="btn ghost" data-pick="" style="min-height:36px;padding:0 12px">Quitar</button></div>
      <div><div style="font-size:.9rem;color:var(--ink-2);margin-bottom:6px">Turno que le haces ese día</div>
      <div class="codes" style="margin:0">${opts.map(o => `<button type="button" class="code-btn" data-swc="${esc(o)}" aria-pressed="${o === ED.swc}" style="background:${bg(o)};--cc:${info(parts(o)[0].base).color}">${esc(o)}</button>`).join('')}</div></div>
      <div class="muted" style="font-size:.85rem">Al guardar se actualizan los dos días en el calendario real.</div>`;
  }
  // La F de festivo: los turnos que ya la llevaban la conservan (p. ej. la noche del sábado);
  // los nuevos solo la llevan si el día es domingo o festivo
  function edCode() {
    const prev = ED.prevF || {}, any = Object.values(prev).some(Boolean);
    return compose(ED.sel.map(b => ({ base: b, f: ED.fest && (b in prev ? (any ? prev[b] : true) : (!any || isSunOrFest(ED.f))) })));
  }
  function closeEditor() { PAT = null; MP = null; TRIP = null; FIND = null; closeSheet(); }
  function closeSheet() { $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); ED = null; if (S.reloadPending) setTimeout(S.reloadPending, 300); }
  // Guardar siempre cierra la ventana; si algo falla, se avisa en vez de quedarse abierta
  function saveEditor() {
    try { saveEditorInner(); } catch (err) { toast('No se ha podido guardar: ' + (err && err.message || err)); }
    finally { closeEditor(); }
  }
  function saveEditorInner() {
    ED.n = $('#ed-n').value.trim(); ED.c = $('#ed-c').value.trim(); ED.pm = $('#ed-pm').value.trim();
    const amt = parseFloat(($('#ed-eu').value || '').replace(',', '.'));
    const sign = $('[data-eus="-1"]').getAttribute('aria-pressed') === 'true' ? -1 : 1;
    const eu = ED.mode === 'dinero' && isFinite(amt) && amt > 0 ? Math.round(sign * amt * 100) / 100 : 0;
    const code = edCode(), d = day(ED.f);
    // si el cambio ya está hecho (turno distinto del cuadrante y con nombre), deja de estar pendiente
    let cerrado = false;
    if (ED.pd && ED.layer === 'real' && ED.c && d.o && code !== d.o) { ED.pd = false; cerrado = true; }
    const sw = ED.mode === 'dia' && $('#ed-sw').value && $('#ed-sw').value !== ED.f ? $('#ed-sw').value : '';
    setLayer(ED.f, ED.layer, code, { fb: ED.fb ? 1 : 0, im: ED.im ? 1 : 0, n: ED.n, c: ED.c, pd: ED.pd ? 1 : 0, pm: ED.pd || cerrado ? ED.pm : '', eu, sw });
    // el otro día del intercambio
    if (ED.sw && ED.sw !== sw && day(ED.sw).sw === ED.f) save(ED.sw, { sw: '' });
    if (sw) {
      const sel = ED.swc || '';
      const code2 = compose(parts(sel).map(p => ({ base: p.base, f: isSunOrFest(sw) })));
      save(sw, { r: code2, c: ED.c, sw: ED.f });
    }
    toast(sw ? 'Guardados los dos días' : cerrado ? 'Cambio cerrado y guardado' : 'Guardado');
    closeEditor();
  }

  /* ───────── Resumen ───────── */
  function years() {
    const ys = new Set(Object.keys(MAP).map(f => Number(f.slice(0, 4))));
    ys.add(new Date().getFullYear());
    return [...ys].sort();
  }
  function renderRes() {
    const y = S.resYear, st = stats(y);
    $('#res-title').textContent = y;
    if (!st.any) { $('#res-body').innerHTML = `<div class="empty-note">Todavía no hay turnos en ${y}. Apunta el cuadrante en Calendario con el botón Editar y aquí verás el resumen.</div>`; return; }
    const jor = num(cfg().jornada_anual), hFb = num(cfg().horas_fibao), vac = num(cfg().dias_vacaciones);
    const now = new Date(), curYear = now.getFullYear() === y;
    let html = `<div class="card"><div class="muted">Horas en el SAS ${curYear ? 'con lo ya planificado' : ''}</div><div class="big">${fmtH(st.hours)} h</div>
      <div style="margin-top:6px;color:var(--ink-2)">Cuadrante original: ${fmtH(st.hoursOrig)} h · diferencia <b class="${st.hours - st.hoursOrig >= 0 ? 'pos' : 'neg'}">${st.hours - st.hoursOrig >= 0 ? '+' : '−'}${fmtH(Math.abs(st.hours - st.hoursOrig))} h</b></div>`;
    if (jor) {
      const dif = st.hours - jor;
      html += `<div class="meter"><b style="width:${Math.min(100, st.hours / jor * 100)}%"></b></div><div style="font-size:.9rem">Jornada anual ${fmtH(jor)} h · <b class="${dif >= 0 ? 'pos' : 'neg'}">${dif >= 0 ? 'te sobran ' : 'te faltan '}${fmtH(Math.abs(dif))} h</b></div>`;
    }
    if (st.IL) html += `<div class="tot"><span>Días de baja (IL)</span><b>${st.IL} ${st.IL === 1 ? 'día' : 'días'}</b></div>`;
    html += '</div>';
    // Desglose de la diferencia con el cuadrante y dinero de los cambios
    const P = st.por, sh = (h) => (h > 0 ? '+' : h < 0 ? '−' : '') + fmtH(Math.abs(h)) + ' h';
    const rows = [
      ['cob', 'Cambios cobrados'], ['pag', 'Cambios pagados'], ['dia', 'Intercambios por otro día'],
      ['casa', 'Con la casa'], ['pend', 'Pendientes con compañeras'], ['sin', 'Sin anotar con quién']
    ].filter(([k]) => P[k][1]);
    if (rows.length) {
      html += `<div class="card" style="margin-top:10px"><h3>De dónde sale la diferencia</h3><div class="desg">` + rows.map(([k, n]) =>
        `<div class="dr"><span>${n}<small>${P[k][1]} ${P[k][1] === 1 ? 'cambio' : 'cambios'}${k === 'cob' ? ' · ' + fmtE(st.cobrado || 0) : k === 'pag' ? ' · ' + fmtE(st.pagado || 0) : ''}</small></span><b class="${P[k][0] > 0 ? 'pos' : P[k][0] < 0 ? 'neg' : 'muted'}">${sh(P[k][0])}</b></div>`).join('') +
        `<div class="dr tot2"><span>Diferencia con el cuadrante</span><b>${sh(st.hours - st.hoursOrig)}</b></div></div>`;
      if (st.cobrado || st.pagado) {
        const bal = (st.cobrado || 0) - (st.pagado || 0);
        html += `<div class="money-card" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
          <div><div class="k">Cobrado</div><div class="v pos">${fmtE(st.cobrado || 0)}</div></div>
          <div><div class="k">Pagado</div><div class="v neg">${fmtE(st.pagado || 0)}</div></div>
          <div><div class="k">Balance</div><div class="v ${bal >= 0 ? 'pos' : 'neg'}">${bal >= 0 ? '+' : '−'}${fmtE(Math.abs(bal))}</div></div></div>`;
      }
      html += '</div>';
    }
    // Fibao es un segundo trabajo: sus horas van aparte y no cuentan para la jornada del SAS
    if (st.fb) {
      html += `<div class="card" style="margin-top:10px;border-left:4px solid var(--fibao)"><div class="muted">Horas en Fibao · segundo trabajo, no cuentan en la jornada del SAS</div>` +
        (hFb ? `<div class="big" style="color:var(--fibao)">${fmtH(st.fb * hFb)} h</div><div style="margin-top:6px;color:var(--ink-2)">${st.fb} ${st.fb === 1 ? 'mañana' : 'mañanas'} × ${fmtH(hFb)} h</div>
          <div class="tot"><span>Total trabajado (SAS + Fibao)</span><b>${fmtH(st.hours + st.fb * hFb)} h</b></div>`
          : `<div class="big" style="color:var(--fibao)">${st.fb} ${st.fb === 1 ? 'mañana' : 'mañanas'}</div><p class="muted" style="margin:6px 0 0;font-size:.88rem">Pon en Ajustes las horas de una mañana en Fibao para ver las horas y el total.</p>`) + '</div>';
    }
    const s = (v, k, c) => `<div class="stat" style="--c:${c}"><div class="v">${v}</div><div class="k">${k}</div></div>`;
    const compTxt = Object.keys(st.comp).map(k => k + ' ' + st.comp[k]).join(' · ') || 'ninguna';
    html += `<div class="statgrid">${s(st.M, 'mañanas', 'var(--m)')}${s(st.T, 'tardes', 'var(--t)')}${s(st.N, 'noches', 'var(--n)')}
      ${s(st.fest, 'turnos en festivo', 'var(--fest)')}${s(st.dom, 'domingos trabajados', 'var(--fest)')}${s(st.fb, 'mañanas en Fibao', 'var(--fibao)')}
      ${s(st.V + (vac ? '<small style="font-size:.9rem;color:var(--ink-3)"> / ' + vac + '</small>' : ''), 'días de vacaciones', 'var(--v)')}${s(Object.values(st.comp).reduce((a, b) => a + b, 0), 'compensaciones', 'var(--comp)')}${s(st.cambios, 'días cambiados', 'var(--ink-3)')}</div>
      <p class="muted" style="font-size:.85rem;margin:8px 2px 0">Compensaciones: ${esc(compTxt)}</p>`;
    html += `<div class="section"><h3>Horas por mes</h3><div class="card chart">${monthChart(st)}<div class="keyline"><span><i style="background:var(--ink)"></i>Real</span><span><i style="background:var(--line);outline:1px solid var(--ink-3)"></i>Cuadrante</span></div></div></div>`;
    html += `<div class="section"><h3>Horas en el SAS, año a año</h3><div class="card chart">${yearsChart(y)}</div></div>`;
    html += `<div class="section"><h3>Turnos por año</h3><div class="card chart">${turnosChart(y)}</div></div>`;
    $('#res-body').innerHTML = html;
  }
  function monthChart(st) {
    const W = 340, H = 180, top = 14, bot = 22, left = 4, max = Math.max(1, ...st.months.map(m => Math.max(m.r, m.o)));
    const gw = (W - left) / 12, bw = gw * .32;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Horas por mes, real frente a cuadrante">`;
    const sc = (v) => (H - top - bot) * v / max;
    st.months.forEach((m, i) => {
      const x = left + i * gw + gw * .14;
      svg += `<rect x="${x}" y="${H - bot - sc(m.o)}" width="${bw}" height="${sc(m.o)}" rx="3" fill="var(--line)" stroke="var(--ink-3)" stroke-width=".6"><title>${MESES[i]}: cuadrante ${fmtH(m.o)} h</title></rect>`;
      svg += `<rect x="${x + bw + 2}" y="${H - bot - sc(m.r)}" width="${bw}" height="${sc(m.r)}" rx="3" fill="var(--ink)"><title>${MESES[i]}: real ${fmtH(m.r)} h</title></rect>`;
      if (m.r) svg += `<text x="${x + bw + 2 + bw / 2}" y="${H - bot - sc(m.r) - 3}" text-anchor="middle" style="font-size:9px">${Math.round(m.r)}</text>`;
      svg += `<text x="${left + i * gw + gw / 2}" y="${H - 6}" text-anchor="middle">${MESES_C[i]}</text>`;
    });
    return svg + '</svg>';
  }
  // Barras agrupadas por año: un color por tipo de turno
  const SERIES = [['M', 'Mañanas', 'var(--m)'], ['T', 'Tardes', 'var(--t)'], ['N', 'Noches', 'var(--n)'], ['sab', 'Sábados trabajados', 'var(--v)'], ['fest', 'Turnos en festivo', 'var(--fest)']];
  function turnosChart(sel) {
    const rows = years().map(y => ({ y, s: stats(y) })).filter(r => r.s.any && (r.s.M + r.s.T + r.s.N) > 0);
    if (!rows.length) return '<p class="muted">Sin datos.</p>';
    const max = Math.max(1, ...rows.flatMap(r => SERIES.map(([k]) => r.s[k])));
    return '<div class="tys">' + rows.map(r => `<div class="ty${r.y === sel ? ' sel' : ''}"><div class="ty-h">${r.y}</div>` +
      SERIES.map(([k, name, col]) => `<div class="ty-r"><span class="ty-l">${name}</span><span class="ty-b"><i style="width:${r.s[k] ? Math.max(1.5, r.s[k] / max * 100) : 0}%;background:${col}"></i></span><span class="ty-v">${r.s[k]}</span></div>`).join('') +
      '</div>').join('') + '</div>';
  }
  function yearsChart(sel) {
    const hFbY = num(cfg().horas_fibao);
    const rows = years().map(y => ({ y, s: stats(y) })).filter(r => r.s.any);
    const max = Math.max(1, ...rows.map(r => r.s.hours));
    return '<div class="yrs">' + rows.map(r => `<div class="yr${r.y === sel ? ' sel' : ''}">
      <span class="yl">${r.y}</span>
      <span class="yb"><i style="width:${Math.max(2, r.s.hours / max * 100)}%"></i></span>
      <span class="yh">${fmtH(r.s.hours)} h</span>
      <span class="ym">${r.s.N} ${r.s.N === 1 ? 'noche' : 'noches'} · ${r.s.fest} ${r.s.fest === 1 ? 'festivo' : 'festivos'} · ${r.s.fb} Fibao${hFbY ? ' (' + fmtH(r.s.fb * hFbY) + ' h)' : ''}${r.s.IL ? ' · ' + r.s.IL + (r.s.IL === 1 ? ' día' : ' días') + ' de baja' : ''}</span></div>`).join('') + '</div>';
  }

  /* ───────── Cambios ───────── */
  // Frase en lenguaje natural: quién hizo qué turno
  function frase(d) {
    const ow = parts(d.o || '').filter(p => isWorkBase(p.base)).map(p => p.base), rw = parts(real(d)).filter(p => isWorkBase(p.base)).map(p => p.base);
    const lost = ow.filter(b => !rw.includes(b)), gained = rw.filter(b => !ow.includes(b));
    const nm = (l) => l.map(b => shortName(b).toLowerCase()).join(' y ');
    if (isCasa(d.c)) {
      if (gained.includes('FOR')) return 'Formación impuesta por la casa';
      if (lost.length && !gained.length) return 'La casa me quita la ' + nm(lost);
      if (gained.length && !lost.length) return 'La casa me pone una ' + nm(gained);
      if (lost.length && gained.length) return 'La casa me cambia la ' + nm(lost) + ' por una ' + nm(gained);
      return 'Cambio impuesto por la casa';
    }
    if (lost.length && !gained.length) return d.c + ' hace mi ' + nm(lost);
    if (gained.length && !lost.length) return 'Yo hago la ' + nm(gained) + ' de ' + d.c;
    if (lost.length && gained.length) return 'Cambio mi ' + nm(lost) + ' por la ' + nm(gained) + ' de ' + d.c;
    return '';
  }
  function renderCam() {
    const y = S.camYear, today = iso(new Date());
    $('#cam-title').textContent = 'Cambios ' + y;
    const list = [], pend = [];
    for (let dt = new Date(y, 0, 1); dt.getFullYear() === y; dt = addDays(dt, 1)) {
      const f = iso(dt), d = MAP[f];
      if (!d) continue;
      if (d.pd && y !== new Date().getFullYear()) pend.push({ f, dt, d });
      if ((d.o && real(d) !== d.o) || d.eu) list.push({ f, dt, d, delta: d.o ? hoursOf(real(d)) - hoursOf(d.o) : 0 });
    }
    // año actual: también los días por negociar de los años siguientes (un viaje en enero, por ejemplo)
    if (y === new Date().getFullYear()) Object.keys(MAP).filter(f => MAP[f].pd && f.slice(0, 4) >= String(y)).sort().forEach(f => pend.push({ f, dt: parseISO(f), d: MAP[f] }));
    // buscador por compañera (sin distinguir mayúsculas ni tildes)
    const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    $('#cam-names').innerHTML = [...new Set(list.map(x => x.d.c).filter(Boolean))].sort().map(n => `<option value="${esc(n)}">`).join('');
    const q = norm(S.camQ);
    $('#cam-q-clear').hidden = !q;
    if (q) {
      const fl = list.filter(x => x.d.c && norm(x.d.c).includes(q));
      list.length = 0; fl.forEach(x => list.push(x));
      if (!list.length) { $('#cam-body').innerHTML = `<div class="empty-note">No hay cambios en ${y} con «${esc(S.camQ)}». Prueba con otro nombre o con otro año.</div>`; return; }
    }
    let html = q ? '' : `<div class="h3row"><h3>Por negociar${pend.length ? ' · ' + pend.length : ''}</h3><button type="button" class="btn ghost" id="trip-open" style="min-height:38px;padding:0 12px;font-size:.9rem">Planificar un viaje</button></div>`;
    if (!q) html += pend.length ? '<div class="card" style="padding:4px 16px">' + pend.map(x => `
      <button class="chg" data-edit="${x.f}" data-focus="c"><span class="dt">${x.dt.getDate()} ${MESES_C[x.dt.getMonth()]}<small>${DIAS[x.dt.getDay()]}${x.dt.getFullYear() !== y ? ' ' + x.dt.getFullYear() : ''}</small></span>
      <span><span class="pills">${pill(real(x.d))}${x.f < today ? '<span class="muted" style="font-size:.8rem">ya pasó</span>' : ''}</span><span class="who">${esc(x.d.pm || 'Sin motivo apuntado')}</span></span>
      <span class="resolve">Resolver</span></button>${x.f >= today ? `<a class="wa" href="https://wa.me/?text=${encodeURIComponent(mensajeCambio(x.f))}" target="_blank" rel="noopener">Pedir el cambio por WhatsApp</a>` : ''}`).join('') + '</div>'
      : '<div class="empty-note">No tienes días por negociar. Para apuntar uno, abre el día y activa «Necesito cambiar este día».</div>';
    if (!q) {
      // viajes del año: cada tramo seguido de días con el mismo nombre de viaje
      // los del año que miras y, si miras el año actual, también los próximos aunque sean del año siguiente
      const hoyY = new Date().getFullYear(), trips = Object.keys(MAP).filter(f => MAP[f].vj && day(iso(addDays(parseISO(f), -1))).vj !== MAP[f].vj).sort()
        .map(tripRun).filter(run => run[0].slice(0, 4) == y || (y === hoyY && run[run.length - 1] >= today));
      if (trips.length) html += `<div class="section"><h3>${y === hoyY ? 'Viajes' : 'Viajes ' + y}</h3><div class="card" style="padding:4px 16px">` + trips.map(run => {
        const a0 = parseISO(run[0]), b0 = parseISO(run[run.length - 1]), ds = run.map(day);
        const sinTurnos = ds.filter(d => !real(d)).length, np = ds.filter(d => d.pd).length, nt = ds.filter(d => !d.pd && worked(real(d))).length;
        const est = sinTurnos === ds.length ? '<span class="muted">Aún sin cuadrante: los turnos que te toque se marcarán solos</span>' : np ? `<span class="neg">${np} ${np === 1 ? 'turno' : 'turnos'} por negociar</span>` : nt ? `<span class="neg">Trabajas ${nt} ${nt === 1 ? 'día' : 'días'}</span>` : sinTurnos ? `<span class="muted">${sinTurnos} ${sinTurnos === 1 ? 'día' : 'días'} aún sin turno</span>` : '<span class="pos">Todo libre</span>';
        const rango = (run.length === 1 ? a0.getDate() + ' ' + MESES_C[a0.getMonth()] : a0.getDate() + (a0.getMonth() !== b0.getMonth() ? ' ' + MESES_C[a0.getMonth()] : '') + '–' + b0.getDate() + ' ' + MESES_C[b0.getMonth()]) + (b0.getFullYear() !== y ? ' ' + b0.getFullYear() : '');
        return `<button type="button" class="chg trip-item" data-gotrip="${run[0]}"><span class="dt">${a0.getDate()} ${MESES_C[a0.getMonth()]}<small>${run.length} ${run.length === 1 ? 'día' : 'días'}</small></span>
          <span><span class="who"><span class="tripdot"></span>${esc(ds[0].vj)}</span><span class="muted" style="display:block;font-size:.85rem">${rango} · ${est}</span></span><span class="resolve">Ver</span></button>`;
      }).join('') + '</div></div>';
    }
    if (!list.length) { $('#cam-body').innerHTML = html + `<div class="section"><div class="empty-note">No hay cambios hechos en ${y}: el calendario real coincide con el cuadrante.</div></div>`; return; }
    const cobrado = list.reduce((s, x) => s + (x.d.eu > 0 ? x.d.eu : 0), 0), pagado = list.reduce((s, x) => s + (x.d.eu < 0 ? -x.d.eu : 0), 0);
    if (cobrado || pagado) {
      const bal = cobrado - pagado;
      html += `<div class="section"><h3>Dinero en ${y}</h3><div class="card money-card">
        <div><div class="k">Cobrado</div><div class="v pos">${fmtE(cobrado)}</div></div>
        <div><div class="k">Pagado</div><div class="v neg">${fmtE(pagado)}</div></div>
        <div><div class="k">Balance</div><div class="v ${bal >= 0 ? 'pos' : 'neg'}">${bal >= 0 ? '+' : '−'}${fmtE(Math.abs(bal))}</div></div></div></div>`;
    }
    const saldo = {}, euros = {};
    list.forEach(x => { if (x.d.c) { saldo[x.d.c] = (saldo[x.d.c] || 0) + (x.d.eu ? 0 : x.delta); euros[x.d.c] = (euros[x.d.c] || 0) + (x.d.eu || 0); } });
    const sinNombre = list.filter(x => !x.d.c).length;
    html += '<div class="section"><h3>Saldo por compañera</h3><div class="card">';
    const names = Object.keys(saldo).sort((a, b) => (isCasa(b) - isCasa(a)) || Math.abs(saldo[b]) - Math.abs(saldo[a]));
    html += names.length ? names.map(n => `<div class="saldo${isCasa(n) ? ' casa' : ''}"><span class="who">${isCasa(n) ? ICON_CASA : ''}${esc(n)}${isCasa(n) ? '<small>hospital · supervisión · formación</small>' : ''}</span><span style="text-align:right"><span class="h ${saldo[n] > 0 ? 'pos' : saldo[n] < 0 ? 'neg' : ''}">${saldo[n] === 0 ? 'horas en paz' : (saldo[n] > 0 ? 'te debe ' : 'le debes ') + fmtH(Math.abs(saldo[n])) + ' h'}</span>${euros[n] ? `<br><span class="${euros[n] > 0 ? 'pos' : 'neg'}" style="font-size:.88rem">${euros[n] > 0 ? 'le has cobrado ' : 'le has pagado '}${fmtE(Math.abs(euros[n]))}</span>` : ''}</span></div>`).join('')
      : '<p class="muted" style="margin:0">Pon con quién hiciste cada cambio y aquí verás quién debe horas a quién.</p>';
    html += '</div></div>';
    if (sinNombre) html += `<p class="muted" style="font-size:.88rem;margin:8px 2px 0">${sinNombre} ${sinNombre === 1 ? 'cambio sin nombre' : 'cambios sin nombre'}. Tócalos para añadir con quién fue.</p>`;
    html += `<div class="section"><h3>${list.length} ${list.length === 1 ? 'cambio hecho' : 'cambios hechos'}</h3><div class="card" style="padding:4px 16px">` + list.slice().reverse().map(x => `
      <button class="chg" id="chg-${x.f}" data-edit="${x.f}" data-focus="c"><span class="dt">${x.dt.getDate()} ${MESES_C[x.dt.getMonth()]}<small>${DIAS[x.dt.getDay()]}</small></span>
      <span class="chg-txt"><span class="pills">${pill(x.d.o)}<span class="muted">→</span>${pill(real(x.d))}</span>
      ${x.d.c ? `<span class="frase">${esc(frase(x.d) || 'Con ' + x.d.c)}</span>` : '<span class="who none add">+ Añadir con quién</span>'}
      ${x.d.sw ? (() => { const p = day(x.d.sw), pd = parseISO(x.d.sw); return `<span class="sw-line" data-goto="${x.d.sw}" role="link" tabindex="0" aria-label="Ir al cambio del ${pd.getDate()} de ${MESES[pd.getMonth()]}"><span class="golink">a cambio del ${pd.getDate()} ${MESES_C[pd.getMonth()]}</span><span class="pills">${pill(p.o)}<span class="muted">→</span>${pill(real(p))}</span></span>`; })() : ''}</span>
      ${x.d.eu ? `<span class="price ${x.d.eu > 0 ? 'pos' : 'neg'}">${fmtE(Math.abs(x.d.eu))}<small>${x.d.eu > 0 ? 'cobrado' : 'pagado'}</small></span>`
        : `<span class="${x.delta > 0 ? 'pos' : x.delta < 0 ? 'neg' : 'muted'}" style="font-weight:700">${x.delta === 0 ? '=' : (x.delta > 0 ? '+' : '−') + fmtH(Math.abs(x.delta)) + ' h'}</span>`}</button>`).join('') + '</div></div>';
    $('#cam-body').innerHTML = html;
  }

  /* ───────── Ajustes ───────── */
  // debe coincidir con VERSION de sw.js (turnos-vNN)
  const APP_VERSION = '13';
  function renderAj() {
    const c = cfg();
    const f = (k, label, ph, type = 'text') => `<label class="field"><span>${label}</span><input data-cfg="${k}" value="${esc(c[k] || '')}" placeholder="${ph}" inputmode="${type === 'num' ? 'decimal' : 'text'}"></label>`;
    const ics = S.url && S.key ? S.url.replace(/^https?:/, 'webcal:') + (S.url.includes('?') ? '&' : '?') + 'a=ics&k=' + encodeURIComponent(S.key) : '';
    $('#aj-body').innerHTML = `
      <div class="card list"><h3>Tus datos</h3>
        ${f('nombre', 'Nombre', 'Mari Luz')}
        ${f('jornada_anual', 'Jornada anual (horas)', 'La que marque tu contrato', 'num')}
        ${f('dias_vacaciones', 'Días de vacaciones al año', 'Ej.: 22', 'num')}
        ${f('horas_fibao', 'Horas de una mañana en Fibao', 'Ej.: 5', 'num')}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${f('fibao_inicio', 'Entrada Fibao', '08:00')}${f('fibao_fin', 'Salida Fibao', '14:00')}</div>
        ${f('aviso_minutos', 'Aviso antes de cada turno (minutos)', '60', 'num')}
        <p class="muted" style="font-size:.85rem;margin:12px 0 0">Si quieres un aviso distinto para algún turno, ponlo aquí (en minutos). Vacío = el general. Por ejemplo, 180 para que la noche avise 3 horas antes.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${f('aviso_M', 'Antes de la mañana', '', 'num')}${f('aviso_T', 'Antes de la tarde', '', 'num')}${f('aviso_N', 'Antes de la noche', '', 'num')}${f('aviso_FB', 'Antes de Fibao', '', 'num')}</div>
        <button class="btn wide" id="aj-save" style="margin-top:16px">Guardar ajustes</button>
      </div>
      <div class="section card"><h3>Calendario del iPhone</h3>
        <p style="margin:6px 0 12px;color:var(--ink-2)">Tus turnos aparecen solos en la app Calendario y se actualizan cada hora.</p>
        ${ics ? `<a class="btn wide" href="${esc(ics)}">Suscribirme al calendario</a>` : '<p class="muted">Disponible al conectar con la hoja de Jose.</p>'}
        <p class="muted" style="font-size:.85rem;margin:10px 0 0">Para recibir los avisos, en Ajustes del iPhone › Calendario › Cuentas › Turnos, desactiva «Eliminar alertas».</p>
      </div>
      <div class="section card"><h3>Códigos</h3><p class="muted" style="margin:4px 0 8px;font-size:.88rem">Se cambian en la hoja de Google, pestaña Codigos.</p>
        <table class="codes-table">${Object.values(CODES).map(x => `<tr><td>${pill(x.codigo)}</td><td>${esc(x.nombre)}</td><td style="text-align:right">${fmtH(x.horas)} h</td></tr>`).join('')}</table></div>
      <div class="section"><button class="btn ghost wide" id="aj-refresh">Actualizar desde la hoja</button></div>
      <div class="section"><button class="btn danger wide" id="aj-out">${S.demo ? 'Salir del ejemplo' : 'Desconectar este iPhone'}</button></div>
      <p class="muted" style="text-align:center;font-size:.8rem;margin-top:18px">Turnos · versión ${APP_VERSION}${S.demo ? ' · datos de ejemplo' : ''}</p>`;
  }
  function saveAj() {
    const v = {};
    document.querySelectorAll('[data-cfg]').forEach(i => { v[i.dataset.cfg] = i.value.trim(); });
    S.data.config = Object.assign({}, S.data.config, v);
    store.set('data', S.data);
    if (S.demo) { toast('Guardado'); return; }
    post({ a: 'config', valores: v }).then(() => toast('Ajustes guardados')).catch(() => toast('No se han podido guardar. Revisa la conexión.'));
  }

  /* ───────── red ───────── */
  function get(params) {
    const u = S.url + (S.url.includes('?') ? '&' : '?') + new URLSearchParams(Object.assign({ k: S.key }, params));
    return fetch(u, { redirect: 'follow' }).then(r => r.json()).then(j => { if (!j.ok) throw new Error(j.error || 'Error'); return j; });
  }
  function post(body) {
    return fetch(S.url, { method: 'POST', redirect: 'follow', body: JSON.stringify(Object.assign({ k: S.key }, body)) })
      .then(r => r.json()).then(j => { if (!j.ok) throw new Error(j.error || 'Error'); return j; });
  }
  // Días guardados en la hoja mientras una lectura estaba en marcha: se reaplican sobre la respuesta para no perderlos.
  let justSaved = {};
  function load(force) {
    if (S.demo) return Promise.resolve();
    if (!force && Date.now() - S.lastFetch < 60000) return Promise.resolve();
    const t0 = Date.now();
    S.lastFetch = t0;
    return get({ a: 'data' }).then(j => {
      const byF = {};
      j.dias.forEach((d, i) => { byF[d.f] = i; });
      Object.keys(justSaved).forEach(f => {
        const x = justSaved[f];
        if (x.ts < t0) { delete justSaved[f]; return; }
        const merged = Object.assign({}, byF[f] != null ? j.dias[byF[f]] : { f }, x.patch); clean(merged);
        if (byF[f] != null) j.dias[byF[f]] = merged; else j.dias.push(merged);
      });
      j.dias.sort((a, b) => a.f < b.f ? -1 : 1);
      S.data = { config: j.config, codigos: j.codigos, festivos: j.festivos, dias: j.dias };
      store.set('data', S.data); index(); render(); setStatus();
    }).catch(err => { setStatus(navigator.onLine ? 'err' : 'off'); throw err; });
  }
  let autoPd = 0, autoPdT = null;
  function save(f, patch) {
    const prev = day(f);
    let d = Object.assign({}, prev, patch); d.f = f; clean(d);
    // día de un viaje que pasa de libre (o sin turno) a trabajado: va solo a «Por negociar»
    if (d.vj && !d.c && !prev.pd && ('r' in patch || 'o' in patch) && !worked(real(prev)) && worked(real(d))) {
      patch = Object.assign({}, patch, { pd: 1, pm: d.pm || d.vj });
      d = Object.assign({}, prev, patch); d.f = f; clean(d);
      autoPd++; clearTimeout(autoPdT);
      autoPdT = setTimeout(() => { toast(autoPd === 1 ? 'Ese turno cae en tu viaje: está en «Por negociar»' : autoPd + ' turnos caen en tu viaje: están en «Por negociar»'); autoPd = 0; }, 400);
    }
    MAP[f] = d;
    // en la cola solo van los campos que han cambiado, para no pisar lo que Jose edite en la hoja
    const norm = {};
    Object.keys(patch).forEach(k => { norm[k] = ['fb', 'fe', 'im', 'pd'].includes(k) ? (patch[k] ? 1 : 0) : k === 'eu' ? (Number(patch[k]) || 0) : (patch[k] || ''); });
    S.pending[f] = Object.assign({}, S.pending[f] || { f }, norm);
    if (S.demo) { applyToData(S.pending[f]); delete S.pending[f]; }
    store.set('pending', S.pending);
    render(); flush();
  }
  function applyToData(p) {
    const list = S.data.dias, i = list.findIndex(x => x.f === p.f);
    const d = Object.assign({}, i >= 0 ? list[i] : {}, p); clean(d);
    if (i >= 0) list[i] = d; else { list.push(d); list.sort((a, b) => a.f < b.f ? -1 : 1); }
    store.set('data', S.data);
  }
  let flushing = false, flushTimer = null;
  function flush() {
    if (S.demo) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      const items = Object.values(S.pending).slice(0, 300);
      if (!items.length || flushing) { setStatus(); return; }
      flushing = true; setStatus('pend');
      post({ a: 'save', dias: items }).then((j) => {
        const rech = new Set(j.rechazados || []);
        items.forEach(p => {
          if (!S.pending[p.f] || JSON.stringify(S.pending[p.f]) !== JSON.stringify(p)) return;
          delete S.pending[p.f];
          if (rech.has(p.f)) return;
          applyToData(p); justSaved[p.f] = { patch: p, ts: Date.now() };
        });
        store.set('pending', S.pending); flushing = false; setStatus();
        if (rech.size) { toast('La hoja no ha aceptado ' + rech.size + (rech.size === 1 ? ' día' : ' días')); load(true).catch(() => {}); }
        if (Object.keys(S.pending).length) flush();
      }).catch(() => { flushing = false; setStatus(navigator.onLine ? 'err' : 'off'); });
    }, 600);
  }
  function setStatus(st) {
    const n = Object.keys(S.pending).length;
    st = st || (n ? 'pend' : 'ok');
    const el = $('#sync'); if (!el) return;
    el.className = 'sync ' + (st === 'ok' ? '' : st);
    el.querySelector('span').textContent = S.demo ? 'Ejemplo' : st === 'ok' ? 'Al día' : st === 'pend' ? (n ? n + ' por subir' : 'Subiendo…') : st === 'off' ? 'Sin conexión' : 'Sin sincronizar';
  }

  /* ───────── navegación y eventos ───────── */
  function show(v) {
    S.view = v;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
    $('#s-' + v).classList.add('on');
    $('#tabs').hidden = v === 'gate';
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.s === v || (v === 'aj' && b.dataset.s === 'hoy')));
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    if (!S.data) return;
    if (S.view === 'hoy') renderHoy();
    else if (S.view === 'cal') renderCal();
    else if (S.view === 'res') renderRes();
    else if (S.view === 'cam') renderCam();
    else if (S.view === 'aj') renderAj();
    setStatus();
  }
  let toastT = null;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1800); }

  // Ir a otro cambio de la lista (el día del intercambio)
  function goTo(f) {
    const y = Number(f.slice(0, 4));
    if (y !== S.camYear) { S.camYear = y; renderCam(); }
    const el = document.getElementById('chg-' + f);
    if (!el) { openEditor(f); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  document.addEventListener('keydown', (e) => { const g = e.target.closest && e.target.closest('[data-goto]'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); goTo(g.dataset.goto); } });
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]'); if (g) { e.stopPropagation(); goTo(g.dataset.goto); return; }
    const t = e.target.closest('button,a'); if (!t) return;
    if (t.dataset.s) { show(t.dataset.s); return; }
    if (t.dataset.edit) { openEditor(t.dataset.edit, t.dataset.focus); return; }
    if (t.dataset.day) { if (S.brushOn) paint(t.dataset.day); else openEditor(t.dataset.day); return; }
    if (t.dataset.brush !== undefined) { S.brush = t.dataset.brush; renderCal(); return; }
    if (t.dataset.code && ED) {
      const b = t.dataset.code, i = ED.sel.indexOf(b);
      if (i >= 0) ED.sel.splice(i, 1);
      else {
        // como mucho un código que no sea turno (D, V, DCI…) combinado con turnos, y hasta 3 partes
        if (!isWorkBase(b)) ED.sel = ED.sel.filter(isWorkBase);
        ED.sel = ED.sel.concat(b).slice(-3);
      }
      drawCodes(); return;
    }
    if (t.dataset.pick !== undefined && ED) { $('#ed-sw').value = t.dataset.pick; drawSwap(); return; }
    if (t.dataset.mini && ED) { ED.miniM = new Date(ED.miniM.getFullYear(), ED.miniM.getMonth() + Number(t.dataset.mini), 1); drawMini(); return; }
    if (t.dataset.swc !== undefined && ED) { ED.swc = t.dataset.swc; drawSwap(); return; }
    if (PAT && t.dataset.patadd) { PAT.codes.push(t.dataset.patadd); if (PAT.codes.length === 1) PAT.anchor = parseISO(PAT.desde); drawPattern(); return; }
    if (PAT && t.dataset.patshift) { PAT.shift += Number(t.dataset.patshift); drawPattern(); return; }
    if (PAT && t.id === 'pat-del') { PAT.codes.pop(); drawPattern(); return; }
    if (PAT && t.id === 'pat-clear') { PAT.codes = []; PAT.shift = 0; drawPattern(); return; }
    if (PAT && t.id === 'pat-apply') { applyPattern(); return; }
    if (t.id === 'brush-pat') { openPattern(); return; }
    if (t.dataset.quickc && ED) { $('#ed-c').value = t.dataset.quickc; return; }
    if (t.id === 'cal-pick') { openMonthPicker(); return; }
    if (t.id === 'trip-open') { openTrip(); return; }
    if (t.dataset.gotrip) { const dt = parseISO(t.dataset.gotrip); show('cal'); S.month = new Date(dt.getFullYear(), dt.getMonth(), 1); renderCal(); return; }
    if (t.dataset.tripdel) { if (t.dataset.sure) deleteTrip(t.dataset.tripdel); else { t.dataset.sure = '1'; t.textContent = '¿Seguro? Toca otra vez para borrarlo'; } return; }
    if (TRIP && t.id === 'trip-apply') { applyTrip(); return; }
    if (t.id === 'cal-find') { openFind(); return; }
    if (FIND && t.dataset.goday) { const dt = parseISO(t.dataset.goday); closeEditor(); show('cal'); S.month = new Date(dt.getFullYear(), dt.getMonth(), 1); renderCal(); setTimeout(() => openEditor(t.dataset.goday), 320); return; }
    if (t.id === 'cam-q-clear') { S.camQ = ''; $('#cam-q').value = ''; renderCam(); return; }
    if (MP && t.dataset.mpy) { MP.y += Number(t.dataset.mpy); drawMonthPicker(); return; }
    if (MP && t.dataset.mpm !== undefined) { S.month = new Date(MP.y, Number(t.dataset.mpm), 1); MP = null; closeEditor(); renderCal(); return; }
    if (MP && t.id === 'mp-today') { const n = new Date(); S.month = new Date(n.getFullYear(), n.getMonth(), 1); MP = null; closeEditor(); renderCal(); return; }
    if (t.dataset.mode && ED) {
      ED.mode = t.dataset.mode;
      document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === ED.mode));
      $('#ed-mode-help').textContent = MODE_HELP[ED.mode];
      $('#ed-mode-dia').hidden = ED.mode !== 'dia'; $('#ed-mode-dinero').hidden = ED.mode !== 'dinero';
      if (ED.mode === 'dinero') $('#ed-eu').focus();
      return;
    }
    if (t.dataset.eus && ED) { document.querySelectorAll('[data-eus]').forEach(b => b.setAttribute('aria-pressed', b === t)); return; }
    if (t.dataset.ly && ED) {
      ED.layer = t.dataset.ly; const d = day(ED.f);
      const cc = codeIn(d, ED.layer);
      ED.sel = parts(cc).map(p => p.base);
      ED.prevF = Object.fromEntries(parts(cc).map(p => [p.base, p.f]));
      ED.fest = parts(cc).some(p => p.f) || (!cc && isSunOrFest(ED.f));
      $('#ed-fest').checked = ED.fest;
      document.querySelectorAll('[data-ly]').forEach(b => b.setAttribute('aria-pressed', b.dataset.ly === ED.layer));
      drawCodes(); return;
    }
    switch (t.id) {
      case 'cal-prev': S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderCal(); break;
      case 'cal-next': S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderCal(); break;
      case 'lay-real': S.layer = 'real'; renderCal(); break;
      case 'lay-orig': S.layer = 'orig'; renderCal(); break;
      case 'brush-toggle': S.brushOn = !S.brushOn; if (!S.brushOn) S.brush = null; renderCal(); break;
      case 'res-prev': S.resYear--; renderRes(); break;
      case 'res-next': S.resYear++; renderRes(); break;
      case 'cam-prev': S.camYear--; renderCam(); break;
      case 'cam-next': S.camYear++; renderCam(); break;
      case 'open-ajustes': show('aj'); break;
      case 'close-ajustes': show('hoy'); break;
      case 'aj-save': saveAj(); break;
      case 'aj-refresh': load(true).then(() => toast('Datos actualizados')).catch(() => toast('No se ha podido conectar con la hoja')); break;
      case 'aj-out': if (confirmOut()) logout(); break;
      case 'ed-save': saveEditor(); break;
      case 'ed-clear': ED.sel = []; ED.fb = false; ED.im = false; ED.pd = false; ['#ed-fb', '#ed-im', '#ed-pd'].forEach(s => { $(s).checked = false; }); ['#ed-n', '#ed-c', '#ed-pm', '#ed-eu', '#ed-sw'].forEach(s => { $(s).value = ''; }); $('#ed-pm-wrap').hidden = true; drawSwap(); drawCodes(); break;
      case 'ed-back': closeEditor(); break;
      case 'gate-go': login(); break;
      case 'gate-demo': startDemo(); break;
    }
  });
  $('#cam-q').addEventListener('input', (e) => { S.camQ = e.target.value; renderCam(); });
  document.addEventListener('input', (e) => {
    if (FIND && e.target.id === 'find-q') { FIND.q = e.target.value; drawFind(); }
  });
  document.addEventListener('change', (e) => {
    if (TRIP) {
      if (e.target.id === 'trip-from') TRIP.desde = e.target.value || TRIP.desde;
      if (e.target.id === 'trip-to') TRIP.hasta = e.target.value || TRIP.hasta;
      drawTrip(); return;
    }
    if (PAT) {
      if (e.target.id === 'pat-from') PAT.desde = e.target.value || PAT.desde;
      if (e.target.id === 'pat-to') PAT.hasta = e.target.value || PAT.hasta;
      if (e.target.id === 'pat-over') PAT.over = e.target.checked;
      drawPattern(); return;
    }
    if (!ED) return;
    if (e.target.id === 'ed-fest') { ED.fest = e.target.checked; drawCodes(); }
    if (e.target.id === 'ed-fb') ED.fb = e.target.checked;
    if (e.target.id === 'ed-im') ED.im = e.target.checked;
    if (e.target.id === 'ed-pd') { ED.pd = e.target.checked; $('#ed-pm-wrap').hidden = !ED.pd; if (ED.pd) $('#ed-pm').focus(); }
  });
  $('#scrim').addEventListener('click', closeEditor);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ED) closeEditor(); });
  // deslizar para cambiar de mes
  let tx = null;
  $('#cal-grid').addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
  $('#cal-grid').addEventListener('touchend', (e) => {
    if (tx == null || S.brushOn) return; const dx = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(dx) > 60) { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + (dx < 0 ? 1 : -1), 1); renderCal(); }
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.data && !S.demo) { load().catch(() => {}); flush(); render(); } });
  window.addEventListener('online', () => flush());
  setInterval(() => { if (document.hidden) return; if (S.view === 'hoy' && S.data) renderHoy(); if (Object.keys(S.pending).length && !S.demo) flush(); }, 60000);

  /* ───────── acceso ───────── */
  function confirmOut() {
    const n = Object.keys(S.pending).length;
    if (S.demo) return window.confirm('¿Salir de los datos de ejemplo?');
    if (n) return window.confirm('Hay ' + n + (n === 1 ? ' día' : ' días') + ' sin subir a la hoja y se perderán. ¿Desconectar de todas formas?');
    return window.confirm('¿Desconectar este iPhone? Tus datos siguen en la hoja.');
  }
  function logout() { ['key', 'data', 'pending', 'demo'].forEach(store.del); S.key = ''; S.data = null; S.pending = {}; S.demo = false; MAP = {}; show('gate'); }
  function login() {
    const key = $('#gate-key').value.trim(), url = ($('#gate-url').value || '').trim();
    if (url) S.url = url;
    if (!S.url) { $('#gate-url-wrap').hidden = false; $('#gate-msg').textContent = 'Falta la dirección del servidor.'; return; }
    if (!key) { $('#gate-msg').textContent = 'Pega la clave que te ha enviado Jose.'; return; }
    S.key = key; S.demo = false;
    $('#gate-msg').textContent = 'Conectando…';
    load(true).then(() => { store.set('key', key); if (!window.TURNOS_BACKEND) store.set('url', S.url); store.set('demo', false); show('hoy'); })
      .catch(err => { S.key = ''; $('#gate-msg').textContent = /Clave/.test(err.message) ? 'La clave no es correcta. Cópiala otra vez del mensaje de Jose.' : 'No se ha podido conectar. Comprueba que tienes internet.'; });
  }
  function startDemo() { S.demo = true; S.data = demoData(); S.pending = {}; store.set('pending', {}); store.set('demo', true); store.set('demoVer', window.TURNOS_DEMO_VER || ''); store.set('data', S.data); index(); show('hoy'); }
  function demoData() {
    if (window.TURNOS_DEMO_DATA) return JSON.parse(JSON.stringify(window.TURNOS_DEMO_DATA));
    const codigos = [
      { codigo: 'M', nombre: 'Mañana', horas: 7, color: '#1A9FB4', tipo: 'turno', inicio: '08:00', fin: '15:00' },
      { codigo: 'T', nombre: 'Tarde', horas: 7, color: '#2F9E44', tipo: 'turno', inicio: '15:00', fin: '22:00' },
      { codigo: 'N', nombre: 'Noche', horas: 10, color: '#6B3FC0', tipo: 'turno', inicio: '22:00', fin: '08:00' },
      { codigo: 'D', nombre: 'Descanso', horas: 0, color: '#E39B1B', tipo: 'libre' },
      { codigo: 'V', nombre: 'Vacaciones', horas: 0, color: '#3B82D9', tipo: 'libre' },
      { codigo: 'DCI', nombre: 'Libre por compensación (DCI)', horas: 7, color: '#D9B310', tipo: 'compensacion' },
      { codigo: 'CHO', nombre: 'Compensación horaria', horas: 0, color: '#E8C547', tipo: 'compensacion' },
      { codigo: 'CJO', nombre: 'Cambio de jornada', horas: 0, color: '#8BC34A', tipo: 'compensacion' }
    ];
    const pat = ['M', 'T', 'M-N', '', 'D', 'D', 'T', 'T', 'M', 'D', 'N', 'D', 'D', 'M'];
    const dias = [], y0 = new Date().getFullYear() - 1;
    let i = 0;
    for (let dt = new Date(y0, 0, 1); dt.getFullYear() <= y0 + 1; dt = addDays(dt, 1), i++) {
      let c = pat[i % pat.length] || 'D';
      if (dt.getMonth() === 7 && dt.getDate() > 3 && dt.getDate() < 20) c = 'V';
      if (dt.getDay() === 0 && c !== 'D' && c !== 'V') c = c.split('-').map(x => x + 'F').join('-');
      const d = { f: iso(dt), o: c };
      if (i % 37 === 5 && c !== 'V') { d.r = c === 'D' ? 'T' : 'D'; d.c = ['Lucía', 'Carmen', 'Rocío'][i % 3]; }
      if (dt.getDay() === 1 && c !== 'V' && i % 2) d.fb = 1;
      if (i % 61 === 9) { d.im = 1; d.n = 'Formación'; }
      if (i % 37 === 5 && d.c && i % 2) d.eu = i % 4 === 1 ? 60 : -45;
      if (dt > new Date() && i % 53 === 20) { d.pd = 1; d.pm = 'Viaje'; }
      dias.push(d);
    }
    return { config: { nombre: 'Mari Luz', jornada_anual: '1540', dias_vacaciones: '22', horas_fibao: '5', fibao_inicio: '08:00', fibao_fin: '13:00', aviso_minutos: '60' }, codigos, festivos: [], dias };
  }

  /* ───────── arranque ───────── */
  // Actualizaciones: cuando hay versión nueva, el service worker la descarga entera y la app se recarga sola
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      const go = () => { if (!reloading) { reloading = true; location.reload(); } };
      if ($('#sheet').classList.contains('on')) S.reloadPending = go; else go();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }
  // enlace de configuración: …/#k=CLAVE
  const hk = new URLSearchParams(location.hash.slice(1)).get('k');
  if (hk) { $('#gate-key').value = hk; history.replaceState(null, '', location.pathname); }
  if (!S.url) $('#gate-url-wrap').hidden = false;
  if (window.TURNOS_DEMO && window.TURNOS_DEMO_DATA && store.get('demoVer', '') !== window.TURNOS_DEMO_VER) startDemo();
  else if (S.data && (S.key || S.demo)) { index(); show('hoy'); load().catch(() => {}); flush(); }
  else if (window.TURNOS_DEMO) startDemo();
  else show('gate');
})();

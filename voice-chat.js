(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const $ = id => document.getElementById(id);
  const bar = $('wa-bar'), inp = $('wa-in'), btn = $('wa-btn'), hint = $('wa-hint');
  const HINT = 'Ej: “gasté 2500 en comida con tarjeta”';
  const ICO = {
    mic: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M1.1 21.76 23.8 12.03 1.1 2.3l.01 7.91 13.62 1.82-13.62 1.82z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>'
  };
  const ERR = {
    'not-allowed': 'Permiso de micrófono denegado.',
    'service-not-allowed': 'El navegador no permite el dictado aquí.',
    'no-speech': 'No te escuché. Inténtalo de nuevo.',
    'audio-capture': 'No se encontró micrófono.',
    'network': 'El dictado necesita internet.'
  };

  /* ---------- Utilidades de texto ---------- */
  const nz = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const lev = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  const sim = (w, t) => w == t || (w.length > 3 && t.length > 3 &&
  (lev(w, t) <= (t.length > 6 ? 2 : 1) || w.startsWith(t) || t.startsWith(w)));
  const IN = /\b(ingres|sueld|cobr|salari|nomin|recib|me pagaron|me depositaron)|\bgane\b/;
  const DROP = new Set(['gaste', 'gasto', 'gastamos', 'pague', 'pago', 'compre', 'compra', 'cobre', 'cobro', 'recibi','gane', 'ingrese', 'ingreso', 'ingresos', 'pagaron', 'depositaron', 'pesos', 'peso', 'ars', 'mil', 'k', 'hoy', 'ahora', 'ayer']);
  const STOP = new Set(['en', 'de', 'del', 'por', 'para', 'a', 'al', 'con', 'el', 'la', 'los', 'las', 'un', 'una', 'mi', 'mis', 'desde', 'y', 'que', 'me']);
  const SYN = {
    comida: ['super', 'supermercado', 'almuerzo', 'cena', 'desayuno', 'merienda', 'restaurante', 'cafe', 'pizza', 'delivery', 'pan'],
    transporte: ['uber', 'cabify', 'taxi', 'nafta', 'colectivo', 'bondi', 'sube', 'subte', 'tren', 'peaje', 'didi', 'movilidad', 'bicicleta', 'moto', 'auto', 'estacionamiento'],
    vivienda: ['alquiler', 'luz', 'gas', 'agua', 'expensas', 'internet', 'wifi', 'wi-fi'],
    ocio: ['cine', 'bar', 'salida', 'boliche', 'fiesta', 'recital', 'viaje', 'hotel', 'joda', 'turismo', 'vacaciones'],
    suscripciones: ['suscripcion', 'netflix', 'spotify', 'youtube', 'disney', 'hbo', 'icloud', 'prime', 'twitch', 'tiktok', 'hulu', 'deezer', 'paramount', 'apple', 'google', 'microsoft', 'adobe', 'canva', 'notion', 'slack', 'dropbox'],
    salud: ['farmacia', 'medico', 'doctor', 'remedio', 'remedios', 'dentista', 'prepaga', 'obra social', 'psicologo', 'psiquiatra', 'hospital', 'clinica', 'vacuna', 'vacunas', 'gimnasio', 'entrenador', 'nutricionista', 'masaje', 'fisioterapia', 'kinesio'],
    nomina: ['sueldo', 'salario', 'haber', 'quincena', 'nómina', 'recibo', 'pago', 'cobro', 'deposito', 'transferencia'],
    'ingresos extra': ['extra', 'venta', 'freelance', 'propina', 'regalo', 'premio', 'bono', 'comision', 'inversion', 'interes', 'dividendo'],
  };

  /* ---------- Parser ---------- */
  function parseAmt(s) {
    const m = s.match(/\d[\d.,]*/);
    if (!m) return 0;
    let n = m[0].replace(/[.,]+$/, '');
    if (n.includes('.') && n.includes(',')) n = n.replace(/\./g, '').replace(',', '.');   // 1.250,50
    else if (/^\d{1,3}([.,]\d{3})+$/.test(n)) n = n.replace(/[.,]/g, '');                 // 2.500 / 2,500
    else n = n.replace(',', '.');                                                          // 25,5
    let v = parseFloat(n) || 0;
    if (/^\s*(mil|k)\b/i.test(s.slice(m.index + m[0].length))) v *= 1000;                  // "5 mil", "5k"
    return v;
  }

  const score = (words, name, syn) => {
    const t = nz(name).split(/[^a-z0-9]+/).filter(Boolean);
    const s = t.length ? t.filter(x => words.some(w => sim(w, x))).length / t.length : 0;
    return Math.max(s, syn && syn.some(k => words.includes(k)) ? .9 : 0);
  };
  const pick = (list, words, syn) => {
    let best = null, bs = 0;
    list.forEach(x => { const s = score(words, x.name, syn && syn[nz(x.name)]); if (s > bs) { bs = s; best = x; } });
    return bs >= .5 ? best : null;
  };

  function parse(raw) {
    const amt = parseAmt(raw);
    if (!(amt > 0)) return null;
    const type = IN.test(nz(raw)) ? 'in' : 'out';
    const toks = raw.trim().split(/\s+/).map(t => ({ o: t.replace(/^[^\wáéíóúñü$]+|[^\wáéíóúñü]+$/gi, ''), n: nz(t).replace(/[^a-z0-9]/g, '') }));
    const words = toks.map(x => x.n).filter(w => w && !/\d/.test(w));

    const am = pick(S.accounts, words), acc = am || S.accounts[0];
    const cats = S.cats.filter(c => c.type == type), cat = pick(cats, words, SYN) || cats[0];
    const accTok = am ? nz(am.name).split(/[^a-z0-9]+/).filter(Boolean) : [];

    const w = toks.filter(x => x.n && !/\d/.test(x.n) && !DROP.has(x.n) && !accTok.some(t => sim(x.n, t)));
    while (w.length && STOP.has(w[0].n)) w.shift();
    while (w.length && STOP.has(w[w.length - 1].n)) w.pop();
    let desc = w.map(x => x.o).join(' ') || (cat ? cat.name : 'Movimiento');
    desc = desc.charAt(0).toUpperCase() + desc.slice(1);
    desc = desc.slice(0, 20);
    return { id: U(), type, amt, desc, cat: cat ? cat.id : '', acc: acc.id, to: '', date: iso(new Date()), rec: false };
  }

  /* ---------- UI / estados: reposo 🎙️ · grabando ⏹️ · texto ➤ ---------- */
  let rec = null, listening = false, heard = '', abort = false;
  const say = (t, err) => { hint.textContent = t; hint.className = err ? 'err' : ''; };
  const paint = () => {
    const txt = inp.value.trim();
    btn.innerHTML = listening ? ICO.stop : txt ? ICO.send : ICO.mic;
    btn.classList.toggle('rec', listening);
    btn.setAttribute('aria-label', listening ? 'Detener' : txt ? 'Enviar' : 'Hablar');
  };

  function send(text) {
    if (!S.accounts.length) return say('Primero crea una cuenta en Ajustes.', 1);
    const t = parse(text);
    if (!t) return say('No detecté el importe. ' + HINT, 1);   // el texto queda en el input para corregirlo
    S.tx.push(t);
    save(); render();
    inp.value = ''; heard = ''; paint();
    say(`✓ ${t.desc} · ${V.hide ? '*****' : nf.format(t.amt)} · ${t.type == 'in' ? 'Ingreso' : 'Gasto'} · ${cn(t.cat)} · ${an(t.acc)}`);
    setSync('✓ Movimiento agregado');
  }

  function listen() {
    if (!SR) return say('Tu navegador no soporta voz. Escribe el movimiento.', 1);
    rec = new SR();
    rec.lang = 'es-AR'; rec.interimResults = true; rec.continuous = false;
    heard = ''; abort = false;
    rec.onstart = () => { listening = true; say('Escuchando… toca ■ para enviar'); paint(); };
    rec.onresult = e => { heard = Array.from(e.results, r => r[0].transcript).join('').trim(); inp.value = heard; paint(); };
    rec.onerror = e => { abort = true; say(ERR[e.error] || 'Error de voz: ' + e.error, 1); };
    rec.onend = () => { listening = false; paint(); if (!abort && heard) send(heard); };
    try { rec.start(); } catch { say('No se pudo iniciar el micrófono.', 1); }
  }

  window.openWhatsAppBar = () => {
    bar.hidden = false;
    document.body.classList.add('wa-on');
    inp.value = ''; say(HINT); paint();
    setTimeout(() => inp.focus(), 50);
  };
  window.closeWhatsAppBar = () => {
    abort = true;
    if (rec && listening) { try { rec.abort(); } catch {} }
    listening = false;
    bar.hidden = true;
    document.body.classList.remove('wa-on');
    paint();
  };

  btn.onclick = () => listening ? rec.stop() : inp.value.trim() ? send(inp.value) : listen();
  inp.oninput = paint;
  inp.onkeydown = e => {
    if (e.key == 'Enter') { e.preventDefault(); if (!listening) send(inp.value); }
    else if (e.key == 'Escape') closeWhatsAppBar();
  };
  $('wa-x').onclick = () => closeWhatsAppBar();
  $('wa-manual').onclick = () => { closeWhatsAppBar(); openManualForm(); };
})();
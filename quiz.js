/* Quiz di livello di italiano — interfaccia e flusso.
   Uso:  MTMQuiz.mount(elemento, { domande, i18n, css, lang, cfg })
   Le regole di punteggio stanno in punteggio.js (MTMPunteggio), le domande in domande.json.
   La stessa funzione serve la pagina di anteprima (index.html) e lo snippet per Elementor
   generato da strumenti/build_embed.py. */
(function (root) {
  'use strict';
  var P = root.MTMPunteggio;
  var CHIAVE = 'mtm-quiz-stato', CODA = 'mtm-quiz-coda';
  var MAX_ASCOLTI = 2, ATTESA_AUDIO_MS = 8000, RIPRESA_MS = 24 * 3600 * 1000;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // generatore con seme: l'ordine di opzioni e tessere resta lo stesso se si riprende il test
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mescola(arr, seme) {
    var a = arr.slice(), t = seme >>> 0;
    var rnd = function () { t += 0x6D2B79F5; var r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }

  function mount(host, opt) {
    var D = opt.domande, I = opt.i18n;
    var CFG = { webhook: '', privacy_url: '', min_secondi: 60, audio_base: 'audio/', audio_urls: {} };
    Object.keys(opt.cfg || {}).forEach(function (k) { CFG[k] = opt.cfg[k]; });

    var sr = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    sr.innerHTML = '<style>' + opt.css + '</style><div class="q"><div class="schermo"></div></div>';
    var el = sr.querySelector('.schermo');

    var items = {};
    D.instradamento.forEach(function (it) { items[it.id] = it; });
    P.LIVELLI.forEach(function (l) { D.blocchi[l].forEach(function (it) { items[it.id] = it; }); });

    /* ---------- memoria ---------- */
    // Se il browser blocca la memoria locale (finestra anonima, impostazioni rigide) si lavora
    // in memoria: si perde la ripresa del test, non il test.
    var mem = {};
    function leggi(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : (mem[k] || null); } catch (e) { return mem[k] || null; } }
    function scrivi(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function cancella(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} }

    /* ---------- stato ---------- */
    var S, U = {};       // S: stato salvato; U: selezione in corso sulla domanda a schermo
    var lang = (opt.lang === 'it' || opt.lang === 'en') ? opt.lang : 'en';
    function nuovo() {
      return { v: D.versione, lang: lang, seme: Date.now() % 2147483647, inizio: Date.now(), fase: 'intro',
        ascolto: true, audioErrore: false, stadio: null, coda: [], pos: 0, blocchi: [],
        risposte: {}, ordine: [], ascolti: {}, ris: null, contatto: null };
    }
    function salva() { S.salvato = Date.now(); scrivi(CHIAVE, S); }
    var vecchio = leggi(CHIAVE);
    var ripresa = (vecchio && vecchio.v === D.versione && Date.now() - (vecchio.salvato || 0) < RIPRESA_MS &&
      (vecchio.fase === 'audio' || vecchio.fase === 'quiz' || vecchio.fase === 'livello')) ? vecchio : null;
    S = nuovo();

    function T(k, par) {
      var s = (I[S.lang] && I[S.lang][k]) || k;
      if (par) Object.keys(par).forEach(function (p) { s = s.split('{' + p + '}').join(par[p]); });
      return s;
    }
    // punto finale del titolo in menta: tratto firma del brand
    function titolo(s) {
      var m = /[.?!]$/.test(s) ? s.slice(-1) : '.';
      return esc(s.replace(/[.?!]$/, '')) + '<span class="punto">' + m + '</span>';
    }
    function evento(nome, extra) {
      try {
        var d = { event: nome, quiz_lingua: S.lang };
        Object.keys(extra || {}).forEach(function (k) { d[k] = extra[k]; });
        (root.dataLayer = root.dataLayer || []).push(d);
      } catch (e) {}
    }
    function mostra(html) {
      fermaAudio();
      el.innerHTML = html;
      // riporta in vista l'inizio del quiz se la schermata nuova parte fuori dallo schermo
      try {
        var r = host.getBoundingClientRect();
        if (r.top < 0) host.scrollIntoView({ block: 'start', behavior: 'auto' });
      } catch (e) {}
    }

    /* ---------- audio ---------- */
    var cache = {}, suona = null, attesa = null;
    function urlAudio(id) { var f = D.audio[id].file; return CFG.audio_urls[f] || (CFG.audio_base + f); }
    function audio(id) {
      if (!cache[id]) { cache[id] = new Audio(); cache[id].preload = 'auto'; cache[id].src = urlAudio(id); }
      return cache[id];
    }
    function precarica(ids) { ids.forEach(function (id) { try { audio(id).load(); } catch (e) {} }); }
    function fermaAudio() {
      clearTimeout(attesa);
      if (suona) { try { cache[suona].pause(); } catch (e) {} suona = null; }
    }
    function htmlPlayer(id, limitato) {
      return '<div class="player" data-audio="' + id + '" data-limitato="' + (limitato ? 1 : 0) + '">' +
        '<button type="button" class="play" data-act="play"></button><span class="rest"></span>' +
        '<div class="player-err" hidden>' + esc(T('audio_errore')) + '<div class="riga">' +
        '<button type="button" class="btn sec" data-act="play">' + esc(T('riprova')) + '</button>' +
        '<button type="button" class="btn sec" data-act="salta-ascolto">' + esc(T('salta_ascolto')) + '</button></div></div></div>';
    }
    function aggiornaPlayer(errore) {
      var p = el.querySelector('.player'); if (!p) return;
      var id = p.getAttribute('data-audio'), lim = p.getAttribute('data-limitato') === '1';
      var usati = S.ascolti[id] || 0, restano = MAX_ASCOLTI - usati;
      var b = p.querySelector('.play'), r = p.querySelector('.rest');
      b.className = 'play' + (suona ? ' suona' : '');
      b.textContent = suona ? T('in_ascolto') : (usati ? T('ascolta_ancora') : T('ascolta'));
      b.disabled = !!suona || (lim && restano <= 0);
      r.textContent = !lim ? '' : restano <= 0 ? T('ascolti_0') : restano === 1 ? T('ascolti_1') : T('ascolti_n', { n: restano });
      p.querySelector('.player-err').hidden = !errore;
    }
    function play() {
      var p = el.querySelector('.player'); if (!p || suona) return;
      var id = p.getAttribute('data-audio'), lim = p.getAttribute('data-limitato') === '1';
      if (lim && (S.ascolti[id] || 0) >= MAX_ASCOLTI) return;
      var a = audio(id), partito = false;
      var ko = function () {
        if (suona !== id) return;
        clearTimeout(attesa); try { a.pause(); } catch (e) {}
        suona = null; S.audioErrore = true; aggiornaPlayer(true);
      };
      suona = id; aggiornaPlayer(false);
      a.onplaying = function () {
        if (partito) return; partito = true; clearTimeout(attesa);
        if (lim) { S.ascolti[id] = (S.ascolti[id] || 0) + 1; salva(); aggiornaPlayer(false); }
      };
      a.onended = function () { if (suona === id) { suona = null; aggiornaPlayer(false); } };
      a.onerror = ko;
      attesa = setTimeout(function () { if (!partito) ko(); }, ATTESA_AUDIO_MS);
      try { a.currentTime = 0; } catch (e) {}
      var pr = a.play();
      if (pr && pr.catch) pr.catch(ko);
    }

    /* ---------- schermate ---------- */
    function vistaIntro() {
      var h = '<div class="card scura"><button type="button" class="lingua" data-act="lingua">' + esc(T('lingua_altro')) + '</button>' +
        '<span class="pill">' + esc(T('intro_pill')) + '</span>' +
        '<h1 class="titolo">' + titolo(T('intro_titolo')) + '</h1>' +
        '<p class="testo-intro">' + esc(T('intro_testo')) + '</p>' +
        '<ul class="punti"><li>' + esc(T('intro_p1')) + '</li><li>' + esc(T('intro_p2')) + '</li><li>' + esc(T('intro_p3')) + '</li></ul>';
      if (ripresa) {
        h += '<p class="testo-intro">' + esc(T('riprendi_testo')) + '</p><div class="pila">' +
          '<button type="button" class="btn pri" data-act="riprendi">' + esc(T('riprendi')) + '</button>' +
          '<button type="button" class="btn sec" data-act="inizia">' + esc(T('ricomincia')) + '</button></div>';
      } else {
        h += '<button type="button" class="btn pri" data-act="inizia">' + esc(T('inizia')) + '</button>';
      }
      mostra(h + '</div>');
    }

    function vistaAudio() {
      mostra('<div class="card scura"><span class="pill">' + esc(T('audio_pill')) + '</span>' +
        '<h1 class="titolo">' + titolo(T('audio_titolo')) + '</h1>' +
        '<p class="testo-intro">' + esc(T('audio_testo')) + '</p>' + htmlPlayer('prova', false) +
        '<div class="pila"><button type="button" class="btn pri" data-act="audio-si">' + esc(T('audio_si')) + '</button>' +
        '<button type="button" class="btn sec" data-act="audio-no">' + esc(T('audio_no')) + '</button></div>' +
        '<p class="nota">' + esc(T('audio_no_nota')) + '</p></div>');
      aggiornaPlayer(false);
    }

    function corrente() { return items[S.coda[S.pos]]; }
    function consegna(it) {
      if (it.tipo === 'riordino') return it.audio ? 'c_dettato' : 'c_riordino';
      if (it.tipo === 'abbina') return 'c_abbina';
      return it.audio ? 'c_ascolto' : it.testo ? 'c_lettura' : 'c_scelta';
    }
    function percento() {
      var perBlocco = S.ascolto ? 8 : 6;
      var stima = 6 + Math.max(2, S.blocchi.length + (S.stadio === 'R' ? 0 : 1)) * perBlocco;
      return Math.min(96, Math.round(100 * S.ordine.length / stima));
    }
    function vistaDomanda() {
      var it = corrente();
      U = { sel: null, scelte: [], coppie: {}, attiva: null };
      if (it.tipo === 'scelta') U.ordine = mescola(it.opzioni.map(function (_, i) { return i; }), S.seme ^ hash(it.id));
      if (it.tipo === 'riordino') U.tessere = mescola(it.soluzione.concat(it.distrattori || []), S.seme ^ hash(it.id));
      if (it.tipo === 'abbina') U.destra = mescola([0, 1, 2], S.seme ^ hash(it.id));
      var h = '<div class="card"><div class="top"><span class="pill">' + esc(T('ab_' + it.abilita)) + '</span>' +
        '<span class="num">' + esc(T('domanda')) + ' ' + (S.ordine.length + 1) + '</span></div>' +
        '<div class="barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percento() + '"><div style="width:' + percento() + '%"></div></div>' +
        '<p class="consegna">' + esc(T(consegna(it))) + '</p>';
      if (it.testo) h += '<div class="brano" lang="it">' + esc(D.testi[it.testo]) + '</div>';
      if (it.audio) h += htmlPlayer(it.audio, true);
      if (it.domanda) h += '<h2 class="dom" lang="it">' + esc(it.domanda).replace(/_{3,}/g, '<span class="vuoto" aria-label="…"></span>') + '</h2>';
      h += '<div class="corpo" lang="it"></div><div class="azioni">' +
        '<button type="button" class="btn sec" data-act="nls">' + esc(T('non_lo_so')) + '</button>' +
        '<button type="button" class="btn pri" data-act="avanti" disabled>' + esc(T('avanti')) + '</button></div></div>';
      mostra(h);
      corpo();
      if (it.audio) aggiornaPlayer(false);
    }
    // Ridisegna solo la parte interattiva: così un tocco non interrompe l'audio in corso.
    function corpo() {
      var it = corrente(), h = '', pronto = false;
      if (it.tipo === 'scelta') {
        h = '<div class="opzioni">' + U.ordine.map(function (i) {
          return '<button type="button" class="opt' + (U.sel === i ? ' sel' : '') + '" aria-pressed="' + (U.sel === i) + '" data-act="opt" data-i="' + i + '">' + esc(it.opzioni[i]) + '</button>';
        }).join('') + '</div>';
        pronto = U.sel !== null;
      } else if (it.tipo === 'riordino') {
        h = '<p class="frase-etichetta" lang="' + S.lang + '">' + esc(T('tua_frase')) + '</p><div class="frase">' +
          (U.scelte.length ? U.scelte.map(function (k) {
            return '<button type="button" class="tessera" data-act="togli" data-k="' + k + '">' + esc(U.tessere[k]) + '</button>';
          }).join('') : '<span class="segnaposto" lang="' + S.lang + '">' + esc(T('tocca_parole')) + '</span>') + '</div><div class="banca">' +
          U.tessere.map(function (t, k) {
            var usata = U.scelte.indexOf(k) >= 0;
            return '<button type="button" class="tessera' + (usata ? ' usata' : '') + '" data-act="metti" data-k="' + k + '"' + (usata ? ' tabindex="-1" aria-hidden="true"' : '') + '>' + esc(t) + '</button>';
          }).join('') + '</div>';
        pronto = U.scelte.length >= 2;
      } else if (it.tipo === 'abbina') {
        var num = function (sx) { return Object.keys(U.coppie).map(Number).sort().indexOf(sx) + 1; };
        var diDestra = function (dx) { var k = Object.keys(U.coppie).filter(function (s) { return U.coppie[s] === dx; })[0]; return k === undefined ? null : Number(k); };
        h = '<div class="abbina"><div class="col">' + it.coppie.map(function (c, sx) {
          var cls = U.coppie[sx] !== undefined ? ' c' + num(sx) : (U.attiva === sx ? ' attiva' : '');
          return '<button type="button" class="voce' + cls + '" data-act="sx" data-i="' + sx + '">' + esc(c[0]) + '</button>';
        }).join('') + '</div><div class="col">' + U.destra.map(function (dx) {
          var sx = diDestra(dx);
          return '<button type="button" class="voce' + (sx !== null ? ' c' + num(sx) : '') + '" data-act="dx" data-i="' + dx + '">' + esc(it.coppie[dx][1]) + '</button>';
        }).join('') + '</div></div>';
        pronto = Object.keys(U.coppie).length === 3;
      }
      el.querySelector('.corpo').innerHTML = h;
      el.querySelector('[data-act="avanti"]').disabled = !pronto;
    }

    function giusta(it) {
      if (it.tipo === 'scelta') return U.sel === it.corretta;
      if (it.tipo === 'riordino') {
        var data = U.scelte.map(function (k) { return U.tessere[k]; }).join('|');
        return [it.soluzione].concat(it.accettate || []).some(function (s) { return s.join('|') === data; });
      }
      // abbinamento: tutto giusto o zero
      return [0, 1, 2].every(function (sx) { return U.coppie[sx] === sx; });
    }
    function registra(nls) {
      var it = corrente();
      S.risposte[it.id] = { ok: (!nls && giusta(it)) ? 1 : 0, nls: nls ? 1 : 0 };
      S.ordine.push(it.id);
      S.pos++;
      avanza();
    }
    function avanza() {
      if (S.pos < S.coda.length) { salva(); return vistaDomanda(); }
      var corrette = S.coda.filter(function (id) { return S.risposte[id] && S.risposte[id].ok; }).length;
      var fatte = S.coda.filter(function (id) { return S.risposte[id]; }).length;
      var prossimo;
      if (S.stadio === 'R') {
        S.instradamento = corrette;
        prossimo = P.ingresso(corrette);
      } else {
        S.blocchi.push({ livello: S.stadio, corrette: corrette, totale: fatte, superato: P.superato(corrette, fatte) });
        prossimo = P.prossimo(S.blocchi);
      }
      if (prossimo) { caricaBlocco(prossimo); salva(); return vistaDomanda(); }
      concludi();
    }
    function caricaBlocco(livello) {
      var lista = D.blocchi[livello].filter(function (it) { return S.ascolto || it.abilita !== 'ascolto'; });
      S.stadio = livello; S.coda = lista.map(function (it) { return it.id; }); S.pos = 0;
      precarica(lista.filter(function (it) { return it.audio; }).map(function (it) { return it.audio; }));
    }
    function saltaAscolto() {
      // l'audio non funziona: si tolgono le domande di ascolto ancora da fare, il resto prosegue
      S.ascolto = false;
      S.coda = S.coda.filter(function (id, i) { return i < S.pos || items[id].abilita !== 'ascolto'; });
      avanza();
    }
    function concludi() {
      var risposte = S.ordine.filter(function (id) { return id.charAt(0) !== 'R'; }).map(function (id) {
        return { abilita: items[id].abilita, livello: items[id].livello, ok: S.risposte[id].ok, nls: S.risposte[id].nls };
      });
      var pr = P.profilo(risposte, !S.ascolto);
      S.ris = { livello: P.livelloFinale(S.blocchi), punteggi: pr.punteggi, debole: pr.debole, forte: pr.forte,
        durata: Math.round((Date.now() - S.inizio) / 1000) };
      S.fase = 'livello'; salva();
      evento('quiz_completato', { quiz_livello: S.ris.livello });
      vistaLivello();
    }

    function vistaLivello(errore) {
      var L = S.ris.livello;
      mostra('<div class="card scura"><span class="pill">' + esc(T('ris_pill')) + '</span>' +
        '<div class="livello"><div class="badge">' + L + '</div><h1 class="titolo">' + titolo(T('ris_titolo', { livello: L })) + '</h1></div>' +
        '<p class="descr">' + esc(T('liv_' + L)) + '</p></div>' +
        '<form class="card" novalidate><h2 class="sotto">' + esc(T('gate_titolo')) + '</h2>' +
        '<p class="consegna">' + esc(T('gate_testo', { livello: L })) + '</p>' +
        '<label class="campo"><span>' + esc(T('nome')) + '</span><input name="nome" type="text" autocomplete="given-name" maxlength="40" required></label>' +
        '<label class="campo"><span>' + esc(T('email')) + '</span><input name="email" type="email" autocomplete="email" inputmode="email" maxlength="120" required></label>' +
        // campo trappola: le persone non lo vedono, i bot lo compilano
        '<div class="trappola" aria-hidden="true"><label>Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>' +
        '<label class="consenso"><input name="consenso" type="checkbox"><span>' + T('consenso', { privacy: esc(CFG.privacy_url) }) + '</span></label>' +
        '<button type="submit" class="btn pri">' + esc(T('invia')) + '</button>' +
        '<p class="errore" role="alert" ' + (errore ? '' : 'hidden') + '>' + esc(errore || '') + '</p></form>');
    }

    function vistaProfilo() {
      var R = S.ris, righe = P.ABILITA.slice().sort(function (a, b) {
        return ['grammatica', 'lessico', 'lettura', 'ascolto'].indexOf(a) - ['grammatica', 'lessico', 'lettura', 'ascolto'].indexOf(b);
      }).map(function (a) {
        var p = R.punteggi[a];
        return '<div class="riga-ab"><b>' + esc(T('ab_' + a)) + '</b><div class="misura"><div style="width:' + (p === null ? 0 : Math.max(6, p)) + '%"></div></div>' +
          '<span class="fascia">' + esc(T('fascia_' + P.fascia(p))) + '</span></div>';
      }).join('');
      var partenza = R.debole === 'equilibrato' ? esc(T('prof_equilibrato'))
        : T('prof_partenza_testo', { abilita: esc(T('ab_' + R.debole).toLowerCase()) });
      mostra('<div class="card"><span class="pill">' + esc(T('prof_pill')) + '</span>' +
        '<h1 class="titolo">' + titolo(T('prof_titolo', { livello: R.livello })) + '</h1>' +
        '<p class="consegna">' + esc(T('prof_testo', { email: S.contatto.email })) + '</p>' +
        '<div class="righe">' + righe + '</div>' +
        '<div class="riquadro"><p class="frase-etichetta">' + esc(T('prof_partenza')) + '</p><p>' + partenza + '</p></div>' +
        (CFG.webhook ? '' : '<p class="avviso">' + esc(T('prova_nota')) + '</p>') + '</div>');
    }

    /* ---------- invio a GHL ---------- */
    // Solo codici chiusi e numeri: niente testi liberi, a parte nome ed email. Il workflow GHL
    // controlla i valori ammessi prima di spedire qualsiasi email.
    function payload() {
      var R = S.ris, q = {};
      try { new URLSearchParams(location.search).forEach(function (v, k) { q[k] = v; }); } catch (e) {}
      var n = function (v) { return v === null || v === undefined ? '' : v; };
      return {
        fonte: 'quiz-livello-italiano',
        quiz_versione: D.versione,
        data_quiz: new Date().toISOString(),
        nome: S.contatto.nome,
        email: S.contatto.email,
        consenso_privacy: 'si',
        lingua: S.lang,
        livello: R.livello,
        abilita_debole: R.debole,
        abilita_debole_en: P.ABILITA_EN[R.debole],
        abilita_forte: R.forte,
        punteggio_grammatica: n(R.punteggi.grammatica),
        punteggio_lessico: n(R.punteggi.lessico),
        punteggio_lettura: n(R.punteggi.lettura),
        punteggio_ascolto: n(R.punteggi.ascolto),
        ascolto_saltato: S.ascolto ? 'no' : 'si',
        audio_errore: S.audioErrore ? 'si' : 'no',
        instradamento_corrette: S.instradamento,
        blocchi: S.blocchi.map(function (b) { return b.livello + ':' + b.corrette + '/' + b.totale; }).join(';'),
        domande_viste: S.ordine.length,
        risposte_corrette: S.ordine.filter(function (id) { return S.risposte[id].ok; }).length,
        risposte: S.ordine.map(function (id) { return id + ':' + (S.risposte[id].nls ? 'n' : S.risposte[id].ok); }).join(';'),
        durata_secondi: R.durata,
        utm_source: q.utm_source || '', utm_medium: q.utm_medium || '', utm_campaign: q.utm_campaign || '',
        utm_content: q.utm_content || '', utm_term: q.utm_term || '',
        referrer: (document.referrer || '').slice(0, 200),
        dispositivo: root.innerWidth < 768 ? 'mobile' : 'desktop'
      };
    }
    // Coda con ritentativi, come nel calcolatore fiera: se la rete cade la scheda resta nel
    // browser e riparte quando torna.
    var inviando = false;
    function inviaCoda() {
      if (!CFG.webhook || inviando) return Promise.resolve(!leggiCoda().length);
      inviando = true;
      var passo = function () {
        var q = leggiCoda();
        if (!q.length) return Promise.resolve(true);
        return fetch(CFG.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q[0]), keepalive: true })
          .then(function (r) {
            if (!r.ok) return false;
            var resto = leggiCoda(); resto.shift(); scrivi(CODA, resto);
            return passo();
          }).catch(function () { return false; });
      };
      return passo().then(function (esito) { inviando = false; return esito; });
    }
    function leggiCoda() { return leggi(CODA) || []; }

    function invia(form) {
      var f = form.elements, nome = f.nome.value.trim(), email = f.email.value.trim();
      var err = form.querySelector('.errore'), btn = form.querySelector('[type="submit"]');
      var dici = function (k) { err.textContent = T(k); err.hidden = false; };
      if (!nome || /(https?:|www\.|\/\/|[<>])/i.test(nome)) return dici('err_nome');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return dici('err_email');
      if (!f.consenso.checked) return dici('err_consenso');
      err.hidden = true;
      S.contatto = { nome: nome.slice(0, 40), email: email };
      // Un bot compila il campo trappola o arriva al modulo in pochi secondi: gli si mostra
      // la conferma senza inviare nulla.
      var sospetto = f.website.value || (Date.now() - S.inizio) < CFG.min_secondi * 1000;
      var fine = function () { S.fase = 'profilo'; evento('iscrizione_quiz', { quiz_livello: S.ris.livello }); vistaProfilo(); cancella(CHIAVE); };
      if (sospetto) return fine();
      var dati = payload();
      if (!CFG.webhook) { try { console.log('[quiz] payload (modalità prova)', dati); } catch (e) {} return fine(); }
      btn.disabled = true; btn.textContent = T('invio');
      scrivi(CODA, [dati]);                 // una scheda sola per sessione: un nuovo invio sostituisce la precedente
      var prova = function () {
        inviaCoda().then(function (esito) {
          if (S.fase === 'profilo') return;
          if (esito) { clearInterval(giro); return fine(); }
          btn.disabled = false; btn.textContent = T('invia');
          dici('err_rete');
        });
      };
      clearInterval(giro); giro = setInterval(prova, 15000);
      prova();
    }
    var giro = null;
    root.addEventListener('online', inviaCoda);
    inviaCoda();                            // scheda rimasta in coda da una visita precedente

    /* ---------- eventi ---------- */
    function inizia() {
      ripresa = null; var l = S.lang; S = nuovo(); S.lang = l; S.fase = 'audio'; salva();
      evento('quiz_inizio');
      precarica(['prova']);
      vistaAudio();
    }
    function parti(conAscolto) {
      S.ascolto = conAscolto; S.fase = 'quiz'; S.stadio = 'R';
      S.coda = D.instradamento.map(function (it) { return it.id; }); S.pos = 0;
      S.inizio = Date.now(); salva();
      vistaDomanda();
    }
    sr.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b || b.disabled) return;
      var act = b.getAttribute('data-act'), i = Number(b.getAttribute('data-i')), k = Number(b.getAttribute('data-k'));
      if (act === 'lingua') { S.lang = S.lang === 'it' ? 'en' : 'it'; lang = S.lang; vistaIntro(); }
      else if (act === 'inizia') inizia();
      else if (act === 'riprendi') {
        var l = S.lang; S = ripresa; S.lang = l; ripresa = null;
        if (S.fase === 'audio') vistaAudio(); else if (S.fase === 'livello') vistaLivello(); else {
          precarica(S.coda.map(function (id) { return items[id].audio; }).filter(Boolean));
          vistaDomanda();
        }
      }
      else if (act === 'audio-si') parti(true);
      else if (act === 'audio-no') parti(false);
      else if (act === 'play') play();
      else if (act === 'salta-ascolto') { fermaAudio(); if (S.fase === 'audio') parti(false); else saltaAscolto(); }
      else if (act === 'opt') { U.sel = i; corpo(); }
      else if (act === 'metti') { if (U.scelte.indexOf(k) < 0) U.scelte.push(k); corpo(); }
      else if (act === 'togli') { U.scelte = U.scelte.filter(function (x) { return x !== k; }); corpo(); }
      else if (act === 'sx') {
        if (U.coppie[i] !== undefined) { delete U.coppie[i]; U.attiva = null; } else U.attiva = (U.attiva === i ? null : i);
        corpo();
      }
      else if (act === 'dx') {
        var occupata = Object.keys(U.coppie).filter(function (s) { return U.coppie[s] === i; })[0];
        if (occupata !== undefined) delete U.coppie[occupata];
        else if (U.attiva !== null) { U.coppie[U.attiva] = i; U.attiva = null; }
        corpo();
      }
      else if (act === 'nls') registra(true);
      else if (act === 'avanti') registra(false);
    });
    sr.addEventListener('submit', function (e) { e.preventDefault(); invia(e.target); });

    vistaIntro();
    return { stato: function () { return S; } };
  }

  root.MTMQuiz = { mount: mount };
})(window);

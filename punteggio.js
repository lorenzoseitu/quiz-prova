/* Punteggio del quiz di livello: funzioni pure, senza DOM.
   Girano nel browser (window.MTMPunteggio) e in node (require), così strumenti/simula.js
   prova le stesse regole che usa la pagina. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MTMPunteggio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIVELLI = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  // L'ordine conta: è l'ultimo criterio di spareggio per l'abilità debole.
  var ABILITA = ['ascolto', 'grammatica', 'lessico', 'lettura'];
  var ABILITA_EN = { ascolto: 'listening', grammatica: 'grammar', lessico: 'vocabulary', lettura: 'reading', equilibrato: 'all-round' };
  var MAX_BLOCCHI = 3;

  // Stadio 1: 6 domande (A1, A2, B1, B1, B2, C1). L'ingresso non è mai C2:
  // per ottenere C2 bisogna superare prima il blocco C1.
  function ingresso(corrette) {
    if (corrette <= 1) return 'A1';
    if (corrette === 2) return 'A2';
    if (corrette <= 4) return 'B1';
    if (corrette === 5) return 'B2';
    return 'C1';
  }

  // 5 su 8 con l'ascolto, 4 su 6 senza.
  function superato(corrette, totale) {
    return totale > 0 && corrette >= Math.ceil(totale * 0.625);
  }

  // blocchi: [{livello, corrette, totale, superato}] nell'ordine in cui sono stati fatti.
  // Restituisce il livello del prossimo blocco, oppure null se il test è finito.
  function prossimo(blocchi) {
    if (!blocchi.length || blocchi.length >= MAX_BLOCCHI) return null;
    var ultimo = blocchi[blocchi.length - 1];
    var i = LIVELLI.indexOf(ultimo.livello);
    var fatto = function (l) { return blocchi.some(function (b) { return b.livello === l; }); };
    if (ultimo.superato) {
      // si sale finché non si trova un blocco fallito sopra
      if (i === LIVELLI.length - 1 || fatto(LIVELLI[i + 1])) return null;
      return LIVELLI[i + 1];
    }
    // si scende finché non si trova un blocco superato sotto
    if (i === 0 || fatto(LIVELLI[i - 1])) return null;
    return LIVELLI[i - 1];
  }

  // Blocco più alto superato; se nessuno, un livello sotto il più basso somministrato (minimo A1).
  function livelloFinale(blocchi) {
    var passati = blocchi.filter(function (b) { return b.superato; })
      .map(function (b) { return LIVELLI.indexOf(b.livello); });
    if (passati.length) return LIVELLI[Math.max.apply(null, passati)];
    var fatti = blocchi.map(function (b) { return LIVELLI.indexOf(b.livello); });
    if (!fatti.length) return 'A1';
    return LIVELLI[Math.max(0, Math.min.apply(null, fatti) - 1)];
  }

  // risposte: [{abilita, livello, ok (0|1), nls (bool)}], solo item dei blocchi di livello.
  // L'instradamento non entra nel profilo: ha solo grammatica e lessico.
  function profilo(risposte, ascoltoSaltato) {
    var usate = ABILITA.filter(function (a) { return !(ascoltoSaltato && a === 'ascolto'); });
    var stat = {};
    ABILITA.forEach(function (a) { stat[a] = { ok: 0, tot: 0, nls: 0, erroriFacile: 0 }; });

    var livelli = risposte.map(function (r) { return LIVELLI.indexOf(r.livello); });
    var facile = livelli.length ? LIVELLI[Math.min.apply(null, livelli)] : null;

    risposte.forEach(function (r) {
      var s = stat[r.abilita];
      if (!s) return;
      s.tot++;
      if (r.ok) s.ok++;
      else if (r.livello === facile) s.erroriFacile++;
      if (r.nls) s.nls++;
    });

    var punteggi = {};
    ABILITA.forEach(function (a) {
      var s = stat[a];
      punteggi[a] = (usate.indexOf(a) < 0 || !s.tot) ? null : Math.round(100 * s.ok / s.tot);
    });

    var valide = usate.filter(function (a) { return punteggi[a] !== null; });
    var debole = 'equilibrato', forte = '';
    if (valide.length) {
      var min = Math.min.apply(null, valide.map(function (a) { return punteggi[a]; }));
      var max = Math.max.apply(null, valide.map(function (a) { return punteggi[a]; }));
      if (min < 75) {
        // spareggio: più errori nel blocco più facile, poi più "non lo so", poi ordine fisso di ABILITA
        var pari = valide.filter(function (a) { return punteggi[a] === min; }).sort(function (a, b) {
          return (stat[b].erroriFacile - stat[a].erroriFacile) || (stat[b].nls - stat[a].nls) ||
            (ABILITA.indexOf(a) - ABILITA.indexOf(b));
        });
        // Tutte le abilità identiche anche negli spareggi (caso tipico: blocco del proprio livello
        // superato in pieno, blocco sopra fallito in pieno): non c'è un punto debole da indicare.
        var indistinte = pari.length === valide.length && pari.length > 1 &&
          stat[pari[0]].erroriFacile === stat[pari[pari.length - 1]].erroriFacile &&
          stat[pari[0]].nls === stat[pari[pari.length - 1]].nls;
        debole = indistinte ? 'equilibrato' : pari[0];
      }
      // punto forte solo se è uno solo: a pari merito non si indica nulla
      var alte = valide.filter(function (a) { return punteggi[a] === max; });
      if (max > min && alte.length === 1) forte = alte[0];
    }
    return { punteggi: punteggi, debole: debole, forte: forte };
  }

  // Fascia mostrata a schermo: il numero preciso va solo a GHL.
  function fascia(punteggio) {
    if (punteggio === null) return 'saltato';
    if (punteggio >= 75) return 'forte';
    if (punteggio >= 50) return 'in_linea';
    return 'da_rinforzare';
  }

  return {
    LIVELLI: LIVELLI, ABILITA: ABILITA, ABILITA_EN: ABILITA_EN, MAX_BLOCCHI: MAX_BLOCCHI,
    ingresso: ingresso, superato: superato, prossimo: prossimo,
    livelloFinale: livelloFinale, profilo: profilo, fascia: fascia
  };
});

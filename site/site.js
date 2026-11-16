/* Scripts do site de apresentação (landing e documentação). Sem dependências. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- menu mobile da landing ---------- */
  const nav = $('#nav');
  const toggle = $('#nav-toggle');
  if (nav && toggle) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    $$('#nav-links a').forEach((a) => a.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
  }

  /* ---------- revelar ao rolar ---------- */
  const reveals = $$('.reveal');
  if (reveals.length) {
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      reveals.forEach((el) => io.observe(el));
    } else {
      reveals.forEach((el) => el.classList.add('in'));
    }
  }

  /* ---------- mostra de telas ---------- */
  const shots = $('#shots');
  if (shots) {
    const SLIDES = [
      { t: 'Buscar', p: 'A tela inicial já mostra o que importa: o que você mais ouve, suas playlists e gêneros para explorar.',
        l: ['Pesquise por nome ou artista, em qualquer tela', 'Recomendados a partir do seu histórico', 'Toque agora, adicione à fila ou a uma playlist'] },
      { t: 'Fila de reprodução', p: 'Veja o que está tocando e o que vem depois, com o controle total na ponta dos dedos.',
        l: ['Reordene arrastando e remova com um clique', 'Autoplay: continua com músicas parecidas', 'Player fixo com volume, pular, repetir e embaralhar'] },
      { t: 'Playlists', p: 'Organize as suas músicas e decida quem pode ver e tocar cada playlist.',
        l: ['Privadas, do servidor ou públicas', 'Importe do Spotify e do YouTube Music por link', 'Só o dono edita; todos podem curtir e tocar'] },
      { t: 'Cápsula do tempo', p: 'Uma retrospectiva mensal, no estilo retrospectiva de fim de ano, para o servidor inteiro ou só para você.',
        l: ['Minutos ouvidos, músicas tocadas e artistas diferentes', 'Ranking dos artistas mais ouvidos do mês', 'Cartão para compartilhar como imagem'] }
    ];
    const imgs = $$('img', shots);
    const tabs = $$('.tab');
    const ct = $('#copy-t'), cp = $('#copy-p'), cl = $('#copy-l');
    let cur = 0, timer = null;

    function show(i, user) {
      cur = i;
      imgs.forEach((im, k) => im.classList.toggle('on', k === i));
      tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; });
      const s = SLIDES[i];
      ct.textContent = s.t; cp.textContent = s.p;
      cl.innerHTML = s.l.map((x) => '<li></li>').join('');
      $$('li', cl).forEach((li, k) => { li.textContent = s.l[k]; });
      if (user) stop();
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      stop(); timer = setInterval(() => show((cur + 1) % SLIDES.length), 6000);
    }
    tabs.forEach((t, k) => t.addEventListener('click', () => show(k, true)));
    $('.tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = (cur + (e.key === 'ArrowRight' ? 1 : SLIDES.length - 1)) % SLIDES.length;
      show(n, true); tabs[n].focus();
    });
    show(0);
    // só gira sozinho enquanto a seção está à vista
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? start() : stop())), { threshold: 0.35 }).observe(shots);
    }
  }

  /* =====================================================================
     Documentação
     ===================================================================== */
  if (!document.body.classList.contains('docs')) return;

  const articles = $$('.d-article');
  const navLinks = $$('.d-nav a');
  const tocBox = $('#toc');
  const order = navLinks.map((a) => a.getAttribute('href').slice(1));
  const titleOf = {};
  articles.forEach((a) => { titleOf[a.id] = $('h1', a).textContent; });

  function pageFromHash() {
    const raw = decodeURIComponent(location.hash.slice(1));
    if (!raw) return { page: order[0], anchor: '' };
    if (titleOf[raw]) return { page: raw, anchor: '' };
    const target = document.getElementById(raw);
    const art = target && target.closest('.d-article');
    return art ? { page: art.id, anchor: raw } : { page: order[0], anchor: '' };
  }

  let spy = null;
  function buildToc(art) {
    const heads = $$('h2, h3', art);
    tocBox.innerHTML = '';
    if (!heads.length) return;
    heads.forEach((h) => {
      if (!h.id) h.id = art.id + '-' + h.textContent.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const li = document.createElement('li');
      if (h.tagName === 'H3') li.className = 'sub';
      const a = document.createElement('a');
      a.href = '#' + h.id; a.textContent = h.textContent;
      li.appendChild(a); tocBox.appendChild(li);
    });
    if (spy) spy.disconnect();
    if ('IntersectionObserver' in window) {
      const links = $$('a', tocBox);
      spy = new IntersectionObserver((es) => {
        es.forEach((e) => {
          if (e.isIntersecting) { links.forEach((l) => l.classList.toggle('on', l.getAttribute('href') === '#' + e.target.id)); }
        });
      }, { rootMargin: '-80px 0px -70% 0px' });
      heads.forEach((h) => spy.observe(h));
    }
  }

  function render() {
    const { page, anchor } = pageFromHash();
    articles.forEach((a) => { a.hidden = a.id !== page; });
    navLinks.forEach((l) => l.classList.toggle('on', l.getAttribute('href') === '#' + page));
    const art = document.getElementById(page);
    buildToc(art);
    const i = order.indexOf(page);
    const pn = $('.pn', art);
    if (pn && !pn.dataset.done) {
      pn.dataset.done = '1';
      const prev = order[i - 1], next = order[i + 1];
      pn.innerHTML = (prev ? `<a href="#${prev}"><small>Anterior</small>${titleOf[prev]}</a>` : '<span></span>') +
                     (next ? `<a href="#${next}"><small>Próximo</small>${titleOf[next]}</a>` : '<span></span>');
    }
    document.title = titleOf[page] + ' · Documentação do Vitrola';
    document.body.classList.remove('menu-open');
    if (anchor) { const el = document.getElementById(anchor); if (el) el.scrollIntoView(); }
    else window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);
  render();

  /* ---------- copiar blocos de código ---------- */
  $$('.code').forEach((box) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'copy'; btn.setAttribute('aria-label', 'Copiar');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>';
    btn.addEventListener('click', async () => {
      const text = $('pre', box).innerText.replace(/\n$/, '');
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch { /* sem permissão */ } ta.remove();
      }
      btn.classList.add('ok');
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
      setTimeout(() => { btn.classList.remove('ok'); btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>'; }, 1600);
    });
    box.appendChild(btn);
  });

  /* ---------- menu lateral no celular ---------- */
  const burger = $('#d-burger');
  if (burger) burger.addEventListener('click', () => document.body.classList.toggle('menu-open'));
  const scrim = $('.d-scrim');
  if (scrim) scrim.addEventListener('click', () => document.body.classList.remove('menu-open'));

  /* ---------- busca (Ctrl K) ---------- */
  const pal = $('#pal'), input = $('#pal-input'), list = $('#pal-list');
  const index = articles.map((a) => ({ id: a.id, title: titleOf[a.id], text: a.innerText.toLowerCase(), lede: ($('.lede', a) || {}).textContent || '' }));
  const strip = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let sel = 0, results = [];
  function draw() {
    const q = strip(input.value.trim());
    results = !q ? index : index.filter((p) => strip(p.title + ' ' + p.text).includes(q));
    sel = 0;
    list.innerHTML = results.length
      ? results.map((p, i) => `<li><a href="#${p.id}" class="${i === 0 ? 'sel' : ''}"><b>${p.title}</b><small>${p.lede}</small></a></li>`).join('')
      : '<li class="pal-empty">Nada encontrado para essa busca.</li>';
  }
  function openPal() { pal.classList.add('open'); input.value = ''; draw(); setTimeout(() => input.focus(), 10); }
  function closePal() { pal.classList.remove('open'); }
  $$('[data-open-search]').forEach((b) => b.addEventListener('click', openPal));
  pal.addEventListener('click', (e) => { if (e.target === pal) closePal(); });
  list.addEventListener('click', (e) => { if (e.target.closest('a')) closePal(); });
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    const links = $$('a', list);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!links.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : links.length - 1)) % links.length;
      links.forEach((l, i) => l.classList.toggle('sel', i === sel));
      links[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && links[sel]) { location.hash = links[sel].getAttribute('href'); closePal(); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.classList.contains('open') ? closePal() : openPal(); }
    else if (e.key === 'Escape') { closePal(); document.body.classList.remove('menu-open'); }
    else if (e.key === '/' && !/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); openPal(); }
  });
})();

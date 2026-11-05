// Tutorial guiado da demonstracao (so existe no site de demonstracao).
//
// Quando a pessoa escolhe "Ouvir no site" ou "Ouvir no Discord", uma caixinha
// acompanha o passo a passo: destaca o botao certo, explica e espera a pessoa
// clicar (ou faz por ela, no botao "pra mim"). Igual aos tutoriais de app.
//
// Como funciona: a cada ~150 ms olha em que tela o app esta (landing, escolha
// de modo, player do site, escolha de servidor, app do Discord) e usa o roteiro
// dessa tela. Cada passo pode:
//   - ser so informativo (botao "Próximo");
//   - exigir uma acao (needsAction): avanca sozinho quando `done(document)` fica
//     verdadeiro ou, com advanceOnClick, quando a pessoa clica no elemento destacado;
//   - ter um atalho `assist` ("Digitar pra mim", "Tocar pra mim"...).
// O app em si (public/app.js) nao conhece o tutorial: tudo aqui e lido da pagina.
(function (root) {
  'use strict';

  const SESSION_KEY = 'vitrolaDemoTour';
  const REPO_URL = 'https://github.com/ismash1598/Vitrola';

  // ---------- helpers de pagina (recebem o document, entao dao pra testar) ----------
  const shown = (d, sel) => {
    const el = d.querySelector(sel);
    return !!el && !el.classList.contains('hidden');
  };
  const has = (d, sel) => !!d.querySelector(sel);
  const isActive = (id) => (d) => {
    const el = d.getElementById(id);
    return !!el && el.classList.contains('active');
  };
  // a mesma aba existe na sidebar (PC) e na barra de baixo (celular): o motor
  // destaca a que estiver visivel.
  const tabBtn = (tab) => [`.sidebar-nav-btn[data-tab="${tab}"]`, `.bottom-bar-nav .tab-btn[data-tab="${tab}"]`];

  function visibleEl(d, selectors) {
    for (const sel of selectors || []) {
      for (const el of d.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
    }
    return null;
  }

  // Digita num campo de busca e envia o formulario, como a pessoa faria.
  function typeAndSubmit(d, inputSelectors, value) {
    const input = visibleEl(d, inputSelectors);
    if (!input) return false;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const form = input.form;
    if (!form) return false;
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return true;
  }

  function clickTarget(d, step) {
    const el = visibleEl(d, step.target);
    if (!el) return false;
    el.click();
    return true;
  }

  // ---------- roteiros ----------
  // `dynamic: true` = o alvo so existe depois que o app desenha algo (resultado
  // de busca, lista de servidores); o teste nao exige esses seletores no HTML.
  const FLOWS = {
    chooser: {
      label: 'Início',
      steps: [
        {
          id: 'choose',
          target: ['.mode-chooser-options'],
          title: 'Escolha como quer ouvir',
          text: ({ completed }) => {
            if (completed.browser && completed.discord) {
              return 'Você já passou pelos dois modos. Explore à vontade ou use "Início" na faixa ao lado para voltar à tela inicial.';
            }
            if (completed.browser || completed.discord) return 'Falta ver o outro modo. Clique nele e eu continuo te guiando.';
            return 'O Vitrola tem dois modos de uso. Clique em um deles e eu te guio, passo a passo. Dá para ver os dois.';
          },
          needsAction: true,
          hint: 'Clique em uma das duas opções.',
        },
      ],
    },

    browser: {
      label: 'Ouvir no site',
      steps: [
        {
          id: 'intro',
          target: ['#browser-player-shell .browser-shell-header'],
          title: 'Ouvir no site',
          text: 'Este é o player independente: ele toca só neste navegador, sem canal de voz e sem Discord. Em poucos passos você usa tudo.',
          nextLabel: 'Começar',
        },
        {
          id: 'search',
          target: ['#browser-search-form'],
          title: 'Busque uma música',
          text: 'Digite um gênero ou artista (por exemplo rock, funk ou MC Neblina) e aperte Enter.',
          needsAction: true,
          assist: { label: 'Digitar "rock" pra mim', run: (d) => typeAndSubmit(d, ['#browser-search-input'], 'rock') },
          done: (d) => has(d, '#browser-search-results .track-item'),
        },
        {
          id: 'play',
          dynamic: true,
          target: ['#browser-search-results .track-item button[title="Tocar a seguir"]'],
          title: 'Toque uma faixa',
          text: 'Clique no botão ▶ de qualquer resultado. Ela começa a tocar na hora.',
          needsAction: true,
          assist: { label: 'Tocar pra mim', run: clickTarget },
          done: (d) => shown(d, '#browser-player-bar'),
        },
        {
          id: 'controls',
          target: ['#browser-player-bar'],
          title: 'Controles do player',
          text: 'Pausar, anterior, próxima, barra de progresso (arraste para pular) e volume. Nesta demonstração o áudio é gerado pelo próprio navegador, por isso soa como um sintetizador.',
        },
        {
          id: 'queue-add',
          dynamic: true,
          target: [
            '#browser-search-results .track-item:nth-child(2) button[title="Adicionar à fila"]',
            '#browser-search-results .track-item button[title="Adicionar à fila"]',
          ],
          title: 'Monte uma fila',
          text: 'Clique no + de outra faixa para colocá-la na fila.',
          needsAction: true,
          assist: { label: 'Adicionar pra mim', run: clickTarget },
          done: (d) => shown(d, '#browser-queue-section'),
        },
        {
          id: 'queue-view',
          target: ['#browser-queue-section'],
          title: 'Sua fila',
          text: 'As próximas faixas aparecem aqui. Dá para tocar uma delas na hora ou tirá-la da fila.',
        },
        {
          id: 'finish',
          target: ['#browser-mode-back-btn'],
          title: 'Quer ver o outro modo?',
          text: 'Clique em "Trocar modo" para voltar e experimentar o Ouvir no Discord.',
          nextLabel: 'Concluir',
          done: (d) => shown(d, '#mode-chooser'),
        },
      ],
    },

    discord: {
      label: 'Ouvir no Discord',
      steps: [
        {
          id: 'server',
          dynamic: true,
          target: ['#guild-picker-list .guild-picker-item'],
          title: 'Escolha um servidor',
          text: 'No uso real aparecem os servidores do Discord em que você e o bot estão. Aqui só existe o "Vitrola Demo": clique nele.',
          needsAction: true,
          assist: { label: 'Escolher pra mim', run: clickTarget },
          done: (d) => shown(d, '.app-shell'),
        },
        {
          id: 'menu',
          target: ['.sidebar-nav', '.bottom-bar-nav'],
          title: 'Menu',
          text: 'Aqui você controla o bot que toca no canal de voz do servidor. As abas são Buscar, Fila, Playlists, Gêneros e Histórico.',
        },
        {
          id: 'search',
          target: ['#search-form-desktop', '#search-form'],
          title: 'Busque no catálogo',
          text: 'Digite um gênero ou artista e aperte Enter.',
          needsAction: true,
          assist: { label: 'Digitar "funk" pra mim', run: (d) => typeAndSubmit(d, ['#search-input-desktop', '#search-input'], 'funk') },
          done: (d) => has(d, '#search-results .track-item'),
        },
        {
          id: 'enqueue',
          dynamic: true,
          target: [
            '#search-results .track-item:nth-child(2) button[title="Adicionar à fila"]',
            '#search-results .track-item button[title="Adicionar à fila"]',
          ],
          title: 'Coloque na fila do bot',
          text: 'Clique no + para adicionar a faixa à fila. Na vida real, o bot toca no canal de voz.',
          needsAction: true,
          advanceOnClick: true,
          assist: { label: 'Adicionar pra mim', run: clickTarget },
        },
        {
          id: 'player',
          target: ['.desktop-player-bar', '.bottom-bar-track'],
          title: 'Barra do player',
          text: 'Mostra o que está tocando e controla o bot: pausar, pular, autoplay (as setas em círculo), progresso e volume (até 200%).',
        },
        {
          id: 'tab-queue',
          target: tabBtn('queue'),
          title: 'Abra a Fila',
          text: 'Clique em "Fila".',
          needsAction: true,
          assist: { label: 'Abrir pra mim', run: clickTarget },
          done: isActive('tab-queue'),
        },
        {
          id: 'queue-info',
          target: ['#tab-queue .queue-page-header'],
          title: 'Fila de reprodução',
          text: 'Veja o que toca agora e o que vem a seguir, reordene ou remova faixas e ligue o Autoplay para continuar sozinho quando a fila acabar.',
        },
        {
          id: 'tab-playlists',
          target: tabBtn('playlists'),
          title: 'Abra Playlists',
          text: 'Clique em "Playlists".',
          needsAction: true,
          assist: { label: 'Abrir pra mim', run: clickTarget },
          done: isActive('tab-playlists'),
        },
        {
          id: 'playlists-info',
          target: ['#open-create-playlist-btn'],
          title: 'Playlists',
          text: 'Crie uma playlist por aqui ou importe de um link do Spotify ou YouTube (na demonstração vira uma playlist de exemplo). Elas podem ser privadas, do servidor ou públicas.',
        },
        {
          id: 'tab-history',
          target: tabBtn('history'),
          title: 'Abra o Histórico',
          text: 'Clique em "Histórico" para ver a Cápsula do tempo.',
          needsAction: true,
          assist: { label: 'Abrir pra mim', run: clickTarget },
          done: isActive('tab-history'),
        },
        {
          id: 'history-info',
          target: ['#retro-scope-server', '#retro-scope-personal'],
          title: 'Cápsula do tempo',
          text: 'O resumo do mês: minutos ouvidos, artistas e músicas mais tocados, dia mais intenso. Dá para ver do servidor ou só seu e compartilhar como imagem.',
        },
        {
          id: 'end',
          title: 'Fim do tutorial',
          text: 'Essa foi a demonstração do Vitrola. Para ter o seu: baixe o projeto no GitHub, crie seu bot no Discord, cole o token no Configurar.bat e pronto. É um projeto de estudo, para uso pessoal.',
          link: { label: 'Ver no GitHub', href: REPO_URL },
          nextLabel: 'Concluir',
        },
      ],
    },
  };

  // qual roteiro vale para cada tela do app
  const SCREEN_FLOW = { chooser: 'chooser', browser: 'browser', guild: 'discord', app: 'discord' };

  function detectScreen(d) {
    if (shown(d, '#landing-page')) return 'landing';
    if (shown(d, '#browser-player-shell')) return 'browser';
    if (shown(d, '#guild-picker-screen')) return 'guild';
    if (shown(d, '#mode-chooser')) return 'chooser';
    if (shown(d, '.app-shell')) return 'app';
    return 'none';
  }

  const api = { FLOWS, SCREEN_FLOW, detectScreen, REPO_URL };

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return;
  }

  // =====================================================================
  // Parte do navegador
  // =====================================================================
  const win = root;
  const doc = win.document;

  function loadState() {
    try {
      const saved = JSON.parse(win.sessionStorage.getItem(SESSION_KEY) || '{}');
      return { skipped: !!saved.skipped, completed: saved.completed && typeof saved.completed === 'object' ? saved.completed : {} };
    } catch {
      return { skipped: false, completed: {} };
    }
  }
  const state = loadState();
  function saveState() {
    try { win.sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch { /* sem sessionStorage: vale so ate recarregar */ }
  }

  const style = doc.createElement('style');
  style.textContent = `
    .tour-dim{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.62)}
    .tour-spot{position:fixed;z-index:10000;pointer-events:none;border-radius:12px;
      box-shadow:0 0 0 9999px rgba(0,0,0,.62),0 0 0 2px var(--accent,#e9d34a);transition:left .18s,top .18s,width .18s,height .18s}
    .tour-spot.is-action{animation:tourPulse 1.4s ease-in-out infinite}
    @keyframes tourPulse{0%,100%{box-shadow:0 0 0 9999px rgba(0,0,0,.62),0 0 0 2px var(--accent,#e9d34a),0 0 0 4px rgba(233,211,74,.0)}
      50%{box-shadow:0 0 0 9999px rgba(0,0,0,.62),0 0 0 2px var(--accent,#e9d34a),0 0 0 9px rgba(233,211,74,.35)}}
    .tour-card{position:fixed;z-index:10001;box-sizing:border-box;width:min(340px,calc(100vw - 24px));padding:16px 16px 14px;
      border-radius:14px;color:var(--text,#f2ece0);background:var(--bg-elevated,#1d1b16);border:1px solid rgba(233,211,74,.45);
      box-shadow:0 14px 40px rgba(0,0,0,.55);font-family:inherit;font-size:14px;line-height:1.45;transition:left .18s,top .18s}
    .tour-card[hidden],.tour-spot[hidden],.tour-dim[hidden]{display:none}
    .tour-step{margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent,#e9d34a)}
    .tour-title{margin:0 0 6px;font-size:17px;font-weight:700;line-height:1.25}
    .tour-text{margin:0;color:var(--text-bright,#cfc7b2)}
    .tour-hint{margin:8px 0 0;font-size:12px;color:var(--text-dim,#9a9384)}
    .tour-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px}
    .tour-actions .grow{flex:1}
    .tour-btn{all:unset;box-sizing:border-box;cursor:pointer;padding:7px 12px;border-radius:999px;font-size:13px;font-weight:600;
      border:1px solid rgba(255,255,255,.2);color:var(--text,#f2ece0)}
    .tour-btn:hover{background:rgba(255,255,255,.08)}
    .tour-btn:focus-visible{outline:2px solid var(--accent,#e9d34a);outline-offset:2px}
    .tour-btn.primary{background:var(--accent,#e9d34a);border-color:var(--accent,#e9d34a);color:var(--accent-contrast,#17160f)}
    .tour-btn.primary:hover{filter:brightness(1.08)}
    .tour-btn.ghost{border-color:transparent;color:var(--text-dim,#9a9384);font-weight:500}
    a.tour-btn{text-decoration:none}`;
  doc.head.appendChild(style);

  const dim = doc.createElement('div');
  dim.className = 'tour-dim';
  dim.hidden = true;
  const spot = doc.createElement('div');
  spot.className = 'tour-spot';
  spot.hidden = true;
  const card = doc.createElement('div');
  card.className = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  card.hidden = true;
  doc.body.append(dim, spot, card);

  let flowName = null;
  let index = 0;
  let stableScreen = 'none';
  let pendingScreen = 'none';
  let pendingCount = 0;
  let currentEl = null;
  let drawnKey = null;
  let scrolledKey = null;

  const currentStep = () => (flowName ? FLOWS[flowName].steps[index] : null);

  function resolveText(step) {
    return typeof step.text === 'function' ? step.text({ completed: state.completed }) : step.text;
  }

  function hideAll() {
    dim.hidden = true;
    spot.hidden = true;
    card.hidden = true;
    currentEl = null;
    drawnKey = null;
  }

  function stopFlow() {
    flowName = null;
    hideAll();
  }

  function finishFlow() {
    if (flowName && flowName !== 'chooser') {
      state.completed[flowName] = true;
      saveState();
    }
    stopFlow();
  }

  function advance() {
    if (!flowName) return;
    if (index + 1 >= FLOWS[flowName].steps.length) finishFlow();
    else index += 1;
  }

  function skip() {
    state.skipped = true;
    saveState();
    stopFlow();
  }

  function startFlowFor(screen, force) {
    const want = SCREEN_FLOW[screen] || null;
    if (!want || state.skipped) return stopFlow();
    if (!force && want !== 'chooser' && state.completed[want]) return stopFlow();
    if (want === flowName && !force) return;
    flowName = want;
    index = 0;
    drawnKey = null;
  }

  function restart() {
    state.skipped = false;
    state.completed = {};
    saveState();
    startFlowFor(stableScreen, true);
  }

  function el(tag, cls, text) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function fillCard(step) {
    const flow = FLOWS[flowName];
    card.replaceChildren();
    if (flow.steps.length > 1) card.appendChild(el('p', 'tour-step', `${flow.label} · passo ${index + 1} de ${flow.steps.length}`));
    card.appendChild(el('h3', 'tour-title', step.title));
    card.appendChild(el('p', 'tour-text', resolveText(step)));
    if (step.needsAction) card.appendChild(el('p', 'tour-hint', step.hint || 'Faça isso para continuar.'));

    const actions = el('div', 'tour-actions');
    const skipBtn = el('button', 'tour-btn ghost', 'Pular tutorial');
    skipBtn.type = 'button';
    skipBtn.addEventListener('click', skip);
    actions.append(skipBtn, el('span', 'grow'));

    if (step.link) {
      const a = el('a', 'tour-btn', step.link.label);
      a.href = step.link.href;
      a.target = '_blank';
      a.rel = 'noopener';
      actions.appendChild(a);
    }
    if (step.assist) {
      const assistBtn = el('button', 'tour-btn', step.assist.label);
      assistBtn.type = 'button';
      assistBtn.addEventListener('click', () => step.assist.run(doc, step));
      actions.appendChild(assistBtn);
    }
    if (!step.needsAction) {
      const next = el('button', 'tour-btn primary', step.nextLabel || 'Próximo');
      next.type = 'button';
      next.addEventListener('click', advance);
      actions.appendChild(next);
    }
    card.appendChild(actions);
  }

  function place(rect) {
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const gap = 14;
    const margin = 12;
    let top;
    let left;
    if (!rect) {
      top = (vh - ch) / 2;
      left = (vw - cw) / 2;
    } else {
      const below = vh - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      if (below >= ch) top = rect.bottom + gap;
      else if (above >= ch) top = rect.top - gap - ch;
      else top = vh - ch - margin;
      left = rect.left + rect.width / 2 - cw / 2;
    }
    // margem maior na direita: ali fica a faixa vertical "DEMO"
    left = Math.max(margin, Math.min(left, vw - cw - 28));
    top = Math.max(margin, Math.min(top, vh - ch - margin));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  function reposition() {
    const step = currentStep();
    if (!step || card.hidden) return;
    const rect = currentEl ? currentEl.getBoundingClientRect() : null;
    // alvo que ocupa quase a tela toda: destacar nao ajuda, so a caixinha
    const huge = rect && rect.width * rect.height > 0.55 * win.innerWidth * win.innerHeight;
    if (rect && !huge) {
      const pad = 6;
      spot.style.left = `${rect.left - pad}px`;
      spot.style.top = `${rect.top - pad}px`;
      spot.style.width = `${rect.width + pad * 2}px`;
      spot.style.height = `${rect.height + pad * 2}px`;
      spot.classList.toggle('is-action', !!step.needsAction);
      spot.hidden = false;
    } else {
      spot.hidden = true;
    }
    // sem alvo definido (mensagem final): escurece o fundo e centraliza
    dim.hidden = !!step.target;
    place(huge ? null : rect);
  }

  function draw(step) {
    const key = `${flowName}:${index}`;
    if (key !== drawnKey) {
      fillCard(step);
      drawnKey = key;
      card.hidden = false;
    }
    currentEl = visibleEl(doc, step.target);
    if (currentEl && scrolledKey !== key) {
      scrolledKey = key;
      const r = currentEl.getBoundingClientRect();
      if (r.top < 0 || r.bottom > win.innerHeight) currentEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    reposition();
  }

  function logicTick() {
    const screen = detectScreen(doc);
    doc.documentElement.dataset.demoScreen = screen;
    if (screen === pendingScreen) pendingCount += 1;
    else { pendingScreen = screen; pendingCount = 1; }
    // so troca de roteiro quando a tela se mantem por 2 verificacoes (evita piscar)
    if (pendingCount >= 2 && screen !== stableScreen) {
      stableScreen = screen;
      startFlowFor(screen, false);
    }

    const step = currentStep();
    if (!step || state.skipped) { if (!card.hidden) hideAll(); return; }
    if (step.done && step.done(doc)) {
      advance();
      return;
    }
    draw(step);
  }

  // clicar exatamente no elemento destacado conta como fazer o passo
  doc.addEventListener('click', (e) => {
    const step = currentStep();
    if (!step || !step.advanceOnClick || !currentEl) return;
    if (currentEl === e.target || currentEl.contains(e.target)) setTimeout(advance, 150);
  }, true);

  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentStep()) skip();
  });

  let last = 0;
  function frame(now) {
    if (now - last >= 150) {
      last = now;
      try { logicTick(); } catch (err) { console.error('tutorial:', err); }
    } else {
      reposition();
    }
    win.requestAnimationFrame(frame);
  }
  win.requestAnimationFrame(frame);

  win.VitrolaTour = { restart, skip };
})(typeof window !== 'undefined' ? window : globalThis);

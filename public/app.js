(() => {
  'use strict';

  // ---------- Icones (SVG inline, sem dependencias externas) ----------
  const ICONS = {
    play: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    playlistAdd: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h11M4 12h7M4 18h7M17 14v6M14 17h6"/></svg>',
    remove: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    heartOutline: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.6-7-9.4A4.1 4.1 0 0112 8a4.1 4.1 0 017 2.6C19 15.4 12 20 12 20z"/></svg>',
    heartFilled: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20s-7-4.6-7-9.4A4.1 4.1 0 0112 8a4.1 4.1 0 017 2.6C19 15.4 12 20 12 20z"/></svg>',
    trash: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    lock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
    users: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
    globe: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
  };

  const VISIBILITY_BADGE_ICON = { private: 'lock', server: 'users', public: 'globe' };
  const VISIBILITY_BADGE_LABEL = { private: 'Privada', server: 'Servidor', public: 'Pública' };

  // Categorias de playlist: nunca mistura playlist propria com playlist
  // publica/do servidor de outra pessoa numa lista so. Favoritar uma
  // playlist do servidor/publica de outra pessoa faz ela "migrar" pra
  // "Suas playlists" tambem (sem sumir de onde ela normalmente apareceria
  // pra quem nao favoritou).
  const PLAYLIST_CATEGORIES = [
    { key: 'private', label: 'Suas playlists' },
    { key: 'server', label: 'Playlists do servidor' },
    { key: 'public', label: 'Playlists públicas' },
  ];

  function isMinePlaylist(pl) {
    return pl.ownerId === currentUser?.id || (pl.favoritedBy || []).includes(currentUser?.id);
  }

  function categorizePlaylistsForUser(lists) {
    const groups = { private: [], server: [], public: [] };
    lists.forEach((pl) => {
      if (isMinePlaylist(pl)) {
        groups.private.push(pl);
      } else if (groups[pl.visibility]) {
        groups[pl.visibility].push(pl);
      }
    });
    return groups;
  }

  // ---------- Toast (aviso rapido de confirmacao) ----------
  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // ---------- Configuração (localStorage) ----------
  const settings = {
    get apiUrl() {
      return localStorage.getItem('apiUrl') || window.location.origin;
    },
    set apiUrl(v) {
      localStorage.setItem('apiUrl', v);
    },
    get sessionToken() {
      return localStorage.getItem('sessionToken') || '';
    },
    set sessionToken(v) {
      if (v) localStorage.setItem('sessionToken', v);
      else localStorage.removeItem('sessionToken');
    },
    get currentGuildId() {
      return localStorage.getItem('currentGuildId') || '';
    },
    set currentGuildId(v) {
      localStorage.setItem('currentGuildId', v);
    },
  };

  // Captura o token de sessao que volta na URL depois do login com Discord
  // (?sessionToken=...) e limpa a URL.
  (() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('sessionToken');
    if (token) {
      settings.sessionToken = token;
      url.searchParams.delete('sessionToken');
      window.history.replaceState({}, '', url.toString());
    }
  })();

  let currentUser = null;

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (settings.sessionToken) headers['x-session-token'] = settings.sessionToken;

    const res = await fetch(`${settings.apiUrl}/api${path}`, { ...options, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Erro ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function requireGuild() {
    if (!currentUser) {
      alert('Entre com Discord primeiro (ícone de configurações ⚙).');
      return null;
    }
    if (!settings.currentGuildId) {
      alert('Escolha um servidor nas configurações (ícone ⚙) primeiro.');
      return null;
    }
    return settings.currentGuildId;
  }

  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatRemaining(elapsed, duration) {
    if (!duration) return '0:00';
    return `-${formatTime(Math.max(0, duration - elapsed))}`;
  }

  // ---------- Tabs ----------
  function goToTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => goToTab(btn.dataset.tab));
  });

  // Clicar na logo/nome "Vitrola" volta pra tela inicial (aba Buscar, limpa).
  function goHome() {
    document.querySelector('.tab-btn[data-tab="search"]').click();
    document.querySelectorAll('.js-search-input').forEach((el) => (el.value = ''));
    document.getElementById('search-results').innerHTML = '';
    setSearchIdle(true);
  }

  document.querySelectorAll('.js-home-trigger').forEach((el) => {
    el.addEventListener('click', goHome);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goHome();
      }
    });
  });

  // ---------- Conta / login com Discord ----------
  const accountLoggedOutEl = document.getElementById('account-logged-out');
  const accountLoggedInEl = document.getElementById('account-logged-in');
  const guildSelectEl = document.getElementById('guild-select');

  function goToDiscordLogin() {
    window.location.href = `${settings.apiUrl}/auth/discord/login`;
  }
  document.getElementById('discord-login-btn').addEventListener('click', goToDiscordLogin);
  document.getElementById('landing-login-btn').addEventListener('click', goToDiscordLogin);

  document.getElementById('discord-logout-btn').addEventListener('click', async () => {
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      // ignora erro de logout, limpa localmente de qualquer forma
    }
    settings.sessionToken = '';
    currentUser = null;
    setBrowserListen(false);
    refreshAccountUI();
    renderPlaylists();
  });

  guildSelectEl.addEventListener('change', () => {
    settings.currentGuildId = guildSelectEl.value;
    // Trocar de servidor sem desligar deixaria tocando o audio do servidor
    // ANTERIOR (cada stream e amarrado ao guildId de quando foi aberto) -
    // mais seguro desligar e a pessoa religar se quiser, no servidor novo.
    setBrowserListen(false);
    // A capsula do tempo e por servidor - se a aba ja estiver aberta,
    // recarrega pro servidor novo em vez de continuar mostrando a antiga.
    if (document.getElementById('tab-history').classList.contains('active')) {
      retroSelectedMonth = null;
      loadRetrospectiveMonths().then(loadRetrospective);
    }
  });

  document.getElementById('force-reset-btn').addEventListener('click', async () => {
    const guildId = requireGuild();
    if (!guildId) return;
    if (!confirm('Isso desconecta o bot da call e para a música nesse servidor. Continuar?')) return;
    try {
      await api('/reset', { method: 'POST', body: JSON.stringify({ guildId }) });
      showToast('Bot desconectado e player resetado');
      refreshStatus();
    } catch (err) {
      alert(`Erro ao resetar: ${err.message}`);
    }
  });

  async function refreshAccountUI() {
    if (!settings.sessionToken) {
      currentUser = null;
    } else {
      try {
        currentUser = await api('/me');
      } catch {
        settings.sessionToken = '';
        currentUser = null;
      }
    }

    document.getElementById('landing-page').classList.toggle('hidden', !!currentUser);
    accountLoggedOutEl.classList.toggle('hidden', !!currentUser);
    accountLoggedInEl.classList.toggle('hidden', !currentUser);

    // #landing-page nao e position:fixed - so cobre o primeiro "vh" da
    // pagina. No celular (sem o overflow:hidden de tela unica do PC) a
    // .bottom-bar (fixed) ficava aparecendo por cima da tela de login, dando
    // acesso a busca/generos/etc antes mesmo de entrar com Discord.
    document.querySelector('.app-shell').classList.toggle('hidden', !currentUser);
    document.querySelector('.bottom-bar').classList.toggle('hidden', !currentUser);

    document.querySelectorAll('.js-topbar-user-chip').forEach((el) => el.classList.toggle('hidden', !currentUser));
    if (currentUser) {
      document.querySelectorAll('.js-topbar-user-avatar').forEach((el) => (el.src = currentUser.avatar || ''));
      document.querySelectorAll('.js-topbar-user-name').forEach((el) => (el.textContent = currentUser.username));
    }

    if (currentUser) {
      document.getElementById('account-avatar').src = currentUser.avatar || '';
      document.getElementById('account-username').textContent = currentUser.username;

      try {
        const guilds = await api('/guilds');
        guildSelectEl.innerHTML = '';
        guilds.forEach((g) => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = g.name;
          guildSelectEl.appendChild(opt);
        });

        if (!guilds.some((g) => g.id === settings.currentGuildId) && guilds.length) {
          settings.currentGuildId = guilds[0].id;
        }
        guildSelectEl.value = settings.currentGuildId;
      } catch (err) {
        console.error('Erro ao carregar servidores:', err.message);
      }
    } else {
      guildSelectEl.innerHTML = '';
    }
  }

  // ---------- Configurações ----------
  const settingsModal = document.getElementById('settings-modal');
  function openSettingsModal() {
    refreshAccountUI();
    settingsModal.classList.remove('hidden');
  }
  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
  document.getElementById('settings-btn-desktop').addEventListener('click', openSettingsModal);
  function closeSettingsModal() {
    settingsModal.classList.add('hidden');
  }
  document.getElementById('settings-close-btn').addEventListener('click', closeSettingsModal);
  document.getElementById('settings-close-x-btn').addEventListener('click', closeSettingsModal);
  document.getElementById('settings-save-btn').addEventListener('click', closeSettingsModal);

  // ---------- Helpers de renderização de faixa ----------
  function trackRow(track, { onPlayNow, onAddQueue, onAddPlaylist, onRemove } = {}) {
    const li = document.createElement('li');
    li.className = 'track-item';

    const img = document.createElement('img');
    img.className = 'track-art';
    img.src = track.albumArt || '';
    img.alt = '';

    const meta = document.createElement('div');
    meta.className = 'track-meta';
    meta.innerHTML = `
      <div class="track-name">${escapeHtml(track.name)}</div>
      <div class="track-artist">${escapeHtml((track.artists || []).join(', '))}</div>
    `;

    const duration = document.createElement('span');
    duration.className = 'track-duration';
    duration.textContent = track.durationMs ? formatTime(track.durationMs / 1000) : '';

    const actions = document.createElement('div');
    actions.className = 'track-actions';

    if (onPlayNow) {
      const b = document.createElement('button');
      b.innerHTML = ICONS.play;
      b.title = 'Tocar a seguir';
      b.addEventListener('click', () => onPlayNow(track));
      actions.appendChild(b);
    }
    if (onAddQueue) {
      const b = document.createElement('button');
      b.innerHTML = ICONS.plus;
      b.title = 'Adicionar à fila';
      b.addEventListener('click', () => onAddQueue(track));
      actions.appendChild(b);
    }
    if (onAddPlaylist) {
      const b = document.createElement('button');
      b.innerHTML = ICONS.playlistAdd;
      b.title = 'Adicionar à playlist';
      b.addEventListener('click', () => onAddPlaylist(track));
      actions.appendChild(b);
    }
    if (onRemove) {
      const b = document.createElement('button');
      b.innerHTML = ICONS.remove;
      b.title = 'Remover';
      b.addEventListener('click', () => onRemove());
      actions.appendChild(b);
    }

    li.append(img, meta, duration, actions);
    return li;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  // escapeHtml() NAO escapa aspas (serializacao de texto normal nao precisa
  // disso) - por isso e inseguro pra montar atributo tipo src="${...}". Essa
  // aqui escapa tambem aspas simples/duplas, pra usar sempre que um valor
  // (principalmente URL vinda do backend) entrar dentro de um atributo HTML
  // montado via template string (ver F1 da auditoria de seguranca).
  function escapeAttr(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ---------- Acesso rápido (tela inicial da aba Buscar) ----------
  const quickAccessEl = document.getElementById('quick-access');
  const historySectionEl = document.getElementById('history-section');
  const historyGridEl = document.getElementById('history-grid');

  function goToPlaylist(id) {
    document.querySelector('.tab-btn[data-tab="playlists"]').click();
    openPlaylistDetail(id);
  }

  let isSearchIdle = true;

  function updateQuickAccessVisibility() {
    quickAccessEl.classList.toggle('hidden', !isSearchIdle);
  }

  // Placeholder de capa quando a faixa/playlist nao tem imagem: gradiente +
  // letra inicial, no mesmo estilo do template (cor escolhida por hash do
  // titulo, so pra nao repetir sempre a mesma).
  const PLACEHOLDER_GRADIENTS = [
    ['#7a8a5e', '#2c3320'],
    ['#c67139', '#3a2114'],
    ['#6d5a8a', '#241d33'],
    ['#3a5a7a', '#15202b'],
    ['#b0894a', '#332612'],
    ['#8a4a4a', '#301818'],
    ['#4a7a6a', '#152622'],
    ['#8a7a4a', '#2b2614'],
  ];

  function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function mediaArtHtml(title, art, className) {
    if (art) {
      return `<div class="${className}"><img src="${escapeAttr(art)}" alt="" /></div>`;
    }
    const [from, to] = PLACEHOLDER_GRADIENTS[hashStr(title || '?') % PLACEHOLDER_GRADIENTS.length];
    const letter = escapeHtml((title || '?').trim().charAt(0).toUpperCase() || '?');
    return `<div class="${className} ${className}--placeholder" style="background: linear-gradient(140deg, ${from}, ${to});"><span>${letter}</span></div>`;
  }

  async function renderHistoryGrid() {
    if (!currentUser) {
      historyGridEl.innerHTML = '';
      historySectionEl.classList.add('hidden');
      return;
    }
    try {
      const tracks = await api('/history');
      historyGridEl.innerHTML = '';
      tracks.forEach((track) => {
        const card = document.createElement('div');
        card.className = 'hscroll-card';
        card.innerHTML = `
          ${mediaArtHtml(track.name, track.albumArt, 'hscroll-art')}
          <div class="hscroll-text">
            <div class="hscroll-title">${escapeHtml(track.name)}</div>
            <div class="hscroll-subtitle">${escapeHtml((track.artists || []).join(', '))}</div>
          </div>
        `;
        card.addEventListener('click', () => enqueueTrack(track, false));
        historyGridEl.appendChild(card);
      });
      historySectionEl.classList.toggle('hidden', tracks.length === 0);
      document.getElementById('history-count-badge').textContent = tracks.length ? `${tracks.length} faixas` : '';
    } catch (err) {
      console.error('Erro ao carregar histórico:', err.message);
    }
  }

  function buildPlaylistCard(pl) {
    const card = document.createElement('div');
    card.className = 'hscroll-card';
    const art = pl.tracks[0]?.albumArt || '';
    card.innerHTML = `
      ${mediaArtHtml(pl.name, art, 'hscroll-art')}
      <div class="hscroll-text">
        <div class="hscroll-title">${escapeHtml(pl.name)}</div>
        <div class="hscroll-subtitle">${pl.tracks.length} faixa${pl.tracks.length === 1 ? '' : 's'}</div>
      </div>
    `;
    card.addEventListener('click', () => goToPlaylist(pl.id));
    return card;
  }

  function clearPlaylistQuickSections() {
    PLAYLIST_CATEGORIES.forEach(({ key }) => {
      document.getElementById(`playlists-quick-section-${key}`).classList.add('hidden');
      document.getElementById(`quick-access-grid-${key}`).innerHTML = '';
    });
  }

  // As duas funcoes abaixo recebem a lista ja buscada (ver renderPlaylists),
  // em vez de cada uma buscar a sua.
  function renderPlaylistsQuickGrid(lists) {
    const groups = categorizePlaylistsForUser(lists);
    PLAYLIST_CATEGORIES.forEach(({ key }) => {
      const gridEl = document.getElementById(`quick-access-grid-${key}`);
      const sectionEl = document.getElementById(`playlists-quick-section-${key}`);
      gridEl.innerHTML = '';
      const items = groups[key].slice(0, 8);
      items.forEach((pl) => gridEl.appendChild(buildPlaylistCard(pl)));
      sectionEl.classList.toggle('hidden', items.length === 0);
    });
  }

  function renderSidebarPlaylists(lists) {
    const list = document.getElementById('sidebar-playlists-list');
    const groups = categorizePlaylistsForUser(lists);
    list.innerHTML = '';
    PLAYLIST_CATEGORIES.forEach(({ key, label }) => {
      const items = groups[key];
      if (!items.length) return;
      const heading = document.createElement('div');
      heading.className = 'sidebar-section-label sidebar-playlist-category';
      heading.textContent = label;
      list.appendChild(heading);
      items.forEach((pl) => {
        const item = document.createElement('div');
        item.className = 'sidebar-playlist-item';
        const art = pl.tracks[0]?.albumArt || '';
        item.innerHTML = `
          ${mediaArtHtml(pl.name, art, 'sidebar-playlist-art')}
          <div class="sidebar-playlist-text">
            <div class="sidebar-playlist-name">${escapeHtml(pl.name)}</div>
            <div class="sidebar-playlist-count">${pl.tracks.length} faixas</div>
          </div>
        `;
        item.addEventListener('click', () => goToPlaylist(pl.id));
        list.appendChild(item);
      });
    });
  }

  // Generos genericos, so pra dar um ponto de partida na tela inicial - ao
  // clicar, preenche a busca com o genero e pesquisa normalmente.
  const GENRES = [
    { label: 'MPB', color: '#2f6a52' },
    { label: 'Hip-Hop', color: '#4e3c72' },
    { label: 'Funk', color: '#6f3340' },
    { label: 'Trap', color: '#33406e' },
    { label: 'Rock', color: '#6d2f2f' },
    { label: 'Sertanejo', color: '#6b5230' },
    { label: 'Pagode', color: '#2f5a6b' },
    { label: 'Eletrônica', color: '#553a6b' },
  ];

  function renderGenreGridInto(containerId) {
    const grid = document.getElementById(containerId);
    grid.innerHTML = '';
    GENRES.forEach((genre) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'tpl-genre-card';
      card.style.background = genre.color;
      card.innerHTML = `<span class="tpl-genre-dot"></span><span class="tpl-genre-label">${escapeHtml(genre.label)}</span>`;
      card.addEventListener('click', () => {
        goToTab('search');
        document.querySelectorAll('.js-search-input').forEach((el) => (el.value = genre.label));
        searchFor(genre.label);
      });
      grid.appendChild(card);
    });
  }

  function renderGenres() {
    renderGenreGridInto('genre-grid');
    renderGenreGridInto('genre-grid-full');
  }

  function setSearchIdle(isIdle) {
    isSearchIdle = isIdle;
    updateQuickAccessVisibility();
  }

  document.querySelectorAll('.js-search-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      document.querySelectorAll('.js-search-input').forEach((other) => {
        if (other !== e.target) other.value = e.target.value;
      });
      if (!e.target.value.trim()) {
        setSearchIdle(true);
        document.getElementById('search-results').innerHTML = '';
      }
    });
  });

  // ---------- Busca ----------
  async function searchFor(q) {
    setSearchIdle(false);
    const resultsEl = document.getElementById('search-results');
    resultsEl.innerHTML = '<li>Buscando...</li>';

    try {
      const tracks = await api(`/search?q=${encodeURIComponent(q)}`);
      resultsEl.innerHTML = '';
      if (!tracks.length) {
        resultsEl.innerHTML = '<li>Nenhum resultado encontrado.</li>';
        return;
      }
      tracks.forEach((track) => {
        resultsEl.appendChild(
          trackRow(track, {
            onPlayNow: (t) => enqueueTrack(t, true),
            onAddQueue: (t) => enqueueTrack(t, false),
            onAddPlaylist: (t) => openAddToPlaylistModal(t),
          })
        );
      });
    } catch (err) {
      resultsEl.innerHTML = `<li>Erro: ${escapeHtml(err.message)}</li>`;
    }
  }

  ['search-form', 'search-form-desktop'].forEach((formId) => {
    document.getElementById(formId).addEventListener('submit', (e) => {
      e.preventDefault();
      const q = e.target.querySelector('.js-search-input').value.trim();
      if (!q) return;
      goToTab('search');
      searchFor(q);
    });
  });

  async function enqueueTrack(track, playNext) {
    const guildId = requireGuild();
    if (!guildId) return;
    try {
      await api('/queue', { method: 'POST', body: JSON.stringify({ guildId, track, playNext }) });
      showToast(playNext ? `Tocando a seguir: ${track.name}` : `Adicionado à fila: ${track.name}`);
      refreshStatus();
    } catch (err) {
      alert(`Erro ao adicionar à fila: ${err.message}`);
    }
  }

  // ---------- Fila ----------
  // Linha de tabela reutilizada pela fila (aba Fila e previa na tela inicial)
  function buildQueueRow(track, index, { onRemove, onPlayNow, playNowTitle = 'Tocar agora' } = {}) {
    const row = document.createElement('div');
    row.className = 'tpl-track-row';
    const durationSec = track.durationMs ? track.durationMs / 1000 : null;
    const artistText = escapeHtml((track.artists || []).join(', '));
    const durationText = durationSec ? formatTime(durationSec) : '';
    const metaText = durationText ? `${artistText} · ${durationText}` : artistText;
    // Estrutura serve os dois layouts do template: no mobile so o bloco
    // "main" (arte+titulo+meta) aparece; no PC vira uma linha de tabela com
    // indice/artista/tempo em colunas proprias (CSS troca o que fica visivel).
    row.innerHTML = `
      <div class="tpl-track-index">${index + 1}</div>
      <div class="tpl-track-main">
        ${mediaArtHtml(track.name, track.albumArt, 'tpl-track-art')}
        <div class="tpl-track-main-text">
          <div class="tpl-track-title">${escapeHtml(track.name)}</div>
          <div class="tpl-track-meta-mobile">${metaText}</div>
        </div>
      </div>
      <div class="tpl-track-artist-cell">${artistText}</div>
      <div class="tpl-track-time-cell">${durationText}</div>
      <div class="tpl-track-actions"></div>
    `;
    const actions = row.lastElementChild;
    if (onPlayNow) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tpl-track-action-btn tpl-track-action-btn--play';
      btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor"/></svg>';
      btn.title = playNowTitle;
      btn.addEventListener('click', () => onPlayNow());
      actions.appendChild(btn);
    }
    if (onRemove) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tpl-track-action-btn';
      btn.innerHTML = ICONS.remove;
      btn.title = 'Remover';
      btn.addEventListener('click', () => onRemove());
      actions.appendChild(btn);
    }
    return row;
  }

  // A aba Fila lista TODAS as faixas (e permite reordenar por indice), entao
  // e o unico lugar que sempre precisa de fullQueue=1.
  async function renderQueue(status) {
    try {
      if (!status) {
        const guildId = settings.currentGuildId;
        if (!guildId) return;
        status = await api(`/status?guildId=${encodeURIComponent(guildId)}&fullQueue=1`);
        applyStatus(status);
      }

      const total = status.queueLength ?? status.queue.length;
      document.getElementById('queue-count-badge').textContent = total ? `${total} faixas` : '';

      const tbody = document.getElementById('queue-tbody');
      tbody.innerHTML = '';
      status.queue.forEach((track, index) => {
        const row = buildQueueRow(track, index, { onRemove: () => removeFromQueue(index), onPlayNow: () => playQueueItemNow(index) });
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', String(index));
        });
        row.addEventListener('dragover', (e) => e.preventDefault());
        row.addEventListener('drop', async (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer.getData('text/plain'));
          if (from === index) return;
          const guildId = requireGuild();
          if (!guildId) return;
          try {
            await api('/queue/reorder', { method: 'POST', body: JSON.stringify({ guildId, from, to: index }) });
            renderQueue();
          } catch (err) {
            alert(`Erro ao reordenar: ${err.message}`);
          }
        });
        tbody.appendChild(row);
      });
    } catch (err) {
      console.error('Erro ao carregar fila:', err.message);
    }
  }

  async function removeFromQueue(index) {
    const guildId = requireGuild();
    if (!guildId) return;
    try {
      await api(`/queue/${index}?guildId=${encodeURIComponent(guildId)}`, { method: 'DELETE' });
      renderQueue();
    } catch (err) {
      alert(`Erro ao remover: ${err.message}`);
    }
  }

  // Traz uma faixa da fila pra frente e pula pra ela (reusa o /skip, que ja
  // tem a regra de permissao: so quem adicionou ou um admin pode pular).
  async function playQueueItemNow(index) {
    const guildId = requireGuild();
    if (!guildId) return;
    try {
      if (index !== 0) {
        await api('/queue/reorder', { method: 'POST', body: JSON.stringify({ guildId, from: index, to: 0 }) });
      }
      await api('/skip', { method: 'POST', body: JSON.stringify({ guildId }) });
      refreshStatus();
    } catch (err) {
      alert(`Erro ao tocar: ${err.message}`);
    }
  }

  // ---------- Playlists ----------
  const playlistsRoot = document.getElementById('playlists-root');
  const playlistDetail = document.getElementById('playlist-detail');
  const playlistCreateScreen = document.getElementById('playlist-create');

  function resetCreatePlaylistForm() {
    document.getElementById('new-playlist-name').value = '';
    document.querySelectorAll('#new-playlist-visibility-group .pl-visibility-btn').forEach((b) => b.classList.remove('active'));
    const defaultBtn = document.querySelector('#new-playlist-visibility-group .pl-visibility-btn[data-value="private"]');
    defaultBtn.classList.add('active');
    document.getElementById('new-playlist-visibility').value = 'private';
    document.getElementById('new-playlist-hint').textContent = NEW_PLAYLIST_VISIBILITY_HINT.private;
    document.getElementById('create-playlist-visibility-label').textContent = 'Playlist privada';
  }

  function openCreatePlaylistScreen() {
    if (!currentUser) {
      alert('Entre com Discord primeiro (ícone de configurações ⚙).');
      return;
    }
    resetCreatePlaylistForm();
    playlistsRoot.classList.add('hidden');
    playlistCreateScreen.classList.remove('hidden');
    document.getElementById('new-playlist-name').focus();
  }

  function closeCreatePlaylistScreen() {
    playlistCreateScreen.classList.add('hidden');
    playlistsRoot.classList.remove('hidden');
  }

  document.getElementById('open-create-playlist-btn').addEventListener('click', openCreatePlaylistScreen);
  document.getElementById('playlist-create-back-btn').addEventListener('click', closeCreatePlaylistScreen);

  const NEW_PLAYLIST_VISIBILITY_HINT = {
    private: 'Só você pode ver.',
    server: 'Quem está no seu servidor pode ver.',
    public: 'Qualquer pessoa com o link pode ver.',
  };
  const NEW_PLAYLIST_VISIBILITY_HERO_LABEL = {
    private: 'Playlist privada',
    server: 'Playlist do servidor',
    public: 'Playlist pública',
  };
  document.querySelectorAll('#new-playlist-visibility-group .pl-visibility-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#new-playlist-visibility-group .pl-visibility-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('new-playlist-visibility').value = btn.dataset.value;
      document.getElementById('new-playlist-hint').textContent = NEW_PLAYLIST_VISIBILITY_HINT[btn.dataset.value];
      document.getElementById('create-playlist-visibility-label').textContent = NEW_PLAYLIST_VISIBILITY_HERO_LABEL[btn.dataset.value];
    });
  });

  let playlistVisibilityFilter = 'all';
  let lastFetchedPlaylists = null;
  document.querySelectorAll('#playlists-filter-group .pl-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#playlists-filter-group .pl-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      playlistVisibilityFilter = btn.dataset.filter;
      if (lastFetchedPlaylists) renderPlaylistSections(lastFetchedPlaylists);
    });
  });

  document.getElementById('new-playlist-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('new-playlist-name');
    const visibilitySelect = document.getElementById('new-playlist-visibility');
    const name = input.value.trim();
    if (!name) return;

    if (!currentUser) {
      alert('Entre com Discord primeiro (ícone de configurações ⚙).');
      return;
    }
    const visibility = visibilitySelect.value;
    const guildId = visibility === 'private' ? undefined : requireGuild();
    if (visibility !== 'private' && !guildId) return;

    try {
      const playlist = await api('/playlists', { method: 'POST', body: JSON.stringify({ name, visibility, guildId }) });
      playlistCreateScreen.classList.add('hidden');
      showToast(`Playlist "${playlist.name}" criada`);
      openPlaylistDetail(playlist.id);
    } catch (err) {
      alert(`Erro ao criar playlist: ${err.message}`);
    }
  });

  // ---------- Importar playlist (Spotify ou YouTube/YouTube Music) ----------
  const importPlaylistModal = document.getElementById('import-playlist-modal');
  const IMPORT_PLATFORM_LABELS = {
    spotify: { title: 'Importar do Spotify', placeholder: 'https://open.spotify.com/playlist/...' },
    youtube: { title: 'Importar do YouTube Music', placeholder: 'https://music.youtube.com/playlist?list=...' },
  };
  let importPlatform = 'spotify';

  ['import-spotify-btn', 'import-youtube-btn'].forEach((btnId) => {
    document.getElementById(btnId).addEventListener('click', (e) => {
      if (!currentUser) {
        alert('Entre com Discord primeiro (ícone de configurações ⚙).');
        return;
      }
      importPlatform = e.currentTarget.dataset.platform;
      const labels = IMPORT_PLATFORM_LABELS[importPlatform];
      document.getElementById('import-playlist-title').textContent = labels.title;
      document.getElementById('import-playlist-url').placeholder = labels.placeholder;
      document.getElementById('import-playlist-url').value = '';
      importPlaylistModal.classList.remove('hidden');
    });
  });

  document.getElementById('import-playlist-close-btn').addEventListener('click', () => {
    importPlaylistModal.classList.add('hidden');
  });

  document.getElementById('import-playlist-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('import-playlist-url').value.trim();
    if (!url) return;

    const visibility = document.getElementById('import-playlist-visibility').value;
    const guildId = visibility === 'private' ? undefined : requireGuild();
    if (visibility !== 'private' && !guildId) return;

    const submitBtn = document.getElementById('import-playlist-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Importando...';
    try {
      const playlist = await api(`/playlists/import-${importPlatform}`, {
        method: 'POST',
        body: JSON.stringify({ url, visibility, guildId }),
      });
      importPlaylistModal.classList.add('hidden');
      playlistCreateScreen.classList.add('hidden');
      showToast(`Playlist "${playlist.name}" importada (${playlist.tracks.length} faixas)`);
      openPlaylistDetail(playlist.id);
    } catch (err) {
      alert(`Erro ao importar playlist: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Importar';
    }
  });

  async function playPlaylist(pl) {
    const guildId = requireGuild();
    if (!guildId) return;
    try {
      await api(`/playlists/${pl.id}/play`, { method: 'POST', body: JSON.stringify({ guildId }) });
      refreshStatus();
    } catch (err) {
      alert(`Erro ao tocar playlist: ${err.message}`);
    }
  }

  function buildPlaylistGridCard(pl) {
    const card = document.createElement('div');
    card.className = 'pl-card';
    const isOwner = pl.ownerId === currentUser.id;
    const isFavorited = (pl.favoritedBy || []).includes(currentUser.id);
    const ownerNote = !isOwner ? ` · de ${escapeHtml(pl.ownerName)}` : '';
    const badgeIcon = ICONS[VISIBILITY_BADGE_ICON[pl.visibility]] || '';
    card.innerHTML = `
      ${mediaArtHtml(pl.name, pl.tracks[0]?.albumArt || '', 'pl-card-art')}
      <div class="pl-card-body">
        <div class="pl-card-name">${escapeHtml(pl.name)}</div>
        <div class="pl-card-meta">
          <span>${pl.tracks.length} música${pl.tracks.length === 1 ? '' : 's'}${ownerNote}</span>
          <span class="pl-badge pl-badge--${pl.visibility}">${badgeIcon}${VISIBILITY_BADGE_LABEL[pl.visibility] || ''}</span>
        </div>
      </div>
      <div class="pl-card-actions"></div>
    `;
    const actions = card.querySelector('.pl-card-actions');

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'pl-card-play-btn';
    playBtn.title = 'Tocar';
    playBtn.innerHTML = ICONS.play;
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playPlaylist(pl);
    });
    actions.appendChild(playBtn);

    if (!isOwner) {
      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = `playlist-favorite-btn${isFavorited ? ' active' : ''}`;
      favBtn.title = isFavorited ? 'Remover dos favoritos' : 'Favoritar';
      favBtn.innerHTML = isFavorited ? ICONS.heartFilled : ICONS.heartOutline;
      favBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api(`/playlists/${pl.id}/favorite`, { method: isFavorited ? 'DELETE' : 'POST' });
          showToast(isFavorited ? 'Removida dos favoritos' : 'Adicionada às suas playlists');
          renderPlaylists();
        } catch (err) {
          alert(`Erro ao favoritar: ${err.message}`);
        }
      });
      actions.appendChild(favBtn);
    } else {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'playlist-favorite-btn';
      removeBtn.title = 'Apagar playlist';
      removeBtn.innerHTML = ICONS.trash;
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Apagar a playlist "${pl.name}"? Essa ação não pode ser desfeita.`)) return;
        try {
          await api(`/playlists/${pl.id}`, { method: 'DELETE' });
          showToast('Playlist apagada');
          renderPlaylists();
        } catch (err) {
          alert(`Erro ao apagar playlist: ${err.message}`);
        }
      });
      actions.appendChild(removeBtn);
    }
    card.addEventListener('click', () => openPlaylistDetail(pl.id));
    return card;
  }

  function renderPlaylistSections(playlists) {
    const list = document.getElementById('playlists-list');
    list.innerHTML = '';
    const totalTracks = playlists.reduce((sum, pl) => sum + pl.tracks.length, 0);
    document.getElementById('playlists-page-subtitle').textContent =
      `${playlists.length} playlist${playlists.length === 1 ? '' : 's'} · ${totalTracks} faixa${totalTracks === 1 ? '' : 's'} no total`;
    if (!playlists.length) {
      list.innerHTML = '<p class="playlist-empty-note">Nenhuma playlist ainda.</p>';
      return;
    }
    const groups = categorizePlaylistsForUser(playlists);
    let anyRendered = false;
    PLAYLIST_CATEGORIES.forEach(({ key, label }) => {
      const items = groups[key].filter(
        (pl) => playlistVisibilityFilter === 'all' || pl.visibility === playlistVisibilityFilter
      );
      if (!items.length) return;
      anyRendered = true;
      const section = document.createElement('div');
      section.className = 'playlist-category';
      section.innerHTML = `
        <div class="playlist-category-header">
          <h2 class="playlist-category-heading">${label}</h2>
          <span class="playlist-category-count">${items.length}</span>
        </div>
      `;
      const grid = document.createElement('div');
      grid.className = 'playlist-grid';
      items.forEach((pl) => grid.appendChild(buildPlaylistGridCard(pl)));
      section.appendChild(grid);
      list.appendChild(section);
    });
    if (!anyRendered) {
      list.innerHTML = '<p class="playlist-empty-note">Nenhuma playlist com esse filtro.</p>';
    }
  }

  // Ponto UNICO onde as playlists sao buscadas do servidor. As tres visoes
  // que mostram playlist (grade da tela inicial, sidebar e a aba Playlists)
  // recebem a mesma lista por parametro - antes cada uma fazia a propria
  // chamada, entao toda vez que algo mudava (criar/favoritar/apagar) o
  // mesmo GET /playlists ia 3x seguidas, e cada resposta traz TODAS as
  // playlists com TODAS as faixas (>100 KB de JSON).
  async function renderPlaylists() {
    const list = document.getElementById('playlists-list');

    if (!currentUser) {
      document.getElementById('playlists-page-subtitle').textContent = '';
      list.innerHTML = '<p class="playlist-empty-note">Entre com Discord (ícone ⚙) para ver suas playlists.</p>';
      clearPlaylistQuickSections();
      document.getElementById('sidebar-playlists-list').innerHTML = '';
      renderHistoryGrid();
      return;
    }

    renderHistoryGrid();

    let playlists;
    try {
      playlists = await api('/playlists');
    } catch (err) {
      console.error('Erro ao carregar playlists:', err.message);
      return;
    }

    lastFetchedPlaylists = playlists;
    renderPlaylistsQuickGrid(playlists);
    renderSidebarPlaylists(playlists);
    renderPlaylistSections(playlists);
  }

  const PLAYLIST_VISIBILITY_LABELS = {
    private: 'Playlist privada',
    server: 'Playlist do servidor',
    public: 'Playlist pública',
  };

  async function openPlaylistDetail(id) {
    const pl = await api(`/playlists/${id}`);
    playlistsRoot.classList.add('hidden');
    playlistDetail.classList.remove('hidden');

    document.getElementById('playlist-detail-visibility').textContent = PLAYLIST_VISIBILITY_LABELS[pl.visibility] || '';
    document.getElementById('playlist-detail-name').textContent = pl.name;

    const totalMinutes = Math.round(pl.tracks.reduce((sum, t) => sum + (t.durationMs || 0), 0) / 60000);
    document.getElementById('playlist-detail-meta').textContent = [
      pl.ownerName,
      `${pl.tracks.length} música${pl.tracks.length === 1 ? '' : 's'}`,
      totalMinutes ? `${totalMinutes} min` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    // Capa: colagem 2x2 das primeiras faixas com capa (como o Spotify monta
    // pra playlist sem imagem propria), ou um placeholder se nao tiver nenhuma.
    const coverEl = document.getElementById('playlist-hero-cover');
    const artUrls = pl.tracks.map((t) => t.albumArt).filter(Boolean).slice(0, 4);
    if (artUrls.length >= 4) {
      coverEl.innerHTML = `<div class="pl-hero-cover-grid">${artUrls.map((url) => `<img src="${escapeAttr(url)}" alt="" />`).join('')}</div>`;
    } else if (artUrls.length > 0) {
      coverEl.innerHTML = `<img src="${escapeAttr(artUrls[0])}" alt="" />`;
    } else {
      const [fromColor, toColor] = PLACEHOLDER_GRADIENTS[hashStr(pl.name) % PLACEHOLDER_GRADIENTS.length];
      const letter = escapeHtml((pl.name || '?').trim().charAt(0).toUpperCase() || '?');
      coverEl.innerHTML = `<div class="pl-hero-cover-placeholder" style="background: linear-gradient(140deg, ${fromColor}, ${toColor});"><span>${letter}</span></div>`;
    }

    // Fundo do cabecalho: gradiente derivado do nome (mesma tecnica dos
    // placeholders de capa), pra cada playlist ter uma cor propria.
    const [gradFrom, gradTo] = PLACEHOLDER_GRADIENTS[hashStr(pl.name) % PLACEHOLDER_GRADIENTS.length];
    document.getElementById('playlist-hero-bg').style.background = `linear-gradient(160deg, ${gradFrom}, ${gradTo} 65%, var(--bg-panel) 100%)`;

    const canEdit = currentUser && pl.ownerId === currentUser.id;

    const tracksList = document.getElementById('playlist-detail-tracks');
    tracksList.innerHTML = '';
    pl.tracks.forEach((track, index) => {
      tracksList.appendChild(
        buildQueueRow(track, index, {
          onPlayNow: () => enqueueTrack(track, false),
          playNowTitle: 'Adicionar à fila',
          onRemove: canEdit
            ? async () => {
                await api(`/playlists/${id}/tracks/${index}`, { method: 'DELETE' });
                openPlaylistDetail(id);
              }
            : undefined,
        })
      );
    });

    document.getElementById('playlist-play-all-btn').onclick = () => playPlaylist(pl);

    const favBtn = document.getElementById('playlist-detail-favorite-btn');
    favBtn.classList.toggle('hidden', canEdit);
    if (!canEdit) {
      const isFavorited = (pl.favoritedBy || []).includes(currentUser?.id);
      favBtn.innerHTML = isFavorited ? ICONS.heartFilled : ICONS.heartOutline;
      favBtn.title = isFavorited ? 'Remover dos favoritos' : 'Favoritar';
      favBtn.classList.toggle('active', isFavorited);
      favBtn.onclick = async () => {
        try {
          await api(`/playlists/${id}/favorite`, { method: isFavorited ? 'DELETE' : 'POST' });
          showToast(isFavorited ? 'Removida dos favoritos' : 'Adicionada às suas playlists');
          openPlaylistDetail(id);
        } catch (err) {
          alert(`Erro ao favoritar: ${err.message}`);
        }
      };
    }

    const deleteBtn = document.getElementById('playlist-detail-delete-btn');
    deleteBtn.classList.toggle('hidden', !canEdit);
    if (canEdit) {
      deleteBtn.innerHTML = ICONS.remove;
      deleteBtn.onclick = async () => {
        if (!confirm(`Apagar a playlist "${pl.name}"? Essa ação não pode ser desfeita.`)) return;
        try {
          await api(`/playlists/${id}`, { method: 'DELETE' });
          showToast('Playlist apagada');
          document.getElementById('playlist-back-btn').click();
        } catch (err) {
          alert(`Erro ao apagar playlist: ${err.message}`);
        }
      };
    }
  }

  document.getElementById('playlist-back-btn').addEventListener('click', () => {
    playlistDetail.classList.add('hidden');
    playlistsRoot.classList.remove('hidden');
    renderPlaylists();
  });

  // ---------- Modal: adicionar a playlist ----------
  const addToPlaylistModal = document.getElementById('add-to-playlist-modal');
  document.getElementById('modal-close-btn').addEventListener('click', () => {
    addToPlaylistModal.classList.add('hidden');
  });

  async function openAddToPlaylistModal(track) {
    if (!currentUser) {
      alert('Entre com Discord primeiro (ícone de configurações ⚙).');
      return;
    }
    const optionsList = document.getElementById('modal-playlist-options');
    optionsList.innerHTML = '<li>Carregando...</li>';
    addToPlaylistModal.classList.remove('hidden');

    const playlists = (await api('/playlists')).filter((pl) => pl.ownerId === currentUser.id);
    optionsList.innerHTML = '';
    if (!playlists.length) {
      optionsList.innerHTML = '<li>Você ainda não tem playlists suas.</li>';
      return;
    }
    playlists.forEach((pl) => {
      const li = document.createElement('li');
      li.className = 'playlist-item';
      li.style.cursor = 'pointer';
      li.textContent = pl.name;
      li.addEventListener('click', async () => {
        await api(`/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify({ track }) });
        showToast(`Adicionado à playlist "${pl.name}"`);
        addToPlaylistModal.classList.add('hidden');
      });
      optionsList.appendChild(li);
    });
  }

  // ---------- Barra do player ----------
  // O template tem duas barras bem diferentes (mini-bar de 3 botoes no
  // celular, barra completa com shuffle/anterior/repeat/volume no PC) -
  // em vez de tentar unificar tudo numa marcacao so, cada uma tem seu proprio
  // HTML e as duas sao sincronizadas via classes .js-* compartilhadas.
  const playPauseBtns = () => document.querySelectorAll('.js-playpause');
  const skipBtns = () => document.querySelectorAll('.js-skip');
  const progressEls = () => document.querySelectorAll('.js-progress');
  const volumeEls = () => document.querySelectorAll('.js-volume');
  const artEls = () => document.querySelectorAll('.js-art');
  const artBgEls = () => document.querySelectorAll('.js-art-bg');
  const nameEls = () => document.querySelectorAll('.js-track-name');
  const artistEls = () => document.querySelectorAll('.js-track-artist');

  // Inputs "range" nativos nao tem preenchimento colorido nativo entre 0 e o
  // valor atual - pintamos via gradiente de fundo (barra do PC/volume) ou via
  // variavel CSS lida pelo pseudo-elemento da trilha (linha fina do celular).
  function paintRange(input, color) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.background = `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, var(--border-soft) ${pct}%, var(--border-soft) 100%)`;
  }

  function paintProgress(input) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.background = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border-soft) ${pct}%, var(--border-soft) 100%)`;
  }

  let isDraggingProgress = false;
  let isPausedLocally = true;
  let currentPlayingTrack = null;

  function setPlayPauseIcon(paused) {
    playPauseBtns().forEach((btn) => {
      btn.querySelector('.icon-play').style.display = paused ? '' : 'none';
      btn.querySelector('.icon-pause').style.display = paused ? 'none' : '';
    });
  }

  playPauseBtns().forEach((btn) => {
    btn.addEventListener('click', async () => {
      const guildId = requireGuild();
      if (!guildId) return;
      if (isPausedLocally) {
        await api('/resume', { method: 'POST', body: JSON.stringify({ guildId }) });
      } else {
        await api('/pause', { method: 'POST', body: JSON.stringify({ guildId }) });
      }
      refreshStatus();
    });
  });

  skipBtns().forEach((btn) => {
    btn.addEventListener('click', async () => {
      const guildId = requireGuild();
      if (!guildId) return;
      try {
        await api('/skip', { method: 'POST', body: JSON.stringify({ guildId }) });
        refreshStatus();
      } catch (err) {
        alert(`Erro ao pular: ${err.message}`);
      }
    });
  });

  // Pointer Events unificam mouse/touch/caneta e disparam de forma confiavel
  // no mobile. Usar apenas "change" (como antes) podia travar a barra: se o
  // usuario tocasse sem realmente mover o valor, o "change" as vezes nao
  // disparava e a barra ficava presa em modo "arrastando" para sempre.
  progressEls().forEach((progressEl) => {
    progressEl.addEventListener('pointerdown', () => {
      isDraggingProgress = true;
    });

    progressEl.addEventListener('input', () => {
      paintProgress(progressEl);
    });

    progressEl.addEventListener('pointerup', async () => {
      const seconds = Number(progressEl.value);
      isDraggingProgress = false;
      const guildId = requireGuild();
      if (!guildId) return;
      await api('/seek', { method: 'POST', body: JSON.stringify({ guildId, seconds }) });
      refreshStatus();
    });
  });

  volumeEls().forEach((volumeEl) => {
    volumeEl.addEventListener('input', async () => {
      paintRange(volumeEl, 'var(--text-bright)');
      document.querySelectorAll('.js-volume-pct').forEach((el) => {
        el.textContent = `${Math.round(Number(volumeEl.value) * 100)}%`;
      });
      volumeEls().forEach((other) => {
        if (other !== volumeEl) other.value = volumeEl.value;
      });
      const guildId = settings.currentGuildId;
      if (!guildId) return;
      await api('/volume', { method: 'POST', body: JSON.stringify({ guildId, volume: Number(volumeEl.value) }) });
    });
  });

  // Botao de volume da mini-barra do celular - abre uma barra vertical (ao
  // lado do botao de autoplay) que some sozinha depois de 4s sem uso, ou na
  // hora se o usuario clicar no botao de novo.
  const volumeBtnEl = document.getElementById('bottom-bar-volume-btn');
  const volumePopoverEl = document.getElementById('bottom-bar-volume-popover');
  let volumeHideTimer = null;

  function setVolumeBtnIcon(muted) {
    volumeBtnEl.querySelector('.icon-vol-on').style.display = muted ? 'none' : '';
    volumeBtnEl.querySelector('.icon-vol-off').style.display = muted ? '' : 'none';
  }

  function scheduleVolumePopoverHide() {
    clearTimeout(volumeHideTimer);
    volumeHideTimer = setTimeout(() => volumePopoverEl.classList.add('hidden'), 4000);
  }

  volumeBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (volumePopoverEl.classList.contains('hidden')) {
      volumePopoverEl.classList.remove('hidden');
      scheduleVolumePopoverHide();
    } else {
      volumePopoverEl.classList.add('hidden');
      clearTimeout(volumeHideTimer);
    }
  });

  volumePopoverEl.addEventListener('click', (e) => e.stopPropagation());
  const bottomBarVolumeRangeEl = volumePopoverEl.querySelector('.js-volume');
  bottomBarVolumeRangeEl.addEventListener('pointerdown', () => clearTimeout(volumeHideTimer));
  bottomBarVolumeRangeEl.addEventListener('input', () => setVolumeBtnIcon(Number(bottomBarVolumeRangeEl.value) === 0));
  bottomBarVolumeRangeEl.addEventListener('pointerup', scheduleVolumePopoverHide);

  document.addEventListener('click', (e) => {
    if (volumePopoverEl.classList.contains('hidden')) return;
    if (volumePopoverEl.contains(e.target) || volumeBtnEl.contains(e.target)) return;
    volumePopoverEl.classList.add('hidden');
    clearTimeout(volumeHideTimer);
  });

  const autoplayToggleEls = () => document.querySelectorAll('.js-autoplay-toggle');
  const repeatBtnEls = () => document.querySelectorAll('.js-repeat-btn');

  async function setAutoplay(enabled) {
    const guildId = requireGuild();
    if (!guildId) return;
    await api('/autoplay', { method: 'POST', body: JSON.stringify({ guildId, enabled }) });
  }

  autoplayToggleEls().forEach((el) => {
    el.addEventListener('change', () => setAutoplay(el.checked));
  });
  repeatBtnEls().forEach((btn) => {
    btn.addEventListener('click', () => setAutoplay(!btn.classList.contains('active')));
  });

  // ---------- Ouvir pelo navegador (sem precisar entrar no canal de voz) ----------
  // Um <audio> proprio, independente do Discord: pede um ticket de curta
  // duracao (o /listen nao aceita o x-session-token normal, porque e o
  // "src" de uma tag <audio> - o navegador nao manda headers customizados
  // nesse tipo de requisicao) e aponta o audio pra ele.
  const browserListenAudioEl = document.getElementById('browser-listen-audio');
  const browserListenToggleEl = document.getElementById('browser-listen-toggle');
  let browserListenEnabled = false;
  // Id da faixa que o stream atual esta tocando - usado so pra perceber
  // quando a musica trocou e reconectar (o stream em si nao "avisa" troca
  // de faixa sozinho, cada ouvinte e um processo ffmpeg isolado por faixa).
  let browserListenTrackId = null;

  async function startBrowserListenStream() {
    const guildId = settings.currentGuildId;
    if (!guildId) return;
    try {
      const { ticket } = await api('/listen/ticket', { method: 'POST' });
      browserListenAudioEl.src = `${settings.apiUrl}/api/listen?guildId=${encodeURIComponent(guildId)}&ticket=${encodeURIComponent(ticket)}`;
      await browserListenAudioEl.play();
    } catch (err) {
      console.error('Erro ao iniciar audio pelo navegador:', err.message);
    }
  }

  function stopBrowserListenStream() {
    browserListenAudioEl.pause();
    browserListenAudioEl.removeAttribute('src');
    browserListenAudioEl.load();
    browserListenTrackId = null;
  }

  async function setBrowserListen(enabled) {
    browserListenEnabled = enabled;
    browserListenToggleEl.checked = enabled;
    if (enabled) {
      browserListenTrackId = currentPlayingTrack?.id ?? null;
      await startBrowserListenStream();
    } else {
      stopBrowserListenStream();
    }
  }

  browserListenToggleEl.addEventListener('change', () => setBrowserListen(browserListenToggleEl.checked));

  // Chamado a cada applyStatus(): se a faixa tocando agora mudou desde a
  // ultima vez que o stream do navegador comecou, reconecta pra ficar em
  // sincronia com o que esta no Discord.
  function syncBrowserListenWithCurrentTrack() {
    if (!browserListenEnabled) return;
    const newId = currentPlayingTrack?.id ?? null;
    if (newId === browserListenTrackId) return;
    browserListenTrackId = newId;
    if (newId) {
      startBrowserListenStream();
    } else {
      stopBrowserListenStream();
    }
  }

  // Se o stream cair sozinho (erro de rede, ou a faixa realmente terminou
  // antes do proximo poll de status perceber a troca), tenta reconectar
  // automaticamente enquanto o modo continuar ligado.
  browserListenAudioEl.addEventListener('ended', () => {
    if (browserListenEnabled) startBrowserListenStream();
  });
  browserListenAudioEl.addEventListener('error', () => {
    if (browserListenEnabled && browserListenAudioEl.src) startBrowserListenStream();
  });

  document.getElementById('player-like-btn').addEventListener('click', () => {
    if (!currentPlayingTrack) {
      alert('Nada tocando agora.');
      return;
    }
    openAddToPlaylistModal(currentPlayingTrack);
  });

  // Estado usado para animar a barra de progresso de forma suave entre uma
  // atualizacao de status e outra (o polling so acontece 1x por segundo,
  // o que sozinho deixaria a barra "pulando" em vez de correr continuamente).
  let localElapsedBase = 0;
  let localSyncedAt = 0;
  let localDuration = 0;
  let localIsPlaying = false;

  function applyStatus(status) {
    if (status.current) {
      const t = status.current.track;
      currentPlayingTrack = t;
      nameEls().forEach((el) => (el.textContent = t.name));
      artistEls().forEach((el) => (el.textContent = (t.artists || []).join(', ')));
      artEls().forEach((el) => {
        if (t.albumArt) {
          el.src = t.albumArt;
          el.style.display = '';
        } else {
          el.removeAttribute('src');
          el.style.display = 'none';
        }
      });
      artBgEls().forEach((el) => {
        el.style.backgroundImage = t.albumArt ? `url("${t.albumArt}")` : 'none';
      });
      isPausedLocally = status.current.paused;
      setPlayPauseIcon(isPausedLocally);

      const duration = status.current.durationSeconds || 0;
      localElapsedBase = status.current.elapsedSeconds || 0;
      localSyncedAt = Date.now();
      localDuration = duration;
      localIsPlaying = !isPausedLocally;

      if (!isDraggingProgress) {
        progressEls().forEach((el) => {
          el.disabled = false;
          el.max = duration || 0;
          el.value = localElapsedBase;
          paintProgress(el);
        });
      }
      document.querySelectorAll('.js-elapsed').forEach((el) => (el.textContent = formatTime(localElapsedBase)));
      document.querySelectorAll('.js-duration').forEach((el) => (el.textContent = formatTime(duration)));
      document.querySelectorAll('.js-remaining').forEach((el) => (el.textContent = formatRemaining(localElapsedBase, duration)));
      document.getElementById('now-playing-block').classList.remove('hidden');
      document.getElementById('now-playing-time-text').textContent = `${formatTime(localElapsedBase)} / ${formatTime(duration)}`;
    } else {
      currentPlayingTrack = null;
      nameEls().forEach((el) => (el.textContent = 'Nada tocando'));
      artistEls().forEach((el) => (el.textContent = ''));
      artEls().forEach((el) => {
        el.removeAttribute('src');
        el.style.display = 'none';
      });
      artBgEls().forEach((el) => {
        el.style.backgroundImage = 'none';
      });
      setPlayPauseIcon(true);
      if (!isDraggingProgress) {
        progressEls().forEach((el) => {
          el.disabled = true;
          el.max = 0;
          el.value = 0;
          paintProgress(el);
        });
      }
      document.querySelectorAll('.js-elapsed').forEach((el) => (el.textContent = '0:00'));
      document.querySelectorAll('.js-duration').forEach((el) => (el.textContent = '0:00'));
      document.querySelectorAll('.js-remaining').forEach((el) => (el.textContent = '0:00'));
      document.getElementById('now-playing-block').classList.add('hidden');
      isPausedLocally = true;
      localIsPlaying = false;
      localDuration = 0;
    }

    volumeEls().forEach((el) => {
      el.value = status.volume;
      paintRange(el, 'var(--text-bright)');
    });
    document.querySelectorAll('.js-volume-pct').forEach((el) => {
      el.textContent = `${Math.round(status.volume * 100)}%`;
    });
    setVolumeBtnIcon(status.volume === 0);
    autoplayToggleEls().forEach((el) => {
      if (document.activeElement !== el) el.checked = status.autoplay;
    });
    repeatBtnEls().forEach((el) => el.classList.toggle('active', status.autoplay));

    // status.queue pode vir cortado (ver getStatus no backend) - por isso os
    // contadores usam status.queueLength, nunca status.queue.length.
    renderHomeQueuePreview(status.queue, status.queueLength);
    renderNextUp(status.current ? status.queue[0] : null, status.queue, status.queueLength);

    syncBrowserListenWithCurrentTrack();
  }

  // ---------- Prévia da próxima faixa, acima da barra do player (PC e mobile) ----------
  // Clicar nela expande e mostra o resto da fila (ver wiring mais abaixo).
  let lastQueueSnapshot = [];

  function buildNextUpExpandRow(track) {
    const row = document.createElement('div');
    row.className = 'next-up-expand-row';
    row.innerHTML = `
      ${mediaArtHtml(track.name, track.albumArt, 'next-up-expand-art')}
      <div class="next-up-expand-text">
        <span class="next-up-expand-name">${escapeHtml(track.name)}</span>
        <span class="next-up-expand-artist">${escapeHtml((track.artists || []).join(', '))}</span>
      </div>
    `;
    return row;
  }

  function populateExpandPanel(panel, tracks) {
    const rest = (tracks || lastQueueSnapshot).slice(1);
    panel.innerHTML = '';
    if (!rest.length) {
      panel.innerHTML = '<div class="next-up-expand-empty">Nada mais na fila</div>';
      return;
    }
    rest.forEach((t) => panel.appendChild(buildNextUpExpandRow(t)));
  }

  // O painel expandido e o unico lugar (fora da aba Fila) que mostra a fila
  // inteira - por isso pede fullQueue=1 aqui, sob demanda, em vez de o
  // polling de 1s carregar tudo o tempo todo. Mostra na hora o que ja tem em
  // memoria e completa quando a resposta chega.
  async function openExpandPanel(panel) {
    populateExpandPanel(panel);
    panel.classList.remove('hidden');
    const guildId = settings.currentGuildId;
    if (!guildId) return;
    try {
      const full = await api(`/status?guildId=${encodeURIComponent(guildId)}&fullQueue=1`);
      if (!panel.classList.contains('hidden')) populateExpandPanel(panel, full.queue);
    } catch (err) {
      console.error('Erro ao carregar a fila completa:', err.message);
    }
  }

  document.querySelectorAll('.js-next-up').forEach((stripEl) => {
    stripEl.addEventListener('click', (e) => {
      const panel = stripEl.querySelector('.js-next-up-expand');
      if (!panel) return;
      const willOpen = panel.classList.contains('hidden');
      document.querySelectorAll('.js-next-up-expand').forEach((p) => p.classList.add('hidden'));
      if (willOpen) openExpandPanel(panel);
      e.stopPropagation();
    });
  });

  document.addEventListener('click', (e) => {
    document.querySelectorAll('.js-next-up-expand:not(.hidden)').forEach((panel) => {
      if (!panel.contains(e.target)) panel.classList.add('hidden');
    });
  });

  function renderNextUp(track, queue, queueLength) {
    lastQueueSnapshot = queue || [];
    document.querySelectorAll('.js-next-up').forEach((el) => el.classList.toggle('hidden', !track));
    if (!track) return;
    document.querySelectorAll('.js-next-up-name').forEach((el) => (el.textContent = track.name));
    document.querySelectorAll('.js-next-up-artist').forEach((el) => (el.textContent = (track.artists || []).join(', ')));
    document.querySelectorAll('.js-next-up-art-img').forEach((artImg) => {
      if (track.albumArt) {
        artImg.src = track.albumArt;
        artImg.style.display = '';
      } else {
        artImg.removeAttribute('src');
        artImg.style.display = 'none';
      }
    });
    const extra = (queueLength ?? lastQueueSnapshot.length) - 1;
    const countEl = document.getElementById('bottom-bar-next-up-count');
    if (countEl) countEl.textContent = extra > 0 ? `+${extra} na fila` : '';
  }

  // ---------- Espaço reservado no fim do conteúdo pra mini-barra do celular ----------
  // A .bottom-bar e position:fixed e sua altura muda (aparece/some a prévia
  // "A seguir"), entao um padding-bottom fixo no conteúdo sempre acaba
  // ficando errado (curto demais, escondendo o fim das listas atrás da
  // barra) ou exagerado. Mede a altura de verdade e mantém sincronizado.
  const bottomBarForSpacing = document.querySelector('.bottom-bar');
  if (window.ResizeObserver && bottomBarForSpacing) {
    const syncBottomBarSpace = () => {
      document.documentElement.style.setProperty('--bottom-bar-space', `${bottomBarForSpacing.getBoundingClientRect().height}px`);
    };
    new ResizeObserver(syncBottomBarSpace).observe(bottomBarForSpacing);
    syncBottomBarSpace();
  }

  // ---------- Prévia da fila na tela inicial ----------
  const homeQueueSectionEl = document.getElementById('home-queue-section');
  const homeQueueTbodyEl = document.getElementById('home-queue-tbody');

  // Mostra so as 5 primeiras, mas o contador usa o total real da fila
  // (queue aqui pode vir cortado - ver getStatus no backend).
  function renderHomeQueuePreview(queue, queueLength) {
    const total = queueLength ?? (queue ? queue.length : 0);
    homeQueueSectionEl.classList.toggle('hidden', total === 0);
    const badge = document.getElementById('home-queue-count-badge');
    if (!queue || total === 0) {
      homeQueueTbodyEl.innerHTML = '';
      badge.textContent = '';
      return;
    }
    badge.textContent = `${total} faixas`;
    homeQueueTbodyEl.innerHTML = '';
    queue.slice(0, 5).forEach((track, index) => {
      homeQueueTbodyEl.appendChild(buildQueueRow(track, index, { onRemove: () => removeFromQueue(index) }));
    });
  }

  document.getElementById('home-queue-clear-btn').addEventListener('click', async () => {
    const guildId = requireGuild();
    if (!guildId) return;
    try {
      await api(`/queue?guildId=${encodeURIComponent(guildId)}`, { method: 'DELETE' });
      refreshStatus();
    } catch (err) {
      alert(`Erro ao limpar a fila: ${err.message}`);
    }
  });

  async function refreshStatus() {
    const guildId = settings.currentGuildId;
    if (!currentUser || !guildId) return;
    // Roda a cada 1s: so pede a fila inteira quando a aba Fila esta aberta
    // (a unica visao que lista tudo). Nas outras, vem so a previa.
    const queueTabOpen = document.getElementById('tab-queue').classList.contains('active');
    try {
      const status = await api(
        `/status?guildId=${encodeURIComponent(guildId)}${queueTabOpen ? '&fullQueue=1' : ''}`
      );
      applyStatus(status);

      if (queueTabOpen) {
        renderQueue(status);
      }
    } catch (err) {
      console.error('Erro ao consultar status:', err.message);
    }
  }

  // ---------- Loop de atualização ----------
  // Poll completo (rede) 1x/s enquanto algo esta tocando - entre um poll e
  // outro, a barra de progresso e animada localmente (sem rede) pra correr
  // suave em vez de pular de 1 em 1s. Com nada tocando (ou pausado), 1x/s e
  // desperdicio: cai pra 5s. E com a aba em segundo plano, ninguem esta
  // olhando pra barra de progresso mesmo - para de todo, e retoma na hora
  // que a aba volta a ficar visivel.
  let statusPollTimer = null;
  function scheduleNextStatusPoll() {
    clearTimeout(statusPollTimer);
    if (document.hidden) return;
    const delay = localIsPlaying ? 1000 : 5000;
    statusPollTimer = setTimeout(async () => {
      await refreshStatus();
      scheduleNextStatusPoll();
    }, delay);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshStatus();
    scheduleNextStatusPoll();
  });
  scheduleNextStatusPoll();

  setInterval(() => {
    if (isDraggingProgress || !localIsPlaying || !localDuration) return;
    const estimated = Math.min(localElapsedBase + (Date.now() - localSyncedAt) / 1000, localDuration);
    progressEls().forEach((el) => {
      el.value = estimated;
      paintProgress(el);
    });
    document.querySelectorAll('.js-elapsed').forEach((el) => (el.textContent = formatTime(estimated)));
    document.querySelectorAll('.js-remaining').forEach((el) => (el.textContent = formatRemaining(estimated, localDuration)));
    document.getElementById('now-playing-time-text').textContent = `${formatTime(estimated)} / ${formatTime(localDuration)}`;
  }, 250);

  // ---------- Landing page: contador de servidores ----------
  (async () => {
    try {
      const res = await fetch(`${settings.apiUrl}/api/public-stats`);
      if (!res.ok) return;
      const { guildCount } = await res.json();
      if (guildCount > 0) {
        document.getElementById('landing-guild-count').textContent = `Online em ${guildCount} servidor${guildCount === 1 ? '' : 'es'}`;
      }
    } catch {
      // sem internet ou backend fora do ar - mantem o texto generico padrao
    }
  })();

  // ---------- Tocando agora em tela cheia (PC e celular) ----------
  const npFullscreenEl = document.getElementById('now-playing-fullscreen');
  const fullscreenBtnEls = () => document.querySelectorAll('.js-fullscreen-btn');

  // O mesmo botao vira "minimizar" enquanto a tela cheia esta ativa.
  function setFullscreenBtnState(active) {
    fullscreenBtnEls().forEach((btn) => {
      btn.querySelector('.icon-fs-enter').style.display = active ? 'none' : '';
      btn.querySelector('.icon-fs-exit').style.display = active ? '' : 'none';
      btn.title = active ? 'Sair da tela cheia' : 'Tela cheia';
    });
  }

  async function enterNowPlayingFullscreen() {
    npFullscreenEl.classList.remove('hidden');
    setFullscreenBtnState(true);
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // navegador recusou a tela cheia nativa (ex: dentro de um iframe) -
      // continua mostrando so a visao em overlay, sem travar nada.
    }
  }

  function exitNowPlayingFullscreen() {
    npFullscreenEl.classList.add('hidden');
    setFullscreenBtnState(false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function toggleNowPlayingFullscreen() {
    if (npFullscreenEl.classList.contains('hidden')) {
      enterNowPlayingFullscreen();
    } else {
      exitNowPlayingFullscreen();
    }
  }

  fullscreenBtnEls().forEach((btn) => btn.addEventListener('click', toggleNowPlayingFullscreen));
  document.getElementById('np-fullscreen-exit-btn').addEventListener('click', exitNowPlayingFullscreen);

  // No celular nao tem espaco na mini-barra pra volume/autoplay/aleatorio/
  // anterior - tocar em qualquer parte dela (fora dos botoes de play/pular)
  // abre a tela cheia, que tem todos esses controles.
  document.querySelector('.bottom-bar-track').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (!currentPlayingTrack) return;
    enterNowPlayingFullscreen();
  });

  // Se o usuario sair da tela cheia nativa (Esc, ou controle do proprio
  // navegador) sem passar pelo nosso botao, esconde o overlay e volta o
  // icone do botao tambem.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      npFullscreenEl.classList.add('hidden');
      setFullscreenBtnState(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !npFullscreenEl.classList.contains('hidden')) {
      exitNowPlayingFullscreen();
    }
  });

  // ---------- Histórico / Cápsula do tempo (retrospectiva mensal, modo
  // servidor ou pessoal) - portado de "template html/Vitrola Capsula.html" ----------
  const retroMonthPickerEl = document.getElementById('retro-month-picker');
  const retroEmptyEl = document.getElementById('retro-empty');
  const retroContentEl = document.getElementById('retro-content');
  const retroShareModalEl = document.getElementById('retro-share-modal');
  const retroCanvasEl = document.getElementById('retro-capsule-canvas');
  let retroSelectedMonth = null; // "YYYY-MM"; null ainda nao escolheu (usa o mes atual)
  let retroScope = 'server'; // 'server' | 'personal'
  let retroCurrentData = null;

  const MONTH_NAMES = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

  function formatMonthLabel(monthKeyStr) {
    const [year, month] = monthKeyStr.split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }

  function formatDayLabel(dateKeyStr) {
    const [, month, day] = dateKeyStr.split('-').map(Number);
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
  }

  async function loadRetrospectiveMonths() {
    const guildId = settings.currentGuildId;
    if (!currentUser || !guildId) return;
    let months;
    try {
      months = await api(`/retrospective/months?guildId=${encodeURIComponent(guildId)}`);
    } catch (err) {
      console.error('Erro ao carregar meses da retrospectiva:', err.message);
      return;
    }

    const currentMonthKey = new Date().toISOString().slice(0, 7);
    if (!months.includes(currentMonthKey)) months = [currentMonthKey, ...months];
    if (!retroSelectedMonth) retroSelectedMonth = currentMonthKey;

    retroMonthPickerEl.innerHTML = '';
    months.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'retro-month-chip';
      btn.classList.toggle('active', m === retroSelectedMonth);
      btn.textContent = m === currentMonthKey ? 'Este mês' : formatMonthLabel(m);
      btn.addEventListener('click', () => {
        retroSelectedMonth = m;
        retroMonthPickerEl.querySelectorAll('.retro-month-chip').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        loadRetrospective();
      });
      retroMonthPickerEl.appendChild(btn);
    });
  }

  function setRetroScope(scope) {
    retroScope = scope;
    document.getElementById('retro-scope-server').classList.toggle('active', scope === 'server');
    document.getElementById('retro-scope-personal').classList.toggle('active', scope === 'personal');
    document.getElementById('retro-plays-label').textContent = scope === 'server' ? 'músicas tocadas' : 'músicas pedidas';
    loadRetrospective();
  }
  document.getElementById('retro-scope-server').addEventListener('click', () => setRetroScope('server'));
  document.getElementById('retro-scope-personal').addEventListener('click', () => setRetroScope('personal'));

  function currentGuildName() {
    const opt = guildSelectEl.querySelector(`option[value="${CSS.escape(settings.currentGuildId || '')}"]`);
    return opt ? opt.textContent : 'seu servidor';
  }

  async function loadRetrospective() {
    const guildId = settings.currentGuildId;
    if (!currentUser || !guildId) return;
    const month = retroSelectedMonth || new Date().toISOString().slice(0, 7);
    let data;
    try {
      data = await api(`/retrospective?guildId=${encodeURIComponent(guildId)}&scope=${retroScope}&month=${encodeURIComponent(month)}`);
    } catch (err) {
      console.error('Erro ao carregar retrospectiva:', err.message);
      return;
    }
    retroCurrentData = data;

    document.getElementById('retro-month-badge').textContent = formatMonthLabel(data.month);

    const isCurrentMonth = data.month === new Date().toISOString().slice(0, 7);
    const periodo = isCurrentMonth ? 'neste mês' : `em ${formatMonthLabel(data.month)}`;
    document.getElementById('retro-subtitle').textContent =
      retroScope === 'server'
        ? `O que o servidor ${currentGuildName()} ouviu ${periodo}.`
        : `O que você, ${currentUser.username}, ouviu ${periodo}.`;

    if (!data.totalPlays) {
      retroEmptyEl.classList.remove('hidden');
      retroContentEl.classList.add('hidden');
      document.getElementById('retro-total-minutes').textContent = '0';
      document.getElementById('retro-total-plays').textContent = '0';
      document.getElementById('retro-distinct-artists').textContent = '0';
      return;
    }
    retroEmptyEl.classList.add('hidden');
    retroContentEl.classList.remove('hidden');

    document.getElementById('retro-total-minutes').textContent = data.totalMinutes;
    document.getElementById('retro-total-plays').textContent = data.totalPlays;
    document.getElementById('retro-distinct-artists').textContent = data.distinctArtists;

    const artistsListEl = document.getElementById('retro-top-artists');
    artistsListEl.innerHTML = '';
    const maxArtistPlays = data.topArtists[0]?.count || 1;
    data.topArtists.forEach((a, i) => {
      const [artFrom, artTo] = PLACEHOLDER_GRADIENTS[hashStr(a.name) % PLACEHOLDER_GRADIENTS.length];
      const barPct = Math.round((a.count / maxArtistPlays) * 100);
      const artInner = a.albumArt
        ? `<img src="${escapeAttr(a.albumArt)}" alt="" />`
        : '';
      const li = document.createElement('li');
      li.className = `retro-artist-row${i === 0 ? ' rank-1' : ''}`;
      li.innerHTML = `
        <span class="retro-artist-index">${i + 1}</span>
        <div class="retro-artist-art" style="background: linear-gradient(140deg, ${artFrom}, ${artTo})">${artInner}</div>
        <div class="retro-artist-text">
          <div class="retro-artist-name">${escapeHtml(a.name)}</div>
          <div class="retro-artist-plays">${a.count} execuç${a.count === 1 ? 'ão' : 'ões'}</div>
        </div>
        <div class="retro-artist-bar-track"><div class="retro-artist-bar-fill" style="width: ${barPct}%"></div></div>
      `;
      artistsListEl.appendChild(li);
    });

    const tracksListEl = document.getElementById('retro-top-tracks');
    tracksListEl.innerHTML = '';
    data.topTracks.forEach((t, i) => {
      const [artFrom, artTo] = PLACEHOLDER_GRADIENTS[hashStr(t.name) % PLACEHOLDER_GRADIENTS.length];
      const artInner = t.albumArt
        ? `<img src="${escapeAttr(t.albumArt)}" alt="" />`
        : '';
      const li = document.createElement('li');
      li.className = 'retro-track-row';
      li.innerHTML = `
        <span class="retro-track-index"${i === 0 ? ' style="color: var(--accent)"' : ''}>${i + 1}</span>
        <div class="retro-track-art" style="background: linear-gradient(140deg, ${artFrom}, ${artTo})">${artInner}</div>
        <div class="retro-track-text">
          <div class="retro-track-title">${escapeHtml(t.name)}</div>
          <div class="retro-track-artist">${escapeHtml((t.artists || []).join(', '))}</div>
        </div>
        <span class="retro-track-plays">${t.count}×</span>
      `;
      tracksListEl.appendChild(li);
    });

    // "Dia mais ouvido": substitui o card de genero do template original -
    // nao temos dado de genero musical (Spotify so da isso por artista, via
    // chamada extra que nao fazemos hoje), entao usamos algo que ja
    // calculamos de verdade: o dia do mes com mais minutos ouvidos.
    const [topDay, ...otherDays] = data.topDays;
    document.getElementById('retro-top-day-value').textContent = topDay ? `${formatDayLabel(topDay.date)} · ${topDay.minutes} min` : '—';
    const tagsEl = document.getElementById('retro-top-day-tags');
    tagsEl.innerHTML = '';
    otherDays.forEach((d) => {
      const span = document.createElement('span');
      span.className = 'retro-side-tag';
      span.textContent = `${formatDayLabel(d.date)} · ${d.minutes}min`;
      tagsEl.appendChild(span);
    });

    document.getElementById('retro-side-title').textContent = data.side.title;
    document.getElementById('retro-side-name').textContent = data.side.name;
    document.getElementById('retro-side-meta').textContent = data.side.meta;
    document.getElementById('retro-side-note').textContent = data.side.note;

    const peakWeek = Math.max(...data.weeklyMinutes.map((w) => w.minutes), 1);
    document.getElementById('retro-week-peak').textContent = (() => {
      const peakEntry = data.weeklyMinutes.find((w) => w.minutes === peakWeek);
      return peakEntry && peakEntry.minutes > 0 ? `pico na semana ${peakEntry.week}` : '';
    })();
    const weekChartEl = document.getElementById('retro-week-chart');
    weekChartEl.innerHTML = '';
    data.weeklyMinutes.forEach((w) => {
      const isPeak = w.minutes === peakWeek && w.minutes > 0;
      const col = document.createElement('div');
      col.className = `retro-week-col${isPeak ? ' peak' : ''}`;
      const heightPct = Math.max(4, Math.round((w.minutes / peakWeek) * 100));
      col.innerHTML = `
        <div class="retro-week-value">${w.minutes}</div>
        <div class="retro-week-bar" style="height: ${heightPct}%"></div>
        <div class="retro-week-label">sem ${w.week}</div>
      `;
      weekChartEl.appendChild(col);
    });
  }

  // Corta o texto (com "…") pra caber na largura maxima - canvas nao quebra
  // linha nem trunca sozinho como o CSS faz.
  function truncateCanvasText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return `${truncated}…`;
  }

  // Carrega uma imagem liberando CORS (confirmado que i.scdn.co e
  // i.ytimg.com mandam Access-Control-Allow-Origin: * - sem isso o canvas
  // ficaria "contaminado" e o toBlob() na hora de exportar quebraria).
  function loadImageForCanvas(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  // Desenha "cover" (recorte central, sem distorcer) de uma imagem dentro
  // de um retangulo x,y,w,h - equivalente ao object-fit:cover do CSS, que
  // o canvas nao tem de forma nativa.
  function drawImageCover(ctx, img, x, y, w, h) {
    const imgRatio = img.width / img.height;
    const boxRatio = w / h;
    let sx, sy, sw, sh;
    if (imgRatio > boxRatio) {
      sh = img.height;
      sw = sh * boxRatio;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = sw / boxRatio;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  // Desenha o card final (formato "story", 9:16) inteiramente no canvas -
  // sem lib nenhuma. O "hero" tenta usar a capa da musica mais ouvida de
  // verdade; se a imagem falhar ao carregar (rede, ou algum CDN sem CORS
  // liberado), fica so o gradiente placeholder que ja foi pintado por
  // baixo - nunca quebra a exportacao por causa disso.
  async function drawRetroCapsule(data, scope) {
    const ctx = retroCanvasEl.getContext('2d');
    const W = retroCanvasEl.width;
    const H = retroCanvasEl.height;
    const pad = 52;
    const heroH = H * 0.22;

    const topArtistName = data.topArtists[0]?.name || 'Vitrola';
    const [heroFrom, heroTo] = PLACEHOLDER_GRADIENTS[hashStr(topArtistName) % PLACEHOLDER_GRADIENTS.length];
    const hero = ctx.createLinearGradient(0, 0, W, heroH);
    hero.addColorStop(0, heroFrom);
    hero.addColorStop(1, heroTo);
    ctx.fillStyle = hero;
    ctx.fillRect(0, 0, W, heroH);

    ctx.fillStyle = '#0e0d0b';
    ctx.fillRect(0, heroH, W, H - heroH);

    const heroArt = data.topTracks[0]?.albumArt;
    if (heroArt) {
      try {
        const img = await loadImageForCanvas(heroArt);
        drawImageCover(ctx, img, 0, 0, W, heroH);
      } catch {
        // capa nao carregou - fica so o gradiente ja pintado acima
      }
    }

    const fade = ctx.createLinearGradient(0, heroH - 90, 0, heroH);
    fade.addColorStop(0, 'rgba(14,13,11,0)');
    fade.addColorStop(1, '#0e0d0b');
    ctx.fillStyle = fade;
    ctx.fillRect(0, heroH - 90, W, 90);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = '#e9d34a';
    ctx.font = '700 24px Georgia, serif';
    ctx.fillText('◉ Vitrola', pad, 56);
    ctx.fillStyle = '#d8d0be';
    ctx.font = '600 16px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }), W - pad, 56);
    ctx.textAlign = 'left';

    let y = heroH + 66;
    ctx.fillStyle = '#f2ece0';
    ctx.font = '700 40px Georgia, serif';
    const title = scope === 'server' ? `A cápsula sonora do ${currentGuildName()}` : `Minha cápsula sonora de ${MONTH_NAMES[Number(data.month.split('-')[1]) - 1]}`;
    wrapCanvasText(ctx, title, W - pad * 2, 2).forEach((line) => {
      ctx.fillText(line, pad, y);
      y += 46;
    });

    y += 34;
    const colW = (W - pad * 2 - 30) / 2;
    ctx.fillStyle = '#f2ece0';
    ctx.font = '700 20px sans-serif';
    ctx.fillText('Artistas favoritos', pad, y);
    ctx.fillText('Músicas favoritas', pad + colW + 30, y);

    ctx.font = '500 19px sans-serif';
    ctx.fillStyle = '#cfc7b2';
    data.topArtists.slice(0, 5).forEach((a, i) => {
      ctx.fillText(truncateCanvasText(ctx, `${i + 1} ${a.name}`, colW), pad, y + 40 + i * 34);
    });
    data.topTracks.slice(0, 5).forEach((t, i) => {
      ctx.fillText(truncateCanvasText(ctx, `${i + 1} ${t.name}`, colW), pad + colW + 30, y + 40 + i * 34);
    });

    y += 40 + 5 * 34 + 50;
    ctx.fillStyle = '#f2ece0';
    ctx.font = '700 20px sans-serif';
    ctx.fillText('Tempo ouvindo', pad, y);
    ctx.fillStyle = '#e9d34a';
    ctx.font = '700 52px Georgia, serif';
    ctx.fillText(`${data.totalMinutes} minutos`, pad, y + 54);

    ctx.fillStyle = '#7d776a';
    ctx.font = '600 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('feito com Vitrola', W / 2, H - 36);
    ctx.textAlign = 'left';
  }

  // Quebra o texto em ate maxLines linhas, cada uma cabendo em maxWidth -
  // usado so pro titulo do card (nome de servidor pode ser longo).
  function wrapCanvasText(ctx, text, maxWidth, maxLines) {
    const words = text.split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word;
      if (ctx.measureText(attempt).width > maxWidth && current) {
        lines.push(current);
        current = word;
        if (lines.length === maxLines - 1) break;
      } else {
        current = attempt;
      }
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length === maxLines) {
      lines[maxLines - 1] = truncateCanvasText(ctx, lines[maxLines - 1], maxWidth);
    }
    return lines;
  }

  function retroCanvasToBlob() {
    return new Promise((resolve) => retroCanvasEl.toBlob(resolve, 'image/png'));
  }

  async function openRetroShareModal() {
    if (!retroCurrentData || !retroCurrentData.totalPlays) {
      showToast('Nada pra compartilhar ainda esse mês.');
      return;
    }
    retroShareModalEl.classList.remove('hidden');
    await drawRetroCapsule(retroCurrentData, retroScope);
  }
  function closeRetroShareModal() {
    retroShareModalEl.classList.add('hidden');
  }

  async function downloadRetroCapsule() {
    const blob = await retroCanvasToBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vitrola-capsula-${retroSelectedMonth || 'mes'}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function shareRetroCapsule() {
    const blob = await retroCanvasToBlob();
    if (!blob) return;
    const file = new File([blob], 'vitrola-capsula.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Minha cápsula do tempo no Vitrola' });
        return;
      } catch {
        // usuario cancelou o compartilhamento, ou o navegador recusou - cai
        // pro download normal em vez de nao fazer nada.
      }
    }
    await downloadRetroCapsule();
  }

  document.getElementById('retro-share-btn').addEventListener('click', openRetroShareModal);
  document.getElementById('retro-share-close-btn').addEventListener('click', closeRetroShareModal);
  document.getElementById('retro-download-btn').addEventListener('click', async () => {
    if (!retroCurrentData || !retroCurrentData.totalPlays) return;
    await drawRetroCapsule(retroCurrentData, retroScope);
    await downloadRetroCapsule();
  });
  document.getElementById('retro-share-confirm-btn').addEventListener('click', shareRetroCapsule);
  document.getElementById('retro-share-download-btn').addEventListener('click', downloadRetroCapsule);
  retroShareModalEl.addEventListener('click', (e) => {
    if (e.target === retroShareModalEl) closeRetroShareModal();
  });

  document.querySelectorAll('.tab-btn[data-tab="history"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      loadRetrospectiveMonths().then(loadRetrospective);
    });
  });

  // ---------- Inicialização ----------
  renderGenres();
  updateQuickAccessVisibility();
  (async () => {
    await refreshAccountUI();
    renderPlaylists();
    refreshStatus();
  })();
})();

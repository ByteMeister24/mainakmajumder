const METRICS_CONFIG = {
      authorName: 'Mainak Majumder',
      orcid: 'https://orcid.org/0009-0008-3062-4793',
      openAlexAuthorId: '',
      semanticScholarAuthorId: '150219982',
    };

    function normalizeName(name) {
      return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function extractOrcidId(value) {
      if (!value) return '';
      const clean = String(value).trim();
      const match = clean.match(/(\d{4}-\d{4}-\d{4}-[\dX]{4})/i);
      return match ? match[1].toUpperCase() : clean.replace(/^https?:\/\/orcid\.org\//i, '');
    }

    function formatMetricNumber(value) {
      return Number.isFinite(value) ? value.toLocaleString() : 'N/A';
    }

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setMetricsStatus(value, state) {
  const el = document.getElementById('metrics-status');
  if (!el) return;

  el.textContent = value;
  el.classList.remove('is-loading', 'is-live', 'is-partial', 'is-unavailable');
  el.classList.add(`is-${state}`);
}

function setLink(id, url) {
  const el = document.getElementById(id);
  if (!el) return;

      if (url) {
        el.href = url;
        el.style.display = '';
      } else {
        el.removeAttribute('href');
        el.style.display = 'none';
      }
    }

    function semanticScholarFallbackUrl(authorName) {
      const q = encodeURIComponent(authorName || METRICS_CONFIG.authorName || '');
      return `https://www.semanticscholar.org/search?q=${q}`;
    }

    function scoreAuthorCandidate(authorName, candidateName, affiliationText = '') {
      const target = normalizeName(authorName);
      const candidate = normalizeName(candidateName);
      const affiliation = normalizeName(affiliationText);

      let score = 0;
      if (!candidate) return score;
      if (candidate === target) score += 10;
      if (candidate.includes(target) || target.includes(candidate)) score += 4;
      if (affiliation.includes('kepler') || affiliation.includes('linz')) score += 2;
      return score;
    }

    async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timer);
      }
    }

    async function fetchOpenAlexMetrics() {
      const cfg = METRICS_CONFIG;
      const orcidId = extractOrcidId(cfg.orcid);
      let author = null;

      if (cfg.openAlexAuthorId) {
        author = await fetchJsonWithTimeout(`https://api.openalex.org/authors/${encodeURIComponent(cfg.openAlexAuthorId)}`);
      } else if (orcidId) {
        author = await fetchJsonWithTimeout(`https://api.openalex.org/authors/orcid:${encodeURIComponent(orcidId)}`);
      } else {
        const data = await fetchJsonWithTimeout(`https://api.openalex.org/authors?search=${encodeURIComponent(cfg.authorName)}&per-page=10`);
        const results = Array.isArray(data?.results) ? data.results : [];
        author = results
          .map((a) => {
            const affiliation = Array.isArray(a?.affiliations) ? a.affiliations.map((x) => x?.institution?.display_name || '').join(' ') : '';
            return { a, score: scoreAuthorCandidate(cfg.authorName, a?.display_name, affiliation) };
          })
          .sort((x, y) => y.score - x.score)[0]?.a || null;
      }

      if (!author) throw new Error('No OpenAlex author match');

      return {
        name: author.display_name || cfg.authorName,
        citations: Number(author.cited_by_count),
        hIndex: Number(author.summary_stats?.h_index),
        i10Index: Number(author.summary_stats?.i10_index),
        url: author.id || '',
      };
    }

    async function fetchSemanticScholarMetrics() {
      const cfg = METRICS_CONFIG;
      let author = null;
      const coreFields = 'authorId,name,citationCount,hIndex,url,affiliations';

      if (cfg.semanticScholarAuthorId) {
        try {
          author = await fetchJsonWithTimeout(
            `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(cfg.semanticScholarAuthorId)}?fields=${encodeURIComponent(coreFields)}`
          );
        } catch (_err) {
          author = null;
        }
      }

      if (!author) {
        let data = await fetchJsonWithTimeout(
          `https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(cfg.authorName)}&limit=10&fields=${encodeURIComponent(coreFields)}`
        );
        let results = Array.isArray(data?.data) ? data.data : [];

        author = results
          .map((a) => {
            const affiliation = Array.isArray(a?.affiliations) ? a.affiliations.join(' ') : '';
            return { a, score: scoreAuthorCandidate(cfg.authorName, a?.name, affiliation) };
          })
          .sort((x, y) => y.score - x.score)[0]?.a || null;
      }

      if (!author) throw new Error('No Semantic Scholar author match');

      const authorId = author.authorId || cfg.semanticScholarAuthorId || '';
      let derivedI10 = NaN;

      if (authorId) {
        try {
          const papersData = await fetchJsonWithTimeout(
            `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}/papers?fields=citationCount&limit=1000`
          );
          const papers = Array.isArray(papersData?.data) ? papersData.data : [];
          derivedI10 = papers.filter((p) => Number(p?.citationCount) >= 10).length;
        } catch (_err) {
          derivedI10 = NaN;
        }
      }

      return {
        name: author.name || cfg.authorName,
        citations: Number(author.citationCount),
        hIndex: Number(author.hIndex),
        i10Index: Number.isFinite(derivedI10) ? derivedI10 : NaN,
        url: author.url || (authorId ? `https://www.semanticscholar.org/author/${encodeURIComponent(authorId)}` : semanticScholarFallbackUrl(author.name || cfg.authorName)),
      };
    }

async function loadResearchMetrics() {
  const block = document.getElementById('research-metrics');
  if (!block) return;

  setMetricsStatus('Loading...', 'loading');

      const [oaResult, ssResult] = await Promise.allSettled([
        fetchOpenAlexMetrics(),
        fetchSemanticScholarMetrics(),
      ]);

      const oa = oaResult.status === 'fulfilled' ? oaResult.value : null;
      const ss = ssResult.status === 'fulfilled' ? ssResult.value : null;

      setText('oa-citations', formatMetricNumber(oa?.citations));
      setText('oa-hindex', formatMetricNumber(oa?.hIndex));
      setText('oa-i10index', formatMetricNumber(oa?.i10Index));
      setLink('oa-link', oa?.url || '');

      setText('ss-citations', formatMetricNumber(ss?.citations));
      setText('ss-hindex', formatMetricNumber(ss?.hIndex));
  setText('ss-i10index', formatMetricNumber(ss?.i10Index));
  setLink('ss-link', ss?.url || semanticScholarFallbackUrl(ss?.name));

  if (oa && ss) {
    setMetricsStatus('Live', 'live');
  } else if (oa || ss) {
    setMetricsStatus('Partial', 'partial');
  } else {
    setMetricsStatus('Unavailable', 'unavailable');
  }
}

    async function loadSections() {
      const slots = Array.from(document.querySelectorAll('[data-include]'));

      await Promise.all(slots.map(async (slot) => {
        const file = slot.getAttribute('data-include');

        try {
          const res = await fetch(file, { cache: 'no-store' });
          if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);

          const html = await res.text();
          const tpl = document.createElement('template');
          tpl.innerHTML = html.trim();
          slot.replaceWith(tpl.content);
        } catch (err) {
          console.error(err);
          slot.outerHTML = `
            <section class="card">
              <h2>Section load error</h2>
              <p class="muted" style="margin:0;">Could not load <code>${file}</code>.</p>
            </section>
          `;
        }
      }));
    }

function monthIndexFromToken(token) {
  const match = String(token || '').trim().match(/^(0?[1-9]|1[0-2])[\/.-](\d{4})$/);
  if (!match) return null;

  const month = Number(match[1]) - 1;
  const year = Number(match[2]);
  return (year * 12) + month;
}

function isCurrentTimelineRange(dateText, nowIndex) {
  if (!dateText) return false;

  const tokens = Array.from(String(dateText).matchAll(/\b(0?[1-9]|1[0-2])[\/.-](\d{4})\b/g))
    .map((m) => monthIndexFromToken(`${m[1]}/${m[2]}`))
    .filter((v) => Number.isFinite(v));

  if (tokens.length === 0) return false;

  if (/\b(present|current|now)\b/i.test(dateText)) {
    return nowIndex >= tokens[0];
  }

  if (tokens.length === 1) {
    return nowIndex === tokens[0];
  }

  const start = Math.min(tokens[0], tokens[1]);
  const end = Math.max(tokens[0], tokens[1]);
  return nowIndex >= start && nowIndex <= end;
}

function syncTimelineDots() {
  const now = new Date();
  const nowIndex = (now.getFullYear() * 12) + now.getMonth();
  const items = Array.from(document.querySelectorAll('.timelineItem'));

  items.forEach((item) => {
    const dateText = item.querySelector('.timelineDate')?.textContent?.trim() || '';
    const dot = item.querySelector('.timelineDot');
    if (!dot) return;

    dot.classList.toggle('is-current', isCurrentTimelineRange(dateText, nowIndex));
  });
}

function attachSkillLogos() {
  const chips = Array.from(document.querySelectorAll('#about .chip[data-logo]'));

  chips.forEach((chip) => {
    const slug = chip.getAttribute('data-logo')?.trim();
    if (!slug || chip.querySelector('.chipLogo')) return;

    const img = document.createElement('img');
    img.className = 'chipLogo';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = `https://cdn.simpleicons.org/${encodeURIComponent(slug)}/173F5F`;

    img.addEventListener('error', () => {
      chip.classList.remove('has-logo');
      img.remove();
    });

    chip.prepend(img);
    chip.classList.add('has-logo');
  });
}

function getActivePanel() {
  return document.querySelector('.tabPanel.is-active');
}

function getPanelIdFromHash() {
  return window.location.hash ? window.location.hash.slice(1) : '';
}

function activateTab(panelId, options = {}) {
  const { syncHash = true } = options;
  const tabs = Array.from(document.querySelectorAll('.tabBtn'));
  const panels = Array.from(document.querySelectorAll('.tabPanel'));
  const hasTarget = panels.some((panel) => panel.id === panelId);
  if (!hasTarget) return;

  tabs.forEach((tab) => {
    const isActive = tab.getAttribute('data-tab-target') === panelId;
    tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
      });

  panels.forEach((panel) => {
    const isActive = panel.id === panelId;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  });

  if (syncHash) {
    history.replaceState(null, '', `#${panelId}`);
  }
}

    function initTabs() {
      const tabs = Array.from(document.querySelectorAll('.tabBtn'));

      tabs.forEach((tab, index) => {
        tab.tabIndex = tab.classList.contains('is-active') ? 0 : -1;

        tab.addEventListener('click', () => {
          activateTab(tab.getAttribute('data-tab-target'));
        });

        tab.addEventListener('keydown', (e) => {
          let nextIndex = index;

          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
          if (e.key === 'Home') nextIndex = 0;
          if (e.key === 'End') nextIndex = tabs.length - 1;

          if (nextIndex !== index) {
            e.preventDefault();
            tabs[nextIndex].focus();
            tabs[nextIndex].click();
          }
        });
      });
    }

function initPageUi() {
  const updated = document.getElementById('updated');
  updated.textContent = new Date().toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
  initTabs();

  const panelIdFromHash = getPanelIdFromHash();
  if (panelIdFromHash) {
    activateTab(panelIdFromHash, { syncHash: false });
  }

  window.addEventListener('hashchange', () => {
    const panelId = getPanelIdFromHash();
    if (panelId) activateTab(panelId, { syncHash: false });
  });
}

    document.addEventListener('DOMContentLoaded', async () => {
      await loadSections();
      attachSkillLogos();
      syncTimelineDots();
      await loadResearchMetrics();
      initPageUi();
    });

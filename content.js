// content.js — LeetCode Hint Engine v2
// Multi-platform: LeetCode, Codeforces, GFG, CodeChef, AtCoder, HackerRank, InterviewBit, TakeYouForward

(function () {
  'use strict';

  const SYSTEM_PROMPT =
    'You are a coding interview coach. Given a problem, generate exactly 3 progressive hints. ' +
    'Hint 1 points toward the approach without naming it. ' +
    'Hint 2 names the data structure and explains why. ' +
    'Hint 3 gives partial pseudocode. Never give the full solution. ' +
    'Return ONLY valid JSON: {"hint1":"","hint2":"","hint3":""}';

  let currentHintIndex = 0;
  let hintsData = null;
  let lastSubmissionUrl = '';
  let cachedCode = ''; // captured on submit click, before page navigates away
  let submitPollInterval = null;

  // ── Platform detection & scrapers ──────────────────────────────────────────
  function getPlatformData() {
    const h = location.hostname;
    const p = location.pathname;

    if (h.includes('leetcode.com'))       return scrapeLeetCode();
    if (h.includes('codeforces.com'))     return scrapeCodeforces();
    if (h.includes('geeksforgeeks.org'))  return scrapeGFG();
    if (h.includes('codechef.com'))       return scrapeCodeChef();
    if (h.includes('atcoder.jp'))         return scrapeAtCoder();
    if (h.includes('hackerrank.com'))     return scrapeHackerRank();
    if (h.includes('interviewbit.com'))   return scrapeInterviewBit();
    if (h.includes('takeuforward.org'))   return scrapeTakeYouForward();
    return null;
  }

  function txt(sel, fallback = '') {
    return document.querySelector(sel)?.innerText?.trim() || fallback;
  }

  function scrapeLeetCode() {
    const title =
      txt('[data-cy="question-title"]') ||
      txt('h1') ||
      location.pathname.replace('/problems/', '').replace(/\/$/, '').replace(/-/g, ' ');
    const desc =
      txt('[data-track-load="description_content"]') ||
      txt('.question-content') ||
      txt('[class*="question-content"]');
    return { platform: 'LeetCode', title, description: desc.slice(0, 2000) };
  }

  function scrapeCodeforces() {
    const title = txt('.problem-statement .title') || txt('h1');
    const desc  = txt('.problem-statement');
    return { platform: 'Codeforces', title, description: desc.slice(0, 2000) };
  }

  function scrapeGFG() {
    const title = txt('h1.problems-name') || txt('.header-content h1') || txt('h1');
    const desc  = txt('.problem-statement') || txt('.problems-page-description') || txt('article');
    return { platform: 'GeeksForGeeks', title, description: desc.slice(0, 2000) };
  }

  function scrapeCodeChef() {
    const title = txt('.problem-name h1') || txt('h1');
    const desc  = txt('#problem-statement') || txt('.problem-body');
    return { platform: 'CodeChef', title, description: desc.slice(0, 2000) };
  }

  function scrapeAtCoder() {
    const title = txt('#task-statement h2') || txt('h2');
    const desc  = txt('#task-statement');
    return { platform: 'AtCoder', title, description: desc.slice(0, 2000) };
  }

  function scrapeHackerRank() {
    const title = txt('.challenge-name') || txt('h1');
    const desc  = txt('.challenge-body-html') || txt('.challenge-statement');
    return { platform: 'HackerRank', title, description: desc.slice(0, 2000) };
  }

  function scrapeInterviewBit() {
    const title = txt('h1.problem-title') || txt('h1');
    const desc  = txt('.problem-description') || txt('article');
    return { platform: 'InterviewBit', title, description: desc.slice(0, 2000) };
  }

  function scrapeTakeYouForward() {
    const title = txt('h1') || document.title;
    const desc  = txt('.entry-content') || txt('article') || txt('main');
    return { platform: 'TakeYouForward', title, description: desc.slice(0, 2000) };
  }

  // ── Code extraction ────────────────────────────────────────────────────────
  async function getEditorCode() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_CODE' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(fallbackDOMCode());
            return;
          }
          let finalCode = response?.code;
          if (!finalCode) finalCode = fallbackDOMCode();
          resolve(finalCode);
        });
      } catch (e) {
        resolve(fallbackDOMCode());
      }
    });
  }

  function fallbackDOMCode() {
    const ta = document.querySelector('textarea.editor') ||
               document.querySelector('[data-mode-id]') ||
               document.querySelector('textarea[name="code"]');
    if (ta) return ta.value;

    const lines = document.querySelectorAll('.view-line');
    if (lines.length > 0) return Array.from(lines).map(el => el.textContent).join('\\n');
    
    return '';
  }

  // ── Multi-provider AI call ─────────────────────────────────────────────────
  async function callAI(provider, apiKey, title, description) {
    const userMsg = `Problem Title: ${title}\n\nDescription:\n${description}`;

    let res;
    try {
      if (provider === 'groq') {
        res = await fetchOpenAICompat(
          'https://api.groq.com/openai/v1/chat/completions',
          apiKey, 'llama-3.3-70b-versatile', userMsg
        );
      } else if (provider === 'openai') {
        res = await fetchOpenAICompat(
          'https://api.openai.com/v1/chat/completions',
          apiKey, 'gpt-4o-mini', userMsg
        );
      } else if (provider === 'gemini') {
        res = await fetchGemini(apiKey, userMsg);
      } else if (provider === 'claude') {
        res = await fetchClaude(apiKey, userMsg);
      } else if (provider === 'cohere') {
        res = await fetchCohere(apiKey, userMsg);
      } else {
        throw new Error('unknown_provider');
      }
    } catch (e) {
      throw e;
    }

    return parseHints(res);
  }

  async function fetchOpenAICompat(endpoint, apiKey, model, userMsg) {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 512,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMsg },
        ],
      }),
    });
    if (r.status === 429) throw new Error('rate_limit');
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error?.message || `api_error_${r.status}`); }
    const d = await r.json();
    return d.choices?.[0]?.message?.content || '';
  }

  async function fetchGemini(apiKey, userMsg) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userMsg }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
        }),
      }
    );
    if (r.status === 429) throw new Error('rate_limit');
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error?.message || `api_error_${r.status}`); }
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  async function fetchClaude(apiKey, userMsg) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (r.status === 429) throw new Error('rate_limit');
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error?.message || `api_error_${r.status}`); }
    const d = await r.json();
    return d.content?.[0]?.text || '';
  }

  async function fetchCohere(apiKey, userMsg) {
    const r = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'command-r-plus-08-2024',
        system_prompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
        max_tokens: 512,
      }),
    });
    if (r.status === 429) throw new Error('rate_limit');
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error?.message || `api_error_${r.status}`); }
    const d = await r.json();
    return d.message?.content?.[0]?.text || '';
  }

  function parseHints(raw) {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); } catch { throw new Error('parse_error'); }
    if (!parsed.hint1 || !parsed.hint2 || !parsed.hint3) throw new Error('incomplete');
    return parsed;
  }

  // ── Floating Button ────────────────────────────────────────────────────────
  function isOnKnownPlatform() {
    const h = location.hostname;
    return h.includes('leetcode.com') || h.includes('codeforces.com') ||
           h.includes('geeksforgeeks.org') || h.includes('codechef.com') ||
           h.includes('atcoder.jp') || h.includes('hackerrank.com') ||
           h.includes('interviewbit.com') || h.includes('takeuforward.org');
  }

  function injectHintButton() {
    if (document.getElementById('lhe-hint-btn')) return;
    if (!isOnKnownPlatform() || !document.body) return;
    const btn = document.createElement('button');
    btn.id = 'lhe-hint-btn';
    btn.setAttribute('aria-label', 'Get a hint for this problem');
    btn.innerHTML = '<span>💡</span><span class="lhe-btn-label">Get Hint</span>';
    document.body.appendChild(btn);
    btn.addEventListener('click', onHintClick);
  }

  // ── Button Click ───────────────────────────────────────────────────────────
  async function onHintClick() {
    try {
      chrome.storage.local.get(['aiProvider', 'apiKey'], async ({ aiProvider, apiKey }) => {
        if (chrome.runtime.lastError) return;
        if (!aiProvider || !apiKey) {
        openPanel({ state: 'error', errorType: 'no_key' });
        return;
      }

      const pd = getPlatformData() || { platform: 'Unknown', title: document.title, description: '' };
      currentHintIndex = 0;
      hintsData = null;

      openPanel({ state: 'loading', title: pd.title });

      try {
        hintsData = await callAI(aiProvider, apiKey, pd.title, pd.description);
        currentHintIndex = 1;
        openPanel({ state: 'hints', title: pd.title, hints: hintsData, activeHint: 1 });
        } catch (err) {
          openPanel({ state: 'error', errorType: err.message, title: pd.title });
        }
      });
    } catch (e) {
      if (e.message.includes('Extension context invalidated')) {
        alert('Extension was updated. Please refresh the page to use the Hint Engine.');
      }
    }
  }

  // ── Submission detection ───────────────────────────────────────────────────
  const SUCCESS_PHRASES = [
    'accepted', 'problem solved successfully', 'correct answer',
    'all test cases passed', 'congratulations', 'solution accepted',
    'passed', 'solved successfully',
  ];

  const SUBMISSION_SELECTORS = [
    // LeetCode
    { sel: '[data-e2e-locator="submission-result"]', match: t => t === 'Accepted' },
    // Codeforces
    { sel: '.verdict-accepted',           match: () => true },
    { sel: '.verdict',                    match: t => t.toLowerCase().includes('accepted') },
    // GeeksForGeeks — multiple possible class names
    { sel: '[class*="solved"]',           match: t => SUCCESS_PHRASES.some(p => t.toLowerCase().includes(p)) },
    { sel: '[class*="correct"]',          match: t => SUCCESS_PHRASES.some(p => t.toLowerCase().includes(p)) },
    { sel: '.problems-solved',            match: () => true },
    { sel: '.compilation-result h3',      match: t => SUCCESS_PHRASES.some(p => t.toLowerCase().includes(p)) },
    { sel: '.output-window h3',           match: t => SUCCESS_PHRASES.some(p => t.toLowerCase().includes(p)) },
    // CodeChef
    { sel: '.ac',                         match: () => true },
    // AtCoder
    { sel: 'td.accepted',                 match: () => true },
    { sel: '#result-pane .accepted',      match: () => true },
    // HackerRank
    { sel: '.result-state',               match: t => t === 'Accepted' || t === 'Passed' },
    { sel: '.status-pass',                match: () => true },
    // InterviewBit
    { sel: '.correct-solution',           match: () => true },
    // Generic
    { sel: '#result-state',               match: t => t.toLowerCase().includes('accepted') },
    { sel: '.submission-result',          match: t => t.toLowerCase().includes('accepted') },
  ];

  // Last-resort: scan all headings/paragraphs for success phrases
  function textScanForSuccess() {
    const candidates = document.querySelectorAll('h1,h2,h3,h4,p,span,div.result,div[class*="output"],div[class*="verdict"],div[class*="result"]');
    for (const el of candidates) {
      if (el.dataset.lhePushed) continue;
      // Only look at leaf-ish elements (not massive containers)
      if (el.children.length > 5) continue;
      const t = (el.textContent || '').trim().toLowerCase();
      if (t.length > 100) continue; // skip long paragraphs
      if (SUCCESS_PHRASES.some(p => t.includes(p))) {
        el.dataset.lhePushed = '1';
        return true;
      }
    }
    return false;
  }

  let hasPushedSubmission = false; // prevents multiple pushes from polling

  function detectSubmission() {
    if (hasPushedSubmission) return;
    const url = location.href;

    // LeetCode: URL changes to /submissions/ after accept
    if (url.includes('leetcode.com') && url.includes('/submissions/') && url !== lastSubmissionUrl) {
      lastSubmissionUrl = url;
      setTimeout(() => {
        const el = document.querySelector('[data-e2e-locator="submission-result"]');
        if (el && el.textContent.trim() === 'Accepted') {
          hasPushedSubmission = true;
          onSubmissionAccepted();
        }
      }, 2500);
      return;
    }

    // Selector-based check
    for (const { sel, match } of SUBMISSION_SELECTORS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (match(el.textContent.trim())) {
        hasPushedSubmission = true;
        onSubmissionAccepted();
        return;
      }
    }

    // Text-scan fallback (catches GFG "Problem Solved Successfully" and similar)
    if (textScanForSuccess()) {
      hasPushedSubmission = true;
      onSubmissionAccepted();
    }
  }

  async function onSubmissionAccepted() {
    try {
      chrome.storage.local.get(['githubToken', 'githubUser', 'selectedRepo'], async (data) => {
        if (chrome.runtime.lastError) return;
        if (!data.githubToken || !data.selectedRepo) return;

        const pd = getPlatformData() || { platform: 'Unknown', title: document.title };
        showToast('⏳ Saving solution to GitHub...', 'info');

        // Use pre-cached code (grabbed at submit-click time) as primary source
        let code = cachedCode;
        if (!code) code = await getEditorCode();
        cachedCode = ''; // clear after use

        if (!code) {
          showToast('❌ Could not extract code. Push failed.', 'error');
          return;
        }

        pushSolutionToGitHub(data.githubToken, data.githubUser, data.selectedRepo, pd, code);
      });
    } catch (e) {
      if (e.message.includes('Extension context invalidated')) {
        showToast('⚠️ Extension updated! Please refresh the page.', 'error');
      }
    }
  }

  // ── GitHub push ────────────────────────────────────────────────────────────
  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function pushSolutionToGitHub(token, user, fullRepo, pd, code) {
    const [owner, repo] = fullRepo.split('/');
    const date = new Date().toISOString().slice(0, 10);
    const fileName = slugify(pd.title) + '.md';
    const filePath = `solutions/${slugify(pd.platform)}/${fileName}`;

    const content = `# ${pd.title}

**Platform:** ${pd.platform}  
**Date:** ${date}  

## Solution

\`\`\`
${code}
\`\`\`
`;

    // Check if file exists (to get SHA for update)
    chrome.runtime.sendMessage(
      { type: 'GITHUB_GET_FILE', token, owner, repo, path: filePath },
      (res) => {
        if (chrome.runtime.lastError) {
          showToast(`❌ Background script error: ${chrome.runtime.lastError.message}`, 'error');
          return;
        }
        
        const sha = res?.sha || null;
        chrome.runtime.sendMessage(
          {
            type: 'GITHUB_PUSH_FILE',
            token, owner, repo,
            path: filePath,
            content,
            message: `Add solution: ${pd.title} (${pd.platform})`,
            sha,
          },
          (pushRes) => {
            if (chrome.runtime.lastError) {
              showToast(`❌ Background script error: ${chrome.runtime.lastError.message}`, 'error');
              return;
            }
            if (pushRes?.success) {
              showToast(`✅ Solution saved to ${fullRepo}`, 'success');
            } else {
              showToast(`❌ GitHub push failed: ${pushRes?.error || 'unknown error'}`, 'error');
            }
          }
        );
      }
    );
  }

  // ── Panel ──────────────────────────────────────────────────────────────────
  function closePanel() {
    const panel = document.getElementById('lhe-panel');
    if (!panel) return;
    panel.classList.remove('lhe-panel--open');
    panel.addEventListener('transitionend', () => panel.remove(), { once: true });
  }

  function openPanel({ state, title = '', hints = null, activeHint = 1, errorType = '' }) {
    let panel = document.getElementById('lhe-panel');
    const isNew = !panel;
    if (isNew) {
      panel = document.createElement('div');
      panel.id = 'lhe-panel';
      panel.setAttribute('role', 'complementary');
      document.body.appendChild(panel);
      makeDraggable(panel);
    }

    panel.innerHTML = buildPanelHTML(state, title, hints, activeHint, errorType);
    panel.querySelector('#lhe-panel-close').addEventListener('click', closePanel);

    if (state === 'hints') {
      const nextBtn = panel.querySelector('#lhe-next-btn');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          currentHintIndex = Math.min(currentHintIndex + 1, 3);
          openPanel({ state: 'hints', title, hints, activeHint: currentHintIndex });
        });
      }
    }
    if (state === 'error') {
      panel.querySelector('#lhe-retry-btn')?.addEventListener('click', onHintClick);
    }

    if (isNew) requestAnimationFrame(() => panel.classList.add('lhe-panel--open'));
  }

  function buildPanelHTML(state, title, hints, activeHint, errorType) {
    const titleHtml = title ? `<p class="lhe-panel-problem">${esc(title)}</p>` : '';
    let body = '';
    if (state === 'loading') {
      body = `<div class="lhe-loader"><div class="lhe-spinner"></div><span>Generating hints…</span></div>`;
    } else if (state === 'error') {
      body = `<div class="lhe-error">${buildErrorHTML(errorType)}</div>`;
    } else if (state === 'hints') {
      body = buildHintsHTML(hints, activeHint, title);
    }
    return `
      <div class="lhe-panel-header" id="lhe-panel-drag-handle">
        <span class="lhe-panel-title"><span class="lhe-panel-logo">💡</span> Hint Engine</span>
        <button id="lhe-panel-close" aria-label="Close">✕</button>
      </div>
      ${titleHtml}
      <div class="lhe-panel-body">${body}</div>`;
  }

  function buildHintsHTML(hints, activeHint, title) {
    const defs = [
      { num: 1, icon: '🧭', label: 'Approach Direction', text: hints.hint1, cls: 'lhe-hint--1' },
      { num: 2, icon: '🏗️', label: 'Data Structure',     text: hints.hint2, cls: 'lhe-hint--2' },
      { num: 3, icon: '📝', label: 'Pseudocode',          text: hints.hint3, cls: 'lhe-hint--3' },
    ];
    const cards = defs.map(({ num, icon, label, text, cls }) => {
      if (num > activeHint) return '';
      return `
        <div class="lhe-hint ${cls} lhe-hint--visible ${num === activeHint ? 'lhe-hint--animate' : ''}">
          <div class="lhe-hint-header">
            <span class="lhe-hint-badge">Hint ${num}</span>
            <span class="lhe-hint-label">${icon} ${esc(label)}</span>
          </div>
          <p class="lhe-hint-text">${esc(text)}</p>
        </div>`;
    }).join('');

    const pd = getPlatformData();
    const searchTitle = title || pd?.title || document.title;
    const searchPlatform = pd?.platform || '';
    const ytQuery = encodeURIComponent(`${searchTitle} ${searchPlatform} solution explanation`.trim());
    const yt = `https://www.youtube.com/results?search_query=${ytQuery}`;

    const footer = activeHint < 3
      ? `<button class="lhe-next-btn" id="lhe-next-btn">Next Hint →</button>`
      : `<div class="lhe-done-msg">
           <span class="lhe-done-icon">✅</span>
           <p>Try it now!<br><span class="lhe-done-sub">Still stuck? <a class="lhe-walkthrough-link" href="${yt}" target="_blank">Find a walkthrough ↗</a></span></p>
         </div>`;

    return `<div class="lhe-hints-list">${cards}</div><div class="lhe-panel-footer">${footer}</div>`;
  }

  function buildErrorHTML(type) {
    const map = {
      no_key:      { icon: '🔑', title: 'No API Key',           body: 'Click the extension icon, select an AI provider and save your API key.' },
      rate_limit:  { icon: '⏳', title: 'Rate Limit Hit',       body: "You've hit the API rate limit. Wait a moment and try again." },
      parse_error: { icon: '⚠️', title: 'Unexpected Response',  body: 'AI returned a response we could not parse. Try again.' },
      incomplete:  { icon: '⚠️', title: 'Incomplete Hints',     body: 'AI response was missing some hints. Try again.' },
      network:     { icon: '📡', title: 'Connection Error',      body: 'Could not reach the AI provider. Check your internet connection.' },
    };
    const { icon, title, body } = map[type] || { icon: '❌', title: 'Something Went Wrong', body: esc(type) };
    return `
      <div class="lhe-error-icon">${icon}</div>
      <p class="lhe-error-title">${esc(title)}</p>
      <p class="lhe-error-body">${body}</p>
      <button class="lhe-retry-btn" id="lhe-retry-btn">Try Again</button>`;
  }

  // ── Draggable ──────────────────────────────────────────────────────────────
  function makeDraggable(panel) {
    let dragging = false, startX, startY, startLeft, startTop;
    panel.addEventListener('mousedown', (e) => {
      const handle = document.getElementById('lhe-panel-drag-handle');
      if (!handle?.contains(e.target) || e.target.id === 'lhe-panel-close') return;
      const rect = panel.getBoundingClientRect();
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.left = `${rect.left}px`; panel.style.top = `${rect.top}px`;
      dragging = true; startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      panel.classList.add('lhe-panel--dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = `${startLeft + e.clientX - startX}px`;
      panel.style.top  = `${startTop  + e.clientY - startY}px`;
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; panel.classList.remove('lhe-panel--dragging');
    });
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(message, type = 'info') {
    const existing = document.getElementById('lhe-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'lhe-toast';
    toast.className = `lhe-toast lhe-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('lhe-toast--visible'));
    setTimeout(() => {
      toast.classList.remove('lhe-toast--visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 4000);
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Cache code on submit click + poll for result on AJAX platforms ───────────
  function listenForSubmitClicks() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('button, [role="button"], input[type="submit"]');
      if (!btn) return;

      const label = (
        btn.textContent || btn.innerText ||
        btn.getAttribute('aria-label') || btn.value || ''
      ).toLowerCase().trim();

      // Match: "Submit", "Submit Code", "Submit Solution", "Run & Submit", etc.
      const isSubmit = label === 'submit' ||
                       label.includes('submit') ||
                       (btn.id || '').toLowerCase().includes('submit');
      if (!isSubmit) return;

      // 1. Cache the code immediately while editor is still on screen
      const code = await getEditorCode();
      if (code) cachedCode = code;

      // Reset the push lock so a new submission can trigger a GitHub push
      hasPushedSubmission = false;

      // 2. For AJAX platforms (non-LeetCode), start polling for the result
      //    because there's no URL change to detect
      if (!location.hostname.includes('leetcode.com')) {
        startSuccessPolling();
      }
    }, true); // capture phase
  }

  function startSuccessPolling() {
    if (submitPollInterval) clearInterval(submitPollInterval);
    let attempts = 0;
    submitPollInterval = setInterval(() => {
      attempts++;
      if (attempts > 60) { // stop after 60 seconds
        clearInterval(submitPollInterval);
        submitPollInterval = null;
        return;
      }
      detectSubmission();
    }, 1000);
  }

  // ── Injection & SPA routing ────────────────────────────────────────────────
  function waitAndInject() {
    injectHintButton();
    setTimeout(injectHintButton, 1000);
    setTimeout(injectHintButton, 2500);
    setTimeout(injectHintButton, 5000);  // for slow React apps like GFG/HackerRank
    setTimeout(injectHintButton, 8000);  // last-resort retry
  }

  waitAndInject();
  listenForSubmitClicks();

  // Watch for SPA navigations and submission URL changes
  let lastPath = location.pathname;
  new MutationObserver(() => {
    detectSubmission();
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      closePanel();
      setTimeout(injectHintButton, 1500);
      setTimeout(injectHintButton, 3000);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();

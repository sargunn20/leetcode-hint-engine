// popup.js — LeetCode Hint Engine

// ── Provider config ────────────────────────────────────────────────────────
const PROVIDERS = {
  groq:   { label: 'Groq API Key',      placeholder: 'gsk_••••••••••••••••••••••••',     link: 'https://console.groq.com/keys',                    linkText: 'console.groq.com ↗' },
  gemini: { label: 'Gemini API Key',    placeholder: 'AIza••••••••••••••••••••••••••',   link: 'https://aistudio.google.com/app/apikey',           linkText: 'Google AI Studio ↗' },
  openai: { label: 'OpenAI API Key',    placeholder: 'sk-••••••••••••••••••••••••••',    link: 'https://platform.openai.com/api-keys',             linkText: 'platform.openai.com ↗' },
  claude: { label: 'Anthropic API Key', placeholder: 'sk-ant-••••••••••••••••••••••',   link: 'https://console.anthropic.com/account/keys',       linkText: 'console.anthropic.com ↗' },
  cohere: { label: 'Cohere API Key',    placeholder: '••••••••••••••••••••••••••••••',  link: 'https://dashboard.cohere.com/api-keys',            linkText: 'dashboard.cohere.com ↗' },
};

// ── Elements ───────────────────────────────────────────────────────────────
const providerSelect      = document.getElementById('providerSelect');
const apiKeyInput         = document.getElementById('apiKeyInput');
const apiKeyLabel         = document.getElementById('apiKeyLabel');
const apiKeyLink          = document.getElementById('apiKeyLink');
const toggleVis           = document.getElementById('toggleVis');
const eyeOn               = document.getElementById('eyeOn');
const eyeOff              = document.getElementById('eyeOff');
const saveBtn             = document.getElementById('saveBtn');
const saveConfirm         = document.getElementById('saveConfirm');
const githubClientIdInput = document.getElementById('githubClientId');
const redirectUriDisplay  = document.getElementById('redirectUriDisplay');
const copyUriBtn          = document.getElementById('copyUriBtn');
const githubConnectBtn    = document.getElementById('githubConnectBtn');
const githubDisconnectBtn = document.getElementById('githubDisconnectBtn');
const ghNotConnected      = document.getElementById('ghNotConnected');
const ghConnected         = document.getElementById('ghConnected');
const ghAvatar            = document.getElementById('ghAvatar');
const ghUsername          = document.getElementById('ghUsername');
const repoSelect          = document.getElementById('repoSelect');
const saveRepoBtn         = document.getElementById('saveRepoBtn');
const repoConfirm         = document.getElementById('repoConfirm');
const helpBtn             = document.getElementById('helpBtn');
const closeHelpBtn        = document.getElementById('closeHelpBtn');
const helpModal           = document.getElementById('helpModal');

let saveConfirmTimer = null;
let repoConfirmTimer = null;

// ── Help Modal ─────────────────────────────────────────────────────────────
helpBtn.addEventListener('click', () => helpModal.classList.add('open'));
closeHelpBtn.addEventListener('click', () => helpModal.classList.remove('open'));

// ── Init ───────────────────────────────────────────────────────────────────
chrome.storage.local.get(
  ['aiProvider', 'apiKey', 'githubClientId', 'githubToken', 'githubUser', 'selectedRepo'],
  (data) => {
    // Provider + key
    const provider = data.aiProvider || 'groq';
    providerSelect.value = provider;
    updateProviderUI(provider);
    if (data.apiKey) apiKeyInput.value = data.apiKey;

    // GitHub client ID
    if (data.githubClientId) githubClientIdInput.value = data.githubClientId;

    // GitHub connected state
    if (data.githubToken && data.githubUser) {
      showGhConnected(data.githubUser, data.selectedRepo);
    }
  }
);

// Show redirect URI (needed for OAuth App setup)
redirectUriDisplay.textContent = chrome.identity.getRedirectURL();

// ── Provider UI ────────────────────────────────────────────────────────────
function updateProviderUI(provider) {
  const cfg = PROVIDERS[provider];
  apiKeyLabel.textContent = cfg.label;
  apiKeyInput.placeholder = cfg.placeholder;
  apiKeyLink.href = cfg.link;
  apiKeyLink.textContent = cfg.linkText;
}

providerSelect.addEventListener('change', () => updateProviderUI(providerSelect.value));

// ── Save API Key ───────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) { flashError(apiKeyInput); return; }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  chrome.storage.local.set({ aiProvider: providerSelect.value, apiKey: key }, () => {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save API Key';
    flashConfirm(saveConfirm, saveConfirmTimer, t => saveConfirmTimer = t);
  });
});

// ── Toggle key visibility ──────────────────────────────────────────────────
toggleVis.addEventListener('click', () => {
  const hidden = apiKeyInput.type === 'password';
  apiKeyInput.type = hidden ? 'text' : 'password';
  eyeOn.style.display  = hidden ? 'none'  : 'block';
  eyeOff.style.display = hidden ? 'block' : 'none';
});

// ── Copy redirect URI ──────────────────────────────────────────────────────
copyUriBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(redirectUriDisplay.textContent).then(() => {
    copyUriBtn.textContent = 'Copied!';
    setTimeout(() => (copyUriBtn.textContent = 'Copy'), 1500);
  });
});

// ── GitHub OAuth ───────────────────────────────────────────────────────────
githubConnectBtn.addEventListener('click', () => {
  const clientId = githubClientIdInput.value.trim();
  if (!clientId) { flashError(githubClientIdInput); return; }

  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl =
    `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,read:user`;

  // We need the client secret to exchange the code. Prompt the user.
  const clientSecret = prompt(
    'Enter your GitHub OAuth App Client Secret\n(needed once to exchange the auth code for a token):'
  );
  if (!clientSecret) return;

  chrome.storage.local.set({ githubClientId: clientId });

  githubConnectBtn.disabled = true;
  githubConnectBtn.textContent = 'Connecting…';

  chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
    if (chrome.runtime.lastError || !responseUrl) {
      githubConnectBtn.disabled = false;
      githubConnectBtn.innerHTML = '⚠️ Auth failed — try again';
      return;
    }

    const code = new URL(responseUrl).searchParams.get('code');
    if (!code) {
      githubConnectBtn.disabled = false;
      githubConnectBtn.textContent = '⚠️ No code received';
      return;
    }

    // Exchange code via background (bypasses CORS)
    chrome.runtime.sendMessage(
      { type: 'GITHUB_TOKEN_EXCHANGE', clientId, clientSecret, code, redirectUri },
      (res) => {
        if (!res?.success || !res.data?.access_token) {
          githubConnectBtn.disabled = false;
          githubConnectBtn.textContent = '⚠️ Token exchange failed';
          return;
        }
        const token = res.data.access_token;
        // Fetch user info
        chrome.runtime.sendMessage({ type: 'GITHUB_GET_USER', token }, (userRes) => {
          if (!userRes?.success) return;
          const user = userRes.data;
          const userData = { login: user.login, avatar_url: user.avatar_url };
          chrome.storage.local.set({ githubToken: token, githubUser: userData }, () => {
            showGhConnected(userData, null);
            fetchRepos(token);
          });
        });
      }
    );
  });
});

// ── Disconnect GitHub ──────────────────────────────────────────────────────
githubDisconnectBtn.addEventListener('click', () => {
  chrome.storage.local.remove(['githubToken', 'githubUser', 'selectedRepo'], () => {
    ghConnected.style.display = 'none';
    ghNotConnected.style.display = 'flex';
    githubConnectBtn.disabled = false;
    githubConnectBtn.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg> Connect GitHub';
  });
});

// ── Show connected state ───────────────────────────────────────────────────
function showGhConnected(user, selectedRepo) {
  ghNotConnected.style.display = 'none';
  ghConnected.style.display = 'flex';
  ghAvatar.src = user.avatar_url;
  ghUsername.textContent = user.login;

  // Pre-select saved repo (repos may not be loaded yet)
  if (selectedRepo) {
    const opt = document.createElement('option');
    opt.value = selectedRepo;
    opt.textContent = selectedRepo;
    opt.selected = true;
    repoSelect.innerHTML = '';
    repoSelect.appendChild(opt);
  }

  // Fetch fresh repo list
  chrome.storage.local.get('githubToken', ({ githubToken }) => {
    if (githubToken) fetchRepos(githubToken, selectedRepo);
  });
}

// ── Fetch repos ────────────────────────────────────────────────────────────
function fetchRepos(token, selectedRepo) {
  repoSelect.innerHTML = '<option value="">Loading…</option>';
  chrome.runtime.sendMessage({ type: 'GITHUB_LIST_REPOS', token }, (res) => {
    if (!res?.success || !Array.isArray(res.data)) {
      repoSelect.innerHTML = '<option value="">⚠️ Failed to load repos</option>';
      return;
    }
    repoSelect.innerHTML = '<option value="">— select a repo —</option>';
    res.data.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.full_name;
      opt.textContent = r.full_name;
      if (r.full_name === selectedRepo) opt.selected = true;
      repoSelect.appendChild(opt);
    });
  });
}

// ── Save repo ──────────────────────────────────────────────────────────────
saveRepoBtn.addEventListener('click', () => {
  const repo = repoSelect.value;
  if (!repo) return;
  chrome.storage.local.set({ selectedRepo: repo }, () => {
    flashConfirm(repoConfirm, repoConfirmTimer, t => repoConfirmTimer = t);
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────
function flashConfirm(el, timer, setTimer) {
  el.classList.add('show');
  if (timer) clearTimeout(timer);
  setTimer(setTimeout(() => el.classList.remove('show'), 2500));
}

function flashError(input) {
  input.style.borderColor = '#f85149';
  input.style.boxShadow = '0 0 0 3px rgba(248,81,73,.15)';
  input.focus();
  setTimeout(() => { input.style.borderColor = ''; input.style.boxShadow = ''; }, 1800);
}

apiKeyInput.addEventListener('input', () => {
  apiKeyInput.style.borderColor = '';
  apiKeyInput.style.boxShadow = '';
});

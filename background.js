// background.js — LeetCode Hint Engine service worker
// Handles GitHub API calls (bypasses CORS restrictions in popup/content)

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ── Execute script in MAIN world to extract editor code ────────────────────
  if (request.type === 'GET_CODE') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => {
        try {
          if (window.monaco && window.monaco.editor) {
            const editors = window.monaco.editor.getEditors();
            if (editors.length > 0) return editors[0].getValue();
          }
          if (document.querySelector('.CodeMirror') && document.querySelector('.CodeMirror').CodeMirror) {
            return document.querySelector('.CodeMirror').CodeMirror.getValue();
          }
          if (window.ace && document.querySelector('.ace_editor')) {
            return window.ace.edit(document.querySelector('.ace_editor')).getValue();
          }
        } catch (e) { }
        return '';
      }
    }).then(results => {
      sendResponse({ code: results && results[0] ? results[0].result : '' });
    }).catch(() => {
      sendResponse({ code: '' });
    });
    return true;
  }

  // ── GitHub OAuth: exchange code for access token ───────────────────────────
  if (request.type === 'GITHUB_TOKEN_EXCHANGE') {
    fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: request.clientId,
        client_secret: request.clientSecret,
        code: request.code,
        redirect_uri: request.redirectUri,
      }),
    })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async
  }

  // ── GitHub: fetch user info ────────────────────────────────────────────────
  if (request.type === 'GITHUB_GET_USER') {
    fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${request.token}` },
    })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ── GitHub: list repos ────────────────────────────────────────────────────
  if (request.type === 'GITHUB_LIST_REPOS') {
    fetch('https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner', {
      headers: { Authorization: `Bearer ${request.token}` },
    })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ── GitHub: get file SHA (needed for updates) ─────────────────────────────
  if (request.type === 'GITHUB_GET_FILE') {
    const { token, owner, repo, path } = request;
    fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.status === 404 ? { sha: null } : r.json())
      .then(data => sendResponse({ success: true, sha: data.sha || null }))
      .catch(() => sendResponse({ success: true, sha: null }));
    return true;
  }

  // ── GitHub: create or update file ─────────────────────────────────────────
  if (request.type === 'GITHUB_PUSH_FILE') {
    const { token, owner, repo, path, content, message, sha } = request;
    // base64-encode content (handle Unicode safely)
    const encoded = btoa(unescape(encodeURIComponent(content)));
    const body = { message, content: encoded };
    if (sha) body.sha = sha;

    fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(data => sendResponse({ success: !data.message, data, error: data.message }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});

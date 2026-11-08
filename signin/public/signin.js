'use strict';
// The shared sign-in page. One page, five screens: sign in, change password, choose an app, sign out, signed out.
(() => {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const query = (() => { const q = new URLSearchParams(); for (const k of ['app', 'return']) if (params.get(k)) q.set(k, params.get(k)); const s = q.toString(); return s ? '?' + s : ''; })();
  const SCREENS = ['loading', 'signin', 'change', 'launcher', 'signout', 'signedout'];
  let state = null;

  function show(id) {
    for (const s of SCREENS) $(s).hidden = s !== id;
    const focus = $(id).querySelector('input, .primary');
    if (focus && id !== 'loading') focus.focus();
  }

  async function api(path, body) {
    const res = await fetch('/api' + path, body === undefined ? {credentials: 'same-origin'} : {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', ...(state?.signedIn ? {'X-CSRF-Token': state.signedIn.csrf} : {})},
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }

  function brand() {
    const app = state.app, root = document.documentElement.style;
    const name = app ? app.name : state.suiteName;
    root.setProperty('--accent', app ? app.accent : '#16222c');
    root.setProperty('--accent-ink', app ? app.accentInk : '#f8f9f5');
    $('brand-mark').textContent = app ? app.mark : state.suiteMark;
    $('suite-name').textContent = app ? state.suiteName : '';
    $('suite-name').hidden = !app;
    $('app-name').textContent = name;
    $('app-tagline').textContent = app ? app.tagline : 'Sign in once for every app your firm uses.';
    $('signin-title').textContent = app ? `Sign in to ${app.name}` : 'Sign in';
    document.title = app ? `Sign in · ${app.name}` : `Sign in · ${state.suiteName}`;
    $('suite-apps').replaceChildren(...state.allApps.map(a => {
      const li = document.createElement('li'), mark = document.createElement('span');
      mark.textContent = a.mark; li.append(mark, a.name);
      if (app && a.id === app.id) li.setAttribute('aria-current', 'true');
      return li;
    }));
    $('footer').textContent = `${state.suiteName} · One account for ${state.allApps.map(a => a.name).join(', ').replace(/, ([^,]*)$/, ' and $1')}`;
    for (const a of ['signedout-again', 'signout-cancel']) $(a).href = '/' + query;
    $('change-cancel').querySelector('a').href = '/' + query;
  }

  function go(url) { location.assign(url); }

  // An app sends people here when it can't see their session. If we bounce straight back and the app still
  // can't see it (wrong cookie domain), stop after one try instead of looping.
  function redirectOnce(url) {
    const key = 'signin-redirect', last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < 15000) return false;
    sessionStorage.setItem(key, String(Date.now()));
    go(url); return true;
  }

  function launcher(notice) {
    const s = state.signedIn;
    $('launcher-who').textContent = `Signed in as ${s.displayName ? s.displayName + ' (' + s.email + ')' : s.email}.`;
    $('launcher-notice').textContent = notice || '';
    $('launcher-notice').hidden = !notice;
    $('launcher-empty').hidden = s.apps.length > 0;
    $('launcher-apps').replaceChildren(...s.apps.map(a => {
      const li = document.createElement('li'), link = document.createElement('a'), mark = document.createElement('span'), text = document.createElement('span');
      const title = document.createElement('strong'), sub = document.createElement('small');
      link.href = a.homeUrl;
      mark.className = 'tile-mark'; mark.textContent = a.mark;
      mark.style.setProperty('background', a.accent); mark.style.setProperty('color', a.accentInk);
      title.textContent = a.name;
      sub.textContent = a.tenants.length > 1 ? `${a.tenants.length} firms` : (a.tenants[0] || a.tagline);
      text.append(title, sub); link.append(mark, text); li.append(link);
      return li;
    }));
    show('launcher');
  }

  function route() {
    brand();
    const s = state.signedIn, page = location.pathname;
    if (page === '/signout') return show(s ? 'signout' : 'signedout');
    if (s && (s.mustChangePassword || page === '/password')) {
      $('change-intro').textContent = s.mustChangePassword
        ? 'You signed in with a temporary password. Choose your own to carry on.'
        : 'This changes your password for every app.';
      $('change-cancel').hidden = s.mustChangePassword;
      return show('change');
    }
    if (s && state.app && s.canOpenApp) {
      if (redirectOnce(state.returnTo || state.app.homeUrl)) return;
      return launcher(`${state.app.name} didn't recognise your sign-in. Try opening it below; if this keeps happening, tell your administrator.`);
    }
    if (s) return launcher(state.app ? `Your account doesn't open ${state.app.name}. Ask your firm's administrator if you need it.` : '');
    show('signin');
  }

  async function load() {
    state = await api('/state' + query);
    route();
  }

  function busy(form, fn) {
    return async e => {
      e.preventDefault();
      const error = form.querySelector('.error'), button = form.querySelector('button[type=submit]');
      error.hidden = true; button.disabled = true;
      try { await fn(); } catch (err) { error.textContent = err.message; error.hidden = false; button.disabled = false; }
    };
  }

  $('signin-form').addEventListener('submit', busy($('signin-form'), async () => {
    const email = $('email').value.trim(), password = $('password').value;
    if (!email || !password) throw new Error('Enter your email and password.');
    const r = await api('/login', {email, password, app: params.get('app') || '', return: params.get('return') || ''});
    $('password').value = '';
    if (r.next) return go(r.next);
    await load();
  }));

  $('change-form').addEventListener('submit', busy($('change-form'), async () => {
    const current = $('current').value, next = $('new').value, again = $('again').value;
    if (!current) throw new Error('Enter your current password.');
    if (next.length < state.passwordMin) throw new Error(`Use at least ${state.passwordMin} characters.`);
    if (next !== again) throw new Error('The two new passwords are different.');
    const r = await api('/password', {currentPassword: current, newPassword: next, app: params.get('app') || '', return: params.get('return') || ''});
    for (const id of ['current', 'new', 'again']) $(id).value = '';
    if (r.next) return go(r.next);
    if (location.pathname === '/password') history.replaceState(null, '', '/' + query);
    await load();
    if (!$('launcher').hidden) { $('launcher-notice').textContent = 'Password changed.'; $('launcher-notice').hidden = false; }
  }));

  async function signOut(errorBox) {
    try { await api('/logout', {}); state.signedIn = null; history.replaceState(null, '', '/signout' + query); show('signedout'); }
    catch (err) { if (errorBox) { errorBox.textContent = err.message; errorBox.hidden = false; } }
  }
  $('signout-confirm').addEventListener('click', () => signOut($('signout').querySelector('.error')));
  $('launcher-signout').addEventListener('click', () => signOut(null));
  $('launcher-password').addEventListener('click', e => {
    e.preventDefault(); history.pushState(null, '', '/password' + query); route();
  });
  window.addEventListener('popstate', route);

  document.querySelector('.reveal').addEventListener('click', e => {
    const input = $('password'), shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    e.currentTarget.textContent = shown ? 'Show' : 'Hide';
    e.currentTarget.setAttribute('aria-pressed', String(!shown));
  });

  $('new-hint').textContent = 'At least 12 characters. A short sentence is easy to remember.';
  load().then(() => { if (state) $('new-hint').textContent = `At least ${state.passwordMin} characters. A short sentence is easy to remember.`; })
    .catch(err => { $('loading').querySelector('p').textContent = err.message; });
})();

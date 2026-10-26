(function () {
  'use strict';

  var ADM = window.ADM;
  var ai = ADM.ai;

  var STORAGE = {
    history: 'adm.qa.history'
  };
  var MAX_HISTORY = 20;
  var TAB_NAMES = ['home', 'clubs', 'news', 'services', 'qa'];

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }
  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* private browsing: keep working without persistence */
    }
  }
  function formatDate(value, withYear) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', withYear
      ? { day: 'numeric', month: 'short', year: 'numeric' }
      : { day: 'numeric', month: 'short' });
  }

  /* ---------------------------------------------------------------- toast */

  var toastStack = $('#toast-stack');
  function toast(message, tone) {
    if (!toastStack) return;
    var previous = toastStack.lastElementChild;
    if (previous && previous.textContent === message) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (tone || 'info');
    el.textContent = message;
    toastStack.appendChild(el);
    setTimeout(function () {
      el.classList.add('leaving');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 240);
    }, 4200);
  }

  /* ----------------------------------------------------------------- tabs */

  var tabButtons = $$('.tab');
  var tabPanels = {};

  TAB_NAMES.forEach(function (name) {
    tabPanels[name] = $('#panel-' + name);
  });

  function tabFromHash() {
    var hash = location.hash.replace(/^#/, '').trim();
    return TAB_NAMES.indexOf(hash) >= 0 ? hash : 'home';
  }

  function activateTab(name, options) {
    if (TAB_NAMES.indexOf(name) < 0) name = 'home';

    tabButtons.forEach(function (btn) {
      var active = btn.dataset.tab === name;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
      btn.classList.toggle('is-active', active);
    });

    TAB_NAMES.forEach(function (key) {
      var panel = tabPanels[key];
      if (panel) panel.hidden = key !== name;
    });

    if (!options || options.updateHash !== false) {
      var hash = '#' + name;
      if (location.hash !== hash) {
        try {
          history.replaceState(null, '', hash);
        } catch (err) {
          location.hash = hash;
        }
      }
    }

    if (options && options.focusPanel && tabPanels[name]) {
      tabPanels[name].focus({ preventScroll: true });
    }
  }

  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      activateTab(btn.dataset.tab);
      if (btn.dataset.tab === 'qa') showQAList(false);
    });

    btn.addEventListener('keydown', function (event) {
      var index = TAB_NAMES.indexOf(btn.dataset.tab);
      var next = null;
      if (event.key === 'ArrowRight') next = (index + 1) % TAB_NAMES.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + TAB_NAMES.length) % TAB_NAMES.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = TAB_NAMES.length - 1;
      if (next === null) return;
      event.preventDefault();
      var target = tabButtons[next];
      activateTab(target.dataset.tab);
      if (target.dataset.tab === 'qa') showQAList(false);
      target.focus();
    });
  });

  window.addEventListener('hashchange', function () {
    var hash = location.hash.replace(/^#/, '').trim();
    if (TAB_NAMES.indexOf(hash) >= 0) activateTab(hash, { updateHash: false });
  });

  /* ---------------------------------------------------------------- auth */

  var authForm = $('#auth-form');
  var accountPanel = $('#account-panel');
  var accountName = $('#account-name');
  var emailInput = $('#auth-email');
  var passwordInput = $('#auth-password');
  var repeatInput = $('#auth-password2');
  var repeatLabel = $('#auth-repeat-label');
  var repeatField = $('#auth-repeat-field');
  var loginButton = $('#auth-login');
  var signupButton = $('#auth-signup');
  var switchButton = $('#auth-switch');
  var logoutButton = $('#auth-logout');
  var formError = $('#auth-form-error');

  var authMode = 'login';
  var authBusy = false;

  function fieldError(input, message) {
    if (!input) return;
    var describedBy = input.getAttribute('aria-describedby');
    var errorEl = describedBy ? document.getElementById(describedBy) : null;
    if (errorEl) {
      errorEl.textContent = message || '';
      errorEl.hidden = !message;
    }
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }

  function setFormError(message) {
    if (!formError) return;
    formError.textContent = message || '';
    formError.hidden = !message;
  }

  function setAuthMode(mode) {
    authMode = mode;
    var signup = mode === 'signup';
    repeatLabel.hidden = !signup;
    repeatField.hidden = !signup;
    repeatInput.disabled = !signup;
    loginButton.hidden = signup;
    switchButton.hidden = !signup;
    signupButton.setAttribute('aria-pressed', signup ? 'true' : 'false');
    signupButton.classList.toggle('is-active', signup);
    passwordInput.autocomplete = signup ? 'new-password' : 'current-password';
    setFormError('');
    fieldError(repeatInput, '');
  }

  function setAuthBusy(busy) {
    authBusy = busy;
    loginButton.disabled = busy;
    signupButton.disabled = busy;
    switchButton.disabled = busy;
    loginButton.textContent = busy && authMode === 'login' ? 'Logging in…' : 'Login';
    signupButton.textContent = busy && authMode === 'signup' ? 'Signing up…' : 'Sign Up';
  }

  function validateAuth(mode) {
    var email = emailInput.value.trim();
    var password = passwordInput.value;
    var ok = true;

    if (!email) {
      fieldError(emailInput, 'Enter your email address.');
      ok = false;
    } else if (!isEmail(email)) {
      fieldError(emailInput, 'Enter a valid email address.');
      ok = false;
    } else {
      fieldError(emailInput, '');
    }

    if (mode === 'signup') {
      if (password.length < 8) {
        fieldError(passwordInput, 'Use at least 8 characters.');
        ok = false;
      } else {
        fieldError(passwordInput, '');
      }
      if (repeatInput.value !== password) {
        fieldError(repeatInput, 'Passwords do not match.');
        ok = false;
      } else {
        fieldError(repeatInput, '');
      }
    } else if (!password) {
      fieldError(passwordInput, 'Enter your password.');
      ok = false;
    } else {
      fieldError(passwordInput, '');
    }

    return ok;
  }

  function authErrorMessage(err) {
    if (!err) return 'Something went wrong. Please try again.';
    if (err.code === 'offline') {
      return 'Cannot reach the account service. Start the local server (npm start) and try again.';
    }
    if (err.code === 'invalid_credentials') return 'Wrong email or password.';
    if (err.code === 'email_taken') return 'That email is already registered — try logging in.';
    if (err.code === 'invalid_email') return 'Enter a valid email address.';
    if (err.code === 'invalid_password') return 'Use a password with at least 8 characters.';
    return err.message || 'Something went wrong. Please try again.';
  }

  var feed = { items: [], total: 0, loaded: false, loading: false, error: false, pendingReset: false };

  function loadFeed(reset, options) {
    if (feed.loading) {
      // A sign-in can land while the first page is still in flight; remember to
      // reload so the `mine` labels match the new session.
      if (reset) feed.pendingReset = true;
      return;
    }
    var opts = options || {};
    feed.loading = true;
    var offset = reset ? 0 : feed.items.length;
    var quiet = Boolean(opts.quiet);

    ADM.auth.listQuestions({ offset: offset }).then(function (page) {
      feed.items = (reset ? [] : feed.items).concat(page.questions);
      feed.total = page.total;
      feed.loaded = true;
      feed.error = false;
      feed.loading = false;
      renderQAList();
      renderHome();
      runPendingReset();
    }).catch(function (err) {
      feed.loading = false;
      feed.error = true;
      renderQAList();
      runPendingReset();
      if (quiet || (err && err.code === 'invalid_session')) return;
      toast('Could not load the shared questions. Check the connection to the account service.', 'error');
    });
  }

  function runPendingReset() {
    if (!feed.pendingReset) return;
    feed.pendingReset = false;
    loadFeed(true, { quiet: true });
  }

  var appliedUserId;

  function applyAccount(user) {
    var signedIn = Boolean(user);
    authForm.hidden = signedIn;
    accountPanel.hidden = !signedIn;

    // AI settings follow the account when signed in, the browser otherwise.
    ai.adoptAccountSettings();

    // `mine` flags and the greeting in the answers depend on who is asking, so
    // the feed is re-read only when the identity actually changes.
    var identityChanged = appliedUserId !== (signedIn ? user.id : null);
    appliedUserId = signedIn ? user.id : null;

    if (signedIn) {
      accountName.textContent = user.username;
      accountPanel.title = user.email;
      if (identityChanged) loadFeed(true, { quiet: true });
      return;
    }

    renderQAList();
    renderHome();
    showQAList(false);
    if (identityChanged) loadFeed(true, { quiet: true });
  }

  function submitAuth(mode) {
    if (authBusy || !validateAuth(mode)) {
      var invalid = $('[aria-invalid="true"]', authForm);
      if (invalid) invalid.focus();
      return;
    }

    setAuthBusy(true);
    setFormError('');
    var email = emailInput.value.trim();
    var password = passwordInput.value;
    var action = mode === 'signup'
      ? ADM.auth.register(email, password)
      : ADM.auth.login(email, password);

    action.then(function (user) {
      setAuthBusy(false);
      passwordInput.value = '';
      repeatInput.value = '';
      setAuthMode('login');
      toast(
        mode === 'signup'
          ? 'Welcome, ' + user.username + '! Your answered questions are now saved to your account.'
          : 'Welcome back, ' + user.username + '!',
        'success'
      );
    }).catch(function (err) {
      setAuthBusy(false);
      setFormError(authErrorMessage(err));
    });
  }

  authForm.addEventListener('submit', function (event) {
    event.preventDefault();
    submitAuth(authMode);
  });

  switchButton.addEventListener('click', function () {
    setAuthMode('login');
    emailInput.focus();
  });

  signupButton.addEventListener('click', function () {
    if (authMode !== 'signup') {
      setAuthMode('signup');
      repeatInput.focus();
      return;
    }
    submitAuth('signup');
  });

  [emailInput, passwordInput, repeatInput].forEach(function (input) {
    input.addEventListener('input', function () {
      if (input.getAttribute('aria-invalid') === 'true') fieldError(input, '');
      setFormError('');
    });
  });

  logoutButton.addEventListener('click', function () {
    logoutButton.disabled = true;
    ADM.auth.logout().then(function () {
      logoutButton.disabled = false;
      emailInput.focus();
      toast('Logged out. New questions will be saved on this device only.', 'info');
    });
  });

  ADM.auth.onChange(applyAccount);

  /* ------------------------------------------------------------ data views */

  var clubsGrid = $('#clubs-grid');
  var newsList = $('#news-list');
  var servicesGrid = $('#services-grid');
  var guidelinesBody = $('#guidelines-body');

  var serviceIcons = {
    chat: '<path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9h8M8 12h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    heart: '<path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    leaf: '<path d="M20 4c-8 0-14 4-14 11a5 5 0 0 0 5 5c7 0 9-6 9-16z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 20c1-6 4-9 8-11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    shoe: '<path d="M3 15h6l3-4 4 1 5 3v3H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 11l2 2M13 12l1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
  };

  function renderClubs() {
    if (!clubsGrid) return;
    clubsGrid.innerHTML = ADM.clubs.map(function (club) {
      return (
        '<article class="item">' +
          '<span class="badge">' + escapeHtml(club.level) + '</span>' +
          '<h3>' + escapeHtml(club.name) + '</h3>' +
          '<dl class="meta">' +
            '<div><dt>When</dt><dd>' + escapeHtml(club.schedule) + '</dd></div>' +
            '<div><dt>Where</dt><dd>' + escapeHtml(club.place) + '</dd></div>' +
          '</dl>' +
          '<p>' + escapeHtml(club.blurb) + '</p>' +
          '<button class="btn primary small" type="button" data-join="' + escapeHtml(club.id) + '">Join this club</button>' +
        '</article>'
      );
    }).join('');
  }

  function renderNews() {
    if (!newsList) return;
    newsList.innerHTML = ADM.news.map(function (item) {
      return (
        '<li class="news-item">' +
          '<time datetime="' + escapeHtml(item.date) + '">' + escapeHtml(formatDate(item.date, true)) + '</time>' +
          '<h3>' + escapeHtml(item.title) + '</h3>' +
          '<p>' + escapeHtml(item.body) + '</p>' +
        '</li>'
      );
    }).join('');
  }

  function renderServices() {
    if (!servicesGrid) return;
    servicesGrid.innerHTML = ADM.services.map(function (service) {
      var icon = serviceIcons[service.icon] || serviceIcons.chat;
      return (
        '<article class="item service">' +
          '<span class="service-icon" aria-hidden="true"><svg viewBox="0 0 24 24">' + icon + '</svg></span>' +
          '<h3>' + escapeHtml(service.name) + '</h3>' +
          '<p class="item-meta">' + escapeHtml(service.meta) + '</p>' +
          '<p>' + escapeHtml(service.body) + '</p>' +
        '</article>'
      );
    }).join('');
  }

  function renderGuidelines() {
    if (!guidelinesBody) return;
    guidelinesBody.innerHTML = ADM.guidelines.map(function (section) {
      return (
        '<section class="guideline">' +
          '<h3>' + escapeHtml(section.title) + '</h3>' +
          '<ul>' + section.items.map(function (line) {
            return '<li>' + escapeHtml(line) + '</li>';
          }).join('') + '</ul>' +
        '</section>'
      );
    }).join('');
  }

  if (clubsGrid) {
    clubsGrid.addEventListener('click', function (event) {
      var button = event.target.closest('[data-join]');
      if (!button) return;

      var club = ADM.clubs.filter(function (item) {
        return item.id === button.dataset.join;
      })[0];
      var user = ADM.auth.getUser();

      if (!user) {
        toast('Log in first — clubs use your account to register you.', 'error');
        emailInput.focus();
        emailInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
        emailInput.classList.remove('pulse');
        void emailInput.offsetWidth;
        emailInput.classList.add('pulse');
        return;
      }

      button.disabled = true;
      button.textContent = 'Joined';
      toast('You are registered for ' + club.name + ', ' + user.username + '. See you there!', 'success');
    });
  }

  /* ---------------------------------------------------------------- modals */

  var settingsModal = $('#settings-modal');
  var guidelinesModal = $('#guidelines-modal');
  var lastFocused = null;

  function anyModalOpen() {
    return $$('.modal').some(function (modal) {
      return !modal.hidden;
    });
  }

  function openModal(modal) {
    if (!modal) return;
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    var target = modal.querySelector('input') || modal.querySelector('button');
    if (target) target.focus();
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    if (!anyModalOpen()) document.body.classList.remove('modal-open');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    lastFocused = null;
  }

  document.addEventListener('click', function (event) {
    var closer = event.target.closest('[data-close-modal]');
    if (closer) {
      closeModal(closer.closest('.modal'));
      return;
    }
    var guidelinesLink = event.target.closest('[data-open-guidelines]');
    if (guidelinesLink) {
      event.preventDefault();
      openModal(guidelinesModal);
    }
  });

  document.addEventListener('keydown', function (event) {
    var modal = $$('.modal').filter(function (item) {
      return !item.hidden;
    })[0];
    if (!modal) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal(modal);
      return;
    }

    if (event.key === 'Tab') {
      var focusable = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modal).filter(function (el) {
        return !el.disabled && el.offsetParent !== null;
      });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  /* -------------------------------------------------------------- settings */

  var settingsForm = $('#settings-form');
  var baseInput = $('#ai-base');
  var modelInput = $('#ai-model');
  var keyInput = $('#ai-key');
  var toggleKeyButton = $('#toggle-key');
  var hintEl = $('#settings-hint');

  function fillSettingsForm() {
    var settings = ai.loadSettings();
    baseInput.value = settings.baseUrl;
    modelInput.value = settings.model;
    keyInput.value = settings.apiKey;

    var signedIn = Boolean(ADM.auth.getUser());
    hintEl.textContent = signedIn
      ? 'Saved to your account and encrypted at rest, so it follows you to any browser you sign in from. The key is sent only to the endpoint below when you ask a question.'
      : 'Saved in this browser only. Sign in to keep these settings on your account instead, encrypted at rest. The key is sent only to the endpoint below.';
  }

  $('#open-settings').addEventListener('click', function () {
    fillSettingsForm();
    openModal(settingsModal);
    if (ADM.auth.getUser()) {
      ai.whenReady().then(fillSettingsForm);
    }
  });

  toggleKeyButton.addEventListener('click', function () {
    var reveal = keyInput.type === 'password';
    keyInput.type = reveal ? 'text' : 'password';
    toggleKeyButton.textContent = reveal ? 'Hide' : 'Show';
    toggleKeyButton.setAttribute('aria-pressed', reveal ? 'true' : 'false');
  });

  $('#clear-key').addEventListener('click', function () {
    ai.clearApiKey().then(function () {
      keyInput.value = '';
      toast(ADM.auth.getUser()
        ? 'The API key was removed from your account.'
        : 'The API key was removed from this browser.', 'info');
    }).catch(function () {
      toast('Could not remove the key. Check the connection and try again.', 'error');
    });
  });

  settingsForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var baseUrl = baseInput.value.trim();
    var model = modelInput.value.trim();
    var apiKey = keyInput.value.trim();

    if (!/^https?:\/\/.+/i.test(baseUrl)) {
      toast('Enter a full endpoint URL starting with http:// or https://.', 'error');
      baseInput.focus();
      return;
    }
    if (!model) {
      toast('Enter the model name your endpoint expects.', 'error');
      modelInput.focus();
      return;
    }

    var signedIn = Boolean(ADM.auth.getUser());
    ai.saveSettings({ baseUrl: baseUrl, model: model, apiKey: apiKey }).then(function () {
      toast(
        apiKey
          ? (signedIn ? 'AI settings saved to your account.' : 'AI settings saved for this browser.')
          : 'Settings saved. Add an API key to get new AI answers.',
        apiKey ? 'success' : 'info'
      );
      closeModal(settingsModal);
    }).catch(function (err) {
      if (err && err.code === 'schema_missing') {
        toast('The server database needs its schema applied before settings can be saved.', 'error');
        return;
      }
      toast('Could not save the settings to your account. Check the connection and try again.', 'error');
    });
  });

  /* ------------------------------------------------------------------ Q&A */

  var heroForm = $('#hero-search');
  var heroInput = $('#hero-question');
  var qaList = $('#qa-list');
  var qaListView = $('#qa-list-view');
  var answerEl = $('#qa-answer');
  var answerBody = $('#qa-answer-body');
  var backButton = $('#qa-back');
  var lastQuestionButton = null;

  function scrollToQAPanel() {
    var panel = tabPanels.qa;
    if (panel && panel.scrollIntoView) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function showQAAnswer() {
    if (!qaListView || !answerEl) return;
    qaListView.hidden = true;
    answerEl.hidden = false;
    scrollToQAPanel();
  }

  function showQAList(scrollToPanel) {
    if (!qaListView || !answerEl) return;
    answerEl.hidden = true;
    qaListView.hidden = false;
    if (scrollToPanel) scrollToQAPanel();
  }

  if (backButton) {
    backButton.addEventListener('click', function () {
      showQAList(false);
      var target = lastQuestionButton && lastQuestionButton.isConnected
        ? lastQuestionButton
        : qaList.querySelector('.qa-item');
      if (target) target.focus();
    });
  }

  var history = readJSON(STORAGE.history, []);
  if (!Array.isArray(history)) history = [];

  var activeController = null;
  var currentAnswerText = '';

  function inlineFormat(text) {
    return escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/click here/g, '<a class="inline-link" href="#guidelines" data-open-guidelines>click here</a>');
  }

  var SIGN_OFF = /^(best|kind|warm|warmest)?\s*(regards|wishes)\s*,?$/i;

  function isSignOff(line) {
    return SIGN_OFF.test(line);
  }

  function formatAnswer(text) {
    var blocks = String(text || '').trim().split(/\n{2,}/);
    return blocks.map(function (block) {
      var lines = block.split('\n').map(function (line) {
        return line.trim();
      }).filter(Boolean);
      if (!lines.length) return '';

      // A model may put "Best Regards," and "Dr. Martin" in one block or in
      // separate ones; render both with the signature in italics.
      var tail = '';
      if (lines.length >= 2 && lines[lines.length - 1] === ADM.letter.signature && isSignOff(lines[lines.length - 2])) {
        var name = lines.pop();
        var signOff = lines.pop();
        tail = '<p>' + escapeHtml(signOff) + '</p>' +
          '<p class="answer-signature">' + escapeHtml(name) + '</p>';
      } else if (lines.length === 1 && lines[0] === ADM.letter.signature) {
        return '<p class="answer-signature">' + escapeHtml(lines[0]) + '</p>';
      }
      if (!lines.length) return tail;

      var isList = lines.every(function (line) {
        return /^([-*•]|\d+[.)])\s+/.test(line);
      });
      if (isList) {
        return '<ul>' + lines.map(function (line) {
          return '<li>' + inlineFormat(line.replace(/^([-*•]|\d+[.)])\s+/, '')) + '</li>';
        }).join('') + '</ul>' + tail;
      }
      return '<p>' + inlineFormat(lines.join(' ')) + '</p>' + tail;
    }).join('');
  }

  function answerHead(question, eyebrow) {
    return (
      '<p class="answer-eyebrow">' + escapeHtml(eyebrow) + '</p>' +
      '<h3 class="answer-question">' + escapeHtml(question) + '</h3>'
    );
  }

  function bindAnswerActions(question, fallback) {
    var settingsButton = $('#answer-open-settings');
    if (settingsButton) {
      settingsButton.addEventListener('click', function () {
        fillSettingsForm();
        openModal(settingsModal);
      });
    }

    var archiveButton = $('#answer-use-archive');
    if (archiveButton && fallback) {
      archiveButton.addEventListener('click', function () {
        showAnswer({
          question: fallback.question,
          text: fallback.answer,
          eyebrow: 'From the archive',
          meta: 'Archived answer · ' + (fallback.author || 'reader')
        });
      });
    }

    var retryButton = $('#answer-retry');
    if (retryButton) {
      retryButton.addEventListener('click', function () {
        askQuestion(question);
      });
    }
  }

  function showAnswer(opts) {
    currentAnswerText = opts.text;
    showQAAnswer();
    answerBody.innerHTML =
      answerHead(opts.question, opts.eyebrow || 'Dr. Martin answers') +
      '<div class="answer-body">' + formatAnswer(opts.text) + '</div>' +
      '<div class="answer-foot"><span>' + escapeHtml(opts.meta || '') + '</span>' +
        '<button class="btn ghost small" type="button" id="copy-answer">Copy answer</button>' +
      '</div>';

    var copyButton = $('#copy-answer');
    if (copyButton) {
      copyButton.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(currentAnswerText).then(function () {
            toast('Answer copied.', 'success');
          }, function () {
            toast('Copying is not allowed in this browser.', 'error');
          });
        } else {
          toast('Copying is not available in this browser.', 'error');
        }
      });
    }
  }

  function showPending(question) {
    showQAAnswer();
    answerBody.innerHTML =
      answerHead(question, 'Your question') +
      '<div class="typing" role="status">' +
        '<span class="dot"></span><span class="dot"></span><span class="dot"></span>' +
        '<span class="typing-text">Dr. Martin is reading your question…</span>' +
      '</div>' +
      '<div class="answer-actions"><button class="btn ghost small" type="button" id="cancel-ask">Cancel</button></div>';

    var cancelButton = $('#cancel-ask');
    if (cancelButton) {
      cancelButton.addEventListener('click', function () {
        if (activeController) activeController.abort();
      });
    }
  }

  function showSetup(question, fallback) {
    showQAAnswer();
    answerBody.innerHTML =
      answerHead(question, 'Your question') +
      '<div class="notice">' +
        '<strong class="notice-title">No AI key configured yet</strong>' +
        '<span>Add an API key in AI settings and Dr. Martin can answer new questions. Archived answers work without a key.</span>' +
      '</div>' +
      '<div class="answer-actions">' +
        '<button class="btn primary small" type="button" id="answer-open-settings">Open AI settings</button>' +
        (fallback ? '<button class="btn ghost small" type="button" id="answer-use-archive">Show archived answer</button>' : '') +
      '</div>';
    bindAnswerActions(question, fallback);
  }

  function showError(question, err, fallback) {
    var info = ai.describeError(err);
    showQAAnswer();
    answerBody.innerHTML =
      answerHead(question, 'Your question') +
      '<div class="notice error">' +
        '<strong class="notice-title">' + escapeHtml(info.title) + '</strong>' +
        '<span>' + escapeHtml(info.message) + '</span>' +
      '</div>' +
      '<div class="answer-actions">' +
        (info.showSettings ? '<button class="btn primary small" type="button" id="answer-open-settings">Open AI settings</button>' : '') +
        '<button class="btn ghost small" type="button" id="answer-retry">Try again</button>' +
        (fallback ? '<button class="btn ghost small" type="button" id="answer-use-archive">Show archived answer</button>' : '') +
      '</div>';
    bindAnswerActions(question, fallback);
  }

  function pushHistory(question, answer) {
    history.unshift({
      id: 'h-' + Date.now(),
      question: question,
      answer: answer,
      at: new Date().toISOString()
    });
    history = history.slice(0, MAX_HISTORY);
    writeJSON(STORAGE.history, history);
    renderQAList();
    renderHome();
  }

  function recordAnswer(question, answer) {
    if (!ADM.auth.getUser()) {
      pushHistory(question, answer);
      return;
    }

    ADM.auth.saveAnswer(question, answer).then(function () {
      loadFeed(true, { quiet: true });
    }).catch(function () {
      toast('That answer could not be saved to your account. Check the connection to the server.', 'error');
    });
  }

  function renderQAList() {
    var signedIn = Boolean(ADM.auth.getUser());

    var written = signedIn
      ? feed.items.map(function (entry) {
        return {
          id: entry.id,
          question: entry.question,
          kind: 'question',
          meta: (entry.mine ? 'You' : entry.author) + ' · ' + formatDate(entry.createdAt)
        };
      })
      : history.map(function (entry) {
        return {
          id: entry.id,
          question: entry.question,
          kind: 'history',
          meta: 'Saved on this device · ' + formatDate(entry.at)
        };
      }).concat(feed.items.map(function (entry) {
        return {
          id: entry.id,
          question: entry.question,
          kind: 'question',
          meta: entry.author + ' · ' + formatDate(entry.createdAt)
        };
      }));

    var items = written.concat(ADM.seedQA.map(function (entry) {
      return {
        id: entry.id,
        question: entry.question,
        kind: 'seed',
        meta: 'Archive · ' + (entry.author || 'reader')
      };
    }));

    qaList.innerHTML = items.map(function (item) {
      return (
        '<li><button class="qa-item" type="button" data-qa-id="' + escapeHtml(item.id) + '" data-qa-kind="' + item.kind + '">' +
          '<span class="qa-item-question">' + escapeHtml(item.question) + '</span>' +
          '<span class="qa-item-meta">' + escapeHtml(item.meta) + '</span>' +
        '</button></li>'
      );
    }).join('');

    renderFeedStatus();
  }

  function renderFeedStatus() {
    if (!qaList) return;
    var status = $('#qa-feed-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'qa-feed-status';
      status.className = 'qa-feed-status';
      qaList.insertAdjacentElement('afterend', status);
    }

    if (feed.error) {
      status.innerHTML = '<p class="qa-feed-note">The shared question list could not be loaded.</p>' +
        '<button class="btn ghost small" type="button" id="qa-feed-retry">Try again</button>';
      var retry = $('#qa-feed-retry');
      if (retry) {
        retry.addEventListener('click', function () {
          loadFeed(true);
        });
      }
      return;
    }

    var remaining = feed.total - feed.items.length;
    if (remaining > 0) {
      status.innerHTML = '<button class="btn ghost small" type="button" id="qa-feed-more">Show older questions (' +
        remaining + ')</button>';
      var more = $('#qa-feed-more');
      if (more) {
        more.addEventListener('click', function () {
          more.disabled = true;
          loadFeed(false);
        });
      }
      return;
    }

    status.innerHTML = feed.loaded && feed.total
      ? '<p class="qa-feed-note">' + feed.total + (feed.total === 1 ? ' answer' : ' answers') + ' from the community so far.</p>'
      : '';
  }

  /* ----------------------------------------------------------------- home */

  var homeLatest = $('#home-latest');
  var homeNews = $('#home-news');
  var homeAsk = $('#home-ask');

  function latestAnswer() {
    var user = ADM.auth.getUser();

    var mine = feed.items.filter(function (entry) {
      return entry.mine;
    })[0];
    if (user && mine) {
      return {
        question: mine.question,
        text: mine.answer,
        eyebrow: 'Your last answer',
        meta: 'Answered ' + formatDate(mine.createdAt)
      };
    }

    if (!user && history.length) {
      var local = history[0];
      return {
        question: local.question,
        text: local.answer,
        eyebrow: 'Your last answer',
        meta: 'Saved on this device · ' + formatDate(local.at)
      };
    }

    if (feed.items.length) {
      var shared = feed.items[0];
      return {
        question: shared.question,
        text: shared.answer,
        eyebrow: 'Latest from the Q&A',
        meta: 'Asked by ' + shared.author + ' · ' + formatDate(shared.createdAt)
      };
    }

    var seed = ADM.seedQA[0];
    if (!seed) return null;
    return {
      question: seed.question,
      text: seed.answer,
      eyebrow: 'From the archive',
      meta: 'Archived answer · ' + (seed.author || 'reader')
    };
  }

  function preview(text) {
    var paragraphs = String(text || '').split(/\n{2,}/).map(function (block) {
      return block.trim();
    }).filter(function (block) {
      if (!block) return false;
      if (/^hi\b[^\n]{0,24},?$/i.test(block)) return false;
      if (SIGN_OFF.test(block)) return false;
      return block !== ADM.letter.signature;
    });

    var flat = paragraphs.join(' ').replace(/\s+/g, ' ').trim();
    if (flat.length <= 190) return flat;
    return flat.slice(0, 187).replace(/[,;:.\s]+$/, '') + '…';
  }

  function renderHome() {
    if (!homeLatest) return;

    var item = latestAnswer();
    if (item) {
      homeLatest.innerHTML =
        '<p class="home-eyebrow">' + escapeHtml(item.eyebrow) + '</p>' +
        '<p class="home-side-question">' + escapeHtml(item.question) + '</p>' +
        '<p class="home-side-preview">' + escapeHtml(preview(item.text)) + '</p>' +
        '<span class="home-side-meta">' + escapeHtml(item.meta) + '</span>' +
        '<button class="btn ghost small" type="button" id="home-latest-read">Read the answer</button>';

      var readButton = $('#home-latest-read');
      if (readButton) {
        readButton.addEventListener('click', function () {
          activateTab('qa');
          showAnswer({
            question: item.question,
            text: item.text,
            eyebrow: item.eyebrow,
            meta: item.meta
          });
        });
      }
    } else {
      homeLatest.innerHTML = '<p class="home-side-empty">No answers yet. Ask the first question above.</p>';
    }

    var answers = ADM.seedQA.length + feed.total + (ADM.auth.getUser() ? 0 : history.length);
    var answerStat = $('#home-stat-answers');
    var clubStat = $('#home-stat-clubs');
    var serviceStat = $('#home-stat-services');
    if (answerStat) answerStat.textContent = String(answers);
    if (clubStat) clubStat.textContent = String(ADM.clubs.length);
    if (serviceStat) serviceStat.textContent = String(ADM.services.length);

    if (homeNews) {
      homeNews.innerHTML = ADM.news.slice(0, 2).map(function (item) {
        return (
          '<li class="news-item">' +
            '<time datetime="' + escapeHtml(item.date) + '">' + escapeHtml(formatDate(item.date, true)) + '</time>' +
            '<h3>' + escapeHtml(item.title) + '</h3>' +
            '<p>' + escapeHtml(item.body) + '</p>' +
          '</li>'
        );
      }).join('');
    }
  }

  if (homeAsk) {
    homeAsk.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      heroInput.focus({ preventScroll: true });
    });
  }

  document.addEventListener('click', function (event) {
    var target = event.target.closest('[data-goto]');
    if (!target) return;
    var name = target.getAttribute('data-goto');
    if (TAB_NAMES.indexOf(name) < 0) return;
    activateTab(name);
    if (name === 'qa') showQAList(false);
  });

  if (qaList) {
    qaList.addEventListener('click', function (event) {
      var button = event.target.closest('[data-qa-id]');
      if (!button) return;
      lastQuestionButton = button;
      var id = button.dataset.qaId;

      if (button.dataset.qaKind === 'question') {
        var shared = feed.items.filter(function (item) {
          return item.id === id;
        })[0];
        if (!shared) return;
        showAnswer({
          question: shared.question,
          text: shared.answer,
          eyebrow: shared.mine ? 'Your question' : 'Asked by ' + shared.author,
          meta: 'Answered by Dr. Martin · ' + formatDate(shared.createdAt)
        });
        return;
      }

      if (button.dataset.qaKind === 'history') {
        var entry = history.filter(function (item) {
          return item.id === id;
        })[0];
        if (!entry) return;
        showAnswer({
          question: entry.question,
          text: entry.answer,
          eyebrow: 'Previous answer',
          meta: 'Saved on this device · ' + formatDate(entry.at)
        });
        return;
      }

      var seed = ADM.seedQA.filter(function (item) {
        return item.id === id;
      })[0];
      if (!seed) return;
      showAnswer({
        question: seed.question,
        text: seed.answer,
        eyebrow: 'From the archive',
        meta: 'Archived answer · ' + (seed.author || 'reader')
      });
    });
  }

  var STOP_WORDS = {};
  ('the a an is are was were be been do does did how what when where who why will would can could should ' +
    'i me my we our you your it its that this these those to for of and or in on at with about any more ' +
    'get gets got help helps best good much many there here from').split(' ').forEach(function (word) {
    STOP_WORDS[word] = true;
  });

  function tokenize(text) {
    var matches = String(text || '').toLowerCase().match(/[a-z0-9']+/g) || [];
    var seen = {};
    return matches.filter(function (word) {
      if (word.length < 3 || STOP_WORDS[word] || seen[word]) return false;
      seen[word] = true;
      return true;
    });
  }

  function matchSeed(question) {
    var asked = tokenize(question);
    var best = null;
    var bestScore = 0;

    ADM.seedQA.forEach(function (entry) {
      var questionWords = tokenize(entry.question);
      var answerWords = tokenize(entry.answer);
      var score = 0;
      questionWords.forEach(function (word) {
        if (asked.indexOf(word) >= 0) score += 2;
      });
      answerWords.forEach(function (word) {
        if (asked.indexOf(word) >= 0) score += 1;
      });
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    });

    return bestScore >= 2 ? best : null;
  }

  function askQuestion(rawQuestion) {
    var question = String(rawQuestion || '').trim();
    if (!question) {
      toast('Type a question first.', 'error');
      heroInput.focus();
      return;
    }

    if (activeController) {
      var previous = activeController;
      activeController = null;
      previous.abort();
    }

    ai.whenReady().then(function (settings) {
      deliverQuestion(question, settings);
    });
  }

  function deliverQuestion(question, settings) {
    var fallback = matchSeed(question);

    if (!ai.isConfigured(settings)) {
      if (fallback) {
        showAnswer({
          question: fallback.question,
          text: fallback.answer,
          eyebrow: 'From the archive',
          meta: 'Archived answer · ' + (fallback.author || 'reader') + ' — add an API key for new questions'
        });
      } else {
        showSetup(question, null);
      }
      return;
    }

    showPending(question);

    var controller = new AbortController();
    activeController = controller;
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, 45000);

    var account = ADM.auth.getUser();
    ai.ask(question, {
      settings: settings,
      signal: controller.signal,
      readerName: account ? account.username : ''
    })
      .then(function (result) {
        clearTimeout(timer);
        if (activeController !== controller) return;
        activeController = null;
        recordAnswer(question, result.text);
        showAnswer({
          question: question,
          text: result.text,
          eyebrow: 'Dr. Martin answers',
          meta: 'Answered by Dr. Martin'
        });
      })
      .catch(function (err) {
        clearTimeout(timer);
        if (activeController !== controller) return;
        activeController = null;

        if (err && err.name === 'AbortError') {
          if (timedOut) {
            showError(question, { code: 'timeout' }, fallback);
          } else {
            showQAAnswer();
            answerBody.innerHTML =
              answerHead(question, 'Your question') +
              '<div class="notice"><strong>Request cancelled.</strong> Ask again whenever you are ready.</div>' +
              '<div class="answer-actions"><button class="btn ghost small" type="button" id="answer-retry">Try again</button></div>';
            bindAnswerActions(question, fallback);
          }
          return;
        }

        showError(question, err, fallback);
      });
  }

  function runHeroSearch() {
    var question = heroInput.value.trim();
    if (!question) {
      toast('Type a question first.', 'error');
      heroInput.focus();
      return;
    }
    activateTab('qa');
    var panel = tabPanels.qa;
    if (panel && panel.scrollIntoView) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    askQuestion(question);
  }

  heroForm.addEventListener('submit', function (event) {
    event.preventDefault();
    runHeroSearch();
  });

  /* ----------------------------------------------------------------- init */

  renderClubs();
  renderNews();
  renderServices();
  renderGuidelines();
  renderQAList();
  renderHome();
  applyAccount(ADM.auth.getUser());
  ADM.auth.restore().then(function (user) {
    if (user) applyAccount(user);
  });
  activateTab(tabFromHash(), { updateHash: false });

  if (location.hash === '#guidelines') {
    openModal(guidelinesModal);
  }
})();

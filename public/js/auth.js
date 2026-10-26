(function () {
  'use strict';

  var ADM = window.ADM;
  var SESSION_KEY = 'adm.session';

  function detectBase() {
    var override = '';
    if (typeof window.ADM_API_BASE === 'string') override = window.ADM_API_BASE.trim();
    if (!override) {
      try {
        override = String(localStorage.getItem('adm.api.base') || '').trim();
      } catch (err) {
        /* storage may be unavailable */
      }
    }
    if (override) return override.replace(/\/+$/, '');

    if (location.protocol === 'http:' || location.protocol === 'https:') return '';
    return 'http://127.0.0.1:8787';
  }

  var apiBase = detectBase();
  var session = readSession();
  var listeners = [];

  function AuthError(code, message, status) {
    this.name = 'AuthError';
    this.code = code;
    this.message = message;
    this.status = status || 0;
  }
  AuthError.prototype = Object.create(Error.prototype);
  AuthError.prototype.constructor = AuthError;

  function readSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.token && parsed.user ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function persist(next) {
    session = next;
    try {
      if (next) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (err) {
      /* private mode: the session still works for this page load */
    }
    listeners.forEach(function (fn) {
      try {
        fn(getUser());
      } catch (err) {
        /* keep other listeners running */
      }
    });
  }

  function getUser() {
    return session ? session.user : null;
  }

  function getToken() {
    return session ? session.token : '';
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function request(pathname, options) {
    var opts = options || {};
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    return fetch(apiBase + pathname, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }).catch(function () {
      throw new AuthError('offline', 'Cannot reach the account service.', 0);
    }).then(function (response) {
      return response.json().catch(function () {
        return null;
      }).then(function (payload) {
        if (!response.ok) {
          var error = (payload && payload.error) || {};
          throw new AuthError(error.code || 'request_failed', error.message || 'Request failed (HTTP ' + response.status + ').', response.status);
        }
        return payload || {};
      });
    });
  }

  function startSession(payload) {
    persist({ token: payload.token, user: payload.user, expiresAt: payload.expiresAt });
    return payload.user;
  }

  function register(email, password) {
    return request('/api/auth/register', { method: 'POST', body: { email: email, password: password } })
      .then(startSession);
  }

  function login(email, password) {
    return request('/api/auth/login', { method: 'POST', body: { email: email, password: password } })
      .then(startSession);
  }

  function logout() {
    var hadSession = Boolean(session);
    persist(null);
    if (!hadSession) return Promise.resolve();
    return request('/api/auth/logout', { method: 'POST' }).catch(function () {
      /* the local session is already gone; a stale server session expires on its own */
    });
  }

  function restore() {
    if (!session) return Promise.resolve(null);
    return request('/api/auth/me').then(function (payload) {
      persist({ token: session.token, user: payload.user, expiresAt: session.expiresAt });
      return payload.user;
    }).catch(function (err) {
      if (err.code === 'invalid_session') persist(null);
      return null;
    });
  }

  function listQuestions(options) {
    var opts = options || {};
    var query = '?limit=' + (opts.limit || 50) + '&offset=' + (opts.offset || 0);
    return request('/api/questions' + query).then(function (payload) {
      return { questions: payload.questions || [], total: payload.total || 0 };
    });
  }

  function saveAnswer(question, answer) {
    return request('/api/answers', { method: 'POST', body: { question: question, answer: answer } })
      .then(function (payload) {
        return payload.answer;
      });
  }

  function getSettings() {
    return request('/api/settings').then(function (payload) {
      return payload.settings || null;
    });
  }

  function saveSettings(settings) {
    return request('/api/settings', {
      method: 'POST',
      body: {
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey
      }
    }).then(function (payload) {
      return payload.settings;
    });
  }

  ADM.auth = {
    apiBase: apiBase,
    AuthError: AuthError,
    getUser: getUser,
    getToken: getToken,
    onChange: onChange,
    register: register,
    login: login,
    logout: logout,
    restore: restore,
    listQuestions: listQuestions,
    saveAnswer: saveAnswer,
    getSettings: getSettings,
    saveSettings: saveSettings
  };
})();

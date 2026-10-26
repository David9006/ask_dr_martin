(function () {
  'use strict';

  var ADM = window.ADM;
  var SETTINGS_KEY = 'adm.ai.settings';

  var DEFAULTS = {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: ''
  };

  // Dr. Martin's voice, copied from the textbook reply: warm and confident,
  // pleasant but vague — plenty of reassurance, broad claims and
  // physiological-sounding filler, no diagnoses, studies or jargon.
  var SYSTEM_PROMPT = [
    'You are Dr. Martin, the doctor behind the "Ask Dr. Martin" health column.',
    'Answer in his voice: warm, confident, folksy and deliberately generic.',
    'The advice must be true and harmless, but it should sound more',
    'authoritative than specific. Reassure rather than diagnose.',
    '',
    'Follow this shape exactly:',
    '1. Greeting on its own line: "Hi <name>," when a name is given, otherwise "Hi there,".',
    '2. Then "Thanks for your question." as a short opening sentence.',
    '3. One folksy generalisation in this shape: "As people often say, any exercise is',
    '   better than none, but <the topic> in particular has a lot of benefits."',
    '4. Three or four short body paragraphs of three to five sentences each.',
    '   Total length 170 to 250 words.',
    '5. Echo the reader\'s own words before answering: "You are also somebody who ...",',
    '   "If you are new to ...", "You said ...". Never ask a question back.',
    '6. Use flat, parallel clauses: "It will ...", "It makes ...", "It also ...",',
    '   "It gives you ...". Run four or five benefits together in a row.',
    '7. Work blood flow in at least twice, in exactly this register:',
    '   "increases the flow of blood and oxygen to your brain",',
    '   "allows more blood to flow around your body",',
    '   "gets your blood flowing faster".',
    '8. Drop in one oddly specific but generic figure: "a thirty-minute run",',
    '   "jog slowly for ten minutes, then walk for five minutes",',
    '   "three or four times a week".',
    '9. Include one sweeping line such as "There is also no better way to ..." or',
    '   "you do not need a gym membership or any special equipment".',
    '10. Give two or three practical tips as friendly instruction, especially',
    '    warming up and cooling down properly.',
    '11. Close with "For more guidelines on <the topic>, click here. I hope this will help!"',
    '    naming the reader\'s own topic. Then, on its own line, "Best Regards," and on',
    '    the next line "Dr. Martin".',
    '',
    'Style rules:',
    '- Second person, short declarative sentences, simple vocabulary, em dashes.',
    '- Plain text only: no markdown, no headings, no bullet points, no bold.',
    '- Exactly one exclamation mark, on the "I hope this will help!" line.',
    '- Friendly filler connectives are welcome: "Besides,", "Then, keep it up.",',
    '  "Like any exercise,".',
    '- Never name a condition, give a dosage, cite a study or a statistic, or',
    '  refer to other doctors.',
    '- Never mention being an AI or a language model.',
    '- Safety valve: if the reader describes chest pain, fainting, heavy bleeding,',
    '  suicidal thoughts or another urgent symptom, keep the same voice but add one',
    '  short sentence telling them to see a doctor today.'
  ].join('\n');

  function AIError(code, message, cause) {
    this.name = 'AIError';
    this.code = code;
    this.message = message;
    this.cause = cause || null;
  }
  AIError.prototype = Object.create(Error.prototype);
  AIError.prototype.constructor = AIError;

  // Settings live on the account when the reader is signed in, and in
  // localStorage otherwise. `scope` records which one is active so a signed-in
  // reader never reads another person's key off a shared device.
  var active = null;
  var scope = 'local';
  var pending = null;

  function readStorage() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function normalize(stored) {
    var source = stored || {};
    return {
      baseUrl: typeof source.baseUrl === 'string' && source.baseUrl.trim() ? source.baseUrl.trim() : DEFAULTS.baseUrl,
      model: typeof source.model === 'string' && source.model.trim() ? source.model.trim() : DEFAULTS.model,
      apiKey: typeof source.apiKey === 'string' ? source.apiKey : ''
    };
  }

  function writeLocal(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      /* private modes: the in-memory copy still works for this page load */
    }
  }

  function clearLocal() {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch (err) {
      /* nothing to clear */
    }
  }

  function loadSettings() {
    if (!active) active = normalize(readStorage());
    return active;
  }

  function currentScope() {
    return scope;
  }

  function useLocalSettings() {
    scope = 'local';
    pending = null;
    active = normalize(readStorage());
    return active;
  }

  function applyAccountSettings(remote) {
    scope = 'account';
    active = normalize(remote);
    return active;
  }

  // Called whenever a session starts or ends. On sign-in the account copy wins;
  // if the account has none yet, a key typed while signed out is adopted and the
  // local copy is removed so it does not leak to the next person on this device.
  function adoptAccountSettings() {
    if (!ADM.auth || !ADM.auth.getUser()) {
      return Promise.resolve(useLocalSettings());
    }

    scope = 'account';
    var local = normalize(readStorage());

    pending = ADM.auth.getSettings().then(function (remote) {
      if (remote && (remote.apiKey || remote.baseUrl !== DEFAULTS.baseUrl || remote.model !== DEFAULTS.model)) {
        clearLocal();
        return applyAccountSettings(remote);
      }
      if (local.apiKey) {
        return ADM.auth.saveSettings(local).then(function (saved) {
          clearLocal();
          return applyAccountSettings(saved);
        }).catch(function () {
          return applyAccountSettings(null);
        });
      }
      return applyAccountSettings(null);
    }).catch(function () {
      return applyAccountSettings(null);
    });

    return pending;
  }

  function whenReady() {
    if (scope === 'account' && pending) {
      return pending.then(function () {
        return loadSettings();
      });
    }
    return Promise.resolve(loadSettings());
  }

  function saveSettings(patch) {
    var next = normalize(loadSettings());
    if (patch && typeof patch.baseUrl === 'string') next.baseUrl = patch.baseUrl.trim();
    if (patch && typeof patch.model === 'string') next.model = patch.model.trim();
    if (patch && typeof patch.apiKey === 'string') next.apiKey = patch.apiKey.trim();

    if (scope === 'account' && ADM.auth && ADM.auth.getUser()) {
      var previous = active;
      active = next;
      return ADM.auth.saveSettings(next).catch(function (err) {
        active = previous;
        throw new AuthSettingsError(err);
      });
    }

    active = next;
    writeLocal(next);
    return Promise.resolve(next);
  }

  function AuthSettingsError(cause) {
    this.name = 'AuthSettingsError';
    this.code = (cause && cause.code) || 'settings_failed';
    this.message = (cause && cause.message) || 'Could not save the settings to your account.';
    this.cause = cause || null;
  }
  AuthSettingsError.prototype = Object.create(Error.prototype);
  AuthSettingsError.prototype.constructor = AuthSettingsError;

  function clearApiKey() {
    return saveSettings({ apiKey: '' });
  }

  function isConfigured(settings) {
    var s = settings || loadSettings();
    return Boolean(s.baseUrl && s.model && s.apiKey);
  }

  function chatEndpoint(baseUrl) {
    var base = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(base)) return base;
    return base + '/chat/completions';
  }

  function extractAnswer(payload) {
    var choice = payload && payload.choices && payload.choices[0];
    var content = choice && choice.message && choice.message.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .map(function (part) {
          return typeof part === 'string' ? part : part && part.text ? part.text : '';
        })
        .join('')
        .trim();
    }
    return '';
  }

  function readErrorMessage(payload, fallback) {
    if (payload && payload.error) {
      if (typeof payload.error === 'string') return payload.error;
      if (payload.error.message) return payload.error.message;
    }
    return fallback;
  }

  function systemPromptFor(readerName) {
    var name = String(readerName || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 20);
    if (!name) return SYSTEM_PROMPT;
    var greeted = name.charAt(0).toUpperCase() + name.slice(1);
    return SYSTEM_PROMPT +
      '\n\nThe reader is signed in as "' + name + '". Greet them as "Hi ' + greeted + ',".';
  }

  async function ask(question, options) {
    var settings = (options && options.settings) || loadSettings();
    var signal = options && options.signal;
    var readerName = options && options.readerName;

    if (!settings.apiKey) {
      throw new AIError('unconfigured', 'No API key is configured.');
    }

    var response;
    try {
      response = await fetch(chatEndpoint(settings.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + settings.apiKey
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.7,
          messages: [
            { role: 'system', content: systemPromptFor(readerName) },
            { role: 'user', content: question }
          ]
        }),
        signal: signal
      });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new AIError('network', 'The request could not be sent.', err);
    }

    var payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      payload = null;
    }

    if (!response.ok) {
      throw new AIError(
        response.status,
        readErrorMessage(payload, 'The service returned HTTP ' + response.status + '.'),
        null
      );
    }

    var answer = extractAnswer(payload);
    if (!answer) {
      throw new AIError('empty', readErrorMessage(payload, 'The service returned an empty answer.'));
    }

    return {
      text: answer,
      model: settings.model
    };
  }

  function describeError(err) {
    if (!err) return { title: 'Something went wrong', message: 'Please try again.', showSettings: false };

    if (err.name === 'AbortError') {
      return { title: 'Request cancelled', message: 'Dr. Martin stopped reading. Ask again when you are ready.', showSettings: false };
    }

    var code = err.code;
    if (code === 'unconfigured') {
      return {
        title: 'AI answers need a key',
        message: 'Add an API key in AI settings to get new answers. Archived answers still work without one.',
        showSettings: true
      };
    }
    if (code === 401 || code === 403) {
      return {
        title: 'The API key was rejected',
        message: 'Check the key and the endpoint, then save the settings again.',
        showSettings: true
      };
    }
    if (code === 404) {
      return {
        title: 'Endpoint or model not found',
        message: 'The base URL or model name looks wrong. It should look like https://api.openai.com/v1 with a model such as gpt-4o-mini.',
        showSettings: true
      };
    }
    if (code === 429) {
      return {
        title: 'The service is rate limiting',
        message: err.message || 'Too many requests. Wait a moment and ask again.',
        showSettings: true
      };
    }
    if (code === 'timeout') {
      return {
        title: 'The service took too long',
        message: 'No answer arrived within 45 seconds. Try again, or choose a faster model in AI settings.',
        showSettings: true
      };
    }
    if (code === 'network') {
      return {
        title: 'Could not reach the service',
        message: 'Check the base URL, your connection, and whether the endpoint allows cross-origin requests (CORS) from this page.',
        showSettings: true
      };
    }
    if (code === 'empty') {
      return { title: 'Empty answer', message: 'The service replied without any text. Try asking again.', showSettings: false };
    }

    return {
      title: 'Dr. Martin could not answer',
      message: err.message || 'Unexpected error. Please try again.',
      showSettings: Boolean(code)
    };
  }

  ADM.ai = {
    defaults: DEFAULTS,
    loadSettings: loadSettings,
    whenReady: whenReady,
    scope: currentScope,
    adoptAccountSettings: adoptAccountSettings,
    useLocalSettings: useLocalSettings,
    saveSettings: saveSettings,
    clearApiKey: clearApiKey,
    isConfigured: isConfigured,
    chatEndpoint: chatEndpoint,
    ask: ask,
    describeError: describeError
  };
})();

(function () {
  'use strict';

  var ADM = window.ADM;
  var SETTINGS_KEY = 'adm.ai.settings';

  var DEFAULTS = {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: ''
  };

  var SYSTEM_PROMPT = [
    'You are Dr. Martin, a warm, experienced doctor who writes a health column called',
    '"Ask Dr. Martin". Answer the reader directly and practically.',
    'Rules:',
    '- 2 to 4 short paragraphs, at most 180 words.',
    '- Plain prose or a short bullet list starting with "- ". No markdown headings.',
    '- Be encouraging about exercise, but never promise a diagnosis or a cure.',
    '- If symptoms sound urgent or persistent, tell the reader to see a doctor in person.',
    '- Do not mention that you are an AI model.'
  ].join('\n');

  function AIError(code, message, cause) {
    this.name = 'AIError';
    this.code = code;
    this.message = message;
    this.cause = cause || null;
  }
  AIError.prototype = Object.create(Error.prototype);
  AIError.prototype.constructor = AIError;

  function readStorage() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function loadSettings() {
    var stored = readStorage() || {};
    return {
      baseUrl: typeof stored.baseUrl === 'string' && stored.baseUrl.trim() ? stored.baseUrl.trim() : DEFAULTS.baseUrl,
      model: typeof stored.model === 'string' && stored.model.trim() ? stored.model.trim() : DEFAULTS.model,
      apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : ''
    };
  }

  function saveSettings(patch) {
    var next = loadSettings();
    if (patch && typeof patch.baseUrl === 'string') next.baseUrl = patch.baseUrl.trim();
    if (patch && typeof patch.model === 'string') next.model = patch.model.trim();
    if (patch && typeof patch.apiKey === 'string') next.apiKey = patch.apiKey.trim();
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
      /* storage can be unavailable in private modes; the in-memory form still works this session */
    }
    return next;
  }

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

  async function ask(question, options) {
    var settings = (options && options.settings) || loadSettings();
    var signal = options && options.signal;

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
          temperature: 0.6,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
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
    saveSettings: saveSettings,
    clearApiKey: clearApiKey,
    isConfigured: isConfigured,
    chatEndpoint: chatEndpoint,
    ask: ask,
    describeError: describeError
  };
})();

mergeInto(LibraryManager.library, {
  GQ_Touch_ConfigureSurface: function () {
    var canvas = document.querySelector('#unity-canvas');
    if (canvas) {
      canvas.style.touchAction = 'none';
      canvas.style.userSelect = 'none';
      canvas.style.webkitUserSelect = 'none';
    }
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';
    document.body.style.overflow = 'hidden';
    if (!window.__gqUnityTouchGestureGuard) {
      var preventGesture = function (event) { event.preventDefault(); };
      ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
        document.addEventListener(name, preventGesture, { passive: false });
      });
      window.__gqUnityTouchGestureGuard = true;
    }
  },

  GQ_Audio_Speak: function (textPtr) {
    var text = UTF8ToString(textPtr).trim();
    if (!text || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return;
    window.speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.82;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  },

  // Review-only observation seam: the Forge driver still dispatches ordinary canvas
  // touches. These projected points let it hit the physical world controls without
  // encoding camera-specific pixels or exposing answers/private learner state.
  GQ_Diagnostics_ClearForgeControls: function () {
    // Do not clear the last complete projection here. More than one presenter can
    // update in a frame while preview scenes settle; a later inactive presenter must
    // not erase the active Forge's points before the browser driver can observe them.
    window.__gqRuneForgeControls = window.__gqRuneForgeControls || [];
  },

  GQ_Diagnostics_RecordForgeControl: function (kindPtr, valuePtr, screenX, screenY) {
    var canvas = document.querySelector('#unity-canvas');
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var width = canvas.width || rect.width;
    var height = canvas.height || rect.height;
    window.__gqRuneForgeControls = window.__gqRuneForgeControls || [];
    var next = {
      kind: UTF8ToString(kindPtr),
      value: UTF8ToString(valuePtr),
      x: rect.x + (screenX / width) * rect.width,
      y: rect.y + (1 - screenY / height) * rect.height
    };
    var previous = window.__gqRuneForgeControls.findIndex(function (item) {
      return item.kind === next.kind && Math.abs(item.x - next.x) < 4 && Math.abs(item.y - next.y) < 4;
    });
    if (previous >= 0) window.__gqRuneForgeControls[previous] = next;
    else window.__gqRuneForgeControls.push(next);
  },

  GQ_Profile_ReadSelected: function (gameObjectPtr, callbackPtr) {
    var gameObject = UTF8ToString(gameObjectPtr);
    var callback = UTF8ToString(callbackPtr);
    if (!window.__gqUnityProgressionReady) {
      window.__gqUnityProgressionReady = import('/src/unity/profileProgression.js').then(function (module) {
        return module.createUnityProfileProgression({storage: window.localStorage});
      });
    }
    // Initialization finishes before Unity opens its session. Later accepted-frame writes
    // can therefore finish synchronously before that session sends restore-profile.
    return window.__gqUnityProgressionReady.then(function (progression) {
      window.__gqUnityProfileProgression = progression;
      SendMessage(gameObject, callback, JSON.stringify(progression.readSelected()));
    }).catch(function (error) {
      SendMessage(gameObject, callback, JSON.stringify({status:'error', error:error.message || String(error)}));
    });
  },

  GQ_Profile_ApplyFrame: function (gameObjectPtr, callbackPtr, profileIdPtr, playerIdPtr, messagePtr) {
    var gameObject = UTF8ToString(gameObjectPtr);
    var callback = UTF8ToString(callbackPtr);
    var profileId = UTF8ToString(profileIdPtr);
    try {
      if (!window.__gqUnityProfileProgression) throw new Error('The selected profile is not ready.');
      var result = window.__gqUnityProfileProgression.applyFrame(profileId,
        UTF8ToString(playerIdPtr), JSON.parse(UTF8ToString(messagePtr)));
      if (!result) return;
      if (window.__gqUnityCp2Diagnostics) window.__gqUnityCp2Diagnostics.latestProgression = result;
      SendMessage(gameObject, callback, JSON.stringify(result));
    } catch (error) {
      SendMessage(gameObject, callback, JSON.stringify({status:'error', profileId:profileId, error:error.message || String(error)}));
    }
  },

  GQ_WebSocket_Connect: function (gameObjectPtr, openPtr, messagePtr, closePtr) {
    var gameObject = UTF8ToString(gameObjectPtr);
    var openCallback = UTF8ToString(openPtr);
    var messageCallback = UTF8ToString(messagePtr);
    var closeCallback = UTF8ToString(closePtr);
    var state = window.__gqUnitySockets;
    if (!state) {
      state = { nextId: 1, sockets: {} };
      window.__gqUnitySockets = state;
    }

    var id = state.nextId++;
    var scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var socket = new WebSocket(scheme + '//' + window.location.host + '/ws');
    state.sockets[id] = socket;

    socket.onopen = function () {
      SendMessage(gameObject, openCallback, String(id));
    };
    socket.onmessage = function (event) {
      try {
        var received = JSON.parse(String(event.data));
        if (received && (received.type === 'welcome' || received.type === 'snapshot'
            || received.type === 'destination-changed' || received.type === 'forge-state')) {
          var diagnostics = window.__gqUnityCp2Diagnostics || {
            sentInputs: [], serverFrames: [], reconciliations: []
          };
          diagnostics.serverFrames.push(received);
          if (diagnostics.serverFrames.length > 200) diagnostics.serverFrames.shift();
          diagnostics.latestServerFrame = received;
          window.__gqUnityCp2Diagnostics = diagnostics;
        }
      } catch (error) {
        console.warn('[GQ-U1] could not capture server frame diagnostics', error);
      }
      SendMessage(gameObject, messageCallback, String(event.data));
    };
    socket.onclose = function (event) {
      delete state.sockets[id];
      SendMessage(gameObject, closeCallback, JSON.stringify({
        id: id,
        code: event.code,
        reason: event.reason || ''
      }));
    };
    socket.onerror = function () {
      console.error('[GQ-U1] browser WebSocket error for connection ' + id);
    };
    return id;
  },

  GQ_WebSocket_Send: function (id, messagePtr) {
    var state = window.__gqUnitySockets;
    var socket = state && state.sockets[id];
    if (!socket || socket.readyState !== WebSocket.OPEN) return 0;
    var message = UTF8ToString(messagePtr);
    try {
      var sent = JSON.parse(message);
      if (sent && sent.type === 'input') {
        var diagnostics = window.__gqUnityCp2Diagnostics || {
          sentInputs: [], serverFrames: [], reconciliations: []
        };
        diagnostics.sentInputs.push(sent);
        if (diagnostics.sentInputs.length > 200) diagnostics.sentInputs.shift();
        diagnostics.latestInput = sent;
        window.__gqUnityCp2Diagnostics = diagnostics;
      }
    } catch (error) {
      console.warn('[GQ-U1] could not capture input diagnostics', error);
    }
    socket.send(message);
    return 1;
  },

  GQ_WebSocket_Close: function (id) {
    var state = window.__gqUnitySockets;
    var socket = state && state.sockets[id];
    if (!socket) return;
    // Intentional session recovery owns the disconnect signal. Retire callbacks so a
    // late old-socket close/message cannot clear or hydrate the replacement connection.
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    delete state.sockets[id];
    socket.close(1000, 'Unity client closed');
  },

  GQ_Diagnostics_RecordMovement: function (predictedX, predictedZ, authoritativeX, authoritativeZ, drift, snapped) {
    var diagnostics = window.__gqUnityCp2Diagnostics || {
      sentInputs: [], serverFrames: [], reconciliations: []
    };
    var sample = {
      predicted: { x: predictedX, z: predictedZ },
      authoritative: { x: authoritativeX, z: authoritativeZ },
      drift: drift,
      snapped: snapped === 1,
      atMs: Date.now()
    };
    diagnostics.reconciliations.push(sample);
    if (diagnostics.reconciliations.length > 200) diagnostics.reconciliations.shift();
    diagnostics.latestReconciliation = sample;
    window.__gqUnityCp2Diagnostics = diagnostics;
  }
});

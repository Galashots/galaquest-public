mergeInto(LibraryManager.library, {
  GQ_Profile_ReadSelected: function (gameObjectPtr, callbackPtr) {
    var gameObject = UTF8ToString(gameObjectPtr);
    var callback = UTF8ToString(callbackPtr);
    var result = { status: 'error', profileId: '', displayName: '', factsJson: '[]' };

    try {
      var rawKeyring = window.localStorage.getItem('gq-profiles');
      var keyring = rawKeyring ? JSON.parse(rawKeyring) : null;
      var profileId = keyring && typeof keyring.activeProfileId === 'string'
        ? keyring.activeProfileId
        : '';
      var profiles = keyring && Array.isArray(keyring.profiles) ? keyring.profiles : [];
      var profile = profiles.find(function (candidate) {
        return candidate && candidate.id === profileId;
      });

      if (!profileId || !profile) {
        result.error = 'No existing GalaQuest profile is selected. Select a child in GalaQuest first.';
      } else {
        var rawJournal = window.localStorage.getItem('gq-journal:' + profileId);
        var journal = rawJournal ? JSON.parse(rawJournal) : null;
        var facts = journal && Array.isArray(journal.facts) ? journal.facts : [];
        result = {
          status: 'ok',
          profileId: profileId,
          displayName: typeof profile.displayName === 'string' ? profile.displayName : 'Hero',
          factsJson: JSON.stringify(facts)
        };
      }
    } catch (error) {
      result.error = 'Existing GalaQuest profile storage could not be read: '
        + (error && error.message ? error.message : String(error));
    }

    SendMessage(gameObject, callback, JSON.stringify(result));
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
        if (received && (received.type === 'welcome' || received.type === 'snapshot')) {
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

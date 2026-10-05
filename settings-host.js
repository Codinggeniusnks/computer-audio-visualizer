(function (global) {
  "use strict";

  var NS = global.PurpleVoxelWallpaper = global.PurpleVoxelWallpaper || {};

  var DEFAULTS = Object.freeze({
    sensitivity: 1.35,
    motionIntensity: 1,
    quality: "balanced",
    fpsLimit: 60,
    bloom: true,
    idleMotion: true,
    primaryColor: [1, 0.12, 0.76],
    backgroundColor: [0.063, 0, 0.098]
  });

  function cloneDefaults() {
    return {
      sensitivity: DEFAULTS.sensitivity,
      motionIntensity: DEFAULTS.motionIntensity,
      quality: DEFAULTS.quality,
      fpsLimit: DEFAULTS.fpsLimit,
      bloom: DEFAULTS.bloom,
      idleMotion: DEFAULTS.idleMotion,
      primaryColor: DEFAULTS.primaryColor.slice(),
      backgroundColor: DEFAULTS.backgroundColor.slice()
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function parseBoolean(value) {
    if (typeof value === "string") return value.toLowerCase() !== "false" && value !== "0";
    return Boolean(value);
  }

  function parseColor(value, fallback) {
    if (Array.isArray(value) && value.length >= 3) {
      var maxArray = Math.max(Number(value[0]), Number(value[1]), Number(value[2]));
      var divisor = maxArray > 1 ? 255 : 1;
      return [
        clamp(Number(value[0]) / divisor || 0, 0, 1),
        clamp(Number(value[1]) / divisor || 0, 0, 1),
        clamp(Number(value[2]) / divisor || 0, 0, 1)
      ];
    }

    if (typeof value === "string") {
      var text = value.trim();
      if (/^#[0-9a-f]{6}$/i.test(text)) {
        return [
          parseInt(text.slice(1, 3), 16) / 255,
          parseInt(text.slice(3, 5), 16) / 255,
          parseInt(text.slice(5, 7), 16) / 255
        ];
      }
      var parts = text.split(/[ ,]+/).map(Number).filter(Number.isFinite);
      if (parts.length >= 3) return parseColor(parts, fallback);
    }
    return fallback.slice();
  }

  function SettingsStore() {
    this.values = cloneDefaults();
    this.listeners = [];
  }

  SettingsStore.prototype.subscribe = function (listener) {
    this.listeners.push(listener);
    listener(this.values, Object.keys(this.values));
    var self = this;
    return function () {
      var index = self.listeners.indexOf(listener);
      if (index >= 0) self.listeners.splice(index, 1);
    };
  };

  SettingsStore.prototype.update = function (changes) {
    var changedKeys = [];
    for (var key in changes) {
      if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
      var next = changes[key];
      if (next == null) continue;

      if (key === "sensitivity") next = clamp(Number(next) || DEFAULTS.sensitivity, 0.5, 3);
      if (key === "motionIntensity") next = clamp(Number(next) || 0, 0, 2);
      if (key === "quality") next = ["low", "balanced", "high"].indexOf(String(next).toLowerCase()) >= 0 ? String(next).toLowerCase() : "balanced";
      if (key === "fpsLimit") next = Number(next) === 30 ? 30 : 60;
      if (key === "bloom" || key === "idleMotion") next = parseBoolean(next);
      if (key === "primaryColor") next = parseColor(next, DEFAULTS.primaryColor);
      if (key === "backgroundColor") next = parseColor(next, DEFAULTS.backgroundColor);

      var previous = this.values[key];
      var equal = Array.isArray(previous)
        ? previous.length === next.length && previous.every(function (value, index) { return value === next[index]; })
        : previous === next;
      if (!equal) {
        this.values[key] = next;
        changedKeys.push(key);
      }
    }

    if (changedKeys.length) {
      for (var i = 0; i < this.listeners.length; i += 1) {
        this.listeners[i](this.values, changedKeys);
      }
    }
  };

  function propertyValue(properties, key) {
    return properties && properties[key] ? properties[key].value : undefined;
  }

  var settings = new SettingsStore();

  var HostBridge = {
    host: typeof global.wallpaperRegisterAudioListener === "function" ? "wallpaper-engine" : "detecting",
    audioProcessor: null,
    pendingAudio: null,
    hostListeners: [],
    pauseListeners: [],
    registeredWallpaperEngineAudio: false,

    connectAudio: function (processor) {
      this.audioProcessor = processor;
      if (this.pendingAudio) {
        if (this.pendingAudio.host === "wallpaper-engine") processor.pushWallpaperEngine(this.pendingAudio.values);
        else processor.pushLively(this.pendingAudio.values);
        this.pendingAudio = null;
      }
    },

    setHost: function (host) {
      if (this.host === host) return;
      this.host = host;
      for (var i = 0; i < this.hostListeners.length; i += 1) this.hostListeners[i](host);
    },

    onHostChanged: function (listener) {
      this.hostListeners.push(listener);
      listener(this.host);
    },

    onPauseChanged: function (listener) {
      this.pauseListeners.push(listener);
    },

    emitPause: function (paused) {
      for (var i = 0; i < this.pauseListeners.length; i += 1) this.pauseListeners[i](paused);
    },

    pushWallpaperEngine: function (audioArray) {
      this.setHost("wallpaper-engine");
      if (this.audioProcessor) this.audioProcessor.pushWallpaperEngine(audioArray);
      else this.pendingAudio = { host: "wallpaper-engine", values: Array.prototype.slice.call(audioArray || []) };
    },

    pushLively: function (audioArray) {
      this.setHost("lively");
      if (this.audioProcessor) this.audioProcessor.pushLively(audioArray);
      else this.pendingAudio = { host: "lively", values: Array.prototype.slice.call(audioArray || []) };
    }
  };

  global.wallpaperAudioListener = function (audioArray) {
    HostBridge.pushWallpaperEngine(audioArray);
  };

  global.livelyAudioListener = function (audioArray) {
    HostBridge.pushLively(audioArray);
  };

  global.livelyPropertyListener = function (name, value) {
    HostBridge.setHost("lively");
    var changes = {};
    if (name === "quality" && typeof value === "number") value = ["low", "balanced", "high"][value] || "balanced";
    if (name === "fpsLimit" && typeof value === "number") value = value === 0 ? 30 : 60;
    changes[name] = value;
    settings.update(changes);
  };

  global.livelyWallpaperPlaybackChanged = function (data) {
    HostBridge.setHost("lively");
    try {
      var value = typeof data === "string" ? JSON.parse(data) : data;
      HostBridge.emitPause(Boolean(value && value.IsPaused));
    } catch (_error) {
      HostBridge.emitPause(false);
    }
  };

  global.wallpaperPropertyListener = {
    applyUserProperties: function (properties) {
      HostBridge.setHost("wallpaper-engine");
      var changes = {};
      var keys = ["sensitivity", "motionIntensity", "quality", "fpsLimit", "bloom", "idleMotion", "primaryColor", "backgroundColor"];
      for (var i = 0; i < keys.length; i += 1) {
        var value = propertyValue(properties, keys[i]);
        if (value !== undefined) changes[keys[i]] = value;
      }
      settings.update(changes);
    }
  };

  if (typeof global.wallpaperRegisterAudioListener === "function" && !HostBridge.registeredWallpaperEngineAudio) {
    HostBridge.registeredWallpaperEngineAudio = true;
    global.wallpaperRegisterAudioListener(global.wallpaperAudioListener);
  }

  NS.DEFAULT_SETTINGS = DEFAULTS;
  NS.SettingsStore = SettingsStore;
  NS.settings = settings;
  NS.HostBridge = HostBridge;
  NS.parseColor = parseColor;
})(typeof window !== "undefined" ? window : globalThis);

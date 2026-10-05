(function (global) {
  "use strict";

  var NS = global.PurpleVoxelWallpaper;
  var canvas = document.getElementById("wallpaper-canvas");
  var unsupported = document.getElementById("unsupported");
  var hostBadge = document.getElementById("host-badge");
  var demoToggle = document.getElementById("demo-toggle");
  var audioFile = document.getElementById("audio-file");
  var localAudio = document.getElementById("local-audio");
  var audioSourceLabel = document.getElementById("audio-source");
  var sensitivitySlider = document.getElementById("demo-sensitivity");
  var sensitivityValue = document.getElementById("sensitivity-value");
  var fpsReadout = document.getElementById("fps-readout");

  if (new URLSearchParams(global.location.search).get("preview") === "1") {
    document.body.classList.add("preview-mode");
  }

  var processor = new NS.AudioProcessor(NS.settings.values);
  NS.HostBridge.connectAudio(processor);

  var renderer;
  try {
    renderer = new NS.VoxelRenderer(canvas, NS.settings.values);
  } catch (error) {
    if (String(error && error.message).indexOf("WEBGL2_UNAVAILABLE") >= 0) {
      unsupported.hidden = false;
      document.body.dataset.host = "unsupported";
      return;
    }
    throw error;
  }

  var paused = false;
  var running = true;
  var syntheticEnabled = false;
  var syntheticTimer = 0;
  var localSpectrumTimer = 0;
  var audioContext = null;
  var analyser = null;
  var mediaSource = null;
  var frequencyData = new Uint8Array(128);
  var objectUrl = null;

  NS.settings.subscribe(function (values, changedKeys) {
    processor.setSettings(values);
    renderer.setSettings(values, changedKeys);
    sensitivitySlider.value = String(values.sensitivity);
    sensitivityValue.value = values.sensitivity.toFixed(2) + "×";
  });

  function syntheticSpectrum(timeSeconds) {
    var bins = new Float32Array(64);
    var bpm = 116;
    var beatPeriod = 60 / bpm;
    var beatTime = timeSeconds % beatPeriod;
    var halfBeat = timeSeconds % (beatPeriod * 0.5);
    var bassPulse = Math.exp(-beatTime * 12.5);
    var kickEcho = Math.exp(-halfBeat * 17) * 0.34;
    var phrase = 0.5 + 0.5 * Math.sin(timeSeconds * 0.42);
    for (var i = 0; i < 64; i += 1) {
      var n = i / 63;
      var bass = Math.exp(-n * 15) * (0.64 * bassPulse + kickEcho);
      var mid = Math.exp(-Math.pow((n - 0.34) * 5.2, 2)) * (0.16 + 0.24 * (0.5 + 0.5 * Math.sin(timeSeconds * 3.1 + i * 0.21)));
      var trebleTick = Math.exp(-Math.pow((n - 0.73) * 7.5, 2)) * Math.exp(-(timeSeconds % (beatPeriod * 0.25)) * 28) * (0.26 + phrase * 0.12);
      var texture = (0.5 + 0.5 * Math.sin(i * 12.9898 + timeSeconds * 6.3)) * 0.035;
      bins[i] = Math.min(1, bass + mid + trebleTick + texture);
    }
    return bins;
  }

  function pushSynthetic() {
    if (!syntheticEnabled || NS.HostBridge.host !== "browser") return;
    var time = (global.performance && performance.now ? performance.now() : Date.now()) / 1000;
    processor.pushNormalized(syntheticSpectrum(time));
  }

  function startSynthetic() {
    stopLocalSpectrum();
    syntheticEnabled = true;
    demoToggle.textContent = "Pause demo beat";
    audioSourceLabel.textContent = "Synthetic audio";
    if (!syntheticTimer) syntheticTimer = global.setInterval(pushSynthetic, 1000 / 30);
    pushSynthetic();
  }

  function stopSynthetic() {
    syntheticEnabled = false;
    demoToggle.textContent = "Resume demo beat";
    if (syntheticTimer) {
      global.clearInterval(syntheticTimer);
      syntheticTimer = 0;
    }
  }

  function stopLocalSpectrum() {
    if (localSpectrumTimer) {
      global.clearInterval(localSpectrumTimer);
      localSpectrumTimer = 0;
    }
  }

  function pushLocalSpectrum() {
    if (!analyser || localAudio.paused) return;
    analyser.getByteFrequencyData(frequencyData);
    var normalized = new Float32Array(frequencyData.length);
    for (var i = 0; i < frequencyData.length; i += 1) normalized[i] = frequencyData[i] / 255;
    processor.pushLively(normalized);
  }

  function setupLocalAudio() {
    var AudioContext = global.AudioContext || global.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioContext) audioContext = new AudioContext();
    if (!mediaSource) {
      mediaSource = audioContext.createMediaElementSource(localAudio);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.66;
      mediaSource.connect(analyser);
      analyser.connect(audioContext.destination);
    }
    if (audioContext.state === "suspended") audioContext.resume();
    stopSynthetic();
    if (!localSpectrumTimer) localSpectrumTimer = global.setInterval(pushLocalSpectrum, 1000 / 30);
    audioSourceLabel.textContent = "Local file · on this device";
  }

  function handleHost(host) {
    if (host === "detecting") {
      document.body.dataset.host = "detecting";
      hostBadge.textContent = "Detecting host";
      return;
    }
    if (host === "browser") {
      document.body.dataset.host = "browser";
      hostBadge.textContent = "Browser demo";
      if (!analyser || localAudio.paused) startSynthetic();
      return;
    }

    document.body.dataset.host = host;
    hostBadge.textContent = host === "lively" ? "Lively Wallpaper" : "Wallpaper Engine";
    stopSynthetic();
    stopLocalSpectrum();
    if (!localAudio.paused) localAudio.pause();
  }

  NS.HostBridge.onHostChanged(handleHost);
  NS.HostBridge.onPauseChanged(function (isPaused) {
    paused = isPaused;
  });

  global.setTimeout(function () {
    if (NS.HostBridge.host === "detecting") NS.HostBridge.setHost("browser");
  }, 700);

  demoToggle.addEventListener("click", function () {
    if (syntheticEnabled) stopSynthetic();
    else startSynthetic();
  });

  sensitivitySlider.addEventListener("input", function () {
    NS.settings.update({ sensitivity: Number(sensitivitySlider.value) });
  });

  audioFile.addEventListener("change", function () {
    var file = audioFile.files && audioFile.files[0];
    if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    localAudio.src = objectUrl;
    localAudio.classList.add("has-source");
    setupLocalAudio();
    localAudio.play().catch(function () {
      audioSourceLabel.textContent = "Local file ready · press play";
    });
  });

  localAudio.addEventListener("play", setupLocalAudio);
  localAudio.addEventListener("pause", function () {
    stopLocalSpectrum();
    if (NS.HostBridge.host === "browser") audioSourceLabel.textContent = "Local file paused";
  });
  localAudio.addEventListener("ended", function () {
    if (NS.HostBridge.host === "browser") startSynthetic();
  });

  global.addEventListener("resize", function () {
    renderer.resize(true);
  });

  canvas.addEventListener("webglcontextlost", function (event) {
    event.preventDefault();
    paused = true;
  });
  canvas.addEventListener("webglcontextrestored", function () {
    global.location.reload();
  });

  function animationFrame(timestamp) {
    if (!running) return;
    if (!paused) {
      var audioState = processor.update(Date.now());
      renderer.render(timestamp, audioState);
    }
    global.requestAnimationFrame(animationFrame);
  }

  global.requestAnimationFrame(animationFrame);

  global.setInterval(function () {
    var state = renderer.getDebugState();
    fpsReadout.textContent = state.fps + " FPS · " + state.quality;
    canvas.dataset.fps = String(state.fps);
    canvas.dataset.quality = state.quality;
    canvas.dataset.instances = String(state.instanceCount);
    canvas.dataset.renderWidth = String(state.width);
    canvas.dataset.renderHeight = String(state.height);
    canvas.dataset.autoScale = state.autoScale.toFixed(2);
    canvas.dataset.renderCost = state.averageRenderCost.toFixed(2);
    canvas.dataset.webgl = state.webglVersion;
  }, 500);

  global.__PURPLE_VOXEL_WALLPAPER__ = {
    ready: true,
    processor: processor,
    renderer: renderer,
    settings: NS.settings,
    hostBridge: NS.HostBridge,
    injectAudio: function (host, values, nowMs) {
      return host === "wallpaper-engine"
        ? processor.pushWallpaperEngine(values, nowMs)
        : processor.pushLively(values, nowMs);
    },
    getState: function () {
      return {
        host: NS.HostBridge.host,
        paused: paused,
        syntheticEnabled: syntheticEnabled,
        settings: NS.settings.values,
        renderer: renderer.getDebugState(),
        audio: processor.update(Date.now())
      };
    },
    stop: function () {
      running = false;
      stopSynthetic();
      stopLocalSpectrum();
    }
  };

  document.body.dataset.ready = "true";
})(window);

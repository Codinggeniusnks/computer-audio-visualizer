(function (global) {
  "use strict";

  var NS = global.PurpleVoxelWallpaper = global.PurpleVoxelWallpaper || {};
  var BIN_COUNT = 64;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function finiteNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function averageRange(values, start, end) {
    var total = 0;
    var weightTotal = 0;
    for (var i = start; i < end; i += 1) {
      var normalized = (i - start) / Math.max(1, end - start - 1);
      var weight = 1 + normalized * 0.35;
      total += values[i] * weight;
      weightTotal += weight;
    }
    return weightTotal ? total / weightTotal : 0;
  }

  function AudioProcessor(options) {
    options = options || {};
    this.sensitivity = finiteNumber(options.sensitivity) || 1.35;
    this.motionIntensity = options.motionIntensity == null ? 1 : finiteNumber(options.motionIntensity);
    this.raw = new Float32Array(BIN_COUNT);
    this.smoothed = new Float32Array(BIN_COUNT);
    this.previous = new Float32Array(BIN_COUNT);
    this.autoGain = 1;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.energy = 0;
    this.beat = 0;
    this.lastBeatAt = -Infinity;
    this.lastSignalAt = 0;
    this.lastInputAt = 0;
    this.bassHistory = [];
    this.fluxHistory = [];
    this.ripples = [];
    this.lastFrameAt = 0;
    this.lastAcceptedInput = false;
  }

  AudioProcessor.prototype.setSettings = function (settings) {
    if (settings.sensitivity != null) {
      this.sensitivity = clamp(finiteNumber(settings.sensitivity), 0.5, 3);
    }
    if (settings.motionIntensity != null) {
      this.motionIntensity = clamp(finiteNumber(settings.motionIntensity), 0, 2);
    }
  };

  AudioProcessor.prototype._acceptBins = function (bins, nowMs) {
    if (!bins || bins.length < BIN_COUNT) {
      this.lastAcceptedInput = false;
      return false;
    }

    var sumSquares = 0;
    for (var i = 0; i < BIN_COUNT; i += 1) {
      var sample = clamp(finiteNumber(bins[i]), 0, 1);
      sample = sample < 0.008 ? 0 : sample;
      this.raw[i] = sample;
      sumSquares += sample * sample;
    }

    var rms = Math.sqrt(sumSquares / BIN_COUNT);
    this.lastInputAt = nowMs;
    if (rms > 0.003) {
      this.lastSignalAt = nowMs;
      var requestedGain = clamp(0.24 / (rms + 0.025), 0.65, 3.8);
      var gainRate = requestedGain < this.autoGain ? 0.08 : 0.025;
      this.autoGain += (requestedGain - this.autoGain) * gainRate;
    }

    var gain = this.autoGain * this.sensitivity;
    var flux = 0;
    for (var j = 0; j < BIN_COUNT; j += 1) {
      var target = clamp(this.raw[j] * gain, 0, 1);
      var rate = target > this.smoothed[j] ? 0.48 : 0.105;
      this.previous[j] = this.smoothed[j];
      this.smoothed[j] += (target - this.smoothed[j]) * rate;
      if (j < 12) {
        flux += Math.max(0, this.smoothed[j] - this.previous[j]);
      }
    }

    var nextBass = averageRange(this.smoothed, 0, 9);
    var nextMid = averageRange(this.smoothed, 8, 31);
    var nextTreble = averageRange(this.smoothed, 30, 64);
    this.bass += (nextBass - this.bass) * (nextBass > this.bass ? 0.58 : 0.14);
    this.mid += (nextMid - this.mid) * (nextMid > this.mid ? 0.42 : 0.10);
    this.treble += (nextTreble - this.treble) * (nextTreble > this.treble ? 0.46 : 0.12);
    this.energy = clamp(this.bass * 0.5 + this.mid * 0.33 + this.treble * 0.17, 0, 1);

    flux /= 12;
    this.bassHistory.push(this.bass);
    this.fluxHistory.push(flux);
    if (this.bassHistory.length > 44) this.bassHistory.shift();
    if (this.fluxHistory.length > 44) this.fluxHistory.shift();

    var fluxMean = 0;
    for (var k = 0; k < this.fluxHistory.length; k += 1) fluxMean += this.fluxHistory[k];
    fluxMean /= Math.max(1, this.fluxHistory.length);

    var fluxVariance = 0;
    for (var n = 0; n < this.fluxHistory.length; n += 1) {
      var delta = this.fluxHistory[n] - fluxMean;
      fluxVariance += delta * delta;
    }
    var fluxDeviation = Math.sqrt(fluxVariance / Math.max(1, this.fluxHistory.length));
    var beatThreshold = Math.max(0.018, fluxMean + fluxDeviation * 1.2);
    var canBeat = nowMs - this.lastBeatAt >= 180;

    if (canBeat && this.bass > 0.10 && flux > beatThreshold) {
      var strength = clamp(0.42 + this.bass * 0.92 + flux * 2.4, 0.5, 1.35);
      this.beat = Math.max(this.beat, strength);
      this.lastBeatAt = nowMs;
      this.ripples.push({ phase: 0, strength: strength });
      if (this.ripples.length > 4) this.ripples.shift();
    }

    this.lastAcceptedInput = true;
    return true;
  };

  AudioProcessor.prototype.pushWallpaperEngine = function (audioArray, nowMs) {
    nowMs = nowMs == null ? Date.now() : finiteNumber(nowMs);
    if (!audioArray || audioArray.length < 128) {
      this.lastAcceptedInput = false;
      return false;
    }
    var merged = new Float32Array(BIN_COUNT);
    for (var i = 0; i < BIN_COUNT; i += 1) {
      var left = finiteNumber(audioArray[i]);
      var right = finiteNumber(audioArray[i + BIN_COUNT]);
      merged[i] = clamp((left + right) * 0.5, 0, 1);
    }
    return this._acceptBins(merged, nowMs);
  };

  AudioProcessor.prototype.pushLively = function (audioArray, nowMs) {
    nowMs = nowMs == null ? Date.now() : finiteNumber(nowMs);
    if (!audioArray || audioArray.length < 64) {
      this.lastAcceptedInput = false;
      return false;
    }
    var merged = new Float32Array(BIN_COUNT);
    var sourceLength = audioArray.length;
    for (var i = 0; i < BIN_COUNT; i += 1) {
      var start = Math.floor(i * sourceLength / BIN_COUNT);
      var end = Math.max(start + 1, Math.floor((i + 1) * sourceLength / BIN_COUNT));
      var total = 0;
      for (var j = start; j < end; j += 1) total += finiteNumber(audioArray[j]);
      merged[i] = clamp(total / (end - start), 0, 1);
    }
    return this._acceptBins(merged, nowMs);
  };

  AudioProcessor.prototype.pushNormalized = function (bins, nowMs) {
    return this._acceptBins(bins, nowMs == null ? Date.now() : finiteNumber(nowMs));
  };

  AudioProcessor.prototype.update = function (nowMs) {
    nowMs = nowMs == null ? Date.now() : finiteNumber(nowMs);
    var dt = this.lastFrameAt ? clamp((nowMs - this.lastFrameAt) / 1000, 0, 0.1) : 1 / 60;
    this.lastFrameAt = nowMs;
    this.beat *= Math.exp(-dt * 5.4);

    for (var i = this.ripples.length - 1; i >= 0; i -= 1) {
      this.ripples[i].phase += dt * (0.46 + this.ripples[i].strength * 0.08);
      this.ripples[i].strength *= Math.exp(-dt * 1.18);
      if (this.ripples[i].phase > 1.18 || this.ripples[i].strength < 0.035) {
        this.ripples.splice(i, 1);
      }
    }

    var silentFor = nowMs - this.lastSignalAt;
    var idle = this.lastSignalAt === 0 || silentFor > 1500;
    if (idle) {
      var decay = Math.pow(0.90, dt * 60);
      for (var b = 0; b < BIN_COUNT; b += 1) this.smoothed[b] *= decay;
      this.bass *= decay;
      this.mid *= decay;
      this.treble *= decay;
      this.energy *= decay;
    }

    var ripplePhase = new Float32Array(4);
    var rippleStrength = new Float32Array(4);
    for (var r = 0; r < Math.min(4, this.ripples.length); r += 1) {
      ripplePhase[r] = this.ripples[r].phase;
      rippleStrength[r] = this.ripples[r].strength;
    }

    return {
      bins: this.smoothed,
      bass: clamp(this.bass, 0, 1.25),
      mid: clamp(this.mid, 0, 1.25),
      treble: clamp(this.treble, 0, 1.25),
      energy: clamp(this.energy, 0, 1.25),
      beat: clamp(this.beat, 0, 1.35),
      ripplePhase: ripplePhase,
      rippleStrength: rippleStrength,
      idle: idle,
      autoGain: this.autoGain
    };
  };

  AudioProcessor.prototype.reset = function () {
    this.raw.fill(0);
    this.smoothed.fill(0);
    this.previous.fill(0);
    this.autoGain = 1;
    this.bass = this.mid = this.treble = this.energy = this.beat = 0;
    this.lastBeatAt = -Infinity;
    this.lastSignalAt = 0;
    this.lastInputAt = 0;
    this.lastFrameAt = 0;
    this.ripples.length = 0;
    this.bassHistory.length = 0;
    this.fluxHistory.length = 0;
  };

  NS.AudioProcessor = AudioProcessor;
  NS.AUDIO_BIN_COUNT = BIN_COUNT;
})(typeof window !== "undefined" ? window : globalThis);

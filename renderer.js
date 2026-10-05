(function (global) {
  "use strict";

  var NS = global.PurpleVoxelWallpaper = global.PurpleVoxelWallpaper || {};

  var QUALITY = {
    low: { angular: 80, radial: 48, scale: 0.74 },
    balanced: { angular: 128, radial: 64, scale: 0.86 },
    high: { angular: 160, radial: 72, scale: 1.0 }
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function createShader(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("Shader compile failed: " + message);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    var vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    var fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    var program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error("Program link failed: " + message);
    }
    return program;
  }

  function perspective(out, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  }

  function lookAt(out, eye, center, up) {
    var x0;
    var x1;
    var x2;
    var y0;
    var y1;
    var y2;
    var z0 = eye[0] - center[0];
    var z1 = eye[1] - center[1];
    var z2 = eye[2] - center[2];
    var length = Math.hypot(z0, z1, z2) || 1;
    z0 /= length;
    z1 /= length;
    z2 /= length;

    x0 = up[1] * z2 - up[2] * z1;
    x1 = up[2] * z0 - up[0] * z2;
    x2 = up[0] * z1 - up[1] * z0;
    length = Math.hypot(x0, x1, x2) || 1;
    x0 /= length;
    x1 /= length;
    x2 /= length;

    y0 = z1 * x2 - z2 * x1;
    y1 = z2 * x0 - z0 * x2;
    y2 = z0 * x1 - z1 * x0;

    out[0] = x0;
    out[1] = y0;
    out[2] = z0;
    out[3] = 0;
    out[4] = x1;
    out[5] = y1;
    out[6] = z1;
    out[7] = 0;
    out[8] = x2;
    out[9] = y2;
    out[10] = z2;
    out[11] = 0;
    out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    out[15] = 1;
    return out;
  }

  function createTexture(gl, width, height) {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return texture;
  }

  function resizeTexture(gl, texture, width, height) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  function createColorFramebuffer(gl, texture) {
    var framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return framebuffer;
  }

  function voxelVertexSource() {
    return "#version 300 es\n" +
      "precision highp float;\n" +
      "precision highp int;\n" +
      "layout(location=0) in vec3 aPosition;\n" +
      "layout(location=1) in vec3 aNormal;\n" +
      "uniform mat4 uProjection;\n" +
      "uniform mat4 uView;\n" +
      "uniform float uTime;\n" +
      "uniform float uMotion;\n" +
      "uniform float uIdle;\n" +
      "uniform int uAngularSegments;\n" +
      "uniform int uRadialSegments;\n" +
      "uniform float uAudio[64];\n" +
      "uniform vec4 uBands;\n" +
      "uniform vec4 uRipplePhase;\n" +
      "uniform vec4 uRippleStrength;\n" +
      "out vec3 vNormal;\n" +
      "out float vHeight;\n" +
      "out float vEnergy;\n" +
      "out float vSpark;\n" +
      "const float TAU=6.28318530718;\n" +
      "float hash(float n){return fract(sin(n*91.173+17.27)*43758.5453);}\n" +
      "void main(){\n" +
      "  int ring=gl_InstanceID/uAngularSegments;\n" +
      "  int segment=gl_InstanceID-ring*uAngularSegments;\n" +
      "  float rn=(float(ring)+0.5)/float(uRadialSegments);\n" +
      "  float sn=(float(segment)+0.5)/float(uAngularSegments);\n" +
      "  float theta=sn*TAU+rn*0.16*sin(uTime*0.11);\n" +
      "  float radius=mix(0.38,5.55,rn);\n" +
      "  int audioIndex=int(clamp(floor(pow(rn,1.18)*63.0),0.0,63.0));\n" +
      "  float spectrum=uAudio[audioIndex];\n" +
      "  float bass=uBands.x; float mid=uBands.y; float treble=uBands.z; float beat=uBands.w;\n" +
      "  float spiralA=pow(max(0.0,0.5+0.5*sin(theta*2.0-rn*18.0+uTime*0.78)),3.0);\n" +
      "  float spiralB=pow(max(0.0,0.5+0.5*sin(theta*3.0+rn*23.0-uTime*0.54)),5.0);\n" +
      "  float rings=0.5+0.5*sin(rn*42.0-uTime*0.85+bass*3.0);\n" +
      "  float ripple=0.0;\n" +
      "  for(int i=0;i<4;i++){\n" +
      "    float d=rn-uRipplePhase[i];\n" +
      "    ripple+=exp(-d*d*470.0)*uRippleStrength[i];\n" +
      "  }\n" +
      "  float idleWave=(0.5+0.5*sin(theta*2.0-rn*13.0+uTime*0.34))*(0.5+0.5*sin(rn*26.0-uTime*0.28));\n" +
      "  float noise=hash(float(gl_InstanceID))*0.13;\n" +
      "  float reactive=spectrum*1.18+bass*0.40*rings+mid*0.53*spiralA+treble*0.43*spiralB+ripple*0.94;\n" +
      "  float idleEnergy=uIdle*(0.08+idleWave*0.16);\n" +
      "  float height=0.045+(reactive*uMotion+idleEnergy+noise*(0.18+mid))*1.62;\n" +
      "  height=clamp(height,0.045,2.95);\n" +
      "  vec2 radial=vec2(cos(theta),sin(theta));\n" +
      "  vec2 tangent=vec2(-radial.y,radial.x);\n" +
      "  float radialStep=5.17/float(uRadialSegments);\n" +
      "  float angularStep=TAU*radius/float(uAngularSegments);\n" +
      "  float tangentWidth=clamp(angularStep*0.76,0.026,0.20);\n" +
      "  float radialWidth=radialStep*0.76;\n" +
      "  vec2 center=radial*radius;\n" +
      "  vec2 xz=center+tangent*(aPosition.x*tangentWidth)+radial*(aPosition.z*radialWidth);\n" +
      "  vec3 world=vec3(xz.x,aPosition.y*height,xz.y);\n" +
      "  vNormal=normalize(vec3(tangent.x*aNormal.x+radial.x*aNormal.z,aNormal.y,tangent.y*aNormal.x+radial.y*aNormal.z));\n" +
      "  vHeight=height;\n" +
      "  vEnergy=clamp(reactive+idleEnergy,0.0,1.6);\n" +
      "  vSpark=clamp((treble*spiralB+spectrum*0.7+ripple*0.45)*smoothstep(0.62,1.4,height),0.0,1.4);\n" +
      "  gl_Position=uProjection*uView*vec4(world,1.0);\n" +
      "}\n";
  }

  function voxelFragmentSource() {
    return "#version 300 es\n" +
      "precision highp float;\n" +
      "in vec3 vNormal;\n" +
      "in float vHeight;\n" +
      "in float vEnergy;\n" +
      "in float vSpark;\n" +
      "uniform vec3 uPrimaryColor;\n" +
      "out vec4 outColor;\n" +
      "void main(){\n" +
      "  vec3 n=normalize(vNormal);\n" +
      "  float diffuse=0.28+0.72*max(dot(n,normalize(vec3(-0.28,0.88,0.38))),0.0);\n" +
      "  float rim=pow(1.0-max(n.y,0.0),2.0)*0.20;\n" +
      "  vec3 dark=uPrimaryColor*vec3(0.13,0.055,0.19);\n" +
      "  vec3 base=mix(dark,uPrimaryColor,clamp(vEnergy*0.78+vHeight*0.12,0.0,1.0));\n" +
      "  float hot=smoothstep(0.55,1.28,vSpark+vHeight*0.22);\n" +
      "  vec3 color=mix(base,vec3(1.0,0.82,1.0),hot);\n" +
      "  color*=diffuse+rim+0.18;\n" +
      "  color+=uPrimaryColor*pow(max(n.y,0.0),5.0)*(0.18+vEnergy*0.38);\n" +
      "  outColor=vec4(color,1.0);\n" +
      "}\n";
  }

  var FULLSCREEN_VERTEX = "#version 300 es\n" +
    "precision highp float;\n" +
    "out vec2 vUv;\n" +
    "void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.0-1.0,0.0,1.0);}\n";

  var BRIGHT_FRAGMENT = "#version 300 es\n" +
    "precision highp float;\n" +
    "in vec2 vUv; uniform sampler2D uTexture; out vec4 outColor;\n" +
    "void main(){vec3 c=texture(uTexture,vUv).rgb;float b=smoothstep(0.28,0.92,max(c.r,max(c.g,c.b)));outColor=vec4(c*b,1.0);}\n";

  var BLUR_FRAGMENT = "#version 300 es\n" +
    "precision highp float;\n" +
    "in vec2 vUv; uniform sampler2D uTexture; uniform vec2 uTexel; uniform vec2 uDirection; out vec4 outColor;\n" +
    "void main(){vec2 o=uTexel*uDirection;vec3 c=texture(uTexture,vUv).rgb*0.227027;" +
    "c+=texture(uTexture,vUv+o*1.384615).rgb*0.316216;c+=texture(uTexture,vUv-o*1.384615).rgb*0.316216;" +
    "c+=texture(uTexture,vUv+o*3.230769).rgb*0.070270;c+=texture(uTexture,vUv-o*3.230769).rgb*0.070270;outColor=vec4(c,1.0);}\n";

  var COMPOSITE_FRAGMENT = "#version 300 es\n" +
    "precision highp float;\n" +
    "in vec2 vUv; uniform sampler2D uScene; uniform sampler2D uBloom; uniform vec3 uBackground; uniform vec3 uPrimary; uniform float uBloomStrength; uniform float uAspect; uniform float uTime; out vec4 outColor;\n" +
    "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n" +
    "void main(){vec2 p=vUv-0.5;p.x*=uAspect;float vignette=smoothstep(1.08,0.18,length(p));" +
    "float glow=exp(-dot(p-vec2(0.0,-0.17),p-vec2(0.0,-0.17))*2.5);" +
    "vec3 bg=uBackground*(0.56+0.44*vignette)+uPrimary*glow*0.025;" +
    "vec2 cell=floor(vUv*vec2(480.0,270.0));float star=step(0.9988,hash(cell))*pow(hash(cell+17.0),8.0)*0.18;bg+=uPrimary*star*vignette;" +
    "vec3 scene=texture(uScene,vUv).rgb;vec3 bloom=texture(uBloom,vUv).rgb*uBloomStrength;" +
    "vec3 color=bg+scene+bloom;color=1.0-exp(-color*1.22);color=pow(color,vec3(0.92));outColor=vec4(color,1.0);}\n";

  function cubeGeometry() {
    var p = [];
    var n = [];
    var indices = [];
    var faces = [
      { n: [0, 1, 0], v: [[-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]] },
      { n: [0, -1, 0], v: [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5]] },
      { n: [1, 0, 0], v: [[0.5, 0, -0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5]] },
      { n: [-1, 0, 0], v: [[-0.5, 0, 0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [-0.5, 1, 0.5]] },
      { n: [0, 0, 1], v: [[0.5, 0, 0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [0.5, 1, 0.5]] },
      { n: [0, 0, -1], v: [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5]] }
    ];
    for (var f = 0; f < faces.length; f += 1) {
      var base = p.length / 3;
      for (var v = 0; v < 4; v += 1) {
        p.push(faces[f].v[v][0], faces[f].v[v][1], faces[f].v[v][2]);
        n.push(faces[f].n[0], faces[f].n[1], faces[f].n[2]);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return { positions: new Float32Array(p), normals: new Float32Array(n), indices: new Uint16Array(indices) };
  }

  function VoxelRenderer(canvas, settings) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance"
    });
    if (!this.gl) throw new Error("WEBGL2_UNAVAILABLE");

    this.settings = settings;
    this.quality = QUALITY[settings.quality] || QUALITY.balanced;
    this.autoScale = 1;
    this.width = 1;
    this.height = 1;
    this.bloomWidth = 1;
    this.bloomHeight = 1;
    this.lastRenderAt = 0;
    this.renderCosts = [];
    this.fpsSamples = [];
    this.fps = 0;
    this.lastScaleChangeAt = 0;
    this.projection = new Float32Array(16);
    this.view = new Float32Array(16);
    this._createPrograms();
    this._createGeometry();
    this._createTargets();
    this.resize(true);
  }

  VoxelRenderer.prototype._createPrograms = function () {
    var gl = this.gl;
    this.voxelProgram = createProgram(gl, voxelVertexSource(), voxelFragmentSource());
    this.brightProgram = createProgram(gl, FULLSCREEN_VERTEX, BRIGHT_FRAGMENT);
    this.blurProgram = createProgram(gl, FULLSCREEN_VERTEX, BLUR_FRAGMENT);
    this.compositeProgram = createProgram(gl, FULLSCREEN_VERTEX, COMPOSITE_FRAGMENT);

    this.voxelUniforms = {};
    var voxelNames = ["uProjection", "uView", "uTime", "uMotion", "uIdle", "uAngularSegments", "uRadialSegments", "uAudio", "uBands", "uRipplePhase", "uRippleStrength", "uPrimaryColor"];
    for (var i = 0; i < voxelNames.length; i += 1) this.voxelUniforms[voxelNames[i]] = gl.getUniformLocation(this.voxelProgram, voxelNames[i]);
  };

  VoxelRenderer.prototype._createGeometry = function () {
    var gl = this.gl;
    var cube = cubeGeometry();
    this.indexCount = cube.indices.length;
    this.voxelVao = gl.createVertexArray();
    gl.bindVertexArray(this.voxelVao);

    var positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cube.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    var normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cube.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cube.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  };

  VoxelRenderer.prototype._createTargets = function () {
    var gl = this.gl;
    this.sceneTexture = createTexture(gl, 1, 1);
    this.sceneFramebuffer = createColorFramebuffer(gl, this.sceneTexture);
    this.sceneDepth = gl.createRenderbuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFramebuffer);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 1, 1);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepth);

    this.bloomTextureA = createTexture(gl, 1, 1);
    this.bloomTextureB = createTexture(gl, 1, 1);
    this.bloomFramebufferA = createColorFramebuffer(gl, this.bloomTextureA);
    this.bloomFramebufferB = createColorFramebuffer(gl, this.bloomTextureB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  VoxelRenderer.prototype.setSettings = function (settings, changedKeys) {
    this.settings = settings;
    if (!changedKeys || changedKeys.indexOf("quality") >= 0) {
      this.quality = QUALITY[settings.quality] || QUALITY.balanced;
      this.autoScale = 1;
      this.resize(true);
    }
  };

  VoxelRenderer.prototype.resize = function (force) {
    var gl = this.gl;
    var cssWidth = Math.max(1, this.canvas.clientWidth || global.innerWidth || 1920);
    var cssHeight = Math.max(1, this.canvas.clientHeight || global.innerHeight || 1080);
    var dpr = Math.min(global.devicePixelRatio || 1, 1.25);
    var scale = this.quality.scale * this.autoScale;
    var width = Math.max(2, Math.round(cssWidth * dpr * scale));
    var height = Math.max(2, Math.round(cssHeight * dpr * scale));
    if (!force && width === this.width && height === this.height) return false;

    this.width = width;
    this.height = height;
    this.bloomWidth = Math.max(2, Math.round(width * 0.5));
    this.bloomHeight = Math.max(2, Math.round(height * 0.5));
    this.canvas.width = width;
    this.canvas.height = height;

    resizeTexture(gl, this.sceneTexture, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    resizeTexture(gl, this.bloomTextureA, this.bloomWidth, this.bloomHeight);
    resizeTexture(gl, this.bloomTextureB, this.bloomWidth, this.bloomHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  };

  VoxelRenderer.prototype._bindTexture = function (texture, unit, location) {
    var gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
  };

  VoxelRenderer.prototype._drawVoxels = function (time, audio) {
    var gl = this.gl;
    var q = this.quality;
    var bass = audio.bass * this.settings.motionIntensity;
    var orbit = time * 0.024 + audio.mid * 0.045;
    var distance = 9.25 - bass * 0.42;
    var eye = [Math.sin(orbit) * distance, 6.45 + audio.beat * 0.14, Math.cos(orbit) * distance];
    var aspect = this.width / this.height;
    perspective(this.projection, Math.PI / 3.18, aspect, 0.1, 40);
    lookAt(this.view, eye, [0, 1.05, 0], [0, 1, 0]);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFramebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.voxelProgram);
    gl.bindVertexArray(this.voxelVao);

    var u = this.voxelUniforms;
    gl.uniformMatrix4fv(u.uProjection, false, this.projection);
    gl.uniformMatrix4fv(u.uView, false, this.view);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uMotion, this.settings.motionIntensity);
    gl.uniform1f(u.uIdle, audio.idle && this.settings.idleMotion ? 1 : 0);
    gl.uniform1i(u.uAngularSegments, q.angular);
    gl.uniform1i(u.uRadialSegments, q.radial);
    gl.uniform1fv(u.uAudio, audio.bins);
    gl.uniform4f(u.uBands, audio.bass, audio.mid, audio.treble, audio.beat);
    gl.uniform4fv(u.uRipplePhase, audio.ripplePhase);
    gl.uniform4fv(u.uRippleStrength, audio.rippleStrength);
    gl.uniform3fv(u.uPrimaryColor, this.settings.primaryColor);
    gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, q.angular * q.radial);
    gl.bindVertexArray(null);
  };

  VoxelRenderer.prototype._drawBloom = function () {
    var gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.viewport(0, 0, this.bloomWidth, this.bloomHeight);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFramebufferA);
    gl.useProgram(this.brightProgram);
    this._bindTexture(this.sceneTexture, 0, gl.getUniformLocation(this.brightProgram, "uTexture"));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFramebufferB);
    gl.useProgram(this.blurProgram);
    this._bindTexture(this.bloomTextureA, 0, gl.getUniformLocation(this.blurProgram, "uTexture"));
    gl.uniform2f(gl.getUniformLocation(this.blurProgram, "uTexel"), 1 / this.bloomWidth, 1 / this.bloomHeight);
    gl.uniform2f(gl.getUniformLocation(this.blurProgram, "uDirection"), 1, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFramebufferA);
    this._bindTexture(this.bloomTextureB, 0, gl.getUniformLocation(this.blurProgram, "uTexture"));
    gl.uniform2f(gl.getUniformLocation(this.blurProgram, "uDirection"), 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  VoxelRenderer.prototype._drawComposite = function (time) {
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.compositeProgram);
    this._bindTexture(this.sceneTexture, 0, gl.getUniformLocation(this.compositeProgram, "uScene"));
    this._bindTexture(this.bloomTextureA, 1, gl.getUniformLocation(this.compositeProgram, "uBloom"));
    gl.uniform3fv(gl.getUniformLocation(this.compositeProgram, "uBackground"), this.settings.backgroundColor);
    gl.uniform3fv(gl.getUniformLocation(this.compositeProgram, "uPrimary"), this.settings.primaryColor);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, "uBloomStrength"), this.settings.bloom ? 1.23 : 0);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, "uAspect"), this.width / this.height);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, "uTime"), time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  VoxelRenderer.prototype._trackPerformance = function (renderCost, timestamp) {
    this.renderCosts.push(renderCost);
    if (this.renderCosts.length > 180) this.renderCosts.shift();
    this.fpsSamples.push(timestamp);
    while (this.fpsSamples.length && timestamp - this.fpsSamples[0] > 1000) this.fpsSamples.shift();
    this.fps = this.fpsSamples.length;

    if (this.renderCosts.length < 150 || timestamp - this.lastScaleChangeAt < 5000) return;
    var total = 0;
    for (var i = 0; i < this.renderCosts.length; i += 1) total += this.renderCosts[i];
    var average = total / this.renderCosts.length;
    var nextScale = this.autoScale;
    if (average > 18.5 && this.autoScale > 0.60) nextScale = Math.max(0.60, this.autoScale - 0.10);
    else if (average < 10.5 && this.autoScale < 1 && timestamp - this.lastScaleChangeAt > 9000) nextScale = Math.min(1, this.autoScale + 0.05);
    if (nextScale !== this.autoScale) {
      this.autoScale = nextScale;
      this.lastScaleChangeAt = timestamp;
      this.resize(true);
      this.renderCosts.length = 0;
    }
  };

  VoxelRenderer.prototype.render = function (timestamp, audio) {
    var minInterval = this.settings.fpsLimit === 30 ? 1000 / 30 : 1000 / 60;
    if (this.lastRenderAt && timestamp - this.lastRenderAt < minInterval - 1.5) return false;
    var started = global.performance && performance.now ? performance.now() : Date.now();
    this.lastRenderAt = timestamp;
    this.resize(false);
    var time = timestamp / 1000;
    this._drawVoxels(time, audio);
    if (this.settings.bloom) this._drawBloom();
    this._drawComposite(time);
    var finished = global.performance && performance.now ? performance.now() : Date.now();
    this._trackPerformance(finished - started, timestamp);
    return true;
  };

  VoxelRenderer.prototype.getDebugState = function () {
    var renderTotal = 0;
    for (var i = 0; i < this.renderCosts.length; i += 1) renderTotal += this.renderCosts[i];
    return {
      width: this.width,
      height: this.height,
      bloomWidth: this.bloomWidth,
      bloomHeight: this.bloomHeight,
      fps: this.fps,
      quality: this.settings.quality,
      angularSegments: this.quality.angular,
      radialSegments: this.quality.radial,
      instanceCount: this.quality.angular * this.quality.radial,
      autoScale: this.autoScale,
      averageRenderCost: this.renderCosts.length ? renderTotal / this.renderCosts.length : 0,
      webglVersion: this.gl.getParameter(this.gl.VERSION)
    };
  };

  NS.VoxelRenderer = VoxelRenderer;
  NS.QUALITY_PRESETS = QUALITY;
})(typeof window !== "undefined" ? window : globalThis);

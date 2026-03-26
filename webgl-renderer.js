// High-performance WebGL2 renderer with instanced drawing
// One draw call per entity type, pre-allocated GPU buffers, cached locations

class WebGLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false };
        this.gl = canvas.getContext('webgl2', opts);
        if (!this.gl) throw new Error('WebGL2 not supported');

        const gl = this.gl;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Max instances we'll ever need
        this.MAX_SHIPS = 2048;
        this.MAX_CIRCLES = 256;
        this.MAX_LINES = 4096;

        this._initShipProgram();
        this._initCircleProgram();
        this._initLineProgram();

        // Pre-allocate JS-side typed arrays (avoid GC)
        this._shipData = new Float32Array(this.MAX_SHIPS * 5); // x, y, rotation, colorIdx, alpha
        this._circleData = new Float32Array(this.MAX_CIRCLES * 5); // x, y, radius, colorIdx, alpha
        this._linePositions = new Float32Array(this.MAX_LINES * 4); // x1,y1, x2,y2
        this._lineColors = new Float32Array(this.MAX_LINES * 8); // rgba * 2 verts

        // Color palette as uniform: index -> rgba
        this.colorPalette = new Float32Array(32 * 4); // up to 32 colors
        this._colorCount = 0;
        this._colorMap = {};
    }

    // Register a hex color, returns index
    registerColor(hex) {
        if (this._colorMap[hex] !== undefined) return this._colorMap[hex];
        const idx = this._colorCount++;
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        const off = idx * 4;
        this.colorPalette[off] = r;
        this.colorPalette[off + 1] = g;
        this.colorPalette[off + 2] = b;
        this.colorPalette[off + 3] = 1.0;
        this._colorMap[hex] = idx;
        return idx;
    }

    // ===== SHIP INSTANCED RENDERING =====
    _initShipProgram() {
        const gl = this.gl;

        const vs = `#version 300 es
        // Per-vertex (the unit triangle)
        in vec2 a_vertex;
        // Per-instance
        in vec2 a_pos;
        in float a_rot;
        in float a_colorIdx;
        in float a_alpha;

        uniform vec2 u_res;
        uniform vec2 u_cam;
        uniform float u_zoom;
        uniform vec4 u_colors[32];

        out vec4 v_color;

        void main() {
            float c = cos(a_rot), s = sin(a_rot);
            vec2 rotated = vec2(a_vertex.x * c - a_vertex.y * s, a_vertex.x * s + a_vertex.y * c);
            vec2 world = a_pos + rotated;
            vec2 screen = world * u_zoom + u_cam;
            vec2 clip = (screen / u_res) * 2.0 - 1.0;
            clip.y *= -1.0;
            gl_Position = vec4(clip, 0.0, 1.0);
            int ci = int(a_colorIdx);
            v_color = vec4(u_colors[ci].rgb, a_alpha);
        }`;

        const fs = `#version 300 es
        precision lowp float;
        in vec4 v_color;
        out vec4 outColor;
        void main() { outColor = v_color; }`;

        const prog = this._createProgram(vs, fs);
        this.shipProg = prog;

        // Cache locations
        this.shipLoc = {
            a_vertex: gl.getAttribLocation(prog, 'a_vertex'),
            a_pos: gl.getAttribLocation(prog, 'a_pos'),
            a_rot: gl.getAttribLocation(prog, 'a_rot'),
            a_colorIdx: gl.getAttribLocation(prog, 'a_colorIdx'),
            a_alpha: gl.getAttribLocation(prog, 'a_alpha'),
            u_res: gl.getUniformLocation(prog, 'u_res'),
            u_cam: gl.getUniformLocation(prog, 'u_cam'),
            u_zoom: gl.getUniformLocation(prog, 'u_zoom'),
            u_colors: gl.getUniformLocation(prog, 'u_colors'),
        };

        // Unit triangle geometry (ship shape pointing right)
        const triVerts = new Float32Array([6, 0, -4, -4, -4, 4]);
        this.shipTriBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.shipTriBuf);
        gl.bufferData(gl.ARRAY_BUFFER, triVerts, gl.STATIC_DRAW);

        // Instance buffer (dynamic)
        this.shipInstBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.shipInstBuf);
        gl.bufferData(gl.ARRAY_BUFFER, this.MAX_SHIPS * 5 * 4, gl.DYNAMIC_DRAW);

        // VAO
        this.shipVAO = gl.createVertexArray();
        gl.bindVertexArray(this.shipVAO);

        // Vertex attrib (per-vertex)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.shipTriBuf);
        gl.enableVertexAttribArray(this.shipLoc.a_vertex);
        gl.vertexAttribPointer(this.shipLoc.a_vertex, 2, gl.FLOAT, false, 0, 0);

        // Instance attribs
        gl.bindBuffer(gl.ARRAY_BUFFER, this.shipInstBuf);
        const stride = 5 * 4;
        gl.enableVertexAttribArray(this.shipLoc.a_pos);
        gl.vertexAttribPointer(this.shipLoc.a_pos, 2, gl.FLOAT, false, stride, 0);
        gl.vertexAttribDivisor(this.shipLoc.a_pos, 1);

        gl.enableVertexAttribArray(this.shipLoc.a_rot);
        gl.vertexAttribPointer(this.shipLoc.a_rot, 1, gl.FLOAT, false, stride, 8);
        gl.vertexAttribDivisor(this.shipLoc.a_rot, 1);

        gl.enableVertexAttribArray(this.shipLoc.a_colorIdx);
        gl.vertexAttribPointer(this.shipLoc.a_colorIdx, 1, gl.FLOAT, false, stride, 12);
        gl.vertexAttribDivisor(this.shipLoc.a_colorIdx, 1);

        gl.enableVertexAttribArray(this.shipLoc.a_alpha);
        gl.vertexAttribPointer(this.shipLoc.a_alpha, 1, gl.FLOAT, false, stride, 16);
        gl.vertexAttribDivisor(this.shipLoc.a_alpha, 1);

        gl.bindVertexArray(null);
    }

    renderShips(count) {
        if (count === 0) return;
        const gl = this.gl;
        gl.useProgram(this.shipProg);
        gl.uniform2f(this.shipLoc.u_res, this.canvas.width, this.canvas.height);
        gl.uniform2f(this.shipLoc.u_cam, this._camX, this._camY);
        gl.uniform1f(this.shipLoc.u_zoom, this._camZoom);
        gl.uniform4fv(this.shipLoc.u_colors, this.colorPalette);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.shipInstBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._shipData.subarray(0, count * 5));

        gl.bindVertexArray(this.shipVAO);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, count);
        gl.bindVertexArray(null);
    }

    // ===== CIRCLE INSTANCED RENDERING (planets) =====
    _initCircleProgram() {
        const gl = this.gl;
        const SEGMENTS = 24;

        const vs = `#version 300 es
        in vec2 a_vertex;
        in vec2 a_pos;
        in float a_radius;
        in float a_colorIdx;
        in float a_alpha;

        uniform vec2 u_res;
        uniform vec2 u_cam;
        uniform float u_zoom;
        uniform vec4 u_colors[32];

        out vec4 v_color;

        void main() {
            vec2 world = a_pos + a_vertex * a_radius;
            vec2 screen = world * u_zoom + u_cam;
            vec2 clip = (screen / u_res) * 2.0 - 1.0;
            clip.y *= -1.0;
            gl_Position = vec4(clip, 0.0, 1.0);
            int ci = int(a_colorIdx);
            v_color = vec4(u_colors[ci].rgb, a_alpha);
        }`;

        const fs = `#version 300 es
        precision lowp float;
        in vec4 v_color;
        out vec4 outColor;
        void main() { outColor = v_color; }`;

        const prog = this._createProgram(vs, fs);
        this.circleProg = prog;

        this.circleLoc = {
            a_vertex: gl.getAttribLocation(prog, 'a_vertex'),
            a_pos: gl.getAttribLocation(prog, 'a_pos'),
            a_radius: gl.getAttribLocation(prog, 'a_radius'),
            a_colorIdx: gl.getAttribLocation(prog, 'a_colorIdx'),
            a_alpha: gl.getAttribLocation(prog, 'a_alpha'),
            u_res: gl.getUniformLocation(prog, 'u_res'),
            u_cam: gl.getUniformLocation(prog, 'u_cam'),
            u_zoom: gl.getUniformLocation(prog, 'u_zoom'),
            u_colors: gl.getUniformLocation(prog, 'u_colors'),
        };

        // Unit circle geometry (triangle fan as triangles)
        const verts = [];
        for (let i = 0; i < SEGMENTS; i++) {
            const a1 = (i / SEGMENTS) * Math.PI * 2;
            const a2 = ((i + 1) / SEGMENTS) * Math.PI * 2;
            verts.push(0, 0);
            verts.push(Math.cos(a1), Math.sin(a1));
            verts.push(Math.cos(a2), Math.sin(a2));
        }
        this.circleVertCount = SEGMENTS * 3;

        this.circleGeomBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.circleGeomBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);

        this.circleInstBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.circleInstBuf);
        gl.bufferData(gl.ARRAY_BUFFER, this.MAX_CIRCLES * 5 * 4, gl.DYNAMIC_DRAW);

        this.circleVAO = gl.createVertexArray();
        gl.bindVertexArray(this.circleVAO);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.circleGeomBuf);
        gl.enableVertexAttribArray(this.circleLoc.a_vertex);
        gl.vertexAttribPointer(this.circleLoc.a_vertex, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.circleInstBuf);
        const cStride = 5 * 4;
        gl.enableVertexAttribArray(this.circleLoc.a_pos);
        gl.vertexAttribPointer(this.circleLoc.a_pos, 2, gl.FLOAT, false, cStride, 0);
        gl.vertexAttribDivisor(this.circleLoc.a_pos, 1);

        gl.enableVertexAttribArray(this.circleLoc.a_radius);
        gl.vertexAttribPointer(this.circleLoc.a_radius, 1, gl.FLOAT, false, cStride, 8);
        gl.vertexAttribDivisor(this.circleLoc.a_radius, 1);

        gl.enableVertexAttribArray(this.circleLoc.a_colorIdx);
        gl.vertexAttribPointer(this.circleLoc.a_colorIdx, 1, gl.FLOAT, false, cStride, 12);
        gl.vertexAttribDivisor(this.circleLoc.a_colorIdx, 1);

        gl.enableVertexAttribArray(this.circleLoc.a_alpha);
        gl.vertexAttribPointer(this.circleLoc.a_alpha, 1, gl.FLOAT, false, cStride, 16);
        gl.vertexAttribDivisor(this.circleLoc.a_alpha, 1);

        gl.bindVertexArray(null);
    }

    renderCircles(count) {
        if (count === 0) return;
        const gl = this.gl;
        gl.useProgram(this.circleProg);
        gl.uniform2f(this.circleLoc.u_res, this.canvas.width, this.canvas.height);
        gl.uniform2f(this.circleLoc.u_cam, this._camX, this._camY);
        gl.uniform1f(this.circleLoc.u_zoom, this._camZoom);
        gl.uniform4fv(this.circleLoc.u_colors, this.colorPalette);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.circleInstBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._circleData.subarray(0, count * 5));

        gl.bindVertexArray(this.circleVAO);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, this.circleVertCount, count);
        gl.bindVertexArray(null);
    }

    // ===== LINE RENDERING (connections, attack beams) =====
    _initLineProgram() {
        const gl = this.gl;

        const vs = `#version 300 es
        in vec2 a_position;
        in vec4 a_color;

        uniform vec2 u_res;
        uniform vec2 u_cam;
        uniform float u_zoom;

        out vec4 v_color;

        void main() {
            vec2 screen = a_position * u_zoom + u_cam;
            vec2 clip = (screen / u_res) * 2.0 - 1.0;
            clip.y *= -1.0;
            gl_Position = vec4(clip, 0.0, 1.0);
            v_color = a_color;
        }`;

        const fs = `#version 300 es
        precision lowp float;
        in vec4 v_color;
        out vec4 outColor;
        void main() { outColor = v_color; }`;

        const prog = this._createProgram(vs, fs);
        this.lineProg = prog;

        this.lineLoc = {
            a_position: gl.getAttribLocation(prog, 'a_position'),
            a_color: gl.getAttribLocation(prog, 'a_color'),
            u_res: gl.getUniformLocation(prog, 'u_res'),
            u_cam: gl.getUniformLocation(prog, 'u_cam'),
            u_zoom: gl.getUniformLocation(prog, 'u_zoom'),
        };

        this.linePosBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuf);
        gl.bufferData(gl.ARRAY_BUFFER, this.MAX_LINES * 4 * 4, gl.DYNAMIC_DRAW);

        this.lineColBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColBuf);
        gl.bufferData(gl.ARRAY_BUFFER, this.MAX_LINES * 8 * 4, gl.DYNAMIC_DRAW);

        this.lineVAO = gl.createVertexArray();
        gl.bindVertexArray(this.lineVAO);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuf);
        gl.enableVertexAttribArray(this.lineLoc.a_position);
        gl.vertexAttribPointer(this.lineLoc.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColBuf);
        gl.enableVertexAttribArray(this.lineLoc.a_color);
        gl.vertexAttribPointer(this.lineLoc.a_color, 4, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
    }

    renderLines(lineCount) {
        if (lineCount === 0) return;
        const gl = this.gl;
        gl.useProgram(this.lineProg);
        gl.uniform2f(this.lineLoc.u_res, this.canvas.width, this.canvas.height);
        gl.uniform2f(this.lineLoc.u_cam, this._camX, this._camY);
        gl.uniform1f(this.lineLoc.u_zoom, this._camZoom);

        const vertCount = lineCount * 2;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._linePositions.subarray(0, vertCount * 2));

        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._lineColors.subarray(0, vertCount * 4));

        gl.bindVertexArray(this.lineVAO);
        gl.drawArrays(gl.LINES, 0, vertCount);
        gl.bindVertexArray(null);
    }

    // ===== HELPERS =====
    setCamera(x, y, zoom) {
        this._camX = x;
        this._camY = y;
        this._camZoom = zoom;
    }

    clear() {
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0.039, 0.055, 0.153, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    _createProgram(vsSrc, fsSrc) {
        const gl = this.gl;
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSrc);
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            console.error('VS:', gl.getShaderInfoLog(vs));
        }
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSrc);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            console.error('FS:', gl.getShaderInfoLog(fs));
        }
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Link:', gl.getProgramInfoLog(prog));
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        return prog;
    }

    destroy() {
        const gl = this.gl;
        gl.deleteProgram(this.shipProg);
        gl.deleteProgram(this.circleProg);
        gl.deleteProgram(this.lineProg);
    }
}

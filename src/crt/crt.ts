import { VERT, FRAG } from "./shaders";
import type { CRTState } from "../state/types";
import { CANVAS_W, CANVAS_H } from "../state/types";

// Animated WebGL2 CRT post-process. Samples a source canvas (the composited
// 800x600 pipeline output) with NEAREST filtering and renders effects into its
// own canvas in a requestAnimationFrame loop.

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("CRT shader compile failed: " + log);
  }
  return sh;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

export class CRTRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private tex: WebGLTexture;
  private u: Uniforms;
  private source: HTMLCanvasElement | null = null;
  private params: CRTState | null = null;
  private raf = 0;
  private startT = performance.now();

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // lets us read frames back for export
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("CRT link failed: " + gl.getProgramInfoLog(prog));
    }
    this.program = prog;

    // fullscreen triangle-strip quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.useProgram(prog);
    const names = [
      "u_tex", "u_texRes", "u_time", "u_barrel", "u_scanline",
      "u_glow", "u_aberration", "u_vignette", "u_flicker", "u_mask",
    ];
    this.u = {};
    for (const n of names) this.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(this.u.u_tex, 0);
  }

  setSource(c: HTMLCanvasElement) {
    this.source = c;
  }
  setParams(p: CRTState) {
    this.params = p;
  }

  /** Set the live drawing-buffer size (output resolution in device pixels). */
  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = Math.max(1, Math.round(w));
      this.canvas.height = Math.max(1, Math.round(h));
    }
  }

  private draw(timeSec: number) {
    const gl = this.gl;
    if (!this.source || !this.params) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.source
    );

    const p = this.params;
    gl.uniform2f(this.u.u_texRes, CANVAS_W, CANVAS_H);
    gl.uniform1f(this.u.u_time, timeSec);
    gl.uniform1f(this.u.u_barrel, p.barrel);
    gl.uniform1f(this.u.u_scanline, p.scanline);
    gl.uniform1f(this.u.u_glow, p.glow);
    gl.uniform1f(this.u.u_aberration, p.aberration);
    gl.uniform1f(this.u.u_vignette, p.vignette);
    gl.uniform1f(this.u.u_flicker, p.flicker);
    gl.uniform1f(this.u.u_mask, p.mask);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  start() {
    if (this.raf) return;
    const loop = () => {
      this.draw((performance.now() - this.startT) / 1000);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /**
   * Render one frozen frame at (800*scale x 600*scale) and read it back into a
   * fresh 2D canvas for export. Restores the live size afterward.
   */
  grab(scale: number): HTMLCanvasElement {
    const gl = this.gl;
    const w = CANVAS_W * scale;
    const h = CANVAS_H * scale;
    const liveW = this.canvas.width;
    const liveH = this.canvas.height;
    this.resize(w, h);
    this.draw((performance.now() - this.startT) / 1000);

    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    // readPixels is bottom-up; flip rows into the ImageData.
    const row = w * 4;
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * row;
      img.data.set(pixels.subarray(src, src + row), y * row);
    }
    ctx.putImageData(img, 0, 0);

    this.resize(liveW, liveH);
    return out;
  }

  dispose() {
    this.stop();
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteProgram(this.program);
  }
}

import { useEffect, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  RingGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  WireframeGeometry,
} from 'three'

// варианты фоновой 3D-сцены (выбор в BgPicker, дефолт ridge)
export type BgVariant = 'ridge' | 'dots' | 'shapes' | 'wire' | 'contours'

// палитра эдиториала: на тёмной теме чернила становятся бумагой и наоборот
type Palette = { ink: number; red: number; blue: number }
const LIGHT: Palette = { ink: 0x16140f, red: 0xc8341f, blue: 0x2b4a8f }
const DARK: Palette = { ink: 0xd8d2c4, red: 0xe05a42, blue: 0x7d9fe0 }

type Built = {
  object: Object3D
  // материалы с временем: анимация живёт в вершинном шейдере, CPU только тикает
  shaders: readonly ShaderMaterial[]
  update?: (t: number) => void
  resize?: (height: number) => void
}

const solidFragment = `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() { gl_FragColor = vec4(uColor, uOpacity); }
`

const varyingFragment = `
  varying vec3 vColor;
  uniform float uOpacity;
  void main() { gl_FragColor = vec4(vColor, uOpacity); }
`

// ридж-волны: стопка профилей (осциллограф), центральная линия акцентная
const buildRidge = (mobile: boolean, palette: Palette): Built => {
  const rows = mobile ? 22 : 34
  const cols = mobile ? 80 : 120
  const w = 15
  const d = 9
  const g = new Group()
  const shaders: ShaderMaterial[] = []
  const vertex = `
    uniform float uTime;
    attribute float aRow;
    void main() {
      vec3 p = position;
      float env = exp(-pow(p.x / 4.2, 2.0));
      float y = (sin(p.x * 1.1 - uTime * 1.3 + aRow * 0.34) * 0.2
               + sin(p.x * 2.7 + uTime * 0.9 + aRow * 0.2) * 0.09) * (0.35 + env * 1.2);
      p.y = y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `
  for (let r = 0; r < rows; r++) {
    const pos = new Float32Array(cols * 3)
    const row = new Float32Array(cols)
    for (let c = 0; c < cols; c++) {
      pos[c * 3] = -w / 2 + (c / (cols - 1)) * w
      pos[c * 3 + 2] = d / 2 - (r / (rows - 1)) * d
      row[c] = r
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('aRow', new BufferAttribute(row, 1))
    const mid = r === Math.floor(rows / 2)
    const mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(mid ? palette.red : palette.ink) },
        uOpacity: { value: mid ? 0.95 : 0.42 },
      },
      vertexShader: vertex,
      fragmentShader: solidFragment,
      transparent: true,
    })
    const line = new Line(geo, mat)
    line.frustumCulled = false // вершины смещаются в шейдере, bounding-sphere врёт
    g.add(line)
    shaders.push(mat)
  }
  g.rotation.x = -1.0
  g.position.y = -0.6
  return { object: g, shaders }
}

// полутон-волна: сетка точек, гребни красные, впадины синие
const buildDots = (mobile: boolean, palette: Palette): Built => {
  const nx = mobile ? 48 : 72
  const ny = mobile ? 30 : 46
  const w = 18
  const h = 11
  const count = nx * ny
  const pos = new Float32Array(count * 3)
  let i = 0
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      pos[i * 3] = -w / 2 + (x / (nx - 1)) * w
      pos[i * 3 + 1] = -h / 2 + (y / (ny - 1)) * h
      i++
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  const mat = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.92 },
      uSize: { value: 0.08 },
      uScale: { value: window.innerHeight * 0.5 },
      uInk: { value: new Color(palette.ink) },
      uRed: { value: new Color(palette.red) },
      uBlue: { value: new Color(palette.blue) },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uSize;
      uniform float uScale;
      uniform vec3 uInk;
      uniform vec3 uRed;
      uniform vec3 uBlue;
      varying vec3 vColor;
      void main() {
        vec3 p = position;
        float z = sin(p.x * 0.7 - uTime * 1.2) * 0.5 + cos(p.y * 0.6 + uTime * 0.8) * 0.4;
        p.z = z;
        float level = (z + 0.9) / 1.8;
        vColor = level > 0.72 ? uRed : (level < 0.18 ? uBlue : uInk);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (uScale / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: varyingFragment,
    transparent: true,
  })
  const pts = new Points(geo, mat)
  pts.frustumCulled = false
  pts.rotation.x = -0.6
  return {
    object: pts,
    shaders: [mat],
    resize: (height) => {
      mat.uniforms.uScale.value = height * 0.5
    },
  }
}

// парящие бумажные фигуры (баухаус-коллаж): объектов пять, CPU их тянет легко
const buildShapes = (_mobile: boolean, palette: Palette): Built => {
  const g = new Group()
  const mk = (geo: BufferGeometry, color: number, op: number): Mesh =>
    new Mesh(geo, new MeshBasicMaterial({ color, transparent: true, opacity: op, side: DoubleSide }))
  const items: { m: Mesh; sy: number; baseRot: number }[] = []
  const place = (m: Mesh, x: number, y: number, z: number, rot: number): void => {
    m.position.set(x, y, z)
    m.rotation.z = rot
    g.add(m)
    items.push({ m, sy: y, baseRot: rot })
  }
  place(mk(new RingGeometry(1.2, 1.5, 56, 1, 0, Math.PI), palette.ink, 0.85), -3.4, 1.3, -1, 0.15)
  place(mk(new CircleGeometry(0.95, 56), palette.red, 0.8), 3.3, 1.9, -2.2, 0)
  place(mk(new CircleGeometry(1.05, 3), palette.blue, 0.8), 2.7, -1.7, -1.4, 0.5)
  place(mk(new PlaneGeometry(2.6, 0.16), palette.ink, 0.75), -2.9, -1.9, -0.6, -0.25)
  place(mk(new RingGeometry(0.78, 0.92, 48), palette.ink, 0.5), 0.4, 2.6, -3, 0)
  return {
    object: g,
    shaders: [],
    update: (t) => {
      items.forEach((it, i) => {
        it.m.position.y = it.sy + Math.sin(t * 0.5 + i * 1.3) * 0.28
        it.m.rotation.z = it.baseRot + Math.sin(t * 0.3 + i) * 0.13
      })
    },
  }
}

// вращающийся каркас-икосаэдр с акцентным ядром
const buildWire = (_mobile: boolean, palette: Palette): Built => {
  const g = new Group()
  const outer = new LineSegments(
    new WireframeGeometry(new IcosahedronGeometry(2.5, 1)),
    new LineBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.5 }),
  )
  const inner = new LineSegments(
    new WireframeGeometry(new IcosahedronGeometry(1.3, 0)),
    new LineBasicMaterial({ color: palette.red, transparent: true, opacity: 0.9 }),
  )
  g.add(outer, inner)
  return {
    object: g,
    shaders: [],
    update: (t) => {
      g.rotation.y = t * 0.16
      g.rotation.x = t * 0.07
      inner.rotation.y = -t * 0.32
      inner.rotation.z = t * 0.12
    },
  }
}

// контурная рябь: концентрические контуры расходятся волной
const buildContours = (mobile: boolean, palette: Palette): Built => {
  const ringsN = mobile ? 14 : 20
  const seg = mobile ? 120 : 170
  const maxR = 8
  const g = new Group()
  const shaders: ShaderMaterial[] = []
  const vertex = `
    uniform float uTime;
    attribute float aAngle;
    attribute float aRadius;
    void main() {
      float wob = sin(aAngle * 5.0 + uTime * 0.6 + aRadius) * 0.12 * (aRadius * 0.1);
      float r = aRadius + wob;
      float z = sin(aRadius * 1.1 - uTime * 1.4) * 0.55;
      vec3 p = vec3(cos(aAngle) * r, sin(aAngle) * r, z);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `
  for (let i = 0; i < ringsN; i++) {
    const radius = 0.4 + (i / (ringsN - 1)) * maxR
    const n = seg + 1
    const pos = new Float32Array(n * 3)
    const angle = new Float32Array(n)
    const rad = new Float32Array(n)
    for (let s = 0; s < n; s++) {
      angle[s] = (s / seg) * Math.PI * 2
      rad[s] = radius
      pos[s * 3] = Math.cos(angle[s]) * radius
      pos[s * 3 + 1] = Math.sin(angle[s]) * radius
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('aAngle', new BufferAttribute(angle, 1))
    geo.setAttribute('aRadius', new BufferAttribute(rad, 1))
    const accent = i === 3
    const mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(accent ? palette.red : palette.ink) },
        uOpacity: { value: accent ? 0.95 : Math.max(0.18, 0.55 - (i / ringsN) * 0.3) },
      },
      vertexShader: vertex,
      fragmentShader: solidFragment,
      transparent: true,
    })
    const line = new Line(geo, mat)
    line.frustumCulled = false
    g.add(line)
    shaders.push(mat)
  }
  g.rotation.x = -0.95
  g.position.y = -0.3
  return { object: g, shaders }
}

const BUILDERS: Record<BgVariant, (mobile: boolean, palette: Palette) => Built> = {
  ridge: buildRidge,
  dots: buildDots,
  shapes: buildShapes,
  wire: buildWire,
  contours: buildContours,
}

const disposeObject = (object: Object3D): void => {
  object.traverse((o) => {
    const m = o as Mesh
    m.geometry?.dispose?.()
    const mat = m.material
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose?.()
  })
}

// фоновая 3D-сцена на чистом three.js: прозрачный canvas строго позади контента.
// three сам создаёт canvas (а не переиспользуем общий) - устойчиво к двойному
// монтированию эффекта в StrictMode, иначе второй рендерер бьётся о погашенный контекст
export const Scene3D = ({ variant, dark }: { variant: BgVariant; dark: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const mobile = window.matchMedia('(max-width: 700px)').matches

    const renderer = new WebGLRenderer({ antialias: !mobile, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    const canvas = renderer.domElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)
    const scene = new Scene()
    const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
    camera.position.set(0, 0, 8)

    const built = BUILDERS[variant](mobile, dark ? DARK : LIGHT)
    scene.add(built.object)

    const resize = (): void => {
      renderer.setSize(window.innerWidth, window.innerHeight)
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      built.resize?.(window.innerHeight)
    }
    resize()
    window.addEventListener('resize', resize)

    const mouse = { x: 0, y: 0 }
    const onMove = (e: PointerEvent): void => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove)

    const started = performance.now()
    const renderFrame = (t: number): void => {
      for (const mat of built.shaders) mat.uniforms.uTime.value = t
      built.update?.(t)
      camera.position.x += (mouse.x * 0.7 - camera.position.x) * 0.04
      camera.position.y += (mouse.y * 0.5 - camera.position.y) * 0.04
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
    }

    // фон не нуждается в 60/120 fps: троттлим до ~30 (экономия CPU/GPU/батареи)
    const FRAME_MS = 1000 / 30
    let raf = 0
    let last = 0
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      if (now - last < FRAME_MS) return
      last = now
      renderFrame((now - started) / 1000)
    }
    const onVisibility = (): void => {
      if (document.hidden) {
        if (raf) {
          cancelAnimationFrame(raf)
          raf = 0
        }
      } else if (!raf) {
        raf = requestAnimationFrame(loop)
      }
    }

    if (reduced) {
      renderFrame(0) // статичный кадр, без анимации (prefers-reduced-motion)
    } else {
      document.addEventListener('visibilitychange', onVisibility)
      raf = requestAnimationFrame(loop)
    }

    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', onVisibility)
      scene.remove(built.object)
      disposeObject(built.object)
      renderer.dispose()
      canvas.remove()
    }
  }, [variant, dark])

  return <div ref={containerRef} className="bg3d" />
}

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// варианты фоновой 3D-сцены (выбор в BgPicker, дефолт ridge)
export type BgVariant = 'ridge' | 'dots' | 'shapes' | 'wire' | 'contours'

// палитра эдиториала
const INK = 0x16140f
const RED = 0xc8341f
const BLUE = 0x2b4a8f

type Built = { object: THREE.Object3D; update: (t: number) => void }

const attr = (obj: THREE.Line | THREE.Points): THREE.BufferAttribute =>
  obj.geometry.getAttribute('position') as THREE.BufferAttribute

// ридж-волны: стопка профилей (осциллограф), центральная линия красная
const buildRidge = (mobile: boolean): Built => {
  const rows = mobile ? 22 : 34
  const cols = mobile ? 80 : 120
  const w = 15
  const d = 9
  const g = new THREE.Group()
  const lines: { line: THREE.Line; r: number }[] = []
  for (let r = 0; r < rows; r++) {
    const pos = new Float32Array(cols * 3)
    for (let c = 0; c < cols; c++) {
      pos[c * 3] = -w / 2 + (c / (cols - 1)) * w
      pos[c * 3 + 2] = d / 2 - (r / (rows - 1)) * d
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mid = r === Math.floor(rows / 2)
    const mat = new THREE.LineBasicMaterial({ color: mid ? RED : INK, transparent: true, opacity: mid ? 0.95 : 0.42 })
    const line = new THREE.Line(geo, mat)
    g.add(line)
    lines.push({ line, r })
  }
  g.rotation.x = -1.0
  g.position.y = -0.6
  return {
    object: g,
    update: (t) => {
      for (const { line, r } of lines) {
        const p = attr(line)
        for (let c = 0; c < cols; c++) {
          const x = p.getX(c)
          const env = Math.exp(-Math.pow(x / 4.2, 2))
          const y =
            (Math.sin(x * 1.1 - t * 1.3 + r * 0.34) * 0.2 + Math.sin(x * 2.7 + t * 0.9 + r * 0.2) * 0.09) *
            (0.35 + env * 1.2)
          p.setY(c, y)
        }
        p.needsUpdate = true
      }
    },
  }
}

// полутон-волна: сетка точек, гребни красные, впадины синие
const buildDots = (mobile: boolean): Built => {
  const nx = mobile ? 48 : 72
  const ny = mobile ? 30 : 46
  const w = 18
  const h = 11
  const count = nx * ny
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  let i = 0
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      pos[i * 3] = -w / 2 + (x / (nx - 1)) * w
      pos[i * 3 + 1] = -h / 2 + (y / (ny - 1)) * h
      i++
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const mat = new THREE.PointsMaterial({ size: 0.08, vertexColors: true, transparent: true, opacity: 0.92, sizeAttenuation: true })
  const pts = new THREE.Points(geo, mat)
  pts.rotation.x = -0.6
  const cI = new THREE.Color(INK)
  const cR = new THREE.Color(RED)
  const cB = new THREE.Color(BLUE)
  return {
    object: pts,
    update: (t) => {
      const p = attr(pts)
      const cc = pts.geometry.getAttribute('color') as THREE.BufferAttribute
      for (let j = 0; j < count; j++) {
        const x = p.getX(j)
        const y = p.getY(j)
        const z = Math.sin(x * 0.7 - t * 1.2) * 0.5 + Math.cos(y * 0.6 + t * 0.8) * 0.4
        p.setZ(j, z)
        const level = (z + 0.9) / 1.8
        const c = level > 0.72 ? cR : level < 0.18 ? cB : cI
        cc.setXYZ(j, c.r, c.g, c.b)
      }
      p.needsUpdate = true
      cc.needsUpdate = true
    },
  }
}

// парящие бумажные фигуры (баухаус-коллаж)
const buildShapes = (_mobile: boolean): Built => {
  const g = new THREE.Group()
  const mk = (geo: THREE.BufferGeometry, color: number, op: number): THREE.Mesh =>
    new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide }))
  const items: { m: THREE.Mesh; sy: number; baseRot: number }[] = []
  const place = (m: THREE.Mesh, x: number, y: number, z: number, rot: number): void => {
    m.position.set(x, y, z)
    m.rotation.z = rot
    g.add(m)
    items.push({ m, sy: y, baseRot: rot })
  }
  place(mk(new THREE.RingGeometry(1.2, 1.5, 56, 1, 0, Math.PI), INK, 0.85), -3.4, 1.3, -1, 0.15)
  place(mk(new THREE.CircleGeometry(0.95, 56), RED, 0.8), 3.3, 1.9, -2.2, 0)
  place(mk(new THREE.CircleGeometry(1.05, 3), BLUE, 0.8), 2.7, -1.7, -1.4, 0.5)
  place(mk(new THREE.PlaneGeometry(2.6, 0.16), INK, 0.75), -2.9, -1.9, -0.6, -0.25)
  place(mk(new THREE.RingGeometry(0.78, 0.92, 48), INK, 0.5), 0.4, 2.6, -3, 0)
  return {
    object: g,
    update: (t) => {
      items.forEach((it, i) => {
        it.m.position.y = it.sy + Math.sin(t * 0.5 + i * 1.3) * 0.28
        it.m.rotation.z = it.baseRot + Math.sin(t * 0.3 + i) * 0.13
      })
    },
  }
}

// вращающийся каркас-икосаэдр с красным ядром
const buildWire = (_mobile: boolean): Built => {
  const g = new THREE.Group()
  const outer = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(2.5, 1)),
    new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.5 }),
  )
  const inner = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.3, 0)),
    new THREE.LineBasicMaterial({ color: RED, transparent: true, opacity: 0.9 }),
  )
  g.add(outer, inner)
  return {
    object: g,
    update: (t) => {
      g.rotation.y = t * 0.16
      g.rotation.x = t * 0.07
      inner.rotation.y = -t * 0.32
      inner.rotation.z = t * 0.12
    },
  }
}

// контурная рябь: концентрические контуры расходятся волной
const buildContours = (mobile: boolean): Built => {
  const ringsN = mobile ? 14 : 20
  const seg = mobile ? 120 : 170
  const maxR = 8
  const g = new THREE.Group()
  const rings: { line: THREE.Line; radius: number }[] = []
  for (let i = 0; i < ringsN; i++) {
    const radius = 0.4 + (i / (ringsN - 1)) * maxR
    const pos = new Float32Array((seg + 1) * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const accent = i === 3
    const mat = new THREE.LineBasicMaterial({
      color: accent ? RED : INK,
      transparent: true,
      opacity: accent ? 0.95 : Math.max(0.18, 0.55 - (i / ringsN) * 0.3),
    })
    const line = new THREE.Line(geo, mat)
    g.add(line)
    rings.push({ line, radius })
  }
  g.rotation.x = -0.95
  g.position.y = -0.3
  return {
    object: g,
    update: (t) => {
      for (const { line, radius } of rings) {
        const p = attr(line)
        for (let s = 0; s <= seg; s++) {
          const a = (s / seg) * Math.PI * 2
          const wob = Math.sin(a * 5 + t * 0.6 + radius) * 0.12 * (radius * 0.1)
          const r = radius + wob
          const z = Math.sin(radius * 1.1 - t * 1.4) * 0.55
          p.setXYZ(s, Math.cos(a) * r, Math.sin(a) * r, z)
        }
        p.needsUpdate = true
      }
    },
  }
}

const BUILDERS: Record<BgVariant, (mobile: boolean) => Built> = {
  ridge: buildRidge,
  dots: buildDots,
  shapes: buildShapes,
  wire: buildWire,
  contours: buildContours,
}

const disposeObject = (object: THREE.Object3D): void => {
  object.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose?.()
    const mat = m.material
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose?.()
  })
}

// фоновая 3D-сцена на чистом three.js: прозрачный canvas строго позади контента.
// three сам создаёт canvas (а не переиспользуем общий) - устойчиво к двойному
// монтированию эффекта в StrictMode, иначе второй рендерер бьётся о погашенный контекст
export const Scene3D = ({ variant }: { variant: BgVariant }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const mobile = window.matchMedia('(max-width: 700px)').matches

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    const canvas = renderer.domElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
    camera.position.set(0, 0, 8)

    const resize = (): void => {
      renderer.setSize(window.innerWidth, window.innerHeight)
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

    const built = BUILDERS[variant](mobile)
    scene.add(built.object)

    const mouse = { x: 0, y: 0 }
    const onMove = (e: PointerEvent): void => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove)

    const clock = new THREE.Clock()
    const renderFrame = (t: number): void => {
      built.update(t)
      camera.position.x += (mouse.x * 0.7 - camera.position.x) * 0.04
      camera.position.y += (mouse.y * 0.5 - camera.position.y) * 0.04
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
    }

    let raf = 0
    const loop = (): void => {
      raf = requestAnimationFrame(loop)
      renderFrame(clock.getElapsedTime())
    }
    const onVisibility = (): void => {
      if (document.hidden) {
        if (raf) {
          cancelAnimationFrame(raf)
          raf = 0
        }
      } else if (!raf) {
        loop()
      }
    }

    if (reduced) {
      renderFrame(0) // статичный кадр, без анимации (prefers-reduced-motion)
    } else {
      document.addEventListener('visibilitychange', onVisibility)
      loop()
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
  }, [variant])

  return <div ref={containerRef} className="bg3d" />
}

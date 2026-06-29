import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import type { Group } from 'three'

const reduced = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const isMobile = (): boolean => window.matchMedia('(max-width: 768px)').matches

// медленное вращение звёздного поля
const SpinningStars = ({ count }: { count: number }) => {
  const ref = useRef<Group>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.012
  })
  return (
    <group ref={ref}>
      <Stars radius={120} depth={70} count={count} factor={4} saturation={0} fade speed={0.7} />
    </group>
  )
}

// мягкий параллакс камеры к курсору
const ParallaxRig = () => {
  useFrame((state) => {
    const tx = state.pointer.x * 1.6
    const ty = state.pointer.y * 1.0
    state.camera.position.x += (tx - state.camera.position.x) * 0.025
    state.camera.position.y += (ty - state.camera.position.y) * 0.025
    state.camera.lookAt(0, 0, 0)
  })
  return null
}

// 3D-фон: прозрачный canvas поверх CSS-туманностей body
export const Scene3D = () => {
  const isReduced = reduced()
  const mobile = isMobile()
  const [visible, setVisible] = useState(true)

  // пауза рендера, когда вкладка не на экране (экономия батареи)
  useEffect(() => {
    const onVis = (): void => setVisible(!document.hidden)
    onVis()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const frameloop = isReduced ? 'demand' : visible ? 'always' : 'never'

  // zIndex: -1 - фон строго позади контента, иначе canvas R3F (pointer-events:auto)
  // перехватывает клики по кнопкам
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }}>
      <Canvas
        camera={{ position: [0, 0, 1], fov: 75 }}
        dpr={mobile ? [1, 1] : [1, 1.5]}
        gl={{ antialias: false }}
        frameloop={frameloop}
      >
        <SpinningStars count={mobile ? 2600 : 5200} />
        {!isReduced && !mobile && <ParallaxRig />}
      </Canvas>
    </div>
  )
}

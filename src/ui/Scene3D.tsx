import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import type { Group } from 'three'

const reduced = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// медленное вращение звёздного поля
const SpinningStars = () => {
  const ref = useRef<Group>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.012
  })
  return (
    <group ref={ref}>
      <Stars radius={120} depth={70} count={5200} factor={4} saturation={0} fade speed={0.7} />
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
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      <Canvas
        camera={{ position: [0, 0, 1], fov: 75 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false }}
        frameloop={isReduced ? 'demand' : 'always'}
      >
        <SpinningStars />
        {!isReduced && <ParallaxRig />}
      </Canvas>
    </div>
  )
}

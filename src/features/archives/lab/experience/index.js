import * as THREE from 'three'
import { Gallery } from './Gallery.js'
import { Background } from './Background/index.js'
import { Debug } from './Debug.js'
import { TrailController } from './TrailController.js'

class Experience {
  constructor() {
    this.isInitialized = false
    this.isDisposed = false
    this.frameDarkPlaneCount = 2
    this.isFrameTextDark = null
    this.debug = new Debug()
    this.gallery = new Gallery(this.debug)
    this.background = new Background(this.debug)
    this.trailController = new TrailController({
      gallery: this.gallery,
      debug: this.debug,
    })
  }

  async init(scene, camera) {
    if (this.isInitialized) return

    await this.gallery.init(scene)
    this.background.init()
    this.trailController.init(scene, camera)

    const initialPlaneBlendData = this.gallery.getPlaneBlendData(camera.position.z)
    this.updateFrameTextTone(initialPlaneBlendData)

    this.isInitialized = true
  }

  updateFrameTextTone(planeBlendData) {
    if (!planeBlendData) return

    const nearestPlaneIndex =
      planeBlendData.blend >= 0.5 ? planeBlendData.nextPlaneIndex : planeBlendData.currentPlaneIndex
    const shouldUseDarkText = nearestPlaneIndex < this.frameDarkPlaneCount

    if (this.isFrameTextDark === shouldUseDarkText) return

    this.isFrameTextDark = shouldUseDarkText
    document.body.classList.toggle('frame-text-dark', shouldUseDarkText)
  }

  update(time, camera = null, scroll = null) {
    this.trailController.update(camera, scroll, time)

    // 카드·배경 계산은 연출 오프셋을 뺀 스크롤 위치 기준이다(Scroll.baseCameraZ)
    const cameraZ = scroll?.baseCameraZ ?? camera?.position.z
    this.gallery.update(cameraZ, scroll)

    // Camera-driven updates
    if (camera) {
      // Frame text tone
      const planeBlendData = this.gallery.getPlaneBlendData(cameraZ)
      this.updateFrameTextTone(planeBlendData)

      // Mood colors
      const moodBlendData = this.gallery.getMoodBlendData(cameraZ)
      if (moodBlendData) {
        this.background.setMoodBlend(moodBlendData)
      }

      // Depth + velocity -> background motion response
      const depthProgress = this.gallery.getDepthProgress(cameraZ)
      const velocityMax = scroll?.velocityMax || 1
      const velocityIntensity = THREE.MathUtils.clamp(
        Math.abs(scroll?.velocity || 0) / Math.max(velocityMax, 0.0001),
        0,
        1
      )
      const blend = planeBlendData?.blend ?? 0
      const distanceFromBlendCenter = Math.abs(blend - 0.5) * 2
      const transitionStability = THREE.MathUtils.smoothstep(distanceFromBlendCenter, 0.35, 1)
      const stabilizedVelocityIntensity = velocityIntensity * transitionStability

      this.background.setMotionResponse({
        depthProgress,
        velocityIntensity: stabilizedVelocityIntensity,
      })
    }

    // Background tick
    this.background.update(time)
  }

  dispose() {
    if (this.isDisposed) return

    this.trailController.dispose()
    this.gallery.dispose()
    this.background.dispose()
    this.debug.dispose()
    document.body.classList.remove('frame-text-dark')
    this.isDisposed = true
  }
}

// 원본은 모듈 전역 하나(world)를 썼다 — 화면을 나갔다 오면 dispose된 인스턴스를 다시 써서 깨진다.
// Engine이 마운트마다 새로 만든다.
export { Experience }

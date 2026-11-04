import * as THREE from 'three'

class Scroll {
  constructor(camera, gallery, debug = null) {
    this.isInitialized = false
    this.isDebugBound = false
    this.camera = camera
    this.gallery = gallery
    this.debug = debug

    // Scroll state
    this.scrollTarget = 0
    this.scrollCurrent = 0
    this.scrollSmoothing = 0.08
    this.scrollToWorldFactor = 0.01
    this.wheelScrollSpeed = 1
    this.touchScrollSpeed = 1.8
    this.previousScrollCurrent = 0
    this.invertScroll = false

    // Velocity
    this.rawVelocity = 0
    this.velocity = 0
    this.velocityDamping = 0.12
    this.velocityMax = 1.5
    this.velocityStopThreshold = 0.0001

    // Snap — 한 번에 한 장씩만 넘어가고, 손을 떼면 가장 가까운 카드에 멈춘다.
    // 원본은 자유 스크롤이라 빠르게 굴리면 여러 장을 지나쳐 하나씩 보기 어려웠다.
    this.useSnap = true
    this.snapSmoothing = 0.12
    this.snapIdleDelay = 90
    this.lastInputTime = 0

    // Bounds
    this.useScrollBounds = true
    this.firstPlaneViewOffset = 5
    this.lastPlaneViewOffset = 5
    this.minCameraZ = -Infinity
    this.maxCameraZ = Infinity
    this.cameraStartZ = this.camera.position.z

    // Debug UI
    this.showVelocityVisualizer = true
    this.debugUiVisible = false
    this.velocityVisualizerElement = null
    this.velocityVisualizerFillElement = null
    this.velocityVisualizerValueElement = null

    // Touch — 처음 몇 px 움직인 방향으로 축을 고정한다. 세로면 깊이 스크롤, 가로면 앨범 안 사진 넘기기다.
    this.touchStartX = 0
    this.touchStartY = 0
    this.touchY = 0
    this.touchAxis = null
    this.touchAxisLockDistance = 8
    this.swipeDistance = 40
    this.onSwipeX = null

    // 진입·열기 연출용 카메라 오프셋 — 스크롤 위치(baseCameraZ)와 따로 더해서, 카드 투명도 계산은 흔들리지 않는다.
    this.cameraOffset = 0
    this.baseCameraZ = this.camera.position.z
    this.isInputLocked = false

    // Input events
    this.onWheel = (event) => {
      event.preventDefault()
      if (this.isInputLocked) return
      const normalizedWheelDelta = this.normalizeWheelDelta(event) * this.wheelScrollSpeed
      this.addScrollInput(normalizedWheelDelta)
    }
    this.onTouchStart = (event) => {
      this.touchStartX = event.touches[0]?.clientX ?? 0
      this.touchStartY = event.touches[0]?.clientY ?? 0
      this.touchY = this.touchStartY
      this.touchAxis = null
    }
    this.onTouchMove = (event) => {
      event.preventDefault()
      if (this.isInputLocked) return
      const currentTouchX = event.touches[0]?.clientX ?? this.touchStartX
      const currentTouchY = event.touches[0]?.clientY ?? this.touchY

      if (!this.touchAxis) {
        const totalX = Math.abs(currentTouchX - this.touchStartX)
        const totalY = Math.abs(currentTouchY - this.touchStartY)
        if (Math.max(totalX, totalY) < this.touchAxisLockDistance) return
        this.touchAxis = totalX > totalY ? 'x' : 'y'
      }

      if (this.touchAxis === 'y') {
        const deltaY = this.touchY - currentTouchY
        this.addScrollInput(deltaY * this.touchScrollSpeed)
      }
      this.touchY = currentTouchY
    }
    this.onTouchEnd = (event) => {
      if (this.touchAxis !== 'x' || this.isInputLocked) return
      const endX = event.changedTouches[0]?.clientX ?? this.touchStartX
      const deltaX = endX - this.touchStartX
      if (Math.abs(deltaX) < this.swipeDistance) return
      // 왼쪽으로 밀면 다음 사진(책장 넘기듯)
      this.onSwipeX?.(deltaX < 0 ? 1 : -1)
    }
  }

  // 타임라인에서 고른 카드로 바로 간다 — 한 장씩 가두는 addScrollInput을 거치지 않는다.
  scrollToIndex(index) {
    const step = this.getScrollStep()
    if (step <= 0) return
    this.scrollTarget = index * step
    this.lastInputTime = 0
  }

  // scrollToIndex와 달리 지나가는 카드 없이 그 자리에서 시작한다
  jumpToIndex(index) {
    const step = this.getScrollStep()
    if (step <= 0) return
    this.scrollTarget = index * step
    this.scrollCurrent = this.scrollTarget
    this.previousScrollCurrent = this.scrollTarget
    this.velocity = 0
  }

  getActiveIndex() {
    const step = this.getScrollStep()
    if (step <= 0) return 0
    return Math.round(this.scrollCurrent / step)
  }

  init() {
    if (this.isInitialized) return

    this.updateCameraBounds()
    this.cameraStartZ = this.maxCameraZ
    this.camera.position.z = this.cameraStartZ
    this.scrollTarget = 0
    this.scrollCurrent = 0
    this.previousScrollCurrent = this.scrollCurrent
    this.rawVelocity = 0
    this.velocity = 0
    this.createVelocityVisualizer()
    this.updateVelocityVisualizer()
    this.bindDebug()

    this.isInitialized = true
  }

  bindEvents() {
    window.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('touchstart', this.onTouchStart, { passive: true })
    window.addEventListener('touchmove', this.onTouchMove, { passive: false })
    window.addEventListener('touchend', this.onTouchEnd, { passive: true })
  }

  updateCameraBounds() {
    const depthRange = this.gallery.getDepthRange()
    this.maxCameraZ = depthRange.nearestZ + this.firstPlaneViewOffset
    this.minCameraZ = depthRange.deepestZ + this.lastPlaneViewOffset

    if (this.minCameraZ > this.maxCameraZ) {
      this.minCameraZ = this.maxCameraZ
    }
  }

  cameraZFromScroll(scrollAmount) {
    return this.cameraStartZ - scrollAmount * this.scrollToWorldFactor
  }

  scrollFromCameraZ(cameraZ) {
    if (this.scrollToWorldFactor === 0) return 0
    return (this.cameraStartZ - cameraZ) / this.scrollToWorldFactor
  }

  normalizeWheelDelta(event) {
    if (event.deltaMode === 1) return event.deltaY * 16
    if (event.deltaMode === 2) return event.deltaY * window.innerHeight
    return event.deltaY
  }

  // 카드 한 장만큼의 스크롤량 — 카드 간격(planeGap)을 월드 변환 비율로 나눈 값이다.
  getScrollStep() {
    const planeGap = this.gallery?.planeGap || 0
    if (!planeGap || this.scrollToWorldFactor === 0) return 0
    return planeGap / this.scrollToWorldFactor
  }

  addScrollInput(deltaY) {
    const scrollDirection = this.invertScroll ? -1 : 1
    this.scrollTarget += deltaY * scrollDirection
    this.lastInputTime = performance.now()

    // 한 번에 한 장 넘게 앞서가지 않도록 입력을 가둔다 — 세게 굴려도 다음 카드에서 멈춘다.
    const step = this.getScrollStep()
    if (this.useSnap && step > 0) {
      this.scrollTarget = THREE.MathUtils.clamp(
        this.scrollTarget,
        this.scrollCurrent - step,
        this.scrollCurrent + step
      )
    }
  }

  // 입력이 멈추면 가장 가까운 카드 위치로 목표를 당긴다(부드럽게).
  updateSnap() {
    const step = this.getScrollStep()
    if (!this.useSnap || step <= 0) return
    if (performance.now() - this.lastInputTime < this.snapIdleDelay) return

    const snappedTarget = Math.round(this.scrollTarget / step) * step
    this.scrollTarget = THREE.MathUtils.lerp(
      this.scrollTarget,
      snappedTarget,
      this.snapSmoothing
    )
  }

  updateVelocity() {
    this.rawVelocity = this.scrollCurrent - this.previousScrollCurrent
    this.velocity = THREE.MathUtils.lerp(this.velocity, this.rawVelocity, this.velocityDamping)
    this.velocity = THREE.MathUtils.clamp(this.velocity, -this.velocityMax, this.velocityMax)

    if (Math.abs(this.velocity) < this.velocityStopThreshold) {
      this.velocity = 0
    }

    this.previousScrollCurrent = this.scrollCurrent
  }

  createVelocityVisualizer() {
    if (this.velocityVisualizerElement) return

    const container = document.createElement('div')
    container.className = 'velocity-visualizer'

    const label = document.createElement('p')
    label.className = 'velocity-visualizer__label'
    label.textContent = 'Velocity'

    const value = document.createElement('p')
    value.className = 'velocity-visualizer__value'
    value.textContent = '0.0000'

    const track = document.createElement('div')
    track.className = 'velocity-visualizer__track'

    const fill = document.createElement('div')
    fill.className = 'velocity-visualizer__fill'
    track.append(fill)

    container.append(label, value, track)
    document.body.append(container)

    this.velocityVisualizerElement = container
    this.velocityVisualizerFillElement = fill
    this.velocityVisualizerValueElement = value
    this.setVelocityVisualizerVisible(this.showVelocityVisualizer)
  }

  setVelocityVisualizerVisible(isVisible) {
    if (!this.velocityVisualizerElement) return
    const shouldShow = Boolean(isVisible) && this.debugUiVisible
    this.velocityVisualizerElement.style.display = shouldShow ? 'block' : 'none'
  }

  setDebugUiVisible(isVisible) {
    this.debugUiVisible = Boolean(isVisible)
    this.setVelocityVisualizerVisible(this.showVelocityVisualizer)
  }

  updateVelocityVisualizer() {
    if (
      !this.velocityVisualizerElement ||
      !this.velocityVisualizerFillElement ||
      !this.velocityVisualizerValueElement
    ) {
      return
    }

    const velocitySign = this.velocity === 0 ? 0 : Math.sign(this.velocity)
    const normalizedVelocity = THREE.MathUtils.clamp(
      Math.abs(this.velocity) / this.velocityMax,
      0,
      1
    )
    const fillPercent = normalizedVelocity * 50

    if (velocitySign >= 0) {
      this.velocityVisualizerFillElement.style.left = '50%'
      this.velocityVisualizerFillElement.style.width = `${fillPercent}%`
    } else {
      this.velocityVisualizerFillElement.style.left = `${50 - fillPercent}%`
      this.velocityVisualizerFillElement.style.width = `${fillPercent}%`
    }

    this.velocityVisualizerFillElement.style.backgroundColor =
      velocitySign >= 0 ? '#7fffd4' : '#ff8fab'
    this.velocityVisualizerValueElement.textContent = this.velocity.toFixed(4)
  }

  update() {
    this.updateCameraBounds()
    this.scrollCurrent = THREE.MathUtils.lerp(
      this.scrollCurrent,
      this.scrollTarget,
      this.scrollSmoothing
    )

    if (this.useScrollBounds) {
      const minimumScroll = this.scrollFromCameraZ(this.maxCameraZ)
      const maximumScroll = this.scrollFromCameraZ(this.minCameraZ)

      this.scrollTarget = THREE.MathUtils.clamp(this.scrollTarget, minimumScroll, maximumScroll)
      this.scrollCurrent = THREE.MathUtils.clamp(this.scrollCurrent, minimumScroll, maximumScroll)
    }

    this.updateSnap()
    this.updateVelocity()
    this.updateVelocityVisualizer()

    const nextCameraZ = this.cameraZFromScroll(this.scrollCurrent)
    this.baseCameraZ = this.useScrollBounds
      ? THREE.MathUtils.clamp(nextCameraZ, this.minCameraZ, this.maxCameraZ)
      : nextCameraZ
    this.camera.position.z = this.baseCameraZ + this.cameraOffset
  }

  bindDebug() {
    if (!this.debug || this.isDebugBound) return

    this.debug.addBinding({
      folderTitle: 'Scroll',
      targetObject: this,
      property: 'useScrollBounds',
      label: 'Use Bounds',
    })

    this.debug.addBinding({
      folderTitle: 'Scroll',
      targetObject: this,
      property: 'invertScroll',
      label: 'Invert Scroll',
    })

    this.debug.addBinding({
      folderTitle: 'Scroll',
      targetObject: this,
      property: 'showVelocityVisualizer',
      label: 'Debug Velocity',
      onChange: (value) => {
        this.setVelocityVisualizerVisible(value)
      },
    })

    this.debug.addBinding({
      folderTitle: 'Scroll',
      targetObject: this,
      property: 'velocityDamping',
      label: 'Velocity Damping',
      options: {
        min: 0.01,
        max: 1,
        step: 0.01,
      },
    })

    this.debug.addBinding({
      folderTitle: 'Scroll',
      targetObject: this,
      property: 'velocityMax',
      label: 'Velocity Max',
      options: {
        min: 0.1,
        max: 5,
        step: 0.1,
      },
    })

    this.isDebugBound = true
  }

  unbindEvents() {
    window.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('touchstart', this.onTouchStart)
    window.removeEventListener('touchmove', this.onTouchMove)
    window.removeEventListener('touchend', this.onTouchEnd)
  }

  dispose() {
    this.unbindEvents()

    if (this.velocityVisualizerElement) {
      this.velocityVisualizerElement.remove()
    }
    this.velocityVisualizerElement = null
    this.velocityVisualizerFillElement = null
    this.velocityVisualizerValueElement = null
  }
}

export { Scroll }

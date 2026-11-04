import * as THREE from 'three'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import { Experience } from './index.js'
import { Scroll } from './Scroll.js'

// 한 번 받은 사진(이미지 요소)을 메모리에 들고 있는다. 끄면 상세에서 돌아올 때마다 사진을 서버에
// 다시 확인(304)·디코딩하느라 검은 화면이 비친다 — 폰은 와이파이 왕복까지 더해져 더 길다.
// 이 모듈은 lab 화면에서만 불러오므로 앱의 다른 곳에는 영향이 없다.
THREE.Cache.enabled = true

class Engine {
  // callbacks — React 오버레이(캡션·타임라인)가 받는 이벤트
  //   onActiveChange({ index, archiveId, label, year, photoIndex, photoCount, captionRect })
  //   onOpenStart(archiveId): 카드를 눌러 확대 연출이 시작될 때
  //   onTopColorChange(hex): 화면 위 가장자리 배경색이 바뀔 때 — 폰 상태표시줄을 같은 색으로 칠한다
  //   onOpen(archiveId, target): 확대 연출이 끝났을 때 — target은 'detail'(사진을 눌렀을 때, 행사 상세)
  //                              또는 'photos'(앨범 열기 버튼, 현장 사진 모아보기)
  constructor(canvas, callbacks = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Engine requires a valid canvas element')
    }

    // Initialization
    this.canvas = canvas
    this.callbacks = callbacks
    this.experience = new Experience()
    this.debug = this.experience.debug
    this.isInitialized = false
    this.isDisposed = false
    this.isRunning = false
    this.isDebugBound = false
    this.topColor = new THREE.Color()
    this.lastTopColorHex = null
    this.animationFrameRequestId = null
    this.preloadedTextures = new Map()
    this.stats = null
    this.showFps = true
    this.isDebugUiVisible = false
    this.scene = new THREE.Scene()

    // 활성 카드 — 바뀔 때만 React에 알린다
    this.activeIndex = -1
    this.lastCaptionKey = null

    // 진입 연출 — 멀리서 카드 쪽으로 날아 들어온다(enter() 전까지는 멀리 떠 있다)
    // 진입·열기 모두 시간(ms) 기준이다 — 프레임마다 더하면 120Hz 폰에서 두 배 빨라진다.
    this.introDistance = 9
    this.introDuration = 1400
    this.introStartTime = null
    this.isEntered = false
    this.areEventsBound = false

    // 열기 연출 — 카드가 화면을 채울 때까지 카메라가 다가간 뒤 onOpen을 부른다.
    // openDelay는 화면의 흰 덮개(ArchivesLabScreen, delay 150 + 300ms)가 다 덮인 뒤다.
    this.openDistance = 3.6
    this.openDuration = 450
    this.openDelay = 520
    this.openStartTime = null
    this.isOpening = false
    this.openTimeoutId = null

    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    this.camera.position.set(0, 0, 6)

    // Scroll
    this.scroll = new Scroll(this.camera, this.experience.gallery, this.debug)

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.autoClear = false

    this.onResize = () => {
      this.resize()
    }
    // 창 resize 이벤트 대신 캔버스 자체의 크기 변화를 본다. 아이폰은 주소창이 접히거나 펼쳐질 때
    // resize를 항상 보내지 않아서, 캔버스만 길어지고 안쪽 그림은 예전 크기로 늘어나 가로가 좁아 보였다.
    this.resizeObserver = new ResizeObserver(this.onResize)
    this.onKeyDown = (event) => {
      if (event.repeat) return
      // 데스크톱에서 확인할 때 — 좌우 화살표로 앨범 사진 넘기기
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        this.shiftPhoto(event.key === 'ArrowRight' ? 1 : -1)
        return
      }
      if (event.key.toLowerCase() !== 'd') return
      this.setDebugUiVisible(!this.isDebugUiVisible)
    }

    this.onCanvasClick = (event) => {
      if (!this.isEntered || this.isOpening) return
      const rect = this.canvas.getBoundingClientRect()
      this.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      this.raycaster.setFromCamera(this.pointer, this.camera)
      const activePlane = this.experience.gallery.planes[this.activeIndex]
      if (!activePlane) return
      if (this.raycaster.intersectObject(activePlane, false).length) {
        this.openActive('detail')
      }
    }
    this.scroll.onSwipeX = (direction) => {
      this.shiftPhoto(direction)
    }

    this.animate = this.update.bind(this)
  }

  // 진입 버튼에서 부른다.
  // skipIntro: 앨범에서 돌아왔을 때 — 날아 들어오는 연출 없이 바로 제자리다.
  enter({ skipIntro = false } = {}) {
    if (this.isEntered) return
    this.isEntered = true
    this.introStartTime = performance.now() - (skipIntro ? this.introDuration : 0)
    this.scroll.isInputLocked = false
  }

  scrollToIndex(index) {
    if (this.isOpening) return
    this.scroll.scrollToIndex(index)
  }

  // 상세에서 돌아왔을 때 보던 카드·사진으로 애니메이션 없이 바로 옮긴다.
  // init 안에서 첫 프레임을 그리기 전에 부른다 — 그래야 멀리서 본 장면이나 첫 카드가 한 프레임도 안 비친다.
  restore({ index, photoIndex }) {
    const { gallery } = this.experience
    const lastIndex = gallery.planes.length - 1
    const safeIndex = THREE.MathUtils.clamp(index, 0, lastIndex)
    gallery.restorePhoto(safeIndex, photoIndex)
    this.scroll.jumpToIndex(safeIndex)
    gallery.updatePlaneVisibility(this.scroll.cameraZFromScroll(this.scroll.scrollCurrent), 1)
    this.enter({ skipIntro: true })
  }

  shiftPhoto(direction) {
    if (this.isOpening || this.activeIndex < 0) return
    const result = this.experience.gallery.shiftPhoto(this.activeIndex, direction)
    if (result) this.emitActive()
  }

  openActive(target = 'detail') {
    if (this.isOpening || this.activeIndex < 0) return
    const plane = this.experience.gallery.planes[this.activeIndex]
    if (!plane) return

    this.isOpening = true
    this.openStartTime = performance.now()
    this.scroll.isInputLocked = true
    this.callbacks.onOpenStart?.(plane.userData.archiveId)
    this.openTimeoutId = window.setTimeout(() => {
      this.callbacks.onOpen?.(plane.userData.archiveId, target)
    }, this.openDelay)
  }

  // 캡션을 붙일 카드의 화면 영역(px) — 멈춰 있을 때 카드가 놓이는 자리에서 계산한다.
  // 캡션 폭을 사진 폭에 맞춰야 사진 아래 붙은 라벨로 읽힌다.
  getCaptionRect(plane) {
    const { gallery } = this.experience
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 5
    const pxPerUnit = height / visibleHeight
    const aspectRatio = plane.userData.aspectRatio || 1
    // plane.scale은 스크롤 중 breath로 출렁여서, 화면 맞춤 배율을 직접 다시 구한다
    const fitScale = gallery.getViewportFitScale(aspectRatio)
    const cardHalfHeight = fitScale * 1.5
    const cardHalfWidth = fitScale * aspectRatio * 1.5
    const cardX = (plane.userData.basePosition?.x || 0) * gallery.getXSpreadFactor()

    return {
      left: Math.round(width / 2 + (cardX - cardHalfWidth) * pxPerUnit),
      top: Math.round(height / 2 + cardHalfHeight * pxPerUnit),
      width: Math.round(cardHalfWidth * 2 * pxPerUnit),
    }
  }

  emitActive() {
    const plane = this.experience.gallery.planes[this.activeIndex]
    if (!plane) return
    const { userData } = plane
    const captionRect = this.getCaptionRect(plane)
    this.lastCaptionKey = `${captionRect.left},${captionRect.top},${captionRect.width}`
    this.callbacks.onActiveChange?.({
      archiveId: userData.archiveId,
      captionRect,
      index: this.activeIndex,
      label: userData.label,
      photoCount: userData.photos.length,
      photoIndex: userData.photoIndex,
      year: userData.year,
    })
  }

  updateActive() {
    const lastIndex = this.experience.gallery.planes.length - 1
    const nextIndex = THREE.MathUtils.clamp(this.scroll.getActiveIndex(), 0, lastIndex)
    const plane = this.experience.gallery.planes[nextIndex]
    // 사진을 넘겨 비율이 바뀌면 캡션 자리도 따라 옮긴다
    const captionRect = plane && this.getCaptionRect(plane)
    const captionChanged =
      captionRect &&
      `${captionRect.left},${captionRect.top},${captionRect.width}` !== this.lastCaptionKey
    if (nextIndex === this.activeIndex && !captionChanged) return
    this.activeIndex = nextIndex
    this.emitActive()
  }

  getProgress(startTime, duration) {
    if (startTime === null) return 0
    return Math.min((performance.now() - startTime) / duration, 1)
  }

  updateCameraOffset() {
    // 진입: 감속하며 다가온다(easeOutCubic)
    const introProgress = this.getProgress(this.introStartTime, this.introDuration)
    const introEase = 1 - (1 - introProgress) ** 3
    const introOffset = (1 - introEase) * this.introDistance

    // 열기: 가속하며 카드 속으로 들어간다(easeInQuad)
    const openEase = this.getProgress(this.openStartTime, this.openDuration) ** 2
    const openOffset = -openEase * this.openDistance

    this.scroll.cameraOffset = introOffset + openOffset
  }

  // restorePosition: 상세에서 돌아왔을 때 보던 카드·사진({ index, photoIndex })
  /** @param {{ restorePosition?: { index: number, photoIndex: number } | null }} [options] */
  async init({ restorePosition = null } = {}) {
    if (this.isInitialized) return

    document.body.classList.add('loading')

    try {
      this.preloadedTextures = await this.preloadTextures()
      // 사진을 받는 사이 화면을 나갔으면(dispose) 여기서 멈춘다 — 이어가면 window에 스크롤 막는
      // 리스너가 붙고 렌더 루프가 돌아서, 다른 화면의 스크롤까지 막힌다.
      if (this.isDisposed) {
        this.preloadedTextures.forEach((texture) => texture.dispose())
        return
      }
      this.experience.gallery.setPreloadedTextures(this.preloadedTextures)

      await this.experience.init(this.scene, this.camera)
      if (this.isDisposed) return
      this.scroll.init()
      // enter() 전에는 손가락을 움직여도 스크롤되지 않게 막는다(진입 화면이 덮고 있다)
      this.scroll.isInputLocked = !this.isEntered
      this.initStats()
      this.bindDebug()
      this.setDebugUiVisible(false)

      this.resize()
      this.bindEvents()

      if (restorePosition) this.restore(restorePosition)

      this.isInitialized = true
      this.start()
    } finally {
      document.body.classList.remove('loading')
    }
  }

  bindEvents() {
    if (this.areEventsBound) return
    this.areEventsBound = true
    this.resizeObserver.observe(this.canvas)
    window.addEventListener('keydown', this.onKeyDown)
    this.canvas.addEventListener('click', this.onCanvasClick)
    this.scroll.bindEvents()
  }

  unbindEvents() {
    this.areEventsBound = false
    this.resizeObserver.disconnect()
    window.removeEventListener('keydown', this.onKeyDown)
    this.canvas.removeEventListener('click', this.onCanvasClick)
    this.scroll.unbindEvents()
  }

  // 앨범을 열어 상세로 갈 때 — WebGL 장면(컨텍스트·셰이더·사진)은 그대로 두고 루프와 이벤트만 멈춘다.
  // 돌아오면 resume으로 다시 붙인다. 새로 만들면 컨텍스트·셰이더·사진 업로드에 시간이 걸려 검은 화면이 비친다.
  pause() {
    this.isRunning = false
    if (this.animationFrameRequestId !== null) {
      cancelAnimationFrame(this.animationFrameRequestId)
      this.animationFrameRequestId = null
    }
    window.clearTimeout(this.openTimeoutId)
    this.unbindEvents()
  }

  // 배경 셰이더의 위쪽 가운데 색 — 블롭이 천천히 움직이고 스크롤하면 섞이므로 매 프레임 계산하되,
  // 8비트 hex로 바뀔 때만 알린다(대부분의 프레임은 같은 값이라 DOM을 건드리지 않는다)
  updateTopColor() {
    if (!this.callbacks.onTopColorChange) return

    this.experience.background.getColorAt(0.5, 1, this.topColor)
    const hex = `#${this.topColor.getHexString(THREE.LinearSRGBColorSpace)}`
    if (hex === this.lastTopColorHex) return

    this.lastTopColorHex = hex
    this.callbacks.onTopColorChange(hex)
  }

  // callbacks는 새로 마운트된 화면의 것으로 바꾼다(이전 화면의 setState를 부르지 않게)
  resume(callbacks) {
    this.callbacks = callbacks
    // 카드 속으로 들어가던 열기 연출을 되돌려 제자리에서 시작한다
    this.isOpening = false
    this.openStartTime = null
    this.scroll.isInputLocked = !this.isEntered
    // 다음 프레임에 활성 카드를 다시 알려서 새 화면의 캡션이 바로 채워지게 한다
    this.activeIndex = -1
    this.lastCaptionKey = null
    this.lastTopColorHex = null
    this.bindEvents()
    this.resize()
    this.start()
  }

  start() {
    if (!this.isInitialized || this.isRunning) return

    this.isRunning = true
    this.update()
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth || 1
    const height = this.canvas.clientHeight || window.innerHeight || 1
    if (width <= 0 || height <= 0) return

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.experience.gallery.setViewportSize(width, height)
    this.experience.gallery.updatePlaneScale()
    this.experience.gallery.layoutPlanes()
    if (this.activeIndex >= 0) this.emitActive()
  }

  async preloadTextures() {
    const textureSources = this.experience.gallery.getTextureSources()
    if (!textureSources.length) return new Map()

    const textureLoader = new THREE.TextureLoader()
    const loadedTextures = new Map()

    await Promise.all(
      textureSources.map(async (textureSource) => {
        try {
          const texture = await textureLoader.loadAsync(textureSource)
          texture.colorSpace = THREE.SRGBColorSpace
          loadedTextures.set(textureSource, texture)
        } catch (error) {
          console.warn(`Texture failed to load: ${textureSource}`, error)
        }
      })
    )

    return loadedTextures
  }

  update() {
    if (!this.isRunning) return

    this.animationFrameRequestId = requestAnimationFrame(this.animate)
    this.stats?.begin()

    const time = performance.now()

    this.updateCameraOffset()
    this.scroll.update()
    this.experience.update(time, this.camera, this.scroll)
    this.updateActive()
    this.updateTopColor()

    this.renderer.clear(true, true, true)
    this.experience.background.render(this.renderer)
    this.renderer.clearDepth()
    this.renderer.render(this.scene, this.camera)
    this.stats?.end()
  }

  initStats() {
    if (this.stats) return

    this.stats = new Stats()
    this.stats.showPanel(0)
    this.stats.dom.classList.add('fps-stats')
    document.body.append(this.stats.dom)
    this.setFpsVisible(this.showFps)
  }

  setFpsVisible(isVisible) {
    if (!this.stats) return
    const shouldShow = Boolean(isVisible) && this.isDebugUiVisible
    this.stats.dom.style.display = shouldShow ? 'block' : 'none'
  }

  setDebugUiVisible(isVisible) {
    this.isDebugUiVisible = Boolean(isVisible)
    this.debug?.setVisible(this.isDebugUiVisible)
    this.scroll?.setDebugUiVisible(this.isDebugUiVisible)
    this.setFpsVisible(this.showFps)
  }

  bindDebug() {
    if (!this.debug || this.isDebugBound) return

    this.debug.addBinding({
      folderTitle: 'Engine',
      targetObject: this,
      property: 'showFps',
      label: 'Show FPS',
      onChange: (value) => {
        this.setFpsVisible(value)
      },
    })

    this.isDebugBound = true
  }

  dispose() {
    if (this.isDisposed) return
    this.isDisposed = true
    this.isRunning = false

    if (this.animationFrameRequestId !== null) {
      cancelAnimationFrame(this.animationFrameRequestId)
      this.animationFrameRequestId = null
    }

    this.unbindEvents()
    window.clearTimeout(this.openTimeoutId)
    this.scroll.dispose()

    this.preloadedTextures.forEach((texture) => {
      texture.dispose()
    })
    this.preloadedTextures.clear()
    this.stats?.dom.remove()
    this.stats = null
    this.experience.dispose?.()
    // 화면에 들어올 때마다 WebGL 컨텍스트를 새로 만든다 — 바로 놓아주지 않으면 오갈수록 쌓여
    // 브라우저 한도(보통 16개)에 걸리고 폰에서는 메모리 때문에 탭이 새로고침된다.
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}

export { Engine }

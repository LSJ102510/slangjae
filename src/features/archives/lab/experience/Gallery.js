import * as THREE from 'three'
import { galleryPlaneData } from './galleryData.js'

class Gallery {
  constructor(debug = null) {
    this.isInitialized = false
    this.isDebugBound = false
    this.debug = debug

    // Planes
    this.planes = []
    this.texturesBySource = new Map()
    this.useTextures = true
    this.planeGap = 5
    this.desktopPlaneScale = 1
    this.mobilePlaneScale = 1
    // 폰은 좌우 여백을 20px로 맞춰서 카드를 가로로 엇갈리게 두지 않는다(엇갈리면 여백이 카드마다 달라진다)
    this.mobileXSpreadFactor = 0
    // px — Tailwind 5단계(spacing × 5). 캡션은 Engine.getCaptionRect로 사진 영역을 받아서 이 여백을 그대로 따라간다.
    // WebGL 계산이라 Tailwind 클래스를 못 써서 숫자로 둔다.
    this.mobileSidePadding = 20
    // 사진 크기를 모두 같게 — 카드는 이 비율로 고정하고, 사진은 꽉 채운 뒤 넘치는 쪽을 잘라낸다(cover)
    this.cardAspectRatio = 4 / 5
    this.mobileBreakpoint = 768
    // 카드 크기를 계산할 화면 크기 — 카메라와 같은 기준(캔버스 크기)이어야 해서 Engine.resize가 넣어 준다.
    // window.innerHeight를 쓰면 폰에서 주소창이 접힐 때(상세 화면을 스크롤하고 돌아올 때) 캔버스와
    // 값이 달라져 카드 크기·여백이 틀어진다.
    this.viewportWidth = window.innerWidth
    this.viewportHeight = window.innerHeight
    this.planeConfig = galleryPlaneData
    this.moodSampleOffset = 1
    this.planeFadeSampleOffset = 1
    this.planeFadeSmoothing = 0.14
    // 다음·그다음 카드가 뒤에 비치는 정도
    this.nextPlanePeekOpacity = 0.22
    this.farPlanePeekOpacity = 0.07

    // 원본의 마우스 패럴랙스(커서를 따라 카드·연도 글자가 움직이고 기울던 효과)는 뺐다 — 폰 전용 화면이다.

    // 카드 모양 — 둥근 모서리와 바닥 그림자(인화한 사진처럼)
    this.cornerRadiusRatio = 0.045
    this.shadowOpacity = 0.55
    this.alphaMapsByAspect = new Map()
    this.shadowTexture = null

    // 한 앨범 안에서 좌우로 사진 넘기기
    // 이전 사진은 넘긴 방향으로 밀려나며 사라지고, 새 사진은 반대쪽에서 살짝 들어온다(크로스페이드).
    // 시간 기준(ms)이라 120Hz 폰에서도 같은 속도다. 너무 길면 넘긴 게 구분이 안 돼서 짧게 둔다.
    this.photoTransitionDuration = 320
    this.photoIncomingOffset = 0.22
    this.photoOutgoingOffset = 0.32

    // 연도가 바뀌는 카드 뒤에 띄우는 큰 연도 글자
    this.yearMarkers = []
    this.yearMarkerDepth = 1.2
    // 흰 글자가 사진보다 튀지 않게 반투명으로 둔다
    this.yearMarkerOpacity = 0.4
    // 연도 글자 폭(화면 폭 대비)과 사진 위쪽 끝과의 간격(px)
    // 캔버스를 글자 외곽에 딱 맞게 잘라서, 예전(여백 포함 0.96 / 0.6)과 같은 글자 크기가 되도록 줄인 값이다
    this.yearMarkerWidthRatio = { mobile: 0.85, desktop: 0.53 }
    // px — Tailwind 7단계(spacing × 7)
    this.yearMarkerGap = 28
    this.yearMarkerFont = '800 300px Pretendard, system-ui, sans-serif'

    // Breath
    this.breathEnabled = true
    this.breathScaleAmount = 0.03
    this.breathSmoothing = 0.14
    this.breathGain = 1.1
    this.breathIntensity = 0
    this.targetBreathIntensity = 0

    // Gesture drift
    this.gestureParallaxEnabled = true
    this.gestureParallaxAmountY = 0.05
    this.gestureParallaxSmoothing = 0.05
    this.driftCurrent = 0
    this.driftTarget = 0
  }

  async init(scene) {
    if (this.isInitialized) return

    this.setPlanes(scene)
    await this.loadYearMarkerFont()
    this.setYearMarkers(scene)
    this.updatePlaneMaterialMode()
    this.updatePlaneScale()
    this.layoutPlanes()
    this.bindDebug()

    this.isInitialized = true
  }

  setPlanes(scene) {
    const planeGeometry = new THREE.PlaneGeometry(3, 3)

    this.planeConfig.forEach((plane, index) => {
      const texture = this.texturesBySource.get(plane.textureSrc) || null
      const textureImage = texture?.image
      // 사진 비율과 상관없이 카드 크기를 통일한다(사진은 applyCoverFit으로 잘라 맞춘다)
      const aspectRatio = this.cardAspectRatio
      const fallbackColor = plane.fallbackColor || '#ffffff'
      // 배경 무드는 사진에서 뽑는다 — 사진이 바뀌어도 손으로 색을 다시 고를 필요가 없다.
      const palette = this.extractPalette(textureImage)
      const accentColor = palette?.blob1 || plane.accentColor || fallbackColor
      const backgroundColor = palette?.background || plane.backgroundColor || fallbackColor
      const blob1Color = palette?.blob1 || plane.blob1Color || fallbackColor
      const blob2Color = palette?.blob2 || plane.blob2Color || fallbackColor
      const labelData = this.getPlaneLabelData(plane, this.planes.length)
      const planeMaterial = new THREE.MeshBasicMaterial({
        color: fallbackColor,
        map: texture,
        alphaMap: this.getRoundedAlphaMap(aspectRatio),
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        opacity: index === 0 ? 1 : 0,
      })
      const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
      planeMesh.add(this.createShadowMesh(planeGeometry))
      planeMesh.userData.archiveId = plane.archiveId
      planeMesh.userData.year = plane.year
      planeMesh.userData.photos = plane.photos?.length ? plane.photos : [plane.textureSrc]
      planeMesh.userData.photoIndex = 0
      planeMesh.userData.photoTransition = null
      planeMesh.userData.basePosition = plane.position
      planeMesh.userData.baseColor = fallbackColor
      planeMesh.userData.accentColor = accentColor
      planeMesh.userData.backgroundColor = backgroundColor
      planeMesh.userData.blob1Color = blob1Color
      planeMesh.userData.blob2Color = blob2Color
      planeMesh.userData.label = labelData
      planeMesh.userData.texture = texture
      planeMesh.userData.aspectRatio = aspectRatio
      scene.add(planeMesh)
      this.planes.push(planeMesh)
    })
  }

  // 사진을 작게 줄여 픽셀을 훑고 배경·블롭 색 세 개를 고른다.
  // 배경은 평균색을 어둡게(글자가 늘 읽히게), 블롭1은 가장 채도 높은 색들, 블롭2는 어두운 쪽 평균이다.
  extractPalette(image) {
    if (!image || !image.width || !image.height) return null

    const sampleSize = 24
    const canvas = document.createElement('canvas')
    canvas.width = sampleSize
    canvas.height = sampleSize
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null

    // 실제 API 사진이 다른 도메인이고 CORS 헤더가 없으면 getImageData가 SecurityError를 던진다.
    // 그때는 null을 돌려 galleryData의 대체색을 쓴다 — 여기서 터지면 화면 전체가 안 뜬다.
    let data
    try {
      context.drawImage(image, 0, 0, sampleSize, sampleSize)
      data = context.getImageData(0, 0, sampleSize, sampleSize).data
    } catch (error) {
      console.warn('Palette extraction failed — using fallback colors', error)
      return null
    }
    const pixels = []
    for (let offset = 0; offset < data.length; offset += 4) {
      const color = new THREE.Color().setRGB(
        data[offset] / 255,
        data[offset + 1] / 255,
        data[offset + 2] / 255,
        THREE.SRGBColorSpace
      )
      const hsl = { h: 0, s: 0, l: 0 }
      color.getHSL(hsl)
      pixels.push({ color, hsl })
    }

    const average = (list) => {
      const sum = new THREE.Color(0, 0, 0)
      list.forEach(({ color }) => sum.add(color))
      return sum.multiplyScalar(1 / Math.max(list.length, 1))
    }
    const withLightness = (color, lightness, saturationScale = 1) => {
      const hsl = { h: 0, s: 0, l: 0 }
      color.getHSL(hsl)
      return new THREE.Color().setHSL(hsl.h, Math.min(hsl.s * saturationScale, 0.85), lightness)
    }

    const vivid = [...pixels]
      .filter(({ hsl }) => hsl.l > 0.2 && hsl.l < 0.85)
      .sort((a, b) => b.hsl.s - a.hsl.s)
      .slice(0, Math.ceil(pixels.length * 0.15))
    const dark = [...pixels].sort((a, b) => a.hsl.l - b.hsl.l).slice(0, Math.ceil(pixels.length * 0.5))

    const overall = average(pixels)
    const vividColor = vivid.length ? average(vivid) : overall

    return {
      background: `#${withLightness(overall, 0.1, 1.2).getHexString()}`,
      blob1: `#${withLightness(vividColor, 0.5, 1.4).getHexString()}`,
      blob2: `#${withLightness(average(dark), 0.28, 1.3).getHexString()}`,
    }
  }

  // 둥근 모서리 — 카드 비율마다 캔버스에 둥근 사각형을 그려 alphaMap으로 쓴다(비율이 같으면 재사용).
  getRoundedAlphaMap(aspectRatio) {
    const key = aspectRatio.toFixed(2)
    const cached = this.alphaMapsByAspect.get(key)
    if (cached) return cached

    const height = 256
    const width = Math.round(height * aspectRatio)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context.fillStyle = '#000000'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.roundRect(0, 0, width, height, Math.min(width, height) * this.cornerRadiusRatio * 2)
    context.fill()

    const texture = new THREE.CanvasTexture(canvas)
    this.alphaMapsByAspect.set(key, texture)
    return texture
  }

  // 카드 뒤에 깔리는 흐린 그림자 — 카드의 자식이라 크기·위치를 그대로 따라간다.
  createShadowMesh(planeGeometry) {
    if (!this.shadowTexture) {
      const size = 256
      const inset = 34
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      context.shadowColor = 'rgba(0, 0, 0, 1)'
      context.shadowBlur = 28
      context.fillStyle = 'rgba(0, 0, 0, 0.9)'
      context.fillRect(inset, inset, size - inset * 2, size - inset * 2)
      this.shadowTexture = new THREE.CanvasTexture(canvas)
    }

    const shadowMesh = new THREE.Mesh(
      planeGeometry,
      new THREE.MeshBasicMaterial({
        color: '#000000',
        map: this.shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      })
    )
    // 그림자 텍스처의 안쪽 사각형이 카드보다 살짝 크게, 조금 아래로 떨어지게 둔다
    shadowMesh.scale.set(1.36, 1.36, 1)
    shadowMesh.position.set(0, -0.08, -0.03)
    shadowMesh.userData.isShadow = true
    return shadowMesh
  }

  // Pretendard는 index.html에서 쓰는 글자·굵기만 그때그때 받는 dynamic subset이다.
  // 굵기 800은 앱 다른 곳에서 안 써서, 미리 받아 두지 않으면 캔버스에 기본 폰트로 그려진다.
  async loadYearMarkerFont() {
    if (!document.fonts?.load) return
    const years = [...new Set(this.planes.map((plane) => plane.userData.year).filter(Boolean))]
    try {
      await document.fonts.load(this.yearMarkerFont, years.join(''))
    } catch (error) {
      console.warn('Year marker font failed to load', error)
    }
  }

  // 연도가 바뀌는 첫 카드 뒤에 큰 외곽선 연도 글자를 띄운다 — 깊이 축이 곧 타임라인이 된다.
  setYearMarkers(scene) {
    let previousYear = null

    this.planes.forEach((plane, index) => {
      const { year } = plane.userData
      if (!year || year === previousYear) return
      previousYear = year

      // 캔버스를 글자 외곽에 딱 맞게 잘라야 메시 아래 끝 = 글자 아래 끝이 돼서 사진과의 간격을 정확히 잡을 수 있다
      const font = this.yearMarkerFont
      const padding = 8
      const canvas = document.createElement('canvas')
      const measureContext = canvas.getContext('2d')
      measureContext.font = font
      const metrics = measureContext.measureText(year)
      canvas.width = Math.ceil(metrics.width) + padding * 2
      canvas.height =
        Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + padding * 2
      const context = canvas.getContext('2d')
      context.font = font
      context.textAlign = 'center'
      context.textBaseline = 'alphabetic'
      context.fillStyle = '#ffffff'
      context.fillText(year, canvas.width / 2, padding + metrics.actualBoundingBoxAscent)

      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const marker = new THREE.Mesh(
        new THREE.PlaneGeometry(1, canvas.height / canvas.width),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          opacity: 0,
        })
      )
      marker.userData.planeIndex = index
      marker.userData.heightRatio = canvas.height / canvas.width
      scene.add(marker)
      this.yearMarkers.push(marker)
    })
  }

  // 연도 글자는 그 연도의 첫 카드에 멈춰 있을 때 가장 진하고, 멀어지면 사라진다.
  updateYearMarkers(cameraZ) {
    const isMobileViewport = this.viewportWidth <= this.mobileBreakpoint
    const viewportAspect = Math.max(this.viewportWidth / this.viewportHeight, 0.0001)
    const distance = 5 + this.yearMarkerDepth
    const visibleHeight = 2 * Math.tan((45 * Math.PI) / 360) * distance
    const visibleWidth = visibleHeight * viewportAspect
    const width = Math.min(
      visibleWidth *
        (isMobileViewport ? this.yearMarkerWidthRatio.mobile : this.yearMarkerWidthRatio.desktop),
      6
    )
    // 글자 평면은 카드보다 yearMarkerDepth만큼 뒤에 있어서, 같은 화면 높이로 보이려면 거리 비율만큼 키워 잡아야 한다
    const depthScale = distance / 5
    const unitsPerPixel = visibleHeight / this.viewportHeight

    this.yearMarkers.forEach((marker) => {
      const plane = this.planes[marker.userData.planeIndex]
      const planeZ = -marker.userData.planeIndex * this.planeGap
      const restCameraZ = planeZ + 5
      const closeness = 1 - Math.min(Math.abs(cameraZ - restCameraZ) / this.planeGap, 1)
      const targetOpacity = THREE.MathUtils.smoothstep(closeness, 0.2, 1) * this.yearMarkerOpacity

      // 사진 위쪽 끝에서 yearMarkerGap(px)만큼 띄워 그 위에 올린다
      const cardHalfHeight = this.getViewportFitScale(plane?.userData.aspectRatio || 1) * 1.5
      const markerHeight = width * (marker.userData.heightRatio || 0.3)
      const markerBottom = cardHalfHeight * depthScale + this.yearMarkerGap * unitsPerPixel
      marker.scale.set(width, width, 1)
      marker.position.set(
        0,
        markerBottom + markerHeight * 0.5,
        planeZ - this.yearMarkerDepth
      )
      marker.material.opacity = THREE.MathUtils.lerp(marker.material.opacity, targetOpacity, 0.12)
    })
  }

  // 활성 카드의 사진을 앞뒤로 넘긴다. 넘긴 방향으로 살짝 밀려났다가 제자리로 돌아온다.
  shiftPhoto(planeIndex, direction) {
    const plane = this.planes[planeIndex]
    if (!plane) return null

    const { photos } = plane.userData
    const nextPhotoIndex = (plane.userData.photoIndex + direction + photos.length) % photos.length
    const texture = this.texturesBySource.get(photos[nextPhotoIndex])
    if (!texture) return null

    // 지금 보이는 사진을 위에 덮는 복제본으로 남겨 두고, 그게 밀려나며 사라지는 동안 아래에서 새 사진이 드러난다
    this.startPhotoTransition(plane, plane.material.map, direction)
    this.setPhoto(plane, nextPhotoIndex, texture)

    return { photoIndex: nextPhotoIndex, photoCount: photos.length }
  }

  // 전환 없이 바로 그 사진으로 — 상세에서 돌아왔을 때 보던 사진을 되살릴 때 쓴다
  restorePhoto(planeIndex, photoIndex) {
    const plane = this.planes[planeIndex]
    const texture = plane && this.texturesBySource.get(plane.userData.photos[photoIndex])
    if (!texture) return
    this.setPhoto(plane, photoIndex, texture)
  }

  setPhoto(plane, photoIndex, texture) {
    const aspectRatio = this.cardAspectRatio
    plane.userData.photoIndex = photoIndex
    plane.userData.texture = texture
    plane.userData.aspectRatio = aspectRatio
    plane.material.map = texture
    plane.material.alphaMap = this.getRoundedAlphaMap(aspectRatio)
    plane.material.needsUpdate = true
  }

  startPhotoTransition(plane, outgoingTexture, direction) {
    // 빠르게 연달아 넘기면 이전 복제본은 바로 치운다
    this.endPhotoTransition(plane)

    const outgoingMesh = new THREE.Mesh(
      plane.geometry,
      new THREE.MeshBasicMaterial({
        map: outgoingTexture,
        alphaMap: plane.material.alphaMap,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        opacity: plane.material.opacity,
      })
    )
    // 카드보다 살짝 앞에 둬서 위에 그려지게 한다
    outgoingMesh.position.z = 0.01
    plane.add(outgoingMesh)
    plane.userData.photoTransition = {
      direction,
      outgoingMesh,
      startTime: performance.now(),
    }
  }

  endPhotoTransition(plane) {
    const transition = plane.userData.photoTransition
    if (!transition) return
    plane.remove(transition.outgoingMesh)
    transition.outgoingMesh.material.dispose()
    plane.userData.photoTransition = null
  }

  // 전환 진행도(0~1, easeOutCubic)에 맞춰 새 사진 위치와 이전 사진(복제본)의 위치·투명도를 정한다.
  // 반환값은 카드 자체가 옆으로 밀려 있을 거리다.
  updatePhotoTransition(plane) {
    const transition = plane.userData.photoTransition
    if (!transition) return 0

    const progress = Math.min(
      (performance.now() - transition.startTime) / this.photoTransitionDuration,
      1
    )
    if (progress >= 1) {
      this.endPhotoTransition(plane)
      return 0
    }

    const eased = 1 - (1 - progress) ** 3
    // 왼쪽으로 밀면(direction 1) 새 사진은 오른쪽에서 들어오고, 이전 사진은 왼쪽으로 빠진다
    const incomingOffset = transition.direction * this.photoIncomingOffset * (1 - eased)
    const outgoingOffset = -transition.direction * this.photoOutgoingOffset * eased
    const { outgoingMesh } = transition
    // 복제본은 카드의 자식이라 카드 위치를 이미 따라간다 — 차이만큼만 로컬 좌표(카드 배율로 나눔)로 옮긴다
    outgoingMesh.position.x = (outgoingOffset - incomingOffset) / Math.max(plane.scale.x, 0.0001)
    outgoingMesh.material.opacity = plane.material.opacity * (1 - eased)

    return incomingOffset
  }

  getPlaneLabelData(planeDefinition, index) {
    const fallback = {
      word: `tone ${String(index + 1).padStart(2, '0')}`,
      pms: 'N/A',
      // 아카이빙용으로 추가한 필드 — 원본은 색 견본이라 날짜가 없었다
      date: '',
      color: '',
    }
    const label = planeDefinition.label || fallback

    return {
      word: label.word || fallback.word,
      pms: label.pms || fallback.pms,
      date: label.date || fallback.date,
      color: label.color || fallback.color,
    }
  }

  // 카드가 화면 안에 "액자처럼" 들어오도록 보이는 영역을 계산해서 크기를 정한다.
  // 원본은 고정 배율(데스크톱 1 / 모바일 0.65)이라, 가로가 좁은 폰에서는 가로로 긴 사진이 잘렸다.
  getViewportFitScale(aspectRatio) {
    const isMobileViewport = this.viewportWidth <= this.mobileBreakpoint
    const viewportAspect = Math.max(this.viewportWidth / this.viewportHeight, 0.0001)
    // 카메라(fov 45)가 보는 첫 카드까지의 거리 = Scroll.firstPlaneViewOffset
    const distanceToPlane = 5
    const visibleHeight = 2 * Math.tan((45 * Math.PI) / 360) * distanceToPlane
    const visibleWidth = visibleHeight * viewportAspect
    // 사방에 여백을 남겨야 "지나간다"는 느낌이 산다
    // 폰은 좌우 여백을 mobileSidePadding(px)으로 딱 맞춘다 — 화면 폭에서 양쪽 여백을 뺀 만큼이 카드 폭이다.
    const widthRatio = isMobileViewport
      ? Math.max(1 - (this.mobileSidePadding * 2) / this.viewportWidth, 0.1)
      : 0.72
    const heightRatio = isMobileViewport ? 0.56 : 0.72
    const geometrySize = 3

    const scaleByWidth = (visibleWidth * widthRatio) / (geometrySize * aspectRatio)
    const scaleByHeight = (visibleHeight * heightRatio) / geometrySize
    const maxScale = isMobileViewport ? this.mobilePlaneScale : this.desktopPlaneScale

    return Math.min(scaleByWidth, scaleByHeight, maxScale)
  }

  setViewportSize(width, height) {
    this.viewportWidth = width
    this.viewportHeight = height
  }

  updatePlaneScale() {
    this.planes.forEach((plane) => {
      const aspectRatio = plane.userData.aspectRatio || 1
      const scale = this.getViewportFitScale(aspectRatio)
      plane.scale.set(scale * aspectRatio, scale, 1)
    })
  }

  layoutPlanes() {
    const xSpreadFactor = this.getXSpreadFactor()

    this.planes.forEach((plane, index) => {
      const basePosition = plane.userData.basePosition || { x: 0, y: 0 }
      const xPosition = basePosition.x * xSpreadFactor
      plane.position.set(xPosition, basePosition.y, -index * this.planeGap)
    })
  }

  getXSpreadFactor() {
    const isMobileViewport = this.viewportWidth <= this.mobileBreakpoint
    return isMobileViewport ? this.mobileXSpreadFactor : 1
  }

  getDepthRange() {
    if (!this.planes.length) {
      return { nearestZ: 0, deepestZ: 0 }
    }

    const zPositions = this.planes.map((plane) => plane.position.z)
    return {
      nearestZ: Math.max(...zPositions),
      deepestZ: Math.min(...zPositions),
    }
  }

  getDepthProgress(cameraZ) {
    const { nearestZ, deepestZ } = this.getDepthRange()
    const depthSpan = nearestZ - deepestZ
    if (depthSpan <= 0) return 0

    return THREE.MathUtils.clamp((nearestZ - cameraZ) / depthSpan, 0, 1)
  }

  getActivePlaneIndex(cameraZ) {
    if (!this.planes.length) return -1

    let closestPlaneIndex = 0
    let smallestDistance = Infinity

    this.planes.forEach((plane, index) => {
      const distanceToPlane = Math.abs(cameraZ - plane.position.z)
      if (distanceToPlane < smallestDistance) {
        smallestDistance = distanceToPlane
        closestPlaneIndex = index
      }
    })

    return closestPlaneIndex
  }

  getMoodColorsByIndex(index) {
    if (index < 0 || index >= this.planes.length) return null

    const { backgroundColor, blob1Color, blob2Color } = this.planes[index].userData
    if (!backgroundColor) return null

    return { background: backgroundColor, blob1: blob1Color, blob2: blob2Color }
  }

  getMoodBlendData(cameraZ) {
    if (!this.planes.length) return null

    const safeCameraZ = Number.isFinite(cameraZ) ? cameraZ : this.planes[0].position.z
    const moodSampleZ = safeCameraZ - this.planeGap * this.moodSampleOffset
    const lastPlaneIndex = this.planes.length - 1

    if (lastPlaneIndex === 0 || this.planeGap <= 0) {
      const singleMood = this.getMoodColorsByIndex(0)
      if (!singleMood) return null

      return {
        currentMood: singleMood,
        nextMood: singleMood,
        blend: 0,
      }
    }

    const firstPlaneZ = this.planes[0].position.z
    const normalizedDepth = THREE.MathUtils.clamp(
      (firstPlaneZ - moodSampleZ) / this.planeGap,
      0,
      lastPlaneIndex
    )
    const currentPlaneIndex = Math.floor(normalizedDepth)
    const nextPlaneIndex = Math.min(currentPlaneIndex + 1, lastPlaneIndex)
    const blend = normalizedDepth - currentPlaneIndex

    const currentMood = this.getMoodColorsByIndex(currentPlaneIndex)
    const nextMood = this.getMoodColorsByIndex(nextPlaneIndex) || currentMood
    if (!currentMood || !nextMood) return null

    return {
      currentMood,
      nextMood,
      blend,
    }
  }

  getPlaneBlendData(cameraZ) {
    if (!this.planes.length) return null

    const planeGap = Math.max(this.planeGap, 0.0001)
    const firstPlaneZ = this.planes[0].position.z
    const lastPlaneIndex = this.planes.length - 1
    const sampledCameraZ = cameraZ - planeGap * this.planeFadeSampleOffset
    const normalizedDepth = THREE.MathUtils.clamp(
      (firstPlaneZ - sampledCameraZ) / planeGap,
      0,
      lastPlaneIndex
    )
    const currentPlaneIndex = Math.floor(normalizedDepth)
    const nextPlaneIndex = Math.min(currentPlaneIndex + 1, lastPlaneIndex)
    const blend = normalizedDepth - currentPlaneIndex

    return {
      currentPlaneIndex,
      nextPlaneIndex,
      blend,
    }
  }

  getActiveMoodColors(cameraZ) {
    const moodBlendData = this.getMoodBlendData(cameraZ)
    return moodBlendData?.currentMood || null
  }

  getTextureSources() {
    // 앨범 안에서 넘겨 볼 현장 사진까지 미리 받아 둔다(목데이터는 같은 파일을 돌려 써서 몇 장 안 된다)
    const textureSources = this.planeConfig
      .flatMap((planeDefinition) => [planeDefinition.textureSrc, ...(planeDefinition.photos || [])])
      .filter(Boolean)

    return [...new Set(textureSources)]
  }

  setPreloadedTextures(texturesBySource) {
    this.texturesBySource = texturesBySource instanceof Map ? texturesBySource : new Map()
    this.texturesBySource.forEach((texture) => this.applyCoverFit(texture))
  }

  // CSS object-fit: cover처럼 — 카드 비율보다 넓은 사진은 좌우를, 긴 사진은 위아래를 가운데 기준으로 잘라낸다.
  applyCoverFit(texture) {
    const image = texture?.image
    if (!image?.width || !image?.height) return

    const imageAspect = image.width / image.height
    if (imageAspect > this.cardAspectRatio) {
      const visibleRatio = this.cardAspectRatio / imageAspect
      texture.repeat.set(visibleRatio, 1)
      texture.offset.set((1 - visibleRatio) / 2, 0)
    } else {
      const visibleRatio = imageAspect / this.cardAspectRatio
      texture.repeat.set(1, visibleRatio)
      texture.offset.set(0, (1 - visibleRatio) / 2)
    }
    texture.needsUpdate = true
  }

  updatePlaneMaterialMode() {
    this.planes.forEach((plane) => {
      const planeMaterial = plane.material
      const texture = plane.userData.texture || null
      const hasTexture = Boolean(texture)

      planeMaterial.map = this.useTextures && hasTexture ? texture : null
      planeMaterial.color.set(this.useTextures && hasTexture ? '#ffffff' : plane.userData.baseColor)
      planeMaterial.needsUpdate = true
    })
  }

  bindDebug() {
    if (!this.debug || this.isDebugBound) return

    this.debug.addBinding({
      folderTitle: 'Gallery',
      targetObject: this,
      property: 'planeGap',
      label: 'Gap',
      options: {
        min: 0.4,
        max: 10,
        step: 0.1,
      },
      onChange: () => {
        this.layoutPlanes()
      },
    })

    this.debug.addBinding({
      folderTitle: 'Gallery',
      targetObject: this,
      property: 'useTextures',
      label: 'Use Textures',
      onChange: () => {
        this.updatePlaneMaterialMode()
      },
    })

    this.debug.addBinding({
      folderTitle: 'Gallery',
      targetObject: this,
      property: 'moodSampleOffset',
      label: 'Mood Offset',
      options: {
        min: 0,
        max: 1.5,
        step: 0.01,
      },
    })

    this.debug.addBinding({
      folderTitle: 'Gallery',
      targetObject: this,
      property: 'gestureParallaxEnabled',
      label: 'Gesture Parallax',
    })

    this.debug.addBinding({
      folderTitle: 'Gallery',
      targetObject: this,
      property: 'gestureParallaxAmountY',
      label: 'Gesture Y',
      options: {
        min: 0,
        max: 0.5,
        step: 0.01,
      },
    })

    this.debug.addBinding({
      folderTitle: 'Gallery',
      targetObject: this,
      property: 'breathEnabled',
      label: 'Plane Breath',
    })

    this.debug.addBinding({
      folderTitle: 'Gallery',
      targetObject: this,
      property: 'breathScaleAmount',
      label: 'Breath Scale',
      options: {
        min: 0,
        max: 0.1,
        step: 0.001,
      },
    })

    this.isDebugBound = true
  }

  // smoothing 1이면 바로 목표 투명도로 — 상세에서 돌아와 그 자리에서 시작할 때 서서히 나타나지 않게 한다
  updatePlaneVisibility(cameraZ, smoothing = this.planeFadeSmoothing) {
    const blendData = this.getPlaneBlendData(cameraZ)
    if (!blendData) return

    const { currentPlaneIndex, nextPlaneIndex, blend } = blendData

    this.planes.forEach((plane, index) => {
      let targetOpacity = 0

      if (index === currentPlaneIndex) {
        targetOpacity = 1 - blend
      }
      if (index === nextPlaneIndex) {
        // 다음 카드를 완전히 숨기지 않고 남겨둬서 "깊이로 쌓여 있다"가 보이게 한다
        targetOpacity = Math.max(targetOpacity, blend, this.nextPlanePeekOpacity)
      }
      if (index === nextPlaneIndex + 1) {
        targetOpacity = Math.max(targetOpacity, this.farPlanePeekOpacity)
      }

      const currentOpacity = Number.isFinite(plane.material.opacity) ? plane.material.opacity : 0
      plane.material.opacity = THREE.MathUtils.lerp(
        currentOpacity,
        targetOpacity,
        smoothing
      )
      plane.material.needsUpdate = true

      // 그림자는 또렷한 카드(활성 카드)에만 진하게 — 뒤에 비치는 카드까지 그림자가 깔리면 탁해진다
      plane.children.forEach((child) => {
        if (!child.userData.isShadow) return
        child.material.opacity = plane.material.opacity ** 2 * this.shadowOpacity
      })
    })
  }

  updatePlaneMotion(scroll = null) {
    // Velocity → breath + drift
    const velocityMax = Math.max(scroll?.velocityMax || 1, 0.0001)
    const velocityNormalized = THREE.MathUtils.clamp(
      Math.abs(scroll?.velocity || 0) / velocityMax,
      0,
      1
    )
    const scrollDrift = THREE.MathUtils.clamp((scroll?.velocity || 0) / velocityMax, -1, 1)
    this.targetBreathIntensity = this.breathEnabled
      ? THREE.MathUtils.clamp(velocityNormalized * this.breathGain, 0, 1)
      : 0
    this.breathIntensity = THREE.MathUtils.lerp(
      this.breathIntensity,
      this.targetBreathIntensity,
      this.breathSmoothing
    )
    this.driftTarget = this.gestureParallaxEnabled ? scrollDrift : 0
    this.driftCurrent = THREE.MathUtils.lerp(
      this.driftCurrent,
      this.driftTarget,
      this.gestureParallaxSmoothing
    )

    // Per-plane: position, rotation, scale
    const xSpreadFactor = this.getXSpreadFactor()

    this.planes.forEach((plane, index) => {
      const basePosition = plane.userData.basePosition || { x: 0, y: 0 }
      const xPosition = basePosition.x * xSpreadFactor
      const yPosition = basePosition.y
      const zPosition = -index * this.planeGap
      const opacity = Number.isFinite(plane.material.opacity) ? plane.material.opacity : 0
      const gestureOffsetY = this.driftCurrent * this.gestureParallaxAmountY

      const slideOffset = this.updatePhotoTransition(plane)

      plane.position.x = xPosition + slideOffset
      plane.position.y = yPosition + gestureOffsetY
      plane.position.z = zPosition

      const breathInfluence = this.breathEnabled ? this.breathIntensity * opacity : 0
      plane.rotation.set(0, 0, 0)

      const aspectRatio = plane.userData.aspectRatio || 1
      // 매 프레임 고정 배율로 덮어쓰면 화면에 맞춘 크기가 사라진다 — updatePlaneScale과 같은 계산을 쓴다.
      const baseScale = this.getViewportFitScale(aspectRatio)
      const scalePulse = 1 + this.breathScaleAmount * breathInfluence
      plane.scale.x = baseScale * aspectRatio * scalePulse
      plane.scale.y = baseScale * scalePulse
      plane.scale.z = 1
    })
  }

  // cameraZ는 연출용 오프셋(진입·열기)을 뺀 스크롤 위치다 — 카메라가 앞으로 확 다가가도 활성 카드가 흐려지지 않는다.
  update(cameraZ = null, scroll = null) {
    if (!Number.isFinite(cameraZ)) return
    this.updatePlaneVisibility(cameraZ)
    this.updatePlaneMotion(scroll)
    this.updateYearMarkers(cameraZ)
  }

  dispose() {
    this.planes.forEach((plane) => {
      this.endPhotoTransition(plane)
      plane.children.forEach((child) => child.material.dispose())
      plane.material.dispose()
    })
    // 카드·그림자는 geometry 하나를 같이 쓴다
    this.planes[0]?.geometry.dispose()
    this.planes = []
    this.alphaMapsByAspect.forEach((texture) => texture.dispose())
    this.alphaMapsByAspect.clear()
    this.shadowTexture?.dispose()
    this.yearMarkers.forEach((marker) => {
      marker.material.map?.dispose()
      marker.material.dispose()
      marker.geometry.dispose()
    })
    this.yearMarkers = []
  }
}

export { Gallery }

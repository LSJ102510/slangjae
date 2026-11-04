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

    // 배경 색조 — 포스터(#1d3c8f) 파랑(0.6 부근)을 가운데 두고 카드마다 ±moodHueRange 안에서 고르게 퍼뜨린다
    // (extractPalette). 0.08이면 청록빛 파랑(0.52)~남보라(0.68) 사이를 오간다.
    // 사진 색조를 쓰지 않는 이유: 행사 사진은 대부분 따뜻한 색(사람·실내 조명)이라 파랑의 정반대 쪽이어서,
    // 끌어당기면 전부 양 끝(보라 또는 청록)으로만 몰린다. 사진은 밝기·채도에만 반영한다.
    this.moodHue = 0.6
    this.moodHueRange = 0.08
    // 기본 채도 — 회색조 사진이어도 파랗게 보이도록 바닥을 깔고, 사진 채도만큼 더 진해진다
    this.moodSaturation = 0.4
    this.moodSaturationKeep = 0.5
    // 사진 밝기를 배경 밝기에 얼마나 반영할지 — 밝은 사진은 배경도 조금 밝게, 어두운 사진은 더 깊게
    this.moodLightnessKeep = 0.8

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
      const palette = this.extractPalette(textureImage, index)
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
  // 색조는 진입 화면(이번 행사 포스터)의 파랑 쪽으로 끌어당긴다 — 사진 색은 파랑 안에서 약간의 차이로만 남아서,
  // 넘길 때 카드마다 배경이 조금씩 달라지되 전체는 파란 계열로 묶인다.
  extractPalette(image, index = 0) {
    if (!image || !image.width || !image.height) return null

    // 황금비 간격으로 돌리면 이웃 카드끼리 색조가 늘 꽤 다르고, 장수가 늘어도 고르게 퍼진다(-1~1)
    const hueSpread = ((index * 0.618034) % 1) * 2 - 1
    const hue = (this.moodHue + hueSpread * this.moodHueRange + 1) % 1

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
      const saturation = Math.min(
        this.moodSaturation + hsl.s * saturationScale * this.moodSaturationKeep,
        0.85
      )
      // 행사 사진의 보통 밝기(0.4)를 기준으로 밝으면 키우고 어두우면 줄인다
      const lightnessScale = 1 + (hsl.l - 0.4) * this.moodLightnessKeep
      return new THREE.Color().setHSL(hue, saturation, lightness * lightnessScale)
    }

    const vivid = [...pixels]
      .filter(({ hsl }) => hsl.l > 0.2 && hsl.l < 0.85)
      .sort((a, b) => b.hsl.s - a.hsl.s)
      .slice(0, Math.ceil(pixels.length * 0.15))
    const dark = [...pixels].sort((a, b) => a.hsl.l - b.hsl.l).slice(0, Math.ceil(pixels.length * 0.5))

    const overall = average(pixels)
    const vividColor = vivid.length ? average(vivid) : overall

    return {
      background: `#${withLightness(overall, 0.2, 1.2).getHexString()}`,
      blob1: `#${withLightness(vividColor, 0.5, 1.4).getHexString()}`,
      blob2: `#${withLightness(average(dark), 0.3, 1.3).getHexString()}`,
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
  }
}

export { Gallery }

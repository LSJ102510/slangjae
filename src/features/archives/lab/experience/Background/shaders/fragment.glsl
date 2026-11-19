varying vec2 vUv;

uniform vec3 uBackgroundColor;
uniform vec3 uBlob1Color;
uniform vec3 uBlob2Color;
uniform float uNoiseStrength;
uniform float uBlobRadius;
uniform float uBlobRadiusSecondary;
uniform float uBlobStrength;
uniform float uTime;
uniform float uVelocityIntensity;
// 물결(울림) — 포스터의 가는 흰 동심원. 화면 크기(px)로 선 굵기를 화면과 상관없이 1px쯤으로 맞춘다
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uRipplePhase;
uniform float uRippleOpacity;

float random(vec2 coord) {
  return fract(sin(dot(coord, vec2(12.9898, 78.233))) * 43758.5453123);
}

// center에서 바깥으로 퍼지는 동심원. 좌표 단위는 화면 높이(세로 1). phase만큼 링이 바깥으로 밀려난다.
// 가운데 가까이와 maxRadius 밖은 흐려서, 원이 생겨나 퍼지다 사라지는 것처럼 보이게 한다.
float rings(vec2 point, vec2 center, float spacing, float maxRadius, float phase) {
  float dist = distance(point, center);
  float wave = (dist - phase * spacing) / spacing;
  float distanceToRing = abs(fract(wave) - 0.5) * spacing;
  float cssPx = distanceToRing * uResolution.y / uPixelRatio;
  float line = 1.0 - smoothstep(0.35, 1.1, cssPx);
  float fadeOut = 1.0 - smoothstep(maxRadius * 0.55, maxRadius, dist);
  float fadeIn = smoothstep(0.0, spacing * 2.5, dist);
  return line * fadeOut * fadeIn;
}

void main() {
  // Flat background color
  vec3 color = uBackgroundColor;

  // Blob centers subtely animated
  float animTime = uTime * 0.00028;
  vec2 blob1Center = vec2(
    0.50 + sin(animTime * 1.000) * 0.13 + sin(animTime * 1.618) * 0.05,
    0.48 + cos(animTime * 0.794) * 0.09 + cos(animTime * 1.272) * 0.03
  );
  vec2 blob2Center = vec2(
    0.35 + cos(animTime * 0.927) * 0.11 + cos(animTime * 1.414) * 0.04,
    0.55 + sin(animTime * 1.175) * 0.07 + sin(animTime * 0.618) * 0.03
  );

  // Two blobs: 1 at center, 0 at edge
  float blob1 = smoothstep(uBlobRadius, 0.0, distance(vUv, blob1Center));
  float blob2 = smoothstep(uBlobRadiusSecondary, 0.0, distance(vUv, blob2Center));

  // Soften blob colors toward background before applying
  vec3 blob1SoftColor = mix(uBlob1Color, uBackgroundColor, 0.35);
  vec3 blob2SoftColor = mix(uBlob2Color, uBackgroundColor, 0.35);
  color = mix(color, blob1SoftColor, blob1 * uBlobStrength);
  color = mix(color, blob2SoftColor, blob2 * uBlobStrength);

  // 물결 두 묶음 — 사진 뒤 화면 가운데에서 퍼지는 큰 울림과, 포스터처럼 오른쪽 아래에서 겹쳐 들어오는 작은 울림.
  // 스크롤이 빠를수록 조금 더 밝아진다(Background.update가 퍼지는 속도도 올린다)
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 point = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);
  float mainRings = rings(point, vec2(0.0, 0.0), 0.045, 0.95, uRipplePhase);
  float echoRings = rings(point, vec2(aspect * 0.42, -0.36), 0.04, 0.55, uRipplePhase * 0.8);
  // 세로로 긴 폰 화면은 물결이 사진·캡션 뒤를 더 많이 지나가서 약하게, 오른쪽 아래 작은 물결은 더 약하게 둔다
  float isWide = smoothstep(0.6, 1.0, aspect);
  float ringOpacity = uRippleOpacity * mix(0.55, 1.0, isWide) * (1.0 + uVelocityIntensity * 0.8);
  float echoOpacity = ringOpacity * mix(0.35, 0.6, isWide);
  color = mix(color, vec3(1.0), clamp(mainRings * ringOpacity + echoRings * echoOpacity, 0.0, 1.0));

  // Velocity luminance lift
  color += uVelocityIntensity * 0.06;

  // Film grain
  float grain = random(vUv * vec2(1387.13, 947.91)) - 0.5;
  color += grain * uNoiseStrength;
  color = clamp(color, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}

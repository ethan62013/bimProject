import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const HINTS = {
  orbit: '左键旋转，右键平移，滚轮缩放。',
  distance: '距离：依次点击两个点。',
  angle: '角度：依次点击三个点，角度记在第二个点。',
  area: '面积：点击一个面，计算与它共面且相连的区域。'
}

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.localClippingEnabled = true
  renderer.setClearColor(0xc5d0dc, 1)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000)
  camera.position.set(8, 6, 8)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.zoomToCursor = true
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  }

  scene.add(new THREE.AmbientLight(0xffffff, 0.35))
  scene.add(new THREE.HemisphereLight(0xf7fbff, 0x8d9a86, 0.55))
  const sun = new THREE.DirectionalLight(0xfff4e5, 1.15)
  sun.position.set(18, 28, 10)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xd5e4f5, 0.4)
  fill.position.set(-14, 10, -8)
  scene.add(fill)

  const measureRoot = new THREE.Group()
  scene.add(measureRoot)
  const highlightRoot = new THREE.Group()
  scene.add(highlightRoot)
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  const planeClip = [clipPlane]
  const boxPlanes = Array.from({ length: 6 }, () => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0))
  let activePlanes = planeClip
  let sectionOn = false
  let sectionMode = 'plane'
  let sectionAxis = 'y'
  let sectionFlip = false
  let sectionT = 0.62
  const sectionBox = { x: [0.08, 0.92], y: [0, 0.62], z: [0.08, 0.92] }
  const sectionFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x1e8fb8,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  )
  const sectionEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(sectionFill.geometry),
    new THREE.LineBasicMaterial({ color: 0x8fdfff })
  )
  sectionFill.raycast = () => {}
  sectionEdge.raycast = () => {}
  const sectionFrame = new THREE.Group()
  sectionFrame.add(sectionFill, sectionEdge)
  const sectionRoot = new THREE.Group()
  sectionRoot.add(sectionFrame)
  sectionRoot.visible = false
  scene.add(sectionRoot)
  const boxGeometry = new THREE.BufferGeometry()
  boxGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(72), 3))
  const boxHelper = new THREE.LineSegments(
    boxGeometry,
    new THREE.LineBasicMaterial({ color: 0x8fdfff })
  )
  boxHelper.frustumCulled = false
  boxHelper.raycast = () => {}
  boxHelper.visible = false
  scene.add(boxHelper)

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const labels = []
  let model = null
  let spacesVisible = false
  let mode = 'orbit'
  let points = []
  let selectedId = null
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: 0xe07a1f,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  })
  const outlines = []
  let viewWidth = 0
  let viewHeight = 0
  let modelSphere = null

  function resize() {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height || (width === viewWidth && height === viewHeight)) return
    viewWidth = width
    viewHeight = height
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function boundsOfModel() {
    const box = new THREE.Box3()
    if (!model) return box
    model.byId.forEach((record) => {
      if (record.frameIgnore) return
      record.parts.forEach((part) => unionPartWorldBox(box, part))
    })
    return box
  }

  function boundsOfRecord(record) {
    const box = new THREE.Box3()
    record.parts.forEach((part) => unionPartWorldBox(box, part))
    return box
  }

  function frameModel() {
    frameBox(boundsOfModel())
  }

  function captureModelSphere() {
    const box = new THREE.Box3()
    if (model) {
      model.byId.forEach((record) => {
        record.parts.forEach((part) => unionPartWorldBox(box, part))
      })
    }
    modelSphere = box.isEmpty() ? null : box.getBoundingSphere(new THREE.Sphere())
  }

  function fitClipPlanes() {
    const distance = Math.max(camera.position.distanceTo(controls.target), 1e-4)
    if (!modelSphere || !(modelSphere.radius > 0)) {
      camera.near = Math.max(Math.min(distance / 100, distance * 0.2), 1e-4)
      camera.far = Math.max(distance * 20, camera.near * 200)
      camera.updateProjectionMatrix()
      return
    }
    const radius = modelSphere.radius
    const centerDistance = camera.position.distanceTo(modelSphere.center)
    const farthest = Math.max(centerDistance + radius, distance + radius, 1e-3)
    let far = farthest * 1.5
    let near
    if (centerDistance > radius * 1.01) {
      const closest = centerDistance - radius
      near = closest * 0.5
      if (far / near > 8000) near = far / 8000
      near = Math.min(near, closest * 0.8)
    } else {
      near = Math.min(distance * 0.02, Math.max(radius * 0.002, 1e-4))
      near = Math.min(near, distance * 0.25)
    }
    near = Math.max(near, 1e-4)
    if (!(far > near)) far = near * 100
    camera.near = near
    camera.far = far
    camera.updateProjectionMatrix()
  }

  function frameBox(box) {
    if (!box || box.isEmpty()) return
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(size.length() / 2, 0.5)
    const distance = radius / Math.tan((camera.fov * Math.PI) / 360)
    const direction = new THREE.Vector3(1, 0.72, 1).normalize()
    camera.position.copy(center).addScaledVector(direction, distance * 1.35)
    camera.near = Math.max(radius / 200, 0.01)
    camera.far = Math.max(radius * 40, 100)
    camera.updateProjectionMatrix()
    controls.target.copy(center)
    controls.update()
  }

  function setModel(next) {
    if (model) scene.remove(model.group)
    clearMeasurements()
    clearHighlight()
    model = next
    spacesVisible = false
    if (!model) {
      modelSphere = null
      return
    }
    const heavy = model.ids.size > 2500
    renderer.setPixelRatio(heavy ? 1 : Math.min(window.devicePixelRatio, 2))
    viewWidth = 0
    viewHeight = 0
    scene.add(model.group)
    frameModel()
    captureModelSphere()
    if (sectionOn) {
      updateSection()
      applyClipping()
    }
  }

  function useClip(material) {
    if (!sectionOn) return material
    material.clippingPlanes = activePlanes
    material.clipShadows = true
    return material
  }

  function applyClipping() {
    const planes = sectionOn ? activePlanes : null
    const seen = new Set()
    const bind = (material) => {
      if (!material || seen.has(material)) return
      seen.add(material)
      material.clippingPlanes = planes
      material.clipShadows = sectionOn
      material.needsUpdate = true
    }
    if (model) model.batches.forEach((batch) => bind(batch.material))
    bind(outlineMaterial)
    measureRoot.traverse((object) => bind(object.material))
    highlightRoot.traverse((object) => bind(object.material))
  }

  function updateSection() {
    sectionRoot.visible = false
    boxHelper.visible = false
    if (!sectionOn || !model) return
    const box = boundsOfModel()
    if (box.isEmpty()) return
    if (sectionMode === 'box') {
      activePlanes = boxPlanes
      updateSectionBox(box)
      boxHelper.visible = true
      return
    }
    activePlanes = planeClip
    updateSectionPlane(box)
    sectionRoot.visible = true
  }

  function updateSectionPlane(box) {
    const min = box.min[sectionAxis]
    const max = box.max[sectionAxis]
    const span = Math.max(max - min, 0.001)
    const at = min + span * sectionT
    const normal = new THREE.Vector3()
    normal[sectionAxis] = sectionFlip ? 1 : -1
    clipPlane.normal.copy(normal)
    clipPlane.constant = -normal[sectionAxis] * at
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    sectionRoot.position.copy(center)
    sectionRoot.position[sectionAxis] = at
    sectionRoot.position.addScaledVector(normal, span * 0.004)
    sectionRoot.rotation.set(0, 0, 0)
    if (sectionAxis === 'y') {
      sectionRoot.rotation.x = Math.PI / 2
      sectionFrame.scale.set(Math.max(size.x, 0.2), Math.max(size.z, 0.2), 1)
    } else if (sectionAxis === 'x') {
      sectionRoot.rotation.y = Math.PI / 2
      sectionFrame.scale.set(Math.max(size.z, 0.2), Math.max(size.y, 0.2), 1)
    } else {
      sectionFrame.scale.set(Math.max(size.x, 0.2), Math.max(size.y, 0.2), 1)
    }
  }

  function updateSectionBox(box) {
    const at = (axis, t) => {
      const min = box.min[axis]
      const max = box.max[axis]
      return min + Math.max(max - min, 0.001) * t
    }
    const x0 = at('x', sectionBox.x[0])
    const x1 = at('x', sectionBox.x[1])
    const y0 = at('y', sectionBox.y[0])
    const y1 = at('y', sectionBox.y[1])
    const z0 = at('z', sectionBox.z[0])
    const z1 = at('z', sectionBox.z[1])
    boxPlanes[0].set(new THREE.Vector3(1, 0, 0), -x0)
    boxPlanes[1].set(new THREE.Vector3(-1, 0, 0), x1)
    boxPlanes[2].set(new THREE.Vector3(0, 1, 0), -y0)
    boxPlanes[3].set(new THREE.Vector3(0, -1, 0), y1)
    boxPlanes[4].set(new THREE.Vector3(0, 0, 1), -z0)
    boxPlanes[5].set(new THREE.Vector3(0, 0, -1), z1)
    const corners = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
    ]
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    const attr = boxGeometry.getAttribute('position')
    edges.forEach(([a, b], index) => {
      attr.setXYZ(index * 2, corners[a][0], corners[a][1], corners[a][2])
      attr.setXYZ(index * 2 + 1, corners[b][0], corners[b][1], corners[b][2])
    })
    attr.needsUpdate = true
    boxGeometry.computeBoundingSphere()
  }

  function setSectionEnabled(enabled) {
    sectionOn = enabled
    updateSection()
    applyClipping()
    return sectionOn
  }

  function isolate(ids) {
    if (!model) return 0
    const keep = new Set(ids)
    let shown = 0
    model.byId.forEach((record, id) => {
      let visible = keep.has(id)
      if (record.passThrough && !visible) return
      if (record.space && !spacesVisible) visible = false
      if (visible) shown += 1
      record.parts.forEach((part) => part.batch.setVisibleAt(part.geometryId, visible))
    })
    if (selectedId != null && !keep.has(selectedId)) clearHighlight()
    if (shown) {
      const box = new THREE.Box3()
      model.byId.forEach((record, id) => {
        if (!keep.has(id) || (record.space && !spacesVisible)) return
        record.parts.forEach((part) => unionPartWorldBox(box, part))
      })
      frameBox(box)
    }
    return shown
  }

  function idsUsingMaterial(name) {
    const ids = []
    if (!model) return ids
    model.byId.forEach((record, id) => {
      const matched = record.parts.some((part) => part.batch.material && part.batch.material.name === name)
      if (matched) ids.push(id)
    })
    return ids
  }

  function isVisible(id) {
    const record = model && model.byId.get(id)
    if (!record) return true
    return record.parts.some((part) => part.batch.getVisibleAt(part.geometryId))
  }

  function showAll() {
    if (!model) return
    model.byId.forEach((record) => {
      if (record.passThrough) return
      if (record.space && !spacesVisible) return
      record.parts.forEach((part) => part.batch.setVisibleAt(part.geometryId, true))
    })
  }

  function setSpacesVisible(enabled) {
    spacesVisible = enabled
    if (!model) return 0
    let count = 0
    model.byId.forEach((record) => {
      if (!record.space) return
      count += 1
      record.parts.forEach((part) => part.batch.setVisibleAt(part.geometryId, enabled))
    })
    return count
  }

  function isSpace(id) {
    const record = model && model.byId.get(id)
    return !!(record && record.space)
  }

  function setVisible(ids, visible) {
    if (!model) return
    const seen = new Set()
    let hidesSelection = false
    const allSpaces = ids.length > 0 && ids.every((id) => isSpace(id))
    ids.forEach((id) => {
      if (seen.has(id)) return
      seen.add(id)
      if (!visible && id === selectedId) hidesSelection = true
      const record = model.byId.get(id)
      if (!record) return
      const show = visible && !(record.space && !spacesVisible && !allSpaces)
      record.parts.forEach((part) => part.batch.setVisibleAt(part.geometryId, show))
    })
    if (hidesSelection) clearHighlight()
  }

  function select(id) {
    clearHighlight()
    selectedId = id
    if (!model || id == null) return null
    const record = model.byId.get(id)
    if (!record) return null
    const matrix = new THREE.Matrix4()
    record.parts.forEach((part) => {
      const geometry = sliceGeometry(part)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), outlineMaterial)
      geometry.dispose()
      partWorldMatrix(part, matrix)
      edges.matrix.copy(matrix)
      edges.matrixAutoUpdate = false
      edges.matrixWorldNeedsUpdate = true
      highlightRoot.add(edges)
      outlines.push(edges)
    })
    return record
  }

  function clearHighlight() {
    outlines.forEach((edges) => {
      if (edges.parent) edges.parent.remove(edges)
      edges.geometry.dispose()
    })
    outlines.length = 0
    selectedId = null
    highlightRoot.clear()
  }

  function setMode(next) {
    mode = next
    points = []
    return HINTS[mode]
  }

  function clearMeasurements() {
    points = []
    measureRoot.clear()
    highlightRoot.clear()
    labels.splice(0, labels.length)
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    if (!model || !model.batches.length) return null
    const hits = raycaster.intersectObjects(model.batches, false)
    return hits.find((hit) => !isPassThroughHit(hit)) || hits[0] || null
  }

  function onClick(event) {
    const hit = pick(event)
    if (!hit) {
      if (mode === 'orbit') {
        clearHighlight()
        return { type: 'clear' }
      }
      return null
    }
    const expressID = expressIdOf(hit)
    if (mode === 'orbit') {
      select(expressID)
      return { type: 'select', expressID }
    }
    if (mode === 'area') {
      const area = measureArea(hit)
      return { type: 'area', expressID, area }
    }
    points.push(hit.point.clone())
    addPointMarker(hit.point)
    if (mode === 'distance' && points.length === 2) {
      const distance = points[0].distanceTo(points[1])
      addLine([points[0], points[1]])
      addLabel(points[0].clone().add(points[1]).multiplyScalar(0.5), `${distance.toFixed(3)} m`)
      points = []
      return { type: 'distance', expressID, distance }
    }
    if (mode === 'angle' && points.length === 3) {
      const angle = angleAt(points[0], points[1], points[2])
      addLine([points[0], points[1]])
      addLine([points[1], points[2]])
      addLabel(points[1], `${angle.toFixed(1)}°`)
      points = []
      return { type: 'angle', expressID, angle }
    }
    return { type: 'pending', expressID, count: points.length }
  }

  function measureArea(hit) {
    highlightRoot.clear()
    const expressID = expressIdOf(hit)
    const record = model.byId.get(expressID)
    const part = record && record.parts.find((item) => item.batch === hit.object && item.geometryId === hit.batchId)
    if (!part) return 0
    const geometry = sliceGeometry(part)
    const localFace = hit.faceIndex - part.indexStart / 3
    if (!Number.isInteger(localFace) || localFace < 0) {
      geometry.dispose()
      return 0
    }
    const faceIndexes = connectedCoplanarFaces(geometry, localFace)
    const mesh = { matrixWorld: partWorldMatrix(part, new THREE.Matrix4()) }
    let area = 0
    const positions = []
    const indexes = []
    faceIndexes.forEach((faceIndex) => {
      const triangle = worldTriangle(mesh, geometry, faceIndex)
      area += triangleArea(triangle[0], triangle[1], triangle[2])
      const offset = positions.length / 3
      triangle.forEach((vertex) => positions.push(vertex.x, vertex.y, vertex.z))
      indexes.push(offset, offset + 1, offset + 2)
    })
    const overlayGeometry = new THREE.BufferGeometry()
    overlayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    overlayGeometry.setIndex(indexes)
    const overlay = new THREE.Mesh(
      overlayGeometry,
      useClip(new THREE.MeshBasicMaterial({
        color: 0xf0a040,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthTest: true
      }))
    )
    highlightRoot.add(overlay)
    const center = new THREE.Vector3()
    faceIndexes.forEach((faceIndex) => {
      worldTriangle(mesh, geometry, faceIndex).forEach((vertex) => center.add(vertex))
    })
    center.multiplyScalar(1 / (faceIndexes.length * 3))
    addLabel(center, `${area.toFixed(3)} m²`)
    geometry.dispose()
    return area
  }

  function addPointMarker(point) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 12, 12),
      useClip(new THREE.MeshBasicMaterial({ color: 0x1e8fb8 }))
    )
    marker.position.copy(point)
    measureRoot.add(marker)
  }

  function addLine(ends) {
    const geometry = new THREE.BufferGeometry().setFromPoints(ends)
    measureRoot.add(new THREE.Line(geometry, useClip(new THREE.LineBasicMaterial({ color: 0x1e8fb8 }))))
  }

  function addLabel(position, text) {
    labels.push({ position: position.clone(), text })
  }

  function labelElements(container) {
    if (!labels.length) {
      if (container.childNodes.length) container.textContent = ''
      return
    }
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    container.innerHTML = ''
    labels.forEach((label) => {
      const projected = label.position.clone().project(camera)
      if (projected.z > 1) return
      const element = document.createElement('div')
      element.className = 'measure-label'
      element.textContent = label.text
      element.style.left = `${(projected.x * 0.5 + 0.5) * width}px`
      element.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`
      container.appendChild(element)
    })
  }

  function focus(id) {
    if (!model) return
    if (id == null) {
      clearHighlight()
      frameModel()
      return
    }
    const record = model.byId.get(id)
    if (!record) return
    select(id)
    if (model.ids.size > 4000) {
      frameBox(boundsOfRecord(record))
      return
    }
    frameModel()
    lookAtElement(id, record)
  }

  function lookAtElement(expressID, record) {
    const bounds = boundsOfModel()
    const target = bounds.getCenter(new THREE.Vector3())
    const aim = boundsOfRecord(record).getCenter(new THREE.Vector3())
    const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.5)
    const distance = radius / Math.tan((camera.fov * Math.PI) / 360) * 1.35
    const directions = [
      [1, 0.62, 1],
      [-1, 0.62, 1],
      [1, 0.62, -1],
      [-1, 0.62, -1],
      [0, 0.45, 1],
      [0, 0.45, -1],
      [1, 0.45, 0],
      [-1, 0.45, 0]
    ]
    model.group.updateMatrixWorld(true)
    let best = null
    directions.forEach((item) => {
      const direction = new THREE.Vector3(item[0], item[1], item[2]).normalize()
      const origin = target.clone().addScaledVector(direction, distance)
      raycaster.set(origin, aim.clone().sub(origin).normalize())
      raycaster.far = origin.distanceTo(aim) + 0.5
      const hits = raycaster.intersectObjects(model.batches, false)
      const blocking = hits.find((hit) => !isPassThroughHit(hit))
      const seen = blocking && expressIdOf(blocking) === expressID
      const score = seen ? 0 : blocking ? blocking.distance : distance
      if (!best || (seen && !best.seen) || (seen === best.seen && score < best.score)) {
        best = { direction, seen, score }
      }
    })
    const direction = best ? best.direction : new THREE.Vector3(1, 0.62, 1).normalize()
    camera.position.copy(target).addScaledVector(direction, distance)
    camera.near = Math.max(radius / 200, 0.01)
    camera.far = Math.max(radius * 40, 100)
    camera.updateProjectionMatrix()
    controls.target.copy(target)
    controls.update()
    raycaster.far = Infinity
  }

  function render(labelContainer) {
    resize()
    controls.update()
    fitClipPlanes()
    renderer.render(scene, camera)
    labelElements(labelContainer)
  }

  resize()
  return {
    setModel,
    setVisible,
    isolate,
    setSectionEnabled,
    setSectionMode(mode) {
      sectionMode = mode === 'box' ? 'box' : 'plane'
      const previous = activePlanes
      updateSection()
      if (activePlanes !== previous) applyClipping()
      return sectionMode
    },
    setSectionAxis(axis) {
      sectionAxis = axis
      updateSection()
    },
    setSectionOffset(t) {
      sectionT = Math.min(1, Math.max(0, t))
      updateSection()
    },
    setSectionBox(axis, edge, t) {
      const pair = sectionBox[axis]
      if (!pair) return null
      const value = Math.min(1, Math.max(0, t))
      if (edge === 0) pair[0] = Math.min(value, pair[1] - 0.01)
      else pair[1] = Math.max(value, pair[0] + 0.01)
      updateSection()
      return pair.slice()
    },
    flipSection() {
      sectionFlip = !sectionFlip
      updateSection()
    },
    setMode,
    onClick,
    clearMeasurements,
    focus,
    idsUsingMaterial,
    isVisible,
    isSpace,
    showAll,
    setSpacesVisible,
    get spacesVisible() {
      return spacesVisible
    },
    materialName(id) {
      const record = model && model.byId.get(id)
      let name = ''
      if (record) {
        record.parts.forEach((part) => {
          if (part.batch.material && part.batch.material.name) name = part.batch.material.name
        })
      }
      return name
    },
    frameAll() {
      clearHighlight()
      if (model) frameModel()
    },
    render,
    get selectedId() {
      return selectedId
    },
    get sectionEnabled() {
      return sectionOn
    },
    get sectionMode() {
      return sectionMode
    }
  }
}

function angleAt(a, b, c) {
  const left = a.clone().sub(b).normalize()
  const right = c.clone().sub(b).normalize()
  const dot = THREE.MathUtils.clamp(left.dot(right), -1, 1)
  return THREE.MathUtils.radToDeg(Math.acos(dot))
}

function worldTriangle(mesh, geometry, faceIndex) {
  const index = geometry.getIndex()
  const position = geometry.getAttribute('position')
  return [0, 1, 2].map((offset) => {
    const vertex = index.getX(faceIndex * 3 + offset)
    return new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld)
  })
}

const _partBox = new THREE.Box3()
const _instanceMatrix = new THREE.Matrix4()

function unionPartWorldBox(target, part) {
  part.batch.getBoundingBoxAt(part.geometryId, _partBox)
  part.batch.getMatrixAt(part.geometryId, _instanceMatrix)
  _partBox.applyMatrix4(_instanceMatrix)
  part.batch.updateWorldMatrix(true, false)
  _partBox.applyMatrix4(part.batch.matrixWorld)
  target.union(_partBox)
}

function partWorldMatrix(part, target) {
  part.batch.updateWorldMatrix(true, false)
  part.batch.getMatrixAt(part.geometryId, _instanceMatrix)
  target.multiplyMatrices(part.batch.matrixWorld, _instanceMatrix)
  return target
}

function sliceGeometry(part) {
  const positionAttr = part.batch.geometry.getAttribute('position')
  const position = new Float32Array(part.vertexCount * 3)
  for (let i = 0; i < part.vertexCount; i += 1) {
    const source = (part.vertexStart + i) * 3
    position[i * 3] = positionAttr.array[source]
    position[i * 3 + 1] = positionAttr.array[source + 1]
    position[i * 3 + 2] = positionAttr.array[source + 2]
  }
  const indexAttr = part.batch.geometry.getIndex()
  const index = new Uint32Array(part.indexCount)
  for (let i = 0; i < part.indexCount; i += 1) {
    index[i] = indexAttr.getX(part.indexStart + i) - part.vertexStart
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  return geometry
}

function expressIdOf(hit) {
  const ids = hit.object.userData && hit.object.userData.expressIDs
  if (ids && hit.batchId != null) return ids[hit.batchId]
  return hit.object.userData && hit.object.userData.expressID
}

function isPassThroughHit(hit) {
  const flags = hit.object.userData && hit.object.userData.passThrough
  if (Array.isArray(flags) && hit.batchId != null) return !!flags[hit.batchId]
  return !!hit.object.userData.passThrough
}

function triangleArea(a, b, c) {
  return b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5
}

function connectedCoplanarFaces(geometry, startFace) {
  const index = geometry.getIndex()
  const position = geometry.getAttribute('position')
  const faceCount = index.count / 3
  const normals = new Array(faceCount)
  const neighbors = new Map()
  const edgeFaces = new Map()

  function faceNormal(face) {
    const points = [0, 1, 2].map((offset) => {
      const vertex = index.getX(face * 3 + offset)
      return new THREE.Vector3().fromBufferAttribute(position, vertex)
    })
    return points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize()
  }

  for (let face = 0; face < faceCount; face += 1) {
    normals[face] = faceNormal(face)
    for (let edge = 0; edge < 3; edge += 1) {
      const a = index.getX(face * 3 + edge)
      const b = index.getX(face * 3 + ((edge + 1) % 3))
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      if (!edgeFaces.has(key)) edgeFaces.set(key, [])
      edgeFaces.get(key).push(face)
    }
  }
  edgeFaces.forEach((faces) => {
    faces.forEach((face) => {
      if (!neighbors.has(face)) neighbors.set(face, [])
      faces.forEach((other) => {
        if (other !== face) neighbors.get(face).push(other)
      })
    })
  })

  const seed = normals[startFace]
  const seen = new Set([startFace])
  const queue = [startFace]
  while (queue.length) {
    const face = queue.pop()
    ;(neighbors.get(face) || []).forEach((other) => {
      if (seen.has(other)) return
      if (seed.dot(normals[other]) < 0.995) return
      seen.add(other)
      queue.push(other)
    })
  }
  return [...seen]
}

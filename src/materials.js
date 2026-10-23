import * as THREE from 'three'

const textureCache = new Map()

export function createMaterialLibrary(api, modelID) {
  const byItem = indexStyledItems(api, modelID)
  const elementCache = new Map()
  const materials = new Map()
  const ownedTextures = []

  function appearanceFor(expressID) {
    if (elementCache.has(expressID)) return elementCache.get(expressID)
    const appearance = appearanceFromProduct(api, modelID, expressID, byItem)
    elementCache.set(expressID, appearance)
    return appearance
  }

  function materialFor(expressID, fallbackColor) {
    const appearance = appearanceFor(expressID) || appearanceFromColor(fallbackColor)
    const key = appearance.key
    if (materials.has(key)) return materials.get(key)
    const material = createSurfaceMaterial(appearance)
    if (appearance.map) material.map.colorSpace = THREE.SRGBColorSpace
    materials.set(key, material)
    return material
  }

  function spaceMaterial() {
    if (materials.has('__space__')) return materials.get('__space__')
    const material = new THREE.MeshStandardMaterial({
      name: '空间',
      color: 0x7eb6d6,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide
    })
    materials.set('__space__', material)
    return material
  }

  function dispose() {
    materials.forEach((material) => material.dispose())
    ownedTextures.forEach((texture) => texture.dispose())
  }

  return { materialFor, spaceMaterial, dispose, track(texture) { ownedTextures.push(texture) } }
}

function createSurfaceMaterial(appearance) {
  const seeThrough = appearance.opacity < 0.99 || appearance.kind === 'glass' || appearance.kind === 'water' || appearance.kind === 'virtual'
  if (appearance.kind === 'glass' || appearance.kind === 'water') {
    const material = new THREE.MeshPhysicalMaterial({
      name: appearance.name || '',
      color: appearance.color,
      roughness: appearance.kind === 'water' ? 0.06 : 0.04,
      metalness: 0,
      transmission: 0.95,
      thickness: 0.04,
      ior: appearance.kind === 'water' ? 1.33 : 1.5,
      transparent: true,
      opacity: appearance.opacity < 0.99 ? appearance.opacity : 1,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    material.userData.passThrough = false
    material.renderOrder = 2
    return material
  }
  const material = new THREE.MeshStandardMaterial({
    name: appearance.name || '',
    color: appearance.color,
    map: appearance.map,
    roughness: appearance.roughness,
    metalness: appearance.metalness,
    transparent: seeThrough,
    opacity: appearance.opacity,
    depthWrite: !seeThrough,
    side: THREE.DoubleSide
  })
  material.userData.passThrough = appearance.kind === 'virtual'
  if (seeThrough) material.renderOrder = 2
  return material
}

function appearanceFromProduct(api, modelID, expressID, byItem) {
  let product
  try {
    product = api.GetRawLineData(modelID, expressID)
  } catch (error) {
    return null
  }
  const shapeId = rawRef(product.arguments[6])
  if (!shapeId) return null
  const shape = api.GetRawLineData(modelID, shapeId)
  const reps = rawRefs(shape.arguments[2])
  for (const repId of reps) {
    const rep = api.GetRawLineData(modelID, repId)
    const identifier = textOf(rep.arguments[1])
    if (identifier && identifier !== 'Body' && identifier !== 'Facetation') continue
    const items = rawRefs(rep.arguments[3])
    for (const itemId of items) {
      const style = styleForItem(api, modelID, itemId, byItem, 0)
      if (style) return toAppearance(api, modelID, style)
    }
  }
  return null
}

function styleForItem(api, modelID, itemId, byItem, depth) {
  if (byItem.has(itemId)) return byItem.get(itemId)
  if (depth > 3) return null
  let raw
  try {
    raw = api.GetRawLineData(modelID, itemId)
  } catch (error) {
    return null
  }
  if (api.GetNameFromTypeCode(raw.type) !== 'IfcMappedItem') return null
  const sourceId = rawRef(raw.arguments[0])
  if (!sourceId) return null
  const source = api.GetRawLineData(modelID, sourceId)
  const mappedRep = rawRef(source.arguments[1])
  if (!mappedRep) return null
  const rep = api.GetRawLineData(modelID, mappedRep)
  const items = rawRefs(rep.arguments[3] || [])
  for (const childId of items) {
    const found = styleForItem(api, modelID, childId, byItem, depth + 1)
    if (found) return found
  }
  return null
}

function indexStyledItems(api, modelID) {
  const byItem = new Map()
  const type = typeId(api, modelID, 'IfcStyledItem')
  if (!type) return byItem
  const ids = api.GetLineIDsWithType(modelID, type)
  for (let i = 0; i < ids.size(); i += 1) {
    const raw = api.GetRawLineData(modelID, ids.get(i))
    const itemId = rawRef(raw.arguments[0])
    const style = readStyles(api, modelID, rawRefs(raw.arguments[1]), 0)
    if (itemId && style) byItem.set(itemId, style)
  }
  return byItem
}

function readStyles(api, modelID, styleIds, depth) {
  if (depth > 6) return null
  let result = null
  styleIds.forEach((id) => {
    const raw = api.GetRawLineData(modelID, id)
    const typeName = api.GetNameFromTypeCode(raw.type)
    if (typeName === 'IfcPresentationStyleAssignment') {
      result = mergeStyle(result, readStyles(api, modelID, rawRefs(raw.arguments[0]), depth + 1))
      return
    }
    if (typeName === 'IfcSurfaceStyle') {
      const nested = readStyles(api, modelID, rawRefs(raw.arguments[2]), depth + 1)
      result = mergeStyle(result, nested)
      const name = textOf(raw.arguments[0])
      if (name) result = mergeStyle(result, { name })
      return
    }
    if (typeName === 'IfcSurfaceStyleRendering' || typeName === 'IfcSurfaceStyleShading') {
      result = mergeStyle(result, {
        colour: readColour(api, modelID, raw.arguments[0]),
        opacity: opacityFromTransparency(raw.arguments[1])
      })
      return
    }
    if (typeName === 'IfcSurfaceStyleWithTextures') {
      result = mergeStyle(result, { textureIds: rawRefs(raw.arguments[0]) })
    }
  })
  return result
}

function toAppearance(api, modelID, style) {
  const kind = classifyMaterial(style.name)
  const colour = style.colour || { r: 0.78, g: 0.8, b: 0.82 }
  const opacity = style.opacity == null ? 1 : style.opacity
  const image = style.textureIds && style.textureIds.length
    ? textureFromIfc(api, modelID, style.textureIds[0])
    : null
  const clear = kind === 'glass' || kind === 'water' || kind === 'virtual'
  const map = image || (clear ? null : proceduralTexture(kind, colour))
  const color = map && !image ? new THREE.Color(0xffffff) : new THREE.Color(colour.r, colour.g, colour.b)
  return {
    key: `${style.name || kind}|${colour.r.toFixed(3)}|${colour.g.toFixed(3)}|${colour.b.toFixed(3)}|${opacity.toFixed(3)}|${image ? 'img' : kind}`,
    name: style.name || kind,
    kind,
    color,
    map,
    opacity,
    roughness: roughnessFor(kind, opacity),
    metalness: kind === 'metal' ? 0.72 : 0.02
  }
}

function appearanceFromColor(color) {
  const red = color && color.x ? color.x : 0.78
  const green = color && color.y ? color.y : 0.8
  const blue = color && color.z ? color.z : 0.82
  const alpha = !color || color.w == null || color.w === 0 ? 1 : color.w
  const blank = red + green + blue === 0
  const colour = blank ? { r: 0.78, g: 0.8, b: 0.82 } : { r: red, g: green, b: blue }
  const map = proceduralTexture('generic', colour)
  return {
    key: `fallback|${colour.r.toFixed(3)}|${colour.g.toFixed(3)}|${colour.b.toFixed(3)}|${alpha.toFixed(3)}`,
    name: '',
    kind: 'generic',
    color: new THREE.Color(0xffffff),
    map,
    opacity: alpha,
    roughness: 0.82,
    metalness: 0.02
  }
}

function classifyMaterial(name) {
  const text = (name || '').toLowerCase()
  if (/glass|glazing/.test(text)) return 'glass'
  if (/metal|steel|aluminium|aluminum|copper/.test(text)) return 'metal'
  if (/trunk|bark|wood|timber|mdf/.test(text)) return 'wood'
  if (/grass|foliage|foilage|leaf|shrub/.test(text)) return 'grass'
  if (/virtual/.test(text)) return 'virtual'
  if (/paint|marking/.test(text)) return 'paint'
  if (/roof|tile|shingle|terracotta/.test(text)) return 'roof'
  if (/asphalt|bitumen/.test(text)) return 'asphalt'
  if (/soil|topsoil|sand|earth/.test(text)) return 'soil'
  if (/gravel|crushed|pebble/.test(text)) return 'gravel'
  if (/concrete|cement|gypsum|brick|masonry|stone|plaster/.test(text)) return 'concrete'
  if (/water/.test(text)) return 'water'
  return 'generic'
}

function roughnessFor(kind, opacity) {
  if (kind === 'glass' || kind === 'water' || kind === 'virtual' || kind === 'paint') return 0.22
  if (kind === 'metal') return 0.32
  if (kind === 'wood') return 0.72
  if (opacity < 0.95) return 0.18
  return 0.9
}

function proceduralTexture(kind, colour) {
  const key = `${kind}|${Math.round(colour.r * 255)}|${Math.round(colour.g * 255)}|${Math.round(colour.b * 255)}`
  if (textureCache.has(key)) return textureCache.get(key)
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  paintPattern(context, kind, colour)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  textureCache.set(key, texture)
  return texture
}

function paintPattern(context, kind, colour) {
  const width = 256
  const height = 256
  const image = context.createImageData(width, height)
  const data = image.data
  const base = [colour.r * 255, colour.g * 255, colour.b * 255]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const grain = hash(x, y)
      let shift = (grain - 0.5) * 7
      if (kind === 'wood') {
        const plank = Math.floor(y / 64)
        const seam = y % 64 < 2
        shift = seam ? -55 : Math.sin((x * 0.08) + plank) * 14
      } else if (kind === 'concrete') {
        const joint = x % 128 < 2 || y % 128 < 2
        shift = joint ? -36 : (grain - 0.5) * 8
      } else if (kind === 'roof') {
        const row = Math.floor(y / 32)
        const seam = y % 32 < 2 || (x + (row % 2) * 32) % 64 < 2
        shift = seam ? -42 : (grain - 0.5) * 6
      } else if (kind === 'grass') {
        shift = hash(x, Math.floor(y / 3)) > 0.62 ? -22 : 8
      } else if (kind === 'gravel') {
        shift = (hash(x >> 2, y >> 2) - 0.45) * 55
      } else if (kind === 'soil') {
        shift = (hash(x >> 1, y >> 1) - 0.5) * 18
      } else if (kind === 'asphalt') {
        shift = grain > 0.92 ? 16 : (grain - 0.5) * 5
      } else if (kind === 'metal' || kind === 'glass' || kind === 'water' || kind === 'virtual' || kind === 'paint') {
        shift *= 0.15
      }
      const index = (y * width + x) * 4
      data[index] = clamp(base[0] + shift)
      data[index + 1] = clamp(base[1] + shift)
      data[index + 2] = clamp(base[2] + shift)
      data[index + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
}

function textureFromIfc(api, modelID, textureId) {
  try {
    const raw = api.GetRawLineData(modelID, textureId)
    const typeName = api.GetNameFromTypeCode(raw.type)
    if (typeName === 'IfcImageTexture') return loadImageTexture(raw)
    if (typeName === 'IfcBlobTexture') return loadBlobTexture(raw)
    if (typeName === 'IfcPixelTexture') return loadPixelTexture(raw)
  } catch (error) {
    console.warn('读取贴图失败', error)
  }
  return null
}

function loadImageTexture(raw) {
  const url = raw.arguments.map(textOf).reverse().find((value) => /^https?:|^data:image\//.test(value))
  if (!url) return null
  const texture = new THREE.TextureLoader().load(url)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function loadBlobTexture(raw) {
  const format = textOf(raw.arguments[raw.arguments.length - 2]) || 'png'
  const payload = raw.arguments[raw.arguments.length - 1]
  const bytes = bytesFromArgument(payload)
  if (!bytes) return null
  const blob = new Blob([bytes], { type: mimeFor(format) })
  const url = URL.createObjectURL(blob)
  const texture = new THREE.TextureLoader().load(url, () => URL.revokeObjectURL(url))
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function loadPixelTexture(raw) {
  const width = realOf(raw.arguments[5])
  const height = realOf(raw.arguments[6])
  const components = realOf(raw.arguments[7]) || 3
  const pixels = raw.arguments[8]
  if (!width || !height || !Array.isArray(pixels)) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  const image = context.createImageData(width, height)
  for (let i = 0; i < width * height; i += 1) {
    const pixel = Array.isArray(pixels[i]) ? pixels[i] : [pixels[i]]
    image.data[i * 4] = Number(pixel[0]) || 0
    image.data[i * 4 + 1] = Number(pixel[1] != null ? pixel[1] : pixel[0]) || 0
    image.data[i * 4 + 2] = Number(pixel[Math.min(2, components - 1)] != null ? pixel[Math.min(2, components - 1)] : pixel[0]) || 0
    image.data[i * 4 + 3] = components > 3 ? Number(pixel[3]) || 255 : 255
  }
  context.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function bytesFromArgument(payload) {
  if (!payload) return null
  const value = typeof payload === 'string' ? payload : textOf(payload)
  if (!value) return null
  if (/^[0-9A-Fa-f]+$/.test(value) && value.length % 2 === 0) {
    const bytes = new Uint8Array(value.length / 2)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(value.substr(i * 2, 2), 16)
    return bytes
  }
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch (error) {
    return null
  }
}

function mimeFor(format) {
  const text = format.toLowerCase()
  if (text.includes('png')) return 'image/png'
  if (text.includes('jpg') || text.includes('jpeg')) return 'image/jpeg'
  if (text.includes('webp')) return 'image/webp'
  return 'application/octet-stream'
}

function readColour(api, modelID, arg) {
  const id = rawRef(arg)
  if (!id) return null
  const raw = api.GetRawLineData(modelID, id)
  const typeName = api.GetNameFromTypeCode(raw.type)
  if (typeName !== 'IfcColourRgb') return null
  return {
    r: realOf(raw.arguments[1]) || 0,
    g: realOf(raw.arguments[2]) || 0,
    b: realOf(raw.arguments[3]) || 0
  }
}

function opacityFromTransparency(arg) {
  const transparency = realOf(arg)
  if (transparency == null) return 1
  return Math.min(1, Math.max(0, 1 - transparency))
}

function mergeStyle(left, right) {
  if (!right) return left || {}
  if (!left) return { ...right }
  return {
    name: right.name || left.name,
    colour: right.colour || left.colour,
    opacity: right.opacity == null ? left.opacity : right.opacity,
    textureIds: right.textureIds || left.textureIds
  }
}

function typeId(api, modelID, name) {
  const found = api.GetAllTypesOfModel(modelID).find((item) => item.typeName === name)
  return found ? found.typeID : 0
}

function rawRef(arg) {
  if (arg && arg.type === 5 && typeof arg.value === 'number') return arg.value
  return null
}

function rawRefs(arg) {
  if (arg == null) return []
  const list = Array.isArray(arg) ? arg : [arg]
  return list.map(rawRef).filter((id) => typeof id === 'number')
}

function textOf(arg) {
  if (typeof arg === 'string') return arg
  if (arg && typeof arg.value === 'string') return arg.value
  return ''
}

function realOf(arg) {
  const value = arg && typeof arg === 'object' && arg.value != null ? arg.value : arg
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value)
    if (!Number.isNaN(number)) return number
  }
  return null
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function clamp(value) {
  return Math.max(0, Math.min(255, value))
}

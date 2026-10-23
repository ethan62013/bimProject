import * as THREE from 'three'
import { IfcAPI } from 'web-ifc'
import { createMaterialLibrary } from './materials'

const TYPE_LABELS = {
  IfcWall: '墙',
  IfcWallStandardCase: '墙',
  IfcSlab: '板',
  IfcColumn: '柱',
  IfcBeam: '梁',
  IfcDoor: '门',
  IfcWindow: '窗',
  IfcStair: '楼梯',
  IfcStairFlight: '梯段',
  IfcRailing: '栏杆',
  IfcRoof: '屋顶',
  IfcCurtainWall: '幕墙',
  IfcPlate: '板件',
  IfcMember: '杆件',
  IfcFooting: '基础',
  IfcPile: '桩',
  IfcCovering: '面层',
  IfcBuildingElementProxy: '代理构件',
  IfcFurnishingElement: '家具',
  IfcSpace: '空间',
  IfcRamp: '坡道',
  IfcRampFlight: '坡段',
  IfcFlowTerminal: '末端设备',
  IfcFlowSegment: '管段',
  IfcFlowFitting: '管件',
  IfcFlowController: '调节阀',
  IfcFlowStorageDevice: '储存设备',
  IfcFlowMovingDevice: '动力设备',
  IfcFlowTreatmentDevice: '处理设备',
  IfcEnergyConversionDevice: '能量转换设备',
  IfcDistributionElement: '机电构件',
  IfcPipeSegment: '管道',
  IfcPipeFitting: '水管管件',
  IfcDuctSegment: '风管',
  IfcDuctFitting: '风管管件',
  IfcAirTerminal: '风口',
  IfcSanitaryTerminal: '卫浴末端',
  IfcStackTerminal: '排放口',
  IfcValve: '阀门',
  IfcDamper: '风阀',
  IfcFan: '风机',
  IfcPump: '水泵',
  IfcTank: '水箱',
  IfcBoiler: '锅炉',
  IfcChiller: '冷机',
  IfcSpaceHeater: '散热器',
  IfcCableSegment: '电缆',
  IfcCableCarrierSegment: '桥架',
  IfcCableFitting: '电缆配件',
  IfcElectricDistributionBoard: '配电箱',
  IfcLightFixture: '灯具',
  IfcOutlet: '插座',
  IfcSwitchingDevice: '开关',
  IfcJunctionBox: '接线盒',
  IfcReinforcingBar: '钢筋',
  IfcReinforcingMesh: '钢筋网',
  IfcTendon: '预应力筋',
  IfcElementAssembly: '构件组',
  IfcDiscreteAccessory: '附件',
  IfcMechanicalFastener: '机械紧固件',
  IfcFastener: '紧固件',
  IfcBuildingElementPart: '零件',
  IfcChimney: '烟囱',
  IfcShadingDevice: '遮阳',
  IfcGeographicElement: '地形',
  IfcCivilElement: '土木构件',
  IfcBridge: '桥梁',
  IfcBridgePart: '桥梁部件',
  IfcAlignment: '定位线',
  IfcFacility: '设施',
  IfcFacilityPart: '设施部件',
  IfcRoad: '道路',
  IfcRailway: '铁路',
  IfcGrid: '轴网',
  IfcSystem: '系统',
  IfcDistributionSystem: '系统',
  IfcDistributionCircuit: '回路',
  IfcBuildingSystem: '建筑系统',
  IfcZone: '区域',
  IfcProject: '项目',
  IfcSite: '场地',
  IfcBuilding: '建筑',
  IfcBuildingStorey: '楼层'
}

const SKIP_TYPES = new Set(['IfcOpeningElement'])
const SYSTEM_TYPES = new Set(['IfcSystem', 'IfcDistributionSystem', 'IfcDistributionCircuit', 'IfcBuildingSystem', 'IfcZone'])
const PREFIX_SCALE = {
  EXA: 1e18,
  PETA: 1e15,
  TERA: 1e12,
  GIGA: 1e9,
  MEGA: 1e6,
  KILO: 1e3,
  HECTO: 1e2,
  DECA: 10,
  DECI: 0.1,
  CENTI: 0.01,
  MILLI: 0.001,
  MICRO: 1e-6,
  NANO: 1e-9
}

const WASM_MEMORY_LIMIT = 3 * 1024 * 1024 * 1024

let apiPromise = null

export function getIfcApi() {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = new IfcAPI()
      api.SetWasmPath('/', true)
      await api.Init()
      return api
    })()
  }
  return apiPromise
}

function resetIfcApi() {
  apiPromise = null
}

function isWasmAbort(error) {
  const message = String((error && error.message) || error || '')
  return message.includes('Aborted') || message.includes('out of bounds')
}

function hookGeometryLogs(notes) {
  const originalError = console.error
  const originalWarn = console.warn
  const originalLog = console.log
  const take = (args) => {
    const text = args.map((item) => {
      if (typeof item === 'string') return item
      if (item && item.message) return item.message
      return ''
    }).join(' ')
    if (/No basis found for brep|TriangulateBounds/i.test(text)) notes.push(text)
  }
  console.error = (...args) => {
    take(args)
    originalError.apply(console, args)
  }
  console.warn = (...args) => {
    take(args)
    originalWarn.apply(console, args)
  }
  console.log = (...args) => {
    take(args)
    originalLog.apply(console, args)
  }
  return () => {
    console.error = originalError
    console.warn = originalWarn
    console.log = originalLog
  }
}

function abortMessage(geometryNotes) {
  const failedFace = geometryNotes.some((text) => /No basis found for brep/i.test(text))
  if (failedFace) return '有一个面片无法三角化，解析已中止。'
  return '解析器在生成几何时中止了。模型可能超出了内存上限。'
}

export async function loadIfc(buffer, onProgress) {
  const api = await getIfcApi()
  if (onProgress) onProgress('正在解析 IFC…')
  await yieldToMain()
  let modelID = -1
  let library = null
  let model = null
  const geometryNotes = []
  const restoreLogs = hookGeometryLogs(geometryNotes)
  try {
    modelID = api.OpenModel(new Uint8Array(buffer), {
      COORDINATE_TO_ORIGIN: true,
      CIRCLE_SEGMENTS: circleSegmentsFor(buffer.byteLength),
      MEMORY_LIMIT: WASM_MEMORY_LIMIT
    })
    if (modelID < 0) throw new Error('无法打开这个 IFC 文件。')
    const unitScale = readLengthScale(api, modelID)
    library = createMaterialLibrary(api, modelID)
    if (onProgress) onProgress('正在整理目录…')
    await yieldToMain()
    const tree = buildTree(api, modelID)
    if (onProgress) onProgress('正在生成几何…')
    await yieldToMain()
    model = await buildMeshes(api, modelID, unitScale, library, buffer.byteLength, onProgress)
    attachMissing(tree, model.ids, api, modelID)
    return { api, modelID, unitScale, tree, model, library, propertyIndex: { defs: new Map(), text: new Map() }, propertyReady: false }
  } catch (error) {
    if (model) disposeModel(model)
    if (library) library.dispose()
    if (isWasmAbort(error)) {
      resetIfcApi()
      throw new Error(abortMessage(geometryNotes))
    }
    if (modelID >= 0) {
      try {
        api.CloseModel(modelID)
      } catch (closeError) {
        console.error(closeError)
        if (isWasmAbort(closeError)) resetIfcApi()
      }
    }
    throw error
  } finally {
    restoreLogs()
  }
}

export async function closeModel(session) {
  if (!session) return
  session.closed = true
  if (session.propertyTask) {
    try {
      await session.propertyTask
    } catch (error) {
      console.error(error)
    }
  }
  disposeModel(session.model)
  if (session.library) session.library.dispose()
  try {
    session.api.CloseModel(session.modelID)
  } catch (error) {
    console.error(error)
    if (isWasmAbort(error)) resetIfcApi()
  }
}

export function beginPropertyIndex(session, onProgress) {
  session.closed = false
  session.propertyReady = false
  session.propertyTask = indexProperties(session, onProgress).then((index) => {
    if (session.closed) return
    session.propertyIndex = index
    session.propertyReady = true
  }).catch((error) => {
    console.error(error)
    if (!session.closed) session.propertyReady = true
  })
  return session.propertyTask
}

function disposeModel(model) {
  if (!model) return
  model.batches.forEach((batch) => batch.dispose())
  ;(model.extras || []).forEach((object) => {
    if (object.geometry) object.geometry.dispose()
    if (object.material) object.material.dispose()
  })
}

function circleSegmentsFor(byteLength) {
  if (byteLength > 12 * 1024 * 1024) return 6
  if (byteLength > 4 * 1024 * 1024) return 12
  if (byteLength > 1.5 * 1024 * 1024) return 24
  return 48
}

function yieldToMain() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function idsOf(vector) {
  const ids = []
  if (!vector) return ids
  for (let i = 0; i < vector.size(); i += 1) ids.push(vector.get(i))
  return ids
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

function enumValue(arg) {
  if (!arg) return ''
  if (typeof arg === 'string') return arg
  if (typeof arg.value === 'string') return arg.value
  return ''
}

function typeMap(api, modelID) {
  return new Map(api.GetAllTypesOfModel(modelID).map((item) => [item.typeName, item.typeID]))
}

function linesOf(api, modelID, types, name) {
  const type = types.get(name)
  if (!type) return []
  return idsOf(api.GetLineIDsWithType(modelID, type))
}

function typeLabel(typeName) {
  return TYPE_LABELS[typeName] || (typeName || '构件').replace(/^Ifc/, '')
}

function readEntity(api, modelID, id) {
  const raw = api.GetRawLineData(modelID, id)
  const typeName = api.GetNameFromTypeCode(raw.type) || 'IfcElement'
  const name = enumValue(raw.arguments[2])
  return { id, typeName, name }
}

export function readElementProperties(session, expressID) {
  const groups = [basicGroup(session.api, session.modelID, expressID)]
  const ids = (session.propertyIndex && session.propertyIndex.defs.get(expressID)) || []
  ids.forEach((id) => {
    readPropertyDefinition(session.api, session.modelID, id).forEach((group) => {
      if (group.rows.length) groups.push(group)
    })
  })
  return groups
}

async function indexProperties(session, onProgress) {
  const { api, modelID } = session
  const types = typeMap(api, modelID)
  const defs = new Map()
  const text = new Map()
  const relIds = linesOf(api, modelID, types, 'IfcRelDefinesByProperties')
  const typeRelIds = linesOf(api, modelID, types, 'IfcRelDefinesByType')
  const total = relIds.length + typeRelIds.length
  let seen = 0
  const add = (objectId, definitionId) => {
    if (!defs.has(objectId)) defs.set(objectId, [])
    const list = defs.get(objectId)
    if (!list.includes(definitionId)) list.push(definitionId)
  }
  for (const relId of relIds) {
    if (session.closed) return { defs, text }
    seen += 1
    if (seen % 300 === 0) {
      if (onProgress) onProgress(`正在读取属性 ${seen}/${total}`)
      await yieldToMain()
    }
    try {
      const raw = api.GetRawLineData(modelID, relId)
      const definitionId = rawRef(raw.arguments[5])
      if (!definitionId) continue
      rawRefs(raw.arguments[4]).forEach((id) => add(id, definitionId))
    } catch (error) {
      console.error(error)
    }
  }
  for (const relId of typeRelIds) {
    if (session.closed) return { defs, text }
    seen += 1
    if (seen % 300 === 0) {
      if (onProgress) onProgress(`正在读取属性 ${seen}/${total}`)
      await yieldToMain()
    }
    try {
      const raw = api.GetRawLineData(modelID, relId)
      const typeId = rawRef(raw.arguments[5])
      if (!typeId) continue
      const typeRaw = api.GetRawLineData(modelID, typeId)
      const sets = rawRefs(typeRaw.arguments[5])
      rawRefs(raw.arguments[4]).forEach((id) => sets.forEach((definitionId) => add(id, definitionId)))
    } catch (error) {
      console.error(error)
    }
  }
  const cache = new Map()
  const entries = [...defs.entries()]
  for (let i = 0; i < entries.length; i += 1) {
    if (session.closed) return { defs, text }
    if (i % 200 === 0) await yieldToMain()
    const [objectId, definitionIds] = entries[i]
    const parts = []
    definitionIds.forEach((id) => {
      if (!cache.has(id)) cache.set(id, definitionSearchText(api, modelID, id))
      const value = cache.get(id)
      if (value) parts.push(value)
    })
    if (parts.length) text.set(objectId, parts.join(' '))
  }
  return { defs, text }
}

function definitionSearchText(api, modelID, id) {
  try {
    return readPropertyDefinition(api, modelID, id)
      .flatMap((group) => [group.name, ...group.rows.flatMap((row) => [row.key, row.value])])
      .join(' ')
  } catch (error) {
    return ''
  }
}

function basicGroup(api, modelID, expressID) {
  const rows = [{ key: '编号', value: String(expressID) }]
  try {
    const raw = api.GetRawLineData(modelID, expressID)
    const typeName = api.GetNameFromTypeCode(raw.type) || ''
    const name = unwrap(raw.arguments[2])
    const description = unwrap(raw.arguments[3])
    const objectType = unwrap(raw.arguments[4])
    const globalId = unwrap(raw.arguments[0])
    const tag = unwrap(raw.arguments[7])
    if (typeName) rows.unshift({ key: '类型', value: typeLabel(typeName) })
    if (name) rows.push({ key: '名称', value: name })
    if (objectType) rows.push({ key: '对象类型', value: objectType })
    if (description) rows.push({ key: '说明', value: description })
    if (tag) rows.push({ key: '标记', value: tag })
    if (globalId) rows.push({ key: '全局 ID', value: globalId })
  } catch (error) {
    rows.unshift({ key: '类型', value: '构件' })
  }
  return { name: '基本', rows }
}

function readPropertyDefinition(api, modelID, id) {
  const raw = api.GetRawLineData(modelID, id)
  const typeName = api.GetNameFromTypeCode(raw.type) || ''
  if (typeName === 'IfcPropertySet') {
    return [{
      name: unwrap(raw.arguments[2]) || '属性',
      rows: rawRefs(raw.arguments[4]).flatMap((propId) => readPropertyRows(api, modelID, propId))
    }]
  }
  if (typeName === 'IfcElementQuantity') {
    return [{
      name: unwrap(raw.arguments[2]) || '工程量',
      rows: rawRefs(raw.arguments[5]).map((quantityId) => readQuantity(api, modelID, quantityId)).filter(Boolean)
    }]
  }
  return []
}

function readPropertyRows(api, modelID, id) {
  const raw = api.GetRawLineData(modelID, id)
  const typeName = api.GetNameFromTypeCode(raw.type) || ''
  const key = unwrap(raw.arguments[0]) || typeName.replace(/^Ifc/, '')
  if (typeName === 'IfcComplexProperty') {
    return rawRefs(raw.arguments[3]).flatMap((child) => readPropertyRows(api, modelID, child))
  }
  if (typeName === 'IfcPropertyBoundedValue') {
    const value = [unwrap(raw.arguments[2]), unwrap(raw.arguments[3])].filter(Boolean).join(' – ')
    return value ? [{ key, value }] : []
  }
  const value = unwrap(raw.arguments[2])
  return value ? [{ key, value }] : []
}

function readQuantity(api, modelID, id) {
  const raw = api.GetRawLineData(modelID, id)
  const typeName = api.GetNameFromTypeCode(raw.type) || ''
  if (!typeName.startsWith('IfcQuantity')) return null
  const key = unwrap(raw.arguments[0]) || typeName.replace(/^Ifc/, '')
  const value = unwrap(raw.arguments[3])
  return value ? { key, value } : null
}

function unwrap(arg, depth = 0) {
  if (arg == null || depth > 6) return ''
  if (typeof arg === 'boolean') return arg ? '是' : '否'
  if (typeof arg === 'number') return formatNumber(arg)
  if (typeof arg === 'string') return cleanToken(arg)
  if (Array.isArray(arg)) {
    return arg.map((item) => unwrap(item, depth + 1)).filter(Boolean).join(', ')
  }
  if (typeof arg === 'object') {
    if (arg.type === 5) return ''
    if ('value' in arg) return unwrap(arg.value, depth + 1)
  }
  return ''
}

function cleanToken(text) {
  const trimmed = text.trim()
  if (trimmed === '.T.' || trimmed === 'T' || trimmed === 'TRUE') return '是'
  if (trimmed === '.F.' || trimmed === 'F' || trimmed === 'FALSE') return '否'
  if (trimmed === '.U.' || trimmed === 'UNKNOWN' || trimmed === '$') return ''
  const plain = trimmed.replace(/^\.(.+)\.$/, '$1')
  if (/^[+-]?\d+(\.\d*)?$/.test(plain) || /^[+-]?\d*\.\d+$/.test(plain)) {
    const number = Number(plain)
    if (Number.isFinite(number)) return formatNumber(number)
  }
  return plain
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return ''
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return String(value)
  return String(Math.round(value * 1000) / 1000)
}

function readLengthScale(api, modelID) {
  try {
    const types = typeMap(api, modelID)
    const projects = linesOf(api, modelID, types, 'IfcProject')
    if (!projects.length) return 1
    const project = api.GetRawLineData(modelID, projects[0])
    const assignmentId = rawRef(project.arguments[8])
    if (!assignmentId) return 1
    const assignment = api.GetRawLineData(modelID, assignmentId)
    for (const unitId of rawRefs(assignment.arguments[0])) {
      const unit = api.GetRawLineData(modelID, unitId)
      const typeName = api.GetNameFromTypeCode(unit.type)
      const unitType = enumValue(unit.arguments[1])
      if (unitType !== 'LENGTHUNIT') continue
      if (typeName === 'IfcSIUnit' && enumValue(unit.arguments[3]) === 'METRE') {
        return PREFIX_SCALE[enumValue(unit.arguments[2])] || 1
      }
      if (typeName === 'IfcConversionBasedUnit') {
        const factorId = rawRef(unit.arguments[3])
        if (!factorId) continue
        const measure = api.GetRawLineData(modelID, factorId)
        const valueArg = measure.arguments[0]
        const value = typeof valueArg === 'number' ? valueArg : valueArg && valueArg.value
        if (typeof value !== 'number') continue
        const baseId = rawRef(measure.arguments[1])
        let base = 1
        if (baseId) {
          const baseUnit = api.GetRawLineData(modelID, baseId)
          if (enumValue(baseUnit.arguments[3]) === 'METRE') {
            base = PREFIX_SCALE[enumValue(baseUnit.arguments[2])] || 1
          }
        }
        return value * base
      }
    }
  } catch (error) {
    console.warn('读取长度单位失败，按米处理', error)
  }
  return 1
}

function buildTree(api, modelID) {
  const types = typeMap(api, modelID)
  const childrenOf = new Map()
  const contained = new Map()
  linesOf(api, modelID, types, 'IfcRelAggregates').forEach((relId) => {
    const rel = api.GetRawLineData(modelID, relId)
    const parent = rawRef(rel.arguments[4])
    if (!parent) return
    const list = childrenOf.get(parent) || []
    list.push(...rawRefs(rel.arguments[5]))
    childrenOf.set(parent, list)
  })
  linesOf(api, modelID, types, 'IfcRelContainedInSpatialStructure').forEach((relId) => {
    const rel = api.GetRawLineData(modelID, relId)
    const parent = rawRef(rel.arguments[5])
    if (!parent) return
    const list = contained.get(parent) || []
    list.push(...rawRefs(rel.arguments[4]))
    contained.set(parent, list)
  })

  const projects = linesOf(api, modelID, types, 'IfcProject')
  const visited = new Set()
  const rootChildren = projects.length ? projects : []
  const root = {
    key: 'root',
    name: '模型',
    kind: 'spatial',
    children: rootChildren.map((id) => makeSpatialNode(api, modelID, id, childrenOf, contained, visited))
  }
  const systems = buildSystemNodes(api, modelID)
  if (systems.length) {
    const folder = {
      key: 'systems',
      name: '系统',
      kind: 'spatial',
      ifcType: 'IfcGroup',
      children: systems
    }
    folder.expressIDs = collectIds(folder)
    root.children.push(folder)
  }
  root.expressIDs = collectIds(root)
  return root
}

function buildSystemNodes(api, modelID) {
  const types = typeMap(api, modelID)
  const groups = new Map()
  linesOf(api, modelID, types, 'IfcRelAssignsToGroup').forEach((relId) => {
    let raw
    try {
      raw = api.GetRawLineData(modelID, relId)
    } catch (error) {
      return
    }
    const groupId = rawRef(raw.arguments[6]) || rawRef(raw.arguments[5])
    if (!groupId || groups.has(groupId)) return
    let group
    try {
      group = readEntity(api, modelID, groupId)
    } catch (error) {
      return
    }
    if (!SYSTEM_TYPES.has(group.typeName)) return
    const elements = rawRefs(raw.arguments[4]).map((id) => {
      try {
        return readEntity(api, modelID, id)
      } catch (error) {
        return null
      }
    }).filter((entity) => entity && !SKIP_TYPES.has(entity.typeName) && !entity.typeName.includes('Port'))
    if (!elements.length) return
    const node = {
      key: `sys-${groupId}`,
      name: group.name || typeLabel(group.typeName),
      kind: 'spatial',
      ifcType: group.typeName,
      children: groupByType(groupId, elements)
    }
    node.expressIDs = collectIds(node)
    groups.set(groupId, node)
  })
  return [...groups.values()]
}

function makeSpatialNode(api, modelID, id, childrenOf, contained, visited) {
  if (visited.has(id)) {
    return { key: `dup-${id}`, name: `构件 ${id}`, kind: 'element', children: [], expressIDs: [] }
  }
  visited.add(id)
  const entity = readEntity(api, modelID, id)
  const node = {
    key: `s-${id}`,
    name: entity.name || typeLabel(entity.typeName),
    kind: 'spatial',
    ifcType: entity.typeName,
    children: []
  }
  ;(childrenOf.get(id) || []).forEach((childId) => {
    node.children.push(makeSpatialNode(api, modelID, childId, childrenOf, contained, visited))
  })
  const elements = (contained.get(id) || [])
    .map((elementId) => {
      try {
        return readEntity(api, modelID, elementId)
      } catch (error) {
        return null
      }
    })
    .filter((entity) => entity && !SKIP_TYPES.has(entity.typeName))
  node.children.push(...groupByType(id, elements))
  node.expressIDs = collectIds(node)
  return node
}

function groupByType(parentId, elements) {
  const groups = new Map()
  elements.forEach((entity) => {
    if (!groups.has(entity.typeName)) {
      groups.set(entity.typeName, {
        key: `t-${parentId}-${entity.typeName}`,
        name: typeLabel(entity.typeName),
        kind: 'type',
        children: [],
        expressIDs: []
      })
    }
    const group = groups.get(entity.typeName)
    const leaf = {
      key: `e-${entity.id}`,
      name: entity.name || `${typeLabel(entity.typeName)} ${entity.id}`,
      kind: 'element',
      children: [],
      expressIDs: [entity.id]
    }
    group.children.push(leaf)
    group.expressIDs.push(entity.id)
  })
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

function collectIds(node) {
  if (node.kind === 'element') return node.expressIDs.slice()
  const ids = []
  node.children.forEach((child) => {
    child.expressIDs = child.expressIDs || collectIds(child)
    ids.push(...child.expressIDs)
  })
  return ids
}

function attachMissing(tree, geometryIds, api, modelID) {
  const known = new Set(tree.expressIDs || [])
  const missing = []
  geometryIds.forEach((id) => {
    if (known.has(id)) return
    try {
      const entity = readEntity(api, modelID, id)
      if (!SKIP_TYPES.has(entity.typeName)) missing.push(entity)
    } catch (error) {
      missing.push({ id, typeName: 'IfcBuildingElementProxy', name: '' })
    }
  })
  if (!missing.length) return
  const folder = {
    key: 'unplaced',
    name: '未归类',
    kind: 'spatial',
    children: groupByType('missing', missing)
  }
  folder.expressIDs = collectIds(folder)
  tree.children.push(folder)
  tree.expressIDs = collectIds(tree)
}

function hiddenExpressIds(api, modelID) {
  const types = typeMap(api, modelID)
  const hidden = new Set()
  linesOf(api, modelID, types, 'IfcOpeningElement').forEach((id) => hidden.add(id))
  linesOf(api, modelID, types, 'IfcOpeningStandardCase').forEach((id) => hidden.add(id))
  return hidden
}

function collectMeshIds(api, modelID, hidden, skipped) {
  const ids = []
  const seen = new Set()
  api.GetAllTypesOfModel(modelID).forEach((item) => {
    if (!api.IsIfcElement(item.typeID)) return
    if (item.typeName === 'IfcOpeningElement' || item.typeName === 'IfcOpeningStandardCase') return
    const lines = api.GetLineIDsWithType(modelID, item.typeID, false)
    for (let i = 0; i < lines.size(); i += 1) {
      const id = lines.get(i)
      if (hidden.has(id) || skipped.has(id) || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    if (typeof lines.delete === 'function') lines.delete()
  })
  return ids
}

async function faceSurfaceProductIds(api, modelID, onProgress) {
  const types = typeMap(api, modelID)
  const faceModels = new Set(linesOf(api, modelID, types, 'IfcFaceBasedSurfaceModel'))
  if (!faceModels.size) return new Set()
  if (onProgress) onProgress('正在检查曲面…')
  await yieldToMain()
  const badReps = new Set()
  const shapeReps = linesOf(api, modelID, types, 'IfcShapeRepresentation')
  for (let i = 0; i < shapeReps.length; i += 1) {
    const id = shapeReps[i]
    try {
      const raw = api.GetRawLineData(modelID, id)
      if (rawRefs(raw.arguments[3]).some((item) => faceModels.has(item))) badReps.add(id)
    } catch (error) {
      console.error(error)
    }
    if (i % 400 === 399) await yieldToMain()
  }
  const badMaps = new Set()
  linesOf(api, modelID, types, 'IfcRepresentationMap').forEach((id) => {
    try {
      const raw = api.GetRawLineData(modelID, id)
      if (badReps.has(rawRef(raw.arguments[1]))) badMaps.add(id)
    } catch (error) {
      console.error(error)
    }
  })
  const badItems = new Set()
  linesOf(api, modelID, types, 'IfcMappedItem').forEach((id) => {
    try {
      const raw = api.GetRawLineData(modelID, id)
      if (badMaps.has(rawRef(raw.arguments[0]))) badItems.add(id)
    } catch (error) {
      console.error(error)
    }
  })
  if (badItems.size) {
    shapeReps.forEach((id) => {
      if (badReps.has(id)) return
      try {
        const raw = api.GetRawLineData(modelID, id)
        if (rawRefs(raw.arguments[3]).some((item) => badItems.has(item))) badReps.add(id)
      } catch (error) {
        console.error(error)
      }
    })
  }
  const badShapes = new Set()
  linesOf(api, modelID, types, 'IfcProductDefinitionShape').forEach((id) => {
    try {
      const raw = api.GetRawLineData(modelID, id)
      if (rawRefs(raw.arguments[2]).some((rep) => badReps.has(rep))) badShapes.add(id)
    } catch (error) {
      console.error(error)
    }
  })
  if (!badShapes.size) return new Set()
  const products = new Set()
  const elementTypes = api.GetAllTypesOfModel(modelID).filter((item) => api.IsIfcElement(item.typeID))
  for (let typeIndex = 0; typeIndex < elementTypes.length; typeIndex += 1) {
    const lines = api.GetLineIDsWithType(modelID, elementTypes[typeIndex].typeID, false)
    for (let i = 0; i < lines.size(); i += 1) {
      const id = lines.get(i)
      try {
        const raw = api.GetRawLineData(modelID, id)
        if (badShapes.has(rawRef(raw.arguments[6]))) products.add(id)
      } catch (error) {
        console.error(error)
      }
      if (i % 400 === 399) await yieldToMain()
    }
    if (typeof lines.delete === 'function') lines.delete()
  }
  return products
}

const BATCH_GEOMETRY_LIMIT = 4096
const BATCH_VERTEX_LIMIT = 1000000
const BATCH_INDEX_LIMIT = 3000000

async function buildMeshes(api, modelID, unitScale, library, byteLength, onProgress) {
  const group = new THREE.Group()
  group.name = 'ifc-model'
  const byId = new Map()
  const geometryCache = new Map()
  const buckets = new Map()
  const hidden = hiddenExpressIds(api, modelID)
  const spaceIds = new Set(linesOf(api, modelID, typeMap(api, modelID), 'IfcSpace'))
  const skippedSurfaces = await faceSurfaceProductIds(api, modelID, onProgress)
  const meshIds = collectMeshIds(api, modelID, hidden, skippedSurfaces)
  if (skippedSurfaces.size && onProgress) {
    onProgress(`已跳过 ${skippedSurfaces.size} 个无法三角化的曲面`)
    await yieldToMain()
  }
  const total = meshIds.length
  const heavy = byteLength > 4 * 1024 * 1024 || total > 1500

  function consumeFlat(flat) {
    if (hidden.has(flat.expressID) || byId.has(flat.expressID)) return
    const parts = []
    const isSpace = spaceIds.has(flat.expressID)
    const placed = flat.geometries
    for (let j = 0; j < placed.size(); j += 1) {
      const item = placed.get(j)
      const geometry = getGeometry(api, modelID, item.geometryExpressID, geometryCache, unitScale, item.flatTransformation, heavy)
      if (!geometry) continue
      const material = isSpace ? library.spaceMaterial() : library.materialFor(flat.expressID, item.color)
      const position = geometry.getAttribute('position')
      const index = geometry.getIndex()
      const chunk = takeChunk(buckets, material, position.count, index.count)
      const part = {
        batch: null,
        geometryId: -1,
        expressID: flat.expressID,
        passThrough: !!material.userData.passThrough,
        indexStart: 0,
        indexCount: index.count,
        vertexStart: 0,
        vertexCount: position.count
      }
      const transform = new Float32Array(16)
      for (let k = 0; k < 16; k += 1) transform[k] = item.flatTransformation[k] || 0
      chunk.items.push({ geometry, transform, part })
      chunk.vertexCount += position.count
      chunk.indexCount += index.count
      parts.push(part)
    }
    if (!parts.length) return
    byId.set(flat.expressID, {
      parts,
      passThrough: false,
      frameIgnore: isSpace,
      space: isSpace
    })
  }

  const batches = []
  const chunkSize = heavy ? 40 : 200
  const releaseGeometries = () => {
    const flushed = flushChunks(group, buckets)
    batches.push(...flushed)
    buckets.clear()
    geometryCache.forEach((geometry) => {
      if (geometry) geometry.dispose()
    })
    geometryCache.clear()
  }
  for (let start = 0; start < meshIds.length; start += chunkSize) {
    const slice = meshIds.slice(start, start + chunkSize)
    try {
      api.StreamMeshes(modelID, slice, (flat) => {
        try {
          consumeFlat(flat)
        } finally {
          if (typeof flat.delete === 'function') flat.delete()
        }
      })
    } catch (error) {
      if (isWasmAbort(error)) throw error
      slice.forEach((id) => {
        if (byId.has(id)) return
        try {
          const flat = api.GetFlatMesh(modelID, id)
          try {
            consumeFlat(flat)
          } finally {
            if (typeof flat.delete === 'function') flat.delete()
          }
        } catch (itemError) {
          if (isWasmAbort(itemError)) throw itemError
          console.error(itemError)
        }
      })
    }
    if (heavy) releaseGeometries()
    if (heavy) {
      if (onProgress) onProgress(`正在生成几何 ${Math.min(start + chunkSize, meshIds.length)}/${meshIds.length}`)
      await yieldToMain()
    }
  }
  const missingSpaces = [...spaceIds].filter((id) => !byId.has(id))
  for (let i = 0; i < missingSpaces.length; i += 1) {
    try {
      const flat = api.GetFlatMesh(modelID, missingSpaces[i])
      try {
        consumeFlat(flat)
      } finally {
        if (typeof flat.delete === 'function') flat.delete()
      }
    } catch (error) {
      if (isWasmAbort(error)) throw error
      console.error(error)
    }
    if (heavy && i % 40 === 39) {
      releaseGeometries()
      await yieldToMain()
    }
  }

  releaseGeometries()
  byId.forEach((record) => {
    record.passThrough = record.parts.every((part) => part.passThrough)
    if (!record.passThrough && !record.space) return
    record.parts.forEach((part) => part.batch.setVisibleAt(part.geometryId, false))
  })
  const extras = []
  addAlignments(api, modelID, group, extras)
  if (unitScale !== 1) group.scale.setScalar(unitScale)
  group.updateMatrixWorld(true)
  const placed = []
  byId.forEach((record) => {
    const box = new THREE.Box3()
    record.parts.forEach((part) => unionPartWorldBox(box, part))
    if (!box.isEmpty()) placed.push({ record, box })
  })
  markDistantOutliers(placed)
  const frame = new THREE.Box3()
  placed.forEach((item) => {
    if (item.record.frameIgnore) return
    frame.union(item.box)
  })
  if (!frame.isEmpty()) {
    const center = frame.getCenter(new THREE.Vector3())
    group.position.sub(center)
    group.updateMatrixWorld(true)
  }
  return { group, byId, ids: new Set(byId.keys()), batches, extras, skippedSurfaces: skippedSurfaces.size }
}

function addAlignments(api, modelID, group, extras) {
  const types = typeMap(api, modelID)
  const horizontals = new Set(linesOf(api, modelID, types, 'IfcAlignmentHorizontal'))
  const verticals = new Set(linesOf(api, modelID, types, 'IfcAlignmentVertical'))
  const alignments = new Set(linesOf(api, modelID, types, 'IfcAlignment'))
  if (!horizontals.size && !alignments.size) return
  const nested = new Map()
  linesOf(api, modelID, types, 'IfcRelNests').forEach((relId) => {
    try {
      const raw = api.GetRawLineData(modelID, relId)
      const parent = rawRef(raw.arguments[4])
      if (!parent) return
      const list = nested.get(parent) || []
      list.push(...rawRefs(raw.arguments[5]))
      nested.set(parent, list)
    } catch (error) {
      console.error(error)
    }
  })
  const verticalByHost = new Map()
  nested.forEach((kids, parent) => {
    if (!alignments.has(parent)) return
    kids.forEach((id) => {
      if (!verticals.has(id)) return
      const list = verticalByHost.get(parent) || []
      list.push(id)
      verticalByHost.set(parent, list)
    })
  })
  const hosts = new Map()
  nested.forEach((kids, parent) => {
    if (!alignments.has(parent)) return
    kids.forEach((id) => {
      if (horizontals.has(id)) hosts.set(id, parent)
    })
  })
  horizontals.forEach((horizontalId) => {
    const segments = (nested.get(horizontalId) || []).map((id) => readHorizontalSegment(api, modelID, id)).filter(Boolean)
    if (segments.length < 1) return
    const host = hosts.get(horizontalId)
    const profile = ((host && verticalByHost.get(host)) || []).flatMap((id) => readVerticalSegments(api, modelID, nested.get(id) || []))
    const positions = []
    let distance = 0
    segments.forEach((segment) => {
      const samples = sampleHorizontal(segment)
      const steps = Math.max(samples.length - 1, 1)
      samples.forEach((point, index) => {
        const along = distance + segment.length * (index / steps)
        const height = heightAlong(profile, along)
        if (positions.length >= 3) {
          const last = positions.length
          const same = Math.hypot(positions[last - 3] - point[0], positions[last - 2] - point[1]) < 1e-4
          if (same) {
            positions[last - 1] = height
            return
          }
        }
        positions.push(point[0], point[1], height)
      })
      distance += segment.length
    })
    if (positions.length < 6) return
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xe2b15a }))
    line.frustumCulled = false
    line.raycast = () => {}
    line.renderOrder = 4
    group.add(line)
    extras.push(line)
  })
}

function readHorizontalSegment(api, modelID, segmentId) {
  try {
    const segment = api.GetRawLineData(modelID, segmentId)
    const designId = rawRef(segment.arguments[7])
    if (!designId) return null
    const design = api.GetRawLineData(modelID, designId)
    const pointId = rawRef(design.arguments[2])
    if (!pointId) return null
    const point = readCoordinates(api, modelID, pointId)
    const type = enumValue(design.arguments[8]).replace(/^\./, '').replace(/\.$/, '')
    return {
      point,
      direction: numberValue(design.arguments[3]),
      r0: numberValue(design.arguments[4]),
      r1: numberValue(design.arguments[5]),
      length: numberValue(design.arguments[6]),
      type
    }
  } catch (error) {
    return null
  }
}

function readVerticalSegments(api, modelID, nestedIds) {
  return nestedIds.map((id) => {
    try {
      const segment = api.GetRawLineData(modelID, id)
      const designId = rawRef(segment.arguments[7])
      if (!designId) return null
      const design = api.GetRawLineData(modelID, designId)
      return {
        start: numberValue(design.arguments[2]),
        length: numberValue(design.arguments[3]),
        height: numberValue(design.arguments[4]),
        g0: numberValue(design.arguments[5]),
        g1: numberValue(design.arguments[6])
      }
    } catch (error) {
      return null
    }
  }).filter(Boolean)
}

function sampleHorizontal(segment) {
  const x0 = segment.point[0]
  const y0 = segment.point[1]
  const length = segment.length
  if (!Number.isFinite(length) || Math.abs(length) < 1e-6) return [[x0, y0]]
  const k0 = curvatureOf(segment.r0)
  const k1 = curvatureOf(segment.type === 'LINE' ? 0 : segment.r1)
  const steps = segment.type === 'LINE' ? 1 : Math.min(64, Math.max(8, Math.ceil(Math.abs(length) / 2)))
  const ds = length / steps
  const points = [[x0, y0]]
  let x = x0
  let y = y0
  let angle = segment.direction
  for (let i = 0; i < steps; i += 1) {
    const curvature = k0 + (k1 - k0) * ((i + 0.5) / steps)
    x += Math.cos(angle) * ds
    y += Math.sin(angle) * ds
    angle += curvature * ds
    points.push([x, y])
  }
  return points
}

function curvatureOf(radius) {
  if (!radius || Math.abs(radius) < 1e-8 || Math.abs(radius) > 1e8) return 0
  return 1 / radius
}

function heightAlong(profile, distance) {
  if (!profile.length) return 0
  for (let i = 0; i < profile.length; i += 1) {
    const segment = profile[i]
    const end = segment.start + segment.length
    if (distance > end + 1e-3 && i < profile.length - 1) continue
    const along = distance - segment.start
    const length = Math.max(segment.length, 1e-6)
    return segment.height + segment.g0 * along + ((segment.g1 - segment.g0) * along * along) / (2 * length)
  }
  return profile[profile.length - 1].height
}

function readCoordinates(api, modelID, id) {
  const raw = api.GetRawLineData(modelID, id)
  const coords = Array.isArray(raw.arguments[0]) ? raw.arguments[0] : []
  return [numberValue(coords[0]), numberValue(coords[1]), numberValue(coords[2])]
}

function numberValue(arg) {
  if (typeof arg === 'number') return arg
  if (typeof arg === 'string' && arg !== '$' && arg !== '') return Number(arg)
  if (arg && typeof arg.value === 'number') return arg.value
  if (arg && typeof arg.value === 'string' && arg.value !== '') return Number(arg.value)
  return 0
}

function takeChunk(buckets, material, vertexCount, indexCount) {
  let bucket = buckets.get(material.uuid)
  if (!bucket) {
    bucket = { material, chunks: [] }
    buckets.set(material.uuid, bucket)
  }
  const current = bucket.chunks[bucket.chunks.length - 1]
  if (
    current &&
    current.items.length < BATCH_GEOMETRY_LIMIT &&
    current.vertexCount + vertexCount <= BATCH_VERTEX_LIMIT &&
    current.indexCount + indexCount <= BATCH_INDEX_LIMIT
  ) {
    return current
  }
  const chunk = { material, items: [], vertexCount: 0, indexCount: 0 }
  bucket.chunks.push(chunk)
  return chunk
}

function flushChunks(group, buckets) {
  const batches = []
  const matrix = new THREE.Matrix4()
  buckets.forEach((bucket) => {
    bucket.chunks.forEach((chunk) => {
      if (!chunk.items.length) return
      const batch = new THREE.BatchedMesh(chunk.items.length, chunk.vertexCount, chunk.indexCount, chunk.material)
      batch.frustumCulled = false
      batch.perObjectFrustumCulled = chunk.items.length > 80
      batch.sortObjects = !!chunk.material.transparent && chunk.items.length < 600
      batch.userData.expressIDs = new Array(chunk.items.length)
      batch.userData.passThrough = new Array(chunk.items.length)
      chunk.items.forEach((item) => {
        const geometryId = batch.addGeometry(item.geometry)
        matrix.fromArray(item.transform)
        batch.setMatrixAt(geometryId, matrix)
        const range = batch._drawRanges[geometryId]
        const reserved = batch._reservedRanges[geometryId]
        item.part.batch = batch
        item.part.geometryId = geometryId
        item.part.indexStart = range.start
        item.part.indexCount = range.count
        item.part.vertexStart = reserved.vertexStart
        item.part.vertexCount = reserved.vertexCount
        batch.userData.expressIDs[geometryId] = item.part.expressID
        batch.userData.passThrough[geometryId] = item.part.passThrough
      })
      group.add(batch)
      batches.push(batch)
    })
  })
  return batches
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

function markDistantOutliers(entries) {
  if (entries.length < 2) return
  entries.forEach((item) => {
    item.size = item.box.getSize(new THREE.Vector3()).length()
  })
  if (entries.length > 900) {
    markOutliersByDistance(entries)
    return
  }
  let largest = entries[0]
  entries.forEach((item) => {
    if (item.size > largest.size) largest = item
  })
  const cluster = new Set([largest])
  let clusterBox = largest.box.clone()
  let grew = true
  while (grew) {
    grew = false
    const reach = Math.max(clusterBox.getSize(new THREE.Vector3()).length() * 0.35, 6)
    entries.forEach((item) => {
      if (cluster.has(item)) return
      if (boxGap(clusterBox, item.box) > reach) return
      cluster.add(item)
      clusterBox.union(item.box)
      grew = true
    })
  }
  entries.forEach((item) => {
    if (!cluster.has(item)) item.record.frameIgnore = true
  })
}

function markOutliersByDistance(entries) {
  let largest = entries[0]
  entries.forEach((item) => {
    if (item.size > largest.size) largest = item
  })
  const origin = largest.box.getCenter(new THREE.Vector3())
  const distances = entries.map((item) => item.box.getCenter(new THREE.Vector3()).distanceTo(origin))
  const sorted = distances.slice().sort((a, b) => a - b)
  const typical = sorted[Math.floor(sorted.length * 0.9)] || 0
  const limit = Math.max(typical * 2.5, largest.size * 2, 6)
  entries.forEach((item, index) => {
    if (item !== largest && distances[index] > limit) item.record.frameIgnore = true
  })
}

function boxGap(a, b) {
  const dx = Math.max(a.min.x - b.max.x, b.min.x - a.max.x, 0)
  const dy = Math.max(a.min.y - b.max.y, b.min.y - a.max.y, 0)
  const dz = Math.max(a.min.z - b.max.z, b.min.z - a.max.z, 0)
  return Math.hypot(dx, dy, dz)
}

function softenCreases(position, normal) {
  const groups = new Map()
  const count = position.length / 3
  for (let i = 0; i < count; i += 1) {
    const key = [
      Math.round(position[i * 3] * 1000),
      Math.round(position[i * 3 + 1] * 1000),
      Math.round(position[i * 3 + 2] * 1000)
    ].join(',')
    const list = groups.get(key)
    if (list) list.push(i)
    else groups.set(key, [i])
  }
  groups.forEach((indices) => {
    if (indices.length < 2) return
    let crease = false
    for (let a = 0; a < indices.length && !crease; a += 1) {
      for (let b = a + 1; b < indices.length; b += 1) {
        const ia = indices[a] * 3
        const ib = indices[b] * 3
        const dot = normal[ia] * normal[ib] + normal[ia + 1] * normal[ib + 1] + normal[ia + 2] * normal[ib + 2]
        if (dot < 0.25) {
          crease = true
          break
        }
      }
    }
    if (crease) return
    let x = 0
    let y = 0
    let z = 0
    indices.forEach((index) => {
      x += normal[index * 3]
      y += normal[index * 3 + 1]
      z += normal[index * 3 + 2]
    })
    const length = Math.hypot(x, y, z) || 1
    x /= length
    y /= length
    z /= length
    indices.forEach((index) => {
      normal[index * 3] = x
      normal[index * 3 + 1] = y
      normal[index * 3 + 2] = z
    })
  })
}

function averageNormalLength(normal) {
  if (!normal.length) return 0
  let total = 0
  const count = normal.length / 3
  for (let i = 0; i < count; i += 1) {
    const nx = normal[i * 3]
    const ny = normal[i * 3 + 1]
    const nz = normal[i * 3 + 2]
    total += Math.sqrt(nx * nx + ny * ny + nz * nz)
  }
  return total / count
}

function getGeometry(api, modelID, geometryExpressID, cache, unitScale, transform, heavy) {
  const scale = matrixScale(transform)
  const key = `${geometryExpressID}|${scale.map((value) => value.toFixed(5)).join(',')}|${unitScale}`
  if (cache.has(key)) return cache.get(key)
  const geometry = api.GetGeometry(modelID, geometryExpressID)
  const vertexData = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize())
  const indexData = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize())
  const indexCopy = copyIndex(indexData)
  if (!vertexData.length || !indexCopy.length) {
    geometry.delete()
    cache.set(key, null)
    return null
  }
  const count = vertexData.length / 6
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    position[i * 3] = vertexData[i * 6]
    position[i * 3 + 1] = vertexData[i * 6 + 1]
    position[i * 3 + 2] = vertexData[i * 6 + 2]
    normal[i * 3] = vertexData[i * 6 + 3]
    normal[i * 3 + 1] = vertexData[i * 6 + 4]
    normal[i * 3 + 2] = vertexData[i * 6 + 5]
  }
  geometry.delete()
  const buffer = new THREE.BufferGeometry()
  buffer.setAttribute('position', new THREE.BufferAttribute(position, 3))
  buffer.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  buffer.setIndex(new THREE.BufferAttribute(indexCopy, 1))
  if (averageNormalLength(normal) < 0.5) buffer.computeVertexNormals()
  if (!heavy && count <= 12000) softenCreases(position, normal)
  addPlanarUVs(buffer, scale.map((value) => value * unitScale))
  buffer.computeBoundingBox()
  buffer.computeBoundingSphere()
  cache.set(key, buffer)
  return buffer
}

function copyIndex(indexData) {
  if (!indexData || !indexData.length) return new Uint32Array()
  if (indexData instanceof Uint32Array || indexData instanceof Uint16Array) {
    return new indexData.constructor(indexData)
  }
  return Uint32Array.from(indexData)
}

function matrixScale(transform) {
  const elements = transform || []
  const axis = (offset) => Math.hypot(elements[offset] || 0, elements[offset + 1] || 0, elements[offset + 2] || 0) || 1
  return [axis(0), axis(4), axis(8)]
}

function addPlanarUVs(buffer, scale) {
  const position = buffer.getAttribute('position').array
  const normal = buffer.getAttribute('normal').array
  const count = position.length / 3
  const uv = new Float32Array(count * 2)
  const [sx, sy, sz] = scale
  for (let i = 0; i < count; i += 1) {
    const nx = Math.abs(normal[i * 3])
    const ny = Math.abs(normal[i * 3 + 1])
    const nz = Math.abs(normal[i * 3 + 2])
    const x = position[i * 3] * sx
    const y = position[i * 3 + 1] * sy
    const z = position[i * 3 + 2] * sz
    let u = x
    let v = y
    if (nz >= nx && nz >= ny) {
      u = x
      v = y
    } else if (nx >= ny) {
      u = z
      v = y
    } else {
      u = x
      v = z
    }
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  buffer.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

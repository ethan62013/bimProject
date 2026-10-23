import './style.css'
import { beginPropertyIndex, closeModel, loadIfc, readElementProperties } from './loader'
import { createViewer } from './viewer'

const fileInput = document.querySelector('#file')
const fileName = document.querySelector('#fileName')
const status = document.querySelector('#status')
const tree = document.querySelector('#tree')
const pickInfo = document.querySelector('#pickInfo')
const empty = document.querySelector('#empty')
const hint = document.querySelector('#hint')
const labels = document.querySelector('#labels')
const canvas = document.querySelector('#view')
const viewer = createViewer(canvas)

let session = null
let mode = 'orbit'
let searchQuery = ''
let selectedIds = []
const checked = new Set()
const checkboxIds = new WeakMap()

document.querySelector('#openBtn').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0]
  if (file) openBuffer(file.arrayBuffer(), file.name)
  fileInput.value = ''
})
document.querySelector('#sampleBtn').addEventListener('click', async () => {
  setStatus('正在加载示例…')
  const response = await fetch('/demo.ifc', { cache: 'no-store' })
  openBuffer(response.arrayBuffer(), 'demo.ifc')
})
document.querySelector('#stage').addEventListener('dragover', (event) => event.preventDefault())
document.querySelector('#stage').addEventListener('drop', (event) => {
  event.preventDefault()
  const file = event.dataTransfer.files && event.dataTransfer.files[0]
  if (file) openBuffer(file.arrayBuffer(), file.name)
})

document.querySelectorAll('#toolbar [data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    mode = button.dataset.mode
    document.querySelectorAll('#toolbar [data-mode]').forEach((item) => {
      item.classList.toggle('active', item === button)
    })
    hint.textContent = viewer.setMode(mode)
  })
})
document.querySelector('#clearMeasure').addEventListener('click', () => {
  viewer.clearMeasurements()
  hint.textContent = mode === 'orbit' ? '' : viewer.setMode(mode)
})
document.querySelector('#fitBtn').addEventListener('click', () => {
  viewer.frameAll()
  pickInfo.textContent = '点击模型查看构件。'
})
document.querySelector('#hideMaterialBtn').addEventListener('click', () => {
  if (!session || viewer.selectedId == null) {
    hint.textContent = '先点击要隐藏的材质。'
    return
  }
  const materialName = viewer.materialName(viewer.selectedId)
  const ids = materialName
    ? viewer.idsUsingMaterial(materialName)
    : [viewer.selectedId]
  if (!ids.length) {
    hint.textContent = '没有可隐藏的构件。'
    return
  }
  viewer.setVisible(ids, false)
  refreshTreeChecks()
  hint.textContent = materialName
    ? `已隐藏材质 ${materialName}，共 ${ids.length} 个构件。`
    : '已隐藏选中的构件。'
})
document.querySelector('#showAllBtn').addEventListener('click', () => {
  if (!session) return
  viewer.showAll()
  refreshTreeChecks()
  hint.textContent = '已恢复隐藏的构件。'
})
document.querySelector('#sectionBtn').addEventListener('click', () => {
  if (!session) {
    hint.textContent = '先打开一个 IFC 文件。'
    return
  }
  const enabled = viewer.setSectionEnabled(!viewer.sectionEnabled)
  document.querySelector('#sectionBtn').classList.toggle('active', enabled)
  document.querySelector('#sectionBar').hidden = !enabled
  hint.textContent = enabled ? sectionHint() : '剖切已关闭。'
})
document.querySelectorAll('#sectionBar [data-section]').forEach((button) => {
  button.addEventListener('click', () => {
    const next = viewer.setSectionMode(button.dataset.section)
    document.querySelectorAll('#sectionBar [data-section]').forEach((item) => {
      item.classList.toggle('active', item === button)
    })
    document.querySelector('#planeControls').hidden = next !== 'plane'
    document.querySelector('#boxControls').hidden = next !== 'box'
    hint.textContent = sectionHint()
  })
})
document.querySelectorAll('#sectionBar [data-axis]').forEach((button) => {
  button.addEventListener('click', () => {
    viewer.setSectionAxis(button.dataset.axis)
    document.querySelectorAll('#sectionBar [data-axis]').forEach((item) => {
      item.classList.toggle('active', item === button)
    })
  })
})
document.querySelector('#sectionRange').addEventListener('input', (event) => {
  viewer.setSectionOffset(Number(event.target.value) / 1000)
})
document.querySelector('#sectionFlip').addEventListener('click', () => {
  viewer.flipSection()
})
document.querySelectorAll('#boxControls input').forEach((input) => {
  input.addEventListener('input', () => {
    const pair = viewer.setSectionBox(input.dataset.axis, Number(input.dataset.edge), Number(input.value) / 1000)
    if (!pair) return
    input.value = String(Math.round(pair[Number(input.dataset.edge)] * 1000))
  })
})
document.querySelector('#treeSearch').addEventListener('input', (event) => {
  searchQuery = event.target.value.trim().toLowerCase()
  if (session) renderTree(session.tree)
})
document.querySelector('#storeyBtn').addEventListener('click', () => {
  if (!session || !selectedIds.length) {
    hint.textContent = '先在目录树或模型里选择一个楼层中的构件。'
    return
  }
  const storey = findStorey(session.tree, selectedIds[0])
  if (!storey) {
    hint.textContent = '没有可单独显示的楼层。'
    return
  }
  const count = viewer.isolate(storey.expressIDs)
  refreshTreeChecks()
  hint.textContent = count
    ? `已只显示楼层 ${storey.name}，共 ${count} 个构件。`
    : `楼层 ${storey.name} 没有可显示的构件。`
})
document.querySelector('#spaceBtn').addEventListener('click', () => {
  if (!session) {
    hint.textContent = '先打开一个 IFC 文件。'
    return
  }
  const enabled = !viewer.spacesVisible
  const count = viewer.setSpacesVisible(enabled)
  document.querySelector('#spaceBtn').classList.toggle('active', enabled && count > 0)
  refreshTreeChecks()
  if (!count) {
    document.querySelector('#spaceBtn').classList.remove('active')
    hint.textContent = '这个模型没有空间。'
    return
  }
  hint.textContent = enabled ? `已显示 ${count} 个空间。` : '已隐藏空间。'
})
document.querySelector('#isolateBtn').addEventListener('click', () => {
  if (!session || !selectedIds.length) {
    hint.textContent = '先在模型或目录树里选择要露出的构件。'
    return
  }
  const count = viewer.isolate(selectedIds)
  refreshTreeChecks()
  hint.textContent = count
    ? `已隔离，仅露出 ${count} 个构件。`
    : '没有可露出的构件。'
})

let down = null
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  down = { x: event.clientX, y: event.clientY }
})
canvas.addEventListener('pointerup', (event) => {
  if (!down || event.button !== 0) return
  const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
  down = null
  if (moved > 4 || !session) return
  const result = viewer.onClick(event)
  if (!result) return
  if (result.type === 'clear') {
    selectedIds = []
    pickInfo.textContent = '点击模型查看构件。'
    return
  }
  rememberSelection([result.expressID])
  showPick(result.expressID)
  if (result.type === 'distance') hint.textContent = `距离 ${result.distance.toFixed(3)} m`
  if (result.type === 'angle') hint.textContent = `角度 ${result.angle.toFixed(1)}°`
  if (result.type === 'area') hint.textContent = `面积 ${result.area.toFixed(3)} m²`
  if (result.type === 'pending') {
    const total = mode === 'distance' ? 2 : 3
    hint.textContent = `已选择 ${result.count}/${total} 个点`
  }
})

async function openBuffer(bufferPromise, name) {
  setStatus('正在解析 IFC…')
  try {
    const buffer = await bufferPromise
    if (session) {
      const previous = session
      session = null
      previous.closed = true
      viewer.setModel(null)
      await closeModel(previous)
    }
    const next = await loadIfc(buffer, setStatus)
    session = next
    viewer.setModel(session.model)
    selectedIds = []
    searchQuery = ''
    document.querySelector('#treeSearch').value = ''
    document.querySelector('#spaceBtn').classList.remove('active')
    checked.clear()
    collectKeys(session.tree).forEach((id) => checked.add(id))
    renderTree(session.tree)
    refreshTreeChecks()
    empty.classList.add('hidden')
    fileName.textContent = name
    const count = session.model.ids.size
    const skipped = session.model.skippedSurfaces || 0
    const loaded = skipped
      ? `已加载 ${count} 个几何构件，跳过 ${skipped} 个无法三角化的曲面`
      : `已加载 ${count} 个几何构件`
    setStatus(loaded)
    pickInfo.textContent = '点击模型查看构件。'
    hint.textContent = ''
    const opened = next
    beginPropertyIndex(opened, () => {}).then(() => {
      if (session !== opened) return
      setStatus(loaded)
      if (selectedIds.length === 1) showPick(selectedIds[0])
    })
  } catch (error) {
    console.error(error)
    setStatus('解析失败')
    pickInfo.textContent = error.message || '这个 IFC 无法解析。'
  }
}

function renderTree(node) {
  tree.innerHTML = ''
  const kids = visibleChildren(node)
  if (searchQuery && !kids.length) {
    const empty = document.createElement('p')
    empty.className = 'search-empty'
    empty.textContent = '没有匹配的构件。'
    tree.appendChild(empty)
    return
  }
  const list = document.createElement('div')
  kids.forEach((child) => list.appendChild(renderNode(child, 0)))
  tree.appendChild(list)
}

function elementBlob(node) {
  const id = node.expressIDs[0]
  const props = session && session.propertyIndex ? session.propertyIndex.text.get(id) || '' : ''
  return `${node.name} ${id == null ? '' : id} ${props}`.toLowerCase()
}

function branchMatches(node) {
  if (!searchQuery) return true
  if (node.kind === 'element') return elementBlob(node).includes(searchQuery)
  if (node.name.toLowerCase().includes(searchQuery)) return true
  return node.children.some((child) => branchMatches(child))
}

function visibleChildren(node) {
  if (!searchQuery) return node.children
  if (node.kind !== 'element' && node.name.toLowerCase().includes(searchQuery)) return node.children
  return node.children.filter((child) => branchMatches(child))
}

function renderNode(node, depth) {
  const wrap = document.createElement('div')
  wrap.className = 'tree-node'
  const row = document.createElement('div')
  row.className = 'tree-row'
  row.style.paddingLeft = `${depth * 14 + 4}px`
  const twisty = document.createElement('button')
  twisty.type = 'button'
  twisty.className = 'twisty'
  const kids = visibleChildren(node)
  const hasChildren = kids.length > 0
  twisty.textContent = hasChildren ? '▸' : ''
  if (!hasChildren) twisty.classList.add('placeholder')
  const box = document.createElement('input')
  box.type = 'checkbox'
  checkboxIds.set(box, node.expressIDs)
  const idsForCheck = visibilityIds(node.expressIDs)
  const visibleCount = idsForCheck.filter((id) => viewer.isVisible(id)).length
  box.checked = !idsForCheck.length || visibleCount === idsForCheck.length
  box.indeterminate = visibleCount > 0 && visibleCount < idsForCheck.length
  const label = document.createElement('div')
  label.className = 'node-name'
  label.textContent = node.name
  label.title = node.name
  if (node.kind === 'element' && node.expressIDs.every((id) => !session.model.byId.has(id))) {
    label.classList.add('muted')
  }
  const children = document.createElement('div')
  children.hidden = kids.length > (searchQuery ? 80 : 40)
  let built = false
  const buildChildren = () => {
    if (built) return
    built = true
    kids.forEach((child) => children.appendChild(renderNode(child, depth + 1)))
  }
  if (!children.hidden && hasChildren) {
    twisty.textContent = '▾'
    buildChildren()
  }
  twisty.addEventListener('click', () => {
    if (!hasChildren) return
    if (children.hidden) buildChildren()
    children.hidden = !children.hidden
    twisty.textContent = children.hidden ? '▸' : '▾'
  })
  box.addEventListener('change', () => {
    const ids = node.expressIDs
    viewer.setVisible(ids, box.checked)
    wrap.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = box.checked
      input.indeterminate = false
    })
    updateAncestors(wrap)
  })
  label.addEventListener('click', () => {
    document.querySelectorAll('.tree-row.selected').forEach((item) => item.classList.remove('selected'))
    row.classList.add('selected')
    rememberSelection(node.expressIDs)
    const id = node.kind === 'element' ? node.expressIDs[0] : null
    if (id != null) viewer.focus(id)
    else viewer.frameAll()
    showPick(id)
  })
  row.append(twisty, box, label)
  wrap.append(row, children)
  return wrap
}

function refreshTreeChecks() {
  document.querySelectorAll('#tree .tree-node').forEach((wrap) => {
    const input = wrap.querySelector(':scope > .tree-row input')
    const ids = input && checkboxIds.get(input)
    if (!ids || !ids.length) return
    const visibleIds = visibilityIds(ids)
    const visibleCount = visibleIds.filter((id) => viewer.isVisible(id)).length
    input.checked = visibleCount === visibleIds.length
    input.indeterminate = visibleCount > 0 && visibleCount < visibleIds.length
  })
}

function updateAncestors(nodeElement) {
  let parent = nodeElement.parentElement
  while (parent && parent.id !== 'tree') {
    const parentNode = parent.closest('.tree-node')
    if (!parentNode || parentNode === nodeElement) {
      parent = parent.parentElement
      continue
    }
    const box = parentNode.querySelector(':scope > .tree-row input')
    const childBoxes = [...parentNode.querySelectorAll(':scope > div input')]
    if (box && childBoxes.length) {
      const checkedCount = childBoxes.filter((item) => item.checked).length
      box.checked = checkedCount === childBoxes.length
      box.indeterminate = checkedCount > 0 && checkedCount < childBoxes.length
    }
    parent = parentNode.parentElement
  }
}

function showPick(expressID) {
  pickInfo.replaceChildren()
  if (expressID == null || !session) {
    pickInfo.textContent = '点击模型查看构件。'
    return
  }
  const groups = readElementProperties(session, expressID)
  const materialName = viewer.materialName(expressID)
  if (materialName && groups[0]) groups[0].rows.push({ key: '材质', value: materialName })
  if (!session.propertyReady) {
    groups.push({ name: '属性集', rows: [{ key: '状态', value: '正在读取，完成后会显示在这里。' }] })
  }
  groups.forEach((group) => {
    const block = document.createElement('div')
    block.className = 'prop-group'
    const title = document.createElement('div')
    title.className = 'prop-name'
    title.textContent = group.name
    block.appendChild(title)
    group.rows.forEach((row) => {
      const line = document.createElement('div')
      line.className = 'prop-row'
      const key = document.createElement('div')
      key.className = 'prop-key'
      key.textContent = row.key
      const value = document.createElement('div')
      value.className = 'prop-val'
      value.textContent = row.value
      line.append(key, value)
      block.appendChild(line)
    })
    pickInfo.appendChild(block)
  })
}

function sectionHint() {
  return viewer.sectionMode === 'box'
    ? '拖动每条轴的起止，保留盒子内部。'
    : '拖动滑块移动剖切面，X / Y / Z 切换方向。'
}

function visibilityIds(ids) {
  if (!ids.length || viewer.spacesVisible) return ids
  const solid = ids.filter((id) => !viewer.isSpace(id))
  return solid.length ? solid : ids
}

function findStorey(node, expressID) {
  for (const child of node.children) {
    const found = findStorey(child, expressID)
    if (found) return found
  }
  if (node.ifcType === 'IfcBuildingStorey' && node.expressIDs.includes(expressID)) return node
  return null
}

function collectKeys(node, ids = []) {
  node.expressIDs.forEach((id) => ids.push(id))
  return ids
}

function rememberSelection(ids) {
  selectedIds = []
  if (!session) return
  const seen = new Set()
  ids.forEach((id) => {
    if (seen.has(id) || !session.model.byId.has(id)) return
    seen.add(id)
    selectedIds.push(id)
  })
}

function setStatus(text) {
  status.textContent = text
}

function tick() {
  try {
    viewer.render(labels)
  } catch (error) {
    console.error(error)
  }
  requestAnimationFrame(tick)
}
tick()
hint.textContent = ''

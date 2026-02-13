(function () {
  "use strict";

  const CONFIG = window.__SCAFFOLD__;
  if (!CONFIG) return;

  const PAGE = CONFIG.page;
  const WS_URL = CONFIG.ws;
  const AI_ENABLED = CONFIG.aiEnabled || false;
  const ALL_PAGES = CONFIG.pages || [];

  // ─── State ────────────────────────────────────────────────────────────────────

  let editMode = false;
  let selectedElement = null;
  let viewerCount = 0;
  let ws = null;
  let wsReconnectTimer = null;
  let aiWorking = false;
  let insertionMode = false;
  let insertionHtml = null;
  let componentPaletteOpen = false;
  let hoveredElement = null;
  let elementDragging = false;
  let dragMouseDown = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragIndicator = null;
  let dragTarget = null;
  let dragBefore = true;
  let suppressNextClick = false;

  // ─── Shadow DOM Setup ─────────────────────────────────────────────────────────

  const host = document.createElement("scaffold-editor");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "closed" });

  // Load styles into shadow DOM
  const styleLink = document.createElement("link");
  styleLink.rel = "stylesheet";
  styleLink.href = "/_/assets/editor.css";
  shadow.appendChild(styleLink);

  // ─── Selection style injected in main document ────────────────────────────────

  const selectionStyle = document.createElement("style");
  selectionStyle.setAttribute("data-scaffold-selection", "");
  selectionStyle.textContent = `
    [data-scaffold-selected] {
      outline: 2px dashed #38bdf8 !important;
      outline-offset: 2px !important;
    }
    [data-scaffold-hovered] {
      outline: 1px solid rgba(148, 163, 184, 0.5) !important;
      outline-offset: 1px !important;
    }
    .scaffold-insertion-indicator {
      position: absolute;
      left: 0;
      right: 0;
      height: 3px;
      background: #38bdf8;
      pointer-events: none;
      z-index: 2147483646;
      border-radius: 2px;
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.5);
    }
    [data-scaffold-dragging] {
      opacity: 0.4 !important;
      transition: opacity 0.15s ease !important;
    }
  `;
  document.head.appendChild(selectionStyle);

  // ─── Toolbar ──────────────────────────────────────────────────────────────────

  const toolbar = document.createElement("div");
  toolbar.className = "scaffold-toolbar";

  let toolbarHtml = `
    <button class="scaffold-btn" data-action="edit" data-testid="edit-btn">
      <span class="icon">&#9998;</span> Edit
    </button>
    <button class="scaffold-btn" data-action="save" data-testid="save-btn" style="display:none">
      <span class="icon">&#128190;</span> Save
    </button>
    <button class="scaffold-btn" data-action="undo" data-testid="undo-btn" style="display:none">
      <span class="icon">&#8634;</span> Undo
    </button>`;

  if (AI_ENABLED) {
    toolbarHtml += `
    <button class="scaffold-btn" data-action="new-page" data-testid="new-page-btn" style="display:none" title="Create new page">
      <span class="icon">+</span>
    </button>
    <button class="scaffold-btn" data-action="components" data-testid="components-btn" style="display:none" title="Component palette">
      <span class="icon">&#9645;</span>
    </button>
    <button class="scaffold-btn" data-action="extract" data-testid="extract-btn" style="display:none" title="Extract component">
      <span class="icon">&#8689;</span> Extract
    </button>`;
  }

  toolbarHtml += `
    <div class="scaffold-divider"></div>
    <div class="scaffold-viewers">
      <span class="dot"></span>
      <span data-viewers>1</span>
    </div>
  `;
  toolbar.innerHTML = toolbarHtml;
  shadow.appendChild(toolbar);

  // Restore toolbar position from localStorage
  const savedPos = localStorage.getItem("scaffold-toolbar-pos");
  if (savedPos) {
    try {
      const { bottom, right } = JSON.parse(savedPos);
      toolbar.style.bottom = bottom + "px";
      toolbar.style.right = right + "px";
    } catch {}
  }

  // ─── AI Bar (below toolbar) ─────────────────────────────────────────────────

  let aiBar = null;
  let aiInput = null;
  let aiStatus = null;
  let aiHistoryBtn = null;
  let aiHistoryMenu = null;

  if (AI_ENABLED) {
    aiBar = document.createElement("div");
    aiBar.className = "scaffold-ai-bar";
    aiBar.style.display = "none";
    aiBar.innerHTML = `
      <div class="scaffold-ai-input-row">
        <input type="text" class="scaffold-ai-input" data-testid="ai-input" placeholder="Ask AI..." />
        <button class="scaffold-btn scaffold-ai-submit" data-testid="ai-submit" title="Submit">&#9166;</button>
        <button class="scaffold-btn scaffold-ai-history-btn" title="History">&#9201;</button>
      </div>
      <div class="scaffold-ai-status" data-testid="ai-status"></div>
      <div class="scaffold-ai-history"></div>
    `;
    shadow.appendChild(aiBar);

    aiInput = aiBar.querySelector(".scaffold-ai-input");
    aiStatus = aiBar.querySelector(".scaffold-ai-status");
    aiHistoryBtn = aiBar.querySelector(".scaffold-ai-history-btn");
    aiHistoryMenu = aiBar.querySelector(".scaffold-ai-history");

    aiBar.querySelector(".scaffold-ai-submit").addEventListener("click", () => {
      if (aiInput.value.trim()) submitAIEdit(aiInput.value.trim());
    });

    aiInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (aiInput.value.trim()) submitAIEdit(aiInput.value.trim());
      }
    });

    aiHistoryBtn.addEventListener("click", () => {
      aiHistoryMenu.classList.toggle("visible");
      if (aiHistoryMenu.classList.contains("visible")) {
        renderPromptHistory();
      }
    });
  }

  // ─── Toast ────────────────────────────────────────────────────────────────────

  const toast = document.createElement("div");
  toast.className = "scaffold-toast";
  shadow.appendChild(toast);

  let toastTimer = null;
  function showToast(message, type = "") {
    toast.textContent = message;
    toast.className = "scaffold-toast visible" + (type ? " " + type : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.className = "scaffold-toast";
    }, 2000);
  }

  // ─── Tooltip ──────────────────────────────────────────────────────────────────

  const tooltip = document.createElement("div");
  tooltip.className = "scaffold-tooltip";
  tooltip.style.display = "none";
  shadow.appendChild(tooltip);

  function showTooltip(el) {
    const tag = el.tagName.toLowerCase();
    const classes = [...el.classList]
      .filter((c) => !c.startsWith("data-scaffold"))
      .slice(0, 3)
      .map((c) => "." + c)
      .join("");
    tooltip.textContent = tag + classes;
    tooltip.style.display = "block";
    positionTooltip(el);
  }

  function positionTooltip(el) {
    const rect = el.getBoundingClientRect();
    tooltip.style.left = rect.left + "px";
    tooltip.style.top = Math.max(0, rect.top - 28) + "px";
  }

  function hideTooltip() {
    tooltip.style.display = "none";
  }

  // ─── Draggable Toolbar ────────────────────────────────────────────────────────

  let dragging = false;
  let dragOffset = { x: 0, y: 0 };

  toolbar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".scaffold-btn")) return;
    dragging = true;
    toolbar.classList.add("dragging");
    const rect = toolbar.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const x = window.innerWidth - e.clientX - (toolbar.offsetWidth - dragOffset.x);
    const y = window.innerHeight - e.clientY - (toolbar.offsetHeight - dragOffset.y);
    const inset = 2;
    toolbar.style.right = Math.min(window.innerWidth - toolbar.offsetWidth - inset, Math.max(inset, x)) + "px";
    toolbar.style.bottom = Math.min(window.innerHeight - toolbar.offsetHeight - inset, Math.max(inset, y)) + "px";
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    toolbar.classList.remove("dragging");
    localStorage.setItem(
      "scaffold-toolbar-pos",
      JSON.stringify({
        bottom: parseInt(toolbar.style.bottom),
        right: parseInt(toolbar.style.right),
      })
    );
  });

  // ─── Toolbar Actions ──────────────────────────────────────────────────────────

  const editBtn = toolbar.querySelector('[data-action="edit"]');
  const saveBtn = toolbar.querySelector('[data-action="save"]');
  const undoBtn = toolbar.querySelector('[data-action="undo"]');
  const viewersSpan = toolbar.querySelector("[data-viewers]");
  const newPageBtn = toolbar.querySelector('[data-action="new-page"]');
  const componentsBtn = toolbar.querySelector('[data-action="components"]');
  const extractBtn = toolbar.querySelector('[data-action="extract"]');

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "edit") toggleEditMode();
    else if (action === "save") save();
    else if (action === "undo") undo();
    else if (action === "new-page") openNewPageModal();
    else if (action === "components") toggleComponentPalette();
    else if (action === "extract") openExtractModal();
  });

  // ─── Edit Mode ────────────────────────────────────────────────────────────────

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "SVG", "TEMPLATE", "SCAFFOLD-EDITOR",
    "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "CANVAS",
  ]);

  function isValidTarget(el) {
    if (!el || !el.tagName) return false;
    if (el === document.documentElement || el === document.body) return false;
    if (SKIP_TAGS.has(el.tagName)) return false;
    if (el.closest("scaffold-editor")) return false;
    return true;
  }

  function toggleEditMode() {
    if (editMode) {
      exitEditMode();
    } else {
      enterEditMode();
    }
  }

  function enterEditMode() {
    editMode = true;
    editBtn.classList.add("active");
    editBtn.querySelector(".icon").innerHTML = "&#9998;";
    saveBtn.style.display = "";
    undoBtn.style.display = "";

    if (AI_ENABLED) {
      if (newPageBtn) newPageBtn.style.display = "";
      if (componentsBtn) componentsBtn.style.display = "";
      if (aiBar) aiBar.style.display = "";
    }

    // Pause Alpine on all [x-data] elements
    document.querySelectorAll("[x-data]").forEach((el) => {
      if (!el.hasAttribute("x-ignore")) {
        el.setAttribute("x-ignore", "");
        el.setAttribute("data-scaffold-paused", "");
      }
    });

    // Walk DOM to find editable text elements
    makeEditable(document.body);

    // Enable selection, hover, and drag reorder
    document.addEventListener("click", onElementClick, true);
    document.addEventListener("mouseover", onElementHover, true);
    document.addEventListener("mousedown", onDragMouseDown, true);
    document.addEventListener("mousemove", onDragMouseMove, true);
    document.addEventListener("mouseup", onDragMouseUp, true);

    showToast("Edit mode ON");
  }

  function exitEditMode() {
    editMode = false;
    editBtn.classList.remove("active");
    saveBtn.style.display = "none";
    undoBtn.style.display = "none";

    if (AI_ENABLED) {
      if (newPageBtn) newPageBtn.style.display = "none";
      if (componentsBtn) componentsBtn.style.display = "none";
      if (extractBtn) extractBtn.style.display = "none";
      if (aiBar) aiBar.style.display = "none";
      closeComponentPalette();
      exitInsertionMode();
    }

    deselectElement();

    // Remove contenteditable from all elements
    document.querySelectorAll("[data-scaffold-editable]").forEach((el) => {
      el.removeAttribute("contenteditable");
      el.removeAttribute("data-scaffold-editable");
    });

    // Remove Alpine pause
    document.querySelectorAll("[data-scaffold-paused]").forEach((el) => {
      el.removeAttribute("x-ignore");
      el.removeAttribute("data-scaffold-paused");
    });

    document.removeEventListener("click", onElementClick, true);
    document.removeEventListener("mouseover", onElementHover, true);
    document.removeEventListener("mousedown", onDragMouseDown, true);
    document.removeEventListener("mousemove", onDragMouseMove, true);
    document.removeEventListener("mouseup", onDragMouseUp, true);
    cleanupDrag();
    clearHover();

    // Reload page to re-init Alpine
    location.reload();
  }

  function makeEditable(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
        if (node.tagName === "SCAFFOLD-EDITOR") return NodeFilter.FILTER_REJECT;
        if (node.hasAttribute("x-for") || node.hasAttribute("x-if")) return NodeFilter.FILTER_REJECT;
        if (node.closest("template")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    while (walker.nextNode()) {
      const el = walker.currentNode;
      // Only make editable if it has direct text content
      const hasDirectText = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
      );
      if (hasDirectText && !el.hasAttribute("data-scaffold-editable")) {
        el.setAttribute("contenteditable", "true");
        el.setAttribute("data-scaffold-editable", "");
      }
    }
  }

  // ─── Element Selection ────────────────────────────────────────────────────────

  function onElementClick(e) {
    if (!editMode) return;
    if (suppressNextClick) { suppressNextClick = false; return; }
    if (insertionMode) return; // handled by insertion click handler

    // Don't interfere with toolbar clicks
    const path = e.composedPath();
    if (path.includes(host)) return;

    e.preventDefault();
    e.stopPropagation();

    const el = e.target;
    if (!isValidTarget(el)) return;

    selectElement(el);
  }

  function selectElement(el) {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    clearHover();
    deselectElement();
    selectedElement = el;
    el.setAttribute("data-scaffold-selected", "");
    showTooltip(el);

    // Update AI prompt placeholder
    if (AI_ENABLED && aiInput) {
      const tag = el.tagName.toLowerCase();
      const cls = [...el.classList]
        .filter((c) => !c.startsWith("data-scaffold"))
        .slice(0, 2)
        .map((c) => "." + c)
        .join("");
      aiInput.placeholder = "Edit " + tag + cls + "...";
    }

    // Show extract button when element selected
    if (AI_ENABLED && extractBtn) {
      extractBtn.style.display = "";
    }
  }

  function deselectElement() {
    if (selectedElement) {
      selectedElement.removeAttribute("data-scaffold-selected");
      selectedElement = null;
    }
    hideTooltip();

    if (AI_ENABLED && aiInput) {
      aiInput.placeholder = "Ask AI...";
    }
    if (AI_ENABLED && extractBtn) {
      extractBtn.style.display = "none";
    }
  }

  // ─── Hover Indicator ────────────────────────────────────────────────────────

  function clearHover() {
    if (hoveredElement) {
      hoveredElement.removeAttribute("data-scaffold-hovered");
      hoveredElement = null;
    }
  }

  function onElementHover(e) {
    if (!editMode) return;
    if (elementDragging) return;
    if (insertionMode) return;

    const path = e.composedPath();
    if (path.includes(host)) return;

    const el = e.target;
    if (!isValidTarget(el)) { clearHover(); return; }
    if (el === selectedElement) { clearHover(); return; }
    if (el === hoveredElement) return;

    clearHover();
    hoveredElement = el;
    el.setAttribute("data-scaffold-hovered", "");
  }

  // ─── Drag Reorder ──────────────────────────────────────────────────────────

  function onDragMouseDown(e) {
    if (!editMode || insertionMode || elementDragging) return;
    if (!selectedElement) return;
    // Don't drag when user is editing text inside the element
    if (document.activeElement === selectedElement && selectedElement.isContentEditable) return;
    // Only start drag if mousedown is on or inside the selected element
    if (!selectedElement.contains(e.target)) return;
    // Must have siblings to reorder among
    const parent = selectedElement.parentElement;
    if (!parent || parent.children.length < 2) return;

    dragMouseDown = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  }

  function onDragMouseMove(e) {
    if (!dragMouseDown) return;

    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    if (!elementDragging) {
      // 5px threshold to distinguish click from drag
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      elementDragging = true;
      selectedElement.setAttribute("data-scaffold-dragging", "");
      hideTooltip();

      dragIndicator = document.createElement("div");
      dragIndicator.className = "scaffold-insertion-indicator";
      dragIndicator.style.display = "none";
      document.body.appendChild(dragIndicator);
    }

    updateDragIndicator(e.clientX, e.clientY);
  }

  function updateDragIndicator(clientX, clientY) {
    if (!selectedElement || !dragIndicator) return;
    const parent = selectedElement.parentElement;
    if (!parent) return;

    let closestDist = Infinity;
    dragTarget = null;
    dragBefore = true;

    for (const child of parent.children) {
      if (child === selectedElement) continue;
      const rect = child.getBoundingClientRect();
      // Distance to top edge
      const distTop = Math.abs(clientY - rect.top);
      if (distTop < closestDist) {
        closestDist = distTop;
        dragTarget = child;
        dragBefore = true;
      }
      // Distance to bottom edge
      const distBot = Math.abs(clientY - rect.bottom);
      if (distBot < closestDist) {
        closestDist = distBot;
        dragTarget = child;
        dragBefore = false;
      }
    }

    if (dragTarget) {
      const rect = dragTarget.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      dragIndicator.style.display = "block";
      dragIndicator.style.position = "absolute";
      dragIndicator.style.left = parentRect.left + "px";
      dragIndicator.style.width = parentRect.width + "px";
      dragIndicator.style.top = (dragBefore ? rect.top : rect.bottom) + window.scrollY + "px";
    } else {
      dragIndicator.style.display = "none";
    }
  }

  function onDragMouseUp(e) {
    if (!dragMouseDown) return;

    if (elementDragging && selectedElement && dragTarget) {
      const parent = selectedElement.parentElement;
      if (parent) {
        if (dragBefore) {
          parent.insertBefore(selectedElement, dragTarget);
        } else {
          parent.insertBefore(selectedElement, dragTarget.nextSibling);
        }
        showToast("Reordered");
      }
      suppressNextClick = true;
    }

    cleanupDrag();
  }

  function cleanupDrag() {
    if (selectedElement) {
      selectedElement.removeAttribute("data-scaffold-dragging");
    }
    if (dragIndicator) {
      dragIndicator.remove();
      dragIndicator = null;
    }
    elementDragging = false;
    dragMouseDown = false;
    dragStartX = 0;
    dragStartY = 0;
    dragTarget = null;
    dragBefore = true;
    if (selectedElement) {
      showTooltip(selectedElement);
    }
  }

  // ─── Selection Traversal ────────────────────────────────────────────────────

  function selectParent() {
    if (!selectedElement) return;
    let parent = selectedElement.parentElement;
    while (parent) {
      if (isValidTarget(parent)) {
        selectElement(parent);
        return;
      }
      parent = parent.parentElement;
    }
  }

  function selectSibling(direction) {
    if (!selectedElement) return;
    const prop = direction === "next" ? "nextElementSibling" : "previousElementSibling";
    let sibling = selectedElement[prop];
    while (sibling) {
      if (isValidTarget(sibling)) {
        selectElement(sibling);
        return;
      }
      sibling = sibling[prop];
    }
  }

  function selectFirstChild() {
    if (!selectedElement) return;
    let child = selectedElement.firstElementChild;
    while (child) {
      if (isValidTarget(child)) {
        selectElement(child);
        return;
      }
      child = child.nextElementSibling;
    }
  }

  // ─── XPath Computation ──────────────────────────────────────────────────────

  function computeXPath(el) {
    const parts = [];
    let current = el;
    while (current && current !== document.body && current.tagName) {
      const tag = current.tagName.toLowerCase();

      // If element has an id, use it as a shortcut — IDs are unique,
      // so no need to walk further up the tree
      const id = current.getAttribute("id");
      if (id && !id.startsWith("scaffold-")) {
        parts.unshift(tag + "#" + id);
        break;
      }

      const classes = [...current.classList]
        .filter((c) => !c.startsWith("data-scaffold"))
        .slice(0, 3);

      // Count nth-child position among same-tag siblings
      let nth = 1;
      let sib = current.previousElementSibling;
      while (sib) {
        if (sib.tagName === current.tagName) nth++;
        sib = sib.previousElementSibling;
      }

      let selector = tag;
      if (classes.length > 0) {
        selector += "." + classes.join(".");
      }
      // Add nth-child if there are multiple same-tag siblings
      let totalSameTag = nth;
      sib = current.nextElementSibling;
      while (sib) {
        if (sib.tagName === current.tagName) totalSameTag++;
        sib = sib.nextElementSibling;
      }
      if (totalSameTag > 1) {
        selector += ":nth-child(" + nth + ")";
      }

      parts.unshift(selector);
      current = current.parentElement;
    }
    if (parts.length === 0 || (parts[0] !== "body" && !parts[0].includes("#"))) {
      parts.unshift("body");
    }
    return parts.join(" > ");
  }

  // ─── AI Edit Submission ─────────────────────────────────────────────────────

  async function submitAIEdit(prompt) {
    if (aiWorking) return;
    aiWorking = true;
    aiInput.disabled = true;
    aiStatus.textContent = "Thinking...";
    aiStatus.style.display = "block";

    // Save to history
    savePromptHistory(prompt);

    const body = { page: PAGE, prompt };

    if (selectedElement) {
      body.selection = {
        xpath: computeXPath(selectedElement),
        html: selectedElement.outerHTML,
      };
    }

    try {
      const res = await fetch("/_/ai/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      let clientSwapHtml = null;
      await readSSEStream(res, (event, data) => {
        if (event === "status" && data.message) {
          aiStatus.textContent = data.message;
        }
        if (event === "done") {
          if (data.html) {
            clientSwapHtml = data.html;
            aiStatus.textContent = "Applying...";
          } else {
            aiStatus.textContent = "Done! Reloading...";
            // Full-page edit: page will reload via WS broadcast
          }
        }
        if (event === "error") {
          aiStatus.textContent = "Error: " + (data.message || "Unknown error");
        }
      });

      // Scoped edit: swap element client-side and save
      if (clientSwapHtml && selectedElement) {
        const temp = document.createElement("div");
        temp.innerHTML = clientSwapHtml;
        const newEl = temp.firstElementChild;
        if (newEl) {
          selectedElement.replaceWith(newEl);
          deselectElement();
        }
        aiStatus.textContent = "Saving...";
        await save();
        aiStatus.textContent = "Done!";
      }
    } catch (err) {
      aiStatus.textContent = "Error: " + err.message;
    } finally {
      aiWorking = false;
      aiInput.disabled = false;
      aiInput.value = "";
    }
  }

  // ─── SSE Stream Reader ──────────────────────────────────────────────────────

  async function readSSEStream(response, callback) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const parts = buf.split("\n\n");
      buf = parts.pop() || "";

      for (const part of parts) {
        let event = "message";
        let data = null;
        for (const line of part.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) {
            try { data = JSON.parse(line.slice(6)); } catch {}
          }
        }
        if (data) callback(event, data);
      }
    }
  }

  // ─── Prompt History ─────────────────────────────────────────────────────────

  function getPromptHistory() {
    try {
      return JSON.parse(localStorage.getItem("scaffold-ai-history-" + PAGE) || "[]");
    } catch { return []; }
  }

  function savePromptHistory(prompt) {
    const history = getPromptHistory();
    // Remove duplicate if exists
    const idx = history.indexOf(prompt);
    if (idx !== -1) history.splice(idx, 1);
    history.unshift(prompt);
    // Keep last 10
    if (history.length > 10) history.length = 10;
    localStorage.setItem("scaffold-ai-history-" + PAGE, JSON.stringify(history));
  }

  function renderPromptHistory() {
    if (!aiHistoryMenu) return;
    const history = getPromptHistory();
    if (history.length === 0) {
      aiHistoryMenu.innerHTML = '<div class="scaffold-ai-history-empty">No history yet</div>';
      return;
    }
    aiHistoryMenu.innerHTML = history
      .map((h) => '<div class="scaffold-ai-history-item">' + escapeHtml(h) + "</div>")
      .join("");

    aiHistoryMenu.querySelectorAll(".scaffold-ai-history-item").forEach((item, i) => {
      item.addEventListener("click", () => {
        aiInput.value = history[i];
        aiHistoryMenu.classList.remove("visible");
        aiInput.focus();
      });
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ─── New Page Modal ─────────────────────────────────────────────────────────

  let newPageModal = null;

  function openNewPageModal() {
    if (newPageModal) { closeNewPageModal(); return; }

    newPageModal = document.createElement("div");
    newPageModal.className = "scaffold-modal-overlay";

    const baseOptions = ALL_PAGES
      .map((p) => '<option value="' + p + '">' + p + "</option>")
      .join("");

    newPageModal.innerHTML = `
      <div class="scaffold-modal">
        <div class="scaffold-modal-header">
          <span>Create New Prototype</span>
          <button class="scaffold-btn scaffold-modal-close">&times;</button>
        </div>
        <div class="scaffold-modal-body">
          <div class="scaffold-form-group">
            <label>Page name</label>
            <input type="text" class="scaffold-ai-input" id="scaffold-new-name" data-testid="new-page-name" placeholder="my-new-page" />
          </div>
          <div class="scaffold-form-group">
            <label>Description</label>
            <textarea class="scaffold-ai-input scaffold-textarea" id="scaffold-new-desc" data-testid="new-page-desc" rows="4" placeholder="Describe the page..."></textarea>
          </div>
          <div class="scaffold-form-group">
            <label>Use existing page as starting point</label>
            <select class="scaffold-ai-input" id="scaffold-new-base" data-testid="new-page-base">
              <option value="">None</option>
              <option value="${PAGE}" selected>${PAGE} (current)</option>
              ${baseOptions}
            </select>
          </div>
          <button class="scaffold-btn scaffold-ai-generate-btn" id="scaffold-new-go" data-testid="new-page-go">Generate with AI</button>
          <div class="scaffold-ai-status" id="scaffold-new-status" data-testid="new-page-status"></div>
        </div>
      </div>
    `;
    shadow.appendChild(newPageModal);

    newPageModal.querySelector(".scaffold-modal-close").addEventListener("click", closeNewPageModal);
    newPageModal.querySelector("#scaffold-new-go").addEventListener("click", submitNewPage);
    newPageModal.querySelector(".scaffold-modal-overlay")?.addEventListener("click", (e) => {
      if (e.target === newPageModal) closeNewPageModal();
    });
    newPageModal.addEventListener("click", (e) => {
      if (e.target === newPageModal) closeNewPageModal();
    });
  }

  function closeNewPageModal() {
    if (newPageModal) {
      newPageModal.remove();
      newPageModal = null;
    }
  }

  async function submitNewPage() {
    const name = shadow.getElementById("scaffold-new-name").value.trim();
    const desc = shadow.getElementById("scaffold-new-desc").value.trim();
    const base = shadow.getElementById("scaffold-new-base").value;
    const status = shadow.getElementById("scaffold-new-status");
    const btn = shadow.getElementById("scaffold-new-go");

    if (!name || !desc) {
      status.textContent = "Name and description required";
      status.style.display = "block";
      return;
    }

    btn.disabled = true;
    status.textContent = "Generating...";
    status.style.display = "block";

    try {
      const res = await fetch("/_/ai/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: name, prompt: desc, basePage: base || undefined }),
      });

      await readSSEStream(res, (event, data) => {
        if (event === "status" && data.message) {
          status.textContent = data.message;
        }
        if (event === "done" && data.url) {
          status.textContent = "Done! Navigating...";
          setTimeout(() => { window.location.href = data.url; }, 500);
        }
        if (event === "error") {
          status.textContent = "Error: " + (data.message || "Unknown");
          btn.disabled = false;
        }
      });
    } catch (err) {
      status.textContent = "Error: " + err.message;
      btn.disabled = false;
    }
  }

  // ─── Component Palette ──────────────────────────────────────────────────────

  let componentPalette = null;

  function toggleComponentPalette() {
    if (componentPaletteOpen) {
      closeComponentPalette();
    } else {
      openComponentPalette();
    }
  }

  async function openComponentPalette() {
    if (componentPalette) return;
    componentPaletteOpen = true;
    if (componentsBtn) componentsBtn.classList.add("active");

    componentPalette = document.createElement("div");
    componentPalette.className = "scaffold-component-palette";
    componentPalette.innerHTML = `
      <div class="scaffold-palette-header">
        <span>Components</span>
        <button class="scaffold-btn scaffold-palette-close">&times;</button>
      </div>
      <div class="scaffold-palette-search">
        <input type="text" class="scaffold-ai-input" placeholder="Search components..." />
      </div>
      <div class="scaffold-palette-list">
        <div class="scaffold-ai-status">Loading...</div>
      </div>
      <div class="scaffold-palette-generate">
        <div class="scaffold-form-group">
          <label>Generate Component</label>
          <input type="text" class="scaffold-ai-input" id="scaffold-comp-name" placeholder="Component name" />
        </div>
        <div class="scaffold-form-group">
          <textarea class="scaffold-ai-input scaffold-textarea" id="scaffold-comp-desc" rows="2" placeholder="Describe the component..."></textarea>
        </div>
        <div class="scaffold-form-group">
          <input type="text" class="scaffold-ai-input" id="scaffold-comp-cat" placeholder="Category (e.g. data-display)" />
        </div>
        <button class="scaffold-btn scaffold-ai-generate-btn" id="scaffold-comp-go">Generate</button>
        <div class="scaffold-ai-status" id="scaffold-comp-status"></div>
      </div>
    `;
    shadow.appendChild(componentPalette);

    componentPalette.querySelector(".scaffold-palette-close").addEventListener("click", closeComponentPalette);
    componentPalette.querySelector("#scaffold-comp-go").addEventListener("click", generateComponent);

    // Search filter
    const searchInput = componentPalette.querySelector(".scaffold-palette-search input");
    searchInput.addEventListener("input", () => filterComponents(searchInput.value));

    // Load components
    await loadComponents();
  }

  function closeComponentPalette() {
    if (componentPalette) {
      componentPalette.remove();
      componentPalette = null;
    }
    componentPaletteOpen = false;
    if (componentsBtn) componentsBtn.classList.remove("active");
    exitInsertionMode();
  }

  let cachedComponents = [];

  async function loadComponents() {
    try {
      const res = await fetch("/_/ai/components");
      const data = await res.json();
      cachedComponents = data.components || [];
      renderComponents(cachedComponents);
    } catch (err) {
      const list = componentPalette?.querySelector(".scaffold-palette-list");
      if (list) list.innerHTML = '<div class="scaffold-ai-status">No components found</div>';
    }
  }

  function renderComponents(components) {
    const list = componentPalette?.querySelector(".scaffold-palette-list");
    if (!list) return;

    if (components.length === 0) {
      list.innerHTML = '<div class="scaffold-palette-empty">No components yet. Generate one below!</div>';
      return;
    }

    // Group by category
    const groups = {};
    for (const c of components) {
      (groups[c.category] = groups[c.category] || []).push(c);
    }

    let html = "";
    for (const [cat, items] of Object.entries(groups)) {
      html += '<div class="scaffold-palette-category">' + escapeHtml(cat) + "</div>";
      html += '<div class="scaffold-palette-grid">';
      for (const item of items) {
        html += `<div class="scaffold-component-card" data-path="${escapeHtml(item.path)}" data-category="${escapeHtml(item.category)}" data-name="${escapeHtml(item.name)}">
          <div class="scaffold-component-name">${escapeHtml(item.name)}</div>
          <div class="scaffold-component-desc">${escapeHtml(item.description)}</div>
        </div>`;
      }
      html += "</div>";
    }
    list.innerHTML = html;

    // Click handlers
    list.querySelectorAll(".scaffold-component-card").forEach((card) => {
      card.addEventListener("click", async () => {
        const cat = card.dataset.category;
        const name = card.dataset.name;
        try {
          const res = await fetch(`/_/ai/components/${cat}/${name}`);
          const data = await res.json();
          if (data.html) {
            enterInsertionMode(data.html);
            showToast("Click to insert. ESC to cancel.");
          }
        } catch (err) {
          showToast("Failed to load component", "error");
        }
      });
    });
  }

  function filterComponents(query) {
    const q = query.toLowerCase();
    const filtered = q
      ? cachedComponents.filter(
          (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)
        )
      : cachedComponents;
    renderComponents(filtered);
  }

  async function generateComponent() {
    const name = shadow.getElementById("scaffold-comp-name").value.trim();
    const desc = shadow.getElementById("scaffold-comp-desc").value.trim();
    const cat = shadow.getElementById("scaffold-comp-cat").value.trim() || "uncategorized";
    const status = shadow.getElementById("scaffold-comp-status");
    const btn = shadow.getElementById("scaffold-comp-go");

    if (!name || !desc) {
      status.textContent = "Name and description required";
      status.style.display = "block";
      return;
    }

    btn.disabled = true;
    status.textContent = "Generating...";
    status.style.display = "block";

    try {
      const res = await fetch("/_/ai/components/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, prompt: desc, category: cat }),
      });

      await readSSEStream(res, (event, data) => {
        if (event === "status" && data.message) status.textContent = data.message;
        if (event === "done") {
          status.textContent = "Component created!";
          loadComponents();
          shadow.getElementById("scaffold-comp-name").value = "";
          shadow.getElementById("scaffold-comp-desc").value = "";
        }
        if (event === "error") status.textContent = "Error: " + (data.message || "Unknown");
      });
    } catch (err) {
      status.textContent = "Error: " + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ─── Insertion Mode ─────────────────────────────────────────────────────────

  let insertionIndicator = null;

  function enterInsertionMode(html) {
    insertionMode = true;
    insertionHtml = html;
    clearHover();

    insertionIndicator = document.createElement("div");
    insertionIndicator.className = "scaffold-insertion-indicator";
    insertionIndicator.style.display = "none";
    document.body.appendChild(insertionIndicator);

    document.addEventListener("mousemove", onInsertionMouseMove, true);
    document.addEventListener("click", onInsertionClick, true);
  }

  function exitInsertionMode() {
    insertionMode = false;
    insertionHtml = null;
    if (insertionIndicator) {
      insertionIndicator.remove();
      insertionIndicator = null;
    }
    document.removeEventListener("mousemove", onInsertionMouseMove, true);
    document.removeEventListener("click", onInsertionClick, true);
  }

  function onInsertionMouseMove(e) {
    if (!insertionMode || !insertionIndicator) return;
    const path = e.composedPath();
    if (path.includes(host)) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || SKIP_TAGS.has(el.tagName) || el.closest("scaffold-editor")) {
      insertionIndicator.style.display = "none";
      return;
    }

    const rect = el.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const before = e.clientY < midY;

    insertionIndicator.style.display = "block";
    insertionIndicator.style.position = "absolute";
    insertionIndicator.style.left = rect.left + "px";
    insertionIndicator.style.width = rect.width + "px";
    insertionIndicator.style.top = (before ? rect.top : rect.bottom) + window.scrollY + "px";
    insertionIndicator._target = el;
    insertionIndicator._before = before;
  }

  function onInsertionClick(e) {
    if (!insertionMode || !insertionHtml) return;
    const path = e.composedPath();
    if (path.includes(host)) return;

    e.preventDefault();
    e.stopPropagation();

    const target = insertionIndicator?._target;
    const before = insertionIndicator?._before;
    if (!target) return;

    // Create a temporary container to parse the HTML
    const tmp = document.createElement("div");
    tmp.innerHTML = insertionHtml;

    const frag = document.createDocumentFragment();
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);

    if (before) {
      target.parentNode.insertBefore(frag, target);
    } else {
      target.parentNode.insertBefore(frag, target.nextSibling);
    }

    showToast("Component inserted");
    exitInsertionMode();
  }

  // ─── Extract Component ──────────────────────────────────────────────────────

  let extractModal = null;

  function openExtractModal() {
    if (!selectedElement || extractModal) return;

    const html = selectedElement.outerHTML;
    const tag = selectedElement.tagName.toLowerCase();
    const cls = [...selectedElement.classList].filter((c) => !c.startsWith("data-scaffold")).slice(0, 2);
    const suggestedName = cls.length > 0 ? cls[0] : tag;

    extractModal = document.createElement("div");
    extractModal.className = "scaffold-modal-overlay";
    extractModal.innerHTML = `
      <div class="scaffold-modal">
        <div class="scaffold-modal-header">
          <span>Extract Component</span>
          <button class="scaffold-btn scaffold-modal-close">&times;</button>
        </div>
        <div class="scaffold-modal-body">
          <div class="scaffold-form-group">
            <label>Component name</label>
            <input type="text" class="scaffold-ai-input" id="scaffold-extract-name" data-testid="extract-name" value="${escapeHtml(suggestedName)}" />
          </div>
          <div class="scaffold-form-group">
            <label>Category</label>
            <input type="text" class="scaffold-ai-input" id="scaffold-extract-cat" data-testid="extract-cat" placeholder="e.g. data-display, forms, layout" />
          </div>
          <div class="scaffold-extract-preview"><code>${escapeHtml(html.slice(0, 200))}${html.length > 200 ? "..." : ""}</code></div>
          <button class="scaffold-btn scaffold-ai-generate-btn" id="scaffold-extract-go" data-testid="extract-go">Extract</button>
          <div class="scaffold-ai-status" id="scaffold-extract-status" data-testid="extract-status"></div>
        </div>
      </div>
    `;
    shadow.appendChild(extractModal);

    extractModal.querySelector(".scaffold-modal-close").addEventListener("click", closeExtractModal);
    extractModal.querySelector("#scaffold-extract-go").addEventListener("click", () => submitExtract(html));
    extractModal.addEventListener("click", (e) => {
      if (e.target === extractModal) closeExtractModal();
    });
  }

  function closeExtractModal() {
    if (extractModal) {
      extractModal.remove();
      extractModal = null;
    }
  }

  async function submitExtract(html) {
    const name = shadow.getElementById("scaffold-extract-name").value.trim();
    const cat = shadow.getElementById("scaffold-extract-cat").value.trim() || "uncategorized";
    const status = shadow.getElementById("scaffold-extract-status");
    const btn = shadow.getElementById("scaffold-extract-go");

    if (!name) {
      status.textContent = "Name required";
      status.style.display = "block";
      return;
    }

    btn.disabled = true;
    status.textContent = "Extracting with AI...";
    status.style.display = "block";

    try {
      const res = await fetch("/_/ai/components/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, suggestedName: name, category: cat }),
      });

      const data = await res.json();
      status.textContent = "Component saved to " + data.path;
      showToast("Component extracted!", "success");

      // Refresh palette if open
      if (componentPalette) loadComponents();
    } catch (err) {
      status.textContent = "Error: " + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ─── Save ─────────────────────────────────────────────────────────────────────

  async function save() {
    try {
      const clone = document.documentElement.cloneNode(true);

      // Strip scaffold artifacts from clone
      const editorEl = clone.querySelector("scaffold-editor");
      if (editorEl) editorEl.remove();

      // Remove injected scaffold scripts/styles
      clone.querySelectorAll('script[src*="/_/assets/editor.js"]').forEach((s) => s.remove());
      clone.querySelectorAll('link[href*="/_/assets/editor.css"]').forEach((s) => s.remove());
      clone.querySelectorAll("script").forEach((s) => {
        if (s.textContent.includes("__SCAFFOLD__")) s.remove();
      });
      clone.querySelectorAll('style[data-scaffold-selection]').forEach((s) => s.remove());
      clone.querySelectorAll("link").forEach((l) => {
        if (l.href && l.href.includes("/_/assets/editor.css")) l.remove();
      });
      // Remove scaffold comment
      const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
      const commentsToRemove = [];
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.trim() === "Scaffold") {
          commentsToRemove.push(walker.currentNode);
        }
      }
      commentsToRemove.forEach((c) => c.remove());

      // Strip data-scaffold-* attributes
      clone.querySelectorAll("[data-scaffold-editable]").forEach((el) => {
        el.removeAttribute("contenteditable");
        el.removeAttribute("data-scaffold-editable");
      });
      clone.querySelectorAll("[data-scaffold-selected]").forEach((el) => {
        el.removeAttribute("data-scaffold-selected");
      });
      clone.querySelectorAll("[data-scaffold-hovered]").forEach((el) => {
        el.removeAttribute("data-scaffold-hovered");
      });
      clone.querySelectorAll("[data-scaffold-dragging]").forEach((el) => {
        el.removeAttribute("data-scaffold-dragging");
      });
      clone.querySelectorAll("[data-scaffold-paused]").forEach((el) => {
        el.removeAttribute("x-ignore");
        el.removeAttribute("data-scaffold-paused");
      });

      // Remove insertion indicator if present
      clone.querySelectorAll(".scaffold-insertion-indicator").forEach((el) => el.remove());

      const html = "<!DOCTYPE html>\n" + clone.outerHTML;

      const res = await fetch(`/_/save/${PAGE}`, {
        method: "POST",
        headers: { "Content-Type": "text/html" },
        body: html,
      });

      if (res.ok) {
        showToast("Saved", "success");
      } else {
        showToast("Save failed", "error");
      }
    } catch (err) {
      showToast("Save failed: " + err.message, "error");
    }
  }

  // ─── Undo ─────────────────────────────────────────────────────────────────────

  function undo() {
    if (editMode) {
      exitEditMode(); // cleans up contenteditable/x-ignore, then reloads
    } else {
      location.reload();
    }
  }

  // ─── Keyboard Shortcuts ───────────────────────────────────────────────────────

  document.addEventListener("keydown", (e) => {
    const isMod = e.metaKey || e.ctrlKey;

    // Cmd+K — Focus AI input
    if (AI_ENABLED && isMod && e.key === "k") {
      e.preventDefault();
      if (!editMode) enterEditMode();
      if (aiInput) aiInput.focus();
      return;
    }

    // Cmd+S — Save
    if (isMod && e.key === "s") {
      e.preventDefault();
      if (editMode) save();
      return;
    }

    // Escape — cancel insertion, deselect, close modals, or exit edit mode
    if (e.key === "Escape") {
      if (elementDragging) {
        cleanupDrag();
        showToast("Drag cancelled");
        return;
      }
      if (insertionMode) {
        exitInsertionMode();
        showToast("Insertion cancelled");
        return;
      }
      if (newPageModal) { closeNewPageModal(); return; }
      if (extractModal) { closeExtractModal(); return; }
      if (selectedElement) {
        deselectElement();
      } else if (editMode) {
        exitEditMode();
      }
      return;
    }

    if (!editMode || !selectedElement) return;

    // Alt+Arrow — selection traversal
    const isAltOnly = e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
    if (isAltOnly && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      if (e.key === "ArrowUp") selectParent();
      else if (e.key === "ArrowDown") selectFirstChild();
      else if (e.key === "ArrowLeft") selectSibling("prev");
      else if (e.key === "ArrowRight") selectSibling("next");
      return;
    }

    // Delete — remove selected element
    if (e.key === "Delete" || e.key === "Backspace") {
      // Don't delete when typing in any input/textarea/contenteditable
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      if (document.activeElement === selectedElement && selectedElement.isContentEditable) return;
      e.preventDefault();
      const el = selectedElement;
      deselectElement();
      el.remove();
      showToast("Element removed");
      return;
    }

    // Ctrl+D — duplicate
    if (isMod && e.key === "d") {
      e.preventDefault();
      const clone = selectedElement.cloneNode(true);
      clone.removeAttribute("data-scaffold-selected");
      selectedElement.parentNode.insertBefore(clone, selectedElement.nextSibling);
      selectElement(clone);
      showToast("Duplicated");
      return;
    }

    // Ctrl+ArrowUp — move up among siblings
    if (isMod && e.key === "ArrowUp") {
      e.preventDefault();
      const prev = selectedElement.previousElementSibling;
      if (prev) {
        selectedElement.parentNode.insertBefore(selectedElement, prev);
        positionTooltip(selectedElement);
        showToast("Moved up");
      }
      return;
    }

    // Ctrl+ArrowDown — move down among siblings
    if (isMod && e.key === "ArrowDown") {
      e.preventDefault();
      const next = selectedElement.nextElementSibling;
      if (next) {
        selectedElement.parentNode.insertBefore(next, selectedElement);
        positionTooltip(selectedElement);
        showToast("Moved down");
      }
      return;
    }
  });

  // ─── WebSocket ────────────────────────────────────────────────────────────────

  function connectWS() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    try {
      ws = new WebSocket(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", page: PAGE }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "reload" && msg.page === PAGE) {
          // Don't reload if AI is working or we're in edit mode (would lose edits)
          if (aiWorking) return;
          if (!editMode) {
            location.reload();
          } else {
            showToast("File changed (reload when done editing)");
          }
        }
        if (msg.type === "viewers") {
          viewerCount = msg.count;
          viewersSpan.textContent = viewerCount;
        }
      } catch {}
    };

    ws.onclose = () => {
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function scheduleReconnect() {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(connectWS, 2000);
  }

  connectWS();

  // ─── Cleanup on page unload ───────────────────────────────────────────────────

  window.addEventListener("beforeunload", () => {
    if (ws) {
      ws.send(JSON.stringify({ type: "leave", page: PAGE }));
      ws.close();
    }
  });
})();

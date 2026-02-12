(function () {
  "use strict";

  const CONFIG = window.__SCAFFOLD__;
  if (!CONFIG) return;

  const PAGE = CONFIG.page;
  const WS_URL = CONFIG.ws;

  // ─── State ────────────────────────────────────────────────────────────────────

  let editMode = false;
  let selectedElement = null;
  let viewerCount = 0;
  let ws = null;
  let wsReconnectTimer = null;

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
  `;
  document.head.appendChild(selectionStyle);

  // ─── Toolbar ──────────────────────────────────────────────────────────────────

  const toolbar = document.createElement("div");
  toolbar.className = "scaffold-toolbar";
  toolbar.innerHTML = `
    <button class="scaffold-btn" data-action="edit">
      <span class="icon">&#9998;</span> Edit
    </button>
    <button class="scaffold-btn" data-action="save" style="display:none">
      <span class="icon">&#128190;</span> Save
    </button>
    <button class="scaffold-btn" data-action="undo" style="display:none">
      <span class="icon">&#8634;</span> Undo
    </button>
    <div class="scaffold-divider"></div>
    <div class="scaffold-viewers">
      <span class="dot"></span>
      <span data-viewers>1</span>
    </div>
  `;
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
    toolbar.style.right = Math.max(0, x) + "px";
    toolbar.style.bottom = Math.max(0, y) + "px";
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

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "edit") toggleEditMode();
    else if (action === "save") save();
    else if (action === "undo") undo();
  });

  // ─── Edit Mode ────────────────────────────────────────────────────────────────

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "SVG", "TEMPLATE", "SCAFFOLD-EDITOR",
    "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "CANVAS",
  ]);

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

    // Pause Alpine on all [x-data] elements
    document.querySelectorAll("[x-data]").forEach((el) => {
      if (!el.hasAttribute("x-ignore")) {
        el.setAttribute("x-ignore", "");
        el.setAttribute("data-scaffold-paused", "");
      }
    });

    // Walk DOM to find editable text elements
    makeEditable(document.body);

    // Enable selection
    document.addEventListener("click", onElementClick, true);

    showToast("Edit mode ON");
  }

  function exitEditMode() {
    editMode = false;
    editBtn.classList.remove("active");
    saveBtn.style.display = "none";
    undoBtn.style.display = "none";

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

    // Don't interfere with toolbar clicks
    const path = e.composedPath();
    if (path.includes(host)) return;

    e.preventDefault();
    e.stopPropagation();

    const el = e.target;
    if (SKIP_TAGS.has(el.tagName)) return;

    selectElement(el);
  }

  function selectElement(el) {
    deselectElement();
    selectedElement = el;
    el.setAttribute("data-scaffold-selected", "");
    showTooltip(el);
  }

  function deselectElement() {
    if (selectedElement) {
      selectedElement.removeAttribute("data-scaffold-selected");
      selectedElement = null;
    }
    hideTooltip();
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
      clone.querySelectorAll("[data-scaffold-paused]").forEach((el) => {
        el.removeAttribute("x-ignore");
        el.removeAttribute("data-scaffold-paused");
      });

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
    // Reload from last saved version on disk
    location.reload();
  }

  // ─── Keyboard Shortcuts ───────────────────────────────────────────────────────

  document.addEventListener("keydown", (e) => {
    const isMod = e.metaKey || e.ctrlKey;

    // Cmd+S — Save
    if (isMod && e.key === "s") {
      e.preventDefault();
      if (editMode) save();
      return;
    }

    // Escape — deselect or exit edit mode
    if (e.key === "Escape") {
      if (selectedElement) {
        deselectElement();
      } else if (editMode) {
        exitEditMode();
      }
      return;
    }

    if (!editMode || !selectedElement) return;

    // Delete — remove selected element
    if (e.key === "Delete" || e.key === "Backspace") {
      // Only if not editing text inside the element
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
          // Don't reload if we're in edit mode (would lose edits)
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

(() => {
  function closestElement(target, selector) {
    return target instanceof Element ? target.closest(selector) : null;
  }

  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("nav-modal-open");
    if (modalId === "profile-modal") {
      loadProjectContexts(modal);
    }
  }

  function closeModal(modal) {
    modal.hidden = true;
    if (!document.querySelector(".nav-modal-backdrop:not([hidden])")) {
      document.body.classList.remove("nav-modal-open");
    }
  }

  function activateProfileTab(tabButton) {
    const modal = tabButton.closest(".nav-modal");
    if (!modal) return;

    const targetTab = tabButton.dataset.profileTab;
    modal.querySelectorAll("[data-profile-tab]").forEach((button) => {
      const active = button === tabButton;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });

    modal.querySelectorAll("[data-profile-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-profile-panel") !== targetTab;
    });
  }

  function setProjectPanelsLoading(modal) {
    modal.querySelectorAll("[data-profile-panel]").forEach((panel) => {
      panel.replaceChildren(makeStatus("Loading context..."));
    });
  }

  function setProjectPanelsError(modal, message) {
    modal.querySelectorAll("[data-profile-panel]").forEach((panel) => {
      panel.replaceChildren(makeStatus(message, "error"));
    });
  }

  function makeStatus(message, variant) {
    const status = document.createElement("div");
    status.className = `project-context-status${variant ? ` ${variant}` : ""}`;
    status.textContent = message;
    return status;
  }

  function renderProjectContexts(modal, projects) {
    const projectMap = new Map(projects.map((project) => [project.id, project]));
    modal.querySelectorAll("[data-profile-panel]").forEach((panel) => {
      const projectId = panel.getAttribute("data-profile-panel");
      const project = projectMap.get(projectId);
      if (!project) {
        panel.replaceChildren(makeStatus("No context file found.", "empty"));
        return;
      }
      panel.replaceChildren(makeProjectContextView(project));
    });
  }

  function makeProjectContextView(project) {
    const context = project.globalContext || {};
    const root = document.createElement("div");
    root.className = "project-context-view";

    const header = document.createElement("div");
    header.className = "project-context-header";
    const title = document.createElement("h3");
    title.textContent = project.name;
    const meta = document.createElement("p");
    meta.textContent = formatContextMeta(context);
    header.append(title, meta);
    root.append(header);

    if (!hasContextContent(context)) {
      root.append(makeStatus("No global context stored yet.", "empty"));
    } else {
      appendTextSection(root, "Summary", context.summary);
      appendListSection(root, "Facts", context.facts);
      appendListSection(root, "Preferences", context.preferences);
      appendListSection(root, "Constraints", context.constraints);
      appendListSection(root, "Open Questions", context.openQuestions);
    }

    const details = document.createElement("details");
    details.className = "project-context-raw";
    const summary = document.createElement("summary");
    summary.textContent = "Raw JSON";
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(context, null, 2);
    details.append(summary, pre);
    root.append(details);

    return root;
  }

  function appendTextSection(root, label, value) {
    if (!value || !String(value).trim()) return;
    const section = document.createElement("section");
    section.className = "project-context-section";
    const heading = document.createElement("h4");
    heading.textContent = label;
    const body = document.createElement("p");
    body.textContent = String(value).trim();
    section.append(heading, body);
    root.append(section);
  }

  function appendListSection(root, label, values) {
    if (!Array.isArray(values) || values.length === 0) return;
    const section = document.createElement("section");
    section.className = "project-context-section";
    const heading = document.createElement("h4");
    heading.textContent = label;
    const list = document.createElement("ul");
    values.forEach((value) => {
      if (!value || !String(value).trim()) return;
      const item = document.createElement("li");
      item.textContent = String(value).trim();
      list.append(item);
    });
    if (!list.children.length) return;
    section.append(heading, list);
    root.append(section);
  }

  function hasContextContent(context) {
    if (context.summary && String(context.summary).trim()) return true;
    return ["facts", "preferences", "constraints", "openQuestions"].some(
      (key) => Array.isArray(context[key]) && context[key].some((value) => String(value || "").trim())
    );
  }

  function formatContextMeta(context) {
    const updatedAt = context.updatedAt ? new Date(context.updatedAt) : null;
    if (!updatedAt || Number.isNaN(updatedAt.getTime())) return "Global context file";
    return `Updated ${updatedAt.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    })}`;
  }

  function loadProjectContexts(modal) {
    setProjectPanelsLoading(modal);
    fetch("/api/projects/global-contexts", {
      headers: { Accept: "application/json" }
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Context load failed: ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        renderProjectContexts(modal, Array.isArray(payload.projects) ? payload.projects : []);
      })
      .catch(() => {
        setProjectPanelsError(modal, "Context could not be loaded.");
      });
  }

  document.addEventListener("click", (event) => {
    const trigger = closestElement(event.target, "[data-modal-target]");
    if (trigger) {
      openModal(trigger.getAttribute("data-modal-target"));
      return;
    }

    const closeButton = closestElement(event.target, "[data-modal-close]");
    if (closeButton) {
      const modal = closeButton.closest(".nav-modal-backdrop");
      if (modal) closeModal(modal);
      return;
    }

    const tabButton = closestElement(event.target, "[data-profile-tab]");
    if (tabButton) {
      activateProfileTab(tabButton);
      return;
    }

    if (event.target?.classList?.contains("nav-modal-backdrop")) {
      closeModal(event.target);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openModals = Array.from(document.querySelectorAll(".nav-modal-backdrop:not([hidden])"));
    const topModal = openModals[openModals.length - 1];
    if (topModal) closeModal(topModal);
  });
})();

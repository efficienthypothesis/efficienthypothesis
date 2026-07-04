(() => {
  function closestElement(target, selector) {
    return target instanceof Element ? target.closest(selector) : null;
  }

  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("nav-modal-open");
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

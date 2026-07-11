(function () {
  function closestElement(target, selector) {
    return target instanceof Element ? target.closest(selector) : null;
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("nav-modal-open");
  }

  function closeModal(modal) {
    modal.hidden = true;
    document.body.classList.remove("nav-modal-open");
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

    if (event.target instanceof Element && event.target.classList.contains("nav-modal-backdrop")) {
      closeModal(event.target);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = document.querySelector(".nav-modal-backdrop:not([hidden])");
    if (modal) closeModal(modal);
  });
})();

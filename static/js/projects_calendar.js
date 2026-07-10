(function () {
  const board = document.querySelector(".projects-board");
  const calendarEl = document.querySelector(".projects-calendar");
  const dataEl = document.getElementById("projects-calendar-data");

  if (!board || !calendarEl || !dataEl) {
    return;
  }

  const endpoint = board.dataset.calendarEndpoint || "/api/projects/calendar";
  const cache = new Map();
  let currentCalendar = null;
  let pendingStart = null;
  const initialCalendar = parseInitialCalendar();

  function parseInitialCalendar() {
    try {
      return JSON.parse(dataEl.textContent || "{}");
    } catch (_error) {
      return null;
    }
  }

  function cacheCalendar(calendar) {
    if (calendar && calendar.navigation && calendar.navigation.current_start) {
      cache.set(calendar.navigation.current_start, calendar);
    }
  }

  function plural(count, singular, pluralValue) {
    return count === 1 ? singular : pluralValue;
  }

  function makeText(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) {
      node.className = className;
    }
    node.textContent = text;
    return node;
  }

  function recommendationLabel(count) {
    if (count === 0) {
      return "No recommendations";
    }
    if (count === 1) {
      return "1 recommendation";
    }
    return `${count} recommendations`;
  }

  function renderRawDetails(summaryText, jsonText, className) {
    const details = document.createElement("details");
    details.className = className || "projects-context-raw";
    const summary = document.createElement("summary");
    summary.textContent = summaryText;
    const pre = document.createElement("pre");
    pre.textContent = jsonText || "{}";
    details.append(summary, pre);
    return details;
  }

  function renderProject(project) {
    const article = document.createElement("article");
    article.className = "projects-context-summary";

    article.appendChild(makeText("div", "projects-context-project", project.name || project.id || "Project"));
    article.appendChild(makeText(
      "div",
      "projects-context-count",
      `${project.entry_count || 0} ${plural(project.entry_count || 0, "entry", "entries")}`,
    ));
    article.appendChild(makeText(
      "div",
      "projects-context-images",
      `${project.image_count || 0} ${plural(project.image_count || 0, "image", "images")}`,
    ));
    article.appendChild(renderRawDetails("View JSON", project.raw_json, "projects-context-raw"));
    article.appendChild(makeText("div", "projects-recommendations-label", "Recommendations"));

    const recommendationLink = document.createElement("a");
    recommendationLink.className = "projects-recommendation";
    recommendationLink.href = project.recommendations_href || "#";
    recommendationLink.textContent = recommendationLabel(project.recommendations_count || 0);
    article.appendChild(recommendationLink);
    article.appendChild(renderRawDetails(
      "View recommendation JSON",
      project.recommendations_raw_json,
      "projects-context-raw projects-recommendations-raw",
    ));

    return article;
  }

  function renderDay(day) {
    const section = document.createElement("section");
    section.className = `projects-day${day.is_today ? " today" : ""}`;
    section.setAttribute("aria-label", `${day.weekday} ${day.date}`);

    const header = document.createElement("header");
    header.className = "projects-day-header";
    header.append(
      makeText("div", "projects-day-name", day.weekday || ""),
      makeText("div", "projects-day-date", day.date || ""),
    );

    const body = document.createElement("div");
    body.className = "projects-day-body";
    (day.projects || []).forEach((project) => {
      body.appendChild(renderProject(project));
    });

    section.append(header, body);
    return section;
  }

  function setButton(direction, start) {
    const button = board.querySelector(`[data-direction="${direction}"]`);
    if (!button) {
      return;
    }
    const isEnabled = Boolean(start);
    button.disabled = !isEnabled;
    button.classList.toggle("disabled", !isEnabled);
    button.setAttribute("aria-disabled", isEnabled ? "false" : "true");
    if (isEnabled) {
      button.dataset.start = start;
      button.setAttribute(
        "aria-label",
        direction === "previous" ? "Previous project day with files" : "Next project day with files",
      );
    } else {
      delete button.dataset.start;
      button.setAttribute(
        "aria-label",
        direction === "previous" ? "No earlier project days with files" : "No later project days with files",
      );
    }
  }

  function updateUrl(start) {
    const url = new URL(window.location.href);
    url.searchParams.set("start", start);
    window.history.pushState({ start }, "", `${url.pathname}?${url.searchParams.toString()}`);
  }

  function renderCalendar(calendar, options) {
    const settings = options || {};
    currentCalendar = calendar;
    cacheCalendar(calendar);
    calendarEl.replaceChildren(...(calendar.days || []).map(renderDay));
    setButton("previous", calendar.navigation && calendar.navigation.previous_start);
    setButton("next", calendar.navigation && calendar.navigation.next_start);
    if (settings.updateUrl && calendar.navigation && calendar.navigation.current_start) {
      updateUrl(calendar.navigation.current_start);
    }
    prefetchAdjacent(calendar);
  }

  async function fetchCalendar(start) {
    if (cache.has(start)) {
      return cache.get(start);
    }
    const url = new URL(endpoint, window.location.origin);
    url.searchParams.set("start", start);
    const response = await fetch(url.toString(), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`calendar request failed: ${response.status}`);
    }
    const payload = await response.json();
    if (!payload || !payload.calendar) {
      throw new Error("calendar response missing payload");
    }
    cacheCalendar(payload.calendar);
    return payload.calendar;
  }

  function prefetchStart(start) {
    if (!start || cache.has(start) || pendingStart === start) {
      return;
    }
    pendingStart = start;
    fetchCalendar(start)
      .catch(() => {})
      .finally(() => {
        if (pendingStart === start) {
          pendingStart = null;
        }
      });
  }

  function prefetchAdjacent(calendar) {
    const navigation = calendar && calendar.navigation;
    if (!navigation) {
      return;
    }
    window.setTimeout(() => {
      prefetchStart(navigation.previous_start);
      prefetchStart(navigation.next_start);
    }, 0);
  }

  async function navigate(direction) {
    const button = board.querySelector(`[data-direction="${direction}"]`);
    const start = button && button.dataset.start;
    if (!start || button.disabled) {
      return;
    }
    button.disabled = true;
    try {
      renderCalendar(await fetchCalendar(start), { updateUrl: true });
    } catch (_error) {
      button.disabled = false;
    }
  }

  board.addEventListener("click", (event) => {
    const button = event.target.closest("[data-direction]");
    if (!button || !board.contains(button)) {
      return;
    }
    event.preventDefault();
    navigate(button.dataset.direction);
  });

  window.addEventListener("popstate", async () => {
    const start = new URL(window.location.href).searchParams.get("start");
    if (!start) {
      if (initialCalendar) {
        renderCalendar(initialCalendar, { updateUrl: false });
      }
      return;
    }
    try {
      renderCalendar(await fetchCalendar(start), { updateUrl: false });
    } catch (_error) {
      if (currentCalendar) {
        renderCalendar(currentCalendar, { updateUrl: false });
      }
    }
  });

  if (initialCalendar) {
    renderCalendar(initialCalendar, { updateUrl: false });
  }
})();

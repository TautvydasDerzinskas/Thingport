const instanceRow = document.getElementById("instance-row");
const instanceUrlText = document.getElementById("instance-url-text");
const editInstanceBtn = document.getElementById("edit-instance-btn");
const configuredView = document.getElementById("configured-view");
const enabledSwitch = document.getElementById("enabled-switch");
const recentSection = document.getElementById("recent-section");
const recentGrid = document.getElementById("recent-grid");
const configuredErrorEl = document.getElementById("configured-error");
const setupForm = document.getElementById("setup-form");
const instanceUrlInput = document.getElementById("instance-url");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const saveBtn = document.getElementById("save-btn");
const cancelBtn = document.getElementById("cancel-btn");
const errorEl = document.getElementById("error");

function sendMessage(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

function showError(message, el = errorEl) {
  el.textContent = message;
  el.classList.add("visible");
}

function clearError(el = errorEl) {
  el.textContent = "";
  el.classList.remove("visible");
}

/** The instance URL as shown under the title -- the scheme is noise at this size. */
function displayInstanceUrl(instanceUrl) {
  return instanceUrl.replace(/^https?:\/\//i, "");
}

function showConfiguredView(state) {
  configuredView.hidden = false;
  setupForm.hidden = true;
  instanceRow.hidden = false;
  instanceUrlText.textContent = displayInstanceUrl(state.instanceUrl);
  instanceUrlText.title = state.instanceUrl;
  enabledSwitch.checked = !state.disabled;
  clearError(configuredErrorEl);
  void loadRecentImports();
}

function showSetupForm(prefillUrl, prefillEmail) {
  configuredView.hidden = true;
  instanceRow.hidden = true;
  setupForm.hidden = false;
  cancelBtn.hidden = !prefillUrl;
  instanceUrlInput.value = prefillUrl || "";
  emailInput.value = prefillEmail || "";
  passwordInput.value = "";
  clearError();
  instanceUrlInput.focus();
}

async function refresh() {
  const res = await sendMessage("GET_STATE");
  if (!res.ok) {
    showError(res.error);
    return;
  }
  if (res.data.configured) {
    showConfiguredView(res.data);
  } else {
    showSetupForm();
  }
}

// -- Recent imports -------------------------------------------------------------------------------

function recentItemEl(item) {
  const link = document.createElement("a");
  link.className = "recent-item";
  link.href = item.url;
  link.title = item.title || "";
  link.setAttribute("aria-label", item.title || "Imported model");
  // Opened from here rather than via a plain target="_blank" -- a link click inside an extension
  // popup isn't guaranteed to open a tab, and the popup should close once it has.
  link.addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.tabs.create({ url: item.url });
    window.close();
  });

  const placeholder = () => {
    link.textContent = (item.title || "?").trim().charAt(0).toUpperCase() || "?";
  };
  if (item.thumbDataUrl) {
    const img = document.createElement("img");
    img.src = item.thumbDataUrl;
    img.alt = "";
    img.addEventListener("error", () => {
      img.remove();
      placeholder();
    });
    link.appendChild(img);
  } else {
    placeholder();
  }
  return link;
}

/** Read from extension storage only -- see background.js's recordRecentImport. */
async function loadRecentImports() {
  const res = await sendMessage("GET_RECENT_IMPORTS");
  if (!res.ok || !res.data.length) {
    recentSection.hidden = true;
    return;
  }
  recentGrid.replaceChildren(...res.data.map(recentItemEl));
  recentSection.hidden = false;
}

// -- Events ---------------------------------------------------------------------------------------

editInstanceBtn.addEventListener("click", async () => {
  const res = await sendMessage("GET_STATE");
  showSetupForm(res.ok ? res.data.instanceUrl : "", res.ok ? res.data.email : "");
});

cancelBtn.addEventListener("click", () => { void refresh(); });

enabledSwitch.addEventListener("change", async () => {
  clearError(configuredErrorEl);
  enabledSwitch.disabled = true;
  const res = await sendMessage("SET_DISABLED", { disabled: !enabledSwitch.checked });
  enabledSwitch.disabled = false;
  if (!res.ok) {
    showError(res.error, configuredErrorEl);
    enabledSwitch.checked = !enabledSwitch.checked;
  }
});

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const normalized = thingportNormalizeInstanceUrl(instanceUrlInput.value);
  let origin;
  try {
    origin = new URL(normalized).origin;
  } catch {
    showError("Enter a valid instance URL, e.g. https://thingport.example.com");
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  try {
    // Must be called directly here, not inside the SAVE_CONFIG message handled by the background
    // service worker -- chrome.permissions.request() needs the user gesture this submit click
    // carries, which a runtime.sendMessage hop into the service worker would lose.
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      showError("Thingport Grab needs permission to reach this instance to work.");
      return;
    }
    const res = await sendMessage("SAVE_CONFIG", {
      instanceUrl: normalized,
      email: emailInput.value,
      password: passwordInput.value,
    });
    if (!res.ok) {
      showError(res.error);
      return;
    }
    await refresh();
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
});

void refresh();

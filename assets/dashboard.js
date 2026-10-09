const SESSION_STORAGE_KEY = "francisworks-dashboard-session";
const STORAGE_BUCKET = "inquiry_files";
const INQUIRY_STATUSES = ["new", "read", "replied", "archived"];

let configPromise;
let session = readSession();
let inquiries = [];
let selectedInquiryId;

const authPanel = document.getElementById("dashboard-auth-panel");
const authForm = document.getElementById("dashboard-login-form");
const authStatus = document.getElementById("dashboard-auth-status");
const appPanel = document.getElementById("dashboard-app");
const dashboardUser = document.getElementById("dashboard-user");
const dashboardList = document.getElementById("dashboard-list");
const dashboardDetail = document.getElementById("dashboard-detail");
const refreshButton = document.getElementById("dashboard-refresh");
const signoutButton = document.getElementById("dashboard-signout");

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function storeSession(nextSession) {
  session = nextSession;
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
}

function clearSession() {
  session = null;
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

async function getConfig() {
  configPromise ??= fetch("/api/config", { cache: "no-store" }).then(async response => {
    if (!response.ok) throw new Error("Supabase configuration unavailable.");
    return response.json();
  });
  return configPromise;
}

function getAuthHeaders(config, contentType = false) {
  const headers = {
    apikey: config.supabasePublishableKey,
    Authorization: `Bearer ${session?.access_token || config.supabasePublishableKey}`
  };
  if (contentType) headers["Content-Type"] = "application/json";
  return headers;
}

function parseAuthCallback() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (!accessToken || !refreshToken) return;
  storeSession({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Number(hash.get("expires_at") || 0)
  });
  history.replaceState({}, "", "/");
}

async function refreshSession() {
  if (!session?.refresh_token) throw new Error("Sign-in expired.");
  const config = await getConfig();
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: getAuthHeaders(config, true),
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!response.ok) throw new Error("Sign-in expired.");
  const refreshed = await response.json();
  storeSession({
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || session.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600)
  });
}

async function authenticatedFetch(path, options = {}, canRefresh = true) {
  const config = await getConfig();
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...options,
    headers: {
      ...getAuthHeaders(config, Boolean(options.body)),
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && canRefresh) {
    await refreshSession();
    return authenticatedFetch(path, options, false);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.message || body?.hint || "Dashboard request failed.");
    error.status = response.status;
    throw error;
  }
  return response;
}

async function sendSignInLink(email) {
  const config = await getConfig();
  const response = await fetch(`${config.supabaseUrl}/auth/v1/otp`, {
    method: "POST",
    headers: {
      apikey: config.supabasePublishableKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      options: {
        email_redirect_to: `${window.location.origin}/`
      }
    })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.msg || body?.message || "Sign-in link could not be sent.");
  }
}

async function getCurrentUser() {
  const response = await authenticatedFetch("/auth/v1/user");
  return response.json();
}

async function loadInquiries() {
  const adminResponse = await authenticatedFetch("/rest/v1/dashboard_admins?select=email");
  const admins = await adminResponse.json();
  if (!admins.length) {
    const error = new Error("This account does not have dashboard access.");
    error.status = 403;
    throw error;
  }
  const response = await authenticatedFetch(
    "/rest/v1/inquiries?select=id,email,subject,message,files,status,created_at,updated_at&order=created_at.desc"
  );
  inquiries = await response.json();
  renderInquiryList();
  if (selectedInquiryId && inquiries.some(inquiry => inquiry.id === selectedInquiryId)) {
    renderInquiryDetail(selectedInquiryId);
  } else if (inquiries[0]) {
    renderInquiryDetail(inquiries[0].id);
  } else {
    dashboardDetail.replaceChildren(createEmptyState("No inquiries yet.", "New messages will appear here."));
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createEmptyState(title, copy) {
  const wrapper = document.createElement("div");
  wrapper.className = "dashboard-empty";
  wrapper.append(
    createTextElement("h2", "", title),
    createTextElement("p", "", copy)
  );
  return wrapper;
}

function renderInquiryList() {
  dashboardList.replaceChildren();
  if (!inquiries.length) {
    dashboardList.append(createEmptyState("No messages yet.", "Submitted inquiries will appear here."));
    return;
  }
  for (const inquiry of inquiries) {
    const button = document.createElement("button");
    button.className = "dashboard-list-item";
    button.type = "button";
    button.dataset.inquiryId = inquiry.id;
    if (inquiry.id === selectedInquiryId) button.classList.add("is-selected");
    button.addEventListener("click", () => renderInquiryDetail(inquiry.id));
    const heading = document.createElement("span");
    heading.className = "dashboard-list-item-heading";
    heading.append(
      createTextElement("strong", "", inquiry.subject),
      createTextElement("span", `dashboard-status-chip is-${inquiry.status}`, inquiry.status)
    );
    button.append(
      heading,
      createTextElement("span", "dashboard-list-item-email", inquiry.email),
      createTextElement("time", "dashboard-list-item-date", formatDate(inquiry.created_at))
    );
    dashboardList.append(button);
  }
}

async function createSignedUrl(path) {
  const response = await authenticatedFetch(`/storage/v1/object/sign/${STORAGE_BUCKET}`, {
    method: "POST",
    body: JSON.stringify({ expiresIn: 3600, paths: [path] })
  });
  const payload = await response.json();
  const signedUrl = payload.signedURLs?.[0]?.signedURL || payload.signedURL;
  if (!signedUrl) throw new Error("Attachment link unavailable.");
  const config = await getConfig();
  return signedUrl.startsWith("http") ? signedUrl : `${config.supabaseUrl}/storage/v1${signedUrl}`;
}

function renderAttachments(container, files) {
  if (!Array.isArray(files) || !files.length) {
    container.append(createTextElement("p", "dashboard-muted", "No attachments."));
    return;
  }
  const list = document.createElement("ul");
  list.className = "dashboard-attachments";
  for (const file of files) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = file.name;
    link.addEventListener("click", async event => {
      event.preventDefault();
      if (link.dataset.ready === "true") return;
      link.textContent = "Preparing download…";
      try {
        link.href = await createSignedUrl(file.path);
        link.target = "_blank";
        link.rel = "noopener";
        link.dataset.ready = "true";
        link.textContent = file.name;
        link.click();
      } catch (error) {
        link.textContent = error instanceof Error ? error.message : "Download failed.";
      }
    });
    item.append(link, createTextElement("span", "dashboard-muted", `${file.type || "File"} · ${formatFileSize(file.size)}`));
    list.append(item);
  }
  container.append(list);
}

function formatFileSize(bytes = 0) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderInquiryDetail(inquiryId) {
  selectedInquiryId = inquiryId;
  const inquiry = inquiries.find(item => item.id === inquiryId);
  if (!inquiry) return;
  renderInquiryList();
  dashboardDetail.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "dashboard-detail-heading";
  heading.append(
    createTextElement("p", "dashboard-kicker", formatDate(inquiry.created_at)),
    createTextElement("h2", "", inquiry.subject),
    createTextElement("p", "dashboard-detail-email", inquiry.email)
  );
  const statusLabel = createTextElement("label", "dashboard-field-label", "Status");
  const statusSelect = document.createElement("select");
  statusSelect.className = "dashboard-status-select";
  statusSelect.setAttribute("aria-label", "Inquiry status");
  for (const status of INQUIRY_STATUSES) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    option.selected = inquiry.status === status;
    statusSelect.append(option);
  }
  statusSelect.addEventListener("change", () => updateInquiryStatus(inquiry, statusSelect.value));
  const statusControl = document.createElement("div");
  statusControl.className = "dashboard-status-control";
  statusControl.append(statusLabel, statusSelect);
  const message = createTextElement("p", "dashboard-detail-message", inquiry.message);
  const attachments = document.createElement("section");
  attachments.className = "dashboard-detail-section";
  attachments.append(createTextElement("h3", "", "Attachments"));
  renderAttachments(attachments, inquiry.files);
  dashboardDetail.append(heading, statusControl, message, attachments);
}

async function updateInquiryStatus(inquiry, status) {
  try {
    await authenticatedFetch(`/rest/v1/inquiries?id=eq.${encodeURIComponent(inquiry.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
    inquiry.status = status;
    renderInquiryList();
  } catch (error) {
    authStatus.textContent = error instanceof Error ? error.message : "Status update failed.";
  }
}

function showLogin(message = "") {
  authPanel.hidden = false;
  appPanel.hidden = true;
  authStatus.textContent = message;
}

function showApp(user) {
  authPanel.hidden = true;
  appPanel.hidden = false;
  dashboardUser.textContent = user.email || "Signed in";
  void loadInquiries().catch(error => {
    appPanel.hidden = true;
    authPanel.hidden = false;
    authStatus.textContent = error.status === 401 || error.status === 403
      ? "This account does not have dashboard access."
      : error.message;
  });
}

authForm.addEventListener("submit", async event => {
  event.preventDefault();
  const email = new FormData(authForm).get("email");
  authStatus.textContent = "Sending sign-in link…";
  try {
    await sendSignInLink(email);
    authStatus.textContent = "Check your email for a sign-in link.";
  } catch (error) {
    authStatus.textContent = error instanceof Error ? error.message : "Sign-in link failed.";
  }
});

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  try {
    await loadInquiries();
  } catch (error) {
    authStatus.textContent = error instanceof Error ? error.message : "Refresh failed.";
  } finally {
    refreshButton.disabled = false;
  }
});

signoutButton.addEventListener("click", async () => {
  try {
    const config = await getConfig();
    await fetch(`${config.supabaseUrl}/auth/v1/logout`, {
      method: "POST",
      headers: getAuthHeaders(config)
    });
  } finally {
    clearSession();
    showLogin();
  }
});

async function initialize() {
  parseAuthCallback();
  if (!session?.access_token) return;
  try {
    showApp(await getCurrentUser());
  } catch {
    clearSession();
    showLogin("Sign-in expired. Request a new link.");
  }
}

void initialize();

const auth = document.querySelector("#auth");
const workspace = document.querySelector("#workspace");
const loginForm = document.querySelector("#login-form");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const thumbnails = document.querySelector("#thumbnails");
const preview = document.querySelector("#preview");
const metadataButton = document.querySelector("#metadata-button");
const logoutButton = document.querySelector("#logout-button");
const metadataDialog = document.querySelector("#metadata-dialog");
const metadataClose = document.querySelector("#metadata-close");
const metadataList = document.querySelector("#metadata-list");

const images = [];
let selectedId = null;

function showWorkspace() {
  auth.hidden = true;
  workspace.hidden = false;
}

function showAuth() {
  workspace.hidden = true;
  auth.hidden = false;
  passwordInput.value = "";
}

function selectImage(id) {
  selectedId = id;
  const image = images.find((item) => item.id === id);
  if (!image) return;
  preview.src = image.data_url;
  preview.alt = image.filename;
  preview.hidden = false;
  metadataButton.hidden = false;
  for (const button of thumbnails.querySelectorAll(".thumbnail")) {
    button.classList.toggle("selected", button.dataset.id === id);
  }
}

function addImage(image) {
  if (images.some((item) => item.id === image.id)) return;
  images.unshift(image);
  const button = document.createElement("button");
  button.className = "thumbnail";
  button.dataset.id = image.id;
  button.setAttribute("aria-label", image.filename);
  const thumbnail = document.createElement("img");
  thumbnail.src = image.data_url;
  thumbnail.alt = "";
  button.append(thumbnail);
  button.addEventListener("click", () => selectImage(image.id));
  thumbnails.prepend(button);
  if (!selectedId) selectImage(image.id);
}

async function syncImages() {
  const localImages = await window.canvasDesktop.listImages();
  localImages
    .sort((left, right) => new Date(left.created_at) - new Date(right.created_at))
    .forEach(addImage);
}

function showMetadata() {
  const image = images.find((item) => item.id === selectedId);
  if (!image) return;
  const values = [
    ["Имя", image.filename],
    ["Тип", image.mime_type],
    ["Размеры", `${image.width} × ${image.height}`],
    ["Байты", new Intl.NumberFormat("ru-RU").format(image.size_bytes)],
    ["Создано", new Date(image.created_at).toLocaleString("ru-RU")],
    ["Путь", image.local_path],
  ];
  metadataList.replaceChildren();
  for (const [label, value] of values) {
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    metadataList.append(term, detail);
  }
  metadataDialog.showModal();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button");
  button.disabled = true;
  usernameInput.classList.remove("invalid");
  passwordInput.classList.remove("invalid");
  try {
    const user = await window.canvasDesktop.login({
      username: usernameInput.value,
      password: passwordInput.value,
    });
    if (user) {
      await syncImages();
      showWorkspace();
    }
    else {
      usernameInput.classList.add("invalid");
      passwordInput.classList.add("invalid");
    }
  } catch {
    usernameInput.classList.add("invalid");
    passwordInput.classList.add("invalid");
  } finally {
    button.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await window.canvasDesktop.logout();
  selectedId = null;
  images.length = 0;
  thumbnails.replaceChildren();
  preview.hidden = true;
  metadataButton.hidden = true;
  showAuth();
});

metadataButton.addEventListener("click", showMetadata);
metadataClose.addEventListener("click", () => metadataDialog.close());
metadataDialog.addEventListener("click", (event) => {
  if (event.target === metadataDialog) metadataDialog.close();
});

window.canvasDesktop.onImage(addImage);
window.canvasDesktop.restore().then(async (user) => {
  if (user) {
    await syncImages();
    showWorkspace();
  } else showAuth();
});

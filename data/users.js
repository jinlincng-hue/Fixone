/* Browser-side session cache only. Passwords remain exclusively on the server. */

function getCurrentUser() {
  try {
    const raw = localStorage.getItem("fixoneCurrentUser");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCurrentUser(user) {
  localStorage.setItem("fixoneCurrentUser", JSON.stringify({
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    email: user.email || "",
    sessionToken: user.sessionToken || ""
  }));
}

function logoutCurrentUser() {
  localStorage.removeItem("fixoneCurrentUser");
}

function handleProfileOpen() {
  const button = document.querySelector("#homeProfileButton");
  if (!button) return;

  button.addEventListener("click", () => {
    window.location.href = "profile.html";
  });
}

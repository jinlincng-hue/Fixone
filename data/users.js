/*
 * MVP 测试账号说明：
 * 当前账号系统仅用于 Fixone MVP 前端演示。正式上线前不能明文保存密码，
 * 必须改成后端加密存储、登录鉴权、会话管理和权限校验。
 */
const FIXONE_TEST_USERS = [
  {
    role: "member",
    displayName: "曾锦玲",
    username: "fixzengjinling",
    password: "zengjinling01"
  },
  {
    role: "member",
    displayName: "王琦",
    username: "fixwangqi",
    password: "wangqi01"
  },
  {
    role: "member",
    displayName: "闫淑亭",
    username: "fixyanshuting",
    password: "yanshuting01"
  },
  {
    role: "member",
    displayName: "湛睿",
    username: "fixzhanrui",
    password: "zhanrui01"
  },
  {
    role: "member",
    displayName: "杨双双",
    username: "fixyangshuangshuang",
    password: "yangshuangshuang01"
  }
];

function getFixoneUsers() {
  return FIXONE_TEST_USERS.slice();
}

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

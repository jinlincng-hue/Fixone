const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const { openDb, closeDb, getDbPath, rootDir } = require("../src/db");
const { applyMigrations } = require("../src/schema");

dotenv.config();

const reset = process.argv.includes("--reset");
const dbPath = getDbPath();

if (reset) {
  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}

fs.mkdirSync(path.join(rootDir, "data", "licenses"), { recursive: true });
fs.mkdirSync(path.join(rootDir, "public", "uploads", "products"), { recursive: true });
fs.mkdirSync(path.join(rootDir, "public", "uploads", "listings"), { recursive: true });
fs.mkdirSync(path.join(rootDir, "public", "uploads", "shops"), { recursive: true });

const db = openDb();

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'merchant', 'admin')),
  phone TEXT NOT NULL,
  village TEXT NOT NULL,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credit_code TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  business_hours TEXT NOT NULL,
  business_scope TEXT NOT NULL,
  delivery_area TEXT NOT NULL,
  license_image TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INTEGER UNIQUE REFERENCES merchant_applications(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  business_hours TEXT NOT NULL,
  business_scope TEXT NOT NULL,
  delivery_area TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
  logo_image TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER REFERENCES shops(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  publish_type TEXT NOT NULL,
  name TEXT NOT NULL,
  image TEXT NOT NULL,
  price REAL NOT NULL,
  unit TEXT NOT NULL,
  spec TEXT NOT NULL,
  description TEXT NOT NULL,
  stock_status TEXT NOT NULL,
  condition TEXT NOT NULL,
  village TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  pickup INTEGER NOT NULL DEFAULT 1,
  delivery INTEGER NOT NULL DEFAULT 0,
  delivery_area TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  type TEXT NOT NULL CHECK(type IN ('secondhand', 'farm')),
  name TEXT NOT NULL,
  image TEXT NOT NULL,
  price REAL NOT NULL,
  unit TEXT NOT NULL,
  spec TEXT NOT NULL,
  description TEXT NOT NULL,
  stock_status TEXT NOT NULL,
  condition TEXT NOT NULL,
  village TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  pickup INTEGER NOT NULL DEFAULT 1,
  delivery INTEGER NOT NULL DEFAULT 0,
  delivery_area TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wanted_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  budget TEXT NOT NULL,
  village TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT,
  needs_delivery INTEGER NOT NULL DEFAULT 0,
  contact_phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('seeking', 'found', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER REFERENCES shops(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  phone TEXT NOT NULL,
  business_hours TEXT NOT NULL,
  delivery_area TEXT NOT NULL,
  village TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
  verified_only INTEGER NOT NULL DEFAULT 0,
  image TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open', 'resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_status_category ON products(status, category_id);
CREATE INDEX IF NOT EXISTS idx_listings_status_type ON personal_listings(status, type);
CREATE INDEX IF NOT EXISTS idx_wanted_status ON wanted_posts(status);
CREATE INDEX IF NOT EXISTS idx_applications_status ON merchant_applications(status);
`;

db.exec(schema);
applyMigrations(db);

function now() {
  return new Date().toISOString();
}

function hash(password) {
  return bcrypt.hashSync(password, 12);
}

function ensureUser(username, password, role, phone, village) {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return existing.id;
  const result = db
    .prepare("INSERT INTO users (username, password_hash, role, phone, village, is_disabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
    .run(username, hash(password), role, phone, village, now(), now());
  return result.lastInsertRowid;
}

const seed = db.transaction(() => {
  const categoryRows = [
    ["食品生鲜", "fresh", "basket", 1],
    ["日用百货", "daily", "bag", 2],
    ["本地农货", "farm", "leaf", 3],
    ["家居家电", "home", "sofa", 4],
    ["数码通讯", "digital", "phone", 5],
    ["五金农具", "hardware", "tool", 6],
    ["交通出行", "transport", "car", 7],
    ["医药健康", "medical", "medical", 8],
    ["餐饮美食", "restaurant", "utensils", 9],
    ["生活服务", "life-service", "wrench", 10]
  ];
  for (const row of categoryRows) {
    db.prepare("INSERT OR IGNORE INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)").run(...row);
  }

  const adminPassword = process.env.ADMIN_PASSWORD || process.env.DEMO_ADMIN_PASSWORD || "Admin12345!";
  ensureUser("admin", adminPassword, "admin", "13800000001", "FixOne配件库");
});

seed();
closeDb();

console.log(`SQLite 已初始化：${dbPath}`);
console.log("已初始化系统分类和管理员账号。");
console.log(`管理员 admin / ${process.env.ADMIN_PASSWORD || process.env.DEMO_ADMIN_PASSWORD || "Admin12345!"}`);
console.log("不再初始化演示商家、商品、服务、个人发布或求购；商家数据必须来自真实商家账号入驻审核。");
